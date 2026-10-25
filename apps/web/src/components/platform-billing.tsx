'use client';

import {
  describeOrganizationPlan,
  OFFICIAL_ENTITLEMENT_LABELS,
  type PlanStatus,
  type SubscriptionStatus,
} from '@valuebooks/contracts';
import {
  Badge,
  Button,
  CardSkeleton,
  DataTable,
  DataTableFilters,
  DataTablePagination,
  DataTableSearch,
  DataTableToolbar,
  DetailSkeleton,
  ErrorState,
  FieldMessage,
  FormField,
  Input,
  Label,
  Select,
  StatusBadge,
} from '@valuebooks/ui';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiRequest } from '../lib/api';
import { formatMinor, minorToDecimal, parseDecimalToMinor } from '../lib/money';
import {
  platformQuery,
  platformRoleAtLeast,
  usePlatformSession,
  type Paginated,
} from '../lib/platform';
import { AdminActionDialog } from './admin-action-dialog';
import { PlatformBillingSections } from './platform-billing-sections';
import { Panel, Row } from './platform-organization-detail';
import { PlatformPage } from './platform-shell';

type Row = {
  id: string;
  status?: string;
  processingState?: string;
  billingProvider?: string;
  organization?: { id: string; legalName: string; createdBy?: { email: string } };
  plan?: { name: string; priceMinor?: string; currency?: string; billingInterval?: string };
  planNameSnapshot?: string | null;
  providerSubscriptionId?: string | null;
  providerTransactionId?: string;
  amountMinor?: string;
  currency?: string;
  currentPeriodEnd?: string | null;
  startedAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  trialEndsAt?: string | null;
  createdAt?: string;
  paidAt?: string | null;
  receivedAt?: string;
  providerEventId?: string;
  eventType?: string;
  eventKey?: string;
  occurredAt?: string;
  reason?: string | null;
  lastError?: string | null;
};

type Listing = 'subscriptions' | 'transactions' | 'trials' | 'webhooks' | 'audit';
const title: Record<Listing, string> = {
  subscriptions: 'Subscriptions',
  transactions: 'Transactions',
  trials: 'Trials',
  webhooks: 'Webhook events',
  audit: 'Billing audit',
};
const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';
/** A start–end range, or a single dash when neither end is known. */
const span = (start?: string | null, end?: string | null) =>
  start || end ? `${date(start)} – ${date(end)}` : '—';
const money = (value?: string | null, currency?: string) =>
  value != null && currency ? formatMinor(value, currency) : '—';

const description: Record<Listing, string> = {
  subscriptions: 'Every organization subscription: plan, provider, state and paid-through date.',
  transactions: 'Subscription payments collected by ValueBooks, never tenants’ own invoices.',
  trials: 'Cardless trials, with audited extensions.',
  webhooks: 'Verified Paystack deliveries and how each was processed.',
  audit: 'Every billing action an operator has taken.',
};

const FILTERS: Record<Listing, Array<[string, string]>> = {
  trials: [
    ['active', 'Active'],
    ['expiring', 'Expiring within 24 hours'],
    ['expired', 'Expired'],
    ['converted', 'Converted'],
  ],
  webhooks: [
    ['VERIFIED', 'Verified'],
    ['PROCESSING', 'Processing'],
    ['PROCESSED', 'Processed'],
    ['FAILED', 'Failed'],
  ],
  subscriptions: [
    ['TRIALING', 'Trialing'],
    ['TRIAL_EXPIRED', 'Trial expired'],
    ['ACTIVE', 'Active'],
    ['PAST_DUE', 'Past due'],
    ['CANCEL_SCHEDULED', 'Cancel scheduled'],
    ['CANCELLED', 'Cancelled'],
  ],
  transactions: [
    ['PENDING', 'Pending'],
    ['SUCCESSFUL', 'Successful'],
    ['FAILED', 'Failed'],
    ['REFUNDED', 'Refunded'],
  ],
  audit: [],
};

/** `billing.trial_extended` → "Billing trial extended". */
const readable = (key?: string) =>
  key ? key.replace(/[._]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase()) : '—';

