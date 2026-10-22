'use client';

import {
  Badge,
  Button,
  CardSkeleton,
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableToolbar,
  DetailSkeleton,
} from '@valuebooks/ui';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiRequest } from '../lib/api';
import {
  platformQuery,
  platformRoleAtLeast,
  usePlatformSession,
  type Paginated,
} from '../lib/platform';
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
  trialEndsAt?: string | null;
  createdAt?: string;
  paidAt?: string | null;
  receivedAt?: string;
  providerEventId?: string;
  eventType?: string;
  eventKey?: string;
  occurredAt?: string;
  reason?: string | null;
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
const money = (value?: string, currency?: string) =>
  value !== undefined && currency ? `${currency} ${(Number(value) / 100).toFixed(2)}` : '—';
const scalar = (value: unknown) =>
  value === null || value === undefined
    ? '—'
    : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? `${value}`
      : '—';

export function PlatformBillingList({ kind }: { kind: Listing }) {
  const { session } = usePlatformSession();
  const [result, setResult] = useState<Paginated<Row> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [extensionId, setExtensionId] = useState<string | null>(null);
  const [retryId, setRetryId] = useState<string | null>(null);
  const [newEnd, setNewEnd] = useState('');
  const [reason, setReason] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('state');
    if (requested && (kind === 'trials' || kind === 'webhooks')) setStatus(requested);
  }, [kind]);
  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const response = await apiRequest<Paginated<Row>>(
        `/platform/billing/${kind}${platformQuery({ page, search, ...(kind === 'webhooks' || kind === 'trials' ? { state: status } : { status }) })}`,
      );
      if (currentRequest === requestId.current) {
        setResult(response);
        setError('');
      }
    } catch {
      if (currentRequest === requestId.current) setError(`${title[kind]} could not be loaded.`);
    }
  }, [kind, page, search, status]);
  useEffect(() => {
    void load();
  }, [load]);
  async function extendTrial() {
    if (!extensionId || !newEnd) return;
    try {
      await apiRequest(`/platform/billing/trials/${extensionId}/extend`, {
        method: 'POST',
        body: JSON.stringify({ newEnd: new Date(newEnd).toISOString(), reason }),
      });
      setExtensionId(null);
      setReason('');
      setNewEnd('');
      await load();
    } catch {
      setError('Trial extension could not be saved. Check the date and reason.');
    }
  }
  async function retryWebhook() {
    if (!retryId) return;
    try {
      await apiRequest(`/platform/billing/webhooks/${retryId}/retry`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setRetryId(null);
      setReason('');
      await load();
    } catch {
      setError(
        'Verified webhook retry failed. Review the processing error before another attempt.',
      );
    }
  }
  const columns =
    kind === 'subscriptions'
      ? [
          {
            key: 'organization',
            header: 'Organization',
            cell: (row: Row) => (
              <Link href={`/platform/billing/subscriptions/${row.id}`}>
                {row.organization?.legalName ?? row.id}
              </Link>
            ),
          },
          { key: 'plan', header: 'Plan', cell: (row: Row) => row.plan?.name ?? '—' },
          {
            key: 'amount',
            header: 'Price',
            cell: (row: Row) => money(row.plan?.priceMinor, row.plan?.currency),
          },
          {
            key: 'provider',
            header: 'Provider',
            cell: (row: Row) => row.billingProvider ?? 'Trial',
          },
          { key: 'status', header: 'Status', cell: (row: Row) => row.status ?? '—' },
          {
            key: 'renewal',
            header: 'Paid through',
            cell: (row: Row) => date(row.currentPeriodEnd),
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
            { key: 'plan', header: 'Plan', cell: (row: Row) => row.planNameSnapshot ?? '—' },
            {
              key: 'amount',
              header: 'Amount',
              cell: (row: Row) => money(row.amountMinor, row.currency),
            },
            { key: 'provider', header: 'Provider', cell: (row: Row) => row.billingProvider ?? '—' },
            { key: 'status', header: 'Status', cell: (row: Row) => row.status ?? '—' },
            { key: 'date', header: 'Date', cell: (row: Row) => date(row.paidAt ?? row.createdAt) },
          ]
        : kind === 'trials'
          ? [
              {
                key: 'organization',
                header: 'Organization',
                cell: (row: Row) => (
                  <Link href={`/platform/billing/subscriptions/${row.id}`}>
                    {row.organization?.legalName ?? row.id}
                  </Link>
                ),
              },
              { key: 'status', header: 'State', cell: (row: Row) => row.status ?? '—' },
              { key: 'end', header: 'Trial ends', cell: (row: Row) => date(row.trialEndsAt) },
              {
                key: 'action',
                header: 'Action',
                cell: (row: Row) =>
                  platformRoleAtLeast(session?.role ?? null, 'OPERATIONS') &&
                  ['TRIALING', 'TRIAL_EXPIRED'].includes(row.status ?? '') ? (
                    <Button variant="outline" size="sm" onClick={() => setExtensionId(row.id)}>
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
                  key: 'reference',
                  header: 'Event ID',
                  cell: (row: Row) => row.providerEventId ?? row.id,
                },
                { key: 'type', header: 'Type', cell: (row: Row) => row.eventType ?? '—' },
                {
                  key: 'provider',
                  header: 'Provider',
                  cell: (row: Row) => row.billingProvider ?? '—',
                },
                { key: 'status', header: 'State', cell: (row: Row) => row.processingState ?? '—' },
                { key: 'date', header: 'Received', cell: (row: Row) => date(row.receivedAt) },
                {
                  key: 'action',
                  header: 'Action',
                  cell: (row: Row) =>
                    row.processingState === 'FAILED' &&
                    platformRoleAtLeast(session?.role ?? null, 'OPERATIONS') ? (
                      <Button variant="outline" size="sm" onClick={() => setRetryId(row.id)}>
                        Retry
                      </Button>
                    ) : (
                      '—'
                    ),
                },
              ]
            : [
                { key: 'event', header: 'Action', cell: (row: Row) => row.eventKey ?? '—' },
                { key: 'reference', header: 'Reference', cell: (row: Row) => row.id },
                { key: 'reason', header: 'Reason', cell: (row: Row) => row.reason ?? '—' },
                { key: 'date', header: 'Date', cell: (row: Row) => date(row.occurredAt) },
              ];
  return (
    <PlatformPage title={title[kind]} description={`${result?.pagination.totalRows ?? 0} records`}>
      {error ? (
        <p role="alert" className="rb-platform__alert">
          {error}
        </p>
      ) : null}
      <DataTable
        caption={title[kind]}
        rows={result?.data ?? []}
        loading={!result}
        columns={columns}
        emptyTitle={`No ${title[kind].toLowerCase()} found`}
        toolbar={
          <DataTableToolbar resultLabel={`${result?.pagination.totalRows ?? 0} results`}>
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
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value);
              }}
            >
              <option value="">All states</option>
              {(kind === 'trials'
                ? ['active', 'expiring', 'expired', 'converted']
                : kind === 'webhooks'
                  ? ['VERIFIED', 'PROCESSING', 'PROCESSED', 'FAILED']
                  : kind === 'subscriptions'
                    ? [
                        'TRIALING',
                        'TRIAL_EXPIRED',
                        'ACTIVE',
                        'PAST_DUE',
                        'CANCEL_SCHEDULED',
                        'CANCELLED',
                      ]
                    : kind === 'transactions'
                      ? ['PENDING', 'SUCCESSFUL', 'FAILED', 'REFUNDED']
                      : []
              ).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </DataTableToolbar>
        }
      />
      {result ? (
        <DataTablePagination
          page={page}
          pageSize={result.pagination.pageSize}
          totalRows={result.pagination.totalRows}
          onPageChange={setPage}
        />
      ) : null}
      {kind === 'trials' && extensionId ? (
        <section className="rb-security-section" aria-label="Extend trial">
          <h2>Extend trial</h2>
          <p>Choose an expiry no more than 30 days from now. The action is audited.</p>
          <label>
            New expiry{' '}
            <input
              type="datetime-local"
              value={newEnd}
              onChange={(event) => setNewEnd(event.target.value)}
            />
          </label>
          <label>
            Reason{' '}
            <input
              value={reason}
              minLength={10}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="rb-trial-actions">
            <Button
              disabled={!newEnd || reason.trim().length < 10}
              onClick={() => void extendTrial()}
            >
              Confirm extension
            </Button>
            <Button variant="outline" onClick={() => setExtensionId(null)}>
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
      {kind === 'webhooks' && retryId ? (
        <section className="rb-security-section">
          <h2>Retry verified webhook</h2>
          <p>Only a previously signed event can be retried. The action is audited.</p>
          <label>
            Reason
            <input
              value={reason}
              minLength={10}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="rb-trial-actions">
            <Button disabled={reason.trim().length < 10} onClick={() => void retryWebhook()}>
              Confirm retry
            </Button>
            <Button variant="outline" onClick={() => setRetryId(null)}>
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
    </PlatformPage>
  );
}

export function PlatformBillingRevenue() {
  const [data, setData] = useState<{
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
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void apiRequest<{ data: NonNullable<typeof data> }>('/platform/billing/revenue')
      .then((result) => setData(result.data))
      .catch(() => setError('Revenue analytics could not be loaded.'));
  }, []);
  return (
    <PlatformPage
      title="Revenue analytics"
      description="Verified collections for the last twelve UTC months, in original currencies."
    >
      {error ? (
        <p role="alert" className="rb-platform__alert">
          {error}
        </p>
      ) : null}
      <DataTable
        caption="Monthly verified collections"
        rows={(data?.months ?? []).map((row) => ({ ...row, id: `${row.month}:${row.currency}` }))}
        loading={!data}
        columns={[
          { key: 'month', header: 'Month', cell: (row) => row.month },
          { key: 'currency', header: 'Currency', cell: (row) => row.currency },
          { key: 'gross', header: 'Gross', cell: (row) => money(row.grossMinor, row.currency) },
          {
            key: 'refunds',
            header: 'Refunds',
            cell: (row) => money(row.refundedMinor, row.currency),
          },
          {
            key: 'net',
            header: 'Net after refunds',
            cell: (row) => money(row.netMinor, row.currency),
          },
          { key: 'count', header: 'Payments', cell: (row) => row.successfulPayments },
        ]}
        emptyTitle="No verified collections yet"
      />
      {data ? <p className="rb-platform__muted">{data.methodology}</p> : null}
    </PlatformPage>
  );
}

export function PlatformBillingIssues() {
  const [data, setData] = useState<{
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
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void apiRequest<{ data: NonNullable<typeof data> }>('/platform/billing/issues')
      .then((response) => setData(response.data))
      .catch(() => setError('Billing issues could not be loaded.'));
  }, []);
  return (
    <PlatformPage
      title="Billing issues"
      description="Actionable payment, webhook, migration, and refund exceptions."
    >
      {error ? (
        <p role="alert" className="rb-platform__alert">
          {error}
        </p>
      ) : null}
      {!data ? (
        <CardSkeleton />
      ) : (
        <div className="rb-platform__grid">
          <section className="rb-platform__card">
            <h2>Failed payments ({data.failedPayments.length})</h2>
            <ul>
              {data.failedPayments.map((row) => (
                <li key={row.id}>
                  <Link href={`/platform/billing/transactions/${row.id}`}>
                    {row.organization.legalName} · {row.providerTransactionId}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section className="rb-platform__card">
            <h2>Failed webhooks ({data.failedWebhooks.length})</h2>
            <ul>
              {data.failedWebhooks.map((row) => (
                <li key={row.id}>
                  {row.eventType} · {row.lastError ?? 'Processing failed'}
                </li>
              ))}
            </ul>
          </section>
          <section className="rb-platform__card">
            <h2>Old renewals unresolved ({data.unresolvedChanges.length})</h2>
            <ul>
              {data.unresolvedChanges.map((row) => (
                <li key={row.id}>
                  {row.organization.legalName} · {row.errorMessage ?? 'Cancellation pending'}
                </li>
              ))}
            </ul>
          </section>
          <section className="rb-platform__card">
            <h2>Refund status unknown ({data.unknownRefunds.length})</h2>
            <ul>
              {data.unknownRefunds.map((row) => (
                <li key={row.id}>{row.id}</li>
              ))}
            </ul>
          </section>
          <section className="rb-platform__card">
            <h2>
              Active organizations without a subscription (
              {data.unsubscribedOrganizations?.length ?? 0})
            </h2>
            <ul>
              {(data.unsubscribedOrganizations ?? []).map((row) => (
                <li key={row.id}>
                  <Link href={`/platform/organizations/${row.id}`}>{row.legalName}</Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </PlatformPage>
  );
}

export function PlatformBillingRefunds() {
  const { session } = usePlatformSession();
  const [result, setResult] = useState<Paginated<{
    id: string;
    status: string;
    amountMinor: string;
    currency: string;
    reason: string;
    providerStatus: string | null;
    organization: { legalName: string };
    transaction: { providerTransactionId: string };
    createdAt: string;
  }> | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setResult(await apiRequest<NonNullable<typeof result>>('/platform/billing/refunds'));
    } catch {
      setError('Refund requests could not be loaded.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function approve() {
    if (!approvalId) return;
    try {
      await apiRequest(`/platform/billing/refunds/${approvalId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setApprovalId(null);
      setReason('');
      await load();
    } catch {
      setError('Approval could not be submitted. Review the request and provider status.');
    }
  }
  return (
    <PlatformPage
      title="Refunds & adjustments"
      description="Provider-backed refund requests require a separate superadmin approval."
    >
      {error ? (
        <p role="alert" className="rb-platform__alert">
          {error}
        </p>
      ) : null}
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
          },
          { key: 'amount', header: 'Amount', cell: (row) => money(row.amountMinor, row.currency) },
          { key: 'reason', header: 'Reason', cell: (row) => row.reason },
          { key: 'status', header: 'Status', cell: (row) => row.status },
          { key: 'provider', header: 'Provider state', cell: (row) => row.providerStatus ?? '—' },
          {
            key: 'approve',
            header: 'Action',
            cell: (row) =>
              row.status === 'REQUESTED' &&
              platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN') ? (
                <Button variant="outline" size="sm" onClick={() => setApprovalId(row.id)}>
                  Review
                </Button>
              ) : (
                '—'
              ),
          },
        ]}
        emptyTitle="No refund requests"
      />
      {approvalId ? (
        <section className="rb-security-section">
          <h2>Approve refund submission</h2>
          <p>This submits a provider refund request. Completion awaits provider confirmation.</p>
          <label>
            Approval reason{' '}
            <input
              value={reason}
              minLength={10}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="rb-trial-actions">
            <Button disabled={reason.trim().length < 10} onClick={() => void approve()}>
              Confirm submission
            </Button>
            <Button variant="outline" onClick={() => setApprovalId(null)}>
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
    </PlatformPage>
  );
}

export function PlatformBillingOverrides({ organizationId }: { organizationId: string }) {
  const { session } = usePlatformSession();
  const [rows, setRows] = useState<Array<{
    id: string;
    entitlementKey: string;
    status: string;
    limitValue: number | null;
    unlimited: boolean;
    enabled: boolean | null;
    reason: string;
    expiresAt: string;
  }> | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [limit, setLimit] = useState('');
  const [enabled, setEnabled] = useState('');
  const [unlimited, setUnlimited] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [overrideResponse, entitlementsResponse] = await Promise.all([
        apiRequest<{ data: NonNullable<typeof rows> }>(
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
  async function requestOverride() {
    try {
      await apiRequest(`/platform/billing/tenants/${organizationId}/overrides`, {
        method: 'POST',
        body: JSON.stringify({
          entitlementKey: key,
          ...(limit ? { limitValue: Number(limit) } : {}),
          ...(enabled ? { enabled: enabled === 'true' } : {}),
          unlimited,
          expiresAt: new Date(expiresAt).toISOString(),
          reason,
        }),
      });
      setReason('');
      setLimit('');
      setExpiresAt('');
      await load();
    } catch {
      setError('Override request could not be recorded.');
    }
  }
  async function act(id: string, action: 'approve' | 'revoke') {
    try {
      await apiRequest(`/platform/billing/overrides/${id}/${action}`, {
        method: 'POST',
        body: action === 'revoke' ? JSON.stringify({ reason }) : undefined,
      });
      await load();
    } catch {
      setError(`Override ${action} failed. A separate approver and valid reason may be required.`);
    }
  }
  return (
    <PlatformPage
      title="Entitlement overrides"
      description="Time-limited support exceptions with a separate approval and audit trail."
      actions={<Link href={`/platform/organizations/${organizationId}`}>Back to organization</Link>}
    >
      {error ? (
        <p role="alert" className="rb-platform__alert">
          {error}
        </p>
      ) : null}
      <DataTable
        caption="Entitlement overrides"
        rows={rows ?? []}
        loading={!rows}
        columns={[
          { key: 'key', header: 'Entitlement', cell: (row) => row.entitlementKey },
          {
            key: 'value',
            header: 'Value',
            cell: (row) =>
              row.enabled === false
                ? 'Disabled'
                : row.unlimited
                  ? 'Unlimited'
                  : (row.limitValue ?? (row.enabled ? 'Enabled' : '—')),
          },
          { key: 'status', header: 'Status', cell: (row) => row.status },
          { key: 'end', header: 'Expires', cell: (row) => date(row.expiresAt) },
          { key: 'reason', header: 'Reason', cell: (row) => row.reason },
          {
            key: 'action',
            header: 'Action',
            cell: (row) =>
              platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN') ? (
                <div className="rb-trial-actions">
                  {row.status === 'PENDING' ? (
                    <Button variant="outline" size="sm" onClick={() => void act(row.id, 'approve')}>
                      Approve
                    </Button>
                  ) : null}
                  {row.status === 'ACTIVE' ? (
                    <Button variant="outline" size="sm" onClick={() => void act(row.id, 'revoke')}>
                      Revoke
                    </Button>
                  ) : null}
                </div>
              ) : (
                '—'
              ),
          },
        ]}
        emptyTitle="No support overrides"
      />
      {platformRoleAtLeast(session?.role ?? null, 'OPERATIONS') ? (
        <section className="rb-security-section">
          <h2>Request an override</h2>
          <div className="rb-billing-profile-grid">
            <label>
              Entitlement
              <select value={key} onChange={(event) => setKey(event.target.value)}>
                <option value="">Choose</option>
                {keys.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Limit
              <input
                type="number"
                min="0"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                disabled={unlimited}
              />
            </label>
            <label>
              Enabled
              <select value={enabled} onChange={(event) => setEnabled(event.target.value)}>
                <option value="">No change</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
            <label>
              Unlimited
              <input
                type="checkbox"
                checked={unlimited}
                onChange={(event) => setUnlimited(event.target.checked)}
              />
            </label>
            <label>
              Expires
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </label>
            <label>
              Reason
              <input
                minLength={10}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
          <Button
            disabled={
              !key || !expiresAt || reason.trim().length < 10 || (!limit && !enabled && !unlimited)
            }
            onClick={() => void requestOverride()}
          >
            Submit for approval
          </Button>
        </section>
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

export function PlatformBillingProviders() {
  const [rows, setRows] = useState<Array<{
    provider: string;
    environment: string;
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
  }> | null>(null);
  useEffect(() => {
    void apiRequest<{ data: NonNullable<typeof rows> }>('/platform/billing/providers').then(
      (response) => setRows(response.data),
    );
  }, []);
  return (
    <PlatformPage
      title="Payment providers"
      description="Deployment-managed configuration and signed webhook health."
    >
      {!rows ? (
        <CardSkeleton />
      ) : (
        rows.map((row) => (
          <section className="rb-security-section" key={row.provider}>
            <h2>{row.provider}</h2>
            <p>Environment: {row.environment}</p>
            <p>Credentials: {row.credentialsConfigured ? 'Configured' : 'Incomplete'}</p>
            <p>
              Plan codes: {row.readyPlans} of {row.expectedPlans} official plans ready for checkout
            </p>
            <DataTable
              caption="Paystack plan-code coverage"
              rows={row.plans.map((plan) => ({ ...plan, id: plan.key }))}
              columns={[
                { key: 'plan', header: 'Plan', cell: (plan) => plan.key },
                {
                  key: 'code',
                  header: 'Paystack plan code',
                  cell: (plan) => plan.providerPlanCode ?? '—',
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
            <p>
              Last signed webhook:{' '}
              {row.lastWebhook
                ? `${date(row.lastWebhook.receivedAt)} · ${row.lastWebhook.processingState}`
                : 'None received'}
            </p>
          </section>
        ))
      )}
    </PlatformPage>
  );
}

export function PlatformBillingDetail({
  kind,
  id,
}: {
  kind: 'subscriptions' | 'transactions';
  id: string;
}) {
  const { session } = usePlatformSession();
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundNotice, setRefundNotice] = useState('');
  const [reconciliation, setReconciliation] = useState<{ discrepancies: string[] } | null>(null);
  useEffect(() => {
    void apiRequest<{ data: Record<string, unknown> }>(`/platform/billing/${kind}/${id}`)
      .then((response) => setRow(response.data))
      .catch(() => setError('Billing record could not be loaded.'));
  }, [kind, id]);
  return (
    <PlatformPage
      title={kind === 'subscriptions' ? 'Subscription detail' : 'Transaction detail'}
      actions={<Link href={`/platform/billing/${kind}`}>Back to {kind}</Link>}
    >
      {error ? (
        <p role="alert" className="rb-platform__alert">
          {error}
        </p>
      ) : !row ? (
        <DetailSkeleton variant="profile" />
      ) : (
        <div className="rb-security-section">
          {Object.entries(row)
            .filter(
              ([key, value]) =>
                ![
                  'rawPayload',
                  'transactions',
                  'changes',
                  'usage',
                  'audits',
                  'entitlements',
                ].includes(key) &&
                (typeof value !== 'object' || value === null),
            )
            .map(([key, value]) => (
              <p key={key}>
                <strong>{key.replace(/([A-Z])/g, ' $1')}:</strong> {scalar(value)}
              </p>
            ))}
          {'organization' in row ? (
            <p>
              <strong>Organization:</strong>{' '}
              {(row.organization as { legalName?: string })?.legalName}
            </p>
          ) : null}
          {'plan' in row ? (
            <p>
              <strong>Plan:</strong> {(row.plan as { name?: string })?.name}
            </p>
          ) : null}
          {kind === 'subscriptions' && platformRoleAtLeast(session?.role ?? null, 'OPERATIONS') ? (
            <section>
              <Button
                variant="outline"
                onClick={() =>
                  void apiRequest<{ data: { discrepancies: string[] } }>(
                    `/platform/billing/subscriptions/${id}/reconcile`,
                    { method: 'POST' },
                  )
                    .then((response) => setReconciliation(response.data))
                    .catch(() => setError('Provider reconciliation could not be completed.'))
                }
              >
                Check provider state
              </Button>
              {reconciliation ? (
                <p role="status">
                  {reconciliation.discrepancies.length
                    ? reconciliation.discrepancies.join(' ')
                    : 'Provider and local cancellation state agree.'}
                </p>
              ) : null}
            </section>
          ) : null}
          {(['transactions', 'changes', 'usage', 'audits'] as const).map((key) =>
            Array.isArray(row[key]) && (row[key] as unknown[]).length > 0 ? (
              <section key={key}>
                <h2>{key}</h2>
                <ul>
                  {(row[key] as Array<Record<string, unknown>>).map((item, index) => {
                    const reference =
                      item.providerTransactionId ??
                      item.eventKey ??
                      item.resourceKey ??
                      item.status ??
                      item.id ??
                      index;
                    return (
                      <li key={typeof item.id === 'string' ? item.id : index}>
                        {typeof reference === 'string' || typeof reference === 'number'
                          ? reference
                          : 'Record'}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null,
          )}
          {kind === 'transactions' &&
          row.status === 'SUCCESSFUL' &&
          platformRoleAtLeast(session?.role ?? null, 'OPERATIONS') ? (
            <section>
              <h2>Request refund</h2>
              <p>
                A separate superadmin must approve submission. Provider confirmation determines
                completion.
              </p>
              <label>
                Amount in minor units{' '}
                <input
                  inputMode="numeric"
                  pattern="[0-9]+"
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                  placeholder={String(row.amountMinor)}
                />
              </label>
              <label>
                Reason{' '}
                <input
                  minLength={10}
                  maxLength={500}
                  value={refundReason}
                  onChange={(event) => setRefundReason(event.target.value)}
                />
              </label>
              <Button
                disabled={!/^\d+$/.test(refundAmount) || refundReason.trim().length < 10}
                onClick={() =>
                  void apiRequest(`/platform/billing/transactions/${id}/refunds`, {
                    method: 'POST',
                    body: JSON.stringify({ amountMinor: refundAmount, reason: refundReason }),
                  })
                    .then(() => {
                      setRefundNotice('Refund request recorded for separate approval.');
                      setRefundReason('');
                      setRefundAmount('');
                    })
                    .catch(() => setError('Refund request could not be recorded.'))
                }
              >
                Request refund
              </Button>
              {refundNotice ? <p role="status">{refundNotice}</p> : null}
            </section>
          ) : null}
        </div>
      )}
    </PlatformPage>
  );
}
