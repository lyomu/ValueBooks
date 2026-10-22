'use client';

import type { PlatformRole, PlatformUser } from '@valuebooks/contracts';
import {
  Badge,
  Button,
  DataTable,
  DataTableFilters,
  DataTablePagination,
  DataTableSearch,
  DataTableToolbar,
  DetailSkeleton,
  ErrorState,
  PrimarySecondaryCell,
  Select,
  StatusBadge,
} from '@valuebooks/ui';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

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

type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

type UserDetail = {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: string;
  platformRole: PlatformRole | null;
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    organizationStatus: string;
    roleKey: string;
    roleName: string;
    membershipStatus: string;
  }>;
  activeSessionCount: number;
  activeSessions: Array<{ createdAt: string; lastSeenAt: string; userAgent: string | null }>;
  securityEvents: Array<{ eventKey: string; severity: string; occurredAt: string }>;
};

const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = {
  SUPPORT: 'Support',
  OPERATIONS: 'Operations',
  SUPERADMIN: 'Superadmin',
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
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState({
    query: searchParams.get('query') ?? '',
    status: searchParams.get('status') ?? '',
    platformAccess: searchParams.get('platformAccess') ?? '',
  });
  const [search, setSearch] = useState(filters.query);
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

  // Search settles before it queries; selects apply at once.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => (current.query === search ? current : { ...current, query: search }));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  function filter(key: 'status' | 'platformAccess', value: string) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const toolbar = (
    <DataTableToolbar
      resultLabel={
        totalRows === null
          ? undefined
          : `${totalRows.toLocaleString()} account${totalRows === 1 ? '' : 's'}`
      }
    >
      <DataTableSearch
        label="Search users"
        placeholder="Email or name"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <DataTableFilters>
        <Select
          aria-label="Account status"
          value={filters.status}
          onChange={(event) => filter('status', event.target.value)}
        >
          <option value="">Any account status</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_VERIFICATION">Pending verification</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="CLOSED">Closed</option>
        </Select>
        <Select
          aria-label="Platform access"
          value={filters.platformAccess}
          onChange={(event) => filter('platformAccess', event.target.value)}
        >
          <option value="">Anyone</option>
          <option value="ADMIN">Platform administrators</option>
          <option value="NONE">No platform access</option>
        </Select>
      </DataTableFilters>
    </DataTableToolbar>
  );

  return (
    <PlatformPage
      title="Users"
      description="Every account on this deployment. Platform access and organization roles are separate."
    >
      {error ? (
        <ErrorState
          title="Users could not be loaded"
          description="This is a loading failure, not an empty list."
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="Users"
          toolbar={toolbar}
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
              header: 'Account',
              cell: (row: PlatformUser) => <StatusBadge status={row.status} />,
            },
            {
              key: 'platform',
              header: 'Platform access',
              cell: (row: PlatformUser) =>
                row.platformRole ? (
                  <Badge tone="info">{PLATFORM_ROLE_LABEL[row.platformRole]}</Badge>
                ) : (
                  <span className="rb-table-secondary">None</span>
                ),
            },
            {
              key: 'memberships',
              header: 'Organizations',
              cell: (row: PlatformUser) => row.membershipCount.toLocaleString(),
              align: 'right',
            },
            {
              key: 'verified',
              header: 'Email verified',
              cell: (row: PlatformUser) => (row.emailVerified ? 'Yes' : 'No'),
              hideBelow: 'tablet',
            },
            {
              key: 'joined',
              header: 'Joined',
              cell: (row: PlatformUser) => new Date(row.createdAt).toLocaleDateString(),
              hideBelow: 'tablet',
            },
          ]}
        />
      )}

      <DataTablePagination
        page={page}
        pageSize={25}
        totalRows={totalRows ?? 0}
        onPageChange={setPage}
      />
    </PlatformPage>
  );
}

type StatusAction = 'suspend' | 'close' | 'reactivate';

const STATUS_ACTION: Record<
  StatusAction,
  { status: UserStatus; title: string; notice: string; tone: 'primary' | 'danger' }
