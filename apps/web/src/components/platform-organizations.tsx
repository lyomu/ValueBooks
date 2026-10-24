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
  Button,
  DataTable,
  DataTableFilters,
  DataTablePagination,
  DataTableSearch,
  DataTableToolbar,
  ErrorState,
  Input,
  PrimarySecondaryCell,
  Select,
  StatusBadge,
} from '@valuebooks/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

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

const SUBSCRIPTION_FILTERS: Array<[string, string]> = [
  ['TRIALING', 'Trialing'],
  ['TRIAL_EXPIRED', 'Trial expired'],
  ['ACTIVE', 'Active'],
  ['PAST_DUE', 'Past due'],
  ['CANCEL_SCHEDULED', 'Cancel scheduled'],
  ['CANCELLED', 'Cancelled'],
  ['NONE', 'Never subscribed'],
];

export function PlatformOrganizations() {
  const [rows, setRows] = useState<PlatformOrganization[] | null>(null);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  // Overview drilldowns link here with a filter already chosen, e.g. ?status=SUSPENDED.
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState({
    query: searchParams.get('query') ?? '',
    status: searchParams.get('status') ?? '',
    subscriptionStatus: searchParams.get('subscriptionStatus') ?? '',
    onboarding: searchParams.get('onboarding') ?? '',
    countryCode: searchParams.get('countryCode') ?? '',
    planKey: searchParams.get('planKey') ?? '',
  });
  // Typed filters settle before they query; a one-letter country code is never sent.
  const [draft, setDraft] = useState({ query: filters.query, countryCode: filters.countryCode });
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

  useEffect(() => {
    if (draft.countryCode.length === 1) return;
    const timer = setTimeout(() => {
      setFilters((current) =>
        current.query === draft.query && current.countryCode === draft.countryCode
          ? current
          : { ...current, ...draft },
      );
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft]);

  function filter(key: keyof typeof filters, value: string) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const toolbar = (
    <DataTableToolbar
      resultLabel={
        totalRows === null
          ? undefined
          : `${totalRows.toLocaleString()} organization${totalRows === 1 ? '' : 's'}`
      }
    >
      <DataTableSearch
        label="Search organizations"
        placeholder="Name or slug"
        value={draft.query}
        onChange={(event) => setDraft({ ...draft, query: event.target.value })}
      />
      <DataTableFilters>
        <Select
          aria-label="Tenant status"
          value={filters.status}
          onChange={(event) => filter('status', event.target.value)}
        >
          <option value="">Any tenant status</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">In setup</option>
          <option value="SUSPENDED">Suspended</option>
        </Select>
        <Select
          aria-label="Subscription"
          value={filters.subscriptionStatus}
          onChange={(event) => filter('subscriptionStatus', event.target.value)}
        >
          <option value="">Any subscription</option>
          {SUBSCRIPTION_FILTERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Plan"
          value={filters.planKey}
          onChange={(event) => filter('planKey', event.target.value)}
        >
          <option value="">All plans</option>
          {OFFICIAL_PLAN_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {OFFICIAL_PLAN_CATALOG[tier].name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Setup"
          value={filters.onboarding}
          onChange={(event) => filter('onboarding', event.target.value)}
        >
          <option value="">Any setup state</option>
          <option value="COMPLETE">Setup finished</option>
          <option value="INCOMPLETE">Setup not finished</option>
        </Select>
        <Input
          aria-label="Country code"
          className="rb-platform__country-filter"
          value={draft.countryCode}
          maxLength={2}
          placeholder="Country"
          onChange={(event) =>
            setDraft({ ...draft, countryCode: event.target.value.toUpperCase() })
          }
        />
      </DataTableFilters>
    </DataTableToolbar>
  );

  return (
    <PlatformPage
      title="Organizations"
      description="Every tenant on this deployment, with lifecycle, subscription and setup state kept separate."
    >
      {error ? (
        <ErrorState
          title="Organizations could not be loaded"
          description="This is a loading failure, not an empty list."
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="Organizations"
          toolbar={toolbar}
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
                  secondary={`${row.slug} · ${row.countryCode}`}
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
              key: 'plan',
              header: 'Subscription',
              cell: (row: PlatformOrganization) => {
                const plan = describeOrganizationPlan(row);
                return <Badge tone={plan.tone}>{plan.label}</Badge>;
              },
            },
            {
              key: 'members',
              header: 'Active members',
              cell: (row: PlatformOrganization) => row.memberCount.toLocaleString(),
              align: 'right',
              hideBelow: 'tablet',
            },
            {
              key: 'activity',
              header: 'Last activity',
              cell: (row: PlatformOrganization) =>
                row.lastActivityAt ? (
                  new Date(row.lastActivityAt).toLocaleDateString()
                ) : (
                  <span className="rb-table-secondary">None recorded</span>
                ),
            },
            {
              key: 'owner',
              header: 'Owner',
              cell: (row: PlatformOrganization) => row.ownerEmail,
              hideBelow: 'desktop',
            },
            {
              key: 'created',
              header: 'Created',
              cell: (row: PlatformOrganization) => new Date(row.createdAt).toLocaleDateString(),
              hideBelow: 'desktop',
            },
          ]}
        />
      )}
      <p className="rb-platform__muted rb-platform__footnote">
        Last activity is the latest recorded change in the tenant&apos;s books or settings. Sign-ins
        and read-only use are not recorded, so an idle date does not prove nobody logged in.
      </p>

      <DataTablePagination
        page={page}
        pageSize={25}
        totalRows={totalRows ?? 0}
        onPageChange={setPage}
      />
    </PlatformPage>
  );
}
