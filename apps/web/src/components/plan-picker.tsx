'use client';

import { Badge, Button, Skeleton } from '@valuebooks/ui';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, organizationDisplayName, useWorkspace } from '../lib/workspace';
import { BrandLogo } from './brand-logo';
import { PLANS } from './marketing/pricing-data';

export type BillingInterval = 'MONTHLY' | 'YEARLY';

export type CatalogPlan = {
  key: string;
  tierKey: string;
  name: string;
  description: string;
  priceMinor: string;
  currency: string;
  billingInterval: BillingInterval;
  checkoutAvailable: boolean;
};

export type PlanTier = {
  tierKey: string;
  name: string;
  tagline: string;
  features: string[];
  highlighted: boolean;
  prices: Partial<Record<BillingInterval, CatalogPlan>>;
};

type BillingSummary = {
  subscription: null | {
    status: string;
    trialEndsAt: string | null;
    intendedPlan: { key: string; name: string; billingInterval: string } | null;
  };
};

const MAX_YEARLY_SAVINGS = Math.max(...PLANS.map((plan) => plan.yearlySavingsPercent));

/** Groups the catalog's per-interval rows into display tiers, in the marketing page's order. */
export function groupPlans(catalog: CatalogPlan[]): PlanTier[] {
  const byTier = new Map<string, PlanTier>();
  for (const row of catalog) {
    const copy = PLANS.find((plan) => plan.id === row.tierKey);
    const tier = byTier.get(row.tierKey) ?? {
      tierKey: row.tierKey,
      name: copy?.name ?? row.name,
      tagline: copy?.tagline ?? row.description,
      features: copy?.topFeatures ?? [],
      highlighted: Boolean(copy?.highlighted),
      prices: {},
    };
    tier.prices[row.billingInterval] = row;
    byTier.set(row.tierKey, tier);
  }
  const order = (key: string) => {
    const index = PLANS.findIndex((plan) => plan.id === key);
    return index === -1 ? PLANS.length : index;
  };
  return [...byTier.values()].sort((a, b) => order(a.tierKey) - order(b.tierKey));
}

