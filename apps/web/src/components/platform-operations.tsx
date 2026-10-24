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
  DataTableFilterField,
  DataTableFilters,
  DataTablePagination,
  DataTableSearch,
  DataTableToolbar,
  Dialog,
  DrawerContent,
  ErrorState,
  Input,
  Label,
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
import { useCallback, useEffect, useMemo, useState } from 'react';

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
  return `Retry resumes the ${document} linked to this occurrence and finishes the posting without creating another document. An older occurrence claim without a document link requires manual reconciliation before retry.`;
}

/** Readable task names and what a retry does, per scheduled handler. Unknown handlers say less. */
const HANDLER_INFO: Record<string, { label: string; retry: string }> = {
  'recurring.invoice': {
    label: 'Recurring invoices',
    retry: `${recurringRetry('invoice')} If the earlier run queued an email but failed before recording the send, the customer may receive the email twice.`,
  },
  'recurring.bill': { label: 'Recurring bills', retry: recurringRetry('bill') },
  'recurring.expense': { label: 'Recurring expenses', retry: recurringRetry('expense') },
  'recurring.journal': {
    label: 'Recurring journals',
    retry: 'Retry uses the posting idempotency key to resume the same journal and advance its template once.',
  },
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
            size="wide"
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

/**
 * Readable names for security event keys (master plan §14.1), grouped as the filter shows them.
 * Unknown keys still appear, as the key made readable; the raw key always stays visible.
 */
const SECURITY_EVENT_GROUPS: Array<{ label: string; events: Record<string, string> }> = [
  {
    label: 'Sign-in and account security',
    events: {
      'auth.login_succeeded': 'Signed in',
      'auth.login_failed': 'Failed sign-in attempt',
      'auth.mfa_challenge_issued': 'Sign-in code sent',
      'auth.mfa_login_succeeded': 'Signed in with a sign-in code',
      'auth.mfa_verification_failed': 'Wrong sign-in code entered',
      'auth.mfa_step_up_succeeded': 'Identity re-confirmed with a code',
      'auth.mfa_enabled': 'Email sign-in codes turned on',
      'auth.mfa_disabled': 'Email sign-in codes turned off',
      'auth.password_reset': 'Password reset',
      'auth.signup': 'Account created',
      'auth.signup_email_verified': 'Email verified during sign-up',
      'auth.email_verified': 'Email address verified',
      'auth.bootstrap_verified': 'Account provisioned by system setup',
    },
  },
  {
    label: 'Team access',
    events: {
      'organization.invitation_sent': 'Invitation sent',
      'organization.invitation_accepted': 'Invitation accepted',
      'organization.invitation_revoked': 'Invitation revoked',
      'organization.member_updated': 'Member role or status changed',
      'organization.member_removed': 'Member removed',
    },
  },
  {
    label: 'Organization and books activity',
    events: {
      'organization.created': 'Organization created',
      'organization.finalized': 'Organization setup completed',
      'organization.section_updated': 'Organization settings changed',
      'billing.trial_started': 'Trial started',
      'currency.base_changed': 'Base currency changed',
      'currency.enabled': 'Currency enabled',
      'currency.disabled': 'Currency disabled',
      'currency.exchange_rate_created': 'Exchange rate added',
      'currency.exchange_rate_updated': 'Exchange rate changed',
      'ledger.account_created': 'Ledger account created',
      'ledger.account_updated': 'Ledger account changed',
      'ledger.account_archived': 'Ledger account archived',
      'ledger.journal_posted': 'Journal posted',
      'ledger.journal_reversed': 'Journal reversed',
      'numbering.document_config_updated': 'Document numbering changed',
      'numbering.journal_config_updated': 'Journal numbering changed',
      'periods.fiscal_year_created': 'Fiscal year created',
      'periods.period_closed': 'Period closed',
      'periods.period_locked': 'Period locked',
      'periods.period_reopened': 'Period reopened',
      'periods.period_unlocked': 'Period unlocked',
      'tax.code_created': 'Tax code created',
      'tax.code_updated': 'Tax code changed',
      'tax.code_archived': 'Tax code archived',
      'tax.rate_added': 'Tax rate added',
    },
  },
];
const SECURITY_EVENT_LABEL: Record<string, string> = Object.fromEntries(
  SECURITY_EVENT_GROUPS.flatMap((group) => Object.entries(group.events)),
);
const securityEventLabel = (key: string) => SECURITY_EVENT_LABEL[key] ?? readable(key);

const SEVERITIES = [
  ['INFO', 'Info'],
  ['WARNING', 'Warning'],
  ['ERROR', 'Error'],
  ['CRITICAL', 'Critical'],
] as const;

/** Labels for recorded detail fields. Minor-unit amounts say so; they are never shown as money. */
const METADATA_LABEL: Record<string, string> = {
  sessionId: 'Session record',
  debitMinor: 'Debit (minor units)',
  creditMinor: 'Credit (minor units)',
};
const metadataLabel = (key: string) =>
  METADATA_LABEL[key] ?? readable(key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
const metadataValue = (value: unknown) =>
  typeof value === 'string' ? value : value === null ? '—' : JSON.stringify(value);

const EMPTY_SECURITY_FILTERS = { eventKey: '', severity: '', actor: '', from: '', to: '' };

export function PlatformSecurityEvents() {
  const { session } = usePlatformSession();
  const seesSessionDetail = session?.role === 'SUPERADMIN';
  const [rows, setRows] = useState<PlatformSecurityEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_SECURITY_FILTERS);
  const [actorInput, setActorInput] = useState('');
  const [inspecting, setInspecting] = useState<PlatformSecurityEvent | null>(null);
  const scope = useLinkedScope();

  // The account search is typed; query once typing pauses rather than on every keystroke.
  useEffect(() => {
    const actor = actorInput.trim();
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.actor === actor ? current : { ...current, actor }));
      setPage((current) => (filters.actor === actor ? current : 1));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [actorInput, filters.actor]);

  const load = useCallback(() => {
    setFailed(false);
    setRows(null);
    apiRequest<Paginated<PlatformSecurityEvent>>(
      `/platform/security-events${platformQuery({ ...filters, ...scope.query, page })}`,
    )
      .then((response) => {
        setRows(response.data);
        setTotalRows(response.pagination.totalRows);
      })
      .catch(() => setFailed(true));
  }, [filters, page, scope.query]);
  useEffect(() => load(), [load]);

  function setFilter(key: keyof typeof EMPTY_SECURITY_FILTERS, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }
  const filtered = Object.values(filters).some(Boolean);

  return (
    <PlatformPage
      title="Security events"
      description="Sign-ins, account security and team access across every tenant, plus events that belong to no tenant. This is evidence: nothing here can be edited or deleted."
    >
      <LinkedScopeNote scope={scope} href="/platform/security" />
      {failed ? (
        <ErrorState
          title="Security events could not be loaded"
          description="This is a loading failure, not an empty log."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      ) : (
        <>
          <DataTable
            caption="Security events"
            toolbar={
              <DataTableToolbar
                resultLabel={rows ? `${totalRows.toLocaleString()} events` : undefined}
              >
                <DataTableSearch
                  label="Search by account email"
                  placeholder="Account email"
                  value={actorInput}
                  onChange={(event) => setActorInput(event.target.value)}
                />
                <DataTableFilters>
                  <Select
                    aria-label="Event"
                    value={filters.eventKey}
                    onChange={(event) => setFilter('eventKey', event.target.value)}
                  >
                    <option value="">Any event</option>
                    {SECURITY_EVENT_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {Object.entries(group.events).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  <Select
                    aria-label="Severity"
                    value={filters.severity}
                    onChange={(event) => setFilter('severity', event.target.value)}
                  >
                    <option value="">Any severity</option>
                    {SEVERITIES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                  <DataTableFilterField>
                    <Label htmlFor="security-from">From</Label>
                    <Input
                      id="security-from"
                      type="date"
                      title="UTC date"
                      value={filters.from}
                      max={filters.to || undefined}
                      onChange={(event) => setFilter('from', event.target.value)}
                    />
                  </DataTableFilterField>
                  <DataTableFilterField>
                    <Label htmlFor="security-to">To</Label>
                    <Input
                      id="security-to"
                      type="date"
                      title="UTC date"
                      value={filters.to}
                      min={filters.from || undefined}
                      onChange={(event) => setFilter('to', event.target.value)}
                    />
                  </DataTableFilterField>
                  {filtered || actorInput ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFilters(EMPTY_SECURITY_FILTERS);
                        setActorInput('');
                        setPage(1);
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                </DataTableFilters>
              </DataTableToolbar>
            }
            rows={rows ?? []}
            loading={rows === null}
            emptyTitle={filtered ? 'No events match these filters' : 'No security events recorded'}
            columns={[
              {
                key: 'event',
                header: 'Event',
                cell: (row: PlatformSecurityEvent) => (
                  <PrimarySecondaryCell
                    primary={securityEventLabel(row.eventKey)}
                    secondary={row.eventKey}
                    primaryTitle={row.eventKey}
                  />
                ),
              },
              {
                key: 'severity',
                header: 'Severity',
                cell: (row: PlatformSecurityEvent) => <StatusBadge status={row.severity} />,
              },
              {
                key: 'account',
                header: 'Account',
                cell: (row: PlatformSecurityEvent) =>
                  row.userId ? (
                    <Link href={`/platform/users/${row.userId}`}>{row.userEmail}</Link>
                  ) : (
                    <span className="rb-platform__muted">No account</span>
                  ),
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
                    <span className="rb-platform__muted">Platform-wide</span>
                  ),
                hideBelow: 'tablet',
              },
              {
                key: 'when',
                header: 'When',
                cell: (row: PlatformSecurityEvent) => (
                  <span title={row.occurredAt}>{dateTime(row.occurredAt)}</span>
                ),
                hideBelow: 'tablet',
              },
              {
                key: 'action',
                header: <span className="rb-visually-hidden">Actions</span>,
                align: 'right',
                cell: (row: PlatformSecurityEvent) => (
                  <Button variant="ghost" size="sm" onClick={() => setInspecting(row)}>
                    Details
                  </Button>
                ),
              },
            ]}
          />
          <DataTablePagination
            page={page}
            pageSize={25}
            totalRows={totalRows}
            onPageChange={setPage}
          />
        </>
      )}

      {inspecting ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setInspecting(null))}>
          <SecurityEventDetail event={inspecting} seesSessionDetail={seesSessionDetail} />
        </Dialog>
      ) : null}
    </PlatformPage>
  );
}