/** Local date-time string for a `datetime-local` input. */
const localInput = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function PlatformBillingList({ kind }: { kind: Listing }) {
  const { session } = usePlatformSession();
  const canOperate = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');
  const [result, setResult] = useState<Paginated<Row> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [interval, setInterval] = useState('');
  const [planOptions, setPlanOptions] = useState<Array<{ key: string; name: string }>>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [extending, setExtending] = useState<Row | null>(null);
  const [retrying, setRetrying] = useState<Row | null>(null);
  const [newEnd, setNewEnd] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    // Overview drilldowns land here pre-filtered, e.g. ?state=expiring or ?status=PAST_DUE.
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('state') ?? params.get('status');
    if (requested) setStatus(requested);
    if (kind === 'subscriptions') {
      setPlan(params.get('plan') ?? '');
      void apiRequest<{ data: Array<{ key: string; name: string }> }>('/platform/plan-tiers')
        .then((result) => setPlanOptions(result.data))
        .catch(() => setPlanOptions([]));
    }
  }, [kind]);
  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const response = await apiRequest<Paginated<Row>>(
        `/platform/billing/${kind}${platformQuery({ page, search, ...(kind === 'webhooks' || kind === 'trials' ? { state: status } : { status }), ...(kind === 'subscriptions' ? { plan, interval } : {}) })}`,
      );
      if (currentRequest === requestId.current) {
        setResult(response);
        setError('');
      }
    } catch {
      if (currentRequest === requestId.current) setError(`${title[kind]} could not be loaded.`);
    }
  }, [kind, page, search, status, plan, interval]);
  useEffect(() => {
    void load();
  }, [load]);

  const now = new Date();
  const latestEnd = new Date(now.getTime() + 30 * 86_400_000);
  const earliestEnd =
    extending?.trialEndsAt && new Date(extending.trialEndsAt) > now
      ? new Date(extending.trialEndsAt)
      : now;
  const proposedEnd = newEnd ? new Date(newEnd) : null;
  const endValid =
    proposedEnd !== null &&
    Number.isFinite(proposedEnd.getTime()) &&
    proposedEnd > earliestEnd &&
    proposedEnd <= latestEnd;

  const organizationCell = (row: Row) => (
    <Link href={`/platform/billing/subscriptions/${row.id}`}>
      {row.organization?.legalName ?? row.id}
    </Link>
  );
  const statusCell = (value?: string) => (value ? <StatusBadge status={value} /> : '—');

  const columns =
    kind === 'subscriptions'
      ? [
          { key: 'organization', header: 'Organization', cell: organizationCell },
          { key: 'plan', header: 'Plan', cell: (row: Row) => row.plan?.name ?? '—' },
          {
            key: 'amount',
            header: 'Price',
            cell: (row: Row) => money(row.plan?.priceMinor, row.plan?.currency),
          },
          { key: 'interval', header: 'Interval', cell: (row: Row) => row.plan?.billingInterval ?? '—', hideBelow: 'tablet' as const },
          {
            key: 'provider',
            header: 'Provider',
            cell: (row: Row) => row.billingProvider ?? 'Cardless trial',
            hideBelow: 'tablet' as const,
          },
          { key: 'status', header: 'Status', cell: (row: Row) => statusCell(row.status) },
          {
            key: 'renewal',
            header: 'Next renewal / end',
            cell: (row: Row) => row.status === 'TRIALING' ? date(row.trialEndsAt) : date(row.currentPeriodEnd),
          },
        ]
      : kind === 'transactions'
        ? [
            {
              key: 'reference',
              header: 'Reference',
              cell: (row: Row) => (
                <Link href={`/platform/billing/transactions/${row.id}`}>
                  {row.providerTransactionId ?? row.id}
                </Link>
              ),
            },
            {
              key: 'organization',
              header: 'Organization',
              cell: (row: Row) => row.organization?.legalName ?? '—',
            },
            {
              key: 'plan',
              header: 'Plan',
              cell: (row: Row) => row.planNameSnapshot ?? '—',
              hideBelow: 'tablet' as const,
            },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right' as const,
              cell: (row: Row) => money(row.amountMinor, row.currency),
            },
            { key: 'status', header: 'Status', cell: (row: Row) => statusCell(row.status) },
            { key: 'date', header: 'Date', cell: (row: Row) => date(row.paidAt ?? row.createdAt) },
          ]
        : kind === 'trials'
          ? [
              { key: 'organization', header: 'Organization', cell: organizationCell },
              { key: 'status', header: 'State', cell: (row: Row) => statusCell(row.status) },
              { key: 'end', header: 'Trial ends', cell: (row: Row) => date(row.trialEndsAt) },
              {
                key: 'action',
                header: 'Action',
                cell: (row: Row) =>
                  canOperate && ['TRIALING', 'TRIAL_EXPIRED'].includes(row.status ?? '') ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setNewEnd('');
                        setExtending(row);
                      }}
                    >
                      Extend
                    </Button>
                  ) : (
                    '—'
                  ),
              },
            ]
          : kind === 'webhooks'
            ? [
                {
                  key: 'type',
                  header: 'Event',
                  cell: (row: Row) => (
                    <span title={row.providerEventId}>{row.eventType ?? '—'}</span>
                  ),
                },
                {
                  key: 'status',
                  header: 'State',
                  cell: (row: Row) => statusCell(row.processingState),
                },
                {
                  key: 'error',
                  header: 'Last error',
                  cell: (row: Row) =>
                    row.lastError ? (
                      <span className="rb-table-secondary" title={row.lastError}>
                        {row.lastError.length > 90
                          ? `${row.lastError.slice(0, 90)}…`
                          : row.lastError}
                      </span>
                    ) : (
                      '—'
                    ),
                },
                { key: 'date', header: 'Received', cell: (row: Row) => date(row.receivedAt) },
                {
                  key: 'action',
                  header: 'Action',
                  cell: (row: Row) =>
                    row.processingState === 'FAILED' && canOperate ? (
                      <Button variant="outline" size="sm" onClick={() => setRetrying(row)}>
                        Retry
                      </Button>
                    ) : (
                      '—'
                    ),
                },
              ]
            : [
                {
                  key: 'event',
                  header: 'Action',
                  cell: (row: Row) => <span title={row.eventKey}>{readable(row.eventKey)}</span>,
                },
                { key: 'reason', header: 'Reason', cell: (row: Row) => row.reason ?? '—' },
                { key: 'date', header: 'Date', cell: (row: Row) => date(row.occurredAt) },
              ];

  const filters = FILTERS[kind];
  return (
    <PlatformPage title={title[kind]} description={description[kind]}>
      {kind === 'subscriptions' ? <PlatformBillingSections /> : null}
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <ErrorState
          title={`${title[kind]} could not be loaded`}
          description="This is a loading failure, not an empty list."
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          caption={title[kind]}
          rows={result?.data ?? []}
          loading={!result}
          columns={columns}
          emptyTitle={`No ${title[kind].toLowerCase()} found`}
          toolbar={
            <DataTableToolbar
              resultLabel={
                result
                  ? `${result.pagination.totalRows.toLocaleString()} result${result.pagination.totalRows === 1 ? '' : 's'}`
                  : undefined
              }
            >
              {kind === 'subscriptions' || kind === 'transactions' ? (
                <DataTableSearch
                  label={`Search ${title[kind]}`}
                  value={search}
                  onChange={(event) => {
                    setPage(1);
                    setSearch(event.target.value);
                  }}
                />
              ) : null}
              {filters.length > 0 ? (
                <DataTableFilters>
                  <Select
                    aria-label="Filter by state"
                    value={status}
                    onChange={(event) => {
                      setPage(1);
                      setStatus(event.target.value);
                    }}
                  >
                    <option value="">All states</option>
                    {filters.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </DataTableFilters>
              ) : null}
              {kind === 'subscriptions' ? <DataTableFilters>
                <Select aria-label="Filter by plan" value={plan} onChange={(event) => { setPage(1); setPlan(event.target.value); }}>
                  <option value="">All plans</option>
                  {planOptions.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}
                </Select>
                <Select aria-label="Filter by billing interval" value={interval} onChange={(event) => { setPage(1); setInterval(event.target.value); }}>
                  <option value="">All intervals</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option>
                </Select>
              </DataTableFilters> : null}
            </DataTableToolbar>
          }
        />
      )}
      {result ? (
        <DataTablePagination
          page={page}
          pageSize={result.pagination.pageSize}
          totalRows={result.pagination.totalRows}
          onPageChange={setPage}
        />
      ) : null}

      {extending ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setExtending(null))}
          title="Extend trial"
          description={extending.organization?.legalName ?? extending.id}
          confirmLabel="Extend trial"
          confirmDisabled={!endValid}
          impact={
            <>
              <p>
                The trial currently ends <strong>{date(extending.trialEndsAt)}</strong>. Extending
                gives cardless Professional access until the new date and reschedules the reminder
                and expiry. Nothing is charged.
              </p>
              <p>
                The new end must be after the current one and no more than 30 days from now. An
                expired trial becomes active again.
              </p>
            </>
          }
          fields={
            <FormField>
              <Label htmlFor="trial-end">New trial end</Label>
              <Input
                id="trial-end"
                type="datetime-local"
                value={newEnd}
                min={localInput(earliestEnd)}
                max={localInput(latestEnd)}
                onChange={(event) => setNewEnd(event.target.value)}
              />
              <FieldMessage>
                {newEnd && !endValid
                  ? `Choose a time after ${date(earliestEnd.toISOString())} and no later than ${date(latestEnd.toISOString())}.`
                  : 'Your local time.'}
              </FieldMessage>
            </FormField>
          }
          onConfirm={async (reason) => {
            await apiRequest(`/platform/billing/trials/${extending.id}/extend`, {
              method: 'POST',
              body: JSON.stringify({ newEnd: new Date(newEnd).toISOString(), reason }),
            });
            setNotice(
              `Trial for ${extending.organization?.legalName ?? 'this organization'} extended.`,
            );
            await load();
          }}
        />
      ) : null}
      {retrying ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setRetrying(null))}
          title="Retry webhook processing"
          description={retrying.eventType ?? retrying.id}
          confirmLabel="Retry processing"
          impact={
            <>
              <p>
                Reprocesses this already-verified Paystack event through the same idempotent path as
                a live delivery. A payment it describes is recorded at most once; nothing is sent to
                Paystack and nobody is charged.
              </p>
              {retrying.lastError ? (
                <p>
                  Last failure: <strong>{retrying.lastError}</strong>. If that cause is not fixed,
                  the retry fails the same way.
                </p>
              ) : null}
            </>
          }
          onConfirm={async (reason) => {
            // The endpoint reports the event's state read back after the attempt: a concurrent
            // redelivery can hold the processing claim, in which case nothing was reprocessed.
            const result = await apiRequest<{ data: { processed: boolean; state: string } }>(
              `/platform/billing/webhooks/${retrying.id}/retry`,
              { method: 'POST', body: JSON.stringify({ reason }) },
            );
            setNotice(
              result.data.processed
                ? 'Webhook event reprocessed.'
                : `The retry was recorded but the event is still ${readable(result.data.state)}. Another delivery of the same event may be processing it; check the state below.`,
            );
            await load();
          }}
        />
      ) : null}
    </PlatformPage>
  );
}

