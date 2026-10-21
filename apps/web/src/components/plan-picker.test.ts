import { describe, expect, it } from 'vitest';

import { formatPlanPrice, groupPlans, type CatalogPlan } from './plan-picker';

const row = (
  tierKey: string,
  billingInterval: CatalogPlan['billingInterval'],
  priceMinor: string,
): CatalogPlan => ({
  key: `${tierKey}_${billingInterval === 'MONTHLY' ? 'monthly' : 'yearly'}`,
  tierKey,
  name: tierKey,
  description: `${tierKey} from the API`,
  priceMinor,
  currency: 'USD',
  billingInterval,
  checkoutAvailable: true,
});

describe('groupPlans', () => {
  it('groups monthly and yearly rows into one tier, in the marketing order', () => {
    const tiers = groupPlans([
      row('advanced', 'MONTHLY', '2000'),
      row('starter', 'YEARLY', '1000'),
      row('starter', 'MONTHLY', '100'),
      row('professional', 'MONTHLY', '999'),
    ]);

    expect(tiers.map((tier) => tier.tierKey)).toEqual(['starter', 'professional', 'advanced']);
    const [starter, professional] = tiers;
    expect(starter?.prices.MONTHLY?.key).toBe('starter_monthly');
    expect(starter?.prices.YEARLY?.key).toBe('starter_yearly');
    expect(professional).toMatchObject({ name: 'Professional', highlighted: true });
    expect(professional?.features.length).toBeGreaterThan(0);
  });

  it('falls back to API copy for a tier the marketing data does not know', () => {
    const [tier] = groupPlans([row('enterprise', 'MONTHLY', '5000')]);
    expect(tier).toMatchObject({ name: 'enterprise', tagline: 'enterprise from the API', features: [] });
  });
});

describe('formatPlanPrice', () => {
  it('shows cents only when the price has them', () => {
    expect(formatPlanPrice('499', 'USD')).toMatch(/4\.99/);
    expect(formatPlanPrice('2000', 'USD')).toMatch(/20(?!\.)/);
  });
});
