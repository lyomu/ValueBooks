'use client';

import {
  describeOrganizationPlan,
  OFFICIAL_PLAN_CATALOG,
  OFFICIAL_PLAN_TIERS,
  type OrganizationEntitlements,
  type PlatformOrganization,
  type PlatformUsage,
  type SubscriptionStatus,
} from '@valuebooks/contracts';
import {
  Badge,
  DataTable,
  DataTablePagination,
  DetailSkeleton,
  PrimarySecondaryCell,
  StatusBadge,
} from '@valuebooks/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import {
  platformQuery,
  platformRoleAtLeast,
  usePlatformSession,
  type Paginated,
} from '../lib/platform';
import { PlatformPage } from './platform-shell';

type Detail = PlatformOrganization & {
  locale: string;
  timeZone: string;
  suspendedBy: string | null;
  onboardingStep: string;
  onboardingCompletedAt: string | null;
  owner: { id: string; email: string; displayName: string };
  members: Array<{
    userId: string;
    email: string;
    displayName: string;
    userStatus: string;
    roleKey: string;
    roleName: string;
    membershipStatus: string;
  }>;
  usage: PlatformUsage;
  entitlements: OrganizationEntitlements;
};

export function PlatformOrganizations() {
  const [rows, setRows] = useState<PlatformOrganization[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ query: '', status: '', countryCode: '', planKey: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiRequest<Paginated<PlatformOrganization>>(
        `/platform/organizations${platformQuery({ ...filters, page })}`,
      );
      setRows(response.data);
      setTotalRows(response.pagination.totalRows);
    } catch {
      setError('Organizations could not be loaded.');
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
      title="Organizations"
      description={`${totalRows.toLocaleString()} tenant${totalRows === 1 ? '' : 's'} on this deployment.`}
    >
      <form className="rb-platform__filters" onSubmit={search}>
        <label>
          Search
          <input
            value={filters.query}
            placeholder="Name or slug"
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
            <option value="DRAFT">In setup</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </label>
        <label>
          Country
          <input
            value={filters.countryCode}
            maxLength={2}
            placeholder="KE"
            onChange={(event) =>
              setFilters({ ...filters, countryCode: event.target.value.toUpperCase() })
            }
          />
        </label>
        <label>
          Plan
          <select
            value={filters.planKey}
            onChange={(event) => setFilters({ ...filters, planKey: event.target.value })}
          >
            <option value="">All plans</option>
            {OFFICIAL_PLAN_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {OFFICIAL_PLAN_CATALOG[tier].name}
              </option>
            ))}
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
        caption="Organizations"
        rows={rows ?? []}
        loading={rows === null}
        emptyTitle="No organizations match these filters"
        columns={[
          {
            key: 'organization',
            header: 'Organization',
            cell: (row: PlatformOrganization) => (
              <PrimarySecondaryCell
                primary={<Link href={`/platform/organizations/${row.id}`}>{row.name}</Link>}
                secondary={row.slug}
                primaryTitle={row.name}
                secondaryTitle={row.slug}
              />
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (row: PlatformOrganization) => <StatusBadge status={row.status} />,
          },
          {
            key: 'country',
            header: 'Country',
            cell: (row: PlatformOrganization) => row.countryCode,
          },
          {
            key: 'plan',
            header: 'Plan',
            cell: (row: PlatformOrganization) => {
              const plan = describeOrganizationPlan(row);
              return <Badge tone={plan.tone}>{plan.label}</Badge>;
            },
          },
          {
            key: 'members',
            header: 'Members',
            cell: (row: PlatformOrganization) => row.memberCount,
            align: 'right',
          },
          {
            key: 'owner',
            header: 'Owner',
            cell: (row: PlatformOrganization) => row.ownerEmail,
            hideBelow: 'tablet',
          },
          {
            key: 'created',
            header: 'Created',
            cell: (row: PlatformOrganization) => new Date(row.createdAt).toLocaleDateString(),
            hideBelow: 'tablet',
          },
        ]}
      />

      <DataTablePagination page={page} pageSize={25} totalRows={totalRows} onPageChange={setPage} />
    </PlatformPage>
  );
}

