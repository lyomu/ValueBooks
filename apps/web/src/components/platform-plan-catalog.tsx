'use client';

import {
  OFFICIAL_ENTITLEMENT_KEYS,
  OFFICIAL_ENTITLEMENT_LABELS,
  OFFICIAL_FEATURE_KEYS,
  OFFICIAL_PLAN_CATALOG,
  OFFICIAL_PLAN_TIERS,
  OFFICIAL_TRIAL,
  officialYearlySavingsPercent,
  type OfficialPlanTier,
  type PlatformPlan,
} from '@valuebooks/contracts';
import {
  Badge,
  Button,
  DataTable,
  ErrorState,
  PrimarySecondaryCell,
  StatusBadge,
} from '@valuebooks/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import {
  approvedAllowance as approved,
  describeAllowance as describe,
  enforcedAllowance as enforced,
  sameAllowance as same,
} from '../lib/plan-catalog';
import { Panel } from './platform-organization-detail';
import { PlatformPage } from './platform-shell';

type CodeState = 'READY' | 'MISSING_CODE' | 'DUPLICATE_CODE' | 'WRONG_PROVIDER' | 'MISSING_PLAN';
type ProviderCoverage = {
  provider: string;
  environment: string;
  plans: Array<{ key: string; state: CodeState; providerPlanCode: string | null }>;
};
type Feed<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

const OFFICIAL_KEYS = new Set(
  OFFICIAL_PLAN_TIERS.flatMap((tier) => [`${tier}_monthly`, `${tier}_yearly`]),
);
const CODE_LABEL: Record<CodeState, [string, 'success' | 'warning' | 'danger']> = {
  READY: ['Paystack code set', 'success'],
  MISSING_CODE: ['No Paystack code', 'danger'],
  DUPLICATE_CODE: ['Code used twice', 'danger'],
  WRONG_PROVIDER: ['Not on Paystack', 'danger'],
  MISSING_PLAN: ['Plan row missing', 'danger'],
};

function money(minor: string | number, currency: string): string {
  return `${currency} ${(Number(minor) / 100).toFixed(2)}`;
}

/**
 * The commercial catalog as it is enforced: four tiers × two intervals read from the database,
 * checked against the approved catalog in `@valuebooks/contracts`. Read-only by design. Price and
 * entitlement changes need a versioned, previewed, approved change (master plan §10.3), not an
 * inline edit to a live plan that subscribers already hold.
 */
