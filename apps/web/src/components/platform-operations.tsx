'use client';

import type {
  PlatformAuditEvent,
  PlatformFailedJob,
  PlatformQueueHealth,
  PlatformSecurityEvent,
} from '@valuebooks/contracts';
import { DataTable } from '@valuebooks/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import {
  platformQuery,
  platformRoleAtLeast,
  usePlatformSession,
  type Paginated,
} from '../lib/platform';
import { Pager } from './platform-organizations';
import { PlatformPage } from './platform-shell';

export function PlatformJobs() {
  const { session } = usePlatformSession();
  const [health, setHealth] = useState<PlatformQueueHealth | null>(null);
  const [rows, setRows] = useState<PlatformFailedJob[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const canRetry = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');

  const load = useCallback(async () => {
    try {
      const [healthResponse, jobsResponse] = await Promise.all([
        apiRequest<{ data: PlatformQueueHealth }>('/platform/jobs/health'),
        apiRequest<Paginated<PlatformFailedJob>>(`/platform/jobs/failed${platformQuery({ page })}`),
      ]);
      setHealth(healthResponse.data);
      setRows(jobsResponse.data);
      setTotalRows(jobsResponse.pagination.totalRows);
    } catch {
      setError('Job health could not be loaded.');
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(executionId: string) {
    setBusy(executionId);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/platform/jobs/${executionId}/retry`, { method: 'POST' });
      setNotice('Job requeued.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That job could not be retried.');
    } finally {
      setBusy('');
    }
  }

  return (
    <PlatformPage
      title="Jobs and queues"
      description="Queue depth is what is enqueued now; the scheduler figures are what was supposed to happen. A backlog in one and not the other is the signal worth chasing."
    >
      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}

      {health ? (
        <section className="rb-platform__stats" aria-label="Queue health">
          {Object.entries(health.queues.automation).map(([key, value]) => (
            <div key={`automation-${key}`} className="rb-platform__stat">
              <span>Automation {key}</span>
              <strong>{value}</strong>
            </div>
          ))}
          {Object.entries(health.queues.email).map(([key, value]) => (
            <div key={`email-${key}`} className="rb-platform__stat">
              <span>Email {key}</span>
              <strong>{value}</strong>
            </div>
          ))}
          <div className="rb-platform__stat">
            <span>Scheduler due now</span>
            <strong>{health.scheduler.dueNow}</strong>
          </div>
          <div className="rb-platform__stat">
            <span>Running</span>
            <strong>{health.scheduler.runningNow}</strong>
          </div>
          <div
            className={`rb-platform__stat${health.scheduler.failedLastDay > 0 ? ' is-warn' : ''}`}
          >
            <span>Failed (24h)</span>
            <strong>{health.scheduler.failedLastDay}</strong>
          </div>
        </section>
      ) : (
        <p className="rb-platform__muted">Loading queue health…</p>
      )}

      <section className="rb-platform__section" aria-label="Failed executions">
        <h2>Failed executions</h2>
        <DataTable
          caption="Failed executions"
          rows={rows ?? []}
          loading={rows === null}
          emptyTitle="Nothing has failed"
          columns={[
            {
              key: 'handler',
              header: 'Handler',
              cell: (row: PlatformFailedJob) => (
                <>
                  <strong>{row.handler}</strong>
                  <small>{row.occurrenceKey}</small>
                </>
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
            },
            {
              key: 'error',
              header: 'Error',
              cell: (row: PlatformFailedJob) => (
                <span className="rb-platform__error">{row.error ?? '—'}</span>
              ),
            },
            {
              key: 'failed',
              header: 'Failed',
              cell: (row: PlatformFailedJob) => new Date(row.createdAt).toLocaleString(),
              hideBelow: 'tablet',
            },
            {
              key: 'action',
              header: <span className="rb-visually-hidden">Actions</span>,
              cell: (row: PlatformFailedJob) =>
                canRetry ? (
                  <button
                    type="button"
                    disabled={busy === row.id}
                    onClick={() => void retry(row.id)}
                  >
                    Retry
                  </button>
                ) : (
                  '—'
                ),
            },
          ]}
        />
        <Pager page={page} pageSize={25} totalRows={totalRows} onChange={setPage} />
      </section>
    </PlatformPage>
  );
}

export function PlatformSecurityEvents() {
  const [rows, setRows] = useState<PlatformSecurityEvent[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ eventKey: '', severity: '', from: '', to: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiRequest<Paginated<PlatformSecurityEvent>>(
        `/platform/security-events${platformQuery({ ...filters, page })}`,
      );
      setRows(response.data);
      setTotalRows(response.pagination.totalRows);
    } catch {
      setError('Security events could not be loaded.');
    }
  }, [filters, page]);

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
            cell: (row: PlatformSecurityEvent) => (
              <span className={`rb-platform__pill${row.severity === 'INFO' ? '' : ' is-warn'}`}>
                {row.severity.toLowerCase()}
              </span>
            ),
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

      <Pager page={page} pageSize={25} totalRows={totalRows} onChange={setPage} />
    </PlatformPage>
  );
}

export function PlatformAudit() {
  const [rows, setRows] = useState<PlatformAuditEvent[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiRequest<Paginated<PlatformAuditEvent>>(`/platform/audit${platformQuery({ page })}`)
      .then((response) => {
        setRows(response.data);
        setTotalRows(response.pagination.totalRows);
      })
      .catch(() => setError('The platform audit log could not be loaded.'));
  }, [page]);

  return (
    <PlatformPage
      title="Platform audit"
      description="Every mutating action taken in this console. Kept separately from tenant audit logs, because most of these actions are cross-tenant and none of them were taken by the tenant."
    >
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
              <>
                {row.actorEmail}
                <small>{row.actorRole.toLowerCase()}</small>
              </>
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

      <Pager page={page} pageSize={25} totalRows={totalRows} onChange={setPage} />
    </PlatformPage>
  );
}
