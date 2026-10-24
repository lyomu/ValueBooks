import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import { PlanPricingService } from '../src/platform/plan-pricing.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

/**
 * Administrator-managed plan pricing (phase 7, O5).
 *
 * The owner's decision is that an administrator changes a price from the console without a deploy
 * and existing subscribers are repriced at their next renewal. Paystack is the price of record for
 * checkout, so what this spec cares about is that the two never diverge silently: Paystack is
 * updated first, with `update_existing_subscriptions` stated explicitly, the result is read back,
 * and ValueBooks only stores the new price once the provider agrees. Paystack is stubbed at
 * `fetch`; no real API is called and nobody is charged.
 */
describe('platform plan pricing', () => {
  let harness: TestHarness;
  let superadminCookie: string;
  let operationsCookie: string;
  let starterId: string;
  let codelessId: string;
  let organizationId: string;
  const previousKey = process.env.PAYSTACK_SECRET_KEY;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = previousKey;
    await harness.close();
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  beforeEach(async () => {
    await harness.reset();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_plan_pricing_spec';
    const starter = await planWithOpeningPrice({
      key: 'starter_monthly',
      tierKey: 'starter',
      name: 'Starter',
      status: 'ACTIVE',
      priceMinor: 100n,
      currency: 'USD',
      billingInterval: 'MONTHLY',
      billingProvider: 'PAYSTACK',
      providerPriceId: 'PLN_starter',
    });
    starterId = starter.id;
    const codeless = await planWithOpeningPrice({
      key: 'growth_monthly',
      tierKey: 'growth',
      name: 'Growth',
      status: 'ACTIVE',
      priceMinor: 499n,
      currency: 'USD',
      billingInterval: 'MONTHLY',
      billingProvider: 'PAYSTACK',
    });
    codelessId = codeless.id;

    // One paying subscriber and one trial, so the preview can tell them apart.
    const owner = await harness.prisma.user.create({
      data: {
        email: 'pricing-owner@example.test',
        displayName: 'Pricing Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const organization = await harness.prisma.organization.create({
      data: {
        legalName: 'Pricing Books Ltd',
        slug: 'pricing-books',
        countryCode: 'KE',
        baseCurrency: 'KES',
        timeZone: 'Africa/Nairobi',
        locale: 'en-KE',
        status: 'ACTIVE',
        createdByUserId: owner.id,
      },
    });
    organizationId = organization.id;
    await harness.prisma.organizationSubscription.create({
      data: { organizationId: organization.id, planId: starter.id, status: 'ACTIVE' },
    });
    // A billing contact, because a price-increase notice has to be addressed to somebody. An
    // organization with neither this nor an owner member cannot be notified at all, which one of
    // the specs below relies on.
    await harness.prisma.billingProfile.create({
      data: {
        organizationId: organization.id,
        contactName: 'Pricing Owner',
        contactEmail: 'pricing-owner@example.test',
        countryCode: 'KE',
      },
    });
    const trialOrganization = await harness.prisma.organization.create({
      data: {
        legalName: 'Pricing Trial Ltd',
        slug: 'pricing-trial',
        countryCode: 'KE',
        baseCurrency: 'KES',
        timeZone: 'Africa/Nairobi',
        locale: 'en-KE',
        status: 'ACTIVE',
        createdByUserId: owner.id,
      },
    });
    await harness.prisma.organizationSubscription.create({
      data: { organizationId: trialOrganization.id, planId: starter.id, status: 'TRIALING' },
    });

    [superadminCookie, operationsCookie] = await Promise.all([
      operator('pricing-superadmin@example.test', 'SUPERADMIN'),
      operator('pricing-operations@example.test', 'OPERATIONS'),
    ]);
  });

  /**
   * Answers Paystack's update and read-back calls. `remoteAmount` is what the plan reads as
   * afterwards, which the caller can deliberately make disagree with what was sent.
   */
  function stubPaystack(options: {
    remoteAmount: number;
    message?: string;
    updateStatus?: number;
    readFails?: boolean;
  }) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      });
      if (method === 'PUT') {
        const status = options.updateStatus ?? 200;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: status === 200,
              message:
                options.message ??
                (status === 200 ? 'Plan updated. 1 subscription(s) affected.' : 'Invalid amount'),
            }),
            { status, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (options.readFails) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'plan not found' }), { status: 404 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: true,
            data: {
              plan_code: decodeURIComponent(url.split('/plan/')[1] ?? ''),
              amount: options.remoteAmount,
              currency: 'USD',
              interval: 'monthly',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, calls };
  }

  const propose = (planId: string, cookie: string, body: Record<string, unknown>) =>
    harness
      .http()
      .post(`${API}/platform/plans/${planId}/price-changes`)
      .set('Cookie', cookie)
      .send(body);

  const publish = (planId: string, changeId: string, cookie: string) =>
    harness
      .http()
      .post(`${API}/platform/plans/${planId}/price-changes/${changeId}/publish`)
      .set('Cookie', cookie)
      .send({});

  const sendNotice = (planId: string, changeId: string, cookie: string) =>
    harness
      .http()
      .post(`${API}/platform/plans/${planId}/price-changes/${changeId}/notice`)
      .set('Cookie', cookie)
      .send({});

  const previewOf = async (planId: string, changeId: string) =>
    (
      (
        await harness
          .http()
          .get(`${API}/platform/plans/${planId}/price-changes/${changeId}/preview`)
          .set('Cookie', superadminCookie)
          .expect(200)
      ).body as { data: { notice: Record<string, unknown> | null } }
    ).data;

  /** Moves every queued notice for one change back in time, which is the only way to let a
   * 30-day period elapse inside a test. */
  const ageNotices = (changeId: string, days: number) =>
    harness.prisma.billingNotice.updateMany({
      where: { sourceId: changeId },
      data: { queuedAt: new Date(Date.now() - days * 86_400_000) },
    });

  const reason = 'Annual pricing review approved by the owner.';
  const priceOf = async (planId: string) =>
    (await harness.prisma.plan.findUniqueOrThrow({ where: { id: planId } })).priceMinor;

  // Keep the underlying 30-day notice rules covered while the public increase path is paused.
  // The production method always returns true; only these legacy-rule tests override it.
  const exercisePausedNoticeRules = () =>
    vi.spyOn(
      harness.app.get(PlanPricingService),
      'priceIncreasesPaused',
    ).mockReturnValue(false);

  it('proposes, previews and publishes a reduction, repricing existing subscriptions at Paystack', async () => {
    const proposal = await propose(starterId, superadminCookie, {
      priceMinor: '80',
      reason,
    }).expect(201);
    const changeId = (proposal.body as { data: { id: string } }).data.id;

    // Proposing changes nothing yet: no customer and no provider has seen it.
    expect(await priceOf(starterId)).toBe(100n);

    const preview = await harness
      .http()
      .get(`${API}/platform/plans/${starterId}/price-changes/${changeId}/preview`)
      .set('Cookie', superadminCookie)
      .expect(200);
    expect((preview.body as { data: Record<string, unknown> }).data).toMatchObject({
      fromPriceMinor: '100',
      toPriceMinor: '80',
      direction: 'DECREASE',
      subscribersToReprice: 1,
      trialingUnaffected: 1,
      stale: false,
    });

    const { calls } = stubPaystack({ remoteAmount: 80 });
    const published = await publish(starterId, changeId, superadminCookie).expect(201);
    expect((published.body as { data: Record<string, unknown> }).data).toMatchObject({
      priceMinor: '80',
      subscribersReportedByPaystack: 1,
      providerVerified: true,
    });

    // Paystack was updated before ValueBooks stored anything, and the repricing flag was stated
    // explicitly rather than left to Paystack's default.
    const update = calls.find((call) => call.method === 'PUT');
    expect(update?.url).toContain('/plan/PLN_starter');
    expect(update?.body).toMatchObject({ amount: 80, update_existing_subscriptions: true });
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1);

    expect(await priceOf(starterId)).toBe(80n);
    const history = await harness.prisma.planPriceHistory.findMany({
      where: { planId: starterId },
      orderBy: { effectiveFrom: 'asc' },
      select: { priceMinor: true, priceChangeId: true },
    });
    expect(history.map((row) => row.priceMinor)).toEqual([100n, 80n]);
    expect(history[1]?.priceChangeId).toBe(changeId);

    const change = await harness.prisma.planPriceChange.findUniqueOrThrow({
      where: { id: changeId },
    });
    expect(change.status).toBe('PUBLISHED');
    expect(change.providerAffectedSubscriptions).toBe(1);

    const audit = await harness.prisma.platformAuditEvent.findFirstOrThrow({
      where: { eventKey: 'platform.plan_price_published', targetId: starterId },
    });
    expect(audit.reason).toBe(reason);
    expect(audit.before).toMatchObject({ priceMinor: '100' });
    expect(audit.after).toMatchObject({
      priceMinor: '80',
      repriceExistingSubscriptions: true,
      subscribersExpected: 1,
      subscribersReportedByPaystack: 1,
    });
  });

  it('leaves the ValueBooks price alone when Paystack refuses or disagrees afterwards', async () => {
    const refused = await propose(starterId, superadminCookie, {
      priceMinor: '90',
      reason,
    }).expect(201);
    const refusedId = (refused.body as { data: { id: string } }).data.id;
    stubPaystack({ remoteAmount: 100, updateStatus: 400 });
    await publish(starterId, refusedId, superadminCookie).expect(400);
    expect(await priceOf(starterId)).toBe(100n);
    expect(
      (await harness.prisma.planPriceChange.findUniqueOrThrow({ where: { id: refusedId } })).status,
    ).toBe('DRAFT');

    // Paystack answers 200 but the plan reads back at the old amount: the catalog must not move,
    // because checkout compares the two and would stop on every charge.
    stubPaystack({ remoteAmount: 100 });
    const response = await publish(starterId, refusedId, superadminCookie).expect(400);
    expect(JSON.stringify(response.body)).toContain('not changed');
    expect(await priceOf(starterId)).toBe(100n);
    expect(await harness.prisma.planPriceHistory.count({ where: { planId: starterId } })).toBe(1);
    expect(
      await harness.prisma.platformAuditEvent.count({
        where: { eventKey: 'platform.plan_price_published' },
      }),
    ).toBe(0);
  });

  it('requires a superadmin, a plan with a Paystack code, and confirmation of a large increase', async () => {
    await propose(starterId, operationsCookie, { priceMinor: '120', reason }).expect(403);
    await propose(codelessId, superadminCookie, { priceMinor: '600', reason }).expect(400);
    await propose(starterId, superadminCookie, { priceMinor: '100', reason }).expect(400);
    await propose(starterId, superadminCookie, { priceMinor: '0', reason }).expect(400);
    await propose(starterId, superadminCookie, { priceMinor: '120', reason: 'too short' }).expect(
      400,
    );

    // A misplaced decimal point is the realistic mistake, and it would reach every subscriber.
    const unconfirmed = await propose(starterId, superadminCookie, {
      priceMinor: '10000',
      reason,
    }).expect(400);
    expect(JSON.stringify(unconfirmed.body)).toContain('Repeat the new price');
    await propose(starterId, superadminCookie, {
      priceMinor: '10000',
      confirmPriceMinor: '1000',
      reason,
    }).expect(400);
    await propose(starterId, superadminCookie, {
      priceMinor: '10000',
      confirmPriceMinor: '10000',
      reason,
    }).expect(201);

    // Only one change may await publication at a time.
    await propose(starterId, superadminCookie, { priceMinor: '150', reason }).expect(409);
    expect(await priceOf(starterId)).toBe(100n);
    expect(await harness.prisma.planPriceChange.count({ where: { status: 'DRAFT' } })).toBe(1);
  });

  it('refuses an increase before Paystack even when subscribers are unnotified', async () => {
    const proposal = await propose(starterId, superadminCookie, {
      priceMinor: '120',
      reason,
    }).expect(201);
    const changeId = (proposal.body as { data: { id: string } }).data.id;

    // The preview states the obligation before anybody commits to publishing.
    expect((await previewOf(starterId, changeId)).notice).toMatchObject({
      noticeDays: 30,
      subscribersToReprice: 1,
      noticesQueued: 0,
      awaitingNotice: 1,
      publishable: false,
    });

    const { fetchMock } = stubPaystack({ remoteAmount: 120 });
    const response = await publish(starterId, changeId, superadminCookie).expect(409);
    expect(JSON.stringify(response.body)).toContain('temporarily paused');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await priceOf(starterId)).toBe(100n);
  });

  it('records one durable notice per subscriber, does not restart it, and audits the send', async () => {
    exercisePausedNoticeRules();
    const proposal = await propose(starterId, superadminCookie, {
      priceMinor: '120',
      reason,
    }).expect(201);
    const changeId = (proposal.body as { data: { id: string } }).data.id;

    const first = await sendNotice(starterId, changeId, superadminCookie).expect(201);
    expect((first.body as { data: Record<string, unknown> }).data).toMatchObject({
      subscribersToReprice: 1,
      noticesQueued: 1,
      queuedByThisSend: 1,
      awaitingNotice: 0,
      failedToQueue: 0,
      withoutDeliverableAddress: 0,
      // Notified, but the 30 days have not run, so it is not yet publishable.
      withinNoticePeriod: 1,
      publishable: false,
    });

    // The trial is not notified: it is not being charged and converts at the new price.
    const ledger = await harness.prisma.billingNotice.findMany({
      where: { sourceId: changeId },
      select: { organizationId: true, recipientEmail: true, subject: true, body: true, queuedAt: true },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.organizationId).toBe(organizationId);
    expect(ledger[0]?.recipientEmail).toBe('pricing-owner@example.test');
    expect(ledger[0]?.queuedAt).not.toBeNull();
    // The subscriber is told both prices and that nothing is charged now.
    expect(ledger[0]?.body).toContain('USD 1.00');
    expect(ledger[0]?.body).toContain('USD 1.20');
    expect(ledger[0]?.body).toContain('Nothing is charged now');

    const queuedAt = ledger[0]?.queuedAt;
    const second = await sendNotice(starterId, changeId, superadminCookie).expect(201);
    expect((second.body as { data: Record<string, unknown> }).data).toMatchObject({
      noticesQueued: 1,
      queuedByThisSend: 0,
    });
    // Sending again must not buy the subscriber's 30 days back.
    const after = await harness.prisma.billingNotice.findMany({ where: { sourceId: changeId } });
    expect(after).toHaveLength(1);
    expect(after[0]?.queuedAt?.toISOString()).toBe(queuedAt?.toISOString());

    const audits = await harness.prisma.platformAuditEvent.findMany({
      where: { eventKey: 'platform.plan_price_notice_sent', targetId: starterId },
    });
    expect(audits).toHaveLength(2);
    expect(audits[0]?.after).toMatchObject({
      noticeDays: 30,
      subscribersToReprice: 1,
      noticesQueued: 1,
      queuedByThisSend: 1,
      withoutDeliverableAddress: 0,
    });

    // A reduction owes no notice, and the endpoint says so rather than sending one. It needs its
    // own plan: `codelessId` has no Paystack code, so a proposal against it is refused anyway, and
    // Starter already carries this test's draft.
    const scale = await planWithOpeningPrice({
      key: 'scale_monthly',
      tierKey: 'scale',
      name: 'Scale',
      status: 'ACTIVE',
      priceMinor: 500n,
      currency: 'USD',
      billingInterval: 'MONTHLY',
      billingProvider: 'PAYSTACK',
      providerPriceId: 'PLN_scale',
    });
    const reduction = await propose(scale.id, superadminCookie, {
      priceMinor: '400',
      reason,
    }).expect(201);
    const reductionId = (reduction.body as { data: { id: string } }).data.id;
    const refused = await sendNotice(scale.id, reductionId, superadminCookie).expect(400);
    expect(JSON.stringify(refused.body)).toContain('Only a price increase requires notice');
    // And its preview carries no notice obligation at all.
    expect((await previewOf(scale.id, reductionId)).notice).toBeNull();
  });

  it('publishes the increase once every subscriber has had 30 days, repricing at Paystack', async () => {
    exercisePausedNoticeRules();
    const proposal = await propose(starterId, superadminCookie, {
      priceMinor: '120',
      reason,
    }).expect(201);
    const changeId = (proposal.body as { data: { id: string } }).data.id;
    await sendNotice(starterId, changeId, superadminCookie).expect(201);

    // One day short: still refused, and Paystack is not contacted.
    await ageNotices(changeId, 29);
    const early = stubPaystack({ remoteAmount: 120 });
    const tooEarly = await publish(starterId, changeId, superadminCookie).expect(400);
    expect(JSON.stringify(tooEarly.body)).toContain('still inside the 30-day notice period');
    expect(early.fetchMock).not.toHaveBeenCalled();
    expect(await priceOf(starterId)).toBe(100n);
    vi.unstubAllGlobals();

    await ageNotices(changeId, 31);
    expect((await previewOf(starterId, changeId)).notice).toMatchObject({
      awaitingNotice: 0,
      withinNoticePeriod: 0,
      publishable: true,
    });

    const { calls } = stubPaystack({ remoteAmount: 120 });
    const published = await publish(starterId, changeId, superadminCookie).expect(201);
    expect((published.body as { data: Record<string, unknown> }).data).toMatchObject({
      priceMinor: '120',
      repricedExistingSubscriptions: true,
      subscribersNotified: 1,
    });
    expect(await priceOf(starterId)).toBe(120n);

    // The repricing flag is stated explicitly, and as `true`, because a notified subscriber is
    // meant to be repriced at their next renewal.
    const update = calls.find((call) => call.method === 'PUT');
    expect((update?.body as { update_existing_subscriptions?: unknown })?.update_existing_subscriptions).toBe(true);

    const audit = await harness.prisma.platformAuditEvent.findFirst({
      where: { eventKey: 'platform.plan_price_published', targetId: starterId },
    });
    expect(audit?.after).toMatchObject({
      repriceExistingSubscriptions: true,
      noticeDays: 30,
      subscribersNotified: 1,
    });
  });

  it('re-refuses publication when a new subscriber joins after the notice went out', async () => {
    exercisePausedNoticeRules();
    const proposal = await propose(starterId, superadminCookie, {
      priceMinor: '120',
      reason,
    }).expect(201);
    const changeId = (proposal.body as { data: { id: string } }).data.id;
    await sendNotice(starterId, changeId, superadminCookie).expect(201);
    await ageNotices(changeId, 31);

    const latecomer = await harness.prisma.organization.create({
      data: {
        legalName: 'Pricing Latecomer Ltd',
        slug: 'pricing-latecomer',
        countryCode: 'KE',
        baseCurrency: 'KES',
        timeZone: 'Africa/Nairobi',
        locale: 'en-KE',
        status: 'ACTIVE',
        createdByUserId: (
          await harness.prisma.user.findFirstOrThrow({
            where: { email: 'pricing-owner@example.test' },
          })
        ).id,
      },
    });
    await harness.prisma.organizationSubscription.create({
      data: { organizationId: latecomer.id, planId: starterId, status: 'ACTIVE' },
    });

    const { fetchMock } = stubPaystack({ remoteAmount: 120 });
    const refused = await publish(starterId, changeId, superadminCookie).expect(400);
    expect(JSON.stringify(refused.body)).toContain('1 of 2 subscribers');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await priceOf(starterId)).toBe(100n);

    // This organization has no billing profile and no owner member, so it cannot be notified at
    // all. The send reports that rather than appearing to have succeeded, and publication stays
    // refused.
    const topUp = await sendNotice(starterId, changeId, superadminCookie).expect(201);
    expect((topUp.body as { data: Record<string, unknown> }).data).toMatchObject({
      subscribersToReprice: 2,
      noticesQueued: 1,
      queuedByThisSend: 0,
      awaitingNotice: 1,
      failedToQueue: 0,
      withoutDeliverableAddress: 1,
      publishable: false,
    });
    await publish(starterId, changeId, superadminCookie).expect(400);
    expect(await priceOf(starterId)).toBe(100n);
  });

  it('publishes an increase on a plan nobody is subscribed to without repricing anybody', async () => {
    exercisePausedNoticeRules();
    await harness.prisma.organizationSubscription.deleteMany({ where: { planId: starterId } });
    const proposal = await propose(starterId, superadminCookie, {
      priceMinor: '120',
      reason,
    }).expect(201);
    const changeId = (proposal.body as { data: { id: string } }).data.id;
    expect((await previewOf(starterId, changeId)).notice).toMatchObject({
      subscribersToReprice: 0,
      awaitingNotice: 0,
      publishable: true,
    });

    const { calls } = stubPaystack({ remoteAmount: 120 });
    const published = await publish(starterId, changeId, superadminCookie).expect(201);
    expect((published.body as { data: Record<string, unknown> }).data).toMatchObject({
      priceMinor: '120',
      repricedExistingSubscriptions: false,
    });
    expect(await priceOf(starterId)).toBe(120n);
    // The dormant path states its provider flag explicitly; the public guard above must stay
    // enabled until in-flight checkouts are coordinated with publication.
    const update = calls.find((call) => call.method === 'PUT');
    expect((update?.body as { update_existing_subscriptions?: unknown })?.update_existing_subscriptions).toBe(false);
    expect(await harness.prisma.billingNotice.count({ where: { sourceId: changeId } })).toBe(0);
  });

  it('keeps the notice endpoint behind a superadmin', async () => {
    const proposal = await propose(starterId, superadminCookie, {
      priceMinor: '120',
      reason,
    }).expect(201);
    const changeId = (proposal.body as { data: { id: string } }).data.id;
    await sendNotice(starterId, changeId, operationsCookie).expect(403);
    expect(await harness.prisma.billingNotice.count({ where: { sourceId: changeId } })).toBe(0);
  });

  it('pauses both zero-subscriber increases and notice sending without contacting Paystack', async () => {
    await harness.prisma.organizationSubscription.deleteMany({ where: { planId: starterId } });
    const proposal = await propose(starterId, superadminCookie, {
      priceMinor: '120', reason,
    }).expect(201);
    const changeId = (proposal.body as { data: { id: string } }).data.id;
    const { fetchMock } = stubPaystack({ remoteAmount: 120 });
    expect((await previewOf(starterId, changeId)).notice).toMatchObject({
      subscribersToReprice: 0,
      publishable: false,
    });
    const refusedNotice = await sendNotice(starterId, changeId, superadminCookie).expect(409);
    expect(JSON.stringify(refusedNotice.body)).toContain('temporarily paused');
    const refusedPublish = await publish(starterId, changeId, superadminCookie).expect(409);
    expect(JSON.stringify(refusedPublish.body)).toContain('temporarily paused');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await priceOf(starterId)).toBe(100n);
    expect(await harness.prisma.billingNotice.count({ where: { sourceId: changeId } })).toBe(0);
  });

  it('refuses a monthly reduction that would make the yearly price more than twelve months', async () => {
    await planWithOpeningPrice({
      key: 'starter_yearly',
      tierKey: 'starter',
      name: 'Starter',
      status: 'ACTIVE',
      priceMinor: 1000n,
      currency: 'USD',
      billingInterval: 'YEARLY',
      billingProvider: 'PAYSTACK',
      providerPriceId: 'PLN_starter_yearly',
    });
    const proposal = await propose(starterId, superadminCookie, {
      priceMinor: '80',
      reason,
    }).expect(201);
    const changeId = (proposal.body as { data: { id: string } }).data.id;
    const { fetchMock } = stubPaystack({ remoteAmount: 80 });
    const response = await publish(starterId, changeId, superadminCookie).expect(400);
    expect(JSON.stringify(response.body)).toContain('yearly price cannot exceed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await priceOf(starterId)).toBe(100n);
  });

  it('refuses to publish a change the plan has moved past, and records a discard', async () => {
    const proposal = await propose(starterId, superadminCookie, {
      priceMinor: '120',
      reason,
    }).expect(201);
    const changeId = (proposal.body as { data: { id: string } }).data.id;

    // The plan is repriced by another route after this change was proposed.
    await harness.prisma.plan.update({ where: { id: starterId }, data: { priceMinor: 110n } });
    const preview = await harness
      .http()
      .get(`${API}/platform/plans/${starterId}/price-changes/${changeId}/preview`)
      .set('Cookie', superadminCookie)
      .expect(200);
    expect((preview.body as { data: { stale: boolean } }).data.stale).toBe(true);

    const { fetchMock } = stubPaystack({ remoteAmount: 120 });
    await publish(starterId, changeId, superadminCookie).expect(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await priceOf(starterId)).toBe(110n);

    await harness
      .http()
      .post(`${API}/platform/plans/${starterId}/price-changes/${changeId}/discard`)
      .set('Cookie', superadminCookie)
      .send({ reason: 'Superseded by a correction made elsewhere.' })
      .expect(201);
    const discarded = await harness.prisma.planPriceChange.findUniqueOrThrow({
      where: { id: changeId },
    });
    expect(discarded.status).toBe('DISCARDED');
    expect(
      await harness.prisma.platformAuditEvent.count({
        where: { eventKey: 'platform.plan_price_change_discarded' },
      }),
    ).toBe(1);
  });

  it('reports price history and any pending change, readable by support', async () => {
    const proposal = await propose(starterId, superadminCookie, {
      priceMinor: '80',
      reason,
    }).expect(201);
    const changeId = (proposal.body as { data: { id: string } }).data.id;
    stubPaystack({ remoteAmount: 80 });
    await publish(starterId, changeId, superadminCookie).expect(201);

    await propose(starterId, superadminCookie, {
      priceMinor: '70',
      reason: 'Second review, not yet published.',
    }).expect(201);

    const response = await harness
      .http()
      .get(`${API}/platform/plans/${starterId}/pricing`)
      .set('Cookie', operationsCookie)
      .expect(200);
    const { data } = response.body as {
      data: {
        plan: { priceMinor: string; subscriberCount: number };
        history: { priceMinor: string; reason: string | null; publishedBy: string | null }[];
        pending: { toPriceMinor: string; proposedBy: string } | null;
      };
    };
    expect(data.plan.priceMinor).toBe('80');
    expect(data.plan.subscriberCount).toBe(2);
    expect(data.history.map((row) => row.priceMinor)).toEqual(['80', '100']);
    expect(data.history[0]).toMatchObject({
      reason,
      publishedBy: 'pricing-superadmin@example.test',
    });
    // The opening row predates console pricing and names nobody, rather than inventing an author.
    expect(data.history[1]).toMatchObject({ reason: null, publishedBy: null });
    expect(data.pending).toMatchObject({
      toPriceMinor: '70',
      proposedBy: 'pricing-superadmin@example.test',
    });
    expect(organizationId).toEqual(expect.any(String));
  });

  /**
   * A plan plus the opening price-history row it would carry in production, where the row comes
   * either from the phase 7 migration (for plans that already existed) or from `createPlan` (for
   * any plan made since). Seeding it here keeps the fixture honest about that.
   */
  it('gives a plan created in the console its own opening price-history row', async () => {
    const created = await harness
      .http()
      .post(`${API}/platform/plans`)
      .set('Cookie', superadminCookie)
      .send({
        key: 'advanced_monthly',
        tierKey: 'advanced',
        name: 'Advanced',
        priceMinor: '2000',
        currency: 'USD',
        billingInterval: 'MONTHLY',
        billingProvider: 'PAYSTACK',
      })
      .expect(201);
    const planId = (created.body as { data: { id: string } }).data.id;
    const history = await harness.prisma.planPriceHistory.findMany({
      where: { planId },
      select: { priceMinor: true, priceChangeId: true },
    });
    // Without this the plan's history would begin at its first change rather than at what it
    // launched with, and an old charge would be unexplainable.
    expect(history).toEqual([{ priceMinor: 2000n, priceChangeId: null }]);
  });

  async function planWithOpeningPrice(data: {
    key: string;
    tierKey: string;
    name: string;
    status: 'ACTIVE' | 'RETIRED' | 'DRAFT';
    priceMinor: bigint;
    currency: string;
    billingInterval: 'MONTHLY' | 'YEARLY';
    billingProvider?: 'PAYSTACK';
    providerPriceId?: string;
  }) {
    await harness.prisma.planTier.upsert({ where: { key: data.tierKey },
      update: {}, create: { key: data.tierKey, name: data.name, status: 'ACTIVE' } });
    const plan = await harness.prisma.plan.create({ data });
    await harness.prisma.planPriceHistory.create({
      data: {
        planId: plan.id,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        billingInterval: plan.billingInterval,
        effectiveFrom: plan.createdAt,
      },
    });
    return plan;
  }

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
