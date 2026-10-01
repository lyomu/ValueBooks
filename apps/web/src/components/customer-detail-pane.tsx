'use client';

import type {
  Contact,
  CustomerActivityEntry,
  CustomerMailEntry,
  CustomerSummary,
  CustomerTransactions,
} from '@valuebooks/contracts';
import { Badge, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '@valuebooks/ui';
import {
  ChevronDown,
  FileClock,
  FileText,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Receipt,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { apiRequest } from '../lib/api';
import { formatMinor } from '../lib/money';
import { CustomerStatementPage } from './customer-statement';
import { RecordPaymentDialog } from './record-payment-dialog';
import { TransactionCollaboration } from './transaction-collaboration';

type TransactionsResponse = { data: CustomerTransactions };
type SummaryResponse = { data: CustomerSummary };
type ActivityResponse = { data: CustomerActivityEntry[] };
type MailsResponse = { data: CustomerMailEntry[] };

export type CustomerPermissions = {
  canManage: boolean;
  canViewStatements: boolean;
  canViewInvoices: boolean;
  canRecordPayment: boolean;
  canAllocatePayment: boolean;
  canComment: boolean;
};

const EMPTY_TRANSACTIONS: CustomerTransactions = {
  invoices: [],
  quotes: [],
  salesOrders: [],
  creditNotes: [],
  payments: [],
};

/**
 * The toolbar that sits on the title line of the customer workspace header.
 *
 * It lives apart from the pane because the header row belongs to `RecordDetailWorkspace`, not to
 * the pane body -- the reference puts Edit / New Transaction / More beside the customer's name
 * rather than on a row of their own.
 */
export function CustomerToolbar({
  customer,
  permissions,
  onEdit,
  onSetStatus,
  onRecordPayment,
}: {
  customer: Contact;
  permissions: CustomerPermissions;
  onEdit: () => void;
  onSetStatus: (status: 'ACTIVE' | 'INACTIVE') => void;
  onRecordPayment: () => void;
}) {
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  return (
    <div className="rb-customer-toolbar" role="toolbar" aria-label="Customer actions">
      {permissions.canManage ? (
        <button type="button" className="rb-customer-toolbar__button" onClick={onEdit}>
          <Pencil aria-hidden="true" />
          <span>Edit</span>
        </button>
      ) : null}

      <ToolbarMenu
        label="New Transaction"
        icon={Plus}
        primary
        open={newMenuOpen}
        onOpenChange={setNewMenuOpen}
      >
        {(close) => (
          <>
            <MenuItem
              icon={FileText}
              label="Invoice"
              href={`/invoices/new?contactId=${customer.id}`}
              onSelect={close}
            />
            <MenuItem
              icon={FileText}
              label="Quote"
              href={`/quotes/new?contactId=${customer.id}`}
              onSelect={close}
            />
            <MenuItem
              icon={FileText}
              label="Sales order"
              href={`/sales-orders/new?contactId=${customer.id}`}
              onSelect={close}
            />
            {permissions.canRecordPayment ? (
              <MenuItem
                icon={Receipt}
                label="Payment"
                onSelect={() => {
                  close();
                  onRecordPayment();
                }}
              />
            ) : null}
          </>
        )}
      </ToolbarMenu>

      <ToolbarMenu
        label="More"
        icon={ChevronDown}
        open={moreMenuOpen}
        onOpenChange={setMoreMenuOpen}
      >
        {(close) => (
          <>
            {permissions.canViewStatements ? (
              <MenuItem
                icon={FileClock}
                label="Open full statement"
                href={`/dashboard/customers/${customer.id}/statement`}
                onSelect={close}
              />
            ) : null}
            {permissions.canManage ? (
              <MenuItem
                icon={UserX}
                label={customer.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                danger={customer.status === 'ACTIVE'}
                onSelect={() => {
                  close();
                  onSetStatus(customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE');
                }}
              />
            ) : null}
          </>
        )}
      </ToolbarMenu>
    </div>
  );
}

/**
 * The customer workspace body: five tabs over a split Overview.
 *
 * Overview is two independently scrolling columns, as in the reference -- the left holds the
 * record's standing facts in one sectioned panel, the right holds its money and its history, with
 * the activity timeline inline rather than hidden behind a tab nobody opens.
 */
export function CustomerDetailPane({
  customer,
  organizationId,
  permissions,
  recordingPayment,
  onRecordingPaymentChange,
}: {
  customer: Contact;
  organizationId: string;
  permissions: CustomerPermissions;
  recordingPayment: boolean;
  onRecordingPaymentChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState('overview');
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [transactions, setTransactions] = useState<CustomerTransactions | null>(null);
  const [activity, setActivity] = useState<CustomerActivityEntry[] | null>(null);
  const [mails, setMails] = useState<CustomerMailEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Switching customer clears every cache: showing the previous customer's invoices under a new
  // name, even for a frame, is worse than showing a loading state.
  useEffect(() => {
    setTab('overview');
    setSummary(null);
    setTransactions(null);
    setActivity(null);
    setMails(null);
    setError(null);
  }, [customer.id]);

  const base = `/organizations/${organizationId}/customers/${customer.id}`;

  const loadSummary = useCallback(async () => {
    try {
      const response = await apiRequest<SummaryResponse>(`${base}/summary`);
      setSummary(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The summary could not be loaded.');
    }
  }, [base]);

  const loadActivity = useCallback(async () => {
    try {
      const response = await apiRequest<ActivityResponse>(`${base}/activity`);
      setActivity(response.data);
    } catch {
      setActivity([]);
    }
  }, [base]);

  // The Overview carries both, so they load together with the tab rather than on demand.
  useEffect(() => {
    void loadSummary();
    void loadActivity();
  }, [loadSummary, loadActivity]);

  useEffect(() => {
    if (tab !== 'transactions' || transactions) return;
    void (async () => {
      try {
        const response = await apiRequest<TransactionsResponse>(`${base}/transactions`);
        setTransactions(response.data);
      } catch {
        setTransactions(EMPTY_TRANSACTIONS);
      }
    })();
  }, [tab, transactions, base]);

  useEffect(() => {
    if (tab !== 'mails' || mails) return;
    void (async () => {
      try {
        const response = await apiRequest<MailsResponse>(`${base}/mails`);
        setMails(response.data);
      } catch {
        setMails([]);
      }
    })();
  }, [tab, mails, base]);

  const billing = customer.addresses.find((address) => address.kind === 'BILLING') ?? null;
  const shipping = customer.addresses.find((address) => address.kind === 'SHIPPING') ?? null;
  const currency = summary?.currency ?? customer.currency;

  return (
    <div className="rb-customer-pane">
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="rb-customer-tabs">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="comments">Comments</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="mails">Mails</TabsTrigger>
          {permissions.canViewStatements ? (
            <TabsTrigger value="statement">Statement</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="overview">
          <div className="rb-customer-split">
            <aside className="rb-customer-facts">
              <div className="rb-customer-identity">
                <span className="rb-customer-identity__avatar" aria-hidden="true">
                  {customer.displayName.charAt(0).toUpperCase()}
                </span>
                <div>
                  <strong>{customer.displayName}</strong>
                  <span>{customer.email ?? 'No email on file'}</span>
                </div>
                <StatusBadge status={customer.status} />
              </div>

              <FactSection title="Address">
                <AddressBlock label="Billing address" address={billing} />
                <AddressBlock label="Shipping address" address={shipping} />
              </FactSection>

              <FactSection title="Other details">
                <FactRow label="Customer type" value={titleCase(customer.type)} />
                <FactRow label="Default currency" value={customer.currency} />
                <FactRow
                  label="Payment terms"
                  value={
                    customer.paymentTermsDays === null
                      ? 'Due on receipt'
                      : `Net ${customer.paymentTermsDays} days`
                  }
                />
                <FactRow
                  label="Tags"
                  value={customer.tags.length > 0 ? customer.tags.join(', ') : 'None'}
                />
              </FactSection>

              <FactSection title="Contact details">
                <FactRow label="Email" value={customer.email ?? 'Not provided'} />
                <FactRow label="Phone" value={customer.phone ?? 'Not provided'} />
                {customer.legalName ? (
                  <FactRow label="Legal name" value={customer.legalName} />
                ) : null}
                {customer.taxIds.length > 0
                  ? customer.taxIds.map((taxId) => (
                      <FactRow key={taxId.id} label={taxId.label} value={taxId.value} />
                    ))
                  : null}
              </FactSection>

              <FactSection title="Record info" collapsible defaultOpen={false}>
                <FactRow label="Created" value={formatDateTime(customer.createdAt)} />
                <FactRow label="Last updated" value={formatDateTime(customer.updatedAt)} />
              </FactSection>
            </aside>

            <div className="rb-customer-money">
              <div className="rb-customer-money__lead">
                <span>Payment due period</span>
                <strong>
                  {customer.paymentTermsDays === null
                    ? 'Due on receipt'
                    : `Net ${customer.paymentTermsDays} days`}
                </strong>
              </div>

              <section>
                <h2 className="rb-customer-money__heading">Receivables</h2>
                {summary ? (
                  <>
                    <div className="rb-table-scroll">
                      <table className="rb-table rb-customer-receivables">
                        <thead>
                          <tr>
                            <th>Currency</th>
                            <th className="rb-table--right">Outstanding</th>
                            <th className="rb-table--right">Unused credits</th>
                            <th className="rb-table--right">Unapplied payments</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>{currency}</td>
                            <td className="rb-table--right rb-num">
                              {formatMinor(summary.outstandingMinor, currency)}
                            </td>
                            <td className="rb-table--right rb-num">
                              {formatMinor(summary.unusedCreditsMinor, currency)}
                            </td>
                            <td className="rb-table--right rb-num">
                              {formatMinor(summary.unappliedPaymentsMinor, currency)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="rb-customer-money__note">
                      Across {summary.openInvoiceCount}{' '}
                      {summary.openInvoiceCount === 1 ? 'open invoice' : 'open invoices'}.
                    </p>
                    <AgingBar aging={summary.aging} currency={currency} />
                  </>
                ) : (
                  <p className="rb-customer-hint">Loading receivables…</p>
                )}
              </section>

              <section>
                <h2 className="rb-customer-money__heading">Activity</h2>
                {!activity ? (
                  <p className="rb-customer-hint">Loading activity…</p>
                ) : activity.length === 0 ? (
                  <p className="rb-customer-hint">
                    Nothing has happened on this customer yet. Activity from their invoices,
                    payments and credit notes will appear here.
                  </p>
                ) : (
                  <ol className="rb-customer-timeline">
                    {activity.map((entry) => (
                      <li key={entry.id} className="rb-customer-timeline__item">
                        <div className="rb-customer-timeline__when">
                          <span>{formatDate(entry.occurredAt)}</span>
                          <span className="rb-customer-timeline__time">
                            {formatTime(entry.occurredAt)}
                          </span>
                        </div>
                        <span className="rb-customer-timeline__node" aria-hidden="true">
                          <MessageSquare />
                        </span>
                        <div className="rb-customer-timeline__card">
                          <strong>{describeEventKey(entry.eventKey)}</strong>
                          <span className="rb-customer-timeline__meta">
                            {titleCase(entry.targetType)}
                            {entry.actorName ? ` · by ${entry.actorName}` : null}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="comments">
          <div className="rb-customer-tabpanel">
            <TransactionCollaboration
              organizationId={organizationId}
              targetType="CONTACT"
              targetId={customer.id}
              canComment={permissions.canComment}
              canUpload={permissions.canManage}
              canShareWithCustomer={false}
            />
          </div>
        </TabsContent>

        <TabsContent value="transactions">
          <div className="rb-customer-tabpanel">
            {!transactions ? (
              <p className="rb-customer-hint">Loading transactions…</p>
            ) : (
              <div className="rb-customer-tables">
                <TransactionTable
                  title="Invoices"
                  columns={['Date', 'Number', 'Amount', 'Balance due', 'Status']}
                  rows={transactions.invoices.map((row) => ({
                    id: row.id,
                    href: permissions.canViewInvoices ? `/invoices/${row.id}` : undefined,
                    cells: [
                      row.date ?? '—',
                      row.number ?? 'Draft',
                      formatMinor(row.totalMinor, row.currency),
                      formatMinor(row.balanceMinor, row.currency),
                      <StatusBadge key="s" status={row.status} />,
                    ],
                  }))}
                />
                <TransactionTable
                  title="Payments"
                  columns={['Date', 'Number', 'Mode', 'Amount', 'Unapplied']}
                  rows={transactions.payments.map((row) => ({
                    id: row.id,
                    href: `/payments/${row.id}`,
                    cells: [
                      row.date ?? '—',
                      row.number ?? 'Payment',
                      titleCase(row.paymentMode),
                      formatMinor(row.amountMinor, row.currency),
                      formatMinor(row.unappliedMinor, row.currency),
                    ],
                  }))}
                />
                <TransactionTable
                  title="Credit notes"
                  columns={['Date', 'Number', 'Amount', 'Remaining', 'Status']}
                  rows={transactions.creditNotes.map((row) => ({
                    id: row.id,
                    href: `/credit-notes/${row.id}`,
                    cells: [
                      row.date ?? '—',
                      row.number ?? 'Draft',
                      formatMinor(row.totalMinor, row.currency),
                      formatMinor(row.remainingMinor, row.currency),
                      <StatusBadge key="s" status={row.status} />,
                    ],
                  }))}
                />
                <TransactionTable
                  title="Quotes"
                  columns={['Date', 'Number', 'Amount', 'Status']}
                  rows={transactions.quotes.map((row) => ({
                    id: row.id,
                    href: `/quotes/${row.id}`,
                    cells: [
                      row.date ?? '—',
                      row.number ?? 'Draft',
                      formatMinor(row.totalMinor, row.currency),
                      <StatusBadge key="s" status={row.status} />,
                    ],
                  }))}
                />
                <TransactionTable
                  title="Sales orders"
                  columns={['Date', 'Number', 'Amount', 'Status']}
                  rows={transactions.salesOrders.map((row) => ({
                    id: row.id,
                    href: `/sales-orders/${row.id}`,
                    cells: [
                      row.date ?? '—',
                      row.number ?? 'Draft',
                      formatMinor(row.totalMinor, row.currency),
                      <StatusBadge key="s" status={row.status} />,
                    ],
                  }))}
                />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="mails">
          <div className="rb-customer-tabpanel">
            {!mails ? (
              <p className="rb-customer-hint">Loading mails…</p>
            ) : mails.length === 0 ? (
              <p className="rb-customer-hint">
                No documents have been emailed to this customer yet.
              </p>
            ) : (
              <ol className="rb-customer-mails">
                {mails.map((mail) => (
                  <li key={mail.id} className="rb-customer-mails__item">
                    <Mail aria-hidden="true" />
                    <div>
                      <strong>{mail.subject}</strong>
                      <span className="rb-customer-mails__meta">
                        To {mail.recipientEmail} · {formatDateTime(mail.sentAt)}
                        {mail.sentByName ? ` · by ${mail.sentByName}` : null}
                      </span>
                    </div>
                    {mail.documentNumber ? <Badge tone="info">{mail.documentNumber}</Badge> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </TabsContent>

        {permissions.canViewStatements ? (
          <TabsContent value="statement">
            <div className="rb-customer-tabpanel">
              <CustomerStatementPage contactId={customer.id} />
            </div>
          </TabsContent>
        ) : null}
      </Tabs>

      <RecordPaymentDialog
        open={recordingPayment}
        onOpenChange={onRecordingPaymentChange}
        organizationId={organizationId}
        baseCurrency={customer.currency}
        canAllocate={permissions.canAllocatePayment}
        seed={{ contactId: customer.id, lockCustomer: true }}
        onRecorded={() => {
          void loadSummary();
          void loadActivity();
          setTransactions(null);
        }}
      />
    </div>
  );
}

/** A labelled band in the left-hand facts panel, optionally collapsible like the reference. */
function FactSection({
  title,
  children,
  collapsible,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;

  return (
    <section className="rb-customer-facts__section">
      {collapsible ? (
        <button
          type="button"
          className="rb-customer-facts__heading"
          aria-expanded={isOpen}
          onClick={() => setOpen(!open)}
        >
          <span>{title}</span>
          <ChevronDown aria-hidden="true" data-open={isOpen || undefined} />
        </button>
      ) : (
        <h2 className="rb-customer-facts__heading">
          <span>{title}</span>
        </h2>
      )}
      {isOpen ? <div className="rb-customer-facts__body">{children}</div> : null}
    </section>
  );
}

function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rb-customer-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AddressBlock({
  label,
  address,
}: {
  label: string;
  address: Contact['addresses'][number] | null;
}) {
  return (
    <div className="rb-customer-address">
      <span>{label}</span>
      {address ? (
        <address>
          {[address.line1, address.line2, address.city, address.region, address.postalCode]
            .filter(Boolean)
            .join(', ')}
          {address.countryCode ? `, ${address.countryCode}` : null}
        </address>
      ) : (
        <p className="rb-customer-hint">Not provided</p>
      )}
    </div>
  );
}

/** Aging split as one proportional bar, so the shape of the debt reads before the numbers do. */
function AgingBar({ aging, currency }: { aging: CustomerSummary['aging']; currency: string }) {
  const segments = useMemo(
    () =>
      [
        { key: 'current', label: 'Current', value: BigInt(aging.current) },
        { key: 'days1To30', label: '1–30 days', value: BigInt(aging.days1To30) },
        { key: 'days31To60', label: '31–60 days', value: BigInt(aging.days31To60) },
        { key: 'days61To90', label: '61–90 days', value: BigInt(aging.days61To90) },
        { key: 'days90Plus', label: '90+ days', value: BigInt(aging.days90Plus) },
      ] as const,
    [aging],
  );
  const total = segments.reduce((sum, segment) => sum + segment.value, 0n);
  if (total === 0n) return <p className="rb-customer-hint">Nothing outstanding.</p>;

  return (
    <div className="rb-customer-aging">
      <div className="rb-customer-aging__bar" role="img" aria-label="Receivables by age">
        {segments
          .filter((segment) => segment.value > 0n)
          .map((segment) => (
            <span
              key={segment.key}
              className="rb-customer-aging__segment"
              data-bucket={segment.key}
              style={{ flexGrow: Number((segment.value * 1000n) / total) }}
            />
          ))}
      </div>
      <ul className="rb-customer-aging__legend">
        {segments.map((segment) => (
          <li key={segment.key}>
            <span
              className="rb-customer-aging__swatch"
              data-bucket={segment.key}
              aria-hidden="true"
            />
            <span>{segment.label}</span>
            <strong className="rb-num">{formatMinor(segment.value.toString(), currency)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TransactionTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: readonly string[];
  rows: readonly { id: string; href?: string; cells: readonly ReactNode[] }[];
}) {
  return (
    <section className="rb-customer-table-block">
      <h2 className="rb-customer-money__heading">{title}</h2>
      {rows.length === 0 ? (
        <p className="rb-customer-hint">Nothing recorded yet.</p>
      ) : (
        <div className="rb-table-scroll">
          <table className="rb-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, index) => (
                    <td key={index}>
                      {index === 1 && row.href ? <Link href={row.href}>{cell}</Link> : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** One row inside a toolbar dropdown. Renders a link when `href` is set, otherwise a button. */
function MenuItem({
  icon: Icon,
  label,
  href,
  onSelect,
  danger,
}: {
  icon: typeof FileText;
  label: string;
  href?: string;
  onSelect?: () => void;
  danger?: boolean;
}) {
  const className = `rb-customer-toolbar__item${danger ? ' is-danger' : ''}`;
  const content = (
    <>
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </>
  );
  if (href) {
    return (
      <Link className={className} href={href} onClick={onSelect}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={onSelect}>
      {content}
    </button>
  );
}

function ToolbarMenu({
  label,
  icon: Icon,
  primary,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  icon: typeof FileText;
  primary?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // A click anywhere else, or Escape, closes the menu -- the toolbar sits above a scrolling pane,
  // so leaving an orphaned menu floating over the content is easy to do otherwise.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div className="rb-customer-toolbar__menu" ref={ref}>
      <button
        type="button"
        className="rb-customer-toolbar__button"
        data-primary={primary || undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!open)}
      >
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open ? (
        <div className="rb-customer-toolbar__dropdown" role="menu">
          {children(() => onOpenChange(false))}
        </div>
      ) : null}
    </div>
  );
}

/** `sales.invoice_sent` -> "Invoice sent". Keys are a stable namespace, so this needs no table. */
function describeEventKey(eventKey: string): string {
  const tail = eventKey.split('.').pop() ?? eventKey;
  return titleCase(tail);
}

/** `PAYMENT_RECEIVED` / `bank_transfer` -> "Payment received" / "Bank transfer". */
function titleCase(value: string): string {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}
