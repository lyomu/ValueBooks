'use client';

import type { PlatformAnalytics } from '@valuebooks/contracts';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, RefreshCw, Users } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { apiRequest } from '../lib/api';
import { PlatformPage } from './platform-shell';

const periods = [
  ['7d', 'Last 7 days', 7],
  ['30d', 'Last 30 days', 30],
  ['90d', 'Last 90 days', 90],
  ['year', 'Current year', 365],
] as const;

export function PlatformOverview() {
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [period, setPeriod] = useState<(typeof periods)[number][0]>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const range = useMemo(() => reportingRange(period), [period]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams(range);
      const response = await apiRequest<{ data: PlatformAnalytics }>(
        `/platform/analytics?${query}`,
      );
      setAnalytics(response.data);
      setError('');
    } catch {
      setError('Analytics could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [range]);
  useEffect(() => void load(), [load]);

  const total = analytics?.organizations.total ?? 0;
  const adoption = analytics
    ? Object.entries(analytics.adoption).map(([label, organizations]) => ({
        label: `${label[0]?.toUpperCase()}${label.slice(1)}`,
        organizations,
        percent: rate(organizations, total),
      }))
    : [];
  return (
    <PlatformPage
      title="Platform Overview"
      description="Monitor organization growth, user activity, product adoption, and platform operations."
      actions={
        <div className="rb-platform-overview__controls">
          <label>
            <span className="rb-visually-hidden">Reporting period</span>
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as typeof period)}
            >
              {periods.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="is-secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw aria-hidden="true" /> Refresh
          </button>
          {analytics ? (
            <small>
              Updated{' '}
              {new Date(analytics.observedAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </small>
          ) : null}
        </div>
      }
    >
      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}
      <section className="rb-platform-overview__kpis" aria-label="Primary platform metrics">
        <Metric
          href="/platform/organizations"
          label="Total organizations"
          value={analytics?.organizations.total}
          icon={Building2}
          detail="All registered organizations"
          loading={loading}
        />
        <Metric
          href="/platform/organizations"
          label="Active organizations"
          value={analytics?.organizations.active}
          icon={CheckCircle2}
          detail={
            analytics ? `${rate(analytics.organizations.active, total)}% of all organizations` : ''
          }
          loading={loading}
        />
        <Metric
          href="/platform/users"
          label="Total users"
          value={analytics?.users.total}
          icon={Users}
          detail={analytics ? `${analytics.users.createdInPeriod} new in selected period` : ''}
          loading={loading}
        />
        <Metric
          href="/platform/organizations"
          label="New organizations"
          value={analytics?.organizations.createdInPeriod}
          icon={Building2}
          detail="In selected period"
          loading={loading}
        />
      </section>
      {analytics ? (
        <>
          <section
            className="rb-platform-overview__growth-grid"
            aria-label="Growth and organization health"
          >
            <Panel
              title="Organization growth"
              description={`Registrations by ${analytics.reporting.grouping} in the selected period.`}
            >
              {analytics.reporting.registrations.length ? (
                <div className="rb-platform-overview__chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analytics.reporting.registrations}>
                      <CartesianGrid vertical={false} stroke="hsl(214 28% 91%)" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="organizations"
                        name="Organizations"
                        stroke="hsl(207 88% 48%)"
                        fill="hsl(207 88% 48% / .18)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="rb-platform__muted">
                  No organizations were registered in this period.
                </p>
              )}
            </Panel>
            <Panel title="Organization health" description="Current lifecycle distribution.">
              <Distribution
                total={total}
                rows={[
                  ['Active', analytics.organizations.active, 'is-good'],
                  ['Still in setup', analytics.organizations.draft, 'is-neutral'],
                  ['Suspended', analytics.organizations.suspended, 'is-warning'],
                ]}
              />
            </Panel>
          </section>
          <section className="rb-platform-overview__attention" aria-labelledby="attention-heading">
            <div>
              <h2 id="attention-heading">Requires attention</h2>
              <p>Organizations and platform events that may need administrative review.</p>
            </div>
            <div className="rb-platform-overview__attention-list">
              {analytics.organizations.suspended > 0 ? (
                <Attention
                  title={`${analytics.organizations.suspended} suspended organization${analytics.organizations.suspended === 1 ? '' : 's'}`}
                  href="/platform/organizations"
                  action="Review organizations"
                />
              ) : null}
              {analytics.attention.failedJobsLast24Hours > 0 ? (
                <Attention
                  title={`${analytics.attention.failedJobsLast24Hours} failed background job${analytics.attention.failedJobsLast24Hours === 1 ? '' : 's'} in 24 hours`}
                  href="/platform/jobs"
                  action="View jobs"
                />
              ) : null}
              {analytics.organizations.suspended === 0 &&
              analytics.attention.failedJobsLast24Hours === 0 ? (
                <p className="rb-platform__muted">No immediate issues require attention.</p>
              ) : null}
            </div>
          </section>
          <section className="rb-platform-overview__two-column">
            <Panel
              title="Activation funnel"
              description="All-time milestones derived from existing records."
            >
              <Funnel
                total={total}
                rows={[
                  ['Registered', total],
                  ['Finished setup', analytics.activation.onboardingCompleted],
                  ['First invoice issued', analytics.activation.reachedFirstInvoice],
                ]}
              />
            </Panel>
            <Panel
              title="Product adoption"
              description="Organizations with qualifying module activity, all time."
            >
              <Bars rows={adoption} />
            </Panel>
            <Panel title="Plan distribution" description="Current subscription plans.">
              {analytics.distribution.byPlan.length ? (
                <Bars
                  rows={analytics.distribution.byPlan.map((row) => ({
                    label: row.planName,
                    organizations: row.organizations,
                    percent: rate(row.organizations, total),
                  }))}
                />
              ) : (
                <p className="rb-platform__muted">
                  No paid subscriptions yet. <Link href="/platform/billing">Open billing</Link>.
                </p>
              )}
            </Panel>
            <Panel
              title="Geographic distribution"
              description="Organizations by registered country."
            >
              <Bars
                rows={analytics.distribution.byCountry
                  .slice(0, 5)
                  .map((row) => ({
                    label: countryName(row.countryCode),
                    organizations: row.organizations,
                    percent: rate(row.organizations, total),
                  }))}
              />
            </Panel>
            <Panel
              title="Retention and engagement"
              description="Organizations with audit-recorded activity. Automated background work is excluded."
            >
              <Distribution
                total={analytics.organizations.active}
                rows={[
                  ['Active in 30 days', analytics.retention.activeLast30Days, 'is-good'],
                  ['Active in 90 days', analytics.retention.activeLast90Days, 'is-neutral'],
                ]}
              />
            </Panel>
            <Panel
              title="Recent platform activity"
              description="Latest authorized administration events."
            >
              {analytics.recentActivity.length ? (
                <ul className="rb-platform-overview__activity">
                  {analytics.recentActivity.map((event) => (
                    <li key={event.id}>
                      <span>{event.eventKey.replaceAll('.', ' ')}</span>
                      <time dateTime={event.occurredAt}>
                        {new Date(event.occurredAt).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rb-platform__muted">No platform administration activity yet.</p>
              )}
              <Link className="rb-platform__link" href="/platform/audit">
                View all activity <ArrowRight aria-hidden="true" />
              </Link>
            </Panel>
          </section>
        </>
      ) : null}
    </PlatformPage>
  );
}

function Metric({
  href,
  label,
  value,
  icon: Icon,
  detail,
  loading,
}: {
  href: string;
  label: string;
  value: number | undefined;
  icon: typeof Building2;
  detail: string;
  loading: boolean;
}) {
  return (
    <Link href={href} className="rb-platform-overview__metric">
      <span>
        {label}
        <Icon aria-hidden="true" />
      </span>
      <strong>{loading ? '—' : value?.toLocaleString()}</strong>
      <small>{detail}</small>
    </Link>
  );
}
function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rb-platform__card rb-platform-overview__panel">
      <header>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}
function Distribution({ rows, total }: { rows: [string, number, string][]; total: number }) {
  return (
    <div className="rb-platform-overview__distribution">
      {rows.map(([label, count, tone]) => (
        <Link key={label} href="/platform/organizations">
          <span>
            <i className={tone} />
            {label}
          </span>
          <strong>{count}</strong>
          <small>{rate(count, total)}%</small>
        </Link>
      ))}
    </div>
  );
}
function Funnel({ rows, total }: { rows: [string, number][]; total: number }) {
  return (
    <ol className="rb-platform-overview__funnel">
      {rows.map(([label, count], index) => (
        <li key={label}>
          <span>
            {index + 1}. {label}
          </span>
          <strong>{count}</strong>
          <small>
            {index
              ? `${rate(count, rows[index - 1]?.[1] ?? 0)}% from previous stage`
              : `${rate(count, total)}% of organizations`}
          </small>
          <i style={{ width: `${rate(count, total)}%` }} />
        </li>
      ))}
    </ol>
  );
}
function Bars({ rows }: { rows: { label: string; organizations: number; percent: number }[] }) {
  return (
    <div className="rb-platform-overview__bars">
      {rows.length ? (
        rows.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <strong>
              {row.organizations} <small>{row.percent}%</small>
            </strong>
            <i>
              <b style={{ width: `${row.percent}%` }} />
            </i>
          </div>
        ))
      ) : (
        <p className="rb-platform__muted">No data is available yet.</p>
      )}
    </div>
  );
}
function Attention({ title, href, action }: { title: string; href: string; action: string }) {
  return (
    <Link href={href}>
      <AlertTriangle aria-hidden="true" />
      <span>{title}</span>
      <em>
        {action} <ArrowRight aria-hidden="true" />
      </em>
    </Link>
  );
}
function rate(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0;
}
function reportingRange(period: (typeof periods)[number][0]) {
  const days = periods.find(([key]) => key === period)?.[2] ?? 30;
  const to = new Date();
  const from =
    period === 'year'
      ? new Date(to.getFullYear(), 0, 1)
      : new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
function countryName(code: string) {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
