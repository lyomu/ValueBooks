import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  OFFICIAL_ENTITLEMENT_KEYS,
  OFFICIAL_PLAN_CATALOG,
  OFFICIAL_PLAN_TIERS,
  OFFICIAL_TRIAL,
  type OfficialEntitlementKey,
  type OfficialPlanTier,
} from '@valuebooks/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UsageMeteringService } from '../src/billing/usage-metering.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import type { PlatformContext } from '../src/platform/platform-context.js';
import { PlatformTenantsService } from '../src/platform/platform-tenants.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';
import { apiRoot, testRuntimeDatabaseUrl } from './support/database.js';

/**
 * The approved commercial matrix (master plan §4.2, owner decisions of 2026-10-22) lives in
 * `@valuebooks/contracts` as `OFFICIAL_PLAN_CATALOG`; this spec proves the migrations produce it,
 * resolved through the real `UsageMeteringService`. `null` = unlimited, `0` = not included.
 */
const KEYS = OFFICIAL_ENTITLEMENT_KEYS;
type Key = OfficialEntitlementKey;
const MATRIX = Object.fromEntries(
  OFFICIAL_PLAN_TIERS.map((tier) => [tier, OFFICIAL_PLAN_CATALOG[tier].limits]),
) as Record<OfficialPlanTier, Record<Key, number | null>>;

/** The trial runs on Professional with a reduced AI allowance (master plan §4.3). */
const TRIAL: Record<Key, number | null> = {
  ...MATRIX[OFFICIAL_TRIAL.tierKey],
  ...OFFICIAL_TRIAL.limitOverrides,
};

/** Every migration that shapes the official catalog's entitlements, in deploy order. */
const CATALOG_MIGRATIONS = [
  '20261014070000_seed_official_plan_catalog',
  '20261014080000_correct_advanced_unlimited_entitlements',
  '20261022090000_correct_professional_unlimited_entitlements',
];