type RevenueData = {
  months: Array<{
    month: string;
    currency: string;
    grossMinor: string;
    refundedMinor: string;
    netMinor: string;
    successfulPayments: number;
  }>;
  completedPlanChanges: number;
  methodology: string;
};

/** `2026-10` → "Oct 2026", in UTC like the figures themselves. */
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

export function PlatformBillingRevenue() {
  const [data, setData] = useState<RevenueData | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    setData(null);
    apiRequest<{ data: RevenueData }>('/platform/billing/revenue')
      .then((result) => setData(result.data))
      .catch(() => setError(true));
  }, []);
  useEffect(() => load(), [load]);
  return (
    <PlatformPage
      title="Revenue analytics"
      description="Verified collections for the last twelve UTC months, in original currencies. Currencies are never converted or added together."
    >
      {error ? (
        <ErrorState
          title="Revenue analytics could not be loaded"
          description="This is a loading failure, not zero revenue."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="Monthly verified collections"
          rows={(data?.months ?? []).map((row) => ({ ...row, id: `${row.month}:${row.currency}` }))}
          loading={!data}
          columns={[
            {
              key: 'month',
              header: 'Month',
              cell: (row) => <span title={row.month}>{monthLabel(row.month)}</span>,
            },
            { key: 'currency', header: 'Currency', cell: (row) => row.currency },
            {
              key: 'gross',
              header: 'Collected',
              align: 'right',
              cell: (row) => money(row.grossMinor, row.currency),
            },
            {
              key: 'refunds',
              header: 'Refunded',
              align: 'right',
              cell: (row) => money(row.refundedMinor, row.currency),
              hideBelow: 'tablet',
            },
            {
              key: 'net',
              header: 'Net after refunds',
              align: 'right',
              cell: (row) => money(row.netMinor, row.currency),
            },
            {
              key: 'count',
              header: 'Payments',
              align: 'right',
              cell: (row) => row.successfulPayments.toLocaleString(),
              hideBelow: 'tablet',
            },
          ]}
          emptyTitle="No verified collections yet"
          emptyDescription="Months appear once a provider-verified subscription payment is recorded."
        />
      )}
      {data ? <p className="rb-platform__muted rb-platform__footnote">{data.methodology}</p> : null}
    </PlatformPage>
  );
}

type IssuesData = {
  failedPayments: Array<{
    id: string;
    providerTransactionId: string;
    organization: { legalName: string };
  }>;
  failedWebhooks: Array<{ id: string; eventType: string; lastError: string | null }>;
  unresolvedChanges: Array<{
    id: string;
    organization: { legalName: string };
    errorMessage: string | null;
  }>;
  unknownRefunds: Array<{ id: string }>;
  unsubscribedOrganizations?: Array<{ id: string; legalName: string }>;
};

function IssuePanel({
  title,
  count,
  empty,
  href,
  hrefLabel,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Panel title={`${title} (${count.toLocaleString()})`}>
      {count === 0 ? (
        <p className="rb-platform__muted">{empty}</p>
      ) : (
        <ul className="rb-platform__issue-list">{children}</ul>
      )}
      {href && count > 0 ? <Link href={href}>{hrefLabel}</Link> : null}
    </Panel>
  );
}

export function PlatformBillingIssues() {
  const [data, setData] = useState<IssuesData | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    setData(null);
    apiRequest<{ data: IssuesData }>('/platform/billing/issues')
      .then((response) => setData(response.data))
      .catch(() => setError(true));
  }, []);
  useEffect(() => load(), [load]);
  return (
    <PlatformPage
      title="Billing issues"
      description="Payment, webhook, plan-change and refund exceptions that need an operator. Each links to the records behind it."
    >
      {error ? (
        <ErrorState
          title="Billing issues could not be loaded"
          description="This is a loading failure, not a clean bill of health."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      ) : !data ? (
        <CardSkeleton />
      ) : (
        <div className="rb-platform__grid">
          <IssuePanel
            title="Failed payments"
            count={data.failedPayments.length}
            empty="No failed subscription payments."
            href="/platform/billing/transactions?status=FAILED"
            hrefLabel="All failed transactions"
          >
            {data.failedPayments.map((row) => (
              <li key={row.id}>
                <Link href={`/platform/billing/transactions/${row.id}`}>
                  {row.organization.legalName}
                </Link>
                <span className="rb-table-secondary">{row.providerTransactionId}</span>
              </li>
            ))}
          </IssuePanel>
          <IssuePanel
            title="Failed webhooks"
            count={data.failedWebhooks.length}
            empty="Every verified webhook was processed."
            href="/platform/billing/webhooks?state=FAILED"
            hrefLabel="Review and retry"
          >
            {data.failedWebhooks.map((row) => (
              <li key={row.id}>
                <span>{row.eventType}</span>
                <span className="rb-table-secondary">{row.lastError ?? 'Processing failed'}</span>
              </li>
            ))}
          </IssuePanel>
          <IssuePanel
            title="Old renewals not yet cancelled"
            count={data.unresolvedChanges.length}
            empty="Every plan change has cancelled its previous renewal."
          >
            {data.unresolvedChanges.map((row) => (
              <li key={row.id}>
                <span>{row.organization.legalName}</span>
                <span className="rb-table-secondary">
                  {row.errorMessage ?? 'Cancellation pending with Paystack'}
                </span>
              </li>
            ))}
          </IssuePanel>
          <IssuePanel
            title="Refunds awaiting Paystack"
            count={data.unknownRefunds.length}
            empty="No refund has an unknown Paystack status."
            href="/platform/billing/refunds"
            hrefLabel="Open refunds"
          >
            {data.unknownRefunds.map((row) => (
              <li key={row.id}>
                <code>{row.id}</code>
              </li>
            ))}
          </IssuePanel>
          <IssuePanel
            title="Active organizations without a subscription"
            count={data.unsubscribedOrganizations?.length ?? 0}
            empty="Every active organization has a trial or a plan."
            href="/platform/organizations?status=ACTIVE&subscriptionStatus=NONE"
            hrefLabel="Open in Organizations"
          >
            {(data.unsubscribedOrganizations ?? []).map((row) => (
              <li key={row.id}>
                <Link href={`/platform/organizations/${row.id}`}>{row.legalName}</Link>
              </li>
            ))}
          </IssuePanel>
        </div>
      )}
    </PlatformPage>
  );
}

