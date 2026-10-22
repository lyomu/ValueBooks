import { BadGatewayException } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  PaystackBillingAdapter,
  paystackPlanMismatches,
} from '../src/billing/paystack-billing.adapter.js';

/**
 * Paystack charges what its plan says, not what ValueBooks sends, so checkout must stop whenever
 * the remote plan disagrees with the catalog row. The console's plan-code change uses the same
 * comparison. Paystack is stubbed at `fetch`.
 */
const plan = {
  providerPriceId: 'PLN_starter',
  priceMinor: 100n,
  currency: 'USD',
  billingInterval: 'MONTHLY' as const,
};
const matching = { plan_code: 'PLN_starter', amount: 100, currency: 'USD', interval: 'monthly' };

describe('Paystack plan verification', () => {
  const previousKey = process.env.PAYSTACK_SECRET_KEY;
  beforeAll(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
  });
  afterAll(() => {
    if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = previousKey;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports every field that disagrees, and nothing when the plan matches', () => {
    expect(paystackPlanMismatches(matching, plan)).toEqual([]);
    expect(
      paystackPlanMismatches(
        { plan_code: 'PLN_other', amount: 1000, currency: 'NGN', interval: 'annually' },
        plan,
      ),
    ).toEqual([
      'plan code',
      'amount (Paystack 1000, catalog 100)',
      'currency (Paystack NGN, catalog USD)',
      'interval (Paystack annually, catalog monthly)',
    ]);
    expect(
      paystackPlanMismatches(
        { ...matching, interval: 'annually' },
        { ...plan, billingInterval: 'YEARLY' },
      ),
    ).toEqual([]);
  });

  it('stops checkout before initializing a charge when the remote price differs', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { ...matching, amount: 999 } }), { status: 200 }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new PaystackBillingAdapter().createCheckout(checkoutInput()),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('initializes the transaction with the plan code when the remote plan matches', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('/plan/')
              ? { data: matching }
              : { data: { authorization_url: 'https://checkout.test/x', reference: 'ref_1' } },
          ),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await new PaystackBillingAdapter().createCheckout(checkoutInput());
    expect(result).toEqual({ checkoutUrl: 'https://checkout.test/x', providerCheckoutId: 'ref_1' });
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ plan: 'PLN_starter', amount: 100 });
  });
});

function checkoutInput() {
  return {
    plan,
    customerEmail: 'owner@example.test',
    successUrl: 'https://app.test/billing',
    clientReference: 'client-ref',
    organizationId: '00000000-0000-0000-0000-000000000001',
  } as unknown as Parameters<PaystackBillingAdapter['createCheckout']>[0];
}
