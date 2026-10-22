'use client';

import type {
  PlatformAuditEvent,
  PlatformFailedJob,
  PlatformQueueFailure,
  PlatformQueueHealth,
  PlatformSecurityEvent,
} from '@valuebooks/contracts';
import {
  Badge,
  Button,
  CardSkeleton,
  DataTable,
  DataTableFilters,
  DataTablePagination,
  DataTableToolbar,
  Dialog,
  DrawerContent,
  ErrorState,
  PrimarySecondaryCell,
  Select,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@valuebooks/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { apiRequest } from '../lib/api';
import {
  platformQuery,
  platformRoleAtLeast,
  usePlatformSession,
  type Paginated,
} from '../lib/platform';
import { AdminActionDialog } from './admin-action-dialog';
import { Panel, Row } from './platform-organization-detail';
import { PlatformPage } from './platform-shell';

function recurringRetry(document: string) {
  return `Each occurrence is claimed before its ${document} is created, so a retry never creates a second ${document} for the same occurrence. If the failed run had already claimed the occurrence, the retry creates nothing and the ${document} has to be created by hand.`;
}

/** Readable task names and what a retry does, per scheduled handler. Unknown handlers say less. */
const HANDLER_INFO: Record<string, { label: string; retry: string }> = {
  'recurring.invoice': { label: 'Recurring invoices', retry: recurringRetry('invoice') },
  'recurring.bill': { label: 'Recurring bills', retry: recurringRetry('bill') },
  'recurring.expense': { label: 'Recurring expenses', retry: recurringRetry('expense') },
  'recurring.journal': { label: 'Recurring journals', retry: recurringRetry('journal') },
  'invoice.reminder': {
    label: 'Invoice reminders',
    retry:
      'Sends the reminder emails still due. If the failure came after an email was delivered, the customer may receive it twice.',
  },
  'report.scheduled': {
    label: 'Scheduled reports',
    retry: 'Builds and sends the report again. Recipients may receive a second copy.',
  },
  'report.export': { label: 'Report exports', retry: 'Builds the export again.' },
  'billing.trial_reminder': {
    label: 'Trial reminders',
    retry: 'Sends the trial reminder again if it is still due. The owner may receive it twice.',
  },
  'billing.trial_expired': {
    label: 'Trial expiry',
    retry: 'Runs trial expiry for this organization again.',
  },
  'billing.maintenance': {
    label: 'Billing maintenance',
    retry: 'Runs billing maintenance for this organization again.',
  },
};
const handlerLabel = (handler: string) => HANDLER_INFO[handler]?.label ?? handler;
/** `send-email` / `report.export` → "Send email" / "Report export". */
const readable = (key: string) => {
  const text = key.replaceAll('.', ' ').replaceAll('_', ' ').replaceAll('-', ' ');
  return `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
};

const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';
/** "12 min ago" for queue age; exact time stays in the title. */
function age(value: string | null, now: number): string {
  if (!value) return '—';
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'under a minute';
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

type QueueKey = 'automation' | 'email';
const QUEUE_LABEL: Record<QueueKey, string> = { automation: 'Automations', email: 'Emails' };

export function PlatformJobs() {
  const { session } = usePlatformSession();
  const canRetry = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');
  const [health, setHealth] = useState<PlatformQueueHealth | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [rows, setRows] = useState<PlatformFailedJob[] | null>(null);
  const [rowsError, setRowsError] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [handler, setHandler] = useState('');
  const [notice, setNotice] = useState('');
  const [retrying, setRetrying] = useState<PlatformFailedJob | null>(null);
  const [inspecting, setInspecting] = useState<PlatformFailedJob | null>(null);

  const loadHealth = useCallback(() => {
    setHealthError(false);
    apiRequest<{ data: PlatformQueueHealth }>('/platform/jobs/health')
      .then((response) => setHealth(response.data))
      .catch(() => setHealthError(true));
  }, []);
  const loadFailures = useCallback(() => {
    setRowsError(false);
    apiRequest<Paginated<PlatformFailedJob>>(
      `/platform/jobs/failed${platformQuery({ page, handler })}`,
    )
      .then((response) => {
        setRows(response.data);
        setTotalRows(response.pagination.totalRows);
      })
      .catch(() => setRowsError(true));
  }, [page, handler]);
  useEffect(() => loadHealth(), [loadHealth]);
  useEffect(() => loadFailures(), [loadFailures]);

  const observed = health ? new Date(health.observedAt).getTime() : 0;

  return (
    <PlatformPage
      title="Jobs and queues"
      description="Queues show what is enqueued right now; the scheduler shows what was supposed to run. Every figure says which queue and which time span it covers."
      actions={
        <Button
          variant="outline"
          onClick={() => {
            loadHealth();
            loadFailures();
          }}
        >
          Refresh
        </Button>
      }
    >
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}

      {healthError ? (
        <ErrorState
          title="Queue health could not be loaded"
          description="This is a loading failure. It does not mean the queues are down."
          action={
            <Button variant="secondary" size="sm" onClick={loadHealth}>
              Try again
            </Button>
          }
        />
      ) : !health ? (
        <CardSkeleton />
      ) : (
        <>
          <Panel title="Queue health">
            <DataTable
              caption="Queue health by worker queue"
              rows={(['automation', 'email'] as const).map((key) => ({
                id: key,
                key,
                counts: health.queues[key],
                oldest: health.oldestWaitingAt[key],
              }))}
              columns={[
                { key: 'queue', header: 'Queue', cell: (row) => QUEUE_LABEL[row.key] },
                {
                  key: 'waiting',
                  header: 'Waiting',
                  align: 'right',
                  cell: (row) => row.counts.waiting ?? 0,
                },
                {
                  key: 'active',
                  header: 'Active',
                  align: 'right',
                  cell: (row) => row.counts.active ?? 0,
                },
                {
                  key: 'delayed',
                  header: 'Delayed',
                  align: 'right',
                  cell: (row) => row.counts.delayed ?? 0,
                  hideBelow: 'tablet',
                },
                {
                  key: 'failed',
                  header: 'Failed (retained)',
                  align: 'right',
                  cell: (row) =>
                    (row.counts.failed ?? 0) > 0 ? (
                      <Badge tone="warning">{row.counts.failed}</Badge>
                    ) : (
                      0
                    ),
                },
                {
                  key: 'oldest',
                  header: 'Oldest waiting',
                  cell: (row) => (
                    <span title={row.oldest ? dateTime(row.oldest) : undefined}>
                      {age(row.oldest, observed)}
                    </span>
                  ),
                  hideBelow: 'tablet',
                },
              ]}
            />
            <p className="rb-platform__muted">
              <strong>Failed (retained)</strong> counts every job that used up its retries and is
              kept for inspection, however long ago. It is not a 24-hour figure and only falls when
              a job is retried or removed.
            </p>
          </Panel>
          <Panel title="Scheduler">
            <dl>
              <Row label="Due now" value={health.scheduler.dueNow} />
              <Row
                label={`Overdue (more than ${health.scheduler.overdueAfterMinutes} min)`}
                value={health.scheduler.overdue}
              />
              <Row label="Running now" value={health.scheduler.runningNow} />
              <Row label="Failed in the last 24 hours" value={health.scheduler.failedLastDay} />
              <Row label="Next scheduled run" value={dateTime(health.scheduler.nextRunAt)} />
            </dl>
            <p className="rb-platform__muted">
              Scheduled executions in the database only (reports, reminders, recurring documents,
              billing tasks). Overdue work means the scheduler is not picking jobs up. Observed{' '}
              {dateTime(health.observedAt)}.
            </p>
          </Panel>
        </>
      )}

      <Panel title="Failures and recovery">
        <Tabs defaultValue="scheduled" className="rb-platform__tabs">
          <TabsList>
            <TabsTrigger value="scheduled">Scheduled executions</TabsTrigger>
            <TabsTrigger value="email">Email queue</TabsTrigger>
            <TabsTrigger value="automation">Automation queue</TabsTrigger>
          </TabsList>
          <TabsContent value="scheduled">
            {rowsError ? (
              <ErrorState
                title="Failed executions could not be loaded"
                description="This is a loading failure, not an empty list."
                action={
                  <Button variant="secondary" size="sm" onClick={loadFailures}>
                    Try again
                  </Button>
                }
              />
            ) : (
              <DataTable
                caption="Failed scheduled executions"
                toolbar={
                  <DataTableToolbar
                    resultLabel={rows ? `${totalRows.toLocaleString()} failed` : undefined}
                  >
                    <DataTableFilters>
                      <Select
                        aria-label="Task"
                        value={handler}
                        onChange={(event) => {
                          setHandler(event.target.value);
                          setPage(1);
                        }}
                      >
                        <option value="">Any task</option>
                        {Object.entries(HANDLER_INFO).map(([key, info]) => (
                          <option key={key} value={key}>
                            {info.label}
                          </option>
                        ))}
                      </Select>
                    </DataTableFilters>
                  </DataTableToolbar>
                }
                rows={rows ?? []}
                loading={rows === null}
                emptyTitle={
                  handler ? 'No failures for this task' : 'No failed scheduled executions'
                }
                columns={[
                  {
                    key: 'task',
                    header: 'Task',
                    cell: (row: PlatformFailedJob) => (
                      <PrimarySecondaryCell
                        primary={handlerLabel(row.handler)}
                        secondary={row.occurrenceKey}
                        primaryTitle={row.handler}
                      />
                    ),
                  },
                  {
                    key: 'organization',
                    header: 'Organization',
                    cell: (row: PlatformFailedJob) => (
                      <Link href={`/platform/organizations/${row.organizationId}`}>
                        {row.organizationName}
                      </Link>
                    ),
                  },
                  {
                    key: 'attempts',
                    header: 'Attempts',
                    cell: (row: PlatformFailedJob) => row.attempts,
                    align: 'right',
                    hideBelow: 'tablet',
                  },
                  {
                    key: 'error',
                    header: 'Error',
                    cell: (row: PlatformFailedJob) => (
                      <span className="rb-platform__error">{row.error ?? '—'}</span>
                    ),
                    hideBelow: 'tablet',
                  },
                  {
                    key: 'failed',
                    header: 'Failed',
                    cell: (row: PlatformFailedJob) => dateTime(row.completedAt ?? row.createdAt),
                    hideBelow: 'tablet',
                  },
                  {
                    key: 'action',
                    header: <span className="rb-visually-hidden">Actions</span>,
                    align: 'right',
                    cell: (row: PlatformFailedJob) => (
                      <div className="rb-platform__table-actions">
                        <Button variant="ghost" size="sm" onClick={() => setInspecting(row)}>
                          Details
                        </Button>
                        {canRetry ? (
                          <Button variant="outline" size="sm" onClick={() => setRetrying(row)}>
                            Retry
                          </Button>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            )}
            {rowsError ? null : (
              <DataTablePagination
                page={page}
                pageSize={25}
                totalRows={totalRows}
                onPageChange={setPage}
              />
            )}
          </TabsContent>
          {(['email', 'automation'] as const).map((queue) => (
            <TabsContent key={queue} value={queue}>
              <QueueFailures queue={queue} />
            </TabsContent>
          ))}
        </Tabs>
      </Panel>

      {inspecting ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setInspecting(null))}>
          <DrawerContent
            side="right"
            title={handlerLabel(inspecting.handler)}
            description={`${inspecting.organizationName} · occurrence ${inspecting.occurrenceKey}`}
          >
            <div className="rb-explain-panel rb-explain-panel--surface">
              <h2>{handlerLabel(inspecting.handler)}</h2>
              <p className="rb-platform__muted">{inspecting.organizationName}</p>
              <dl>
                <Row label="Execution" value={inspecting.id} />
                <Row label="Task key" value={inspecting.handler} />
                <Row label="Source" value={`${inspecting.sourceType} ${inspecting.sourceId}`} />
                <Row label="Attempts" value={inspecting.attempts} />
                <Row label="Created" value={dateTime(inspecting.createdAt)} />
                <Row label="Failed" value={dateTime(inspecting.completedAt)} />
              </dl>
              <h3>Error</h3>
              <p className="rb-platform__error">{inspecting.error ?? 'No error was recorded.'}</p>
              <h3>If retried</h3>
              <p className="rb-platform__muted">
                {HANDLER_INFO[inspecting.handler]?.retry ?? 'Runs the task again.'}
              </p>
            </div>
          </DrawerContent>
        </Dialog>
      ) : null}

      {retrying ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setRetrying(null))}
          title={`Retry ${handlerLabel(retrying.handler).toLowerCase()}`}
          description={`${retrying.organizationName} · occurrence ${retrying.occurrenceKey}`}
          confirmLabel="Retry execution"
          impact={
            <>
              <p>{HANDLER_INFO[retrying.handler]?.retry ?? 'Runs the task again.'}</p>
              <p>
                The execution is queued to run once more in the background. If another operator has
                already retried it, this request is refused.
              </p>
            </>
          }
          onConfirm={async (reason) => {
            await apiRequest(`/platform/jobs/${retrying.id}/retry`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            });
            setNotice(
              `${handlerLabel(retrying.handler)} re-queued for ${retrying.organizationName}.`,
            );
            loadHealth();
            loadFailures();
          }}
        />
      ) : null}
    </PlatformPage>
  );
}

/** Retained BullMQ failures: read-only, payloads withheld, addresses redacted by the API. */
function QueueFailures({ queue }: { queue: QueueKey }) {
  const [rows, setRows] = useState<PlatformQueueFailure[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    apiRequest<{ data: PlatformQueueFailure[] }>(`/platform/jobs/queues/${queue}/failed`)
      .then((response) => setRows(response.data))
      .catch(() => setError(true));
  }, [queue]);
  useEffect(() => load(), [load]);
  if (error) {
    return (
      <ErrorState
        title="Queue failures could not be loaded"
        description="The queue may be unreachable, or the request failed."
        action={
          <Button variant="secondary" size="sm" onClick={load}>
            Try again
          </Button>
        }
      />
    );
  }
  return (
    <>
      <DataTable
        caption={`Retained failures in the ${QUEUE_LABEL[queue].toLowerCase()} queue`}
        rows={rows ?? []}
        loading={rows === null}
        emptyTitle="No retained failures"
        emptyState={{ variant: 'inline' }}
        columns={[
          { key: 'name', header: 'Job', cell: (row) => readable(row.name) },
          { key: 'attempts', header: 'Attempts', align: 'right', cell: (row) => row.attemptsMade },
          { key: 'failed', header: 'Failed', cell: (row) => dateTime(row.failedAt) },
          {
            key: 'reason',
            header: 'Reason',
            cell: (row) => <span className="rb-platform__error">{row.reason ?? '—'}</span>,
            hideBelow: 'tablet',
          },
        ]}
      />
      <p className="rb-platform__muted rb-platform__footnote">
        The 25 most recent. Read-only: job contents are not shown, and email addresses in reasons
        are hidden. Queue jobs are not retried from the console, because a resend cannot be
        guaranteed to happen only once.
      </p>
    </>
  );
}

export function PlatformSecurityEvents() {
  const [rows, setRows] = useState<PlatformSecurityEvent[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ eventKey: '', severity: '', from: '', to: '' });
  const [error, setError] = useState('');
  const scope = useLinkedScope();

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiRequest<Paginated<PlatformSecurityEvent>>(
        `/platform/security-events${platformQuery({ ...filters, ...scope.query, page })}`,
      );
      setRows(response.data);
      setTotalRows(response.pagination.totalRows);
    } catch {
      setError('Security events could not be loaded.');
    }
  }, [filters, page, scope.query]);

  useEffect(() => {
    void load();
  }, [load]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    void load();
  }

  return (
    <PlatformPage
      title="Security events"
      description="Across every tenant, plus events with no tenant at all."
    >
      <LinkedScopeNote scope={scope} href="/platform/security" />
      <form className="rb-platform__filters" onSubmit={search}>
        <label>
          Event key
          <input
            value={filters.eventKey}
            placeholder="auth.login_failed"
            onChange={(event) => setFilters({ ...filters, eventKey: event.target.value })}
          />
        </label>
        <label>
          Severity
          <select
            value={filters.severity}
            onChange={(event) => setFilters({ ...filters, severity: event.target.value })}
          >
            <option value="">Any</option>
            <option value="INFO">Info</option>
            <option value="WARN">Warn</option>
            <option value="ERROR">Error</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </label>
        <button type="submit">Apply</button>
      </form>

      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}

      <DataTable
        caption="Security events"
        rows={rows ?? []}
        loading={rows === null}
        emptyTitle="No events match these filters"
        columns={[
          { key: 'event', header: 'Event', cell: (row: PlatformSecurityEvent) => row.eventKey },
          {
            key: 'severity',
            header: 'Severity',
            cell: (row: PlatformSecurityEvent) => <StatusBadge status={row.severity} />,
          },
          {
            key: 'user',
            header: 'User',
            cell: (row: PlatformSecurityEvent) => row.userEmail ?? '—',
            hideBelow: 'tablet',
          },
          {
            key: 'organization',
            header: 'Organization',
            cell: (row: PlatformSecurityEvent) =>
              row.organizationId ? (
                <Link href={`/platform/organizations/${row.organizationId}`}>
                  {row.organizationName}
                </Link>
              ) : (
                '—'
              ),
          },
          {
            key: 'when',
            header: 'When',
            cell: (row: PlatformSecurityEvent) => new Date(row.occurredAt).toLocaleString(),
            hideBelow: 'tablet',
          },
        ]}
      />

      <DataTablePagination page={page} pageSize={25} totalRows={totalRows} onPageChange={setPage} />
    </PlatformPage>
  );
}

export function PlatformAudit() {
  const [rows, setRows] = useState<PlatformAuditEvent[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const scope = useLinkedScope();

  useEffect(() => {
    void apiRequest<Paginated<PlatformAuditEvent>>(
      `/platform/audit${platformQuery({ ...scope.query, page })}`,
    )
      .then((response) => {
        setRows(response.data);
        setTotalRows(response.pagination.totalRows);
      })
      .catch(() => setError('The platform audit log could not be loaded.'));
  }, [page, scope.query]);

  return (
    <PlatformPage
      title="Platform audit"
      description="Every mutating action taken in this console. Kept separately from tenant audit logs, because most of these actions are cross-tenant and none of them were taken by the tenant."
    >
      <LinkedScopeNote scope={scope} href="/platform/audit" />
      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}

      <DataTable
        caption="Platform audit events"
        rows={rows ?? []}
        loading={rows === null}
        emptyTitle="No platform actions recorded yet"
        columns={[
          { key: 'action', header: 'Action', cell: (row: PlatformAuditEvent) => row.eventKey },
          {
            key: 'target',
            header: 'Target',
            cell: (row: PlatformAuditEvent) => (
              <>
                {row.targetType}
                {row.organizationId ? (
                  <>
                    {' '}
                    · <Link href={`/platform/organizations/${row.organizationId}`}>tenant</Link>
                  </>
                ) : null}
              </>
            ),
          },
          {
            key: 'reason',
            header: 'Reason',
            cell: (row: PlatformAuditEvent) => row.reason ?? '—',
            hideBelow: 'tablet',
          },
          {
            key: 'administrator',
            header: 'Administrator',
            cell: (row: PlatformAuditEvent) => (
              <PrimarySecondaryCell
                primary={row.actorEmail}
                secondary={row.actorRole.toLowerCase()}
                primaryTitle={row.actorEmail}
              />
            ),
          },
          {
            key: 'when',
            header: 'When',
            cell: (row: PlatformAuditEvent) => new Date(row.occurredAt).toLocaleString(),
            hideBelow: 'tablet',
          },
        ]}
      />

      <DataTablePagination page={page} pageSize={25} totalRows={totalRows} onPageChange={setPage} />
    </PlatformPage>
  );
}

/**
 * Detail pages link here pre-scoped to one organization (`?organizationId=`) or, for security
 * events, one account (`?userId=`). The scope is shown, so a narrowed list never passes for the
 * whole log.
 */
function useLinkedScope() {
  const searchParams = useSearchParams();
  const organizationId = searchParams.get('organizationId') ?? '';
  const userId = searchParams.get('userId') ?? '';
  const query = useMemo(
    () => ({ ...(organizationId ? { organizationId } : {}), ...(userId ? { userId } : {}) }),
    [organizationId, userId],
  );
  const label = organizationId ? 'one organization' : userId ? 'one account' : null;
  return { query, label };
}

function LinkedScopeNote({
  scope,
  href,
}: {
  scope: ReturnType<typeof useLinkedScope>;
  href: string;
}) {
  if (!scope.label) return null;
  return (
    <p className="rb-platform__notice" role="status">
      Showing entries for {scope.label} only. <Link href={href}>Show all</Link>
    </p>
  );
}