export function PlatformOrganizationDetail({ organizationId }: { organizationId: string }) {
  const { session } = usePlatformSession();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [billing, setBilling] = useState<{
    id: string;
    status: string;
    billingProvider: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    lastPaymentAt: string | null;
    plan: { name: string };
    usage: Array<{ resourceKey: string; usedCount: number }>;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const canOperate = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data: Detail }>(
        `/platform/organizations/${organizationId}`,
      );
      setDetail(response.data);
      void apiRequest<{ data: typeof billing }>(`/platform/billing/tenants/${organizationId}`)
        .then((result) => setBilling(result.data))
        .catch(() => setBilling(null));
    } catch {
      setError('This organization could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/platform/organizations/${organizationId}/${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setNotice(success);
      setReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <PlatformPage title="Organization">
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      </PlatformPage>
    );
  }
  if (!detail) {
    return (
      <PlatformPage title="Organization">
        <DetailSkeleton variant="profile" />
      </PlatformPage>
    );
  }

  return (
    <PlatformPage
      title={detail.name}
      description={`${detail.slug} · ${detail.countryCode} · ${detail.baseCurrency}`}
      actions={<StatusBadge status={detail.status} />}
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

      {detail.status === 'SUSPENDED' ? (
        <section className="rb-platform__card is-warn" aria-label="Suspension">
          <h2>Suspended</h2>
          <p>
            {detail.suspendedReason ?? 'No reason recorded.'}
            {detail.suspendedAt
              ? `. Suspended on ${new Date(detail.suspendedAt).toLocaleString()}`
              : '. Recorded before platform administration existed.'}
            {detail.suspendedBy ? ` by ${detail.suspendedBy}` : ''}
          </p>
          <p className="rb-platform__muted">
            Suspension blocks access only. This tenant&apos;s books are unchanged and reactivation
            restores them exactly as they are.
          </p>
          {canOperate ? (
            <div className="rb-platform__actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void act('reactivate', { reason }, 'Organization reactivated.')}
              >
                Reactivate
              </button>
            </div>
          ) : null}
        </section>
      ) : canOperate ? (
        <section className="rb-platform__card" aria-label="Suspend this organization">
          <h2>Suspend</h2>
          <p className="rb-platform__muted">
            Blocks access without changing any data. A reason is required because it is the only
            durable answer to why this tenant was locked out.
          </p>
          <label>
            Reason
            <input
              value={reason}
              minLength={4}
              maxLength={500}
              placeholder="Non-payment, abuse report, customer request…"
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="rb-platform__actions">
            <button
              type="button"
              className="is-danger"
              disabled={busy || reason.trim().length < 4}
              onClick={() => void act('suspend', { reason }, 'Organization suspended.')}
            >
              Suspend organization
            </button>
          </div>
        </section>
      ) : null}

      <div className="rb-platform__grid">
        <section className="rb-platform__card" aria-label="Plan">
          <h2>Plan</h2>
          <dl>
            <Row
              label="Plan"
              value={
                describeOrganizationPlan({
                  planName: detail.entitlements.plan?.name ?? null,
                  planStatus: null,
                  subscriptionStatus:
                    (detail.entitlements.subscription?.status as SubscriptionStatus | undefined) ??
                    null,
                }).label
              }
            />
            <Row label="Subscription" value={detail.entitlements.subscription?.status ?? '—'} />
            <Row
              label="Trial ends"
              value={
                detail.entitlements.subscription?.trialEndsAt
                  ? new Date(detail.entitlements.subscription.trialEndsAt).toLocaleDateString()
                  : '—'
              }
            />
          </dl>
          <p className="rb-platform__muted">
            Paid changes require customer checkout and verified provider payment.
          </p>
        </section>

        <section className="rb-platform__card" aria-label="Billing and subscription">
          <h2>Billing &amp; Subscription</h2>
          {billing ? (
            <dl>
              <Row label="Plan" value={billing.plan.name} />
              <Row label="Provider" value={billing.billingProvider ?? 'Cardless trial'} />
              <Row label="Status" value={billing.status} />
              <Row
                label="Trial ends"
                value={billing.trialEndsAt ? new Date(billing.trialEndsAt).toLocaleString() : '—'}
              />
              <Row
                label="Paid through"
                value={
                  billing.currentPeriodEnd
                    ? new Date(billing.currentPeriodEnd).toLocaleString()
                    : '—'
                }
              />
              <Row
                label="Last payment"
                value={
                  billing.lastPaymentAt ? new Date(billing.lastPaymentAt).toLocaleString() : '—'
                }
              />
              <Row label="Usage counters" value={billing.usage.length} />
            </dl>
          ) : (
            <p className="rb-platform__muted">No billing subscription is recorded.</p>
          )}
          {billing ? (
            <Link href={`/platform/billing/subscriptions/${billing.id}`}>
              View subscription detail
            </Link>
          ) : null}
          {canOperate ? (
            <p>
              <Link href={`/platform/billing/organizations/${organizationId}/overrides`}>
                Manage support overrides
              </Link>
            </p>
          ) : null}
        </section>

        <section className="rb-platform__card" aria-label="Entitlements">
          <h2>Entitlements</h2>
          {detail.entitlements.entitlements.length === 0 ? (
            <p className="rb-platform__muted">This plan carries no entitlements.</p>
          ) : (
            <dl>
              {detail.entitlements.entitlements.map((entitlement) => (
                <Row
                  key={entitlement.key}
                  label={entitlement.key}
                  value={
                    !entitlement.enabled
                      ? 'off'
                      : entitlement.limitValue === null
                        ? 'unlimited'
                        : String(entitlement.limitValue)
                  }
                />
              ))}
            </dl>
          )}
        </section>

        <section className="rb-platform__card" aria-label="Feature flags">
          <h2>Feature flags</h2>
          {detail.entitlements.flags.length === 0 ? (
            <p className="rb-platform__muted">No active feature flags.</p>
          ) : (
            <dl>
              {detail.entitlements.flags.map((flag) => (
                <Row
                  key={flag.key}
                  label={flag.key}
                  value={`${flag.enabled ? 'on' : 'off'} · ${flag.decidedBy.toLowerCase()}`}
                />
              ))}
            </dl>
          )}
        </section>

        <section className="rb-platform__card" aria-label="Usage">
          <h2>Adoption</h2>
          <dl>
            <Row label="Issued invoices" value={detail.usage.issuedInvoices} />
            <Row
              label="First invoice"
              value={
                detail.usage.firstInvoiceAt
                  ? new Date(detail.usage.firstInvoiceAt).toLocaleDateString()
                  : '—'
              }
            />
            <Row label="Bills" value={detail.usage.bills} />
            <Row label="Posted journals" value={detail.usage.postedJournals} />
            <Row label="Reconciliations" value={detail.usage.reconciliations} />
            <Row label="Projects" value={detail.usage.projects} />
            <Row label="Inventory adjustments" value={detail.usage.inventoryAdjustments} />
            <Row label="Portal users" value={detail.usage.portalUsers} />
          </dl>
          <p className="rb-platform__muted">
            Counts and dates only. The console does not read this tenant&apos;s financial data.
          </p>
        </section>
      </div>

      <section className="rb-platform__section" aria-label="Members">
        <h2>Members</h2>
        <DataTable
          caption="Organization members"
          rows={detail.members.map((member) => ({ ...member, id: member.userId }))}
          emptyTitle="No members"
          columns={[
            {
              key: 'person',
              header: 'Person',
              cell: (member) => (
                <PrimarySecondaryCell
                  primary={
                    <Link href={`/platform/users/${member.userId}`}>{member.displayName}</Link>
                  }
                  secondary={member.email}
                  primaryTitle={member.displayName}
                  secondaryTitle={member.email}
                />
              ),
            },
            { key: 'role', header: 'Role', cell: (member) => member.roleName },
            { key: 'account', header: 'Account', cell: (member) => member.userStatus },
          ]}
        />
      </section>
    </PlatformPage>
  );
}

export function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rb-platform__row">
      <dt>{label}</dt>
      <dd>{typeof value === 'number' ? value.toLocaleString() : value}</dd>
    </div>
  );
}
