'use client';

import type { PlatformAnalytics } from '@valuebooks/contracts';
import { Button, Card, EmptyState, ErrorState } from '@valuebooks/ui';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { apiRequest } from '../lib/api';
import { ChartLoading, DashboardKpi, DashboardPanelHeading } from './dashboard-panels';
import { PlatformPage } from './platform-shell';

const periods = [
  ['7d', 'Last 7 days', 7],
  ['30d', 'Last 30 days', 30],
  ['90d', 'Last 90 days', 90],
  ['year', 'Current year', 365],
] as const;

/** ValueBooks' own subscription figures, from the billing overview endpoint (SUPPORT and above). */
type BillingSnapshot = {
  activePaid: number;
  complimentary: number;
  trialing: number;
  trialExpiring24h: number;
  trialConversionRate: number | null;
  pastDue: number;
  mrrMinorByCurrency: Record<string, string>;
  arrMinorByCurrency: Record<string, string>;
  methodology: string;
};

export function PlatformOverview() {
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [billing, setBilling] = useState<BillingSnapshot | null>(null);
  const [billingFailed, setBillingFailed] = useState(false);
  const [period, setPeriod] = useState<(typeof periods)[number][0]>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const range = useMemo(() => reportingRange(period), [period]);

  const load = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams(range);
    // The two panels fail independently: a billing outage must not blank the tenant metrics, and
    // neither may render as a zero.
    const [analyticsResult, billingResult] = await Promise.allSettled([
      apiRequest<{ data: PlatformAnalytics }>(`/platform/analytics?${query}`),
      apiRequest<{ data: BillingSnapshot }>('/platform/billing/overview'),
    ]);
    if (analyticsResult.status === 'fulfilled') {
      setAnalytics(analyticsResult.value.data);
      setError('');
    } else {
      setError('Platform analytics could not be loaded.');
    }
    setBillingFailed(billingResult.status === 'rejected');
    if (billingResult.status === 'fulfilled') setBilling(billingResult.value.data);
    setLoading(false);
  }, [range]);
  useEffect(() => void load(), [load]);

  const total = analytics?.organizations.total ?? 0;
  const previous = analytics?.previousPeriod;
  const adoption = analytics
    ? Object.entries(analytics.adoption).map(([label, organizations]) => ({
        label: `${label[0]?.toUpperCase()}${label.slice(1)}`,
        organizations,
        percent: rate(organizations, total),
      }))
    : [];
  const attention = analytics ? attentionItems(analytics) : [];

  return (
    <PlatformPage
      title="Overview"
      description="What changed across the platform, and what needs attention today."
      meta={
        analytics ? (
          <>
            {new Date(analytics.reporting.from).toLocaleDateString()} –{' '}
            {new Date(analytics.reporting.to).toLocaleDateString()} · Updated{' '}
            {new Date(analytics.observedAt).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </>
        ) : null
      }
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
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw aria-hidden="true" /> Refresh
          </Button>
        </div>
      }
    >
      {error ? (
        <ErrorState
          title="Platform analytics unavailable"
          description={error}
          action={
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : null}

      <section className="rb-dash-kpis--four" aria-label="Primary platform metrics">
        <DashboardKpi
          label="Total organizations"
          icon={Building2}
          loading={loading}
          value={analytics ? analytics.organizations.total.toLocaleString() : '—'}
          hint="All registered organizations"
          href="/platform/organizations"
        />
        <DashboardKpi
          label="Active organizations"
          icon={CheckCircle2}
          loading={loading}
          value={analytics ? analytics.organizations.active.toLocaleString() : '—'}
          hint={analytics ? `${rate(analytics.organizations.active, total)}% of all` : undefined}
          href="/platform/organizations?status=ACTIVE"
        />
        <DashboardKpi
          label="Registered users"
          icon={Users}
          loading={loading}
          value={analytics ? analytics.users.total.toLocaleString() : '—'}
          hint={analytics ? `${analytics.users.createdInPeriod} new this period` : undefined}
          delta={
            analytics && previous?.hasData
              ? change(analytics.users.createdInPeriod, previous.usersCreated)
              : null
          }
          href="/platform/users"
        />
        <DashboardKpi
          label="New organizations"
          icon={TrendingUp}
          loading={loading}
          value={analytics ? analytics.organizations.createdInPeriod.toLocaleString() : '—'}
          hint="In selected period"
          delta={
            analytics && previous?.hasData
              ? change(analytics.organizations.createdInPeriod, previous.organizationsCreated)
              : null
          }
          href="/platform/organizations"
        />
      </section>

      {analytics ? (
        <>
          <section className="rb-dash-grid" aria-label="Growth and organization health">
            <Card className="rb-dash-panel">
              <DashboardPanelHeading
                title="Organization growth"
                description={`Registrations and completed setup by ${analytics.reporting.grouping}.`}
                href="/platform/organizations"
                linkLabel="Organizations"
              />
              {loading ? (
                <ChartLoading label="Loading growth data" />
              ) : analytics.reporting.growth.length ? (
                <>
                  <div className="rb-dash-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={analytics.reporting.growth}>
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
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                        <Area
                          type="monotone"
                          dataKey="organizations"
                          name="Registered"
                          stroke="hsl(var(--rb-primary))"
                          fill="hsl(var(--rb-primary) / .16)"
                          strokeWidth={2}
                        />
                        <Area
                          type="monotone"
                          dataKey="activated"
                          name="Finished setup"
                          stroke="hsl(var(--rb-success))"
                          fill="hsl(var(--rb-success) / .14)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {analytics.reporting.growth.length < 3 ? (
                    <p className="rb-platform__muted">
                      Limited data: {analytics.reporting.growth.length} point
                      {analytics.reporting.growth.length === 1 ? '' : 's'} in this period.
                    </p>
                  ) : null}
                </>
              ) : (
                <EmptyState
                  icon={TrendingUp}
                  variant="no-results"
                  title="No registrations in this period"
                  description="Choose a longer period to see earlier growth."
                />
              )}
            </Card>
            <Card className="rb-dash-panel">
              <DashboardPanelHeading
                title="Organization health"
                description="Current lifecycle distribution."
              />
              <Distribution
                total={total}
                rows={[
                  ['Active', analytics.organizations.active, 'is-good', 'status=ACTIVE'],
                  ['Still in setup', analytics.organizations.draft, 'is-neutral', 'status=DRAFT'],
                  [
                    'Suspended',
                    analytics.organizations.suspended,
                    'is-warning',
                    'status=SUSPENDED',
                  ],
                ]}
              />
            </Card>
          </section>

          <Card className="rb-dash-panel rb-platform-overview__billing">
            <DashboardPanelHeading
              title="Billing snapshot"
              description="ValueBooks subscription revenue and collection health."
              href="/platform/billing"
              linkLabel="Billing"
            />
            {billingFailed ? (
              <ErrorState
                title="Billing figures unavailable"
                description="The billing service did not respond. These numbers are not zero — they are unknown."
                action={
                  <Button variant="outline" onClick={() => void load()}>
                    Retry
                  </Button>
                }
              />
            ) : !billing ? (
              <ChartLoading label="Loading billing snapshot" />
            ) : (
              <>
                <div className="rb-platform-overview__billing-grid">
                  <Figure label="MRR" value={money(billing.mrrMinorByCurrency)} />
                  <Figure label="ARR (run rate)" value={money(billing.arrMinorByCurrency)} />
                  <Figure
                    label="Active paid"
                    value={billing.activePaid.toLocaleString()}
                    href="/platform/billing/subscriptions"
                  />
                  <Figure
                    label="Trialing"
                    value={billing.trialing.toLocaleString()}
                    href="/platform/billing/trials"
                  />
                  <Figure
                    label="Trial conversion"
                    value={
                      billing.trialConversionRate === null
                        ? 'No completed trials'
                        : `${billing.trialConversionRate}%`
                    }
                  />
                  <Figure
                    label="Past due"
                    value={billing.pastDue.toLocaleString()}
                    tone={billing.pastDue > 0 ? 'warning' : undefined}
                    href="/platform/billing/issues"
                  />
                  {billing.complimentary > 0 ? (
                    <Figure
                      label="Complimentary"
                      value={billing.complimentary.toLocaleString()}
                      href="/platform/billing/subscriptions"
                    />
                  ) : null}
                </div>
                <p className="rb-platform__muted">{billing.methodology}</p>
              </>
            )}
          </Card>

          <section className="rb-dash-grid rb-dash-grid--obligations" aria-label="Operations">
            <Card className="rb-dash-panel">
              <DashboardPanelHeading
                title="Requires attention"
                description="Each item links to the records behind it."
              />
              {attention.length ? (
                <ul className="rb-platform-overview__attention-list">
                  {attention.map((item) => (
                    <li key={item.title}>
                      <Link href={item.href}>
                        <AlertTriangle aria-hidden="true" className={`is-${item.tone}`} />
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={CheckCircle2}
                  variant="no-results"
                  title="Nothing needs attention"
                  description="No stalled onboarding, failed jobs or webhooks, expiring trials, or high-severity security events."
                />
              )}
            </Card>
            <Card className="rb-dash-panel">
              <DashboardPanelHeading
                title="Plan mix"
                description="Organizations by current subscription."
                href="/platform/billing/plans"
                linkLabel="Plans"
              />
              {analytics.distribution.byPlan.length ? (
                <Bars
                  rows={analytics.distribution.byPlan.map((row) => ({
                    label: row.planName,
                    organizations: row.organizations,
                    percent: rate(row.organizations, total),
                  }))}
                />
              ) : (
                <EmptyState
                  icon={CircleDollarSign}
                  variant="no-results"
                  title="No subscriptions yet"
                  description="Plan mix appears once organizations hold a trial or paid plan."
                />
              )}
            </Card>
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
            <Panel title="Countries" description="Organizations by registered country.">
              <Bars
                rows={analytics.distribution.byCountry.slice(0, 5).map((row) => ({
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
                total={total}
                rows={[
                  ['Active in 30 days', analytics.retention.activeLast30Days, 'is-good', ''],
                  ['Active in 90 days', analytics.retention.activeLast90Days, 'is-neutral', ''],
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
                      <span>{eventName(event.eventKey)}</span>
                      <time dateTime={event.occurredAt}>
                        {new Date(event.occurredAt).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rb-platform__muted">No platform administration activity yet.</p>
              )}
              <Link className="rb-platform-overview__more" href="/platform/audit">
                View all activity <ArrowRight aria-hidden="true" />
              </Link>
            </Panel>
          </section>
        </>
      ) : null}
    </PlatformPage>
  );
}

type AttentionItem = {
  title: string;
  detail: string;
  href: string;
  tone: 'warning' | 'danger';
};

/** Most urgent first; an item appears only when its count is non-zero. */
function attentionItems(analytics: PlatformAnalytics): AttentionItem[] {
  const { attention } = analytics;
  const items: AttentionItem[] = [];
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
  if (attention.trialsExpiringSoon > 0)
    items.push({
      title: `${attention.trialsExpiringSoon} ${plural(attention.trialsExpiringSoon, 'trial expires', 'trials expire')} within 24 hours`,
      detail: 'Unpaid trials become read-only at expiry.',
      href: '/platform/billing/trials',
      tone: 'warning',
    });
  if (attention.failedWebhooks > 0)
    items.push({
      title: `${attention.failedWebhooks} failed webhook ${plural(attention.failedWebhooks, 'event', 'events')}`,
      detail: 'A payment may be verified but not applied. All time.',
      href: '/platform/billing/webhooks',
      tone: 'danger',
    });
  if (attention.failedJobsLast24Hours > 0)
    items.push({
      title: `${attention.failedJobsLast24Hours} failed scheduled ${plural(attention.failedJobsLast24Hours, 'job', 'jobs')} in 24 hours`,
      detail: 'Scheduled executions only; queue failures are listed under Jobs.',
      href: '/platform/jobs',
      tone: 'danger',
    });
  if (attention.highSeveritySecurityEvents > 0)
    items.push({
      title: `${attention.highSeveritySecurityEvents} high-severity security ${plural(attention.highSeveritySecurityEvents, 'event', 'events')} in 24 hours`,
      detail: 'Severity warning or above.',
      href: '/platform/security',
      tone: 'danger',
    });
  if (attention.stalledOnboarding > 0)
    items.push({
      title: `${attention.stalledOnboarding} ${plural(attention.stalledOnboarding, 'organization has', 'organizations have')} stalled in setup`,
      detail: 'Signed up more than 7 days ago, setup never finished.',
      href: '/platform/organizations?status=DRAFT',
      tone: 'warning',
    });
  if (attention.suspendedOrganizations > 0)
    items.push({
      title: `${attention.suspendedOrganizations} suspended ${plural(attention.suspendedOrganizations, 'organization', 'organizations')}`,
      detail: 'Suspended tenants cannot use the application.',
      href: '/platform/organizations?status=SUSPENDED',
      tone: 'warning',
    });
  return items;
}

function Figure({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: string;
  href?: string;
  tone?: 'warning';
}) {
  const body = (
    <>
      <span>{label}</span>
      <strong className={tone ? `is-${tone}` : undefined}>{value}</strong>
    </>
  );
  return (
    <div className="rb-platform-overview__figure">
      {href ? <Link href={href}>{body}</Link> : body}
    </div>
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
    <Card className="rb-dash-panel rb-platform-overview__panel">
      <DashboardPanelHeading title={title} description={description} />
      {children}
    </Card>
  );
}

function Distribution({
  rows,
  total,
}: {
  rows: [string, number, string, string][];
  total: number;
}) {
  return (
    <div className="rb-platform-overview__distribution">
      {rows.map(([label, count, tone, query]) => (
        <Link
          key={label}
          href={query ? `/platform/organizations?${query}` : '/platform/organizations'}
        >
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

/** Change against the previous window. Growth is favourable for every metric shown here. */
function change(current: number, previous: number) {
  if (previous === 0) return current > 0 ? { label: 'New', favorable: true } : null;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return { label: 'No change', favorable: true };
  return { label: `${percent > 0 ? '+' : ''}${percent}%`, favorable: percent > 0 };
}

/** Each currency on its own; unconverted currencies are never added together. */
function money(byCurrency: Record<string, string>): string {
  const entries = Object.entries(byCurrency);
  if (entries.length === 0) return 'None yet';
  return entries
    .map(([currency, minor]) =>
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(Number(minor) / 100),
    )
    .join(' · ');
}

function eventName(key: string): string {
  const text = key.split('.').slice(1).join(' ').replaceAll('_', ' ');
  return text ? `${text[0]?.toUpperCase()}${text.slice(1)}` : key;
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
