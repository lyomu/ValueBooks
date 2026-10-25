import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

describe('platform billing management', () => {
  let harness: TestHarness;
  let superadmin: string;
  let support: string;
  beforeAll(async () => { harness = await createTestHarness(); });
  afterAll(async () => { await harness.close(); });
  beforeEach(async () => {
    await harness.reset();
    superadmin = await operator('billing-superadmin@example.test', 'SUPERADMIN');
    support = await operator('billing-support@example.test', 'SUPPORT');
  });

  async function operator(email: string, role: 'SUPERADMIN' | 'SUPPORT') {
    const user = await harness.prisma.user.create({ data: { email, displayName: email,
      emailVerifiedAt: new Date(), status: 'ACTIVE' } });
    await harness.prisma.platformAdmin.create({ data: { userId: user.id, role } });
    const token = createOpaqueToken();
    await harness.prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 3_600_000) } });
    return `rb_session=${token}`;
  }

  it('edits tier copy and popularity atomically, with a reason and audit history', async () => {
    const professional = await harness.prisma.planTier.findUniqueOrThrow({ where: { key: 'professional' } });
    const starter = await harness.prisma.planTier.findUniqueOrThrow({ where: { key: 'starter' } });
    await harness.prisma.plan.create({ data: { key: 'starter_monthly', tierKey: 'starter',
      name: 'Starter', status: 'ACTIVE', billingInterval: 'MONTHLY', priceMinor: 100n } });
    await harness.http().patch(`${API}/platform/plan-tiers/${starter.id}`).set('Cookie', support)
      .send({ tagline: 'A clear place to begin', reason: 'Approved commercial copy update.' }).expect(403);
    await harness.http().patch(`${API}/platform/plan-tiers/${starter.id}`).set('Cookie', superadmin)
      .send({ name: 'Starter Plus', reason: 'Approved commercial copy update.' }).expect(400);
    await harness.http().patch(`${API}/platform/plan-tiers/${starter.id}`).set('Cookie', superadmin)
      .send({ tagline: 'A clear place to begin', isMostPopular: true,
        reason: 'Approved commercial copy update.' }).expect(200);
    expect((await harness.prisma.planTier.findUniqueOrThrow({ where: { id: starter.id } })).tagline).toBe('A clear place to begin');
    expect((await harness.prisma.planTier.findUniqueOrThrow({ where: { id: professional.id } })).isMostPopular).toBe(false);
    const detail = await harness.http().get(`${API}/platform/plan-tiers/${starter.id}`)
      .set('Cookie', support).expect(200);
    const detailData = (detail.body as { data: { tier: { name: string }; audits: unknown[] } }).data;
    expect(detailData.tier.name).toBe('Starter');
    expect(detailData.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventKey: 'platform.plan_tier_updated', reason: 'Approved commercial copy update.' }),
    ]));
    expect((await harness.prisma.plan.findUniqueOrThrow({ where: { key: 'starter_monthly' } })).priceMinor).toBe(100n);
  });

  it('changes reminder timing only for future schedules and audits the setting', async () => {
    await harness.http().post(`${API}/platform/billing/configuration/trial-reminder`)
      .set('Cookie', support).send({ reminderLeadHours: 48, reason: 'Improve trial reminder notice.' }).expect(403);
    await harness.http().post(`${API}/platform/billing/configuration/trial-reminder`)
      .set('Cookie', superadmin).send({ reminderLeadHours: 73, reason: 'Improve trial reminder notice.' }).expect(400);
    await harness.http().post(`${API}/platform/billing/configuration/trial-reminder`)
      .set('Cookie', superadmin).send({ reminderLeadHours: 48, reason: 'Improve trial reminder notice.' }).expect(201);
    const result = await harness.http().get(`${API}/platform/billing/configuration`)
      .set('Cookie', support).expect(200);
    expect((result.body as { data: { trial: unknown } }).data.trial).toMatchObject({ durationDays: 14, reminderLeadHours: 48,
      cardRequired: false, aiInsightLimit: 10 });
    expect(await harness.prisma.platformAuditEvent.count({ where: { eventKey: 'billing.trial_reminder_policy_updated' } })).toBe(1);
  });

  it('reports remote provider mismatches without mutating billing records', async () => {
    await harness.prisma.plan.create({ data: { key: 'starter_monthly', tierKey: 'starter',
      name: 'Starter', status: 'ACTIVE', billingInterval: 'MONTHLY', priceMinor: 100n,
      currency: 'USD', billingProvider: 'PAYSTACK', providerPriceId: 'PLN_starter' } });
    const before = await harness.prisma.billingTransaction.count();
    const oldKey = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_billing_diagnostics';
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: {
      amount: 999, currency: 'USD', interval: 'monthly', plan_code: 'PLN_starter',
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))));
    try {
      const response = await harness.http().post(`${API}/platform/billing/providers/diagnostics`)
        .set('Cookie', superadmin).send({}).expect(201);
      expect((response.body as { data: { plans: unknown[] } }).data.plans).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'starter_monthly', state: 'SYNC_FAILED' }),
      ]));
      expect(await harness.prisma.billingTransaction.count()).toBe(before);
    } finally {
      vi.unstubAllGlobals();
      if (oldKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = oldKey;
    }
  });

  it('creates and links one verified Paystack plan without making a charge', async () => {
    const plan = await harness.prisma.plan.create({ data: { key: 'growth_monthly', tierKey: 'growth',
      name: 'Growth', status: 'DRAFT', billingInterval: 'MONTHLY', priceMinor: 499n,
      currency: 'USD', billingProvider: 'PAYSTACK' } });
    const oldKey = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_billing_provision';
    const providerCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      providerCalls.push(`${init.method} ${url}`);
      return Promise.resolve(new Response(JSON.stringify({ data: { plan_code: 'PLN_growthtest', amount: 499,
        currency: 'USD', interval: 'monthly' } }), { status: 200,
        headers: { 'Content-Type': 'application/json' } }));
    }));
    try {
      await harness.http().post(`${API}/platform/plans/${plan.id}/provider-create`)
        .set('Cookie', superadmin).send({ reason: 'Provision the approved Growth monthly plan.' }).expect(201);
      const stored = await harness.prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
      expect(stored.providerPriceId).toBe('PLN_growthtest');
      expect((await harness.prisma.providerPlanProvision.findUniqueOrThrow({ where: { planId: plan.id } })).status).toBe('LINKED');
      await harness.http().post(`${API}/platform/plans/${plan.id}/provider-create`)
        .set('Cookie', superadmin).send({ reason: 'Provision the approved Growth monthly plan.' }).expect(400);
      expect(providerCalls.filter((call) => call.startsWith('POST '))).toHaveLength(1);
      expect(await harness.prisma.billingTransaction.count()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      if (oldKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = oldKey;
    }
  });

  it('holds an ambiguous Paystack create for reconciliation instead of creating twice', async () => {
    const plan = await harness.prisma.plan.create({ data: { key: 'advanced_monthly', tierKey: 'advanced',
      name: 'Advanced', status: 'DRAFT', billingInterval: 'MONTHLY', priceMinor: 2000n,
      currency: 'USD', billingProvider: 'PAYSTACK' } });
    const oldKey = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_billing_provision';
    const providerFetch = vi.fn(() => Promise.reject(new Error('Connection lost after request')));
    vi.stubGlobal('fetch', providerFetch);
    try {
      await harness.http().post(`${API}/platform/plans/${plan.id}/provider-create`)
        .set('Cookie', superadmin).send({ reason: 'Create approved Advanced monthly plan.' }).expect(502);
      expect((await harness.prisma.providerPlanProvision.findUniqueOrThrow({ where: { planId: plan.id } })).status)
        .toBe('NEEDS_RECONCILIATION');
      await harness.http().post(`${API}/platform/plans/${plan.id}/provider-create`)
        .set('Cookie', superadmin).send({ reason: 'Create approved Advanced monthly plan.' }).expect(409);
      expect(providerFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      if (oldKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = oldKey;
    }
  });
});