type RefundRow = {
  id: string;
  status: string;
  amountMinor: string;
  currency: string;
  reason: string;
  providerStatus: string | null;
  organization: { legalName: string };
  transaction: { providerTransactionId: string };
  createdAt: string;
};

export function PlatformBillingRefunds() {
  const { session } = usePlatformSession();
  const canApprove = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');
  const [result, setResult] = useState<Paginated<RefundRow> | null>(null);
  const [reviewing, setReviewing] = useState<RefundRow | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setResult(await apiRequest<Paginated<RefundRow>>('/platform/billing/refunds'));
      setError('');
    } catch {
      setError('Refund requests could not be loaded.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <PlatformPage
      title="Refunds & adjustments"
      description="Refunds of subscription payments. Each is requested by one operator and approved by a different superadmin before it reaches Paystack."
    >
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <ErrorState
          title="Refund requests could not be loaded"
          description="This is a loading failure, not an empty list."
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="Subscription refunds"
          rows={result?.data ?? []}
          loading={!result}
          columns={[
            { key: 'org', header: 'Organization', cell: (row) => row.organization.legalName },
            {
              key: 'transaction',
              header: 'Transaction',
              cell: (row) => row.transaction.providerTransactionId,
              hideBelow: 'tablet',
            },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              cell: (row) => money(row.amountMinor, row.currency),
            },
            { key: 'reason', header: 'Reason', cell: (row) => row.reason },
            { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
            {
              key: 'provider',
              header: 'Paystack state',
              cell: (row) => row.providerStatus ?? '—',
              hideBelow: 'tablet',
            },
            {
              key: 'approve',
              header: 'Action',
              cell: (row) =>
                row.status === 'REQUESTED' && canApprove ? (
                  <Button variant="outline" size="sm" onClick={() => setReviewing(row)}>
                    Review
                  </Button>
                ) : (
                  '—'
                ),
            },
          ]}
          emptyTitle="No refund requests"
          emptyDescription="Refunds are requested from a transaction's detail page."
        />
      )}
      {reviewing ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setReviewing(null))}
          title="Approve refund"
          description={reviewing.organization.legalName}
          tone="danger"
          confirmLabel="Approve and submit to Paystack"
          impact={
            <>
              <p>
                Submits a refund of{' '}
                <strong>{money(reviewing.amountMinor, reviewing.currency)}</strong> against
                transaction <code>{reviewing.transaction.providerTransactionId}</code> to Paystack.
                It is complete only when Paystack confirms it.
              </p>
              <p>Requested because: {reviewing.reason}</p>
              <p>
                You must not be the person who requested it. A refund already submitted cannot be
                submitted again.
              </p>
            </>
          }
          onConfirm={async (reason) => {
            await apiRequest(`/platform/billing/refunds/${reviewing.id}/approve`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            });
            setNotice(
              'Refund approved and submitted to Paystack. It completes when Paystack confirms.',
            );
            await load();
          }}
        />
      ) : null}
    </PlatformPage>
  );
}

type OverrideRow = {
  id: string;
  entitlementKey: string;
  status: string;
  limitValue: number | null;
  unlimited: boolean;
  enabled: boolean | null;
  reason: string;
  expiresAt: string;
};

const overrideValue = (row: Pick<OverrideRow, 'enabled' | 'unlimited' | 'limitValue'>) =>
  row.enabled === false
    ? 'Disabled'
    : row.unlimited
      ? 'Unlimited'
      : row.limitValue !== null
        ? row.limitValue.toLocaleString()
        : row.enabled
          ? 'Enabled'
          : '—';

