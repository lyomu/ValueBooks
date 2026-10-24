import { describe, expect, it } from 'vitest';

import {
  describeOrganizationPlan,
  OFFICIAL_PLAN_CATALOG,
  OFFICIAL_PLAN_TIERS,
  officialYearlySavingsPercent,
} from './index';

describe('official plan catalog', () => {
  it('rounds the public yearly savings to the approved badges', () => {
    expect(
      OFFICIAL_PLAN_TIERS.map((tier) => officialYearlySavingsPercent(OFFICIAL_PLAN_CATALOG[tier])),
    ).toEqual([17, 8, 17, 8]);
  });

  it('marks exactly one most-popular tier: Professional', () => {
    expect(OFFICIAL_PLAN_TIERS.filter((tier) => OFFICIAL_PLAN_CATALOG[tier].mostPopular)).toEqual([
      'professional',
    ]);
  });
});

describe('describeOrganizationPlan', () => {
  const base = { planName: 'Growth', planStatus: 'ACTIVE' as const };

  it('never renders a bare dash', () => {
    expect(
      describeOrganizationPlan({ planName: null, planStatus: null, subscriptionStatus: null }),
    ).toEqual({
      label: 'Not subscribed',
      tone: 'neutral',
    });
  });

  it('names trial access and unpaid expiry explicitly', () => {
    expect(
      describeOrganizationPlan({
        ...base,
        planName: 'Professional',
        subscriptionStatus: 'TRIALING',
      }).label,
    ).toBe('Trial (Professional access)');
    expect(describeOrganizationPlan({ ...base, subscriptionStatus: 'TRIAL_EXPIRED' }).label).toBe(
      'Trial expired — unpaid',
    );
  });

  it('flags organizations on retired tiers for review', () => {
    expect(
      describeOrganizationPlan({
        planName: 'Scale',
        planStatus: 'RETIRED',
        subscriptionStatus: 'ACTIVE',
      }),
    ).toEqual({ label: 'Legacy — review (Scale)', tone: 'warning' });
  });

  it('shows the paid plan with its collection state', () => {
    expect(describeOrganizationPlan({ ...base, subscriptionStatus: 'ACTIVE' })).toEqual({
      label: 'Growth',
      tone: 'success',
    });
    expect(describeOrganizationPlan({ ...base, subscriptionStatus: 'PAST_DUE' }).tone).toBe(
      'danger',
    );
  });

  it('never presents complimentary access as a paid plan', () => {
    expect(
      describeOrganizationPlan({ ...base, subscriptionStatus: 'ACTIVE', complimentary: true }),
    ).toEqual({ label: 'Growth · Complimentary', tone: 'info' });
  });
});
