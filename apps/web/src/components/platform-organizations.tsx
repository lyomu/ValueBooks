'use client';

import {
  describeOrganizationPlan,
  OFFICIAL_PLAN_CATALOG,
  OFFICIAL_PLAN_TIERS,
  type OrganizationEntitlements,
  type PlatformOrganization,
  type PlatformUsage,
} from '@valuebooks/contracts';
import {
  Badge,
  DataTable,
  DataTablePagination,
  PrimarySecondaryCell,
  StatusBadge,
} from '@valuebooks/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { apiRequest } from '../lib/api';
import { platformQuery, type Paginated } from '../lib/platform';
import { PlatformPage } from './platform-shell';

export type OrganizationDetail = PlatformOrganization & {
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
  // Overview drilldowns link here with a filter already chosen, e.g. ?status=SUSPENDED.
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState({
    query: searchParams.get('query') ?? '',
    status: searchParams.get('status') ?? '',
    countryCode: searchParams.get('countryCode') ?? '',
    planKey: searchParams.get('planKey') ?? '',
  });
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

export function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rb-platform__row">
      <dt>{label}</dt>
      <dd>{typeof value === 'number' ? value.toLocaleString() : value}</dd>
    </div>
  );
}
