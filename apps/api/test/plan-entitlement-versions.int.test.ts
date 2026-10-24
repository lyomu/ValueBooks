import { OFFICIAL_ENTITLEMENT_KEYS, OFFICIAL_FEATURE_KEYS } from '@valuebooks/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UsageMeteringService } from '../src/billing/usage-metering.service.js';
import { PlanEntitlementVersionsService } from '../src/platform/plan-entitlement-versions.service.js';
import type { PlatformContext } from '../src/platform/platform-context.js';
import { createTestHarness, type TestHarness } from './support/app.js';

describe('published entitlement versions enforce the sold limit until renewal', () => {
  let harness: TestHarness;
  beforeAll(async () => { harness = await createTestHarness(); await harness.reset(); });
  afterAll(async () => harness.close());

  it('pins a current subscriber until the renewal path clears the pin', async () => {
    const user = await harness.prisma.user.create({ data: { email: 'version-admin@example.test',
      displayName: 'Version Admin', emailVerifiedAt: new Date(), status: 'ACTIVE' } });
    const grant = await harness.prisma.platformAdmin.create({ data: { userId: user.id, role: 'SUPERADMIN' } });
    const actor: PlatformContext = { id: grant.id, userId: user.id, email: user.email,
      displayName: user.displayName, role: 'SUPERADMIN' };
    const organization = await harness.prisma.organization.create({ data: {
      legalName: 'Version Books Ltd', slug: 'version-books', countryCode: 'KE', baseCurrency: 'KES',
      timeZone: 'Africa/Nairobi', locale: 'en-KE', status: 'ACTIVE', createdByUserId: user.id,
    } });
    const plan = await harness.prisma.plan.create({ data: { key: 'version_monthly', tierKey: 'professional',
      name: 'Versioned', status: 'ACTIVE', priceMinor: 1000n, billingInterval: 'MONTHLY' } });
    await harness.prisma.planEntitlement.createMany({ data: [...OFFICIAL_ENTITLEMENT_KEYS, ...OFFICIAL_FEATURE_KEYS]
      .map((key) => ({ planId: plan.id, key, enabled: true, limitValue: key === 'projects.enabled' ? 5 : null })) });
    const periodStart = new Date(Date.UTC(2026, 9, 1));
    const periodEnd = new Date(Date.UTC(2026, 10, 1));
    const subscription = await harness.prisma.organizationSubscription.create({ data: {
      organizationId: organization.id, planId: plan.id, status: 'ACTIVE',
      currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
    } });
    const versions = harness.app.get(PlanEntitlementVersionsService);
    const usage = harness.app.get(UsageMeteringService);
    const draft = await versions.createDraft(actor, plan.id, 'Reduce the next renewal project limit.', null);
    await versions.setDraftValue(actor, plan.id, draft.id,
      { key: 'projects.enabled', enabled: true, limitValue: 2, reason: 'Reduce the next renewal project limit.' }, null);
    const preview = await versions.preview(plan.id, draft.id);
    expect(preview.subscribersToPinAtPublish).toBe(1);
    await versions.publish(actor, plan.id, draft.id, 'Publish the next renewal project limit.', null);
    expect(await usage.resolveLimit(organization.id, 'projects.enabled')).toBe(5);
    expect((await harness.prisma.organizationSubscription.findUniqueOrThrow({ where: { id: subscription.id } })).entitlementVersionId).toBeTruthy();
    // Simulate the subscription state after the separately verified webhook renewal path.
    await harness.prisma.organizationSubscription.update({ where: { id: subscription.id },
      data: { entitlementVersionId: null, currentPeriodStart: periodEnd,
        currentPeriodEnd: new Date(Date.UTC(2026, 11, 1)) } });
    expect(await usage.resolveLimit(organization.id, 'projects.enabled')).toBe(2);
  });
});