export function formatPlanPrice(priceMinor: string, currency: string): string {
  const minor = Number(priceMinor);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

function trialExpired(subscription: BillingSummary['subscription']): boolean {
  if (!subscription) return false;
  if (subscription.status === 'TRIAL_EXPIRED') return true;
  return (
    subscription.status === 'TRIALING' &&
    Boolean(subscription.trialEndsAt) &&
    new Date(subscription.trialEndsAt as string).getTime() <= Date.now()
  );
}

/**
 * Full-page plan chooser. `signup` records the plan for the cardless trial before organization
 * setup; `upgrade` sends an existing organization to secure checkout (e.g. once the trial ends).
 */
export function PlanPicker({ mode }: { mode: 'signup' | 'upgrade' }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: mode === 'upgrade' });
  const organization = workspace.activeOrganization;
  const [tiers, setTiers] = useState<PlanTier[] | null>(null);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [interval, setInterval] = useState<BillingInterval>('MONTHLY');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ data: CatalogPlan[] }>('/billing/plans')
      .then((response) => {
        if (!cancelled) setTiers(groupPlans(response.data));
      })
      .catch(() => {
        if (!cancelled) setError('Plans could not be loaded. Refresh to try again.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'upgrade' || !organization?.id) return;
    let cancelled = false;
    apiRequest<{ data: BillingSummary }>(`/organizations/${organization.id}/billing`)
      .then((response) => {
        if (cancelled) return;
        setSummary(response.data);
        if (response.data.subscription?.intendedPlan?.billingInterval === 'YEARLY') {
          setInterval('YEARLY');
        }
      })
      .catch(() => {
        /* The picker still works without the summary; it only adds the trial-plan badge. */
      });
    return () => {
      cancelled = true;
    };
  }, [mode, organization?.id]);

  const intendedTier = summary?.subscription?.intendedPlan?.key.replace(/_(monthly|yearly)$/, '');
  const expired = trialExpired(summary?.subscription ?? null);
  const canUpgrade = mode === 'signup' || hasPermission(organization, 'organization.update');

  const copy = useMemo(() => {
    if (mode === 'signup') {
      return {
        title: 'Choose your plan',
        text: 'Every plan starts with a 14-day free trial. No card required — you can change plans any time.',
        cta: 'Start free trial',
      };
    }
    const orgName = organization ? organizationDisplayName(organization) : 'your organization';
    return expired
      ? {
          title: 'Your free trial has ended',
          text: `Choose a plan to keep ${orgName} running. Your records are safe and available in read-only mode until you do.`,
          cta: 'Upgrade',
        }
      : {
          title: 'Choose your ValueBooks plan',
          text: `Pick the plan that fits ${orgName}. You can change plans any time.`,
          cta: 'Upgrade',
        };
  }, [expired, mode, organization]);

  async function choose(plan: CatalogPlan) {
    setBusyKey(plan.key);
    setError(null);
    setMessage(null);
    try {
      if (mode === 'signup') {
        await apiRequest('/billing/registration-intents/mine', {
          method: 'POST',
          body: JSON.stringify({ planKey: plan.key }),
        });
        router.push('/onboarding');
        return;
      }
      if (!organization) return;
      const response = await apiRequest<{
        data: { checkoutUrl: string | null; status: string; effectiveAt?: string };
      }>(`/organizations/${organization.id}/billing/checkout`, {
        method: 'POST',
        body: JSON.stringify({
          planKey: plan.key,
          idempotencyKey: crypto.randomUUID(),
          successUrl: `${window.location.origin}/settings/billing?payment-return=1`,
          cancelUrl: `${window.location.origin}/upgrade`,
        }),
      });
      if (response.data.checkoutUrl) {
        window.location.assign(response.data.checkoutUrl);
        return;
      }
      if (response.data.status === 'SCHEDULED') {
        setMessage('Your plan change is scheduled for the end of the current paid term.');
      } else {
        router.push('/settings/billing');
      }
      setBusyKey(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : 'We could not continue with that plan. Try again.',
      );
      setBusyKey(null);
    }
  }

  async function signOut() {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.push('/login');
    router.refresh();
  }

  return (
    <main className="rb-plan-picker" id="main-content">
      <header className="rb-plan-picker__brand">
        <BrandLogo height={30} priority />
      </header>

      <section className="rb-plan-picker__intro">
        <h1>{copy.title}</h1>
        <p>{copy.text}</p>
      </section>

      <div className="rb-plan-picker__interval">
        <div className="rb-plan-picker__toggle" role="radiogroup" aria-label="Billing interval">
          {(['MONTHLY', 'YEARLY'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={interval === value}
              className={interval === value ? 'is-active' : undefined}
              onClick={() => setInterval(value)}
            >
              {value === 'MONTHLY' ? 'Monthly' : 'Annual'}
            </button>
          ))}
        </div>
        <p>Annual billing saves up to {MAX_YEARLY_SAVINGS}%.</p>
      </div>

      {error ? (
        <div className="rb-auth-error rb-plan-picker__notice" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rb-plan-picker__notice rb-plan-picker__notice--info" role="status">
          {message}
        </div>
      ) : null}
      {!canUpgrade ? (
        <div className="rb-plan-picker__notice rb-plan-picker__notice--info" role="status">
          Ask an organization owner or admin to choose a plan.
        </div>
      ) : null}

      {tiers === null ? (
        <div className="rb-plan-picker__grid" aria-busy="true">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="rb-plan-picker__skeleton" />
          ))}
        </div>
      ) : (
        <ul className="rb-plan-picker__grid">
          {tiers.map((tier) => {
            const plan = tier.prices[interval];
            const isIntended = tier.tierKey === intendedTier;
            const unavailable = mode === 'upgrade' && plan ? !plan.checkoutAvailable : false;
            return (
              <li key={tier.tierKey}>
                <article
                  className={`rb-plan-card${tier.highlighted ? ' rb-plan-card--highlighted' : ''}`}
                  aria-label={`${tier.name} plan`}
                >
                  <div className="rb-plan-card__head">
                    <h2>{tier.name}</h2>
                    {isIntended ? (
                      <Badge tone="success">Your trial plan</Badge>
                    ) : tier.highlighted ? (
                      <Badge tone="info">Most popular</Badge>
                    ) : null}
                  </div>
                  <p className="rb-plan-card__tagline">{tier.tagline}</p>
                  {plan ? (
                    <p className="rb-plan-card__price">
                      <strong>{formatPlanPrice(plan.priceMinor, plan.currency)}</strong>
                      <span>/ {interval === 'MONTHLY' ? 'month' : 'year'}</span>
                    </p>
                  ) : (
                    <p className="rb-plan-card__price rb-plan-card__price--missing">
                      Not offered {interval === 'MONTHLY' ? 'monthly' : 'annually'}
                    </p>
                  )}
                  <p className="rb-plan-card__billing">
                    {interval === 'MONTHLY' ? 'Billed monthly' : 'Billed annually'}
                  </p>
                  <Button
                    className="rb-plan-card__cta"
                    variant={tier.highlighted ? 'primary' : 'outline'}
                    loading={busyKey === plan?.key}
                    disabled={!plan || !canUpgrade || unavailable || (busyKey !== null && busyKey !== plan.key)}
                    onClick={() => plan && void choose(plan)}
                  >
                    {unavailable ? 'Checkout unavailable' : copy.cta}
                  </Button>
                  <ul className="rb-plan-card__features">
                    {tier.features.map((feature) => (
                      <li key={feature}>
                        <Check aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="rb-plan-picker__footer">
        <p>Prices exclude tax where it applies.</p>
        {mode === 'upgrade' ? (
          <p>
            <Link href="/dashboard">{expired ? 'Continue in read-only mode' : 'Back to dashboard'}</Link>
          </p>
        ) : null}
        {workspace.user ? (
          <p>
            Signed in as {workspace.user.email}.{' '}
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </p>
        ) : null}
      </footer>
    </main>
  );
}
