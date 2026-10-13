'use client';

import {
  Badge,
  Button,
  Card,
  DataTable,
  DataTableToolbar,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@valuebooks/ui';
import {
  AlertTriangle,
  ArrowDownRight,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  FileSearch,
  PackageSearch,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ApiError, apiRequest } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

interface VarianceInsight {
  suggestionId: string;
  categoryId: string;
  categoryName: string;
  currentMinor: string;
  baselineMinor: string;
  variancePercent: number | null;
  direction: 'increase' | 'decrease' | 'new';
  reason: string;
}

interface CloseChecklist {
  unreconciledAccounts: {
    financialAccountId: string;
    accountName: string;
    lastCompletedAt: string | null;
  }[];
  pendingApprovals: number;
  missingDocumentExpenses: { id: string; expenseNumber: string | null; amountMinor: string }[];
  unresolvedBankTransactions: number;
  staleDraftCount: number;
}

interface CashFlowWeek {
  weekStart: string;
  expectedInflowsMinor: string;
  expectedOutflowsMinor: string;
  cumulativeBalanceMinor: string;
}

interface CashFlowScenario {
  openingBalanceMinor: string;
  onTime: CashFlowWeek[];
  delayedReceipts: CashFlowWeek[];
}

interface CollectionsCandidate {
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string;
  balanceMinor: string;
  daysOverdue: number;
  exposureScore: number;
  suggestedAction: string;
}

interface PurchasingAdvice {
  itemId: string;
  itemName: string;
  warehouseName: string;
  quantityOnHand: string;
  reorderPoint: string;
  suggestedOrderQuantity: string;
  averageDailyOutflow: number;
  daysOfStockRemaining: number | null;
  urgent: boolean;
}

interface ProjectMarginAdvice {
  projectId: string;
  projectName: string;
  unbilledTimeMinor: string;
  unbilledExpenseMinor: string;
  revenueMinor: string | null;
  costMinor: string | null;
  grossProfitMinor: string | null;
  budgetAmountMinor: string | null;
  budgetUtilizationPercent: number | null;
  currentMarginPercent: number | null;
  priorMarginPercent: number | null;
  marginErosion: boolean;
}

interface PolicyQaResult {
  source: 'COUNTRY_PACK' | 'TAX_PACK' | 'DOCUMENT_RULE';
  packCode: string;
  packVersion: string;
  documentType: string | null;
  text: string;
}

interface AuditEvidencePack {
  entityType: string;
  entityId: string;
  auditEvents: {
    eventKey: string;
    action: string;
    occurredAt: string;
    actorUserId: string | null;
  }[];
  attachments: { id: string; filename: string; createdAt: string }[];
  approvalRequests: {
    id: string;
    status: string;
    submittedAt: string;
    decisions: { decision: string; createdAt: string; comment: string | null }[];
  }[];
  journal: { id: string; reference: string | null; status: string; postedAt: string | null } | null;
  reversalJournal: { id: string; reference: string | null; postedAt: string | null } | null;
}

interface EvidenceRecord {
  id: string;
  reference: string;
  contact: string | null;
  status: string | null;
}

/**
 * Deterministic advisory signals (Phase 13E/13F): variance, month-end close checklist, cash-flow
 * scenarios, collections prioritization, inventory purchasing, project margin erosion, country-pack
 * policy Q&A, and audit evidence packs. Every panel here is a read-only view over existing records --
 * nothing on this page mutates a financial record, sends anything, or calls a model.
 */
export function InsightsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const currency = organization?.baseCurrency ?? 'USD';

  const [insights, setInsights] = useState<VarianceInsight[] | null>(null);
  const [checklist, setChecklist] = useState<CloseChecklist | null>(null);
  const [collectionsPreview, setCollectionsPreview] = useState<CollectionsCandidate[] | null>(null);
  const [inventoryPreview, setInventoryPreview] = useState<PurchasingAdvice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [varianceResponse, checklistResponse, collectionsResponse, inventoryResponse] =
        await Promise.all([
          apiRequest<{ data: VarianceInsight[] }>(
            `/organizations/${organizationId}/insights/variance`,
          ),
          apiRequest<{ data: CloseChecklist }>(
            `/organizations/${organizationId}/insights/close-checklist`,
          ),
          apiRequest<{ data: CollectionsCandidate[] }>(
            `/organizations/${organizationId}/insights/collections`,
          ),
          apiRequest<{ data: PurchasingAdvice[] }>(
            `/organizations/${organizationId}/insights/inventory-purchasing`,
          ),
        ]);
      setInsights(varianceResponse.data);
      setChecklist(checklistResponse.data);
      setCollectionsPreview(collectionsResponse.data);
      setInventoryPreview(inventoryResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Insights could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(suggestionId: string) {
    if (!organizationId) return;
    setBusy(suggestionId);
    try {
      await apiRequest(`/organizations/${organizationId}/ai/suggestions/${suggestionId}/dismiss`, {
        method: 'POST',
      });
      setInsights(
        (current) => current?.filter((item) => item.suggestionId !== suggestionId) ?? null,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That could not be dismissed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Financial insights"
        description="Traceable, organization-scoped signals from posted activity and operating records."
      />
      <div className="rb-ledger-stack">
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}

        <Tabs defaultValue="overview" className="rb-ledger-stack">
          <TabsList aria-label="Insight categories">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="cash-flow">Cash flow</TabsTrigger>
            <TabsTrigger value="collections">Collections</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="project-margins">Project margins</TabsTrigger>
            <TabsTrigger value="policy-qa">Policy Q&amp;A</TabsTrigger>
            <TabsTrigger value="audit-evidence">Audit evidence</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewPanel
              checklist={checklist}
              insights={insights}
              collections={collectionsPreview}
              inventory={inventoryPreview}
              currency={currency}
              error={error}
              busy={busy}
              onDismiss={dismiss}
            />
          </TabsContent>

          <TabsContent value="cash-flow">
            <CashFlowPanel organizationId={organizationId} currency={currency} />
          </TabsContent>

          <TabsContent value="collections">
            <CollectionsPanel organizationId={organizationId} currency={currency} />
          </TabsContent>

          <TabsContent value="inventory">
            <InventoryPanel organizationId={organizationId} />
          </TabsContent>

          <TabsContent value="project-margins">
            <ProjectMarginsPanel organizationId={organizationId} currency={currency} />
          </TabsContent>

          <TabsContent value="policy-qa">
            <PolicyQaPanel organizationId={organizationId} />
          </TabsContent>

          <TabsContent value="audit-evidence">
            <AuditEvidencePanel organizationId={organizationId} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function OverviewPanel({
  checklist,
  insights,
  collections,
  inventory,
  currency,
  error,
  busy,
  onDismiss,
}: {
  checklist: CloseChecklist | null;
  insights: VarianceInsight[] | null;
  collections: CollectionsCandidate[] | null;
  inventory: PurchasingAdvice[] | null;
  currency: string;
  error: string | null;
  busy: string | null;
  onDismiss: (suggestionId: string) => Promise<void>;
}) {
  const pendingControls = checklist
    ? checklist.pendingApprovals +
      checklist.unresolvedBankTransactions +
      checklist.missingDocumentExpenses.length +
      checklist.staleDraftCount +
      checklist.unreconciledAccounts.length
    : null;
  const overdueTotal = collections?.reduce((total, item) => total + BigInt(item.balanceMinor), 0n);
  const actionable =
    (insights?.length ?? 0) + (collections?.length ?? 0) + (inventory?.length ?? 0);
  const checklistItems: { title: string; count: number; href: string }[] = checklist
    ? [
        {
          title: 'Reconcile bank accounts',
          count: checklist.unreconciledAccounts.length,
          href: '/banking',
        },
        {
          title: 'Resolve pending approvals',
          count: checklist.pendingApprovals,
          href: '/approvals',
        },
        {
          title: 'Attach supporting documents',
          count: checklist.missingDocumentExpenses.length,
          href: '/expenses',
        },
        {
          title: 'Resolve bank transactions',
          count: checklist.unresolvedBankTransactions,
          href: '/banking',
        },
        { title: 'Review stale drafts', count: checklist.staleDraftCount, href: '/bills' },
      ]
    : [];
  const complete = checklistItems.filter((item) => item.count === 0).length;

  return (
    <div className="rb-insights-stack">
      <section className="rb-insights-summary" aria-label="Financial priorities">
        <InsightMetric
          label="Actionable signals"
          value={actionable === 0 && insights ? 'All clear' : `${actionable}`}
          icon={AlertTriangle}
          tone="warning"
          detail="Items ranked from live finance and operations records."
        />
        <InsightMetric
          label="Overdue receivables"
          value={
            overdueTotal === undefined ? 'Loading' : formatMinor(overdueTotal.toString(), currency)
          }
          icon={CircleDollarSign}
          tone="danger"
          detail={`${collections?.length ?? 0} overdue invoice${collections?.length === 1 ? '' : 's'}`}
          href="/invoices"
        />
        <InsightMetric
          label="Low-stock risks"
          value={inventory === null ? 'Loading' : `${inventory.length}`}
          icon={PackageSearch}
          tone="warning"
          detail="Items at or below their reorder point."
          href="/inventory"
        />
        <InsightMetric
          label="Pending controls"
          value={pendingControls === null ? 'Loading' : `${pendingControls}`}
          icon={ClipboardCheck}
          tone="neutral"
          detail="Month-end review items still open."
        />
      </section>

      <section className="rb-insights-grid" aria-label="Insights overview">
        <Card className="rb-insights-panel rb-insights-panel--wide">
          <div className="rb-insights-panel__heading">
            <div>
              <h2>Month-end checklist</h2>
              <p>
                {checklist
                  ? `${complete} of ${checklistItems.length} controls complete`
                  : 'Loading controls…'}
              </p>
            </div>
            <ClipboardCheck aria-hidden="true" />
          </div>
          {checklist === null && !error ? <Skeleton /> : null}
          {checklist ? (
            <ul className="rb-insights-checklist">
              {checklistItems.map((item) => (
                <li key={item.title}>
                  {item.count === 0 ? (
                    <CheckCircle2 className="is-complete" aria-hidden="true" />
                  ) : (
                    <AlertTriangle aria-hidden="true" />
                  )}
                  <Link href={item.href}>{item.title}</Link>
                  <span>{item.count === 0 ? 'Complete' : `${item.count} open`}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card className="rb-insights-panel">
          <div className="rb-insights-panel__heading">
            <div>
              <h2>Collections priority</h2>
              <p>Highest exposure is calculated from open balance and days overdue.</p>
            </div>
            <ArrowDownRight aria-hidden="true" />
          </div>
          {collections?.length ? (
            <div className="rb-insights-compact-list">
              {collections.slice(0, 3).map((item) => (
                <Link key={item.invoiceId} href={`/invoices/${item.invoiceId}`}>
                  <span>
                    <strong>{item.customerName}</strong>
                    <small>
                      {item.invoiceNumber ?? 'Draft invoice'} · {item.daysOverdue} days overdue
                    </small>
                  </span>
                  <b>{formatMinor(item.balanceMinor, currency)}</b>
                </Link>
              ))}
            </div>
          ) : collections ? (
            <p className="rb-muted">No overdue invoices need follow-up.</p>
          ) : (
            <Skeleton />
          )}
        </Card>
      </section>

      <section aria-labelledby="spend-signals-heading">
        <div className="rb-insights-section-heading">
          <div>
            <h2 id="spend-signals-heading">Spending changes to review</h2>
            <p>
              Compared with the trailing average for the same category. New first-time expenses are
              shown as context, not flagged as suspicious.
            </p>
          </div>
        </div>
        {insights === null && !error ? <Skeleton /> : null}
        {insights && insights.length === 0 ? (
          <EmptyState
            title="Nothing notable"
            description="No category is significantly above or below its trailing average this month."
          />
        ) : null}
        <div className="rb-insights-findings">
          {insights?.map((insight) => (
            <Card key={insight.suggestionId} className="rb-insight-finding">
              <div>
                <Badge tone={insight.direction === 'increase' ? 'warning' : 'neutral'}>
                  {insight.direction === 'new'
                    ? 'New category'
                    : `${insight.direction} vs baseline`}
                </Badge>
                <h3>{insight.categoryName}</h3>
                <p>{insight.reason}</p>
              </div>
              <div className="rb-insight-finding__amount">
                <strong>{formatMinor(insight.currentMinor, currency)}</strong>
                <span>Baseline {formatMinor(insight.baselineMinor, currency)}</span>
                {insight.variancePercent !== null ? (
                  <small>{Math.abs(insight.variancePercent).toFixed(1)}% variance</small>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={busy === insight.suggestionId}
                onClick={() => void onDismiss(insight.suggestionId)}
              >
                Dismiss
              </Button>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function InsightMetric({
  label,
  value,
  icon: Icon,
  detail,
  href,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof AlertTriangle;
  detail: string;
  href?: string;
  tone: 'warning' | 'danger' | 'neutral';
}) {
  const content = (
    <>
      <span className={`rb-insights-metric__icon is-${tone}`}>
        <Icon aria-hidden="true" />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </>
  );
  return href ? (
    <Link className="rb-insights-metric" href={href}>
      {content}
    </Link>
  ) : (
    <div className="rb-insights-metric">{content}</div>
  );
}

function CashFlowPanel({
  organizationId,
  currency,
}: {
  organizationId: string | null;
  currency: string;
}) {
  const [scenario, setScenario] = useState<CashFlowScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    apiRequest<{ data: CashFlowScenario }>(`/organizations/${organizationId}/insights/cash-flow`)
      .then((response) => setScenario(response.data))
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Cash flow could not be loaded.'),
      );
  }, [organizationId]);

  if (error) {
    return (
      <div className="rb-auth-error" role="alert">
        {error}
      </div>
    );
  }
  if (!scenario) return <Skeleton />;

  const chartData = scenario.onTime.map((week, index) => ({
    label: formatWeek(week.weekStart),
    onTime: minorToMajor(week.cumulativeBalanceMinor),
    delayed: minorToMajor(scenario.delayedReceipts[index]?.cumulativeBalanceMinor ?? '0'),
  }));
  const onTimeClosing =
    scenario.onTime.at(-1)?.cumulativeBalanceMinor ?? scenario.openingBalanceMinor;
  const delayedClosing =
    scenario.delayedReceipts.at(-1)?.cumulativeBalanceMinor ?? scenario.openingBalanceMinor;
  const lowest = scenario.onTime.reduce(
    (minimum, week) =>
      BigInt(week.cumulativeBalanceMinor) < BigInt(minimum) ? week.cumulativeBalanceMinor : minimum,
    scenario.openingBalanceMinor,
  );

  return (
    <div className="rb-insights-stack">
      <section
        className="rb-insights-summary rb-insights-summary--three"
        aria-label="Cash position summary"
      >
        <InsightMetric
          label="Opening cash"
          value={formatMinor(scenario.openingBalanceMinor, currency)}
          icon={CircleDollarSign}
          tone="neutral"
          detail="Posted cash and bank ledger position."
        />
        <InsightMetric
          label="Projected closing"
          value={formatMinor(onTimeClosing, currency)}
          icon={TrendingUp}
          tone={BigInt(onTimeClosing) < 0n ? 'danger' : 'neutral'}
          detail="Assumes open invoices are received on their due dates."
        />
        <InsightMetric
          label="Lowest projected balance"
          value={formatMinor(lowest, currency)}
          icon={BigInt(lowest) < 0n ? AlertTriangle : TrendingDown}
          tone={BigInt(lowest) < 0n ? 'danger' : 'warning'}
          detail={
            BigInt(lowest) < 0n
              ? 'A shortfall appears in the on-time scenario.'
              : 'No on-time shortfall in the next 12 weeks.'
          }
        />
      </section>
      <Card className="rb-insights-panel">
        <div className="rb-insights-panel__heading">
          <div>
            <h2>12-week cash outlook</h2>
            <p>
              Open receivables and payables are bucketed by due date. The delayed scenario shifts
              the same receivables by 30 days; it is not a probability forecast.
            </p>
          </div>
          <StatusBadge status={BigInt(lowest) < 0n ? 'Overdue' : 'Approved'} />
        </div>
        <div className="rb-insights-chart" aria-label="12-week cash flow chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 12, bottom: 0, left: 8 }}>
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
                width={76}
                tickFormatter={(value) => compactCurrency(value, currency)}
                tick={{ fontSize: 11, fill: 'hsl(215 16% 47%)' }}
              />
              <Tooltip formatter={(value) => formatMajor(Number(value), currency)} />
              <Legend />
              <Line
                name="On-time receipts"
                type="monotone"
                dataKey="onTime"
                stroke="hsl(var(--rb-primary))"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                name="Receipts delayed 30 days"
                type="monotone"
                dataKey="delayed"
                stroke="hsl(var(--rb-warning))"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card className="rb-insights-panel">
        <div className="rb-insights-panel__heading">
          <div>
            <h2>Weekly movement</h2>
            <p>
              Use the scenarios to plan timing, then review the source invoices and bills before
              acting.
            </p>
          </div>
          <span className="rb-muted">Delayed close {formatMinor(delayedClosing, currency)}</span>
        </div>
        <div className="rb-table-scroll">
          <table className="rb-table rb-table--listing">
            <thead>
              <tr>
                <th>Week of</th>
                <th>Inflows</th>
                <th>Outflows</th>
                <th>Cumulative (on time)</th>
                <th>Cumulative (delayed receipts)</th>
              </tr>
            </thead>
            <tbody>
              {scenario.onTime.map((week, index) => (
                <tr key={week.weekStart}>
                  <td>{week.weekStart}</td>
                  <td>{formatMinor(week.expectedInflowsMinor, currency)}</td>
                  <td>{formatMinor(week.expectedOutflowsMinor, currency)}</td>
                  <td>{formatMinor(week.cumulativeBalanceMinor, currency)}</td>
                  <td>
                    {formatMinor(
                      scenario.delayedReceipts[index]?.cumulativeBalanceMinor ?? '0',
                      currency,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function CollectionsPanel({
  organizationId,
  currency,
}: {
  organizationId: string | null;
  currency: string;
}) {
  const [candidates, setCandidates] = useState<CollectionsCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    apiRequest<{ data: CollectionsCandidate[] }>(
      `/organizations/${organizationId}/insights/collections`,
    )
      .then((response) => setCandidates(response.data))
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Collections could not be loaded.'),
      );
  }, [organizationId]);

  if (error) {
    return (
      <div className="rb-auth-error" role="alert">
        {error}
      </div>
    );
  }
  if (!candidates) return <Skeleton />;
  if (candidates.length === 0) {
    return (
      <EmptyState title="Nothing overdue" description="No open invoice is past its due date." />
    );
  }

  const total = candidates.reduce((sum, candidate) => sum + BigInt(candidate.balanceMinor), 0n);
  const bands = [
    { label: '1–30 days', amount: candidates.filter((row) => row.daysOverdue <= 30) },
    {
      label: '31–60 days',
      amount: candidates.filter((row) => row.daysOverdue > 30 && row.daysOverdue <= 60),
    },
    { label: '61+ days', amount: candidates.filter((row) => row.daysOverdue > 60) },
  ];
  const rows = candidates.map((candidate) => ({ ...candidate, id: candidate.invoiceId }));
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    {
      key: 'invoice',
      header: 'Invoice',
      cell: (row: CollectionsCandidate) => (
        <div>
          <strong>
            <Link href={`/invoices/${row.invoiceId}`}>{row.invoiceNumber ?? 'Invoice'}</Link>
          </strong>
          <span className="rb-table-secondary">{row.customerName}</span>
        </div>
      ),
    },
    {
      key: 'overdue',
      header: 'Overdue',
      cell: (row: CollectionsCandidate) => (
        <Badge tone={row.daysOverdue > 60 ? 'danger' : 'warning'}>{row.daysOverdue} days</Badge>
      ),
    },
    {
      key: 'action',
      header: 'Recommended follow-up',
      cell: (row: CollectionsCandidate) => row.suggestedAction,
      hideBelow: 'tablet' as const,
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right' as const,
      cell: (row: CollectionsCandidate) => formatMinor(row.balanceMinor, currency),
    },
  ];

  return (
    <div className="rb-ledger-stack">
      <section
        className="rb-insights-summary rb-insights-summary--three"
        aria-label="Collections summary"
      >
        <InsightMetric
          label="Total overdue"
          value={formatMinor(total.toString(), currency)}
          icon={CircleDollarSign}
          tone="danger"
          detail="Open invoices past their recorded due date."
        />
        <InsightMetric
          label="Invoices overdue"
          value={`${candidates.length}`}
          icon={FileSearch}
          tone="warning"
          detail="Prioritized by balance × days overdue."
        />
        <InsightMetric
          label="60+ day exposure"
          value={formatMinor(
            bands[2]!.amount.reduce((sum, row) => sum + BigInt(row.balanceMinor), 0n).toString(),
            currency,
          )}
          icon={AlertTriangle}
          tone="danger"
          detail="Review directly before escalating collection activity."
        />
      </section>
      <Card className="rb-insights-panel">
        <div className="rb-insights-panel__heading">
          <div>
            <h2>Aging breakdown</h2>
            <p>
              Amounts are based on current invoice balances; reminder history is shown on the
              invoice record where available.
            </p>
          </div>
        </div>
        <div className="rb-insights-aging">
          {bands.map((band) => (
            <div key={band.label}>
              <span>{band.label}</span>
              <strong>
                {formatMinor(
                  band.amount.reduce((sum, row) => sum + BigInt(row.balanceMinor), 0n).toString(),
                  currency,
                )}
              </strong>
              <small>
                {band.amount.length} invoice{band.amount.length === 1 ? '' : 's'}
              </small>
            </div>
          ))}
        </div>
      </Card>
      <DataTable
        caption="Overdue invoices"
        columns={columns}
        rows={rows}
        emptyTitle="Nothing overdue"
      />
    </div>
  );
}

function InventoryPanel({ organizationId }: { organizationId: string | null }) {
  const [advice, setAdvice] = useState<PurchasingAdvice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    apiRequest<{ data: PurchasingAdvice[] }>(
      `/organizations/${organizationId}/insights/inventory-purchasing`,
    )
      .then((response) => setAdvice(response.data))
      .catch((caught) =>
        setError(
          caught instanceof ApiError ? caught.message : 'Purchasing advice could not be loaded.',
        ),
      );
  }, [organizationId]);

  if (error) {
    return (
      <div className="rb-auth-error" role="alert">
        {error}
      </div>
    );
  }
  if (!advice) return <Skeleton />;
  if (advice.length === 0) {
    return (
      <EmptyState
        title="No reorders needed"
        description="No item is at or below its reorder threshold."
      />
    );
  }

  const rows = advice.map((item) => ({ ...item, id: `${item.itemId}-${item.warehouseName}` }));
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    {
      key: 'item',
      header: 'Item',
      cell: (row: PurchasingAdvice) => (
        <strong>
          <Link href="/catalog/items">{row.itemName}</Link>
        </strong>
      ),
    },
    { key: 'warehouse', header: 'Warehouse', cell: (row: PurchasingAdvice) => row.warehouseName },
    {
      key: 'on-hand',
      header: 'Current stock',
      align: 'right' as const,
      cell: (row: PurchasingAdvice) => formatQuantity(row.quantityOnHand),
    },
    {
      key: 'reorder',
      header: 'Reorder point',
      align: 'right' as const,
      cell: (row: PurchasingAdvice) => formatQuantity(row.reorderPoint),
      hideBelow: 'tablet' as const,
    },
    {
      key: 'order',
      header: 'Suggested order',
      align: 'right' as const,
      cell: (row: PurchasingAdvice) => formatQuantity(row.suggestedOrderQuantity),
    },
    {
      key: 'days',
      header: 'Days remaining',
      cell: (row: PurchasingAdvice) =>
        row.daysOfStockRemaining === null
          ? 'Unavailable — no recent outflow'
          : `${formatQuantity(row.daysOfStockRemaining)} days`,
    },
    {
      key: 'risk',
      header: 'Risk',
      cell: (row: PurchasingAdvice) => <StatusBadge status={row.urgent ? 'Overdue' : 'Pending'} />,
    },
  ];

  return (
    <div className="rb-insights-stack">
      <section className="rb-insights-section-heading">
        <div>
          <h2>Stock at risk</h2>
          <p>
            Reorder advice uses current stock and configured reorder settings. Days remaining is
            estimated only from the last 30 days of real outflow.
          </p>
        </div>
        <Badge tone="danger">{advice.filter((item) => item.urgent).length} urgent</Badge>
      </section>
      <DataTable
        caption="Inventory purchasing advice"
        columns={columns}
        rows={rows}
        emptyTitle="No reorders needed"
      />
    </div>
  );
}

function ProjectMarginsPanel({
  organizationId,
  currency,
}: {
  organizationId: string | null;
  currency: string;
}) {
  const [advice, setAdvice] = useState<ProjectMarginAdvice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    apiRequest<{ data: ProjectMarginAdvice[] }>(
      `/organizations/${organizationId}/insights/project-margins`,
    )
      .then((response) => setAdvice(response.data))
      .catch((caught) =>
        setError(
          caught instanceof ApiError ? caught.message : 'Project margins could not be loaded.',
        ),
      );
  }, [organizationId]);

  if (error) {
    return (
      <div className="rb-auth-error" role="alert">
        {error}
      </div>
    );
  }
  if (!advice) return <Skeleton />;
  if (advice.length === 0) {
    return (
      <EmptyState
        title="Nothing unbilled"
        description="No project has unbilled time or expense right now."
      />
    );
  }

  return (
    <div className="rb-insights-stack">
      <section className="rb-insights-section-heading">
        <div>
          <h2>Project profitability watch</h2>
          <p>
            Margin is calculated from posted project revenue less posted project costs over the
            current 30-day period. Historical comparison is unavailable when there is no preceding
            posted period.
          </p>
        </div>
      </section>
      {advice.map((project) => (
        <Card key={project.projectId} className="rb-insight-project">
          <div className="rb-insights-panel__heading">
            <div>
              <h3>
                <Link href={`/projects/${project.projectId}`}>{project.projectName}</Link>
              </h3>
              <p>Unbilled work needs review before the next billing cycle.</p>
            </div>
            {project.marginErosion ? (
              <StatusBadge status="Overdue" />
            ) : (
              <StatusBadge status="Approved" />
            )}
          </div>
          <div className="rb-insight-project__metrics">
            <div>
              <span>Revenue</span>
              <strong>
                {project.revenueMinor === null
                  ? 'Unavailable'
                  : formatMinor(project.revenueMinor, currency)}
              </strong>
            </div>
            <div>
              <span>Costs</span>
              <strong>
                {project.costMinor === null
                  ? 'Unavailable'
                  : formatMinor(project.costMinor, currency)}
              </strong>
            </div>
            <div>
              <span>Gross profit</span>
              <strong>
                {project.grossProfitMinor === null
                  ? 'Unavailable'
                  : formatMinor(project.grossProfitMinor, currency)}
              </strong>
            </div>
            <div>
              <span>Current margin</span>
              <strong>
                {project.currentMarginPercent === null
                  ? 'Unavailable'
                  : `${project.currentMarginPercent.toFixed(1)}%`}
              </strong>
            </div>
            <div>
              <span>Prior period</span>
              <strong>
                {project.priorMarginPercent === null
                  ? 'Unavailable'
                  : `${project.priorMarginPercent.toFixed(1)}%`}
              </strong>
            </div>
            <div>
              <span>Unbilled time</span>
              <strong>{formatMinor(project.unbilledTimeMinor, currency)}</strong>
            </div>
            <div>
              <span>Unbilled expenses</span>
              <strong>{formatMinor(project.unbilledExpenseMinor, currency)}</strong>
            </div>
            <div>
              <span>Budget utilization</span>
              <strong>
                {project.budgetUtilizationPercent === null
                  ? 'Unavailable'
                  : `${project.budgetUtilizationPercent.toFixed(1)}%`}
              </strong>
            </div>
          </div>
          <div
            className="rb-insight-project__margin"
            aria-label={`Current margin ${project.currentMarginPercent?.toFixed(1) ?? 'unavailable'} percent`}
          >
            <i
              style={{ width: `${Math.max(0, Math.min(project.currentMarginPercent ?? 0, 100))}%` }}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}

function PolicyQaPanel({ organizationId }: { organizationId: string | null }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PolicyQaResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!organizationId || query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ data: PolicyQaResult[] }>(
        `/organizations/${organizationId}/insights/policy-qa?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The search could not be completed.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rb-insights-stack">
      <Card className="rb-insights-panel rb-policy-qa">
        <div className="rb-insights-panel__heading">
          <div>
            <h2>Ask about your configured policy</h2>
            <p>
              Searches your organization’s adopted country and tax pack. It does not infer rules or
              provide legal or tax advice.
            </p>
          </div>
          <ShieldCheck aria-hidden="true" />
        </div>
        <div className="rb-policy-qa__examples" aria-label="Example questions">
          {[
            'What VAT configuration applies?',
            'What details are required on an invoice?',
            'Which accounting settings are active?',
          ].map((example) => (
            <button key={example} type="button" onClick={() => setQuery(example)}>
              {example}
            </button>
          ))}
        </div>
      </Card>
      <Card className="rb-report-filters">
        <div className="rb-field">
          <Label htmlFor="policy-qa-query">Search your adopted country pack</Label>
          <Input
            id="policy-qa-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void search();
            }}
            placeholder="VAT rate, invoice footer, required field…"
          />
        </div>
        <Button onClick={() => void search()} loading={loading} disabled={query.trim().length < 2}>
          <Search aria-hidden="true" /> Search
        </Button>
      </Card>

      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      {results && results.length === 0 ? (
        <EmptyState
          title="No matches"
          description="No configured rule in your adopted country pack matched that search."
        />
      ) : null}
      {results && results.length > 0 ? (
        <div className="rb-policy-results">
          {results.map((result, index) => (
            <Card key={`${result.source}-${index}`} className="rb-insights-panel">
              <div className="rb-policy-results__meta">
                <StatusBadge status="Active" />
                <span>{label(result.source)}</span>
              </div>
              <p>{result.text}</p>
              <dl>
                <div>
                  <dt>Source configuration</dt>
                  <dd>
                    {result.packCode} v{result.packVersion}
                  </dd>
                </div>
                <div>
                  <dt>Document scope</dt>
                  <dd>{result.documentType ? label(result.documentType) : 'Organization-wide'}</dd>
                </div>
                <div>
                  <dt>Effective date</dt>
                  <dd>Not supplied by the active pack</dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const AUDIT_EVIDENCE_ENTITY_TYPES = ['EXPENSE', 'BILL', 'INVOICE'] as const;

function AuditEvidencePanel({ organizationId }: { organizationId: string | null }) {
  const [entityType, setEntityType] =
    useState<(typeof AUDIT_EVIDENCE_ENTITY_TYPES)[number]>('EXPENSE');
  const [records, setRecords] = useState<EvidenceRecord[] | null>(null);
  const [recordQuery, setRecordQuery] = useState('');
  const [entityId, setEntityId] = useState('');
  const [pack, setPack] = useState<AuditEvidencePack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    setRecords(null);
    setEntityId('');
    const path =
      entityType === 'INVOICE' ? 'invoices' : entityType === 'BILL' ? 'bills' : 'expenses';
    apiRequest<{ data: Record<string, unknown>[] }>(`/organizations/${organizationId}/${path}`)
      .then((response) =>
        setRecords(
          response.data.map((record) => ({
            id: String(record.id),
            reference: String(
              record.invoiceNumber ?? record.billNumber ?? record.expenseNumber ?? record.id,
            ),
            contact:
              typeof record.customerName === 'string'
                ? record.customerName
                : typeof record.vendorName === 'string'
                  ? record.vendorName
                  : null,
            status: typeof record.status === 'string' ? record.status : null,
          })),
        ),
      )
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Records could not be loaded.'),
      );
  }, [entityType, organizationId]);

  const matches = useMemo(() => {
    const term = recordQuery.trim().toLowerCase();
    return (records ?? [])
      .filter(
        (record) =>
          !term || `${record.reference} ${record.contact ?? ''}`.toLowerCase().includes(term),
      )
      .slice(0, 12);
  }, [recordQuery, records]);

  async function lookup() {
    if (!organizationId || entityId.trim().length === 0) return;
    setLoading(true);
    setError(null);
    setPack(null);
    try {
      const response = await apiRequest<{ data: AuditEvidencePack }>(
        `/organizations/${organizationId}/insights/audit-evidence-pack?entityType=${entityType}&entityId=${encodeURIComponent(
          entityId.trim(),
        )}`,
      );
      setPack(response.data);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The evidence pack could not be assembled.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rb-insights-stack">
      <Card className="rb-insights-panel">
        <div className="rb-insights-panel__heading">
          <div>
            <h2>Build audit evidence</h2>
            <p>
              Select an organization record by its document reference or contact. Evidence remains
              scoped to your current organization and permissions.
            </p>
          </div>
          <FileSearch aria-hidden="true" />
        </div>
      </Card>
      <Card className="rb-report-filters">
        <div className="rb-field">
          <Label htmlFor="audit-evidence-entity-type">Entity type</Label>
          <Select
            id="audit-evidence-entity-type"
            value={entityType}
            onChange={(event) =>
              setEntityType(event.target.value as (typeof AUDIT_EVIDENCE_ENTITY_TYPES)[number])
            }
          >
            {AUDIT_EVIDENCE_ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {label(type)}
              </option>
            ))}
          </Select>
        </div>
        <div className="rb-field">
          <Label htmlFor="audit-evidence-record-search">Find record</Label>
          <Input
            id="audit-evidence-record-search"
            value={recordQuery}
            onChange={(event) => setRecordQuery(event.target.value)}
            placeholder="Search by reference or contact"
          />
        </div>
        <Button
          onClick={() => void lookup()}
          loading={loading}
          disabled={entityId.trim().length === 0}
        >
          <Search aria-hidden="true" /> Assemble
        </Button>
      </Card>

      <Card className="rb-insights-panel rb-evidence-picker">
        <div className="rb-insights-panel__heading">
          <div>
            <h3>Matching records</h3>
            <p>{records === null ? 'Loading records…' : `${matches.length} shown`}</p>
          </div>
        </div>
        {records === null ? (
          <Skeleton />
        ) : matches.length === 0 ? (
          <p className="rb-muted">No matching {label(entityType).toLowerCase()} records.</p>
        ) : (
          <div className="rb-evidence-picker__list">
            {matches.map((record) => (
              <button
                key={record.id}
                type="button"
                className={entityId === record.id ? 'is-selected' : ''}
                onClick={() => setEntityId(record.id)}
              >
                <span>
                  <strong>{record.reference}</strong>
                  <small>{record.contact ?? 'No contact recorded'}</small>
                </span>
                {record.status ? <StatusBadge status={record.status} /> : null}
              </button>
            ))}
          </div>
        )}
      </Card>

      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}

      {pack ? (
        <div className="rb-ledger-stack">
          <Card>
            <strong>Audit trail</strong>
            {pack.auditEvents.length === 0 ? (
              <p className="rb-muted">No audit events recorded.</p>
            ) : (
              <ul className="rb-attachment-list">
                {pack.auditEvents.map((event) => (
                  <li key={event.eventKey}>
                    <span>{event.action}</span>
                    <span className="rb-table-secondary">
                      {new Date(event.occurredAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <strong>Attachments</strong>
            {pack.attachments.length === 0 ? (
              <p className="rb-muted">No attachments.</p>
            ) : (
              <ul className="rb-attachment-list">
                {pack.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <span>{attachment.filename}</span>
                    <span className="rb-table-secondary">
                      {new Date(attachment.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <strong>Approval requests</strong>
            {pack.approvalRequests.length === 0 ? (
              <p className="rb-muted">No approval requests.</p>
            ) : (
              <ul className="rb-attachment-list">
                {pack.approvalRequests.map((request) => (
                  <li key={request.id}>
                    <span>
                      {label(request.status)} -- submitted{' '}
                      {new Date(request.submittedAt).toLocaleString()}
                    </span>
                    <span className="rb-table-secondary">
                      {request.decisions.map((decision) => label(decision.decision)).join(', ') ||
                        'No decisions yet'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <strong>Posting</strong>
            {pack.journal ? (
              <ul className="rb-attachment-list">
                <li>
                  <span>Journal {pack.journal.reference ?? pack.journal.id}</span>
                  <span className="rb-table-secondary">
                    {label(pack.journal.status)}
                    {pack.journal.postedAt
                      ? ` -- ${new Date(pack.journal.postedAt).toLocaleString()}`
                      : ''}
                  </span>
                </li>
                {pack.reversalJournal ? (
                  <li>
                    <span>
                      Reversed by {pack.reversalJournal.reference ?? pack.reversalJournal.id}
                    </span>
                    <span className="rb-table-secondary">
                      {pack.reversalJournal.postedAt
                        ? new Date(pack.reversalJournal.postedAt).toLocaleString()
                        : ''}
                    </span>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="rb-muted">No linked journal for this entity type yet.</p>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function formatMinor(value: string, currency: string): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const cents = absolute % 100n;
  const formattedWhole = new Intl.NumberFormat('en-KE').format(Number(whole));
  return `${negative ? '-' : ''}${currency} ${formattedWhole}.${cents.toString().padStart(2, '0')}`;
}

function minorToMajor(value: string): number {
  return Number(BigInt(value)) / 100;
}

function formatMajor(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
}

function compactCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatWeek(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatQuantity(value: string | number): string {
  const number = typeof value === 'number' ? value : Number(value);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number);
}

function label(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.slice(0, 1)}${part.slice(1).toLowerCase()}`)
    .join(' ');
}
