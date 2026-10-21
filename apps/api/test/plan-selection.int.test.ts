import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'a'.repeat(64), userAgent: 'plan-selection-spec' };

describe('in-app plan selection before onboarding', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let growthMonthlyId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    await harness.reset();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    // reset() truncates the migration-seeded catalog, so the spec seeds the two rows it needs:
    // the plan a user picks, and the Professional plan every cardless trial runs on.
    const plans = [
      { key: 'growth_monthly', tierKey: 'growth', name: 'Growth', priceMinor: 499n },
      { key: 'professional_monthly', tierKey: 'professional', name: 'Professional', priceMinor: 999n },
      { key: 'growth_yearly', tierKey: 'growth', name: 'Growth', priceMinor: 5500n },
    ];
    for (const plan of plans) {
      const row = await harness.prisma.plan.create({
        data: {
          ...plan,
          status: 'ACTIVE',
          trialDays: 14,
          billingInterval: plan.key.endsWith('yearly') ? 'YEARLY' : 'MONTHLY',
        },
      });
      if (plan.key === 'growth_monthly') growthMonthlyId = row.id;
    }
  });

  afterAll(async () => {
    await harness.close();
  });

  async function signedInUser(): Promise<{ user: PublicUser; cookie: string }> {
    const created = await harness.prisma.user.create({
      data: {
        email: `plan-${randomUUID()}@example.com`,
        displayName: 'Plan Picker',
        emailVerifiedAt: new Date(),
        profileCompletedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const rawToken = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId: created.id,
        tokenHash: hashToken(rawToken),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return {
      user: {
        id: created.id,
        email: created.email,
        displayName: created.displayName,
        emailVerified: true,
        status: created.status,
      },
      cookie: `rb_session=${rawToken}`,
    };
  }

  it('requires a session for both routes', async () => {
    await harness
      .http()
      .post(`${API}/billing/registration-intents/mine`)
      .send({ planKey: 'growth_monthly' })
      .expect(401);
    await harness.http().get(`${API}/billing/registration-intents/mine`).expect(401);
  });

  it('rejects a plan that does not exist', async () => {
    const { cookie } = await signedInUser();
    await harness
      .http()
      .post(`${API}/billing/registration-intents/mine`)
      .set('Cookie', cookie)
      .send({ planKey: 'nope_monthly' })
      .expect(404);
  });

  it('binds the choice to the session user and keeps only the newest one open', async () => {
    const { user, cookie } = await signedInUser();
    await harness
      .http()
      .get(`${API}/billing/registration-intents/mine`)
      .set('Cookie', cookie)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ data: null }));

    const first = await harness
      .http()
      .post(`${API}/billing/registration-intents/mine`)
      .set('Cookie', cookie)
      .send({ planKey: 'growth_yearly' })
      .expect(201);
    const second = await harness
      .http()
      .post(`${API}/billing/registration-intents/mine`)
      .set('Cookie', cookie)
      .send({ planKey: 'growth_monthly' })
      .expect(201);

    const firstId = (first.body as { data: { id: string } }).data.id;
    const secondId = (second.body as { data: { id: string } }).data.id;
    const rows = await harness.prisma.registrationIntent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((row) => [row.id, row.email, row.consumedAt !== null])).toEqual([
      [firstId, user.email, true],
      [secondId, user.email, false],
    ]);

    await harness
      .http()
      .get(`${API}/billing/registration-intents/mine`)
      .set('Cookie', cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          data: { id: secondId, plan: { key: 'growth_monthly', tierKey: 'growth' } },
        }),
      );
  });

  it('starts the Professional trial with the chosen plan as the intended plan on finalization', async () => {
    const { user, cookie } = await signedInUser();
    await harness
      .http()
      .post(`${API}/billing/registration-intents/mine`)
      .set('Cookie', cookie)
      .send({ planKey: 'growth_monthly' })
      .expect(201);

    const created = await organizations.create(
      user,
      { legalName: 'Plan Picker Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const context = await access.requireMembership(user.id, created.id);
    await organizations.finalize(context, user, metadata);

    const subscription = await harness.prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: created.id },
      include: { plan: true },
    });
    expect(subscription.status).toBe('TRIALING');
    expect(subscription.plan.tierKey).toBe('professional');
    expect(subscription.intendedPlanId).toBe(growthMonthlyId);

    await harness
      .http()
      .get(`${API}/billing/registration-intents/mine`)
      .set('Cookie', cookie)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ data: null }));
  });
});
