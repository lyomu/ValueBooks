import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'billing-enforcement-test', userAgent: 'billing-enforcement-test' };
const DAY = 86_400_000;

type SubscriptionState = {
  status: 'TRIALING' | 'TRIAL_EXPIRED' | 'ACTIVE' | 'PAST_DUE' | 'CANCEL_SCHEDULED' | 'CANCELLED';
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  pastDueSince?: Date | null;
};

/**
 * Two billing boundaries proved over real HTTP: Paystack webhooks are accepted only with a valid
 * signature over the exact bytes sent, and a lapsed subscription makes every tenant write
 * read-only while reads and the billing routes that let the customer pay stay open.
 */
describe('billing enforcement over HTTP', () => {
  let harness: TestHarness;
  let organizationId: string;
  let ownerCookie: string;
  let planId: string;
  const previousKey = process.env.PAYSTACK_SECRET_KEY;
  const secret = 'sk_test_enforcement_spec';

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = previousKey;
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    process.env.PAYSTACK_SECRET_KEY = secret;
    const row = await harness.prisma.user.create({
      data: {
        email: 'enforcement-owner@example.test',
        displayName: 'Enforcement Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const owner: PublicUser = {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      emailVerified: true,
      status: row.status,
    };
    const organizations = harness.app.get(OrganizationService);
    const created = await organizations.create(
      owner,
      { legalName: 'Enforcement Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    await organizations.finalize(
      await harness.app.get(OrganizationAccessService).requireMembership(owner.id, created.id),
      owner,
      metadata,
    );
    organizationId = created.id;
    const plan = await harness.prisma.plan.create({
      data: { key: 'professional_monthly', tierKey: 'professional', name: 'Professional' },
    });
    planId = plan.id;
    const token = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId: owner.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + DAY),
      },
    });
    ownerCookie = `rb_session=${token}`;
  });

  describe('Paystack webhook signatures', () => {
    const body = JSON.stringify({ event: 'subscription.create', data: { id: 77 } });
    const sign = (bytes: string, key = secret) =>
      createHmac('sha512', key).update(bytes).digest('hex');
    const post = (bytes: string, signature?: string) => {
      const request = harness
        .http()
        .post(`${API}/billing/webhooks/paystack`)
        .set('Content-Type', 'application/json');
      return (signature ? request.set('x-paystack-signature', signature) : request).send(bytes);
    };

    it('accepts a correctly signed delivery and records it once, even when redelivered', async () => {
      await post(body, sign(body)).expect(200);
      await post(body, sign(body)).expect(200);
      const events = await harness.prisma.billingWebhookEvent.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: 'subscription.create',
        signatureVerified: true,
        processingState: 'PROCESSED',
        // A redelivery of an already-processed event is answered before anything is written.
        retryCount: 0,
      });
    });

    it('rejects a missing, forged or tampered signature and records nothing', async () => {
      await post(body).expect(401);
      await post(body, sign(body, 'sk_test_someone_else')).expect(401);
      // Valid signature, different bytes: the signature covers the exact payload sent.
      const tampered = body.replace('77', '78');
      await post(tampered, sign(body)).expect(401);
      expect(await harness.prisma.billingWebhookEvent.count()).toBe(0);
    });
  });

  describe('read-only after a subscription lapses', () => {
    const now = Date.now();
    const cases: Array<[string, SubscriptionState, boolean]> = [
      ['a running trial', { status: 'TRIALING', trialEndsAt: new Date(now + DAY) }, false],
      ['an expired trial', { status: 'TRIAL_EXPIRED', trialEndsAt: new Date(now - DAY) }, true],
      [
        'a trial past its end before the expiry job runs',
        { status: 'TRIALING', trialEndsAt: new Date(now - 60_000) },
        true,
      ],
      [
        'an active paid plan',
        { status: 'ACTIVE', currentPeriodEnd: new Date(now + 20 * DAY) },
        false,
      ],
      [
        'past due within the grace period',
        { status: 'PAST_DUE', pastDueSince: new Date(now - DAY) },
        false,
      ],
      [
        'past due beyond the grace period',
        { status: 'PAST_DUE', pastDueSince: new Date(now - 10 * DAY) },
        true,
      ],
      [
        'a cancellation whose paid term has ended',
        { status: 'CANCEL_SCHEDULED', currentPeriodEnd: new Date(now - DAY) },
        true,
      ],
      ['a cancelled plan', { status: 'CANCELLED' }, true],
    ];

    it.each(cases)('%s', async (_label, state, readOnly) => {
      await setSubscription(state);

      // Reads never stop: records stay visible whatever the subscription state.
      await harness
        .http()
        .get(`${API}/organizations/${organizationId}/roles`)
        .set('Cookie', ownerCookie)
        .expect(200);

      // An empty body fails validation (400) once past the guard, so a 403 can only be the
      // read-only boundary, and nothing is written either way.
      const write = await harness
        .http()
        .post(`${API}/organizations/${organizationId}/roles`)
        .set('Cookie', ownerCookie)
        .send({});
      if (readOnly) {
        expect(write.status).toBe(403);
        expect((write.body as { error: { code: string } }).error.code).toBe(
          'SUBSCRIPTION_READ_ONLY',
        );
      } else {
        expect(write.status).toBe(400);
      }

      // Billing stays reachable, so a lapsed customer can still choose a plan and pay.
      const billing = await harness
        .http()
        .post(`${API}/organizations/${organizationId}/billing/checkout`)
        .set('Cookie', ownerCookie)
        .send({});
      expect((billing.body as { error?: { code?: string } }).error?.code).not.toBe(
        'SUBSCRIPTION_READ_ONLY',
      );
    });
  });

  async function setSubscription(state: SubscriptionState) {
    const data = {
      planId,
      status: state.status,
      trialEndsAt: state.trialEndsAt ?? null,
      currentPeriodEnd: state.currentPeriodEnd ?? null,
      pastDueSince: state.pastDueSince ?? null,
    };
    await harness.prisma.organizationSubscription.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }
});
