/*
THESIS: A calm accounting workbench inside RetailFlow's proven operational frame.
OWN-WORLD: Navy navigation, cool white workspace, cyan action signals, Outfit type, and ledger-like alignment.
STORY: Owners scan recognized performance, obligations, and cash before handling recent activity.
FIRST VIEWPORT: Period controls and exactly three financial KPIs, followed by income and expense analysis.
FORM: Compact responsive analytical panels, honest unavailable states, precise tables, and no mock values.
*/
'use client';

import { Button, Card, EmptyState, PageHeader, Skeleton } from '@valuebooks/ui';
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CircleAlert,
  FilePlus2,
  Landmark,
  ReceiptText,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type DashboardData = {
  currency: string;
  period: { from: string; to: string };
  capabilities: { receivables: boolean; payables: boolean; journals: boolean };
  grouping: 'monthly' | 'quarterly';
  summary: { income: string; expenses: string; netProfit: string };
  incomeExpenses: {
    key: string;
    label: string;
    income: number;
    expenses: number;
    cashMovement: number;
  }[];
  topExpenses: { id: string | null; href: string | null; name: string; amount: string }[];
  receivables: Aging | null;
  payables: Aging | null;
  agingUnavailableReason: string | null;
  cashFlow: {
    openingBalance: string | null;
    inflows: string;
    outflows: string;
    adjustments: string;
    closingBalance: string | null;
    movement: string;
    series: { key: string; movement: number }[];
  };
  recentTransactions: {
    id: string;
    href: string | null;
    date: string;
    type: string;
    reference: string;
    description: string;
    amount: string;
    status: string;
  }[];
  actions: { title: string; count: number; href: string; severity: string }[];
};
type Aging = { available: boolean; total: string; buckets: { label: string; amount: string }[] };
type FiscalYear = {
  label: string;
  startsOn: string;
  endsOn: string;
  periods?: { status: string }[];
};

const periodChoices = [
  ['THIS_MONTH', 'This Month'],
  ['LAST_MONTH', 'Last Month'],
  ['THIS_QUARTER', 'This Quarter'],
  ['THIS_FY', 'This Fiscal Year'],
  ['LAST_FY', 'Last Fiscal Year'],
  ['CUSTOM', 'Custom Date Range'],
] as const;
const palette = [
  'hsl(194 82% 50%)',
  'hsl(216 78% 55%)',
  'hsl(161 50% 43%)',
  'hsl(38 88% 55%)',
  'hsl(277 55% 60%)',
  'hsl(215 16% 65%)',
] as const;

