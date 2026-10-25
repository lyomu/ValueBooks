'use client';

import { OFFICIAL_ENTITLEMENT_LABELS, OFFICIAL_PLAN_TIERS, type PlatformPlan } from '@valuebooks/contracts';
import { Badge, Button, DataTable, DataTablePagination, DropdownItem, ErrorState, FormField, Input, Label, RowActionMenu, StatusBadge, Textarea } from '@valuebooks/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import { formatMinor } from '../lib/money';
import { platformRoleAtLeast, usePlatformSession } from '../lib/platform';
import { AdminActionDialog } from './admin-action-dialog';
import { Panel } from './platform-organization-detail';
import { PlatformBillingSections } from './platform-billing-sections';
import { PlatformPage } from './platform-shell';

type PriceRow = { id: string; key: string; billingInterval: string; status: string; priceMinor: string;
  currency: string; providerPriceId: string | null; entitlements: Array<{ key: string; enabled: boolean; limitValue: number | null }> };
type Tier = { id: string; key: string; name: string; description: string | null; tagline: string | null; highlights: string[];
  isMostPopular: boolean; sortOrder: number; status: 'DRAFT' | 'ACTIVE' | 'RETIRED'; createdAt: string; updatedAt: string; plans: PriceRow[] };
type Detail = { tier: Tier; subscriberCount: number; activityCount: number; subscriptions: Array<{ id: string; planId: string; status: string; complimentary: boolean;
  startedAt: string; trialEndsAt: string | null; currentPeriodEnd: string | null; organization: { legalName: string } }>;
  prices: Array<{ id: string; planId: string; priceMinor: string; currency: string; effectiveFrom: string }>;
  entitlementVersions: Array<{ id: string; planId: string; version: number; status: string; publishedAt: string | null }>;
  provisions: Array<{ planId: string; status: string; providerCode: string | null; updatedAt: string }>;
  audits: Array<{ id: string; eventKey: string; reason: string | null; occurredAt: string;
    actor: { displayName: string; email: string } }> };
type Preview = { id: string; planKey: string; fromPriceMinor: string; toPriceMinor: string; currency: string;
  direction: 'INCREASE' | 'DECREASE'; subscribersToReprice: number; stale: boolean;
  notice: { publishable: boolean } | null };
type Action = { kind: 'edit' | 'activate' | 'retire' | 'add-price' | 'price' | 'code' | 'provider-create' | 'publish' | 'discard' | 'activate-price';
  plan?: PlatformPlan; preview?: Preview };
const date = (value: string | null) => value ? new Date(value).toLocaleDateString() : '—';
const toMinor = (value: string) => {
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const amount = BigInt(whole ?? '0') * 100n + BigInt(fraction.padEnd(2, '0'));
  return amount > 0n ? amount.toString() : null;
};

