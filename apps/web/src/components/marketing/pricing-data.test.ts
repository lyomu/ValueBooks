import { describe, expect, it } from 'vitest';

import { FEATURE_GROUPS, PLANS } from './pricing-data';

describe('marketing pricing data', () => {
  it('advertises the approved four-plan catalog prices and savings', () => {
    expect(
      PLANS.map(({ id, monthlyPriceUsd, yearlyPriceUsd, yearlySavingsPercent, highlighted }) => ({
        id,
        monthlyPriceUsd,
        yearlyPriceUsd,
        yearlySavingsPercent,
        highlighted,
      })),
    ).toEqual([
      {
        id: 'starter',
        monthlyPriceUsd: 1,
        yearlyPriceUsd: 10,
        yearlySavingsPercent: 17,
        highlighted: false,
      },
      {
        id: 'growth',
        monthlyPriceUsd: 4.99,
        yearlyPriceUsd: 55,
        yearlySavingsPercent: 8,
        highlighted: false,
      },
      {
        id: 'professional',
        monthlyPriceUsd: 9.99,
        yearlyPriceUsd: 100,
        yearlySavingsPercent: 17,
        highlighted: true,
      },
      {
        id: 'advanced',
        monthlyPriceUsd: 20,
        yearlyPriceUsd: 220,
        yearlySavingsPercent: 8,
        highlighted: false,
      },
    ]);
  });

  it('shows the enforced monthly invoice caps rather than "Unlimited" on every tier', () => {
    const row = FEATURE_GROUPS.flatMap((group) => group.rows).find(
      (candidate) => candidate.label === 'Invoices issued per month',
    );
    expect(row?.values).toEqual({
      starter: '5',
      growth: '20',
      professional: '100',
      advanced: 'Unlimited',
    });
  });

  it('derives the quantitative top-feature copy from the catalog', () => {
    expect(PLANS[0]?.topFeatures.slice(0, 2)).toEqual(['1 user', '10 customers, 5 invoices/mo']);
    expect(PLANS[3]?.topFeatures[0]).toBe('10 users');
  });
});
