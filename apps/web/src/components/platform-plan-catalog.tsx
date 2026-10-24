'use client';

import {
  OFFICIAL_ENTITLEMENT_KEYS,
  OFFICIAL_ENTITLEMENT_LABELS,
  OFFICIAL_FEATURE_KEYS,
  OFFICIAL_PLAN_CATALOG,
  OFFICIAL_PLAN_TIERS,
  OFFICIAL_TRIAL,
  type OfficialPlanTier,
  type PlatformPlan,
} from '@valuebooks/contracts';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DrawerContent,
  FieldMessage,
  FormField,
  Input,
  Label,
  ErrorState,
  PrimarySecondaryCell,
  Select,
  StatusBadge,
  Textarea,
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
import { platformRoleAtLeast, usePlatformSession } from '../lib/platform';
import { AdminActionDialog } from './admin-action-dialog';
import { Panel, Row } from './platform-organization-detail';
import { PlatformPage } from './platform-shell';

type CodeState = 'READY' | 'MISSING_CODE' | 'DUPLICATE_CODE' | 'WRONG_PROVIDER' | 'MISSING_PLAN';
type ProviderCoverage = {
  provider: string;
  environment: string;
  plans: Array<{ key: string; state: CodeState; providerPlanCode: string | null }>;
};
type PlanTier = { id: string; key: string; name: string; status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  isMostPopular: boolean; sortOrder: number; tagline: string | null; highlights: string[] };
type CatalogViolation = { code: string; subject: string; detail: string; category: 'INVARIANT' | 'LAUNCH_ENTITLEMENT_DRIFT' };
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
 * How the owner's 30-day price-increase notice stands for one proposed change, derived by the API
 * from the per-organization billing-notice ledger. Null for a reduction, which owes no notice.
 */
type NoticeState = {
  noticeDays: number;
  subscribersToReprice: number;
  noticesQueued: number;
  awaitingNotice: number;
  withinNoticePeriod: number;
  earliestPublishAt: string | null;
  publishable: boolean;
};

/** What publishing a proposed price would do, recounted by the API at publication time. */
type PricePreview = {
  id: string;
  planKey: string;
  fromPriceMinor: string;
  toPriceMinor: string;
  currency: string;
  direction: 'INCREASE' | 'DECREASE';
  subscribersToReprice: number;
  trialingUnaffected: number;
  stale: boolean;
  reason: string;
  notice: NoticeState | null;
};

type PriceHistory = {
  plan: { key: string; name: string; priceMinor: string; currency: string };
  history: Array<{
    priceMinor: string;
    currency: string;
    effectiveFrom: string;
    reason: string | null;
    publishedBy: string | null;
  }>;
};

/**
 * A price is typed in major units, because that is how a person thinks about it and a cents field
 * is how decimal-point mistakes happen. Returns minor units, or null when the text is not a price.
 */
function toMinor(major: string): string | null {
  const text = major.trim();
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const minor = BigInt(whole ?? '0') * 100n + BigInt(fraction.padEnd(2, '0'));
  return minor > 0n ? minor.toString() : null;
}

/**
 * The commercial catalog as it is enforced: four tiers × two intervals read from the database,
 * checked against the approved catalog in `@valuebooks/contracts`. Read-only by design. Price and
 * entitlement changes need a versioned, previewed, approved change (master plan §10.3), not an
 * inline edit to a live plan that subscribers already hold.
 */
const PLAN_CODE = /^PLN_[A-Za-z0-9]{4,60}$/;