function SecurityEventDetail({
  event,
  seesSessionDetail,
}: {
  event: PlatformSecurityEvent;
  seesSessionDetail: boolean;
}) {
  const label = securityEventLabel(event.eventKey);
  const details =
    event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
      ? Object.entries(event.metadata as Record<string, unknown>)
      : [];
  return (
    <DrawerContent side="right" size="wide" title={label} description={event.eventKey}>
      <div className="rb-explain-panel rb-explain-panel--surface">
        <h2>{label}</h2>
        <p className="rb-platform__muted">{event.eventKey}</p>
        <dl>
          <Row label="Severity" value={readable(event.severity.toLowerCase())} />
          <Row label="When (UTC)" value={event.occurredAt} />
          <Row label="When (your time)" value={dateTime(event.occurredAt)} />
          <Row label="Account" value={event.userEmail ?? 'No account'} />
          <Row label="Organization" value={event.organizationName ?? 'Platform-wide'} />
          <Row label="Event ID" value={event.id} />
        </dl>
        <h3>Recorded details</h3>
        {details.length ? (
          <dl>
            {details.map(([key, value]) => (
              <Row key={key} label={metadataLabel(key)} value={metadataValue(value)} />
            ))}
          </dl>
        ) : (
          <p className="rb-platform__muted">No further details were recorded.</p>
        )}
        <p className="rb-platform__muted">
          {seesSessionDetail
            ? 'Network addresses are stored only as a hash and are not shown.'
            : 'Session details are shown to superadmins only. Network addresses are stored only as a hash and are not shown.'}
        </p>
        <h3>Related</h3>
        <ul>
          {event.userId ? (
            <li>
              <Link href={`/platform/security?userId=${event.userId}`}>
                All events for this account
              </Link>
            </li>
          ) : null}
          {event.organizationId ? (
            <>
              <li>
                <Link href={`/platform/security?organizationId=${event.organizationId}`}>
                  All events for this organization
                </Link>
              </li>
              <li>
                <Link href={`/platform/audit?organizationId=${event.organizationId}`}>
                  Platform audit for this organization
                </Link>
              </li>
            </>
          ) : null}
          {event.userId || event.organizationId ? null : <li>None: no account or tenant.</li>}
        </ul>
      </div>
    </DrawerContent>
  );
}

