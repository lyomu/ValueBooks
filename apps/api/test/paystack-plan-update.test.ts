import { describe, expect, it, vi } from 'vitest';

import { PaystackBillingAdapter } from '../src/billing/paystack-billing.adapter.js';

describe('Paystack plan update safety', () => {
  it('refuses an omitted subscriber repricing flag before making a request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      const adapter = new PaystackBillingAdapter();
      await expect(adapter.updatePlanAmount({
        planCode: 'PLN_test', amountMinor: 100n, currency: 'USD',
        updateExistingSubscriptions: undefined as unknown as boolean,
      })).rejects.toThrow('explicit subscription repricing choice');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