describe('official plan catalog entitlements', () => {
  let harness: TestHarness;
  let usage: UsageMeteringService;
  let organizationId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    await harness.reset();
    usage = harness.app.get(UsageMeteringService);

    // reset() truncates the migration-seeded catalog; replay the catalog migrations verbatim so the
    // assertions cover the SQL production runs, not a hand-built fixture.
    const client = new Client({ connectionString: testRuntimeDatabaseUrl() });
    await client.connect();
    try {
      for (const name of CATALOG_MIGRATIONS) {
        await client.query(
          readFileSync(resolve(apiRoot, 'prisma/migrations', name, 'migration.sql'), 'utf8'),
        );
      }
    } finally {
      await client.end();
    }

    const user = await harness.prisma.user.create({
      data: {
        email: 'entitlements@example.test',
        displayName: 'Entitlements',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const owner = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
    const organizations = harness.app.get(OrganizationService);
    const access = harness.app.get(OrganizationAccessService);
    const metadata = { ipHash: 'plan-entitlements-test', userAgent: 'plan-entitlements-test' };
    const created = await organizations.create(
      owner,
      { legalName: 'Entitlement Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    await organizations.finalize(
      await access.requireMembership(owner.id, created.id),
      owner,
      metadata,
    );
    organizationId = created.id;
  });

  afterAll(async () => harness.close());

  async function resolveAll(): Promise<Record<Key, number | null>> {
    const entries = await Promise.all(
      KEYS.map(async (key) => [key, await usage.resolveLimit(organizationId, key)] as const),
    );
    return Object.fromEntries(entries) as Record<Key, number | null>;
  }

  it('seeds exactly the eight official plans as ACTIVE', async () => {
    const plans = await harness.prisma.plan.findMany({
      where: { status: 'ACTIVE' },
      select: { key: true },
    });
    expect(plans.map((plan) => plan.key).sort()).toEqual([
      'advanced_monthly',
      'advanced_yearly',
      'growth_monthly',
      'growth_yearly',
      'professional_monthly',
      'professional_yearly',
      'starter_monthly',
      'starter_yearly',
    ]);
  });

  it('stores the approved price, currency, interval and provider on every official row', async () => {
    for (const tier of OFFICIAL_PLAN_TIERS) {
      const expected = OFFICIAL_PLAN_CATALOG[tier];
      for (const [interval, priceMinor] of [
        ['MONTHLY', expected.monthlyPriceMinor],
        ['YEARLY', expected.yearlyPriceMinor],
      ] as const) {
        const row = await harness.prisma.plan.findUniqueOrThrow({
          where: { key: `${tier}_${interval.toLowerCase()}` },
        });
        expect({
          tierKey: row.tierKey,
          name: row.name,
          priceMinor: Number(row.priceMinor),
          currency: row.currency,
          billingInterval: row.billingInterval,
          billingProvider: row.billingProvider,
          isMostPopular: row.isMostPopular,
        }).toEqual({
          tierKey: tier,
          name: expected.name,
          priceMinor,
          currency: expected.currency,
          billingInterval: interval,
          billingProvider: 'PAYSTACK',
          isMostPopular: expected.mostPopular,
        });
      }
    }
  });

  it('starts a cardless trial with Professional access and the trial AI allowance', async () => {
    const subscription = await harness.prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId },
      select: {
        status: true,
        startedAt: true,
        trialEndsAt: true,
        plan: { select: { tierKey: true } },
      },
    });
    expect(subscription.status).toBe('TRIALING');
    expect(subscription.plan.tierKey).toBe(OFFICIAL_TRIAL.tierKey);
    expect(subscription.trialEndsAt!.getTime() - subscription.startedAt.getTime()).toBe(
      OFFICIAL_TRIAL.hours * 60 * 60 * 1000,
    );
    expect(await resolveAll()).toEqual(TRIAL);
  });

  for (const tier of OFFICIAL_PLAN_TIERS) {
    for (const interval of ['monthly', 'yearly'] as const) {
      it(`resolves the approved matrix for ${tier}_${interval}`, async () => {
        const plan = await harness.prisma.plan.findUniqueOrThrow({
          where: { key: `${tier}_${interval}` },
        });
        await harness.prisma.organizationSubscription.update({
          where: { organizationId },
          data: { planId: plan.id, status: 'ACTIVE', trialEndsAt: null },
        });
        expect(await resolveAll()).toEqual(MATRIX[tier]);
      });
    }
  }

  describe('platform plan assignment', () => {
    async function actor(): Promise<PlatformContext> {
      const user = await harness.prisma.user.create({
        data: {
          email: 'assign-superadmin@example.test',
          displayName: 'Assigner',
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      });
      const grant = await harness.prisma.platformAdmin.create({
        data: { userId: user.id, role: 'SUPERADMIN' },
      });
      return {
        id: grant.id,
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        role: 'SUPERADMIN',
      };
    }

    it('refuses a retired plan and leaves the subscription untouched', async () => {
      const tenants = harness.app.get(PlatformTenantsService);
      const retired = await harness.prisma.plan.create({
        data: { key: 'scale', tierKey: 'scale', name: 'Scale', status: 'RETIRED', priceMinor: 0n },
      });
      const before = await harness.prisma.organizationSubscription.findUniqueOrThrow({
        where: { organizationId },
      });
      await expect(
        tenants.assignPlan(
          await actor(),
          organizationId,
          { planId: retired.id, reason: 'spec' },
          null,
        ),
      ).rejects.toThrow('Only an active catalog plan can be assigned.');
      const after = await harness.prisma.organizationSubscription.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(after.planId).toBe(before.planId);
    });

    it('applies the 336-hour trial policy to an assigned trial', async () => {
      const tenants = harness.app.get(PlatformTenantsService);
      const plan = await harness.prisma.plan.findUniqueOrThrow({
        where: { key: 'professional_monthly' },
      });
      const started = Date.now();
      const result = await tenants.assignPlan(
        await harness.prisma.platformAdmin
          .findFirstOrThrow({ include: { user: true } })
          .then((grant) => ({
            id: grant.id,
            userId: grant.userId,
            email: grant.user.email,
            displayName: grant.user.displayName,
            role: grant.role,
          })),
        organizationId,
        { planId: plan.id, status: 'TRIALING', reason: 'spec' },
        null,
      );
      const hours = (new Date(result.trialEndsAt!).getTime() - started) / 3_600_000;
      expect(hours).toBeGreaterThanOrEqual(OFFICIAL_TRIAL.hours - 0.01);
      expect(hours).toBeLessThan(OFFICIAL_TRIAL.hours + 0.1);
    });
  });

  it('is idempotent: replaying the Professional correction changes nothing', async () => {
    const before = await harness.prisma.planEntitlement.findMany({
      orderBy: [{ planId: 'asc' }, { key: 'asc' }],
    });
    const client = new Client({ connectionString: testRuntimeDatabaseUrl() });
    await client.connect();
    try {
      const sql = readFileSync(
        resolve(apiRoot, 'prisma/migrations', CATALOG_MIGRATIONS[2]!, 'migration.sql'),
        'utf8',
      );
      const result = await client.query(sql);
      expect(result.rowCount).toBe(0);
    } finally {
      await client.end();
    }
    const after = await harness.prisma.planEntitlement.findMany({
      orderBy: [{ planId: 'asc' }, { key: 'asc' }],
    });
    expect(after).toEqual(before);
  });
});