export function PlatformPlanCatalog() {
  const { session } = usePlatformSession();
  const canManage = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');
  const [editing, setEditing] = useState<string | null>(null);
  const [newCode, setNewCode] = useState('');
  const [notice, setNotice] = useState('');
  const [pricing, setPricing] = useState<string | null>(null);
  const [newPrice, setNewPrice] = useState('');
  const [confirmPrice, setConfirmPrice] = useState('');
  const [publishing, setPublishing] = useState<{ planId: string; preview: PricePreview } | null>(
    null,
  );
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [plans, setPlans] = useState<Feed<PlatformPlan[]>>({ status: 'loading' });
  const [tiers, setTiers] = useState<Feed<PlanTier[]>>({ status: 'loading' });
  const [health, setHealth] = useState<Feed<CatalogViolation[]>>({ status: 'loading' });
  const [tierAction, setTierAction] = useState<{ kind: 'create' | 'activate' | 'retire'; tier?: PlanTier } | null>(null);
  const [tierKey, setTierKey] = useState('');
  const [tierName, setTierName] = useState('');
  const [tierSortOrder, setTierSortOrder] = useState('');
  const [tierMostPopular, setTierMostPopular] = useState(false);
  const [tierTagline, setTierTagline] = useState('');
  const [tierHighlights, setTierHighlights] = useState('');
  const [planAction, setPlanAction] = useState<{ tier: PlanTier; interval: 'MONTHLY' | 'YEARLY' } | null>(null);
  const [draftPrice, setDraftPrice] = useState('');
  const [entitlementAction, setEntitlementAction] = useState<PlatformPlan | null>(null);
  const [entitlementKey, setEntitlementKey] = useState<string>(OFFICIAL_ENTITLEMENT_KEYS[0]);
  const [entitlementEnabled, setEntitlementEnabled] = useState(true);
  const [entitlementLimit, setEntitlementLimit] = useState('');
  const [activatingPlan, setActivatingPlan] = useState<PlatformPlan | null>(null);
  const [coverage, setCoverage] = useState<Feed<ProviderCoverage | null>>({ status: 'loading' });

  const load = useCallback(() => {
    setPlans({ status: 'loading' });
    setTiers({ status: 'loading' });
    setHealth({ status: 'loading' });
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
    apiRequest<{ data: PlanTier[] }>('/platform/plan-tiers')
      .then((response) => setTiers({ status: 'ready', data: response.data }))
      .catch(() => setTiers({ status: 'error' }));
    apiRequest<{ data: CatalogViolation[] }>('/platform/plans/health')
      .then((response) => setHealth({ status: 'ready', data: response.data }))
      .catch(() => setHealth({ status: 'error' }));
  }, []);

  useEffect(() => load(), [load]);

  const openHistory = useCallback(async (planId: string) => {
    const response = await apiRequest<{ data: PriceHistory }>(`/platform/plans/${planId}/pricing`);
    setHistory(response.data);
  }, []);


  /**
   * The preview is read from the API rather than derived from the proposal: the subscriber count
   * that matters is the one at publication time, and only the API can say whether the plan has
   * moved since the change was proposed.
   */
  const openPublish = useCallback(async (planId: string, changeId: string) => {
    const response = await apiRequest<{ data: PricePreview }>(
      `/platform/plans/${planId}/price-changes/${changeId}/preview`,
    );
    setPublishing({ planId, preview: response.data });
  }, []);

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
  const tierRows = tiers.status === 'ready' ? tiers.data.filter((tier) => tier.status !== 'RETIRED') : [];
  const legacy = rows.filter((plan) => plan.status === 'RETIRED' || !tierRows.some((tier) => tier.key === plan.tierKey));
  const matrixKeys = [...OFFICIAL_ENTITLEMENT_KEYS, ...OFFICIAL_FEATURE_KEYS];
  const extraKeys = [
    ...new Set(rows.flatMap((plan) => plan.entitlements.map((row) => row.key))),
  ].filter((key) => !(matrixKeys as readonly string[]).includes(key));

  const priceCell = (tier: string, interval: 'monthly' | 'yearly') => {
    const plan = rows.find((row) => row.tierKey === tier && row.billingInterval === interval.toUpperCase() && row.status === 'ACTIVE') ??
      rows.find((row) => row.tierKey === tier && row.billingInterval === interval.toUpperCase() && row.status === 'DRAFT');
    const key = plan?.key ?? `${tier}_${interval}`;
    const code = codeFor(key);
    return (
      <div className="rb-plan-catalog__price">
        {plan ? (
          <strong>{money(plan.priceMinor, plan.currency)}</strong>
        ) : (
          <Badge tone="danger">Missing</Badge>
        )}
        {coverage.status === 'error' ? (
          <span className="rb-table-secondary">Code status unavailable</span>
        ) : code ? (
          <Badge tone={CODE_LABEL[code.state][1]} title={code.providerPlanCode ?? undefined}>
            {CODE_LABEL[code.state][0]}
          </Badge>
        ) : null}
        {plan?.pendingPriceChange ? (
          <Badge
            tone="warning"
            title={`Proposed by ${plan.pendingPriceChange.proposedBy}: ${plan.pendingPriceChange.reason}`}
          >
            {money(plan.pendingPriceChange.toPriceMinor, plan.pendingPriceChange.currency)} awaiting
            publication
          </Badge>
        ) : null}
        {plan ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Price history for ${key}`}
            onClick={() => void openHistory(plan.id)}
          >
            Price history
          </Button>
        ) : null}
        {canManage && plan?.status === 'ACTIVE' ? (
          plan.pendingPriceChange ? (
            <>
              <Button
                variant="primary"
                size="sm"
                aria-label={`Publish the proposed price for ${key}`}
                onClick={() => {
                  const change = plan.pendingPriceChange;
                  if (change) void openPublish(plan.id, change.id);
                }}
              >
                Review and publish
              </Button>

              <Button
                variant="ghost"
                size="sm"
                aria-label={`Discard the proposed price for ${key}`}
                onClick={() => setDiscarding(key)}
              >
                Discard
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Change the price of ${key}`}
              onClick={() => {
                setNewPrice('');
                setConfirmPrice('');
                setPricing(key);
              }}
            >
              Change price
            </Button>
          )
        ) : null}
        {canManage && plan?.status !== 'RETIRED' ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Change Paystack code for ${key}`}
            onClick={() => {
              setNewCode('');
              setEditing(key);
            }}
          >
            Change code
          </Button>
        ) : null}
        {canManage && plan?.status === 'DRAFT' ? <>
          <Badge tone="warning">Draft plan</Badge>
          <Button variant="ghost" size="sm" onClick={() => setEntitlementAction(plan)}>Set entitlement</Button>
          <Button variant="secondary" size="sm" onClick={() => setActivatingPlan(plan)}>Activate plan</Button>
        </> : null}
        {plan?.status === 'ACTIVE' ? <Link href={`/platform/billing/plans/${plan.id}/entitlements`}>Entitlement versions</Link> : null}
      </div>
    );
  };
  const editingPlan = editing ? byKey.get(editing) : undefined;
  const codeValid = PLAN_CODE.test(newCode.trim());
  const pricingPlan = pricing ? byKey.get(pricing) : undefined;
  const discardingPlan = discarding ? byKey.get(discarding) : undefined;
  const priceMinor = toMinor(newPrice);
  const yearlySavings = (tier: string) => {
    const monthly = rows.find((row) => row.tierKey === tier && row.billingInterval === 'MONTHLY' && row.status === 'ACTIVE');
    const yearly = rows.find((row) => row.tierKey === tier && row.billingInterval === 'YEARLY' && row.status === 'ACTIVE');
    if (!monthly || !yearly || monthly.currency !== yearly.currency) return null;
    const fullYear = BigInt(monthly.priceMinor) * 12n;
    if (fullYear <= 0n || BigInt(yearly.priceMinor) >= fullYear) return null;
    return Number(((fullYear - BigInt(yearly.priceMinor)) * 100n + fullYear / 2n) / fullYear);
  };
  // Mirrors the server's threshold, so the confirmation field appears before the refusal does.
  const largeIncrease =
    !!pricingPlan &&
    !!priceMinor &&
    BigInt(priceMinor) - BigInt(pricingPlan.priceMinor) >
      (BigInt(pricingPlan.priceMinor) * 50n) / 100n;

  return (
    <PlatformPage
      title="Plans & pricing"
      description="Current catalog prices and entitlements read from the platform. Price changes require review and publication."
      meta={
        coverage.status === 'ready' && coverage.data ? (
          <>Paystack {coverage.data.environment} environment</>
        ) : undefined
      }
    >
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}
      <Panel title="Catalog health">
        {health.status === 'error' ? <ErrorState title="Catalog health could not be loaded" action={retry} /> :
          <DataTable caption="Catalog health" loading={health.status === 'loading'}
            rows={health.status === 'ready' ? health.data.map((row, index) => ({ ...row, id: `${row.code}-${index}` })) : []}
            emptyTitle="No violations" emptyDescription="The active catalog has no reported violations."
            emptyState={{ variant: 'inline' }}
            columns={[
              { key: 'category', header: 'Category', cell: (row) => <Badge tone={row.category === 'INVARIANT' ? 'danger' : 'warning'}>{row.category === 'INVARIANT' ? 'Invariant' : 'Launch entitlement drift'}</Badge> },
              { key: 'subject', header: 'Plan or tier', cell: (row) => row.subject },
              { key: 'detail', header: 'Violation', cell: (row) => row.detail },
            ]} />}
      </Panel>
      <Panel title="Catalog">
        {canManage ? <Button variant="secondary" size="sm" onClick={() => { setTierKey(''); setTierName(''); setTierTagline(''); setTierHighlights(''); setTierMostPopular(false); setTierSortOrder(String(Math.min(1000, Math.max(0, ...tierRows.map((row) => row.sortOrder)) + 10))); setTierAction({ kind: 'create' }); }}>Create tier</Button> : null}
        <DataTable
          caption="Plan catalog"
          loading={plans.status === 'loading'}
          rows={tierRows.map((tier) => ({ ...tier, tier: tier.key }))}
          columns={[
            {
              key: 'plan',
              header: 'Plan',
              cell: ({ tier }) => (
                <span className="rb-plan-catalog__name">
                  {tierRows.find((row) => row.key === tier)?.name ?? tier}
                  {tierRows.find((row) => row.key === tier)?.status === 'DRAFT' ? <Badge tone="warning">Draft</Badge> : null}
                  {tierRows.find((row) => row.key === tier)?.isMostPopular ? (
                    <Badge tone="info">Most popular</Badge>
                  ) : null}
                  {canManage ? <>
                    {tierRows.find((row) => row.key === tier)?.status === 'DRAFT' ?
                      (['MONTHLY', 'YEARLY'] as const).map((interval) => rows.some((plan) => plan.tierKey === tier && plan.billingInterval === interval && plan.status !== 'RETIRED') ? null :
                        <Button key={interval} variant="ghost" size="sm" onClick={() => { const selected = tierRows.find((row) => row.key === tier); if (selected) { setDraftPrice(''); setPlanAction({ tier: selected, interval }); } }}>Add {interval.toLowerCase()} plan</Button>) : null}
                    {tierRows.find((row) => row.key === tier)?.status === 'DRAFT' ?
                      <Button variant="ghost" size="sm" onClick={() => setTierAction({ kind: 'activate', tier: tierRows.find((row) => row.key === tier) })}>Activate</Button> : null}
                    <Button variant="ghost" size="sm" onClick={() => setTierAction({ kind: 'retire', tier: tierRows.find((row) => row.key === tier) })}>Retire</Button>
                  </> : null}
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
                  {yearlySavings(tier) !== null ? (
                    <span className="rb-table-secondary">
                      Saves {yearlySavings(tier)}% versus monthly
                    </span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'subscribers',
              header: 'Subscribed organizations',
              align: 'right',
              cell: ({ tier }) => {
                const monthly = rows.find((row) => row.tierKey === tier && row.billingInterval === 'MONTHLY')?.subscriberCount ?? 0;
                const yearly = rows.find((row) => row.tierKey === tier && row.billingInterval === 'YEARLY')?.subscriberCount ?? 0;
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
          Each interval has its own price. Subscriber counts
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
            ...tierRows.map((tierRow) => ({
              key: tierRow.key,
              header: tierRow.name,
              cell: ({ key }: { key: string }) => {
                const tier = tierRow.key;
                const feature = (OFFICIAL_FEATURE_KEYS as readonly string[]).includes(key);
                const monthly = enforced(rows.find((row) => row.tierKey === tier && row.billingInterval === 'MONTHLY' && row.status === 'ACTIVE'), key);
                const yearly = enforced(rows.find((row) => row.tierKey === tier && row.billingInterval === 'YEARLY' && row.status === 'ACTIVE'), key);
                const target = OFFICIAL_KEYS.has(`${tier}_monthly`) ? approved(tier as OfficialPlanTier, key) : undefined;
                const drift = target !== undefined && !same(monthly, target);
                const split = !same(monthly, yearly);
                return (
                  <span className={drift || split ? 'rb-plan-catalog__drift' : undefined}>
                    {describe(monthly, feature)}
                    {drift && target !== undefined ? (
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
          emptyDescription="No retired or orphaned plan rows."
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
      {tierAction ? <AdminActionDialog
        open
        onOpenChange={(open) => { if (!open) setTierAction(null); }}
        title={tierAction.kind === 'create' ? 'Create tier' : tierAction.kind === 'activate' ? 'Activate tier' : 'Retire tier'}
        confirmLabel={tierAction.kind === 'create' ? 'Create draft tier' : tierAction.kind === 'activate' ? 'Activate tier' : 'Retire tier'}
        tone={tierAction.kind === 'retire' ? 'danger' : 'primary'}
        confirmationPhrase={tierAction.kind === 'retire' ? tierAction.tier?.key : undefined}
        confirmDisabled={tierAction.kind === 'create' && (!/^[a-z][a-z0-9_.-]*$/.test(tierKey) || !tierName.trim() || !/^\d+$/.test(tierSortOrder) || Number(tierSortOrder) > 1000)}
        impact={tierAction.kind === 'create'
          ? <p>The tier starts as a draft. Add and configure its monthly and yearly plans before activation.</p>
          : tierAction.kind === 'activate'
            ? <p>Customers can see and buy {tierAction.tier?.name} once both Paystack plans and all entitlements are ready.</p>
            : <p>Retiring {tierAction.tier?.name} removes its plans from sale. Active subscribers must be moved first; their entitlements are never changed by retirement.</p>}
        fields={tierAction.kind === 'create' ? <>
          <FormField><Label htmlFor="tier-key">Tier key</Label><Input id="tier-key" value={tierKey} onChange={(event) => setTierKey(event.target.value)} /></FormField>
          <FormField><Label htmlFor="tier-name">Name</Label><Input id="tier-name" value={tierName} onChange={(event) => setTierName(event.target.value)} /></FormField>
          <FormField><Label htmlFor="tier-sort-order">Commercial order</Label><Input id="tier-sort-order" type="number" min="0" max="1000" value={tierSortOrder} onChange={(event) => setTierSortOrder(event.target.value)} /></FormField>
          <FormField><Label htmlFor="tier-popular">Most popular</Label><Input id="tier-popular" type="checkbox" checked={tierMostPopular} onChange={(event) => setTierMostPopular(event.target.checked)} /></FormField>
          <FormField><Label htmlFor="tier-tagline">Public tagline</Label><Input id="tier-tagline" value={tierTagline} onChange={(event) => setTierTagline(event.target.value)} /></FormField>
          <FormField><Label htmlFor="tier-highlights">Public highlights, one per line</Label><Textarea id="tier-highlights" value={tierHighlights} onChange={(event) => setTierHighlights(event.target.value)} /></FormField>
        </> : undefined}
        onConfirm={async (reason) => {
          if (tierAction.kind === 'create') await apiRequest('/platform/plan-tiers', { method: 'POST', body: JSON.stringify({ key: tierKey.trim(), name: tierName.trim(), sortOrder: Number(tierSortOrder), isMostPopular: tierMostPopular, tagline: tierTagline.trim() || undefined, highlights: tierHighlights.split('\n').map((row) => row.trim()).filter(Boolean), reason }) });
          else await apiRequest(`/platform/plan-tiers/${tierAction.tier?.key}/${tierAction.kind}`, { method: 'POST', body: JSON.stringify({ reason }) });
          setNotice(`Tier ${tierAction.kind === 'create' ? 'created as a draft' : tierAction.kind === 'activate' ? 'activated' : 'retired'}.`);
          load();
        }}
      /> : null}
      {planAction ? <AdminActionDialog open
        onOpenChange={(open) => { if (!open) setPlanAction(null); }}
        title={`Add ${planAction.interval.toLowerCase()} plan`}
        confirmLabel="Create draft plan"
        confirmDisabled={!toMinor(draftPrice)}
        impact={<p>This creates a draft plan for {planAction.tier.name}. Configure every entitlement and verify its Paystack code before activation.</p>}
        fields={<FormField><Label htmlFor="draft-plan-price">Price in USD</Label>
          <Input id="draft-plan-price" value={draftPrice} onChange={(event) => setDraftPrice(event.target.value)} />
        </FormField>}
        onConfirm={async () => {
          await apiRequest('/platform/plans', { method: 'POST', body: JSON.stringify({
            key: `${planAction.tier.key}_${planAction.interval.toLowerCase()}`, tierKey: planAction.tier.key,
            name: planAction.tier.name, billingInterval: planAction.interval, billingProvider: 'PAYSTACK',
            priceMinor: toMinor(draftPrice), sortOrder: planAction.tier.sortOrder,
          }) });
          setNotice(`${planAction.interval.toLowerCase()} plan created as a draft.`); load();
        }} /> : null}
      {entitlementAction ? <AdminActionDialog open
        onOpenChange={(open) => { if (!open) setEntitlementAction(null); }}
        title={`Set entitlement for ${entitlementAction.key}`}
        confirmLabel="Save entitlement"
        confirmDisabled={entitlementEnabled && entitlementLimit !== '' && !/^\d+$/.test(entitlementLimit)}
        impact={<p>This changes a draft plan before anyone can buy it. Each required entitlement must be set before activation.</p>}
        fields={<>
          <FormField><Label htmlFor="draft-entitlement-key">Entitlement</Label>
            <Select id="draft-entitlement-key" value={entitlementKey} onChange={(event) => {
              const key = event.target.value; const current = entitlementAction.entitlements.find((row) => row.key === key);
              setEntitlementKey(key); setEntitlementEnabled(current?.enabled ?? true); setEntitlementLimit(current?.limitValue?.toString() ?? '');
            }}>{[...OFFICIAL_ENTITLEMENT_KEYS, ...OFFICIAL_FEATURE_KEYS].map((key) =>
              <option key={key} value={key}>{key}</option>)}</Select>
          </FormField>
          <FormField><Label htmlFor="draft-entitlement-enabled">Included</Label>
            <Input id="draft-entitlement-enabled" type="checkbox" checked={entitlementEnabled} onChange={(event) => setEntitlementEnabled(event.target.checked)} />
          </FormField>
          <FormField><Label htmlFor="draft-entitlement-limit">Limit (blank means unlimited)</Label>
            <Input id="draft-entitlement-limit" value={entitlementLimit} onChange={(event) => setEntitlementLimit(event.target.value)} />
          </FormField>
        </>}
        onConfirm={async () => {
          await apiRequest(`/platform/plans/${entitlementAction.id}/entitlements`, { method: 'POST',
            body: JSON.stringify({ key: entitlementKey, enabled: entitlementEnabled,
              limitValue: entitlementEnabled && entitlementLimit !== '' ? Number(entitlementLimit) : null }) });
          setNotice(`Entitlement ${entitlementKey} saved.`); load();
        }} /> : null}
      {activatingPlan ? <AdminActionDialog open
        onOpenChange={(open) => { if (!open) setActivatingPlan(null); }}
        title={`Activate ${activatingPlan.key}`} confirmLabel="Activate plan"
        impact={<p>The plan needs a verified Paystack code, a positive price, and every required entitlement. The tier remains a draft until both intervals are active.</p>}
        onConfirm={async () => {
          await apiRequest(`/platform/plans/${activatingPlan.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });
          setNotice(`${activatingPlan.key} activated.`); load();
        }} /> : null}
      {editingPlan ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setEditing(null))}
          title="Change Paystack plan code"
          description={`${editingPlan.name} · ${editingPlan.key}`}
          confirmLabel="Verify and save code"
          confirmDisabled={!codeValid}
          impact={
            <>
              <p>
                New checkouts for <strong>{editingPlan.key}</strong> will charge through this
                Paystack plan. Current code: <code>{editingPlan.providerPriceId ?? 'none'}</code>.
              </p>
              <p>
                ValueBooks first asks Paystack for the plan and compares its amount, currency and
                interval with {money(editingPlan.priceMinor, editingPlan.currency)} /{' '}
                {editingPlan.billingInterval.toLowerCase()}. If anything differs, nothing is saved.
              </p>
              <p>
                The {editingPlan.subscriberCount.toLocaleString()} organization
                {editingPlan.subscriberCount === 1 ? '' : 's'} already on this plan keep their
                existing Paystack subscriptions; renewals are not re-pointed.
              </p>
            </>
          }
          fields={
            <FormField>
              <Label htmlFor="plan-code">New Paystack plan code</Label>
              <Input
                id="plan-code"
                value={newCode}
                autoComplete="off"
                placeholder="PLN_…"
                onChange={(event) => setNewCode(event.target.value)}
              />
              <FieldMessage>
                {newCode && !codeValid
                  ? 'A Paystack plan code looks like PLN_ followed by letters and digits.'
                  : 'Copy it from the plan in the Paystack dashboard for this environment.'}
              </FieldMessage>
            </FormField>
          }
          onConfirm={async (reason) => {
            await apiRequest(`/platform/plans/${editingPlan.id}/provider-code`, {
              method: 'PUT',
              body: JSON.stringify({ providerPlanCode: newCode.trim(), reason }),
            });
            setNotice(`Paystack code for ${editingPlan.key} verified and saved.`);
            load();
          }}
        />
      ) : null}

      {pricingPlan ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setPricing(null))}
          title="Propose a new price"
          description={`${pricingPlan.name} · ${pricingPlan.key}`}
          confirmLabel="Propose price"
          confirmDisabled={!priceMinor || (largeIncrease && toMinor(confirmPrice) !== priceMinor)}
          impact={
            <>
              <p>
                Nothing is charged and nothing changes yet. This records the price so its effect can
                be read back before anyone commits to it. Current price:{' '}
                <strong>{money(pricingPlan.priceMinor, pricingPlan.currency)}</strong>.
              </p>
              <p>
                When published, Paystack is updated first and the{' '}
                {pricingPlan.subscriberCount.toLocaleString()} organization
                {pricingPlan.subscriberCount === 1 ? '' : 's'} on this plan are charged the new price
                at their next renewal, on the card authorisation they already gave. Trials are not
                charged now and convert at the new price.
              </p>
              {largeIncrease ? (
                <p className="rb-platform__alert">
                  This raises the price by more than half. Repeat the new price below to confirm it.
                </p>
              ) : null}
            </>
          }
          fields={
            <>
              <FormField>
                <Label htmlFor="plan-price">New price in {pricingPlan.currency}</Label>
                <Input
                  id="plan-price"
                  value={newPrice}
                  autoComplete="off"
                  inputMode="decimal"
                  placeholder={(Number(pricingPlan.priceMinor) / 100).toFixed(2)}
                  onChange={(event) => setNewPrice(event.target.value)}
                />
                <FieldMessage>
                  {newPrice && !priceMinor
                    ? 'Enter an amount greater than zero, with at most two decimal places.'
                    : priceMinor
                      ? `Charged as ${money(priceMinor, pricingPlan.currency)} per ${pricingPlan.billingInterval.toLowerCase()} period.`
                      : 'Type the amount a customer pays, not cents.'}
                </FieldMessage>
              </FormField>
              {largeIncrease ? (
                <FormField>
                  <Label htmlFor="plan-price-confirm">Repeat the new price</Label>
                  <Input
                    id="plan-price-confirm"
                    value={confirmPrice}
                    autoComplete="off"
                    inputMode="decimal"
                    onChange={(event) => setConfirmPrice(event.target.value)}
                  />
                  <FieldMessage>
                    {confirmPrice && toMinor(confirmPrice) !== priceMinor
                      ? 'This does not match the new price.'
                      : 'A misplaced decimal point would reach every subscriber.'}
                  </FieldMessage>
                </FormField>
              ) : null}
            </>
          }
          onConfirm={async (reason) => {
            await apiRequest(`/platform/plans/${pricingPlan.id}/price-changes`, {
              method: 'POST',
              body: JSON.stringify({
                priceMinor,
                ...(largeIncrease ? { confirmPriceMinor: priceMinor } : {}),
                reason,
              }),
            });
            setNotice(
              `A new price for ${pricingPlan.key} is awaiting publication. Nothing has changed for customers yet.`,
            );
            setPricing(null);
            load();
          }}
        />
      ) : null}

      {publishing ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setPublishing(null))}
          title="Publish this price"
          description={publishing.preview.planKey}
          confirmLabel="Publish price"
          tone={publishing.preview.direction === 'INCREASE' ? 'danger' : 'primary'}
          confirmDisabled={
            publishing.preview.stale || publishing.preview.direction === 'INCREASE' ||
            publishing.preview.notice?.publishable === false
          }
          confirmationPhrase={publishing.preview.planKey}
          impact={
            <>
              <p>
                {money(publishing.preview.fromPriceMinor, publishing.preview.currency)} &rarr;{' '}
                <strong>
                  {money(publishing.preview.toPriceMinor, publishing.preview.currency)}
                </strong>
                , a {publishing.preview.direction === 'INCREASE' ? 'rise' : 'reduction'}. Proposed
                because: {publishing.preview.reason}
              </p>
              {publishing.preview.direction === 'DECREASE' ? (
                <p>
                  Paystack is updated first. <strong>{publishing.preview.subscribersToReprice}</strong>{' '}
                  subscription{publishing.preview.subscribersToReprice === 1 ? '' : 's'} will be
                  charged the new price at their next renewal;{' '}
                  {publishing.preview.trialingUnaffected} trial
                  {publishing.preview.trialingUnaffected === 1 ? '' : 's'} are not charged now and will
                  convert at it. New checkouts use it immediately.
                </p>
              ) : null}
              {publishing.preview.direction === 'INCREASE' ? (
                <p className="rb-platform__alert">
                  Price increases are temporarily paused while checkout and Paystack publication
                  are made race-safe. The proposal and any sent notices remain recorded, but this
                  increase cannot be published yet.
                </p>
              ) : null}
              {publishing.preview.stale ? (
                <p className="rb-platform__alert">
                  This plan&rsquo;s price changed after this was proposed, so it cannot be
                  published. Discard it and propose the change again.
                </p>
              ) : null}
            </>
          }
          onConfirm={async () => {
            const response = await apiRequest<{
              data: {
                priceMinor: string;
                subscribersReportedByPaystack: number | null;
                providerVerified: boolean;
              };
            }>(
              `/platform/plans/${publishing.planId}/price-changes/${publishing.preview.id}/publish`,
              { method: 'POST', body: JSON.stringify({}) },
            );
            const reported = response.data.subscribersReportedByPaystack;
            setNotice(
              `${publishing.preview.planKey} now costs ${money(response.data.priceMinor, publishing.preview.currency)}. ` +
                (reported === null
                  ? 'Paystack did not report how many subscriptions it repriced.'
                  : `Paystack repriced ${reported} subscription${reported === 1 ? '' : 's'}.`) +
                (response.data.providerVerified
                  ? ''
                  : ' The Paystack plan could not be read back for verification; check it in the Paystack dashboard.'),
            );
            setPublishing(null);
            load();
          }}
        />
      ) : null}

      {discardingPlan?.pendingPriceChange ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setDiscarding(null))}
          title="Discard the proposed price"
          description={`${discardingPlan.name} · ${discardingPlan.key}`}
          confirmLabel="Discard proposal"
          tone="danger"
          impact={
            <p>
              Abandons the proposed{' '}
              {money(
                discardingPlan.pendingPriceChange.toPriceMinor,
                discardingPlan.pendingPriceChange.currency,
              )}
              . The plan keeps its current price of{' '}
              {money(discardingPlan.priceMinor, discardingPlan.currency)}, nothing reaches Paystack,
              and the proposal stays on the record with your reason.
            </p>
          }
          onConfirm={async (reason) => {
            const change = discardingPlan.pendingPriceChange;
            if (!change) return;
            await apiRequest(
              `/platform/plans/${discardingPlan.id}/price-changes/${change.id}/discard`,
              { method: 'POST', body: JSON.stringify({ reason }) },
            );
            setNotice(`The proposed price for ${discardingPlan.key} was discarded.`);
            setDiscarding(null);
            load();
          }}
        />
      ) : null}

      {history ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setHistory(null))}>
          <DrawerContent
            side="right"
            size="wide"
            title={`${history.plan.name} price history`}
            description={`${history.plan.key} · now ${money(history.plan.priceMinor, history.plan.currency)}`}
          >
            <div className="rb-explain-panel rb-explain-panel--surface">
              <h2>Every price this plan has carried</h2>
              <p className="rb-platform__muted">
                Newest first. This is what keeps an old charge explainable: once Paystack holds a new
                amount, the provider no longer knows what a subscriber used to pay.
              </p>
              {history.history.map((row) => (
                <dl key={`${row.effectiveFrom}-${row.priceMinor}`}>
                  <Row label="Price" value={money(row.priceMinor, row.currency)} />
                  <Row label="From" value={new Date(row.effectiveFrom).toLocaleString()} />
                  <Row label="Published by" value={row.publishedBy ?? 'Before console pricing'} />
                  <Row label="Reason" value={row.reason ?? '—'} />
                </dl>
              ))}
            </div>
          </DrawerContent>
        </Dialog>
      ) : null}
    </PlatformPage>
  );
}
