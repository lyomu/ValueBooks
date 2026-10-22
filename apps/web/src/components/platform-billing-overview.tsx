'use client';

import { Button, CardSkeleton, ErrorState, Select } from '@valuebooks/ui';
import {
  AlertCircle,
  BadgeCheck,
  Clock3,
  CreditCard,
  Hourglass,
  Percent,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import { DashboardKpi } from './dashboard-panels';
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

/** `2026-10` → "Oct 2026", in UTC like the figures themselves. */
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

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
    <div
      className={`rb-platform__card rb-platform__revenue-card${entries.length ? '' : ' is-empty'}`}
    >
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

  const load = useCallback(() => {
    setError('');
    void Promise.all([
      apiRequest<{ data: Overview }>('/platform/billing/overview'),
      apiRequest<{ data: Revenue }>('/platform/billing/revenue'),
    ])
      .then(([overviewResult, revenueResult]) => {
        setOverview(overviewResult.data);
        setRevenue(revenueResult.data);
      })
      .catch(() =>
        setError('This is a loading failure, not a billing incident. Nothing was changed.'),
      );
  }, []);
  useEffect(() => load(), [load]);

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
        <ErrorState
          title="Billing overview could not be loaded"
          description={error}
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      ) : !overview || !revenue ? (
        <CardSkeleton />
      ) : (
        <>
          <section className="rb-platform__section" aria-labelledby="billing-subscriptions-heading">
            <h2 id="billing-subscriptions-heading">Subscriptions</h2>
            <div className="rb-dash-kpis--four">
              {/* Active paid spans two statuses and excludes complimentary grants, so no single
                  list filter reproduces it; the tile opens the full list instead. */}
              <DashboardKpi
                label="Active paid subscriptions"
                icon={BadgeCheck}
                value={overview.activePaid.toLocaleString()}
                hint="Active or scheduled to cancel; complimentary excluded"
                href="/platform/billing/subscriptions"
              />
              <DashboardKpi
                label="Organizations trialing"
                icon={Hourglass}
                value={overview.trialing.toLocaleString()}
                hint="Currently in a trial"
                href="/platform/billing/subscriptions?status=TRIALING"
              />
              <DashboardKpi
                label="Trial conversion rate"
                icon={Percent}
                value={
                  overview.trialConversionRate === null
                    ? '—'
                    : `${overview.trialConversionRate.toLocaleString()}%`
                }
                hint={
                  overview.trialConversionRate === null
                    ? 'No completed trials yet'
                    : 'Of completed trials'
                }
              />
              <DashboardKpi
                label="Past due subscriptions"
                icon={CreditCard}
                value={overview.pastDue.toLocaleString()}
                hint="Payment needs attention"
                href="/platform/billing/subscriptions?status=PAST_DUE"
              />
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
                  Track confirmed subscription payments and retained historical records.
                </p>
              </div>
              <Select
                aria-label="Collections period"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              >
                <option value="all">Last 12 months</option>
                {[...new Set(months.map((row) => row.month))].reverse().map((month) => (
                  <option key={month} value={month}>
                    {monthLabel(month)}
                  </option>
                ))}
              </Select>
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
              <Link
                href="/platform/billing/transactions?status=FAILED"
                className="rb-platform__health-card"
              >
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