/**
 * Readable names for platform audit actions (master plan §14.2), grouped as the filter shows them.
 * Unknown keys still appear, as the key made readable; the raw key always stays visible.
 */
const AUDIT_ACTION_GROUPS: Array<{ label: string; actions: Record<string, string> }> = [
  {
    label: 'Organizations and users',
    actions: {
      'platform.organization_suspended': 'Organization suspended',
      'platform.organization_reactivated': 'Organization reactivated',
      'platform.user_status_changed': 'User status changed',
    },
  },
  {
    label: 'Plans and subscriptions',
    actions: {
      'platform.plan_assigned': 'Plan assigned',
      'platform.plan_created': 'Plan created',
      'platform.plan_updated': 'Plan changed',
      'platform.plan_provider_code_changed': 'Plan provider code changed',
      'platform.entitlement_updated': 'Entitlement set',
      'platform.entitlement_removed': 'Entitlement removed',
      'billing.trial_extended': 'Trial extended',
      'billing.override_requested': 'Billing override requested',
      'billing.override_approved': 'Billing override approved',
      'billing.override_revoked': 'Billing override revoked',
      'billing.refund_requested': 'Refund requested',
      'billing.refund_approved': 'Refund approved',
      'billing.webhook_retried': 'Payment webhook reprocessed',
    },
  },
  {
    label: 'Configuration',
    actions: {
      'platform.feature_flag_created': 'Feature flag created',
      'platform.feature_flag_updated': 'Feature flag changed',
      'platform.feature_flag_rule_set': 'Feature flag rule set',
      'platform.feature_flag_rule_removed': 'Feature flag rule removed',
      'platform.country_pack_created': 'Country pack draft created',
      'platform.country_pack_published': 'Country pack published',
      'platform.country_pack_deprecated': 'Country pack deprecated',
      'platform.country_pack_deleted': 'Country pack draft deleted',
      'platform.hosted_ai_egress_approved': 'Hosted AI data sharing approved',
      'platform.hosted_ai_egress_revoked': 'Hosted AI data sharing revoked',
    },
  },
  {
    label: 'Operations and access',
    actions: {
      'platform.job_retried': 'Scheduled job retried',
      'platform.admin_granted': 'Platform access granted',
      'platform.admin_revoked': 'Platform access revoked',
    },
  },
];
const AUDIT_ACTION_LABEL: Record<string, string> = Object.fromEntries(
  AUDIT_ACTION_GROUPS.flatMap((group) => Object.entries(group.actions)),
);
const auditActionLabel = (key: string) => AUDIT_ACTION_LABEL[key] ?? readable(key);

