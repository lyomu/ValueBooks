'use client';

import type {
  OpenInvoiceForAllocation,
  PaymentReceived,
  PaymentStatus,
} from '@valuebooks/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@valuebooks/ui';
import { CheckCircle2, PlusCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { decimalToMinor, formatMinor, minorToDecimal } from '../lib/money';
import { PAYMENT_ALLOCATE_INVOICE_KEY, takeInvoiceSeed } from './invoice-seed';
import { RecordPaymentDialog, type RecordPaymentSeed } from './record-payment-dialog';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { OperationalListing } from './operational-listing';
import { TransactionCollaboration } from './transaction-collaboration';

type PaymentListResponse = { data: PaymentReceived[] };
type PaymentResponse = { data: PaymentReceived };
type OpenInvoiceListResponse = { data: OpenInvoiceForAllocation[] };

const statusOptions: readonly PaymentStatus[] = [
  'UNAPPLIED',
  'PARTIALLY_ALLOCATED',
  'FULLY_ALLOCATED',
];

export function PaymentsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'sales.payments.view');
  const canRecord = hasPermission(organization, 'sales.payments.record');

  const canAllocate = hasPermission(organization, 'sales.payments.allocate');

  const [payments, setPayments] = useState<PaymentReceived[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | PaymentStatus>('');
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<PaymentListResponse>(
        `/organizations/${organizationId}/payments${suffix}`,
      );
      setPayments(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Payments could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: readonly DataTableColumn<PaymentReceived>[] = [
    {
      key: 'payment',
      header: 'Payment',
      value: (payment) => payment.paymentNumber ?? '',
      cell: (payment) => (
        <div>
          <span>{payment.paymentNumber ?? 'Payment'}</span>
          <span className="rb-table-secondary">{payment.contactName}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      value: (payment) => payment.status,
      cell: (payment) => <StatusBadge status={payment.status} />,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      value: (payment) => payment.amountMinor,
      cell: (payment) => formatMinor(payment.amountMinor, payment.currency),
    },
    {
      key: 'unapplied',
      header: 'Unapplied',
      align: 'right',
      value: (payment) => payment.unappliedMinor,
      cell: (payment) => formatMinor(payment.unappliedMinor, payment.currency),
      hideBelow: 'tablet',
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      cell: (payment) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/payments/${payment.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant payment access." />
    );
  }

  return (
    <>
      <div className="rb-ledger-stack">
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}

        {!payments && !error ? (
          <Skeleton />
        ) : (
          <OperationalListing
            title={statusFilter ? `${statusFilter.replaceAll('_', ' ').toLowerCase()} payments` : 'All received payments'}
            rows={payments ?? []}
            columns={columns}
            searchText={(payment) => `${payment.paymentNumber ?? ''} ${payment.contactName} ${payment.status}`}
            filter={<Select aria-label="Payment status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="">All statuses</option>{statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</Select>}
            primaryAction={canRecord ? <Button onClick={() => setRecording(true)}><PlusCircle aria-hidden="true" /> New</Button> : null}
            onRefresh={() => void load()}
            onImport={async () => undefined}
            emptyState={{ title: 'Record the payments you receive', description: 'Capture a customer payment, then apply it against their open invoices.', illustration: 'sales', variant: 'onboarding', benefits: ['Keep invoice balances current', 'See unapplied funds before allocating them'] }}
            noResultsState={{ title: 'No payments match this view', description: 'Clear the search or status filter to see received payments.', illustration: 'sales', variant: 'no-results', action: <Button variant="outline" onClick={() => setStatusFilter('')}>Clear filters</Button> }}
            onResetFilters={() => setStatusFilter('')}
            empty="No payments match this view."
          />
        )}
      </div>

      <RecordPaymentDialog
        open={recording}
        onOpenChange={setRecording}
        organizationId={organizationId}
        baseCurrency={organization?.baseCurrency ?? 'KES'}
        canAllocate={canAllocate}
        onRecorded={() => void load()}
      />
    </>
  );
}

const PAYMENT_FLASH_NOTICE_KEY = 'rb-payment-notice';

/**
 * The /payments/new route, kept so existing links and the invoice hand-off still resolve. Recording
 * itself lives in the dialog, so the route simply opens it over the payments list and leaves when
 * it closes -- there is no second, divergent full-page form to keep in step.
 */
export function NewPaymentPage() {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canRecord = hasPermission(organization, 'sales.payments.record');
  const canAllocate = hasPermission(organization, 'sales.payments.allocate');
  const [seed, setSeed] = useState<RecordPaymentSeed | null>(null);

  // "Record payment" on an invoice pre-fills the customer, amount and target invoice.
  useEffect(() => {
    const invoiceSeed = takeInvoiceSeed('payment');
    if (!invoiceSeed) return;
    setSeed({
      contactId: invoiceSeed.contactId,
      amount: invoiceSeed.amount,
      invoiceId: invoiceSeed.invoiceId,
      lockCustomer: true,
    });
  }, []);

  if (!workspace.loading && organization && !canRecord) {
    return <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant payment access." />;
  }

  return (
    <>
      <PageHeader
        title="New payment"
        description="Record a customer payment. It posts to the ledger immediately."
        actions={
          <Button asChild variant="outline">
            <Link href="/payments">Back to payments</Link>
          </Button>
        }
      />
      <RecordPaymentDialog
        open
        onOpenChange={(open) => {
          if (!open) router.push('/payments');
        }}
        organizationId={organizationId}
        baseCurrency={organization?.baseCurrency ?? 'KES'}
        canAllocate={canAllocate}
        seed={seed}
        onRecorded={(payment) => router.replace(`/payments/${payment.id}`)}
      />
    </>
  );
}

export function PaymentEditorPage({ paymentId }: { paymentId: string }) {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canAllocate = hasPermission(organization, 'sales.payments.allocate');

  const [payment, setPayment] = useState<PaymentReceived | null>(null);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceForAllocation[]>([]);
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [paymentResponse, openInvoicesResponse] = await Promise.all([
        apiRequest<PaymentResponse>(`/organizations/${organizationId}/payments/${paymentId}`),
        apiRequest<OpenInvoiceListResponse>(
          `/organizations/${organizationId}/payments/${paymentId}/open-invoices`,
        ),
      ]);
      setPayment(paymentResponse.data);
      setOpenInvoices(openInvoicesResponse.data);
      // A payment recorded from an invoice pre-fills that invoice's allocation once. The dialog
      // allocates up front, so this only still fires for the older seed-then-allocate path.
      const targetId = window.sessionStorage.getItem(PAYMENT_ALLOCATE_INVOICE_KEY);
      const target = targetId
        ? openInvoicesResponse.data.find((invoice) => invoice.id === targetId)
        : undefined;
      if (targetId) window.sessionStorage.removeItem(PAYMENT_ALLOCATE_INVOICE_KEY);
      const balance = target ? BigInt(target.balanceMinor) : 0n;
      const unapplied = BigInt(paymentResponse.data.unappliedMinor);
      const apply = balance < unapplied ? balance : unapplied;
      setAllocationAmounts(
        target && apply > 0n ? { [target.id]: minorToDecimal(apply.toString()) } : {},
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The payment could not be loaded.');
    }
  }, [organizationId, paymentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flash = window.sessionStorage.getItem(PAYMENT_FLASH_NOTICE_KEY);
    if (!flash) return;
    window.sessionStorage.removeItem(PAYMENT_FLASH_NOTICE_KEY);
    setNotice(flash);
  }, [paymentId]);

  const currency = payment?.currency ?? organization?.baseCurrency ?? 'KES';

  const totalToApplyMinor = useMemo(
    () =>
      Object.values(allocationAmounts).reduce(
        (sum, value) => sum + (value ? BigInt(decimalToMinor(value)) : 0n),
        0n,
      ),
    [allocationAmounts],
  );
  const unappliedMinor = payment ? BigInt(payment.unappliedMinor) : 0n;
  const exceedsUnapplied = totalToApplyMinor > unappliedMinor;
  const canSubmitAllocation = canAllocate && totalToApplyMinor > 0n && !exceedsUnapplied;

  async function allocate() {
    if (!organizationId || !payment) return;
    const allocations = Object.entries(allocationAmounts)
      .filter(([, value]) => value.trim() !== '')
      .map(([invoiceId, value]) => ({ invoiceId, amountMinor: decimalToMinor(value) }));
    if (allocations.length === 0) return;
    setBusy('allocate');
    setError(null);
    try {
      const response = await apiRequest<PaymentResponse>(
        `/organizations/${organizationId}/payments/${payment.id}/allocate`,
        {
          method: 'POST',
          body: JSON.stringify({ allocations }),
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        },
      );
      setPayment(response.data);
      setNotice('Payment allocated.');
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The allocation could not be applied.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title={payment?.paymentNumber ?? 'Payment'}
        description="Apply this payment against the customer's open invoices."
        actions={
          <Button asChild variant="outline">
            <Link href="/payments">Back to payments</Link>
          </Button>
        }
      />
      <div className="rb-ledger-stack">
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rb-auth-notice" role="status">
            {notice}
          </div>
        ) : null}
        {!payment && !error ? <Skeleton /> : null}

        {payment ? (
          <Card className="rb-journal-editor">
            <div className="rb-journal-editor__meta">
              <div className="rb-field">
                <Label>Customer</Label>
                <Input value={payment.contactName} disabled />
              </div>
              <div className="rb-field">
                <Label>Amount</Label>
                <Input value={formatMinor(payment.amountMinor, payment.currency)} disabled />
              </div>
              <div className="rb-field">
                <Label>Allocated</Label>
                <Input value={formatMinor(payment.allocatedMinor, payment.currency)} disabled />
              </div>
              <div className="rb-field">
                <Label>Unapplied</Label>
                <Input value={formatMinor(payment.unappliedMinor, payment.currency)} disabled />
              </div>
              <StatusBadge status={payment.status} />
            </div>

            {openInvoices.length === 0 ? (
              <EmptyState
                title="No open invoices"
                description="This customer has no issued invoices with an outstanding balance to apply this payment against."
              />
            ) : (
              <>
                <div className="rb-journal-lines" role="table" aria-label="Open invoices">
                  <div className="rb-journal-lines__head" role="row">
                    <span>Invoice</span>
                    <span>Total</span>
                    <span>Balance</span>
                    <span>Amount to apply</span>
                  </div>
                  {openInvoices.map((invoice) => (
                    <div className="rb-journal-lines__row" role="row" key={invoice.id}>
                      <span>{invoice.invoiceNumber ?? 'Invoice'}</span>
                      <span className="rb-table-secondary rb-num">
                        {formatMinor(invoice.totalMinor, invoice.currency)}
                      </span>
                      <span className="rb-table-secondary rb-num">
                        {formatMinor(invoice.balanceMinor, invoice.currency)}
                      </span>
                      <Input
                        aria-label={`Amount to apply to invoice ${invoice.invoiceNumber ?? invoice.id}`}
                        inputMode="decimal"
                        value={allocationAmounts[invoice.id] ?? ''}
                        disabled={!canAllocate}
                        onChange={(event) =>
                          setAllocationAmounts((current) => ({
                            ...current,
                            [invoice.id]: event.target.value,
                          }))
                        }
                        placeholder="0.00"
                      />
                    </div>
                  ))}
                </div>

                <div className="rb-journal-editor__footer">
                  <div>
                    <span>To apply {formatMinor(totalToApplyMinor.toString(), currency)}</span>
                    <span>Unapplied {formatMinor(payment.unappliedMinor, currency)}</span>
                    {exceedsUnapplied ? (
                      <Badge tone="danger">Exceeds the payment&apos;s unapplied amount</Badge>
                    ) : null}
                  </div>
                  {canAllocate ? (
                    <div className="rb-dialog-footer">
                      <Button
                        type="button"
                        onClick={() => void allocate()}
                        loading={busy === 'allocate'}
                        disabled={!canSubmitAllocation}
                      >
                        <CheckCircle2 aria-hidden="true" /> Allocate
                      </Button>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </Card>
        ) : null}
        {organizationId && paymentId ? (
          <TransactionCollaboration
            organizationId={organizationId}
            targetType="PAYMENT_RECEIVED"
            targetId={paymentId}
            canComment={hasPermission(organization, 'collaboration.comments.create')}
            canUpload={
              hasPermission(organization, 'collaboration.attachments.upload') &&
              hasPermission(organization, 'sales.payments.record')
            }
            canShareWithCustomer={hasPermission(
              organization,
              'collaboration.customer_visibility.manage',
            )}
            customerEligible
          />
        ) : null}
      </div>
    </>
  );
}
