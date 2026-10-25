import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyLivePrices, fetchLivePlans } from './live-prices';

afterEach(() => vi.unstubAllGlobals());

describe('public pricing catalog', () => {
  it('does not display compiled prices when the live catalog is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('catalog unavailable'))));
    expect(await fetchLivePlans()).toBeNull();
  });

  it('uses the current pair of prices and recomputes annual savings', () => {
    const entitlements = [{ key: 'customers.active.max', enabled: true, limitValue: 10 }];
    const common = { tierKey: 'starter', name: 'Starter', tagline: null, highlights: [],
      entitlements, currency: 'USD', isMostPopular: false };
    const plans = applyLivePrices([
      { ...common, priceMinor: '200', billingInterval: 'MONTHLY' },
      { ...common, priceMinor: '1800', billingInterval: 'YEARLY' },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ monthlyPriceUsd: 2, yearlyPriceUsd: 18,
      yearlySavingsPercent: 25 });
  });
});