const EMPTY_AUDIT_FILTERS = { eventKey: '', actor: '', from: '', to: '' };

export function PlatformAudit() {
  const [rows, setRows] = useState<PlatformAuditEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_AUDIT_FILTERS);
  const [actorInput, setActorInput] = useState('');
  const [inspecting, setInspecting] = useState<PlatformAuditEvent | null>(null);
  const scope = useLinkedScope();

  // The administrator search is typed; query once typing pauses rather than on every keystroke.
  useEffect(() => {
    const actor = actorInput.trim();
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.actor === actor ? current : { ...current, actor }));
      setPage((current) => (filters.actor === actor ? current : 1));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [actorInput, filters.actor]);

  const load = useCallback(() => {
    setFailed(false);
    setRows(null);
    apiRequest<Paginated<PlatformAuditEvent>>(
      `/platform/audit${platformQuery({ ...filters, ...scope.query, page })}`,
    )
      .then((response) => {
        setRows(response.data);
        setTotalRows(response.pagination.totalRows);
      })
      .catch(() => setFailed(true));
  }, [filters, page, scope.query]);
  useEffect(() => load(), [load]);

  function setFilter(key: keyof typeof EMPTY_AUDIT_FILTERS, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }
  const filtered = Object.values(filters).some(Boolean);

  return (
    <PlatformPage
      title="Platform audit"
      description="Every change made in this console: who made it, to what, why, and what it was before and after. Kept apart from tenant audit logs, because these actions were not taken by the tenant."
    >
      <LinkedScopeNote scope={scope} href="/platform/audit" />
      {failed ? (
        <ErrorState
          title="The platform audit log could not be loaded"
          description="This is a loading failure, not an empty log."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      ) : (
        <>
          <DataTable
            caption="Platform audit events"
            toolbar={
              <DataTableToolbar
                resultLabel={rows ? `${totalRows.toLocaleString()} actions` : undefined}
              >
                <DataTableSearch
                  label="Search by administrator email"
                  placeholder="Administrator email"
                  value={actorInput}
                  onChange={(event) => setActorInput(event.target.value)}
                />
                <DataTableFilters>
                  <Select
                    aria-label="Action"
                    value={filters.eventKey}
                    onChange={(event) => setFilter('eventKey', event.target.value)}
                  >
                    <option value="">Any action</option>
                    {AUDIT_ACTION_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {Object.entries(group.actions).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  <DataTableFilterField>
                    <Label htmlFor="audit-from">From</Label>
                    <Input
                      id="audit-from"
                      type="date"
                      title="UTC date"
                      value={filters.from}
                      max={filters.to || undefined}
                      onChange={(event) => setFilter('from', event.target.value)}
                    />
                  </DataTableFilterField>
                  <DataTableFilterField>
                    <Label htmlFor="audit-to">To</Label>
                    <Input
                      id="audit-to"
                      type="date"
                      title="UTC date"
                      value={filters.to}
                      min={filters.from || undefined}
                      onChange={(event) => setFilter('to', event.target.value)}
                    />
                  </DataTableFilterField>
                  {filtered || actorInput ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFilters(EMPTY_AUDIT_FILTERS);
                        setActorInput('');
                        setPage(1);
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                </DataTableFilters>
              </DataTableToolbar>
            }
            rows={rows ?? []}
            loading={rows === null}
            emptyTitle={
              filtered ? 'No actions match these filters' : 'No platform actions recorded yet'
            }
            columns={[
              {
                key: 'action',
                header: 'Action',
                cell: (row: PlatformAuditEvent) => (
                  <PrimarySecondaryCell
                    primary={auditActionLabel(row.eventKey)}
                    secondary={row.eventKey}
                    primaryTitle={row.eventKey}
                  />
                ),
              },
              {
                key: 'organization',
                header: 'Organization',
                cell: (row: PlatformAuditEvent) =>
                  row.organizationId ? (
                    <Link href={`/platform/organizations/${row.organizationId}`}>
                      {row.organizationName ?? 'Organization'}
                    </Link>
                  ) : (
                    <span className="rb-platform__muted">Platform-wide</span>
                  ),
                hideBelow: 'tablet',
              },
              {
                key: 'reason',
                header: 'Reason',
                cell: (row: PlatformAuditEvent) =>
                  row.reason ?? <span className="rb-platform__muted">None recorded</span>,
                hideBelow: 'desktop',
              },
              {
                key: 'administrator',
                header: 'Administrator',
                cell: (row: PlatformAuditEvent) => (
                  <PrimarySecondaryCell
                    primary={row.actorEmail}
                    secondary={readable(row.actorRole.toLowerCase())}
                    primaryTitle={row.actorEmail}
                  />
                ),
                hideBelow: 'tablet',
              },
              {
                key: 'when',
                header: 'When',
                cell: (row: PlatformAuditEvent) => (
                  <span title={row.occurredAt}>{dateTime(row.occurredAt)}</span>
                ),
                hideBelow: 'tablet',
              },
              {
                key: 'details',
                header: <span className="rb-visually-hidden">Actions</span>,
                align: 'right',
                cell: (row: PlatformAuditEvent) => (
                  <Button variant="ghost" size="sm" onClick={() => setInspecting(row)}>
                    Details
                  </Button>
                ),
              },
            ]}
          />
          <DataTablePagination
            page={page}
            pageSize={25}
            totalRows={totalRows}
            onPageChange={setPage}
          />
        </>
      )}

      {inspecting ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setInspecting(null))}>
          <AuditEventDetail event={inspecting} />
        </Dialog>
      ) : null}
    </PlatformPage>
  );
}