export function PlatformBillingOverrides({ organizationId }: { organizationId: string }) {
  const { session } = usePlatformSession();
  const canRequest = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');
  const canApprove = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');
  const [rows, setRows] = useState<OverrideRow[] | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [dialog, setDialog] = useState<
    { kind: 'request' } | { kind: 'approve' | 'revoke'; row: OverrideRow } | null
  >(null);
  const [key, setKey] = useState('');
  const [grant, setGrant] = useState<'limit' | 'unlimited' | 'enable' | 'disable'>('limit');
  const [limit, setLimit] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [overrideResponse, entitlementsResponse] = await Promise.all([
        apiRequest<{ data: OverrideRow[] }>(
          `/platform/billing/tenants/${organizationId}/overrides`,
        ),
        apiRequest<{ data: { entitlements: Array<{ key: string }> } }>(
          `/platform/organizations/${organizationId}/entitlements`,
        ),
      ]);
      setRows(overrideResponse.data);
      setKeys(entitlementsResponse.data.entitlements.map((item) => item.key));
      setError('');
    } catch {
      setError('Entitlement overrides could not be loaded.');
    }
  }, [organizationId]);
  useEffect(() => {
    void load();
  }, [load]);

  const latestExpiry = new Date(Date.now() + 30 * 86_400_000);
  const expiry = expiresAt ? new Date(expiresAt) : null;
  const requestValid =
    Boolean(key) &&
    expiry !== null &&
    expiry > new Date() &&
    expiry <= latestExpiry &&
    (grant !== 'limit' || (limit !== '' && Number.isInteger(Number(limit)) && Number(limit) >= 0));

  function openRequest() {
    setKey('');
    setGrant('limit');
    setLimit('');
    setExpiresAt('');
    setDialog({ kind: 'request' });
  }

  return (
    <PlatformPage
      title="Entitlement overrides"
      description="Time-limited support exceptions to this organization's plan. Requested by one operator, approved by a different superadmin, and audited."
      actions={
        <div className="rb-platform__detail-actions">
          <Link href={`/platform/organizations/${organizationId}`}>Back to organization</Link>
          {canRequest ? <Button onClick={openRequest}>Request override</Button> : null}
        </div>
      }
    >
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <ErrorState
          title="Entitlement overrides could not be loaded"
          description="This is a loading failure, not an empty list."
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="Entitlement overrides"
          rows={rows ?? []}
          loading={!rows}
          columns={[
            {
              key: 'key',
              header: 'Entitlement',
              cell: (row) => (
                <span title={row.entitlementKey}>
                  {OFFICIAL_ENTITLEMENT_LABELS[
                    row.entitlementKey as keyof typeof OFFICIAL_ENTITLEMENT_LABELS
                  ] ?? row.entitlementKey}
                </span>
              ),
            },
            { key: 'value', header: 'Grants', cell: (row) => overrideValue(row) },
            { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
            { key: 'end', header: 'Expires', cell: (row) => date(row.expiresAt) },
            { key: 'reason', header: 'Reason', cell: (row) => row.reason, hideBelow: 'tablet' },
            {
              key: 'action',
              header: 'Action',
              cell: (row) =>
                canApprove && row.status === 'PENDING' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ kind: 'approve', row })}
                  >
                    Review
                  </Button>
                ) : canApprove && row.status === 'ACTIVE' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ kind: 'revoke', row })}
                  >
                    Revoke
                  </Button>
                ) : (
                  '—'
                ),
            },
          ]}
          emptyTitle="No support overrides"
          emptyDescription="This organization gets exactly what its plan allows."
        />
      )}

      {dialog?.kind === 'request' ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setDialog(null))}
          title="Request entitlement override"
          confirmLabel="Submit for approval"
          confirmDisabled={!requestValid}
          impact={
            <p>
              Nothing changes until a different superadmin approves it. Once approved, the override
              applies on top of the plan until it expires, at most 30 days from now, and then stops
              applying on its own.
            </p>
          }
          fields={
            <>
              <FormField>
                <Label htmlFor="override-key">Entitlement</Label>
                <Select
                  id="override-key"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                >
                  <option value="">Choose an entitlement</option>
                  {keys.map((item) => (
                    <option key={item} value={item}>
                      {OFFICIAL_ENTITLEMENT_LABELS[
                        item as keyof typeof OFFICIAL_ENTITLEMENT_LABELS
                      ] ?? item}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField>
                <Label htmlFor="override-grant">Grant</Label>
                <Select
                  id="override-grant"
                  value={grant}
                  onChange={(event) => setGrant(event.target.value as typeof grant)}
                >
                  <option value="limit">A specific limit</option>
                  <option value="unlimited">Unlimited</option>
                  <option value="enable">Turn the feature on</option>
                  <option value="disable">Turn the feature off</option>
                </Select>
              </FormField>
              {grant === 'limit' ? (
                <FormField>
                  <Label htmlFor="override-limit">Limit</Label>
                  <Input
                    id="override-limit"
                    type="number"
                    min={0}
                    step={1}
                    value={limit}
                    onChange={(event) => setLimit(event.target.value)}
                  />
                </FormField>
              ) : null}
              <FormField>
                <Label htmlFor="override-expiry">Expires</Label>
                <Input
                  id="override-expiry"
                  type="datetime-local"
                  value={expiresAt}
                  min={localInput(new Date())}
                  max={localInput(latestExpiry)}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
                <FieldMessage>Your local time; no more than 30 days from now.</FieldMessage>
              </FormField>
            </>
          }
          onConfirm={async (reason) => {
            await apiRequest(`/platform/billing/tenants/${organizationId}/overrides`, {
              method: 'POST',
              body: JSON.stringify({
                entitlementKey: key,
                ...(grant === 'limit' ? { limitValue: Number(limit) } : {}),
                ...(grant === 'enable' ? { enabled: true } : {}),
                ...(grant === 'disable' ? { enabled: false } : {}),
                unlimited: grant === 'unlimited',
                expiresAt: new Date(expiresAt).toISOString(),
                reason,
              }),
            });
            setNotice(
              'Override requested. It takes effect once a different superadmin approves it.',
            );
            await load();
          }}
        />
      ) : null}
      {dialog?.kind === 'approve' ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setDialog(null))}
          title="Approve entitlement override"
          confirmLabel="Approve override"
          requireReason={false}
          impact={
            <>
              <p>
                <strong>{overrideValue(dialog.row)}</strong> for{' '}
                <strong>
                  {OFFICIAL_ENTITLEMENT_LABELS[
                    dialog.row.entitlementKey as keyof typeof OFFICIAL_ENTITLEMENT_LABELS
                  ] ?? dialog.row.entitlementKey}
                </strong>
                , on top of the plan, until {date(dialog.row.expiresAt)}.
              </p>
              <p>Requested because: {dialog.row.reason}</p>
              <p>You must not be the person who requested it. The approval is audited.</p>
            </>
          }
          onConfirm={async () => {
            await apiRequest(`/platform/billing/overrides/${dialog.row.id}/approve`, {
              method: 'POST',
            });
            setNotice('Override approved and in effect.');
            await load();
          }}
        />
      ) : null}
      {dialog?.kind === 'revoke' ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setDialog(null))}
          title="Revoke entitlement override"
          tone="danger"
          confirmLabel="Revoke override"
          impact={
            <p>
              The organization returns to its plan&apos;s allowance for{' '}
              <strong>
                {OFFICIAL_ENTITLEMENT_LABELS[
                  dialog.row.entitlementKey as keyof typeof OFFICIAL_ENTITLEMENT_LABELS
                ] ?? dialog.row.entitlementKey}
              </strong>{' '}
              immediately. Existing records are kept; only new actions beyond the plan are blocked.
            </p>
          }
          onConfirm={async (reason) => {
            await apiRequest(`/platform/billing/overrides/${dialog.row.id}/revoke`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            });
            setNotice('Override revoked.');
            await load();
          }}
        />
      ) : null}
    </PlatformPage>
  );
}

type ProviderPlanState =
  'READY' | 'MISSING_CODE' | 'DUPLICATE_CODE' | 'WRONG_PROVIDER' | 'MISSING_PLAN';

/** Checkout is blocked for every state except READY. */
const PROVIDER_PLAN_STATE: Record<
  ProviderPlanState,
  { label: string; tone: 'success' | 'warning' | 'danger' }
> = {
  READY: { label: 'Ready', tone: 'success' },
  MISSING_CODE: { label: 'Plan code missing', tone: 'warning' },
  DUPLICATE_CODE: { label: 'Code reused by another plan', tone: 'danger' },
  WRONG_PROVIDER: { label: 'Not mapped to Paystack', tone: 'danger' },
  MISSING_PLAN: { label: 'Catalog row missing', tone: 'danger' },
};

/** `starter_monthly` → "Starter · monthly". */
const planKeyLabel = (key: string) => {
  const [tier = key, interval] = key.split('_');
  return `${tier.charAt(0).toUpperCase()}${tier.slice(1)}${interval ? ` · ${interval}` : ''}`;
};
const providerLabel = (provider: string) => (provider === 'PAYSTACK' ? 'Paystack' : provider);

type ProviderRow = {
  provider: string;
  environment: string;
  environmentConfigured: boolean;
  credentialsConfigured: boolean;
  plans: Array<{
    key: string;
    state: ProviderPlanState;
    providerPlanCode: string | null;
    configured: boolean;
  }>;
  readyPlans: number;
  expectedPlans: number;
  lastWebhook: { receivedAt: string; processingState: string } | null;
  lastPlanProvision: { updatedAt: string; status: string } | null;
};
type BillingConfiguration = {
  trial: { durationDays: number; tierKey: string; cardRequired: boolean; aiInsightLimit: number; reminderLeadHours: number };
  lifecycle: { pastDueGraceDays: number; cancellation: string; renewalNoticeDays: number; retries: string; planChanges: string };
  management: string;
};
type ProviderDiagnostics = { checkedAt: string; plans: Array<{ key: string; state: string; issues: string[] }> };

