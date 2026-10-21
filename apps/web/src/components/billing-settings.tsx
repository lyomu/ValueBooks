'use client';

import { Button, DataTable, DataTableSearch, DataTableToolbar, Dialog, DialogContent, Input, Label, Skeleton } from '@valuebooks/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type BillingSummary = {
  billingProfile: BillingProfile | null;
  pendingChange: { id: string; status: string; effectiveAt: string | null; toPlan: { name: string; billingInterval: string } } | null;
  subscription: null | {
    status: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    billingProvider: string | null;
    plan: {
      tierKey: string;
      name: string;
      priceMinor: string;
      currency: string;
      billingInterval: string;
      entitlements: { key: string; limitValue: number | null }[];
    };
    intendedPlan: { name: string; billingInterval: string } | null;
  };
  transactions: {
    id: string;
    status: string;
    amountMinor: string;
    currency: string;
    paidAt: string | null;
    createdAt: string;
    receiptUrl: string | null;
    planNameSnapshot: string | null;
    billingIntervalSnapshot: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    billingProvider: string;
    providerTransactionId: string;
  }[];
  usage: { periodStart: string; periodEnd: string; resources: { key: string; used: number; limit: number | null }[] };
};
type BillingProfile = { contactName: string; contactEmail: string; countryCode: string; addressLine1: string | null; addressLine2: string | null; city: string | null; region: string | null; postalCode: string | null; taxId: string | null };
const emptyProfile = { contactName: '', contactEmail: '', countryCode: '', addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', taxId: '' };
type PublicPlan = { id: string; key: string; tierKey: string; name: string; description: string; priceMinor: string; currency: string; billingInterval: string; checkoutAvailable: boolean; entitlements: { key: string; limitValue: number | null }[] };

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—';
}

function formatMoney(amountMinor: string, currency: string) {
  const amount = BigInt(amountMinor);
  const whole = amount / 100n;
  const fraction = (amount < 0n ? -amount : amount) % 100n;
  return `${currency} ${new Intl.NumberFormat().format(whole)}.${fraction.toString().padStart(2, '0')}`;
}

const usageLabels: Record<string, string> = {
  'customers.active.max': 'Active customers', 'invoices.issued.max': 'Issued invoices',
  'seats.max': 'Team seats', 'vendors.max': 'Active vendors', 'products.max': 'Products and services',
  'bank_accounts.max': 'Bank and cash accounts', 'warehouses.enabled': 'Warehouses',
  'projects.enabled': 'Active projects', 'ai_insights.max': 'AI insights',
};