function AuditEventDetail({ event }: { event: PlatformAuditEvent }) {
  const label = auditActionLabel(event.eventKey);
  return (
    <DrawerContent side="right" size="wide" title={label} description={event.eventKey}>
      <div className="rb-explain-panel rb-explain-panel--surface">
        <h2>{label}</h2>
        <p className="rb-platform__muted">{event.eventKey}</p>
        <dl>
          <Row label="Administrator" value={`${event.actorName} (${event.actorEmail})`} />
          <Row label="Role at the time" value={readable(event.actorRole.toLowerCase())} />
          <Row label="When (UTC)" value={event.occurredAt} />
          <Row label="When (your time)" value={dateTime(event.occurredAt)} />
          <Row label="Target" value={`${readable(event.targetType)} ${event.targetId ?? ''}`} />
          <Row label="Organization" value={event.organizationName ?? 'Platform-wide'} />
          <Row label="Audit record" value={event.id} />
        </dl>
        <h3>Reason</h3>
        <p>{event.reason ?? 'No reason was recorded for this action.'}</p>
        <h3>What changed</h3>
        <AuditDiff before={event.before} after={event.after} />
        {event.organizationId ? (
          <>
            <h3>Related</h3>
            <ul>
              <li>
                <Link href={`/platform/audit?organizationId=${event.organizationId}`}>
                  All platform actions for this organization
                </Link>
              </li>
              <li>
                <Link href={`/platform/security?organizationId=${event.organizationId}`}>
                  Security events for this organization
                </Link>
              </li>
            </ul>
          </>
        ) : null}
      </div>
    </DrawerContent>
  );
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const diffValue = (value: unknown) =>
  value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value);