export function PlatformBillingProviders() {
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  const [configuration, setConfiguration] = useState<BillingConfiguration | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProviderDiagnostics | null>(null);
  const [checking, setChecking] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState(false);
  const [editingReminder, setEditingReminder] = useState(false);
  const [reminderHours, setReminderHours] = useState('24');
  const { session } = usePlatformSession();
  const canDiagnose = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');
  const canConfigure = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    setRows(null);
    void Promise.all([
      apiRequest<{ data: ProviderRow[] }>('/platform/billing/providers'),
      apiRequest<{ data: BillingConfiguration }>('/platform/billing/configuration'),
    ]).then(([providers, policy]) => { setRows(providers.data); setConfiguration(policy.data); })
      .catch(() => setError(true));
  }, []);
  const verifyProvider = async () => {
    setChecking(true); setDiagnosticError(false);
    try {
      const result = await apiRequest<{ data: ProviderDiagnostics }>('/platform/billing/providers/diagnostics', { method: 'POST', body: JSON.stringify({}) });
      setDiagnostics(result.data);
    } catch { setDiagnosticError(true); }
    finally { setChecking(false); }
  };
  useEffect(() => load(), [load]);
  return (
    <PlatformPage
      title="Billing configuration"
      description="Paystack connection, trial policy, and current billing lifecycle rules."
    >
      <PlatformBillingSections />
      {error ? (
        <ErrorState
          title="Provider status could not be loaded"
          description="This is a loading failure, not a provider outage."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      ) : !rows ? (
        <CardSkeleton />
      ) : (
        <>
        {rows.map((row) => (
          <Panel key={row.provider} title={providerLabel(row.provider)}>
            {canDiagnose ? <Button variant="secondary" size="sm" loading={checking} onClick={() => void verifyProvider()}>Run live diagnostics</Button> : null}
            {diagnosticError ? <p role="alert" className="rb-platform__alert">Paystack diagnostics could not run. No configuration changed.</p> : null}
            <dl>
              <Row label="Environment" value={row.environmentConfigured ? row.environment : 'Not configured (test fallback)'} />
              <Row
                label="Secret key"
                value={row.credentialsConfigured ? 'Configured' : 'Missing — checkout blocked'}
              />
              <Row
                label="Plans ready for checkout"
                value={`${row.readyPlans} of ${row.expectedPlans}`}
              />
              <Row
                label="Last signed webhook"
                value={
                  row.lastWebhook
                    ? `${date(row.lastWebhook.receivedAt)} · ${row.lastWebhook.processingState.toLowerCase()}`
                    : 'None received'
                }
              />
              <Row label="Last plan provision" value={row.lastPlanProvision
                ? `${date(row.lastPlanProvision.updatedAt)} · ${row.lastPlanProvision.status.replaceAll('_', ' ').toLowerCase()}`
                : 'None recorded'} />
            </dl>
            <DataTable
              caption="Paystack plan-code coverage"
              rows={row.plans.map((plan) => ({ ...plan, id: plan.key }))}
              columns={[
                {
                  key: 'plan',
                  header: 'Plan',
                  cell: (plan) => <span title={plan.key}>{planKeyLabel(plan.key)}</span>,
                },
                {
                  key: 'code',
                  header: 'Paystack plan code',
                  cell: (plan) =>
                    plan.providerPlanCode ? <code>{plan.providerPlanCode}</code> : '—',
                  hideBelow: 'tablet',
                },
                {
                  key: 'state',
                  header: 'Status',
                  cell: (plan) => (
                    <Badge tone={PROVIDER_PLAN_STATE[plan.state].tone}>
                      {PROVIDER_PLAN_STATE[plan.state].label}
                    </Badge>
                  ),
                },
              ]}
            />
            {diagnostics ? <>
              <p className="rb-platform__muted" role="status">Last checked {date(diagnostics.checkedAt)}. This is a read-only comparison with Paystack.</p>
              <DataTable caption="Live Paystack plan diagnostics" rows={diagnostics.plans.map((plan) => ({ ...plan, id: plan.key }))}
                columns={[
                  { key: 'plan', header: 'Plan', cell: (plan) => planKeyLabel(plan.key) },
                  { key: 'status', header: 'Live state', cell: (plan) => <StatusBadge status={plan.state} /> },
                  { key: 'issues', header: 'Action needed', cell: (plan) => plan.issues.join(' ') || 'None' },
                ]} />
            </> : null}
            <Link href="/platform/billing/plans">Manage plan codes</Link>
          </Panel>
        ))}
        {configuration ? <>
          <Panel title="Credential and webhook setup">
            <p className="rb-platform__muted">The Paystack secret is managed in the API deployment environment. Set <code>PAYSTACK_SECRET_KEY</code> through the deployment secret store, choose the matching <code>PAYSTACK_ENVIRONMENT</code>, and restart the API. The key is never entered or returned through Platform Admin.</p>
            <p className="rb-platform__muted">Register <code>/billing/webhooks/paystack</code> on the API origin in Paystack. The endpoint checks the signed raw payload. After a signed event arrives, its latest processing state appears above. Run live diagnostics to compare linked plans with Paystack before enabling checkout.</p>
          </Panel>
          <Panel title="Trial settings"><dl>
            <Row label="Duration" value={`${configuration.trial.durationDays} days`} />
            <Row label="Package" value={configuration.trial.tierKey} />
            <Row label="Payment card" value={configuration.trial.cardRequired ? 'Required' : 'Not required'} />
            <Row label="Trial AI insight requests" value={configuration.trial.aiInsightLimit} />
            <Row label="Ending reminder" value={`${configuration.trial.reminderLeadHours} hours before expiration`} />
          </dl>
          {canConfigure ? <Button variant="secondary" size="sm" onClick={() => { setReminderHours(String(configuration.trial.reminderLeadHours)); setEditingReminder(true); }}>Change future reminder timing</Button> : null}
          <Link href="/platform/billing/trials">Review current trials</Link></Panel>
          <Panel title="Billing lifecycle"><dl>
            <Row label="Past-due grace" value={`${configuration.lifecycle.pastDueGraceDays} days`} />
            <Row label="Renewal notice" value={`${configuration.lifecycle.renewalNoticeDays} days before period end`} />
            <Row label="Cancellation" value={configuration.lifecycle.cancellation} />
            <Row label="Payment retries" value={configuration.lifecycle.retries} />
            <Row label="Plan changes" value={configuration.lifecycle.planChanges} />
          </dl><p className="rb-platform__muted">{configuration.management}</p></Panel>
        </> : null}
        {editingReminder ? <AdminActionDialog open onOpenChange={(open) => { if (!open) setEditingReminder(false); }}
          title="Change trial reminder timing" confirmLabel="Save reminder timing"
          confirmDisabled={!/^\d+$/.test(reminderHours) || Number(reminderHours) < 1 || Number(reminderHours) > 72}
          impact={<p>This timing applies only when new trial reminder jobs are scheduled. Existing trials and their reminder dates do not change.</p>}
          fields={<FormField><Label htmlFor="trial-reminder-hours">Hours before trial end</Label>
            <Input id="trial-reminder-hours" type="number" min="1" max="72" value={reminderHours} onChange={(event) => setReminderHours(event.target.value)} />
          </FormField>}
          onConfirm={async (reason) => {
            await apiRequest('/platform/billing/configuration/trial-reminder', { method: 'POST',
              body: JSON.stringify({ reminderLeadHours: Number(reminderHours), reason }) });
            load();
          }} /> : null}
        </>
      )}
    </PlatformPage>
  );
}