export function BillingSettings() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<BillingSummary['transactions']>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [interval, setInterval] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [paymentPending, setPaymentPending] = useState(false);
  const [scheduledMessage, setScheduledMessage] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [busyCancel, setBusyCancel] = useState(false);
  const [profile, setProfile] = useState(emptyProfile);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organization?.id || !hasPermission(organization, 'organization.view')) return;
    let cancelled = false;
    void Promise.all([
      apiRequest<{ data: BillingSummary }>(`/organizations/${organization.id}/billing`),
      apiRequest<{ data: PublicPlan[] }>('/billing/plans'),
    ])
      .then(([response, catalog]) => { if (!cancelled) { setSummary(response.data); setPlans(catalog.data); setProfile({ ...emptyProfile, ...Object.fromEntries(Object.entries(response.data.billingProfile ?? {}).map(([key, value]) => [key, value ?? ''])) }); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Billing details could not be loaded.'); });
    return () => { cancelled = true; };
  }, [organization]);

  useEffect(() => {
    setPaymentPending(new URLSearchParams(window.location.search).has('payment-return'));
  }, []);

  useEffect(() => {
    if (!organization?.id) return;
    let cancelled = false;
    setHistoryLoading(true);
    void apiRequest<{ data: BillingSummary['transactions']; pagination: { totalRows: number } }>(
      `/organizations/${organization.id}/billing/transactions?page=${historyPage}&pageSize=20${historyStatus ? `&status=${historyStatus}` : ''}`,
    ).then((response) => { if (!cancelled) { setHistory(response.data); setHistoryTotal(response.pagination.totalRows); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Payment history could not be loaded.'); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [organization?.id, historyPage, historyStatus]);

  async function openDocument(transactionId: string) {
    if (!organization) return;
    setError(null);
    try {
      const response = await apiRequest<{ data: { url: string } }>(`/organizations/${organization.id}/billing/transactions/${transactionId}/document`);
      window.open(response.data.url, '_blank', 'noopener,noreferrer');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Provider document is unavailable.'); }
  }

  async function openCheckout(plan: PublicPlan) {
    if (!organization) return;
    setBusyPlan(plan.key);
    setError(null);
    try {
      const response = await apiRequest<{ data: { checkoutUrl: string | null; status: string; effectiveAt?: string } }>(`/organizations/${organization.id}/billing/checkout`, {
        method: 'POST',
        body: JSON.stringify({
          planKey: plan.key,
          idempotencyKey: crypto.randomUUID(),
          successUrl: `${window.location.origin}/settings/billing?payment-return=1`,
          cancelUrl: `${window.location.origin}/settings/billing`,
        }),
      });
      if (response.data.checkoutUrl) window.location.assign(response.data.checkoutUrl);
      else if (response.data.status === 'SCHEDULED') {
        setScheduledMessage(`Downgrade scheduled for ${formatDate(response.data.effectiveAt ?? null)}. No replacement charge was made. Return here at the end of your paid term to authorize the new plan.`);
        setBusyPlan(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Secure checkout could not be opened.');
      setBusyPlan(null);
    }
  }

  async function managePaymentMethod() {
    if (!organization) return;
    setError(null);
    try {
      const response = await apiRequest<{ data: { url: string } }>(`/organizations/${organization.id}/billing/payment-method-link`, { method: 'POST' });
      window.location.assign(response.data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Payment method management is unavailable.');
    }
  }

  async function cancelSubscription() {
    if (!organization) return;
    setBusyCancel(true);
    setError(null);
    try {
      await apiRequest(`/organizations/${organization.id}/billing/cancel`, {
        method: 'POST', body: JSON.stringify({ reason: cancelReason.trim() || 'Customer requested cancellation' }),
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cancellation could not be scheduled.');
      setBusyCancel(false);
      setShowCancel(false);
    }
  }

  async function resumeSubscription() {
    if (!organization) return;
    setError(null);
    try {
      await apiRequest(`/organizations/${organization.id}/billing/resume`, { method: 'POST' });
      window.location.reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'This cancellation could not be resumed.'); }
  }

  async function saveProfile() {
    if (!organization) return;
    setSavingProfile(true); setError(null); setProfileSaved(false);
    try {
      await apiRequest(`/organizations/${organization.id}/billing/details`, { method: 'PUT', body: JSON.stringify(profile) });
      setProfileSaved(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Billing details could not be saved.'); }
    finally { setSavingProfile(false); }
  }

  if (workspace.loading) return <div className="rb-security-loading"><Skeleton /><Skeleton /></div>;
  if (workspace.error) return <div className="rb-auth-error" role="alert">{workspace.error}</div>;
  if (!hasPermission(organization, 'organization.view'))
    return <div className="rb-auth-error" role="alert">Your role cannot view organization billing.</div>;
  if (error && !summary) return <div className="rb-auth-error" role="alert">{error}</div>;
  if (!summary) return <div className="rb-security-loading" aria-label="Loading billing details"><Skeleton /><Skeleton /></div>;

  const subscription = summary.subscription;
  const visibleTransactions = history.filter((transaction) =>
    `${transaction.id} ${transaction.status} ${transaction.currency}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="rb-security-stack">
      {error ? <div className="rb-auth-error" role="alert">{error}</div> : null}
      {paymentPending ? <div className="rb-auth-notice" role="status">We&apos;re confirming your payment. Your subscription will update once confirmation is received.</div> : null}
      {scheduledMessage ? <div className="rb-auth-notice" role="status">{scheduledMessage}</div> : null}
      {summary.pendingChange?.status === 'SCHEDULED' ? <div className="rb-auth-notice" role="status">{summary.pendingChange.toPlan.name} is scheduled for {formatDate(summary.pendingChange.effectiveAt)}. Return at the end of the paid term to authorize checkout; no replacement charge has been made.</div> : null}
      <section className="rb-security-section">
        <div className="rb-security-section__header">
          <div>
            <h2>Current plan</h2>
            {subscription ? (
              <p>{subscription.plan.name} · {subscription.plan.billingInterval.toLowerCase()} · {subscription.status.replaceAll('_', ' ').toLowerCase()}</p>
            ) : <p>No subscription is recorded for this organization.</p>}
          </div>
          <Button asChild variant="outline"><Link href="/pricing">View plans</Link></Button>
        </div>
        {subscription ? (
          <ul className="rb-billing-facts">
            <li><span>Plan price</span><strong>{formatMoney(subscription.plan.priceMinor, subscription.plan.currency)}</strong></li>
            {subscription.trialEndsAt && subscription.status === 'TRIALING' ? <li><span>Trial ends</span><strong>{formatDate(subscription.trialEndsAt)}</strong></li> : null}
            {subscription.intendedPlan && subscription.status === 'TRIALING' ? <li><span>Selected plan after trial</span><strong>{subscription.intendedPlan.name} · {subscription.intendedPlan.billingInterval.toLowerCase()}</strong></li> : null}
            {subscription.currentPeriodEnd ? <li><span>{subscription.cancelAtPeriodEnd ? 'Access ends' : 'Current period ends'}</span><strong>{formatDate(subscription.currentPeriodEnd)}</strong></li> : null}
            {subscription.billingProvider ? <li><span>Payment provider</span><strong>{subscription.billingProvider === 'PADDLE' ? 'Legacy provider' : 'Paystack'}</strong></li> : null}
          </ul>
        ) : null}
        {subscription?.billingProvider && hasPermission(organization, 'organization.update') ? (
          <div className="rb-trial-actions">
            <Button variant="outline" onClick={() => void managePaymentMethod()}>Manage payment method</Button>
            {subscription.status === 'ACTIVE' && !subscription.cancelAtPeriodEnd ? <Button variant="outline" onClick={() => setShowCancel(true)}>Cancel subscription</Button> : null}
            {subscription.status === 'CANCEL_SCHEDULED' ? <Button variant="outline" onClick={() => void resumeSubscription()}>Keep my current plan</Button> : null}
          </div>
        ) : null}
      </section>
      {subscription ? (
        <section className="rb-security-section">
          <div className="rb-security-section__header">
            <div><h2>Usage this period</h2><p>{formatDate(summary.usage.periodStart)} to {formatDate(summary.usage.periodEnd)}</p></div>
          </div>
          <ul className="rb-billing-facts">
            {summary.usage.resources.map((resource) => (
              <li key={resource.key}>
                <span>{usageLabels[resource.key] ?? resource.key}</span>
                <strong className="rb-num">{resource.used} / {resource.limit === null ? 'Unlimited' : resource.limit}</strong>
                {resource.limit !== null ? <progress value={Math.min(resource.used, resource.limit)} max={Math.max(resource.limit, 1)} aria-label={`${usageLabels[resource.key] ?? resource.key} usage`} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="rb-security-section">
        <div className="rb-security-section__header">
          <div><h2>Compare plans</h2><p>Choose a term, then authorize payment with the plan&apos;s provider. Your subscription changes only after payment is verified.</p></div>
          <div className="rb-trial-actions" role="group" aria-label="Billing interval">
            <Button variant={interval === 'MONTHLY' ? 'primary' : 'outline'} onClick={() => setInterval('MONTHLY')}>Monthly</Button>
            <Button variant={interval === 'YEARLY' ? 'primary' : 'outline'} onClick={() => setInterval('YEARLY')}>Yearly</Button>
          </div>
        </div>
        {subscription?.status === 'ACTIVE' ? <p className="rb-security-note">Upgrades start a new full-price term after verified checkout. Unused paid time is not automatically credited. Downgrades are scheduled for the end of your paid term; you authorize the replacement checkout then.</p> : null}
        <ul className="rb-billing-facts">
          {plans.filter((plan) => plan.billingInterval === interval).map((plan) => (
            <li key={plan.id}>
              <span>{plan.name}{subscription?.status === 'ACTIVE' && subscription.plan.name === plan.name && subscription.plan.billingInterval === interval ? ' · Current plan' : ''}</span>
              <strong>{formatMoney(plan.priceMinor, plan.currency)} {interval === 'YEARLY' ? 'billed yearly' : '/ month'}</strong>
              <span>{plan.description}</span>
              <span>{plan.entitlements.filter((item) => item.key in usageLabels).slice(0, 5).map((item) => `${usageLabels[item.key]}: ${item.limitValue === null ? 'Unlimited' : item.limitValue}`).join(' · ')}</span>
              {subscription?.status === 'ACTIVE' && subscription.plan.name === plan.name && subscription.plan.billingInterval === interval ? null : plan.checkoutAvailable && hasPermission(organization, 'organization.update') ? (
                <Button variant="outline" loading={busyPlan === plan.key} disabled={Boolean(busyPlan)} onClick={() => void openCheckout(plan)}>{subscription?.status === 'ACTIVE' && ({ starter: 1, growth: 2, professional: 3, advanced: 4 }[plan.tierKey as 'starter' | 'growth' | 'professional' | 'advanced'] ?? 0) < ({ starter: 1, growth: 2, professional: 3, advanced: 4 }[subscription.plan.tierKey as 'starter' | 'growth' | 'professional' | 'advanced'] ?? 0) ? 'Schedule downgrade' : 'Continue to secure checkout'}</Button>
              ) : <span>Checkout not available yet</span>}
            </li>
          ))}
        </ul>
      </section>
      <section className="rb-security-section">
        <div className="rb-security-section__header"><div><h2>Billing details</h2><p>Local billing contact and address. Your payment provider controls its own receipts and tax documents.</p></div></div>
        <div className="rb-billing-profile-grid">
          {([['contactName', 'Contact name'], ['contactEmail', 'Contact email'], ['countryCode', 'Country code'], ['addressLine1', 'Address line 1'], ['addressLine2', 'Address line 2'], ['city', 'City'], ['region', 'Region'], ['postalCode', 'Postal code'], ['taxId', 'Tax ID']] as const).map(([key, label]) => <div key={key}>
            <Label htmlFor={`billing-${key}`}>{label}</Label>
            <Input id={`billing-${key}`} type={key === 'contactEmail' ? 'email' : 'text'} value={profile[key]} maxLength={key === 'countryCode' ? 2 : 255} disabled={!hasPermission(organization, 'organization.update')} onChange={(event) => setProfile({ ...profile, [key]: key === 'countryCode' ? event.target.value.toUpperCase() : event.target.value })} />
          </div>)}
        </div>
        {hasPermission(organization, 'organization.update') ? <div className="rb-trial-actions"><Button loading={savingProfile} onClick={() => void saveProfile()}>Save billing details</Button>{profileSaved ? <span role="status">Billing details saved.</span> : null}</div> : null}
      </section>
      <section className="rb-security-section">
        <div className="rb-security-section__header">
          <div><h2>Payment history</h2><p>Receipts are issued by your payment provider when available.</p></div>
        </div>
        <DataTable
          caption="Subscription payment history"
          rows={visibleTransactions}
          columns={[
            { key: 'date', header: 'Date', cell: (row) => formatDate(row.paidAt ?? row.createdAt), value: (row) => row.createdAt },
            { key: 'reference', header: 'Reference', cell: (row) => row.billingProvider === 'PADDLE' || row.receiptUrl ? <button type="button" className="rb-link-button" onClick={() => void openDocument(row.id)}>{row.providerTransactionId}</button> : row.providerTransactionId },
            { key: 'plan', header: 'Plan', cell: (row) => row.planNameSnapshot ? `${row.planNameSnapshot} · ${row.billingIntervalSnapshot?.toLowerCase() ?? ''}` : '—', hideBelow: 'tablet' as const },
            { key: 'period', header: 'Period', cell: (row) => row.periodStart ? `${formatDate(row.periodStart)} – ${formatDate(row.periodEnd)}` : '—', hideBelow: 'desktop' as const },
            { key: 'amount', header: 'Amount', cell: (row) => formatMoney(row.amountMinor, row.currency), align: 'right' as const },
            { key: 'provider', header: 'Provider', cell: (row) => row.billingProvider, hideBelow: 'tablet' as const },
            { key: 'status', header: 'Status', cell: (row) => row.status.replaceAll('_', ' ').toLowerCase() },
            { key: 'receipt', header: 'Provider document', cell: (row) => row.billingProvider === 'PADDLE' && row.status === 'SUCCESSFUL' ? 'Historical provider invoice' : row.receiptUrl ? 'Provider receipt' : '—' },
          ]}
          loading={historyLoading}
          toolbar={<DataTableToolbar resultLabel={`${historyTotal} payments`}><DataTableSearch label="Search payments on this page" placeholder="Search this page" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Payment status" value={historyStatus} onChange={(event) => { setHistoryStatus(event.target.value); setHistoryPage(1); }}><option value="">All statuses</option><option value="SUCCESSFUL">Successful</option><option value="FAILED">Failed</option><option value="REFUNDED">Refunded</option><option value="PARTIALLY_REFUNDED">Partially refunded</option></select></DataTableToolbar>}
          emptyTitle="No subscription payments yet"
          emptyDescription="Your payment history will appear here after your first successful subscription payment."
        />
        <div className="rb-trial-actions" aria-label="Payment history pages"><Button variant="outline" disabled={historyPage <= 1 || historyLoading} onClick={() => setHistoryPage((page) => page - 1)}>Previous</Button><span>Page {historyPage} of {Math.max(1, Math.ceil(historyTotal / 20))}</span><Button variant="outline" disabled={historyPage * 20 >= historyTotal || historyLoading} onClick={() => setHistoryPage((page) => page + 1)}>Next</Button></div>
      </section>
      <Dialog open={showCancel} onOpenChange={setShowCancel}>
        <DialogContent title="Cancel subscription" description={`Your paid access continues until ${formatDate(subscription?.currentPeriodEnd ?? null)}. Your records remain available after cancellation.`}>
          <div className="rb-billing-cancel-form">
            <Label htmlFor="billing-cancel-reason">Reason (optional)</Label>
            <Input id="billing-cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={500} />
            <div className="rb-trial-actions">
              <Button variant="danger" loading={busyCancel} onClick={() => void cancelSubscription()}>Confirm cancellation</Button>
              <Button variant="outline" onClick={() => setShowCancel(false)}>Keep subscription</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
