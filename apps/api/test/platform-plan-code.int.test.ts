import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

/**
 * A Paystack plan code decides what a customer is charged at checkout, so changing one is a
 * SUPERADMIN action with a reason, verified against Paystack before it is stored, and audited with
 * the old and new code. Paystack itself is stubbed at `fetch`; no real API is called.
 */
describe('platform Paystack plan-code changes', () => {
  let harness: TestHarness;
  let superadminCookie: string;
  let operationsCookie: string;
  let starterId: string;
  let legacyId: string;
  const previousKey = process.env.PAYSTACK_SECRET_KEY;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = previousKey;
    await harness.close();
  });

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    await harness.reset();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_plan_code_spec';
    const starter = await harness.prisma.plan.create({
      data: {
        key: 'starter_monthly',
        tierKey: 'starter',
        name: 'Starter',
        status: 'ACTIVE',
        priceMinor: 100n,
        currency: 'USD',
        billingInterval: 'MONTHLY',
        billingProvider: 'PAYSTACK',
        providerPriceId: 'PLN_oldstarter',
      },
    });
    starterId = starter.id;
    await harness.prisma.plan.create({
      data: {
        key: 'growth_monthly',
        tierKey: 'growth',
        name: 'Growth',
        status: 'ACTIVE',
        priceMinor: 499n,
        billingInterval: 'MONTHLY',
        billingProvider: 'PAYSTACK',
        providerPriceId: 'PLN_takengrowth',
      },
    });
    const legacy = await harness.prisma.plan.create({
      data: { key: 'free', tierKey: 'free', name: 'Free', status: 'RETIRED' },
    });
    legacyId = legacy.id;
    [superadminCookie, operationsCookie] = await Promise.all([
      operator('code-superadmin@example.test', 'SUPERADMIN'),
      operator('code-operations@example.test', 'OPERATIONS'),
    ]);
  });

  function stubPaystack(plan: { amount: number; currency: string; interval: string }) {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: true,
            data: { plan_code: decodeURIComponent(url.split('/plan/')[1] ?? ''), ...plan },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const put = (planId: string, cookie: string, body: Record<string, unknown>) =>
    harness
      .http()
      .put(`${API}/platform/plans/${planId}/provider-code`)
      .set('Cookie', cookie)
      .send(body);

  const reason = 'Paystack dashboard plan was recreated after a currency fix.';

  it('verifies the code with Paystack, stores it, and audits old and new codes', async () => {
    const fetchMock = stubPaystack({ amount: 100, currency: 'USD', interval: 'monthly' });
    await put(starterId, superadminCookie, { providerPlanCode: 'PLN_newstarter', reason }).expect(
      200,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/plan/PLN_newstarter');
    const plan = await harness.prisma.plan.findUniqueOrThrow({ where: { id: starterId } });
    expect(plan.providerPriceId).toBe('PLN_newstarter');
    const audit = await harness.prisma.platformAuditEvent.findFirstOrThrow({
      where: { eventKey: 'platform.plan_provider_code_changed', targetId: starterId },
    });
    expect(audit.reason).toBe(reason);
    expect(audit.before).toMatchObject({ providerPlanCode: 'PLN_oldstarter' });
    expect(audit.after).toMatchObject({
      providerPlanCode: 'PLN_newstarter',
      verified: { amount: 100, currency: 'USD', interval: 'monthly' },
    });
  });

  it('refuses a Paystack plan whose amount or interval differs, changing nothing', async () => {
    stubPaystack({ amount: 999, currency: 'USD', interval: 'annually' });
    const response = await put(starterId, superadminCookie, {
      providerPlanCode: 'PLN_wrongplan',
      reason,
    }).expect(400);
    expect((response.body as { error: { message: string } }).error.message).toMatch(
      /amount.*interval/,
    );
    const plan = await harness.prisma.plan.findUniqueOrThrow({ where: { id: starterId } });
    expect(plan.providerPriceId).toBe('PLN_oldstarter');
    expect(
      await harness.prisma.platformAuditEvent.count({
        where: { eventKey: 'platform.plan_provider_code_changed' },
      }),
    ).toBe(0);
  });

  it('explains a code Paystack does not know, changing nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ status: false, message: 'Plan not found' }), {
            status: 404,
          }),
        ),
      ),
    );
    const response = await put(starterId, superadminCookie, {
      providerPlanCode: 'PLN_unknowncode',
      reason,
    }).expect(400);
    expect((response.body as { error: { message: string } }).error.message).toMatch(
      /PLN_unknowncode.*Plan not found.*Nothing was changed/,
    );
    const plan = await harness.prisma.plan.findUniqueOrThrow({ where: { id: starterId } });
    expect(plan.providerPriceId).toBe('PLN_oldstarter');
  });

  it('refuses before calling Paystack: duplicates, legacy plans, bad format, no reason', async () => {
    const fetchMock = stubPaystack({ amount: 100, currency: 'USD', interval: 'monthly' });
    await put(starterId, superadminCookie, {
      providerPlanCode: 'PLN_takengrowth',
      reason,
    }).expect(409);
    await put(legacyId, superadminCookie, { providerPlanCode: 'PLN_forlegacy', reason }).expect(
      400,
    );
    await put(starterId, superadminCookie, { providerPlanCode: 'not-a-code', reason }).expect(400);
    await put(starterId, superadminCookie, { providerPlanCode: 'PLN_newstarter' }).expect(400);
    await put(starterId, superadminCookie, {
      providerPlanCode: 'PLN_oldstarter',
      reason,
    }).expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is SUPERADMIN only, and the generic plan update can no longer change the code', async () => {
    const fetchMock = stubPaystack({ amount: 100, currency: 'USD', interval: 'monthly' });
    await put(starterId, operationsCookie, { providerPlanCode: 'PLN_newstarter', reason }).expect(
      403,
    );
    await harness
      .http()
      .patch(`${API}/platform/plans/${starterId}`)
      .set('Cookie', superadminCookie)
      .send({ providerPriceId: 'PLN_sneaky' })
      .expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const plan = await harness.prisma.plan.findUniqueOrThrow({ where: { id: starterId } });
    expect(plan.providerPriceId).toBe('PLN_oldstarter');
  });

  async function operator(email: string, role: 'SUPERADMIN' | 'OPERATIONS'): Promise<string> {
    const user = await harness.prisma.user.create({
      data: { email, displayName: email, emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
    await harness.prisma.platformAdmin.create({ data: { userId: user.id, role } });
    const token = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${token}`;
  }
});