type TransactionDetail = {
  id: string;
  providerTransactionId: string;
  status: string;
  amountMinor: string;
  refundedMinor: string | null;
  feeMinor: string | null;
  currency: string;
  billingProvider: string;
  planNameSnapshot: string | null;
  billingIntervalSnapshot: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  receiptUrl: string | null;
  createdAt: string;
  subscriptionId: string | null;
  organization: { id: string; legalName: string; countryCode: string };
};

type SubscriptionDetail = {
  id: string;
  status: string;
  complimentary: boolean;
  billingProvider: string | null;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  pastDueSince: string | null;
  lastPaymentAt: string | null;
  createdAt: string;
  organization: {
    id: string;
    legalName: string;
    countryCode: string;
    createdBy: { email: string; displayName: string };
  };
  plan: {
    key: string;
    name: string;
    status: PlanStatus;
    priceMinor: string;
    currency: string;
    billingInterval: string;
  };
  transactions: TransactionDetail[];
  changes: Array<{
    id: string;
    status: string;
    toProvider: string;
    errorMessage: string | null;
    createdAt: string;
    completedAt: string | null;
  }>;
  usage: Array<{
    id: string;
    resourceKey: string;
    usedCount: number;
    periodStart: string;
    periodEnd: string;
  }>;
  audits: Array<{ id: string; eventKey: string; reason: string | null; occurredAt: string }>;
};

export function PlatformBillingDetail({
  kind,
  id,
}: {
  kind: 'subscriptions' | 'transactions';
  id: string;
}) {
  const [row, setRow] = useState<SubscriptionDetail | TransactionDetail | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    apiRequest<{ data: SubscriptionDetail | TransactionDetail }>(`/platform/billing/${kind}/${id}`)
      .then((response) => setRow(response.data))
      .catch(() => setError(true));
  }, [kind, id]);
  useEffect(() => load(), [load]);
  const back = <Link href={`/platform/billing/${kind}`}>Back to {kind}</Link>;
  if (error) {
    return (
      <PlatformPage title="Billing record" actions={back}>
        <ErrorState
          title="This billing record could not be loaded"
          description="This is a loading failure; the record may still exist."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      </PlatformPage>
    );
  }
  if (!row) {
    return (
      <PlatformPage title="Billing record" actions={back}>
        <DetailSkeleton variant="profile" />
      </PlatformPage>
    );
  }
  return kind === 'subscriptions' ? (
    <SubscriptionView row={row as SubscriptionDetail} back={back} />
  ) : (
    <TransactionView row={row as TransactionDetail} back={back} onChanged={load} />
  );
}

function SubscriptionView({ row, back }: { row: SubscriptionDetail; back: React.ReactNode }) {
  const { session } = usePlatformSession();
  const [reconciliation, setReconciliation] = useState<
    | { status: 'checking' }
    | { status: 'done'; discrepancies: string[] }
    | { status: 'error' }
    | null
  >(null);
  const plan = describeOrganizationPlan({
    planName: row.plan.name,
    planStatus: row.plan.status,
    subscriptionStatus: row.status as SubscriptionStatus,
    complimentary: row.complimentary,
  });
  return (
    <PlatformPage
      title={row.organization.legalName}
      description={`${row.plan.name} · ${money(row.plan.priceMinor, row.plan.currency)} / ${row.plan.billingInterval.toLowerCase()}`}
      meta={
        <>
          Subscription since {date(row.createdAt)} ·{' '}
          <Link href={`/platform/organizations/${row.organization.id}`}>Open organization</Link>
        </>
      }
      actions={
        <div className="rb-platform__detail-actions">
          <Badge tone={plan.tone}>{plan.label}</Badge>
          {back}
        </div>
      }
    >
      <div className="rb-platform__grid">
        <Panel title="Term">
          <dl>
            <Row label="State" value={plan.label} />
            <Row label="Started" value={date(row.createdAt)} />
            <Row label="Trial ends" value={date(row.trialEndsAt)} />
            <Row
              label="Current period"
              value={span(row.currentPeriodStart, row.currentPeriodEnd)}
            />
            <Row label="Last payment" value={date(row.lastPaymentAt)} />
            <Row label="Next renewal" value={row.billingProvider && !row.cancelAtPeriodEnd && row.status === 'ACTIVE' ? date(row.currentPeriodEnd) : 'Not scheduled'} />
            <Row
              label="Renews"
              value={
                row.cancelAtPeriodEnd
                  ? 'No — ends at period end'
                  : row.billingProvider
                    ? 'Yes'
                    : '—'
              }
            />
            {row.pastDueSince ? (
              <Row label="Past due since" value={date(row.pastDueSince)} />
            ) : null}
            {row.cancelledAt ? <Row label="Cancelled" value={date(row.cancelledAt)} /> : null}
          </dl>
        </Panel>
        <Panel title="Provider">
          <dl>
            <Row
              label="Provider"
              value={
                row.billingProvider
                  ? providerLabel(row.billingProvider)
                  : 'None (cardless trial or grant)'
              }
            />
            <Row label="Subscription code" value={row.providerSubscriptionId ?? '—'} />
            <Row label="Customer code" value={row.providerCustomerId ?? '—'} />
          </dl>
          {row.billingProvider === 'PAYSTACK' &&
          row.providerSubscriptionId &&
          platformRoleAtLeast(session?.role ?? null, 'OPERATIONS') ? (
            <>
              <Button
                variant="outline"
                size="sm"
                loading={reconciliation?.status === 'checking'}
                onClick={() => {
                  setReconciliation({ status: 'checking' });
                  apiRequest<{ data: { discrepancies: string[] } }>(
                    `/platform/billing/subscriptions/${row.id}/reconcile`,
                    { method: 'POST' },
                  )
                    .then((response) =>
                      setReconciliation({
                        status: 'done',
                        discrepancies: response.data.discrepancies,
                      }),
                    )
                    .catch(() => setReconciliation({ status: 'error' }));
                }}
              >
                Compare with Paystack
              </Button>
              {reconciliation?.status === 'done' ? (
                <p className="rb-platform__muted" role="status">
                  {reconciliation.discrepancies.length
                    ? reconciliation.discrepancies.join(' ')
                    : 'Paystack and ValueBooks agree on this subscription.'}
                </p>
              ) : reconciliation?.status === 'error' ? (
                <p className="rb-platform__muted" role="alert">
                  Paystack could not be reached. Nothing was compared or changed.
                </p>
              ) : (
                <p className="rb-platform__muted">Read-only: compares state, changes nothing.</p>
              )}
            </>
          ) : null}
        </Panel>
      </div>

      <Panel title="Payments">
        <DataTable
          caption="Payments on this subscription"
          rows={row.transactions}
          emptyTitle="No payments recorded"
          emptyDescription="A cardless trial or complimentary grant has no payments."
          emptyState={{ variant: 'inline' }}
          columns={[
            {
              key: 'reference',
              header: 'Reference',
              cell: (item) => (
                <Link href={`/platform/billing/transactions/${item.id}`}>
                  {item.providerTransactionId}
                </Link>
              ),
            },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              cell: (item) => money(item.amountMinor, item.currency),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (item) => <StatusBadge status={item.status} />,
            },
            { key: 'paid', header: 'Paid', cell: (item) => date(item.paidAt ?? item.createdAt) },
          ]}
        />
      </Panel>

      <div className="rb-platform__grid">
        <Panel title="Usage">
          <DataTable
            caption="Usage counters"
            rows={row.usage}
            emptyTitle="No metered usage"
            emptyState={{ variant: 'inline' }}
            columns={[
              {
                key: 'resource',
                header: 'Resource',
                cell: (item) =>
                  OFFICIAL_ENTITLEMENT_LABELS[
                    item.resourceKey as keyof typeof OFFICIAL_ENTITLEMENT_LABELS
                  ] ?? item.resourceKey,
              },
              {
                key: 'used',
                header: 'Used',
                align: 'right',
                cell: (item) => item.usedCount.toLocaleString(),
              },
              {
                key: 'period',
                header: 'Period',
                cell: (item) => `${date(item.periodStart)} – ${date(item.periodEnd)}`,
                hideBelow: 'tablet',
              },
            ]}
          />
        </Panel>
        <Panel title="Plan changes">
          <DataTable
            caption="Plan changes"
            rows={row.changes}
            emptyTitle="No plan changes"
            emptyState={{ variant: 'inline' }}
            columns={[
              {
                key: 'status',
                header: 'Status',
                cell: (item) => <StatusBadge status={item.status} />,
              },
              { key: 'requested', header: 'Requested', cell: (item) => date(item.createdAt) },
              {
                key: 'note',
                header: 'Note',
                cell: (item) =>
                  item.errorMessage ?? (item.completedAt ? `Done ${date(item.completedAt)}` : '—'),
              },
            ]}
          />
        </Panel>
      </div>

      <Panel title="Billing actions on this organization">
        <DataTable
          caption="Billing audit"
          rows={row.audits}
          emptyTitle="No operator billing actions"
          emptyState={{ variant: 'inline' }}
          columns={[
            {
              key: 'event',
              header: 'Action',
              cell: (item) => <span title={item.eventKey}>{readable(item.eventKey)}</span>,
            },
            { key: 'reason', header: 'Reason', cell: (item) => item.reason ?? '—' },
            { key: 'when', header: 'When', cell: (item) => date(item.occurredAt) },
          ]}
        />
      </Panel>
    </PlatformPage>
  );
}

