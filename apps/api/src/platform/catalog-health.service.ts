import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { OFFICIAL_ENTITLEMENT_KEYS, OFFICIAL_FEATURE_KEYS, OFFICIAL_PLAN_CATALOG } from '@valuebooks/contracts';

import { PrismaService } from '../database/prisma.service.js';

export type CatalogViolation = { code: string; subject: string; detail: string; category: 'INVARIANT' | 'LAUNCH_ENTITLEMENT_DRIFT' };

type CatalogPlan = {
  key: string; tierKey: string; status: string; billingInterval: string; billingProvider: string | null;
  providerPriceId: string | null; priceMinor: bigint; isDefault: boolean;
  entitlements: { key: string; enabled: boolean; limitValue: number | null }[];
};
type CatalogTier = { key: string; status: string; isMostPopular: boolean };

export function evaluateCatalog(tiers: CatalogTier[], plans: CatalogPlan[]): CatalogViolation[] {
  const violations: CatalogViolation[] = [];
  const add = (code: string, subject: string, detail: string, category: CatalogViolation['category'] = 'INVARIANT') =>
    violations.push({ code, subject, detail, category });
  const activeTiers = tiers.filter((tier) => tier.status === 'ACTIVE');
  const activePlans = plans.filter((plan) => plan.status === 'ACTIVE');
  for (const tier of activeTiers) {
    const rows = activePlans.filter((plan) => plan.tierKey === tier.key);
    for (const interval of ['MONTHLY', 'YEARLY']) {
      const count = rows.filter((plan) => plan.billingInterval === interval).length;
      if (count !== 1) add('INTERVAL_COUNT', tier.key, `Expected one active ${interval.toLowerCase()} plan; found ${count}.`);
    }
    const monthly = rows.find((plan) => plan.billingInterval === 'MONTHLY');
    const yearly = rows.find((plan) => plan.billingInterval === 'YEARLY');
    if (monthly && yearly && yearly.priceMinor > monthly.priceMinor * 12n)
      add('YEARLY_PRICE', tier.key, 'Yearly price exceeds twelve monthly payments.');
  }
  const codes = new Map<string, string>();
  for (const plan of activePlans) {
    if (plan.billingProvider !== 'PAYSTACK' || !plan.providerPriceId)
      add('PAYSTACK_CODE', plan.key, 'Active plan needs a Paystack provider and plan code.');
    if (plan.providerPriceId) {
      const holder = codes.get(plan.providerPriceId);
      if (holder) add('DUPLICATE_CODE', plan.key, `Paystack code is also used by ${holder}.`);
      codes.set(plan.providerPriceId, plan.key);
    }
    if (plan.priceMinor <= 0n) add('ZERO_PRICE', plan.key, 'Active plan price must be positive.');
    const values = new Map(plan.entitlements.map((row) => [row.key, row]));
    for (const key of [...OFFICIAL_ENTITLEMENT_KEYS, ...OFFICIAL_FEATURE_KEYS]) {
      const actual = values.get(key);
      if (!actual) { add('MISSING_ENTITLEMENT', plan.key, `${key} is missing.`); continue; }
      const baseline = OFFICIAL_PLAN_CATALOG[plan.tierKey as keyof typeof OFFICIAL_PLAN_CATALOG];
      if (!baseline) continue;
      const expected = key in baseline.limits
        ? { enabled: baseline.limits[key as keyof typeof baseline.limits] !== 0, limitValue: baseline.limits[key as keyof typeof baseline.limits] }
        : { enabled: baseline.features[key as keyof typeof baseline.features], limitValue: null };
      const expectedLimit = expected.enabled ? expected.limitValue : null;
      if (actual.enabled !== expected.enabled || (actual.enabled && actual.limitValue !== expectedLimit))
        add('LAUNCH_ENTITLEMENT_DRIFT', plan.key, `${key} differs from the owner-approved launch entitlement.`, 'LAUNCH_ENTITLEMENT_DRIFT');
    }
  }
  if (activePlans.filter((plan) => plan.isDefault).length > 1)
    add('MULTIPLE_DEFAULTS', 'catalog', 'More than one active plan is the default.');
  if (activeTiers.filter((tier) => tier.isMostPopular).length > 1)
    add('MULTIPLE_POPULAR', 'catalog', 'More than one active tier is most popular.');
  return violations;
}

@Injectable()
export class CatalogHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async violations(options?: { activateTier?: string; planId?: string; priceMinor?: bigint },
    db: PrismaService | Prisma.TransactionClient = this.prisma) {
    const [tiers, plans] = await Promise.all([
      db.planTier.findMany(),
      db.plan.findMany({ include: { entitlements: { select: { key: true, enabled: true, limitValue: true } } } }),
    ]);
    return evaluateCatalog(
      tiers.map((tier) => ({ ...tier, status: tier.key === options?.activateTier ? 'ACTIVE' : tier.status })),
      plans.map((plan) => ({ ...plan, status: plan.id === options?.planId ? 'ACTIVE' : plan.status,
        priceMinor: plan.id === options?.planId && options.priceMinor !== undefined ? options.priceMinor : plan.priceMinor })),
    );
  }

  async assertNoNewViolations(options: { activateTier?: string; planId?: string; priceMinor?: bigint },
    db: PrismaService | Prisma.TransactionClient = this.prisma, baseline?: CatalogViolation[]) {
    const current = baseline ?? await this.violations(undefined, db);
    const proposed = await this.violations(options, db);
    const old = new Set(current.filter((v) => v.category === 'INVARIANT').map((v) => `${v.code}:${v.subject}:${v.detail}`));
    const introduced = proposed.filter((v) => v.category === 'INVARIANT' && !old.has(`${v.code}:${v.subject}:${v.detail}`));
    if (introduced.length) throw new BadRequestException(`Catalog would become invalid: ${introduced.map((v) => `${v.subject}: ${v.detail}`).join(' ')}`);
  }
}
