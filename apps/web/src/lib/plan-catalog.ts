import {
  OFFICIAL_PLAN_CATALOG,
  type OfficialPlanTier,
  type PlatformPlan,
} from '@valuebooks/contracts';

/**
 * One entitlement as a customer experiences it. "Not included" may be stored as a disabled row
 * or as a limit of 0; both normalize to `included: false` so the two never read as a difference.
 */
export type Allowance = { included: boolean; limit: number | null };

/** What a plan row actually enforces, or undefined when the row has no such entitlement. */
export function enforcedAllowance(
  plan: Pick<PlatformPlan, 'entitlements'> | undefined,
  key: string,
): Allowance | undefined {
  const row = plan?.entitlements.find((entitlement) => entitlement.key === key);
  if (!row) return undefined;
  const included = row.enabled && row.limitValue !== 0;
  return { included, limit: included ? row.limitValue : null };
}

/** What the approved catalog says, or undefined when the catalog does not sell this key. */
export function approvedAllowance(tier: OfficialPlanTier, key: string): Allowance | undefined {
  const plan = OFFICIAL_PLAN_CATALOG[tier];
  if (key in plan.limits) {
    const limit = plan.limits[key as keyof typeof plan.limits];
    return limit === 0 ? { included: false, limit: null } : { included: true, limit };
  }
  if (key in plan.features) {
    return { included: plan.features[key as keyof typeof plan.features], limit: null };
  }
  return undefined;
}

export function sameAllowance(a: Allowance | undefined, b: Allowance | undefined): boolean {
  return a?.included === b?.included && a?.limit === b?.limit;
}

/** `feature` keys are on/off, so an uncapped one reads "Included" rather than "Unlimited". */
export function describeAllowance(value: Allowance | undefined, feature: boolean): string {
  if (!value) return 'No row';
  if (!value.included) return 'Not included';
  if (value.limit === null) return feature ? 'Included' : 'Unlimited';
  return value.limit.toLocaleString();
}