function TransactionView({
  row,
  back,
  onChanged,
}: {
  row: TransactionDetail;
  back: React.ReactNode;
  onChanged: () => void;
}) {
  const { session } = usePlatformSession();
  const [refunding, setRefunding] = useState(false);
  const [amount, setAmount] = useState('');
  const [notice, setNotice] = useState('');
  const remainingMinor = BigInt(row.amountMinor) - BigInt(row.refundedMinor ?? '0');
  const parsed = parseDecimalToMinor(amount);
  const requestedMinor = parsed === null ? null : BigInt(parsed);
  const amountValid =
    requestedMinor !== null && requestedMinor > 0n && requestedMinor <= remainingMinor;
  // Mirrors the API: only a fully successful Paystack payment can take a refund request.
  const canRefund =
    row.status === 'SUCCESSFUL' &&
    row.billingProvider === 'PAYSTACK' &&
    remainingMinor > 0n &&
    platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');
  return (
    <PlatformPage
      title={money(row.amountMinor, row.currency)}
      description={`${row.organization.legalName} · ${row.planNameSnapshot ?? 'Subscription payment'}`}
      meta={<>Reference {row.providerTransactionId}</>}
      actions={
        <div className="rb-platform__detail-actions">
          <StatusBadge status={row.status} />
          {canRefund ? (
            <Button
              variant="outline"
              onClick={() => {
                setAmount(minorToDecimal(remainingMinor.toString()));
                setRefunding(true);
              }}
            >
              Request refund
            </Button>
          ) : null}
          {back}
        </div>
      }
    >
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}
      <div className="rb-platform__grid">
        <Panel title="Payment">
          <dl>
            <Row label="Amount" value={money(row.amountMinor, row.currency)} />
            <Row label="Refunded" value={money(row.refundedMinor ?? '0', row.currency)} />
            {row.feeMinor ? (
              <Row label="Provider fee" value={money(row.feeMinor, row.currency)} />
            ) : null}
            <Row label="Paid" value={date(row.paidAt)} />
            <Row label="Covers" value={span(row.periodStart, row.periodEnd)} />
          </dl>
          {row.receiptUrl ? (
            <a href={row.receiptUrl} target="_blank" rel="noreferrer">
              Paystack receipt
            </a>
          ) : null}
        </Panel>
        <Panel title="Context">
          <dl>
            <Row label="Organization" value={row.organization.legalName} />
            <Row label="Plan at payment" value={row.planNameSnapshot ?? '—'} />
            <Row label="Interval" value={row.billingIntervalSnapshot?.toLowerCase() ?? '—'} />
            <Row label="Provider" value={providerLabel(row.billingProvider)} />
          </dl>
          {row.subscriptionId ? (
            <Link href={`/platform/billing/subscriptions/${row.subscriptionId}`}>
              Open subscription
            </Link>
          ) : null}
        </Panel>
      </div>
      <p className="rb-platform__muted">
        A ValueBooks subscription payment, not an invoice issued by this organization. The raw
        provider payload stays on the server.
      </p>

      {refunding ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setRefunding(false))}
          title="Request refund"
          description={`${row.organization.legalName} · ${row.providerTransactionId}`}
          confirmLabel="Request refund"
          confirmDisabled={!amountValid}
          impact={
            <>
              <p>
                Records a refund request. Nothing is sent to Paystack until a{' '}
                <strong>different superadmin</strong> approves it, and the refund completes only
                when Paystack confirms.
              </p>
              <p>
                Up to <strong>{money(remainingMinor.toString(), row.currency)}</strong> of this
                payment is not yet refunded. Refund requests still awaiting approval also count
                against it, so the request is refused if they already cover the amount.
              </p>
            </>
          }
          fields={
            <FormField>
              <Label htmlFor="refund-amount">Amount ({row.currency})</Label>
              <Input
                id="refund-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <FieldMessage>
                {amount && !amountValid
                  ? `Enter an amount above 0 and no more than ${money(remainingMinor.toString(), row.currency)}, with at most two decimals.`
                  : 'Defaults to everything not yet refunded.'}
              </FieldMessage>
            </FormField>
          }
          onConfirm={async (reason) => {
            await apiRequest(`/platform/billing/transactions/${row.id}/refunds`, {
              method: 'POST',
              body: JSON.stringify({ amountMinor: requestedMinor!.toString(), reason }),
            });
            setNotice('Refund requested. It waits for a different superadmin to approve it.');
            onChanged();
          }}
        />
      ) : null}
    </PlatformPage>
  );
}
