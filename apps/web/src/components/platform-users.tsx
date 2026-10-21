'use client';

import type { PlatformUser } from '@valuebooks/contracts';
import { DataTable, PrimarySecondaryCell } from '@valuebooks/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import {
  platformQuery,
  platformRoleAtLeast,
  usePlatformSession,
  type Paginated,
} from '../lib/platform';
import { Pager, Row, StatusPill } from './platform-organizations';
import { PlatformPage } from './platform-shell';

type UserDetail = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  platformRole: string | null;
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    organizationStatus: string;
    roleKey: string;
    roleName: string;
    membershipStatus: string;
  }>;
  activeSessions: Array<{ createdAt: string; userAgent: string | null }>;
  securityEvents: Array<{ eventKey: string; severity: string; occurredAt: string }>;
};

function securityEventLabel(eventKey: string) {
  const labels: Record<string, string> = {
    'auth.bootstrap_verified': 'Account verification completed',
    'auth.login_succeeded': 'Successful sign-in',
    'auth.login_failed': 'Failed sign-in attempt',
    'session.revoked': 'Session revoked',
  };
  return (
    labels[eventKey] ??
    eventKey.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

export function PlatformUsers() {
  const [rows, setRows] = useState<PlatformUser[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ query: '', status: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiRequest<Paginated<PlatformUser>>(
        `/platform/users${platformQuery({ ...filters, page })}`,
      );
      setRows(response.data);
      setTotalRows(response.pagination.totalRows);
    } catch {
      setError('Users could not be loaded.');
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
      title="Users"
      description={`${totalRows.toLocaleString()} account${totalRows === 1 ? '' : 's'}.`}
    >
      <form className="rb-platform__filters" onSubmit={search}>
        <label>
          Search
          <input
            value={filters.query}
            placeholder="Email or name"
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          />
        </label>
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">Any</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING_VERIFICATION">Pending verification</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <button type="submit">Apply</button>
      </form>

      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}

      <DataTable
        caption="Users"
        rows={rows ?? []}
        loading={rows === null}
        emptyTitle="No users match these filters"
        columns={[
          {
            key: 'person',
            header: 'Person',
            cell: (row: PlatformUser) => (
              <PrimarySecondaryCell
                primary={<Link href={`/platform/users/${row.id}`}>{row.displayName}</Link>}
                secondary={row.email}
                primaryTitle={row.displayName}
                secondaryTitle={row.email}
              />
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (row: PlatformUser) => <StatusPill status={row.status} />,
          },
          {
            key: 'verified',
            header: 'Verified',
            cell: (row: PlatformUser) => (row.emailVerified ? 'Yes' : 'No'),
          },
          {
            key: 'memberships',
            header: 'Memberships',
            cell: (row: PlatformUser) => row.membershipCount,
            align: 'right',
          },
          {
            key: 'joined',
            header: 'Joined',
            cell: (row: PlatformUser) => new Date(row.createdAt).toLocaleDateString(),
            hideBelow: 'tablet',
          },
        ]}
      />

      <Pager page={page} pageSize={25} totalRows={totalRows} onChange={setPage} />
    </PlatformPage>
  );
}

export function PlatformUserDetail({ userId }: { userId: string }) {
  const { session } = usePlatformSession();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const canOperate = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data: UserDetail }>(`/platform/users/${userId}`);
      setUser(response.data);
      setStatus(response.data.status);
    } catch {
      setError('This account could not be loaded.');
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/platform/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reason }),
      });
      setNotice('Account status updated. Any live sessions were revoked.');
      setReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The status could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <PlatformPage title="User">
        {error ? (
          <p className="rb-platform__alert" role="alert">
            {error}
          </p>
        ) : (
          <p className="rb-platform__muted">Loading…</p>
        )}
      </PlatformPage>
    );
  }

  return (
    <PlatformPage
      title={user.displayName}
      description={user.email}
      actions={<StatusPill status={user.status} />}
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

      <div className="rb-platform-user__summary-grid">
        <section className="rb-platform__card" aria-label="Account information">
          <h2>Account information</h2>
          <dl>
            <Row label="Email verified" value={user.emailVerified ? 'Yes' : 'No'} />
            <Row label="Joined" value={new Date(user.createdAt).toLocaleDateString()} />
            <Row label="Platform role" value={user.platformRole ?? 'None'} />
            <Row label="Active sessions" value={user.activeSessions.length} />
          </dl>
        </section>

        <section className="rb-platform__card" aria-label="Recent security events">
          <h2>Recent security events</h2>
          {user.securityEvents.length === 0 ? (
            <p className="rb-platform__muted">No recent security events.</p>
          ) : (
            <ul className="rb-platform__list">
              {user.securityEvents.map((event, index) => (
                <li key={`${event.eventKey}-${index}`}>
                  <span title={event.eventKey}>{securityEventLabel(event.eventKey)}</span>
                  <time dateTime={event.occurredAt}>
                    {new Date(event.occurredAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canOperate ? (
        <section className="rb-platform__card rb-platform-user__administration">
          <h2>Account administration</h2>
          <div className="rb-platform-user__administration-form">
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="CLOSED">Closed</option>
              </select>
            </label>
            <label>
              Reason
              <input
                value={reason}
                minLength={4}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <p className="rb-platform__muted">
              Anything other than Active revokes this person&apos;s live sessions immediately.
            </p>
            <div className="rb-platform__actions">
              <button
                type="button"
                disabled={busy || status === user.status || reason.trim().length < 4}
                onClick={() => void save()}
              >
                Update status
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rb-platform__section" aria-label="Memberships">
        <h2>Memberships</h2>
        <DataTable
          caption="User memberships"
          rows={user.memberships.map((membership) => ({
            ...membership,
            id: membership.organizationId,
          }))}
          emptyTitle="No organization memberships"
          emptyDescription="This user is not currently associated with any organization."
          emptyState={{ variant: 'inline' }}
          columns={[
            {
              key: 'organization',
              header: 'Organization',
              cell: (membership) => (
                <PrimarySecondaryCell
                  primary={
                    <Link href={`/platform/organizations/${membership.organizationId}`}>
                      {membership.organizationName}
                    </Link>
                  }
                  primaryTitle={membership.organizationName}
                />
              ),
            },
            { key: 'role', header: 'Role', cell: (membership) => membership.roleName },
            {
              key: 'membership',
              header: 'Membership',
              cell: (membership) => <StatusPill status={membership.membershipStatus} />,
            },
            {
              key: 'organization-status',
              header: 'Organization status',
              cell: (membership) => <StatusPill status={membership.organizationStatus} />,
            },
          ]}
        />
      </section>
    </PlatformPage>
  );
}