export function PlatformPlanCatalog() {
  const [plans, setPlans] = useState<Feed<PlatformPlan[]>>({ status: 'loading' });
  const [coverage, setCoverage] = useState<Feed<ProviderCoverage | null>>({ status: 'loading' });

  const load = useCallback(() => {
    setPlans({ status: 'loading' });
    setCoverage({ status: 'loading' });
    apiRequest<{ data: PlatformPlan[] }>('/platform/plans')
      .then((response) => setPlans({ status: 'ready', data: response.data }))
      .catch(() => setPlans({ status: 'error' }));
    apiRequest<{ data: ProviderCoverage[] }>('/platform/billing/providers')
      .then((response) =>
        setCoverage({
          status: 'ready',
          data: response.data.find((row) => row.provider === 'PAYSTACK') ?? null,
        }),
      )
      .catch(() => setCoverage({ status: 'error' }));
  }, []);

  useEffect(() => load(), [load]);

  const retry = (
    <Button variant="secondary" size="sm" onClick={load}>
      Try again
    </Button>
  );

  if (plans.status === 'error') {
    return (
      <PlatformPage title="Plans & pricing">
        <ErrorState
          title="The plan catalog could not be loaded"
          description="This is a loading failure, not an empty catalog."
          action={retry}
        />
      </PlatformPage>
    );
  }

  const rows = plans.status === 'ready' ? plans.data : [];
  const byKey = new Map(rows.map((plan) => [plan.key, plan]));
  const codeFor = (key: string) =>
    coverage.status === 'ready' ? coverage.data?.plans.find((row) => row.key === key) : undefined;
  const legacy = rows.filter((plan) => !OFFICIAL_KEYS.has(plan.key) || plan.status !== 'ACTIVE');
  const matrixKeys = [...OFFICIAL_ENTITLEMENT_KEYS, ...OFFICIAL_FEATURE_KEYS];
  const extraKeys = [
    ...new Set(
      OFFICIAL_PLAN_TIERS.flatMap(
        (tier) => byKey.get(`${tier}_monthly`)?.entitlements.map((row) => row.key) ?? [],
      ),
    ),
  ].filter((key) => !(matrixKeys as readonly string[]).includes(key));

  const priceCell = (tier: OfficialPlanTier, interval: 'monthly' | 'yearly') => {
    const key = `${tier}_${interval}`;
    const plan = byKey.get(key);
    const official = OFFICIAL_PLAN_CATALOG[tier];
    const approvedMinor =
      interval === 'monthly' ? official.monthlyPriceMinor : official.yearlyPriceMinor;
    const code = codeFor(key);
    return (
      <div className="rb-plan-catalog__price">
        {plan ? (
          <strong>{money(plan.priceMinor, plan.currency)}</strong>
        ) : (
          <Badge tone="danger">Missing</Badge>
        )}
        {plan &&
        (Number(plan.priceMinor) !== approvedMinor || plan.currency !== official.currency) ? (
          <Badge tone="danger" title={`Approved: ${money(approvedMinor, official.currency)}`}>
            Differs from approved {money(approvedMinor, official.currency)}
          </Badge>
        ) : null}
        {coverage.status === 'error' ? (
          <span className="rb-table-secondary">Code status unavailable</span>
        ) : code ? (
          <Badge tone={CODE_LABEL[code.state][1]} title={code.providerPlanCode ?? undefined}>
            {CODE_LABEL[code.state][0]}
          </Badge>
        ) : null}
      </div>
    );
  };

  return (
    <PlatformPage
      title="Plans & pricing"
      description="The approved catalog as the platform enforces it. Read-only: what customers are charged and what each tier allows."
      meta={
        coverage.status === 'ready' && coverage.data ? (
          <>Paystack {coverage.data.environment} environment</>
        ) : undefined
      }
    >
      <Panel title="Catalog">
        <DataTable
          caption="Plan catalog"
          loading={plans.status === 'loading'}
          rows={OFFICIAL_PLAN_TIERS.map((tier) => ({ id: tier, tier }))}
          columns={[
            {
              key: 'plan',
              header: 'Plan',
              cell: ({ tier }) => (
                <span className="rb-plan-catalog__name">
                  {OFFICIAL_PLAN_CATALOG[tier].name}
                  {OFFICIAL_PLAN_CATALOG[tier].mostPopular ? (
                    <Badge tone="info">Most popular</Badge>
                  ) : null}
                </span>
              ),
            },
            { key: 'monthly', header: 'Monthly', cell: ({ tier }) => priceCell(tier, 'monthly') },
            {
              key: 'yearly',
              header: 'Yearly',
              cell: ({ tier }) => (
                <>
                  {priceCell(tier, 'yearly')}
                  <span className="rb-table-secondary">
                    Saves {officialYearlySavingsPercent(OFFICIAL_PLAN_CATALOG[tier])}% versus
                    monthly
                  </span>
                </>
              ),
            },
            {
              key: 'subscribers',
              header: 'Subscribed organizations',
              align: 'right',
              cell: ({ tier }) => {
                const monthly = byKey.get(`${tier}_monthly`)?.subscriberCount ?? 0;
                const yearly = byKey.get(`${tier}_yearly`)?.subscriberCount ?? 0;
                return (
                  <Link href={`/platform/organizations?planKey=${tier}`}>
                    {(monthly + yearly).toLocaleString()}
                    <span className="rb-table-secondary">
                      {' '}
                      ({monthly} monthly · {yearly} yearly)
                    </span>
                  </Link>
                );
              },
            },
          ]}
        />
        <p className="rb-platform__muted">
          Prices are integer cents in USD, each interval its own approved figure. Subscriber counts
          include trials and complimentary grants on the plan row. Trial:{' '}
          {OFFICIAL_TRIAL.hours / 24} days of {OFFICIAL_PLAN_CATALOG[OFFICIAL_TRIAL.tierKey].name}{' '}
          access, no card, with AI insight requests capped at{' '}
          {OFFICIAL_TRIAL.limitOverrides['ai_insights.max']}.
        </p>
        <Link href="/platform/billing/providers">Payment provider setup</Link>
      </Panel>

      <Panel title="Entitlements by tier">
        <DataTable
          caption="Entitlement matrix"
          loading={plans.status === 'loading'}
          rows={[...matrixKeys, ...extraKeys].map((key) => ({ id: key, key }))}
          columns={[
            {
              key: 'entitlement',
              header: 'Entitlement',
              cell: ({ key }) => (
                <span title={key}>
                  {OFFICIAL_ENTITLEMENT_LABELS[key as keyof typeof OFFICIAL_ENTITLEMENT_LABELS] ??
                    key}
                  {extraKeys.includes(key) ? (
                    <span className="rb-table-secondary"> · not in the approved catalog</span>
                  ) : null}
                </span>
              ),
            },
            ...OFFICIAL_PLAN_TIERS.map((tier) => ({
              key: tier,
              header: OFFICIAL_PLAN_CATALOG[tier].name,
              cell: ({ key }: { key: string }) => {
                const feature = (OFFICIAL_FEATURE_KEYS as readonly string[]).includes(key);
                const monthly = enforced(byKey.get(`${tier}_monthly`), key);
                const yearly = enforced(byKey.get(`${tier}_yearly`), key);
                const target = approved(tier, key);
                const drift = !same(monthly, target);
                const split = !same(monthly, yearly);
                return (
                  <span className={drift || split ? 'rb-plan-catalog__drift' : undefined}>
                    {describe(monthly, feature)}
                    {drift ? (
                      <Badge tone="danger" title="What the approved catalog says">
                        Approved: {describe(target, feature)}
                      </Badge>
                    ) : null}
                    {split ? (
                      <Badge tone="warning" title="The yearly plan row enforces something else">
                        Yearly: {describe(yearly, feature)}
                      </Badge>
                    ) : null}
                  </span>
                );
              },
            })),
          ]}
        />
        <p className="rb-platform__muted">
          Read from the monthly plan rows; a yearly row that disagrees is flagged. Monthly caps
          reset monthly on yearly plans too. A red badge means the enforced value differs from the
          approved catalog.
        </p>
      </Panel>

      <Panel title="Legacy and inactive plans">
        <DataTable
          caption="Legacy and inactive plans"
          loading={plans.status === 'loading'}
          rows={legacy}
          emptyTitle="No legacy plans"
          emptyDescription="Every plan row is one of the eight approved, active plans."
          emptyState={{ variant: 'inline' }}
          columns={[
            {
              key: 'plan',
              header: 'Plan',
              cell: (plan) => <PrimarySecondaryCell primary={plan.name} secondary={plan.key} />,
            },
            {
              key: 'status',
              header: 'Status',
              cell: (plan) => <StatusBadge status={plan.status} />,
            },
            {
              key: 'price',
              header: 'Price',
              cell: (plan) =>
                `${money(plan.priceMinor, plan.currency)} / ${plan.billingInterval.toLowerCase()}`,
            },
            {
              key: 'subscribers',
              header: 'Organizations still on it',
              align: 'right',
              cell: (plan) =>
                plan.subscriberCount > 0 ? (
                  <Badge tone="warning">{plan.subscriberCount.toLocaleString()}</Badge>
                ) : (
                  '0'
                ),
            },
          ]}
        />
        <p className="rb-platform__muted">
          Kept so existing subscribers keep their history and terms. Not offered to new customers;
          moving anyone off a legacy plan needs an explicit, approved migration.
        </p>
      </Panel>
    </PlatformPage>
  );
}