export function PlatformPlanDetail({ tierId }: { tierId: string }) {
  const { session } = usePlatformSession();
  const canManage = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagline, setTagline] = useState('');
  const [highlights, setHighlights] = useState('');
  const [popular, setPopular] = useState(false);
  const [newPrice, setNewPrice] = useState('');
  const [newInterval, setNewInterval] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [confirmPrice, setConfirmPrice] = useState('');
  const [newCode, setNewCode] = useState('');
  const [subscriberPage, setSubscriberPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const load = useCallback(async () => {
    setError(false);
    try {
      const [record, catalog] = await Promise.all([
        apiRequest<{ data: Detail }>(`/platform/plan-tiers/${tierId}?subscriberPage=${subscriberPage}&activityPage=${activityPage}`),
        apiRequest<{ data: PlatformPlan[] }>('/platform/plans'),
      ]);
      setDetail(record.data);
      setPlans(catalog.data.filter((plan) => plan.tierKey === record.data.tier.key));
    } catch { setError(true); }
  }, [tierId, subscriberPage, activityPage]);
  useEffect(() => { void load(); }, [load]);
  const tier = detail?.tier;
  const openEdit = () => {
    if (!tier) return;
    setName(tier.name); setDescription(tier.description ?? ''); setTagline(tier.tagline ?? '');
    setHighlights(tier.highlights.join('\n')); setPopular(tier.isMostPopular); setAction({ kind: 'edit' });
  };
  const openPreview = async (plan: PlatformPlan) => {
    if (!plan.pendingPriceChange) return;
    try {
      const result = await apiRequest<{ data: Preview }>(`/platform/plans/${plan.id}/price-changes/${plan.pendingPriceChange.id}/preview`);
      setAction({ kind: 'publish', plan, preview: result.data });
    } catch { setNotice('The price preview could not be loaded. Try again.'); }
  };
  if (error) return <PlatformPage title="Plan management"><ErrorState title="This plan could not be loaded"
    description="The plan or its history is unavailable." action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} /></PlatformPage>;
  const activePlans = plans.filter((plan) => plan.status !== 'RETIRED');
  const monthlyPlan = activePlans.find((plan) => plan.billingInterval === 'MONTHLY');
  const yearlyPlan = activePlans.find((plan) => plan.billingInterval === 'YEARLY');
  const annualSavings = monthlyPlan && yearlyPlan && monthlyPlan.currency === yearlyPlan.currency && BigInt(monthlyPlan.priceMinor) > 0n
    ? Number((BigInt(monthlyPlan.priceMinor) * 12n - BigInt(yearlyPlan.priceMinor)) * 10_000n / (BigInt(monthlyPlan.priceMinor) * 12n)) / 100
    : null;
  const proposedMinor = toMinor(newPrice);
  const largeIncrease = action?.kind === 'price' && action.plan && proposedMinor &&
    BigInt(proposedMinor) - BigInt(action.plan.priceMinor) > BigInt(action.plan.priceMinor) / 2n;
  return <PlatformPage title={tier?.name ?? 'Plan management'} description={tier?.description ?? 'Pricing, entitlements, subscribers, and activity.'}
    actions={canManage && tier ? <Button onClick={openEdit}>Edit plan</Button> : undefined}>
    <PlatformBillingSections />
    <Link href="/platform/billing/plans">Back to Subscription Plans</Link>
    {notice ? <p className="rb-platform__notice" role="status">{notice}</p> : null}
    <Panel title="Plan overview">
      {tier ? <dl className="rb-platform-plan-detail__facts">
        <div><dt>Status</dt><dd><StatusBadge status={tier.status} /></dd></div>
        <div><dt>Subscribers</dt><dd className="rb-num">{detail?.subscriberCount.toLocaleString()}</dd></div>
        <div><dt>Availability</dt><dd>{tier.status === 'ACTIVE' ? 'Published' : 'Not available for new checkout'}</dd></div>
        <div><dt>Designation</dt><dd>{tier.isMostPopular ? <Badge tone="info">Most popular</Badge> : 'Standard'}</dd></div>
        <div><dt>Created</dt><dd>{date(tier.createdAt)}</dd></div>
        <div><dt>Modified</dt><dd>{date(tier.updatedAt)}</dd></div>
      </dl> : 'Loading plan…'}
      {tier?.tagline ? <p className="rb-platform__muted">{tier.tagline}</p> : null}
      {canManage && tier?.status === 'DRAFT' ? <Button variant="secondary" onClick={() => setAction({ kind: 'activate' })}>Publish plan</Button> : null}
      {canManage && tier?.status !== 'RETIRED' ? <Button variant="ghost" onClick={() => setAction({ kind: 'retire' })}>Retire plan</Button> : null}
    </Panel>
    <Panel title="Pricing management">
      {canManage && tier?.status === 'DRAFT' ? (['MONTHLY', 'YEARLY'] as const)
        .filter((interval) => !tier.plans.some((plan) => plan.billingInterval === interval && plan.status !== 'RETIRED'))
        .map((interval) => <Button key={interval} variant="secondary" size="sm" onClick={() => {
          setNewInterval(interval); setNewPrice(''); setAction({ kind: 'add-price' });
        }}>Add {interval.toLowerCase()} price</Button>) : null}
      <DataTable caption="Plan prices" rows={activePlans} loading={!detail} emptyTitle="No price rows"
        columns={[
          { key: 'interval', header: 'Interval', cell: (plan) => plan.billingInterval },
          { key: 'price', header: 'Price', align: 'right', cell: (plan) => formatMinor(plan.priceMinor, plan.currency) },
          { key: 'provider', header: 'Paystack', cell: (plan) => {
            const pending = detail?.provisions.find((item) => item.planId === plan.id);
            return <Badge tone={plan.providerPriceId ? 'success' : pending?.status === 'CREATED' ? 'warning' : pending ? 'danger' : 'warning'}>{plan.providerPriceId ? 'Code linked' : pending?.status === 'CREATED' ? 'Link pending' : pending ? 'Reconciliation needed' : 'Setup needed'}</Badge>;
          } },
          { key: 'subscribers', header: 'Subscribers', align: 'right', cell: (plan) => plan.subscriberCount.toLocaleString() },
          { key: 'actions', header: 'Actions', align: 'right', cell: (plan) => <RowActionMenu label={`Manage ${plan.billingInterval.toLowerCase()} price`}>
            {canManage && plan.status === 'ACTIVE' && !plan.pendingPriceChange ? <DropdownItem onSelect={() => { setNewPrice(''); setConfirmPrice(''); setAction({ kind: 'price', plan }); }}>Propose price change</DropdownItem> : null}
            {canManage && plan.pendingPriceChange ? <DropdownItem onSelect={() => void openPreview(plan)}>Review price proposal</DropdownItem> : null}
            {canManage && plan.pendingPriceChange ? <DropdownItem onSelect={() => setAction({ kind: 'discard', plan })}>Discard proposal</DropdownItem> : null}
            {canManage ? <DropdownItem onSelect={() => { setNewCode(''); setAction({ kind: 'code', plan }); }}>Link Paystack plan</DropdownItem> : null}
            {canManage && !plan.providerPriceId && !detail?.provisions.some((item) => item.planId === plan.id) ? <DropdownItem onSelect={() => setAction({ kind: 'provider-create', plan })}>Create in Paystack</DropdownItem> : null}
            {canManage && detail?.provisions.some((item) => item.planId === plan.id && item.status === 'CREATED') ? <DropdownItem onSelect={() => setAction({ kind: 'provider-create', plan })}>Resume Paystack linking</DropdownItem> : null}
            {canManage && plan.status === 'DRAFT' ? <DropdownItem onSelect={() => setAction({ kind: 'activate-price', plan })}>Activate interval</DropdownItem> : null}
            <DropdownItem asChild><Link href={`/platform/billing/plans/${plan.id}/entitlements`}>Manage entitlements</Link></DropdownItem>
          </RowActionMenu> },
        ]} />
      {annualSavings !== null ? <p className="rb-platform__muted">Annual savings: {annualSavings.toLocaleString(undefined, { maximumFractionDigits: 2 })}% compared with twelve monthly payments.</p> : null}
      <p className="rb-platform__muted">Price changes are proposed and reviewed before publication. Paystack is updated first; existing subscribers are repriced at renewal. Increases are currently paused pending checkout coordination.</p>
      <DataTable caption="Price history" rows={detail?.prices ?? []} loading={!detail} emptyTitle="No price history"
        columns={[
          { key: 'interval', header: 'Interval', cell: (row) => tier?.plans.find((plan) => plan.id === row.planId)?.billingInterval ?? '—' },
          { key: 'price', header: 'Price', align: 'right', cell: (row) => formatMinor(row.priceMinor, row.currency) },
          { key: 'from', header: 'Effective from', cell: (row) => date(row.effectiveFrom) },
        ]} />
    </Panel>
    <Panel title="Features & entitlements">
      {activePlans.map((plan) => <div key={plan.id}>
        <h3>{plan.billingInterval === 'MONTHLY' ? 'Monthly' : 'Yearly'}</h3>
        <DataTable caption={`${plan.billingInterval.toLowerCase()} entitlements`}
          rows={plan.entitlements.map((value) => ({ ...value, id: value.key }))}
          columns={[
            { key: 'feature', header: 'Feature or limit', cell: (value) => OFFICIAL_ENTITLEMENT_LABELS[value.key as keyof typeof OFFICIAL_ENTITLEMENT_LABELS] ?? value.key },
            { key: 'allowance', header: 'Allowance', cell: (value) => !value.enabled ? 'Not included' : value.limitValue === null ? 'Unlimited' : value.limitValue.toLocaleString() },
          ]} />
        <Link href={`/platform/billing/plans/${plan.id}/entitlements`}>Manage {plan.billingInterval.toLowerCase()} entitlement versions</Link>
      </div>)}
      <DataTable caption="Entitlement version history" rows={detail?.entitlementVersions ?? []} loading={!detail
        } emptyTitle="No entitlement versions" columns={[
          { key: 'interval', header: 'Interval', cell: (row) => tier?.plans.find((plan) => plan.id === row.planId)?.billingInterval ?? '—' },
          { key: 'version', header: 'Version', cell: (row) => row.version },
          { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
          { key: 'date', header: 'Published', cell: (row) => date(row.publishedAt) },
        ]} />
    </Panel>
    <Panel title="Subscribers">
      <DataTable caption="Organizations on this plan" rows={detail?.subscriptions ?? []} loading={!detail}
        emptyTitle="No subscribers" emptyDescription="Paid subscriptions, trials, and complimentary grants appear here."
        columns={[
          { key: 'organization', header: 'Organization', cell: (row) => <Link href={`/platform/billing/subscriptions/${row.id}`}>{row.organization.legalName}</Link> },
          { key: 'interval', header: 'Interval', cell: (row) => tier?.plans.find((plan) => plan.id === row.planId)?.billingInterval ?? '—' },
          { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
          { key: 'terms', header: 'Terms', cell: (row) => row.complimentary ? 'Complimentary' : row.status === 'TRIALING' ? 'Trial' : 'Paid' },
          { key: 'started', header: 'Started', cell: (row) => date(row.startedAt) },
          { key: 'end', header: 'Paid through / trial end', cell: (row) => date(row.currentPeriodEnd ?? row.trialEndsAt) },
        ]} />
      {detail ? <DataTablePagination page={subscriberPage} pageSize={25} totalRows={detail.subscriberCount} onPageChange={setSubscriberPage} label="Plan subscribers" /> : null}
    </Panel>
    <Panel title="Activity history">
      <DataTable caption="Plan administration activity" rows={detail?.audits ?? []} loading={!detail}
        emptyTitle="No administrative activity recorded" columns={[
          { key: 'action', header: 'Action', cell: (row) => row.eventKey.replace(/[._]/g, ' ') },
          { key: 'actor', header: 'Administrator', cell: (row) => row.actor.displayName || row.actor.email },
          { key: 'reason', header: 'Reason', cell: (row) => row.reason ?? '—' },
          { key: 'date', header: 'When', cell: (row) => date(row.occurredAt) },
        ]} />
      {detail ? <DataTablePagination page={activityPage} pageSize={25} totalRows={detail.activityCount} onPageChange={setActivityPage} label="Plan activity" /> : null}
    </Panel>
    {tier && action ? <AdminActionDialog open onOpenChange={(open) => { if (!open) setAction(null); }}
      title={{ edit: 'Edit plan', activate: 'Publish plan', retire: 'Retire plan', 'add-price': `Add ${newInterval.toLowerCase()} price`, price: 'Propose price change', code: 'Link Paystack plan', 'provider-create': 'Create Paystack plan', publish: 'Publish price change', discard: 'Discard price proposal', 'activate-price': 'Activate interval' }[action.kind]}
      confirmLabel={{ edit: 'Save plan', activate: 'Publish plan', retire: 'Retire plan', 'add-price': 'Create draft interval', price: 'Propose price', code: 'Verify and link', 'provider-create': 'Create and link', publish: 'Publish price', discard: 'Discard proposal', 'activate-price': 'Activate interval' }[action.kind]}
      tone={action.kind === 'retire' || action.kind === 'discard' ? 'danger' : 'primary'}
      confirmationPhrase={action.kind === 'retire' ? tier.key : action.kind === 'publish' ? action.plan?.key : undefined}
      confirmDisabled={action.kind === 'edit' ? !name.trim() || highlights.split('\n').filter(Boolean).length > 6 :
        action.kind === 'add-price' || action.kind === 'price' ? !proposedMinor || Boolean(largeIncrease && toMinor(confirmPrice) !== proposedMinor) : action.kind === 'code' ? !/^PLN_[A-Za-z0-9]{4,60}$/.test(newCode.trim()) :
        action.kind === 'publish' ? action.preview?.stale || action.preview?.direction === 'INCREASE' || action.preview?.notice?.publishable === false : false}
      impact={<p>{action.kind === 'edit' ? 'Commercial copy and the Most Popular designation update on published pricing surfaces. Payment terms remain unchanged.' :
        action.kind === 'retire' ? 'Retirement removes this tier from new sales. The server refuses while nonterminal subscriptions remain.' :
        action.kind === 'activate' ? 'Both intervals must pass billing and entitlement checks before publication.' :
        action.kind === 'price' ? 'This records a proposal. Publication requires a separate impact review.' :
        action.kind === 'add-price' ? 'Creates a draft interval. Its Paystack plan and entitlements must be configured before activation.' :
        action.kind === 'code' ? 'Paystack amount, currency, and interval are checked before saving. Existing mandates are unchanged.' :
        action.kind === 'provider-create' ? 'Creates one Paystack plan at the shown amount and interval, verifies it, and links its code. An uncertain result is held for manual reconciliation; retrying will not create another plan.' :
        action.kind === 'publish' ? action.preview?.direction === 'INCREASE' ? 'Price increases are paused until checkout publication is safe.' : `${action.preview?.subscribersToReprice ?? 0} subscriptions will be repriced at renewal after Paystack verification.` :
        action.kind === 'discard' ? 'The current price stays active and the proposal remains in the audit history.' : 'The interval requires a verified provider code and complete entitlements.'}</p>}
      fields={action.kind === 'edit' ? <>
        <FormField><Label htmlFor="plan-name-edit">Name</Label><Input id="plan-name-edit" value={name} disabled={(OFFICIAL_PLAN_TIERS as readonly string[]).includes(tier.key)} onChange={(event) => setName(event.target.value)} /></FormField>
        <FormField><Label htmlFor="plan-description-edit">Description</Label><Textarea id="plan-description-edit" value={description} onChange={(event) => setDescription(event.target.value)} /></FormField>
        <FormField><Label htmlFor="plan-tagline-edit">Public tagline</Label><Input id="plan-tagline-edit" value={tagline} onChange={(event) => setTagline(event.target.value)} /></FormField>
        <FormField><Label htmlFor="plan-highlights-edit">Highlights, one per line</Label><Textarea id="plan-highlights-edit" value={highlights} onChange={(event) => setHighlights(event.target.value)} /></FormField>
        <FormField><Label htmlFor="plan-popular-edit">Most popular</Label><Input id="plan-popular-edit" type="checkbox" checked={popular} onChange={(event) => setPopular(event.target.checked)} /></FormField>
      </> : action.kind === 'price' || action.kind === 'add-price' ? <>
        <FormField><Label htmlFor="plan-new-price">New price in {action.plan?.currency}</Label><Input id="plan-new-price" inputMode="decimal" value={newPrice} onChange={(event) => setNewPrice(event.target.value)} /></FormField>
        {largeIncrease ? <FormField><Label htmlFor="plan-confirm-price">Repeat the new price</Label><Input id="plan-confirm-price" inputMode="decimal" value={confirmPrice} onChange={(event) => setConfirmPrice(event.target.value)} /></FormField> : null}
      </> :
        action.kind === 'code' ? <FormField><Label htmlFor="plan-provider-code">Paystack plan code</Label><Input id="plan-provider-code" value={newCode} onChange={(event) => setNewCode(event.target.value)} placeholder="PLN_…" /></FormField> : undefined}
      onConfirm={async (reason) => {
        if (action.kind === 'edit') await apiRequest(`/platform/plan-tiers/${tier.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim(), description: description.trim(), tagline: tagline.trim(), highlights: highlights.split('\n').map((item) => item.trim()).filter(Boolean), isMostPopular: popular, reason }) });
        else if (action.kind === 'activate' || action.kind === 'retire') await apiRequest(`/platform/plan-tiers/${tier.key}/${action.kind}`, { method: 'POST', body: JSON.stringify({ reason }) });
        else if (action.kind === 'add-price') await apiRequest('/platform/plans', { method: 'POST', body: JSON.stringify({ key: `${tier.key}_${newInterval.toLowerCase()}`, tierKey: tier.key, name: tier.name, billingInterval: newInterval, billingProvider: 'PAYSTACK', priceMinor: proposedMinor, sortOrder: tier.sortOrder }) });
        else if (action.plan && action.kind === 'price') await apiRequest(`/platform/plans/${action.plan.id}/price-changes`, { method: 'POST', body: JSON.stringify({ priceMinor: proposedMinor, ...(largeIncrease ? { confirmPriceMinor: proposedMinor } : {}), reason }) });
        else if (action.plan && action.kind === 'code') await apiRequest(`/platform/plans/${action.plan.id}/provider-code`, { method: 'PUT', body: JSON.stringify({ providerPlanCode: newCode.trim(), reason }) });
        else if (action.plan && action.kind === 'provider-create') await apiRequest(`/platform/plans/${action.plan.id}/provider-create`, { method: 'POST', body: JSON.stringify({ reason }) });
        else if (action.plan && action.kind === 'discard' && action.plan.pendingPriceChange) await apiRequest(`/platform/plans/${action.plan.id}/price-changes/${action.plan.pendingPriceChange.id}/discard`, { method: 'POST', body: JSON.stringify({ reason }) });
        else if (action.plan && action.kind === 'publish' && action.preview) await apiRequest(`/platform/plans/${action.plan.id}/price-changes/${action.preview.id}/publish`, { method: 'POST', body: JSON.stringify({}) });
        else if (action.plan && action.kind === 'activate-price') await apiRequest(`/platform/plans/${action.plan.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });
        setNotice('Plan change saved.'); await load();
      }} /> : null}
  </PlatformPage>;
}