const fieldLabel = (key: string) => readable(key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());

/**
 * A field-by-field comparison of an audit row's stored before and after states. It shows what was
 * recorded and nothing more: actions that recorded no state say so instead of implying no change.
 */
function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
  const beforeRecord = asRecord(before);
  const afterRecord = asRecord(after);
  if (!beforeRecord && !afterRecord) {
    if (before == null && after == null) {
      return <p className="rb-platform__muted">No before or after state was recorded.</p>;
    }
    return (
      <dl>
        <Row label="Before" value={before == null ? '—' : diffValue(before)} />
        <Row label="After" value={after == null ? '—' : diffValue(after)} />
      </dl>
    );
  }
  const keys = [
    ...new Set([...Object.keys(beforeRecord ?? {}), ...Object.keys(afterRecord ?? {})]),
  ];
  const changed = keys.filter(
    (key) => JSON.stringify(beforeRecord?.[key]) !== JSON.stringify(afterRecord?.[key]),
  );
  const unchanged = keys.filter((key) => !changed.includes(key));
  const note = !beforeRecord
    ? 'Created: there was no earlier state.'
    : !afterRecord
      ? 'Removed: there is no later state.'
      : null;
  return (
    <>
      {note ? <p className="rb-platform__muted">{note}</p> : null}
      {changed.length ? (
        <DataTable
          caption="Changed fields"
          rows={changed.map((key) => ({ id: key, key }))}
          columns={[
            { key: 'field', header: 'Field', cell: (row) => fieldLabel(row.key) },
            {
              key: 'before',
              header: 'Before',
              cell: (row) => diffValue(beforeRecord?.[row.key]),
            },
            { key: 'after', header: 'After', cell: (row) => diffValue(afterRecord?.[row.key]) },
          ]}
        />
      ) : (
        <p className="rb-platform__muted">The recorded states are identical.</p>
      )}
      {unchanged.length ? (
        <p className="rb-platform__muted">Unchanged: {unchanged.map(fieldLabel).join(', ')}.</p>
      ) : null}
    </>
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
