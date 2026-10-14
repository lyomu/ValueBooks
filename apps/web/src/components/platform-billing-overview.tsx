'use client';

import { AlertCircle, Clock3, CreditCard, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import { PlatformPage } from './platform-shell';

type Overview = {
  activePaid: number;
  trialing: number;
  trialExpiring24h: number;
  trialConversionRate: number | null;
  pastDue: number;
  failedPayments: number;
  failedWebhooks: number;
  unresolvedChanges: number;
  mrrMinorByCurrency: Record<string, string>;
  arrMinorByCurrency: Record<string, string>;
  methodology: string;
};
type Revenue = {
  months: Array<{
    month: string;
    currency: string;
    grossMinor: string;
    successfulPayments: number;
  }>;
};

function formatMoney(minor: bigint, currency: string) {
  const digits =
    new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const scale = 10n ** BigInt(digits);
  const absolute = minor < 0n ? -minor : minor;
  const whole = new Intl.NumberFormat().format(absolute / scale);
  const fraction = digits ? `.${String(absolute % scale).padStart(digits, '0')}` : '';
  return `${currency} ${minor < 0n ? '-' : ''}${whole}${fraction}`;
}

function RevenueCard({
  title,
  amounts,
  description,
}: {
  title: string;
  amounts: Record<string, string>;
  description: string;
}) {
  const entries = Object.entries(amounts);
  return (
    <div className="rb-platform__card rb-platform__revenue-card">
      <h3>{title}</h3>
      {entries.length ? (
        <ul className="rb-platform__money-list">
          {entries.map(([currency, amount]) => (
            <li key={currency}>
              <strong>{formatMoney(BigInt(amount), currency)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rb-platform__muted">No active paid subscriptions yet.</p>
      )}
      <p className="rb-platform__muted">{description}</p>
    </div>
  );
}

export function PlatformBillingOverview() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [period, setPeriod] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([
      apiRequest<{ data: Overview }>('/platform/billing/overview'),
      apiRequest<{ data: Revenue }>('/platform/billing/revenue'),
    ])
      .then(([overviewResult, revenueResult]) => {
        setOverview(overviewResult.data);
        setRevenue(revenueResult.data);
      })
      .catch(() => setError('Billing overview could not be loaded.'));
  }, []);

  const months = revenue?.months ?? [];
  const collections = new Map<string, { gross: bigint; count: number }>();
  for (const row of months) {
    if (period !== 'all' && row.month !== period) continue;
    const previous = collections.get(row.currency) ?? { gross: 0n, count: 0 };
    collections.set(row.currency, {
      gross: previous.gross + BigInt(row.grossMinor),
      count: previous.count + row.successfulPayments,
    });
  }

  return (
    <PlatformPage
      title="Billing overview"
      description="Monitor subscriptions, recurring revenue, and billing operations across ValueBooks."
    >
      {error ? (
        <p role="alert" className="rb-platform__alert">
          {error}
        </p>
      ) : null}
      {!overview || !revenue ? (
        <p className="rb-platform__muted">Loading billing overview…</p>
      ) : (
        <>
          <section className="rb-platform__section" aria-labelledby="billing-subscriptions-heading">
            <h2 id="billing-subscriptions-heading">Subscriptions</h2>
            <div className="rb-platform__stats">
              <div className="rb-platform__stat">
                <span>Active paid subscriptions</span>
                <strong>{overview.activePaid.toLocaleString()}</strong>
                <small>Active and scheduled to cancel</small>
              </div>
              <div className="rb-platform__stat">
                <span>Organizations trialing</span>
                <strong>{overview.trialing.toLocaleString()}</strong>
                <small>Currently in a trial</small>
              </div>
              <div className="rb-platform__stat">
                <span>Trial conversion rate</span>
                <strong>
                  {overview.trialConversionRate === null
                    ? '0%'
                    : `${overview.trialConversionRate.toLocaleString()}%`}
                </strong>
                <small>
                  {overview.trialConversionRate === null
                    ? 'No completed trials yet'
                    : 'Of completed trials'}
                </small>
              </div>
              <div className="rb-platform__stat">
                <span>Past due subscriptions</span>
                <strong>{overview.pastDue.toLocaleString()}</strong>
                <small>Payment needs attention</small>
              </div>
            </div>
          </section>
          <section className="rb-platform__section" aria-labelledby="billing-revenue-heading">
            <h2 id="billing-revenue-heading">Revenue overview</h2>
            <div className="rb-platform__revenue-grid">
              <RevenueCard
                title="Monthly recurring revenue (MRR)"
                amounts={overview.mrrMinorByCurrency}
                description="Normalized from active paid contracts by original currency."
              />
              <RevenueCard
                title="Annualized recurring revenue (ARR)"
                amounts={overview.arrMinorByCurrency}
                description="Annualized contracted value by original currency."
              />
            </div>
          </section>
          <section
            className="rb-platform__section rb-platform__card"
            aria-labelledby="billing-collections-heading"
          >
            <div className="rb-platform__card-head">
              <div>
                <h2 id="billing-collections-heading">Verified collections</h2>
                <p className="rb-platform__muted">
                  Track confirmed subscription payments across Paddle and Paystack.
                </p>
              </div>
              <label>
                Period{' '}
                <select value={period} onChange={(event) => setPeriod(event.target.value)}>
                  <option value="all">Last 12 months</option>
                  {[...new Set(months.map((row) => row.month))].reverse().map((month) => (
                    <option key={month} value={month}>
                      {month}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {collections.size ? (
              <ul className="rb-platform__money-list">
                {[...collections].map(([currency, value]) => (
                  <li key={currency}>
                    <strong>{formatMoney(value.gross, currency)}</strong>
                    <small>
                      {value.count.toLocaleString()} successful{' '}
                      {value.count === 1 ? 'transaction' : 'transactions'}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rb-platform__muted">No verified payments yet.</p>
            )}
            <Link href="/platform/billing/revenue" className="rb-platform__link">
              View revenue analytics
            </Link>
          </section>
          <section className="rb-platform__section" aria-labelledby="billing-health-heading">
            <h2 id="billing-health-heading">Billing health</h2>
            <div className="rb-platform__health-grid">
              <Link
                href="/platform/billing/trials?state=expiring"
                className="rb-platform__health-card"
              >
                <Clock3 aria-hidden="true" />
                <span>
                  Trials expiring within 24 hours
                  <strong>{overview.trialExpiring24h.toLocaleString()}</strong>
                </span>
              </Link>
              <Link href="/platform/billing/issues" className="rb-platform__health-card">
                <CreditCard aria-hidden="true" />
                <span>
                  Failed payments<strong>{overview.failedPayments.toLocaleString()}</strong>
                </span>
              </Link>
              <Link
                href="/platform/billing/webhooks?state=FAILED"
                className="rb-platform__health-card"
              >
                <AlertCircle aria-hidden="true" />
                <span>
                  Failed webhooks<strong>{overview.failedWebhooks.toLocaleString()}</strong>
                </span>
              </Link>
              <Link href="/platform/billing/issues" className="rb-platform__health-card">
                <RefreshCw aria-hidden="true" />
                <span>
                  Unresolved subscription changes
                  <strong>{overview.unresolvedChanges.toLocaleString()}</strong>
                </span>
              </Link>
            </div>
          </section>
          <p className="rb-platform__muted">{overview.methodology}</p>
        </>
      )}
    </PlatformPage>
  );
}
