'use client';

import type { Contact, Invoice, InvoiceStatus, Item, TaxCode } from '@valuebooks/contracts';
import {
  Button,
  Card,
  DataTable,
  DataTableToolbar,
  FieldMessage,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@valuebooks/ui';
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  FilePlus2,
  Filter,
  Mail,
  Plus,
  ReceiptText,
  Save,
  Search,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { CustomerDialog } from './customer-dialog';
import { ItemDialog } from './item-dialog';
import { InvoiceDetailPane } from './invoice-detail-pane';
import { daysOverdue, formatInvoiceDate, formatMinor } from './invoice-format';
import { RecordDetailWorkspace } from './record-detail-workspace';
import { TransactionCollaboration } from './transaction-collaboration';

type InvoiceListResponse = { data: Invoice[] };
type InvoiceResponse = { data: Invoice };
type ContactListResponse = { data: Contact[] };
type ItemListResponse = { data: Item[] };
type TaxCodeListResponse = { data: TaxCode[] };

const statusOptions: readonly InvoiceStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
];

type DraftLine = {
  key: string;
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxCodeId: string;
};

const blankLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  itemId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discount: '',
  taxCodeId: '',
});

export function InvoicesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'sales.invoices.view');
  const canManage = hasPermission(organization, 'sales.invoices.manage');

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | InvoiceStatus>('');
  const [query, setQuery] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<InvoiceListResponse>(
        `/organizations/${organizationId}/invoices${suffix}`,
      );
      setInvoices(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invoices could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return invoices ?? [];
    return (invoices ?? []).filter((invoice) =>
      `${invoice.invoiceNumber ?? ''} ${invoice.contactName}`.toLowerCase().includes(needle),
    );
  }, [invoices, query]);

  const summaryCurrency = organization?.baseCurrency ?? invoices?.[0]?.currency ?? 'KES';
  const receivables = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    const windowEnd = thirtyDays.toISOString().slice(0, 10);

    return (invoices ?? []).reduce(
      (summary, invoice) => {
        if (invoice.currency !== summaryCurrency || invoice.status === 'VOID') return summary;
        const balance = BigInt(invoice.balanceMinor);
        if (balance <= 0n) return summary;

        summary.outstanding += balance;
        if (invoice.dueDate === today) summary.dueToday += balance;
        if (invoice.dueDate && invoice.dueDate > today && invoice.dueDate <= windowEnd) {
          summary.dueSoon += balance;
        }
        if (invoice.status === 'OVERDUE' || (invoice.dueDate && invoice.dueDate < today)) {
          summary.overdue += balance;
          summary.overdueCount += 1;
        }
        return summary;
      },
      { outstanding: 0n, dueToday: 0n, dueSoon: 0n, overdue: 0n, overdueCount: 0 },
    );
  }, [invoices, summaryCurrency]);

  const columns: readonly DataTableColumn<Invoice>[] = [
    {
      key: 'date',
      header: 'Date',
      cell: (invoice) => (
        <span className="rb-invoice-date">{formatInvoiceDate(invoice.issueDate)}</span>
      ),
      hideBelow: 'desktop',
    },
    {
      key: 'invoice',
      header: 'Invoice #',
      cell: (invoice) => (
        <Link
          className="rb-invoice-number"
          href={`/invoices/${invoice.id}`}
          onClick={(event) => {
            event.preventDefault();
            setSelectedInvoiceId(invoice.id);
          }}
        >
          {invoice.invoiceNumber ?? 'Draft'}
        </Link>
      ),
    },
    { key: 'customer', header: 'Customer', cell: (invoice) => invoice.contactName },
    { key: 'status', header: 'Status', cell: (invoice) => <StatusBadge status={invoice.status} /> },
    {
      key: 'due-date',
      header: 'Due date',
      cell: (invoice) => formatInvoiceDate(invoice.dueDate),
      hideBelow: 'desktop',
    },
    {
      key: 'total',
      header: 'Amount',
      align: 'right',
      cell: (invoice) => formatMinor(invoice.totalMinor, invoice.currency),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      cell: (invoice) => formatMinor(invoice.balanceMinor, invoice.currency),
      hideBelow: 'tablet',
    },
    {
      key: 'open',
      header: <span className="rb-visually-hidden">Open</span>,
      align: 'right',
      cell: (invoice) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/invoices/${invoice.id}`}>
            Open <ArrowUpRight aria-hidden="true" />
          </Link>
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant invoice access." />
    );
  }

  const selectedInvoice = invoices?.find((invoice) => invoice.id === selectedInvoiceId);
  if (selectedInvoice) {
    return (
      <RecordDetailWorkspace
        variant="compact"
        title="Invoices"
        records={invoices ?? []}
        selectedId={selectedInvoice.id}
        onSelect={(invoice) => setSelectedInvoiceId(invoice.id)}
        onClose={() => setSelectedInvoiceId(null)}
        searchText={(invoice) =>
          `${invoice.invoiceNumber ?? ''} ${invoice.contactName} ${invoice.status}`
        }
        railHeader={
          <>
            <button
              type="button"
              className="rb-record-workspace__title-button"
              onClick={() => setSelectedInvoiceId(null)}
              aria-label="Return to all invoices"
            >
              All Invoices
              <ChevronDown aria-hidden="true" />
            </button>
            {canManage ? (
              <Link
                className="rb-record-workspace__new"
                href="/invoices/new"
                aria-label="New invoice"
              >
                <Plus aria-hidden="true" />
              </Link>
            ) : null}
          </>
        }
        renderRailRecord={(invoice) => {
          const overdueDays = daysOverdue(invoice.dueDate, invoice.balanceMinor, invoice.status);
          return (
            <>
              <span className="rb-invoice-rail__top">
                <strong>{invoice.contactName}</strong>
                <span className="rb-invoice-rail__amount">
                  {formatMinor(invoice.totalMinor, invoice.currency)}
                </span>
              </span>
              <span className="rb-invoice-rail__meta">
                {invoice.invoiceNumber ?? 'Draft'} · {formatInvoiceDate(invoice.issueDate)}
              </span>
              {overdueDays > 0 ? (
                <span className="rb-invoice-rail__status is-overdue">
                  OVERDUE BY {overdueDays} {overdueDays === 1 ? 'DAY' : 'DAYS'}
                </span>
              ) : (
                <span className="rb-invoice-rail__status">
                  {invoice.status.replaceAll('_', ' ')}
                </span>
              )}
            </>
          );
        }}
        detailTitle={(invoice) => <h1>{invoice.invoiceNumber ?? 'Draft invoice'}</h1>}
        renderDetail={(invoice) => (
          <InvoiceDetailPane
            invoice={invoice}
            organizationId={organizationId ?? ''}
            organizationName={organization?.tradingName ?? organization?.legalName ?? 'ValueBooks'}
            permissions={{
              canManage,
              canIssue: hasPermission(organization, 'sales.invoices.issue'),
              canVoid: hasPermission(organization, 'sales.invoices.void'),
              canSend: hasPermission(organization, 'sales.documents.send'),
              canRecordPayment: hasPermission(organization, 'sales.payments.record'),
              canAllocatePayment: hasPermission(organization, 'sales.payments.allocate'),
              canCreateCreditNote: hasPermission(organization, 'sales.credit_notes.manage'),
              canManageRecurring: hasPermission(organization, 'sales.recurring_invoices.manage'),
              canViewNumbering: hasPermission(organization, 'numbering.view'),
            }}
            onChanged={load}
            onDeleted={async () => {
              setSelectedInvoiceId(null);
              await load();
            }}
          />
        )}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="All invoices"
        className="rb-invoice-list__header"
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/invoices/new">
                <FilePlus2 aria-hidden="true" /> New invoice
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="rb-invoice-list">
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}

        <section className="rb-invoice-receivables" aria-labelledby="invoice-receivables-heading">
          <div className="rb-invoice-receivables__heading">
            <span className="rb-invoice-receivables__icon">
              <CircleDollarSign aria-hidden="true" />
            </span>
            <div>
              <p id="invoice-receivables-heading">Receivables overview</p>
              <span>Open customer balances in {summaryCurrency}</span>
            </div>
          </div>
          <div className="rb-invoice-receivables__metrics">
            <div>
              <span>Outstanding</span>
              <strong>{formatMinor(receivables.outstanding.toString(), summaryCurrency)}</strong>
            </div>
            <div>
              <span>Due today</span>
              <strong className="is-attention">
                {formatMinor(receivables.dueToday.toString(), summaryCurrency)}
              </strong>
            </div>
            <div>
              <span>Due within 30 days</span>
              <strong>{formatMinor(receivables.dueSoon.toString(), summaryCurrency)}</strong>
            </div>
            <div>
              <span>Overdue</span>
              <strong className={receivables.overdueCount > 0 ? 'is-risk' : ''}>
                {formatMinor(receivables.overdue.toString(), summaryCurrency)}
              </strong>
              <small>{receivables.overdueCount} open</small>
            </div>
          </div>
        </section>

        <section className="rb-invoice-list__table" aria-label="Invoice records">
          {!invoices && !error ? (
            <Skeleton />
          ) : (
            <DataTable
              caption="Invoices"
              columns={columns}
              rows={filtered}
              emptyTitle={invoices?.length ? 'No invoices match this view' : 'No invoices yet'}
              emptyDescription={
                invoices?.length
                  ? 'Try changing the search or status filter to see your records.'
                  : 'Create your first invoice to start billing customers.'
              }
              toolbar={
                <DataTableToolbar resultLabel={`${filtered.length} shown`}>
                  <div className="rb-data-table-toolbar__search">
                    <Search aria-hidden="true" />
                    <Input
                      id="invoice-search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search invoice number or customer"
                      aria-label="Search invoices"
                    />
                  </div>
                  <div className="rb-data-table-toolbar__filter rb-invoice-list__filter">
                    <Filter aria-hidden="true" />
                    <Label htmlFor="invoice-status">Status</Label>
                    <Select
                      id="invoice-status"
                      value={statusFilter}
                      onChange={(event) =>
                        setStatusFilter(event.target.value as typeof statusFilter)
                      }
                    >
                      <option value="">All statuses</option>
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </Select>
                  </div>
                </DataTableToolbar>
              }
            />
          )}
        </section>
      </div>
    </>
  );
}

const INVOICE_FLASH_NOTICE_KEY = 'rb-invoice-notice';
const NEW_CATALOG_ITEM_VALUE = '__new_catalog_item__';
const NEW_CUSTOMER_VALUE = '__new_customer__';

export function InvoiceEditorPage({ invoiceId }: { invoiceId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'sales.invoices.manage');
  const canIssue = hasPermission(organization, 'sales.invoices.issue');
  const canVoid = hasPermission(organization, 'sales.invoices.void');
  const canSend = hasPermission(organization, 'sales.documents.send');

  const [customers, setCustomers] = useState<Contact[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [contactId, setContactId] = useState('');
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [customerResponse, itemResponse, taxCodeResponse, invoiceResponse] = await Promise.all([
        apiRequest<ContactListResponse>(`/organizations/${organizationId}/customers?status=ACTIVE`),
        apiRequest<ItemListResponse>(
          `/organizations/${organizationId}/catalog/items?status=ACTIVE`,
        ),
        apiRequest<TaxCodeListResponse>(`/organizations/${organizationId}/tax/codes`),
        invoiceId
          ? apiRequest<InvoiceResponse>(`/organizations/${organizationId}/invoices/${invoiceId}`)
          : Promise.resolve(null),
      ]);
      setCustomers(customerResponse.data);
      setItems(itemResponse.data);
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      if (invoiceResponse) {
        setInvoice(invoiceResponse.data);
        setContactId(invoiceResponse.data.contactId);
        setDueDate(invoiceResponse.data.dueDate ?? '');
        setLines(
          invoiceResponse.data.lines.length > 0
            ? invoiceResponse.data.lines.map((line) => ({
                key: line.id,
                itemId: line.itemId ?? '',
                description: line.descriptionSnapshot,
                quantity: line.quantity,
                unitPrice: minorToDecimal(line.unitPriceMinor),
                discount: line.discountMinor === '0' ? '' : minorToDecimal(line.discountMinor),
                taxCodeId: line.taxCodeId ?? '',
              }))
            : [blankLine()],
        );
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The invoice could not be loaded.');
    }
  }, [invoiceId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flash = window.sessionStorage.getItem(INVOICE_FLASH_NOTICE_KEY);
    if (!flash) return;
    window.sessionStorage.removeItem(INVOICE_FLASH_NOTICE_KEY);
    setNotice(flash);
  }, [invoiceId]);

  const contact = customers.find((candidate) => candidate.id === contactId) ?? null;
  const currency = contact?.currency ?? invoice?.currency ?? organization?.baseCurrency ?? 'KES';

  const subtotalPreviewMinor = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + previewLineTotalMinor(line.quantity, line.unitPrice, line.discount),
        0n,
      ),
    [lines],
  );

  const posted = invoice ? invoice.status !== 'DRAFT' : false;
  const editable = !posted && canManage;

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, blankLine()]);
  }

  function removeLine(key: string) {
    setLines((current) =>
      current.length > 1 ? current.filter((line) => line.key !== key) : current,
    );
  }

  function selectItem(key: string, itemId: string) {
    if (itemId === NEW_CATALOG_ITEM_VALUE) {
      setItemDialogOpen(true);
      return;
    }
    if (!itemId) {
      updateLine(key, { itemId: '' });
      return;
    }
    const item = items.find((candidate) => candidate.id === itemId);
    const price = item?.prices.find(
      (candidate) => candidate.priceListKey === 'default' && candidate.currency === currency,
    );
    updateLine(key, {
      itemId,
      description: item?.salesDescription || item?.name || '',
      unitPrice: price ? minorToDecimal(price.unitPriceMinor) : '',
      taxCodeId: item?.defaultTaxCodeId ?? '',
    });
  }

  function selectCustomer(nextContactId: string) {
    if (nextContactId === NEW_CUSTOMER_VALUE) {
      setCustomerDialogOpen(true);
      return;
    }
    setContactId(nextContactId);
  }

  async function saveDraft() {
    if (!organizationId || !contactId) return null;
    setBusy('save');
    setError(null);
    try {
      const payload = {
        contactId,
        dueDate: dueDate || undefined,
        lines: lines.map((line) => {
          const item = items.find((candidate) => candidate.id === line.itemId);
          const descriptionEditable = !item || item.freeDescriptionAllowed;
          return {
            itemId: line.itemId || undefined,
            description: descriptionEditable ? line.description || undefined : undefined,
            quantity: line.quantity || '1',
            unitPriceMinor: line.unitPrice ? decimalToMinor(line.unitPrice) : undefined,
            discountMinor: line.discount ? decimalToMinor(line.discount) : undefined,
            taxCodeId: line.taxCodeId || undefined,
          };
        }),
      };
      const response = await apiRequest<InvoiceResponse>(
        invoiceId
          ? `/organizations/${organizationId}/invoices/${invoiceId}`
          : `/organizations/${organizationId}/invoices`,
        { method: invoiceId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      setInvoice(response.data);
      if (!invoiceId) {
        window.sessionStorage.setItem(INVOICE_FLASH_NOTICE_KEY, 'Draft saved.');
        router.replace(`/invoices/${response.data.id}`);
      } else {
        setNotice('Draft saved.');
      }
      return response.data;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The draft could not be saved.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function issueInvoice() {
    if (!organizationId || !invoice?.id) return;
    setBusy('issue');
    setError(null);
    try {
      const response = await apiRequest<InvoiceResponse>(
        `/organizations/${organizationId}/invoices/${invoice.id}/issue`,
        { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      setInvoice(response.data);
      setNotice(`Issued as ${response.data.invoiceNumber}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The invoice could not be issued.');
    } finally {
      setBusy(null);
    }
  }

  async function voidInvoice() {
    if (!organizationId || !invoice?.id) return;
    setBusy('void');
    setError(null);
    try {
      const response = await apiRequest<InvoiceResponse>(
        `/organizations/${organizationId}/invoices/${invoice.id}/void`,
        { method: 'POST' },
      );
      setInvoice(response.data);
      setNotice('Invoice voided.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The invoice could not be voided.');
    } finally {
      setBusy(null);
    }
  }

  async function sendInvoice() {
    if (!organizationId || !invoice?.id) return;
    setBusy('send');
    setError(null);
    try {
      const response = await apiRequest<InvoiceResponse>(
        `/organizations/${organizationId}/invoices/${invoice.id}/send`,
        { method: 'POST' },
      );
      setInvoice(response.data);
      setNotice('Invoice sent.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The invoice could not be sent.');
    } finally {
      setBusy(null);
    }
  }

  const canVoidNow =
    invoice &&
    (invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID') &&
    invoice.paidMinor === '0' &&
    canVoid;
  const canSendNow = invoice && invoice.status !== 'DRAFT' && invoice.status !== 'VOID' && canSend;

  return (
    <>
      <PageHeader
        title={invoice?.invoiceNumber ?? (invoiceId ? 'Invoice' : 'New invoice')}
        description={
          posted
            ? 'Issued invoices are immutable. Void to reverse an unpaid invoice.'
            : 'Build a draft, then issue to post it to the ledger.'
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/invoices">Back to invoices</Link>
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
        {invoiceId && !invoice && !error ? <Skeleton /> : null}

        <section className="rb-invoice-detail" aria-label="Invoice">
          <Card className="rb-invoice-detail__hero">
            <header className="rb-invoice-detail__hero-head">
              <div className="rb-invoice-detail__hero-id">
                <span className="rb-invoice-editor__heading-icon">
                  <ReceiptText aria-hidden="true" />
                </span>
                <div>
                  <p>
                    {invoice?.invoiceNumber
                      ? `Invoice ${invoice.invoiceNumber}`
                      : invoiceId
                        ? 'Invoice draft'
                        : 'New invoice'}
                  </p>
                  <span>
                    {contact ? `Billed to ${contact.displayName}` : 'Choose a customer to begin.'}
                  </span>
                </div>
              </div>
              <div className="rb-invoice-detail__hero-actions">
                {invoice ? (
                  <StatusBadge status={invoice.status} />
                ) : (
                  <span className="rb-invoice-editor__draft">Draft</span>
                )}
                {editable ? (
                  <Button
                    type="button"
                    onClick={() => void saveDraft()}
                    loading={busy === 'save'}
                    disabled={!contactId}
                  >
                    <Save aria-hidden="true" /> Save draft
                  </Button>
                ) : null}
                {invoice?.status === 'DRAFT' && canIssue ? (
                  <Button
                    type="button"
                    onClick={() => void issueInvoice()}
                    loading={busy === 'issue'}
                  >
                    <CheckCircle2 aria-hidden="true" /> Issue
                  </Button>
                ) : null}
                {canSendNow ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void sendInvoice()}
                    loading={busy === 'send'}
                  >
                    <Mail aria-hidden="true" /> Send
                  </Button>
                ) : null}
                {canVoidNow ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void voidInvoice()}
                    loading={busy === 'void'}
                  >
                    <XCircle aria-hidden="true" /> Void
                  </Button>
                ) : null}
              </div>
            </header>

            <dl className="rb-invoice-detail__metrics">
              <div>
                <dt>Amount</dt>
                <dd className="rb-num">
                  {invoice && invoice.status !== 'DRAFT'
                    ? formatMinor(invoice.totalMinor, currency)
                    : formatMinor(subtotalPreviewMinor.toString(), currency)}
                </dd>
              </div>
              <div>
                <dt>Balance due</dt>
                <dd className={`rb-num${invoice?.status === 'OVERDUE' ? ' is-risk' : ''}`}>
                  {invoice && invoice.status !== 'DRAFT'
                    ? formatMinor(invoice.balanceMinor, currency)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Due date</dt>
                <dd>{formatInvoiceDate(invoice?.dueDate ?? dueDate)}</dd>
              </div>
            </dl>
          </Card>

          <div className="rb-invoice-detail__panels">
            <Card className="rb-invoice-detail__panel rb-invoice-detail__panel-bill">
              <h2>Bill to</h2>
              {editable ? (
                <div className="rb-field">
                  <Label htmlFor="invoice-customer">Customer</Label>
                  <Select
                    id="invoice-customer"
                    value={contactId}
                    onChange={(event) => selectCustomer(event.target.value)}
                  >
                    <option value="">Choose customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.displayName}
                      </option>
                    ))}
                    <option value={NEW_CUSTOMER_VALUE}>＋ Add new customer</option>
                  </Select>
                </div>
              ) : (
                <p className="rb-invoice-detail__contact">{invoice?.contactName}</p>
              )}
            </Card>

            <Card className="rb-invoice-detail__panel rb-invoice-detail__panel-dates">
              <h2>Invoice details</h2>
              <dl className="rb-invoice-detail__meta">
                <div>
                  <dt>Issue date</dt>
                  <dd>{invoice?.issueDate ? formatInvoiceDate(invoice.issueDate) : '—'}</dd>
                </div>
                <div>
                  <dt>Due date</dt>
                  <dd>
                    {editable ? (
                      <Input
                        aria-label="Due date"
                        type="date"
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                      />
                    ) : (
                      formatInvoiceDate(invoice?.dueDate ?? dueDate)
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Currency</dt>
                  <dd>{currency}</dd>
                </div>
              </dl>
            </Card>

            <Card className="rb-invoice-detail__panel rb-invoice-detail__panel-summary">
              <h2>Summary</h2>
              <dl className="rb-invoice-detail__summary">
                <div>
                  <dt>Subtotal</dt>
                  <dd className="rb-num">
                    {invoice && invoice.status !== 'DRAFT'
                      ? formatMinor(invoice.subtotalMinor, currency)
                      : formatMinor(subtotalPreviewMinor.toString(), currency)}
                  </dd>
                </div>
                <div>
                  <dt>Tax</dt>
                  <dd className="rb-num">
                    {invoice && invoice.status !== 'DRAFT'
                      ? formatMinor(invoice.taxTotalMinor, currency)
                      : 'Calculated on issue'}
                  </dd>
                </div>
                <div className="rb-invoice-detail__total-row">
                  <dt>Total</dt>
                  <dd className="rb-num">
                    {invoice && invoice.status !== 'DRAFT'
                      ? formatMinor(invoice.totalMinor, currency)
                      : formatMinor(subtotalPreviewMinor.toString(), currency)}
                  </dd>
                </div>
                {invoice && invoice.status !== 'DRAFT' ? (
                  <div>
                    <dt>Paid</dt>
                    <dd className="rb-num">{formatMinor(invoice.paidMinor, currency)}</dd>
                  </div>
                ) : null}
                {invoice && invoice.status !== 'DRAFT' ? (
                  <div className="rb-invoice-detail__total-row">
                    <dt>Balance due</dt>
                    <dd className={`rb-num${invoice.status === 'OVERDUE' ? ' is-risk' : ''}`}>
                      {formatMinor(invoice.balanceMinor, currency)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          </div>

          <Card className="rb-invoice-detail__items">
            <section className="rb-invoice-editor__items" aria-labelledby="invoice-items-heading">
              <header className="rb-invoice-editor__section-heading">
                <div>
                  <p id="invoice-items-heading">Line items</p>
                  <span>Select a product or service from your active catalog.</span>
                </div>
                {editable ? (
                  <Button type="button" variant="outline" size="sm" onClick={addLine}>
                    <FilePlus2 aria-hidden="true" /> Add row
                  </Button>
                ) : null}
              </header>

              <div className="rb-invoice-lines" role="table" aria-label="Invoice lines">
                <div className="rb-invoice-lines__head" role="row">
                  <span>Item details</span>
                  <span>Qty</span>
                  <span>Rate</span>
                  <span>Discount</span>
                  <span>Tax</span>
                  <span>Amount</span>
                  <span />
                </div>
                {lines.map((line, index) => {
                  const item = items.find((candidate) => candidate.id === line.itemId);
                  const lineTotalMinor = previewLineTotalMinor(
                    line.quantity,
                    line.unitPrice,
                    line.discount,
                  );
                  return (
                    <div className="rb-invoice-lines__row" role="row" key={line.key}>
                      <div className="rb-invoice-lines__item-detail">
                        <Select
                          aria-label={`Product or service for line ${index + 1}`}
                          value={line.itemId}
                          disabled={!editable}
                          onChange={(event) => selectItem(line.key, event.target.value)}
                        >
                          <option value="">Select product or service</option>
                          {items.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.sku
                                ? `${candidate.sku} ${candidate.name}`
                                : candidate.name}
                            </option>
                          ))}
                          <option value={NEW_CATALOG_ITEM_VALUE}>
                            ＋ Add new product or service
                          </option>
                        </Select>
                        <Input
                          aria-label={`Description for line ${index + 1}`}
                          value={line.description}
                          disabled={!editable || Boolean(item && !item.freeDescriptionAllowed)}
                          onChange={(event) =>
                            updateLine(line.key, { description: event.target.value })
                          }
                          placeholder="Add a description"
                        />
                      </div>
                      <Input
                        aria-label={`Quantity for line ${index + 1}`}
                        inputMode="decimal"
                        value={line.quantity}
                        disabled={!editable}
                        onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      />
                      <Input
                        aria-label={`Unit price for line ${index + 1}`}
                        inputMode="decimal"
                        value={line.unitPrice}
                        disabled={!editable}
                        onChange={(event) =>
                          updateLine(line.key, { unitPrice: event.target.value })
                        }
                      />
                      <Input
                        aria-label={`Discount for line ${index + 1}`}
                        inputMode="decimal"
                        value={line.discount}
                        disabled={!editable}
                        onChange={(event) => updateLine(line.key, { discount: event.target.value })}
                      />
                      <Select
                        aria-label={`Tax code for line ${index + 1}`}
                        value={line.taxCodeId}
                        disabled={!editable}
                        onChange={(event) =>
                          updateLine(line.key, { taxCodeId: event.target.value })
                        }
                      >
                        <option value="">No tax</option>
                        {taxCodes.map((code) => (
                          <option key={code.id} value={code.id}>
                            {code.code}
                          </option>
                        ))}
                      </Select>
                      <span className="rb-invoice-lines__amount rb-num">
                        {formatMinor(lineTotalMinor.toString(), currency)}
                      </span>
                      {editable ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          onClick={() => removeLine(line.key)}
                          aria-label={`Remove line ${index + 1}`}
                        >
                          <XCircle aria-hidden="true" />
                        </Button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </Card>

          {editable ? (
            <footer className="rb-invoice-editor__actionbar">
              <span>
                {contact
                  ? `Billing ${contact.displayName}`
                  : 'Choose a customer to save this draft.'}
              </span>
              <div className="rb-dialog-footer">
                <Button
                  type="button"
                  onClick={() => void saveDraft()}
                  loading={busy === 'save'}
                  disabled={!contactId}
                >
                  <Save aria-hidden="true" /> Save draft
                </Button>
              </div>
            </footer>
          ) : (
            <footer className="rb-invoice-detail__status-line">
              <span>Issued to {invoice?.contactName}.</span>
              <span>
                Posted transactions are immutable — corrections use a credit note or reversal.
              </span>
            </footer>
          )}
          {!contactId && editable ? (
            <FieldMessage error>Choose a customer before saving this invoice.</FieldMessage>
          ) : null}
        </section>
        {organizationId && invoiceId ? (
          <TransactionCollaboration
            organizationId={organizationId}
            targetType="INVOICE"
            targetId={invoiceId}
            canComment={hasPermission(organization, 'collaboration.comments.create')}
            canUpload={
              hasPermission(organization, 'collaboration.attachments.upload') &&
              hasPermission(organization, 'sales.invoices.manage')
            }
            canShareWithCustomer={hasPermission(
              organization,
              'collaboration.customer_visibility.manage',
            )}
            customerEligible
          />
        ) : null}
      </div>
      <CustomerDialog
        open={customerDialogOpen}
        onOpenChange={setCustomerDialogOpen}
        organizationId={organizationId}
        baseCurrency={organization?.baseCurrency ?? 'KES'}
        canOverrideCurrency={hasPermission(organization, 'customers.currency_override')}
        onSaved={(customer) => {
          setCustomers((current) =>
            [...current, customer].sort((left, right) =>
              left.displayName.localeCompare(right.displayName),
            ),
          );
          setContactId(customer.id);
          setNotice(`${customer.displayName} was added and selected for this invoice.`);
        }}
      />
      <ItemDialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        organizationId={organizationId}
        currency={currency}
        onSaved={(item) => {
          setItems((current) =>
            [...current, item].sort((left, right) => left.name.localeCompare(right.name)),
          );
          const availableLine = lines.find((line) => !line.itemId);
          if (availableLine) selectItem(availableLine.key, item.id);
          setNotice(`${item.name} was added to your catalog and selected for this invoice.`);
        }}
      />
    </>
  );
}

function previewLineTotalMinor(quantity: string, unitPrice: string, discount: string): bigint {
  const quantityMinor = BigInt(decimalToMinor(quantity || '0', 4));
  const unitPriceMinor = BigInt(decimalToMinor(unitPrice || '0'));
  const discountMinor = BigInt(decimalToMinor(discount || '0'));
  const gross = (quantityMinor * unitPriceMinor) / 10_000n;
  const total = gross - discountMinor;
  return total > 0n ? total : 0n;
}

function decimalToMinor(value: string, scale = 2): string {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return '0';
  const [whole = '0', fraction = ''] = normalized.split('.');
  return `${whole}${fraction.padEnd(scale, '0').slice(0, scale)}`.replace(/^0+(?=\d)/, '');
}

function minorToDecimal(value: string): string {
  const amount = BigInt(value);
  const whole = amount / 100n;
  const cents = amount % 100n;
  return `${whole}.${cents.toString().padStart(2, '0')}`;
}
