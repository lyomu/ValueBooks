'use client';
import { Button } from '@valuebooks/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api';

type Checkout = {
  paymentVerified: boolean;
  checkoutUrl?: string;
  provider: string;
  providerReference: string | null;
  plan: {
    name: string;
    amountMinor: string;
    currency: string;
    billingInterval: string;
    trialDays: number;
  };
};
export function CheckoutClient({ intent }: { intent: string }) {
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void apiRequest<{ data: Checkout }>('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({
        intentId: intent,
        successUrl: `${window.location.origin}/checkout?intent=${encodeURIComponent(intent)}&returned=1`,
        cancelUrl: `${window.location.origin}/checkout?intent=${encodeURIComponent(intent)}`,
      }),
    })
      .then((r) => setCheckout(r.data))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Unable to load checkout.'));
  }, [intent]);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiRequest<{ data: Checkout }>('/billing/checkout/development-confirm', {
        method: 'POST',
        body: JSON.stringify({ intentId: intent }),
      });
      setCheckout(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout could not be confirmed.');
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <div className="rb-auth-error" role="alert">
        {error}
      </div>
    );
  if (!checkout) return <p>Loading secure checkout…</p>;
  if (checkout.paymentVerified)
    return (
      <div className="rb-auth-success">
        <h2>You&apos;re all set!</h2>
        <p>
          Your {checkout.plan.name} subscription is active.{' '}
          {checkout.providerReference ? `Confirmation: ${checkout.providerReference}` : ''}
        </p>
        <Button asChild>
          <Link href="/onboarding">Set up your business</Link>
        </Button>
      </div>
    );
  return (
    <section className="rb-checkout">
      <h2>{checkout.plan.name}</h2>
      <p>
        {checkout.plan.currency} {checkout.plan.amountMinor} ·{' '}
        {checkout.plan.billingInterval.toLowerCase()}
      </p>
      <p className="rb-checkout__notice">Your 14-day trial starts when you finish setting up your organization. No card is required.</p>
      <Button asChild><Link href="/onboarding">Start free trial</Link></Button>
      {checkout.checkoutUrl ? (
        <Button variant="outline" onClick={() => window.location.assign(checkout.checkoutUrl!)}>
          Pay now instead
        </Button>
      ) : checkout.provider === 'development-simulation' ? (
        <Button variant="outline" onClick={() => void confirm()} loading={busy}>
          Confirm development payment
        </Button>
      ) : null}
    </section>
  );
}