> = {
  suspend: {
    status: 'SUSPENDED',
    title: 'Suspend account',
    notice: 'Account suspended. Its live sessions were revoked.',
    tone: 'danger',
  },
  close: {
    status: 'CLOSED',
    title: 'Close account',
    notice: 'Account closed. Its live sessions were revoked.',
    tone: 'danger',
  },
  reactivate: {
    status: 'ACTIVE',
    title: 'Reactivate account',
    notice: 'Account reactivated.',
    tone: 'primary',
  },
};

/** Transitions offered from each state. An unverified account is never activated by hand. */
const ACTIONS_FROM: Record<UserStatus, StatusAction[]> = {
  PENDING_VERIFICATION: ['suspend', 'close'],
  ACTIVE: ['suspend', 'close'],
  SUSPENDED: ['reactivate', 'close'],
  CLOSED: ['reactivate'],
};

export function PlatformUserDetail({ userId }: { userId: string }) {
  const { session } = usePlatformSession();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [dialog, setDialog] = useState<StatusAction | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const canOperate = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data: UserDetail }>(`/platform/users/${userId}`);
      setUser(response.data);
      setError('');
    } catch {
      setError('This account could not be loaded.');
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(action: StatusAction, reason: string) {
    await apiRequest(`/platform/users/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: STATUS_ACTION[action].status, reason }),
    });
    setNotice(STATUS_ACTION[action].notice);
    await load();
  }

  if (!user) {
    return (
      <PlatformPage title="User">
        {error ? (
          <ErrorState title="Account unavailable" description={error} />
        ) : (
          <DetailSkeleton variant="profile" />
        )}
      </PlatformPage>
    );
  }

  const organizations = user.memberships.length;

  return (
    <PlatformPage
      title={user.displayName}
      description={user.email}
      meta={<>Joined {new Date(user.createdAt).toLocaleDateString()}</>}
      actions={
        <div className="rb-platform__detail-actions">
          <StatusBadge status={user.status} />
          {user.platformRole ? (
            <Badge tone="info">Platform {PLATFORM_ROLE_LABEL[user.platformRole]}</Badge>
          ) : null}
        </div>
      }
    >
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="rb-platform__grid">
        <Panel title="Account">
          <dl>
            <Row label="Account status" value={readable(user.status)} />
            <Row label="Email verified" value={user.emailVerified ? 'Yes' : 'No'} />
            <Row label="Joined" value={new Date(user.createdAt).toLocaleDateString()} />
            <Row label="Live sessions" value={user.activeSessionCount} />
          </dl>
        </Panel>
        <Panel title="Platform access">
          {user.platformRole ? (
            <>
              <dl>
                <Row label="Console role" value={PLATFORM_ROLE_LABEL[user.platformRole]} />
              </dl>
              <p className="rb-platform__muted">
                Grants access to this console. Granted and revoked by a superadmin, separately from
                the account status.
              </p>
            </>
          ) : (
            <p className="rb-platform__muted">
              No platform access. Organization roles below apply only inside those organizations and
              grant nothing in this console.
            </p>
          )}
        </Panel>
      </div>

      <Panel title="Organization memberships">
        <DataTable
          caption="Organization memberships"
          rows={user.memberships.map((membership) => ({
            ...membership,
            id: membership.organizationId,
          }))}
          emptyTitle="No organization memberships"
          emptyDescription="This account does not belong to any organization. That is valid, not an error."
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
            {
              key: 'role',
              header: 'Organization role',
              cell: (membership) => membership.roleName,
            },
            {
              key: 'membership',
              header: 'Membership',
              cell: (membership) => <StatusBadge status={membership.membershipStatus} />,
            },
            {
              key: 'organization-status',
              header: 'Organization status',
              cell: (membership) => <StatusBadge status={membership.organizationStatus} />,
            },
          ]}
        />
      </Panel>

      <div className="rb-platform__grid">
        <Panel title="Live sessions">
          <DataTable
            caption="Live sessions"
            rows={user.activeSessions.map((item, index) => ({ ...item, id: String(index) }))}
            emptyTitle="No live sessions"
            emptyDescription="This account is not signed in anywhere."
            emptyState={{ variant: 'inline' }}
            columns={[
              {
                key: 'device',
                header: 'Device',
                cell: (item) => (
                  <span title={item.userAgent ?? undefined}>{deviceLabel(item.userAgent)}</span>
                ),
              },
              {
                key: 'seen',
                header: 'Last seen',
                cell: (item) => new Date(item.lastSeenAt).toLocaleString(),
              },
              {
                key: 'started',
                header: 'Signed in',
                cell: (item) => new Date(item.createdAt).toLocaleString(),
                hideBelow: 'tablet',
              },
            ]}
          />
          {user.activeSessionCount > user.activeSessions.length ? (
            <p className="rb-platform__muted">
              Showing the {user.activeSessions.length} most recent of {user.activeSessionCount}.
            </p>
          ) : null}
        </Panel>
        <Panel title="Recent security events">
          <DataTable
            caption="Recent security events"
            rows={user.securityEvents.map((event, index) => ({ ...event, id: String(index) }))}
            emptyTitle="No security events"
            emptyDescription="Nothing has been recorded for this account."
            emptyState={{ variant: 'inline' }}
            columns={[
              {
                key: 'event',
                header: 'Event',
                cell: (event) => (
                  <span title={event.eventKey}>{securityEventLabel(event.eventKey)}</span>
                ),
              },
              {
                key: 'severity',
                header: 'Severity',
                cell: (event) => <StatusBadge status={event.severity} />,
              },
              {
                key: 'when',
                header: 'When',
                cell: (event) => new Date(event.occurredAt).toLocaleString(),
              },
            ]}
          />
          <Link href={`/platform/security?userId=${user.id}`}>All security events</Link>
        </Panel>
      </div>

      {canOperate ? (
        <Panel title="Account administration">
          <p>
            Account status controls whether this person can sign in at all, in every organization.
            Anything other than Active revokes their live sessions immediately.
          </p>
          <div className="rb-platform__detail-actions">
            {ACTIONS_FROM[user.status].map((action) => (
              <Button
                key={action}
                variant={STATUS_ACTION[action].tone === 'danger' ? 'danger' : 'primary'}
                onClick={() => setDialog(action)}
              >
                {action === 'reactivate' ? <ShieldCheck aria-hidden="true" /> : null}
                {STATUS_ACTION[action].title}
              </Button>
            ))}
          </div>
          {user.status === 'PENDING_VERIFICATION' ? (
            <p className="rb-platform__muted">
              This account has not verified its email. It becomes active when the person does; the
              console does not activate it on their behalf.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {(['suspend', 'close'] as const).map((action) => (
        <AdminActionDialog
          key={action}
          open={dialog === action}
          onOpenChange={(open) => setDialog(open ? action : null)}
          title={STATUS_ACTION[action].title}
          description={user.email}
          tone="danger"
          confirmLabel={STATUS_ACTION[action].title}
          confirmationPhrase={user.email}
          impact={
            <>
              <p>
                <strong>{user.displayName}</strong> can no longer sign in. Their{' '}
                {user.activeSessionCount.toLocaleString()} live session
                {user.activeSessionCount === 1 ? ' is' : 's are'} revoked now, across{' '}
                {organizations.toLocaleString()} organization{organizations === 1 ? '' : 's'}.
              </p>
              {user.platformRole ? (
                <p>
                  This person is a platform {PLATFORM_ROLE_LABEL[user.platformRole].toLowerCase()}.
                  Their console grant is not revoked, but they cannot use it while the account is
                  not active.
                </p>
              ) : null}
              <p>
                {action === 'close'
                  ? 'Closing is meant to be permanent. Organizations, memberships and their data are untouched.'
                  : 'Organizations, memberships and their data are untouched, and reactivation restores access.'}
              </p>
            </>
          }
          onConfirm={(reason) => changeStatus(action, reason)}
        />
      ))}
      <AdminActionDialog
        open={dialog === 'reactivate'}
        onOpenChange={(open) => setDialog(open ? 'reactivate' : null)}
        title="Reactivate account"
        description={user.email}
        confirmLabel="Reactivate account"
        impact={
          <p>
            <strong>{user.displayName}</strong> can sign in again, with the memberships and roles
            they already hold. Sessions revoked earlier stay revoked.
          </p>
        }
        onConfirm={(reason) => changeStatus('reactivate', reason)}
      />
    </PlatformPage>
  );
}

function readable(status: string): string {
  const text = status.replaceAll('_', ' ').toLowerCase();
  return `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
}

/** A short, honest device hint; the full user agent stays in the tooltip. */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null;
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return browser && os ? `${browser} on ${os}` : (browser ?? os ?? 'Unrecognized client');
}
