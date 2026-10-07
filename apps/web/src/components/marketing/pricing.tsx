'use client';

import { Check, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { convertUsd, detectLikelyCurrency, formatCurrency } from '../../lib/currency';
import { FEATURE_GROUPS, PLANS, type Plan } from './pricing-data';

export type BillingInterval = 'monthly' | 'yearly';

/**
 * Resolves which currency code to display prices in, defaulting to USD until the browser locale
 * is read client-side after mount (avoids an SSR/client hydration mismatch).
 */
export function useDisplayCurrency(): string {
  const [code, setCode] = useState('USD');
  useEffect(() => {
    setCode(detectLikelyCurrency());
  }, []);
  return code;
}

export function BillingToggle({
  interval,
  onChange,
}: {
  interval: BillingInterval;
  onChange: (interval: BillingInterval) => void;
}) {
  return (
    <div className="mk-pricing-toggle" role="group" aria-label="Billing interval">
      <button
        type="button"
        className={interval === 'monthly' ? 'is-active' : ''}
        aria-pressed={interval === 'monthly'}
        onClick={() => onChange('monthly')}
      >
        Monthly
      </button>
      <button
        type="button"
        className={interval === 'yearly' ? 'is-active' : ''}
        aria-pressed={interval === 'yearly'}
        onClick={() => onChange('yearly')}
      >
        Yearly <span className="mk-pricing-toggle__save">Save ~17%</span>
      </button>
    </div>
  );
}

function priceForInterval(plan: Plan, interval: BillingInterval): { amountUsd: number; unit: string } {
  return interval === 'monthly'
    ? { amountUsd: plan.monthlyPriceUsd, unit: '/month' }
    : { amountUsd: plan.yearlyPriceUsd, unit: '/year' };
}

function PriceTag({
  plan,
  interval,
  currencyCode,
}: {
  plan: Plan;
  interval: BillingInterval;
  currencyCode: string;
}) {
  const { amountUsd, unit } = priceForInterval(plan, interval);
  const display = convertUsd(amountUsd, currencyCode);
  return (
    <div className="mk-pricing-amount">
      <strong>{formatCurrency(display)}</strong>
      <span>{unit}</span>
    </div>
  );
}

export function CurrencyDisclaimer({ currencyCode }: { currencyCode: string }) {
  const display = convertUsd(0, currencyCode);
  if (!display.isApproximate) return null;
  return (
    <p className="mk-pricing-disclaimer">
      Prices shown in {display.code} for convenience — you&apos;ll be billed in US dollars (USD).
    </p>
  );
}

function PlanCard({
  plan,
  interval,
  currencyCode,
  variant,
}: {
  plan: Plan;
  interval: BillingInterval;
  currencyCode: string;
  variant: 'compact' | 'full';
}) {
  const cardClasses = [
    'mk-pricing-card',
    plan.highlighted && 'mk-pricing-card--highlighted',
    variant === 'full' && 'mk-pricing-card--full',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <article className={cardClasses}>
      {plan.highlighted ? <span className="mk-pricing-ribbon">Most popular</span> : null}
      <h3>{plan.name}</h3>
      <p className="mk-pricing-card__tagline">{plan.tagline}</p>
      <PriceTag plan={plan} interval={interval} currencyCode={currencyCode} />
      <Link
        className={plan.highlighted ? 'mk-button' : 'mk-button mk-button--outline'}
        href={plan.ctaHref ?? '/signup'}
      >
        {plan.ctaLabel ?? 'Start free trial'}
      </Link>
      <ul className="mk-pricing-card__features">
        {plan.topFeatures.map((feature) => (
          <li key={feature}>
            <Check aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function PlanCardRow({
  interval,
  currencyCode,
  variant,
}: {
  interval: BillingInterval;
  currencyCode: string;
  variant: 'compact' | 'full';
}) {
  return (
    <div className="mk-pricing-row">
      {PLANS.map((plan) => (
        <PlanCard key={plan.id} plan={plan} interval={interval} currencyCode={currencyCode} variant={variant} />
      ))}
    </div>
  );
}

function FeatureCell({ value }: { value: boolean | string }) {
  if (typeof value === 'string') {
    return <span className="mk-pricing-cell__value">{value}</span>;
  }
  return value ? (
    <span className="mk-pricing-cell__icon is-yes">
      <Check aria-hidden="true" />
      <span className="rb-visually-hidden">Included</span>
    </span>
  ) : (
    <span className="mk-pricing-cell__icon is-no">
      <X aria-hidden="true" />
      <span className="rb-visually-hidden">Not included</span>
    </span>
  );
}

export function ComparisonTable() {
  const [openGroup, setOpenGroup] = useState<string | null>(FEATURE_GROUPS[0]?.id ?? null);

  return (
    <div className="mk-pricing-table-wrap">
      <table className="mk-pricing-table">
        <caption className="rb-visually-hidden">Plan feature comparison</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="rb-visually-hidden">Feature</span>
            </th>
            {PLANS.map((plan) => (
              <th scope="col" key={plan.id}>
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        {FEATURE_GROUPS.map((group) => {
          const isOpen = openGroup === group.id;
          const panelId = `pricing-group-${group.id}`;
          return (
            <tbody
              key={group.id}
              id={panelId}
              className={isOpen ? 'mk-pricing-group is-open' : 'mk-pricing-group'}
            >
              <tr>
                <th scope="colgroup" colSpan={PLANS.length + 1} className="mk-pricing-group__header-cell">
                  <button
                    type="button"
                    className="mk-pricing-group__header"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenGroup(isOpen ? null : group.id)}
                  >
                    <span>{group.name}</span>
                    <Plus className="mk-pricing-group__icon" aria-hidden="true" />
                  </button>
                </th>
              </tr>
              {isOpen
                ? group.rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {PLANS.map((plan) => (
                        <td key={plan.id}>
                          <FeatureCell value={row.values[plan.id] ?? false} />
                        </td>
                      ))}
                    </tr>
                  ))
                : null}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