export function Dashboard() {
  const { activeOrganization } = useWorkspace({ requireOrganization: true });
  const router = useRouter();
  const organizationId = activeOrganization?.id;
  const [period, setPeriod] = useState<(typeof periodChoices)[number][0]>('THIS_MONTH');
  const [customFrom, setCustomFrom] = useState(dateString(startOfMonth(new Date())));
  const [customTo, setCustomTo] = useState(dateString(new Date()));
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [fiscalYearsLoaded, setFiscalYearsLoaded] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('All types');
  const [newestFirst, setNewestFirst] = useState(true);

  const range = useMemo(
    () => getRange(period, customFrom, customTo, fiscalYears),
    [period, customFrom, customTo, fiscalYears],
  );
  const load = useCallback(async () => {
    if (!organizationId) return;
    if ((period === 'THIS_FY' || period === 'LAST_FY') && !fiscalYearsLoaded) {
      setLoading(true);
      return;
    }
    setData(null);
    setLoading(true);
    try {
      const query = new URLSearchParams({ from: range.from, to: range.to });
      const result = await apiRequest<{ data: DashboardData }>(
        `/organizations/${organizationId}/dashboard?${query}`,
      );
      setData(result.data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The dashboard could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [organizationId, period, fiscalYearsLoaded, range.from, range.to]);

  useEffect(() => {
    if (!organizationId) return;
    void apiRequest<{ data: FiscalYear[] }>(`/organizations/${organizationId}/periods`)
      .then((result) => setFiscalYears(result.data))
      .catch(() => setFiscalYears([]))
      .finally(() => setFiscalYearsLoaded(true));
  }, [organizationId]);
  useEffect(() => {
    void load();
  }, [load]);

  const transactions = useMemo(() => {
    const rows = data?.recentTransactions ?? [];
    return [
      ...(typeFilter === 'All types' ? rows : rows.filter((row) => row.type === typeFilter)),
    ].sort((a, b) => (newestFirst ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  }, [data, typeFilter, newestFirst]);
  const cashSeries = useMemo(() => {
    let balance = Number(data?.cashFlow.openingBalance ?? 0n) / divisor(data?.currency ?? 'USD');
    return (data?.cashFlow.series ?? []).map((item) => {
      balance += item.movement;
      return { key: item.key, balance };
    });
  }, [data]);

  return (
    <div className="rb-dashboard">
      <PageHeader
        title="Dashboard"
        description="Your business finances at a glance"
        actions={
          <div className="rb-dash-quick-actions">
            {hasPermission(activeOrganization, 'sales.invoices.manage') ? (
              <Button variant="outline" asChild>
                <Link href="/invoices/new">New invoice</Link>
              </Button>
            ) : null}
            {hasPermission(activeOrganization, 'purchases.bills.manage') ? (
              <Button variant="outline" asChild>
                <Link href="/bills/new">New bill</Link>
              </Button>
            ) : null}
            {hasPermission(activeOrganization, 'journals.create') ? (
              <Button asChild>
                <Link href="/journals/new">
                  <FilePlus2 aria-hidden="true" /> New journal
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <section className="rb-dash-toolbar" aria-label="Dashboard reporting controls">
        <label>
          Reporting period
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as typeof period)}
          >
            {periodChoices.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {period === 'CUSTOM' ? (
          <div className="rb-dash-date-range">
            <label>
              From
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(event) => setCustomTo(event.target.value)}
              />
            </label>
          </div>
        ) : null}
        <span className="rb-dash-currency">
          <Landmark aria-hidden="true" /> Reporting currency{' '}
          <strong>{activeOrganization?.baseCurrency ?? '—'}</strong>
        </span>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw aria-hidden="true" /> Refresh
        </Button>
      </section>

      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="rb-dashboard-stats rb-financial-kpis" aria-label="Financial performance">
        <Kpi
          label="Total income"
          icon={TrendingUp}
          amount={data?.summary.income}
          currency={data?.currency}
          loading={loading}
          tone="income"
        />
        <Kpi
          label="Total expenses"
          icon={TrendingDown}
          amount={data?.summary.expenses}
          currency={data?.currency}
          loading={loading}
          tone="expense"
        />
        <Kpi
          label="Net profit"
          icon={data && BigInt(data.summary.netProfit) < 0n ? ArrowDownRight : ArrowUpRight}
          amount={data?.summary.netProfit}
          currency={data?.currency}
          loading={loading}
          tone="profit"
        />
      </section>

      <section
        className="rb-dash-grid rb-dash-grid--charts"
        aria-label="Income, expenses and cash reporting"
      >
        <Card className="rb-dash-panel rb-dash-income">
          <PanelHeading
            title="Income vs expenses"
            description={`${formatDate(range.from)} – ${formatDate(range.to)} · ${data?.grouping ?? 'monthly'} · Accrual basis`}
          />
          {loading ? (
            <ChartLoading />
          ) : data?.incomeExpenses.length ? (
            <div className="rb-dash-chart rb-dash-chart--tall">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.incomeExpenses}
                  margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
                  onClick={(state) => {
                    const key = (state as { activePayload?: { payload?: { key?: string } }[] })
                      ?.activePayload?.[0]?.payload?.key;
                    if (key) {
                      const { from, to } = monthRange(key);
                      router.push(`/reports/financial.profit-loss?from=${from}&to=${to}`);
                    }
                  }}
                >
                  <CartesianGrid stroke="hsl(214 28% 91%)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'hsl(215 16% 47%)' }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={72}
                    tickFormatter={(value) => compactCurrency(value, data.currency)}
                    tick={{ fontSize: 11, fill: 'hsl(215 16% 47%)' }}
                  />
                  <Tooltip formatter={(value) => formatMajor(Number(value), data.currency)} />
                  <Bar name="Income" dataKey="income" fill={palette[0]} radius={[4, 4, 0, 0]} />
                  <Bar name="Expenses" dataKey="expenses" fill={palette[1]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="No recognized activity"
              description="Posted income and expense entries will appear here for this period."
            />
          )}
          <ChartLegend items={['Income', 'Expenses']} colors={[palette[0], palette[1]]} />
        </Card>
        <Card className="rb-dash-panel">
          <PanelHeading title="Top expenses" description="By posted expense account" />
          {loading ? (
            <ChartLoading />
          ) : data?.topExpenses.length ? (
            <>
              <div className="rb-dash-donut">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.topExpenses.map((item) => ({
                        ...item,
                        value: Number(BigInt(item.amount)) / divisor(data.currency),
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="66%"
                      outerRadius="88%"
                      paddingAngle={2}
                    >
                      {data.topExpenses.map((item, index) => (
                        <Cell
                          key={item.name}
                          fill={palette[index % palette.length]}
                          onClick={() => item.href && router.push(item.href)}
                          style={{ cursor: item.href ? 'pointer' : 'default' }}
                        />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatMajor(Number(value), data.currency)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="rb-dash-donut-center">
                  <span>Total expenses</span>
                  <strong>{formatMinor(data.summary.expenses, data.currency)}</strong>
                </div>
              </div>
              <ul className="rb-dash-expense-legend">
                {data.topExpenses.map((item, index) => {
                  const total = BigInt(data.summary.expenses);
                  const share =
                    total > 0n ? Number((BigInt(item.amount) * 10000n) / total) / 100 : 0;
                  return (
                    <li key={item.name}>
                      <i style={{ background: palette[index % palette.length] }} />
                      {item.href ? (
                        <Link href={item.href} title={`View ${item.name} ledger`}>
                          {item.name}
                        </Link>
                      ) : (
                        <span title={item.name}>{item.name}</span>
                      )}
                      <small>{formatMinor(item.amount, data.currency)}</small>
                      <strong>{share.toFixed(1)}%</strong>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <EmptyState
              icon={ReceiptText}
              title="No expenses recorded"
              description="Posted expense and cost-of-sales activity will be grouped by account."
            />
          )}
        </Card>
      </section>

      <section
        className="rb-dash-grid rb-dash-grid--obligations"
        aria-label="Receivables and payables"
      >
        <AgingPanel
          title="Receivables"
          subtitle="Unpaid customer invoices"
          aging={data?.receivables}
          currency={data?.currency}
          loading={loading}
          unavailable={data?.agingUnavailableReason}
          href={data?.capabilities.receivables ? '/invoices' : null}
        />
        <AgingPanel
          title="Payables"
          subtitle="Unpaid vendor bills"
          aging={data?.payables}
          currency={data?.currency}
          loading={loading}
          unavailable={data?.agingUnavailableReason}
          href={data?.capabilities.payables ? '/bills' : null}
        />
      </section>

      <Card className="rb-dash-panel rb-dash-cash">
        <PanelHeading
          title="Cash flow"
          description="Posted cash and bank ledger movements. Transfers are consolidated; FX and opening entries are separated from operating flows."
        />
        {loading ? (
          <ChartLoading />
        ) : data?.cashFlow.closingBalance === null ? (
          <EmptyState
            icon={Banknote}
            title="Cash balance unavailable"
            description="Link a cash or bank ledger account to a financial account to report cash movement."
          />
        ) : (
          <>
            <div className="rb-dash-cash-summary">
              <Metric
                label="Opening balance"
                amount={data?.cashFlow.openingBalance ?? null}
                currency={data?.currency}
              />
              <Metric
                label="Cash inflows"
                amount={data?.cashFlow.inflows ?? null}
                currency={data?.currency}
              />
              <Metric
                label="Cash outflows"
                amount={data?.cashFlow.outflows ?? null}
                currency={data?.currency}
              />
              <Metric
                label="Closing balance"
                amount={data?.cashFlow.closingBalance ?? null}
                currency={data?.currency}
              />
            </div>
            {data && BigInt(data.cashFlow.adjustments) !== 0n ? (
              <p className="rb-dash-adjustments">
                FX and opening-balance adjustments:{' '}
                {formatMinor(data.cashFlow.adjustments, data.currency)}
              </p>
            ) : null}
            <div className="rb-dash-chart rb-dash-chart--cash">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={cashSeries}
                  margin={{ top: 10, right: 10, bottom: 0, left: 8 }}
                  onClick={() =>
                    router.push(`/reports/financial.cash-flow?from=${range.from}&to=${range.to}`)
                  }
                >
                  <CartesianGrid stroke="hsl(214 28% 91%)" vertical={false} />
                  <XAxis
                    dataKey="key"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'hsl(215 16% 47%)' }}
                  />
                  <YAxis
                    width={82}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => compactCurrency(value, data?.currency ?? 'USD')}
                    tick={{ fontSize: 11, fill: 'hsl(215 16% 47%)' }}
                  />
                  <Tooltip
                    formatter={(value) => formatMajor(Number(value), data?.currency ?? 'USD')}
                  />
                  <Line
                    name="Cash balance"
                    dataKey="balance"
                    stroke={palette[0]}
                    strokeWidth={2.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Card>

      <section
        className="rb-dash-grid rb-dash-grid--lower"
        aria-label="Recent activity and actions"
      >
        <Card className="rb-dash-panel rb-dash-transactions">
          <div className="rb-dash-panel-heading">
            <PanelHeading
              title="Recent transactions"
              description="Latest posted accounting activity"
            />
            <label className="rb-dash-filter">
              <span className="sr-only">Filter transaction type</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option>All types</option>
                {[...new Set((data?.recentTransactions ?? []).map((row) => row.type))].map(
                  (type) => (
                    <option key={type}>{type}</option>
                  ),
                )}
              </select>
            </label>
          </div>
          {loading ? (
            <ChartLoading />
          ) : transactions.length ? (
            <div className="rb-dash-table-wrap">
              <table className="rb-dash-table">
                <thead>
                  <tr>
                    <th>
                      <button
                        className="rb-dash-sort"
                        onClick={() => setNewestFirst((value) => !value)}
                      >
                        Date <span aria-hidden="true">{newestFirst ? '↓' : '↑'}</span>
                        <span className="sr-only">
                          , sort {newestFirst ? 'newest first' : 'oldest first'}
                        </span>
                      </button>
                    </th>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th className="is-right">Amount</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDate(item.date)}</td>
                      <td>{item.type}</td>
                      <td>
                        {item.href ? (
                          <Link href={item.href}>{item.reference}</Link>
                        ) : (
                          item.reference
                        )}
                      </td>
                      <td className="rb-dash-description">{item.description}</td>
                      <td>
                        <span className="rb-dash-status">Posted</span>
                      </td>
                      <td className="is-right">
                        {formatMinor(item.amount, data?.currency ?? 'USD')}
                      </td>
                      <td>{item.href ? <Link href={item.href}>Open</Link> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={ReceiptText}
              title="No transactions yet"
              description="Posted invoices, bills, payments and journals will appear here."
            />
          )}
          <Link className="rb-dash-view-all" href="/journals">
            View all transactions <ArrowUpRight aria-hidden="true" />
          </Link>
        </Card>
        <Card className="rb-dash-panel rb-dash-actions">
          <PanelHeading title="Action center" description="Items that may need your attention" />
          {loading ? (
            <ChartLoading />
          ) : data?.actions.length ? (
            <ul className="rb-dash-action-list">
              {data.actions.map((action) => (
                <li key={action.title}>
                  <span className={action.severity === 'warning' ? 'is-warning' : ''}>
                    <CircleAlert aria-hidden="true" />
                  </span>
                  <Link href={action.href}>
                    <strong>{action.title}</strong>
                    <small>
                      {action.count} {action.count === 1 ? 'item' : 'items'}
                    </small>
                  </Link>
                  <ArrowUpRight aria-hidden="true" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="You’re all caught up"
              description="No outstanding accounting actions right now."
            />
          )}
        </Card>
      </section>
    </div>
  );
}

function Kpi({
  label,
  icon: Icon,
  amount,
  currency,
  loading,
  tone,
}: {
  label: string;
  icon: typeof TrendingUp;
  amount?: string;
  currency?: string;
  loading: boolean;
  tone: string;
}) {
  return (
    <Card className={`rb-dash-kpi is-${tone}`}>
      <div className="rb-dash-kpi-top">
        <span>{label}</span>
        <Icon aria-hidden="true" />
      </div>
      <strong>
        {loading
          ? 'Loading…'
          : amount !== undefined && currency
            ? formatMinor(amount, currency)
            : '—'}
      </strong>
      <small>{loading ? ' ' : 'For selected period'}</small>
    </Card>
  );
}

function PanelHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="rb-dash-panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function AgingPanel({
  title,
  subtitle,
  aging,
  currency,
  loading,
  unavailable,
  href,
}: {
  title: string;
  subtitle: string;
  aging?: Aging | null;
  currency?: string;
  loading: boolean;
  unavailable?: string | null;
  href: string | null;
}) {
  return (
    <Card className="rb-dash-panel rb-dash-aging">
      <div className="rb-dash-panel-heading">
        <PanelHeading title={title} description={subtitle} />
        {href ? (
          <Link href={href}>
            View open <ArrowUpRight aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {loading ? (
        <ChartLoading />
      ) : unavailable || !aging?.available ? (
        <p className="rb-dash-unavailable">
          {unavailable ??
            'Aging unavailable because open items use currencies different from the reporting currency.'}
        </p>
      ) : (
        <>
          <div className="rb-dash-aging-total">
            <span>Total outstanding</span>
            <strong>{formatMinor(aging.total, currency ?? 'USD')}</strong>
          </div>
          <div className="rb-dash-aging-bar" aria-label="Aging breakdown">
            {aging.buckets.map((bucket, index) => (
              <i
                key={bucket.label}
                title={`${bucket.label}: ${formatMinor(bucket.amount, currency ?? 'USD')}`}
                style={{
                  width: `${Number((BigInt(bucket.amount) * 10000n) / (BigInt(aging.total) || 1n)) / 100}%`,
                  background: palette[index],
                }}
              />
            ))}
          </div>
          <ul className="rb-dash-aging-list">
            {aging.buckets.map((bucket, index) => (
              <li key={bucket.label}>
                <i style={{ background: palette[index] }} />
                <span>{bucket.label}</span>
                <strong>{formatMinor(bucket.amount, currency ?? 'USD')}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Metric({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: string | null;
  currency?: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{amount === null ? 'Unavailable' : formatMinor(amount, currency ?? 'USD')}</strong>
    </div>
  );
}

function ChartLegend({ items, colors }: { items: string[]; colors: string[] }) {
  return (
    <div className="rb-dash-legend">
      {items.map((item, index) => (
        <span key={item}>
          <i style={{ background: colors[index] }} />
          {item}
        </span>
      ))}
    </div>
  );
}

function ChartLoading() {
  return (
    <div className="rb-dash-loading" aria-label="Loading dashboard data">
      <Skeleton />
      <Skeleton />
    </div>
  );
}

function formatMinor(minor: string, currency: string) {
  const value = BigInt(minor);
  const digits = fractionDigits(currency);
  const scale = 10n ** BigInt(digits);
  const whole = value / scale;
  const fraction = (value < 0n ? -value : value) % scale;
  const major = Number(whole);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(digits ? major + (Number(fraction) / Number(scale)) * (value < 0n ? -1 : 1) : major);
}
function formatMajor(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: fractionDigits(currency),
  }).format(value);
}
function compactCurrency(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}
function fractionDigits(currency: string) {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}
function divisor(currency: string) {
  return 10 ** fractionDigits(currency);
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}
function dateString(value: Date) {
  return value.toISOString().slice(0, 10);
}
function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function monthRange(key: string) {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(key);
  if (quarter) {
    const year = Number(quarter[1]);
    const month = (Number(quarter[2]) - 1) * 3;
    return {
      from: dateString(new Date(Date.UTC(year, month, 1))),
      to: dateString(new Date(Date.UTC(year, month + 3, 0))),
    };
  }
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return {
    from: `${key}-01`,
    to: dateString(new Date(Date.UTC(year, month, 0))),
  };
}
function getRange(period: string, customFrom: string, customTo: string, years: FiscalYear[]) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = dateString(now);
  if (period === 'CUSTOM') return { from: customFrom, to: customTo };
  if (period === 'LAST_MONTH') {
    const date = new Date(Date.UTC(year, month - 1, 1));
    return { from: dateString(date), to: dateString(new Date(Date.UTC(year, month, 0))) };
  }
  if (period === 'THIS_QUARTER') {
    const start = Math.floor(month / 3) * 3;
    return { from: dateString(new Date(Date.UTC(year, start, 1))), to: today };
  }
  if (period === 'THIS_FY' || period === 'LAST_FY') {
    const sorted = [...years].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    const current = sorted.find((item) => item.startsOn <= today && item.endsOn >= today);
    const selected =
      period === 'LAST_FY' && current ? sorted[sorted.indexOf(current) - 1] : current;
    if (selected)
      return {
        from: selected.startsOn.slice(0, 10),
        to: period === 'THIS_FY' ? today : selected.endsOn.slice(0, 10),
      };
  }
  if (period === 'THIS_MONTH') return { from: dateString(startOfMonth(now)), to: today };
  return { from: `${year}-01-01`, to: today };
}
