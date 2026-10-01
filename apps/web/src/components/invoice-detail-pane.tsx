'use client';

import type { Invoice } from '@valuebooks/contracts';
import {
  AlarmClock,
  AlarmClockOff,
  Ban,
  Banknote,
  BookOpen,
  CalendarClock,
  Check,
  ChevronDown,
  Copy,
  FileMinus,
  FileText,
  Mail,
  MoreHorizontal,
  Package,
  Pencil,
  Printer,
  Repeat,
  Send,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
  Truck,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button, Dialog, DialogContent, Input, Label } from '@valuebooks/ui';

import { ApiError, apiRequest } from '../lib/api';
import { InvoiceDocument, type InvoiceDocumentVariant } from './invoice-document';
import { daysOverdue, formatInvoiceDate, formatMinor, minorToDecimal } from './invoice-format';
import { saveInvoiceSeed, type InvoiceSeed } from './invoice-seed';
import { RecordPaymentDialog } from './record-payment-dialog';

type InvoiceResponse = { data: Invoice };

export type InvoicePermissions = {
  canManage: boolean;
  canIssue: boolean;
  canVoid: boolean;
  canSend: boolean;
  canRecordPayment: boolean;
  canAllocatePayment: boolean;
  canCreateCreditNote: boolean;
  canManageRecurring: boolean;
  canViewNumbering: boolean;
};

/** One row inside a toolbar dropdown. Renders a link when `href` is set, otherwise a button. */
function MenuItem({
  icon: Icon,
  label,
  href,
  onSelect,
  disabled,
  danger,
  title,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  const className = `rb-invoice-toolbar__item${danger ? ' is-danger' : ''}`;
  const content = (
    <>
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </>
  );
  if (href && !disabled) {
    return (
      <Link className={className} href={href} role="menuitem" onClick={onSelect}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      className={className}
      disabled={disabled}
      title={title}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

/** Toolbar button that opens a small dropdown and closes on outside click or Escape. */
function ToolbarMenu({
  icon: Icon,
  label,
  ariaLabel,
  children,
}: {
  icon: LucideIcon;
  label?: string;
  ariaLabel?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="rb-invoice-toolbar__menu" ref={root}>
      <button
        type="button"
        className="rb-invoice-toolbar__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon aria-hidden="true" />
        {label ? <span>{label}</span> : null}
        {label ? <ChevronDown className="rb-invoice-toolbar__chevron" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="rb-invoice-toolbar__popover" role="menu">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** Zoho-style single-invoice pane: action toolbar, "what's next" banner, and the paper document. */
export function InvoiceDetailPane({
  invoice,
  organizationId,
  organizationName,
  permissions,
  onChanged,
  onDeleted,
}: {
  invoice: Invoice;
  organizationId: string;
  organizationName: string;
  permissions: InvoicePermissions;
  onChanged: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'issue' | 'void' | 'send' | 'clone' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printVariant, setPrintVariant] = useState<InvoiceDocumentVariant>('invoice');
  const [dialog, setDialog] = useState<'expected-date' | 'write-off' | null>(null);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [expectedDate, setExpectedDate] = useState('');
  const [writeOffAmount, setWriteOffAmount] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Reset transient feedback when a different invoice is selected.
  useEffect(() => {
    setError(null);
    setNotice(null);
    setPrintVariant('invoice');
    setDialog(null);
    setRecordingPayment(false);
  }, [invoice.id]);

  // Delivery notes and packing slips reuse the paper: swap the variant, print, then swap back.
  useEffect(() => {
    if (printVariant === 'invoice') return;
    const reset = () => setPrintVariant('invoice');
    window.addEventListener('afterprint', reset, { once: true });
    const frame = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', reset);
    };
  }, [printVariant]);

  const isDraft = invoice.status === 'DRAFT';
  const isVoid = invoice.status === 'VOID';
  const isPaid = invoice.status === 'PAID';
  const hasBalance = BigInt(invoice.balanceMinor) > 0n;
  const overdueDays = daysOverdue(invoice.dueDate, invoice.balanceMinor, invoice.status);
  const canSendNow = !isDraft && !isVoid && permissions.canSend;
  const canRecordNow = !isDraft && !isVoid && hasBalance && permissions.canRecordPayment;
  const canVoidNow =
    (invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID') &&
    invoice.paidMinor === '0' &&
    permissions.canVoid;
  const canIssueNow = isDraft && permissions.canIssue;
  const canDeleteNow = isDraft && permissions.canManage;
  const isOpen = invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID';
  const remindersStopped = Boolean(invoice.remindersStoppedAt);
  const canWriteOffNow = isOpen && hasBalance && permissions.canVoid;
  const canSetExpectedDate = isOpen && permissions.canManage;
  const writtenOff = BigInt(invoice.writtenOffMinor) > 0n;

  function seedFromInvoice(extra: Partial<InvoiceSeed> = {}): InvoiceSeed {
    return {
      contactId: invoice.contactId,
      lines: [...invoice.lines]
        .sort((a, b) => a.lineNumber - b.lineNumber)
        .map((line) => ({
          itemId: line.itemId,
          description: line.descriptionSnapshot,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          discountMinor: line.discountMinor,
          taxCodeId: line.taxCodeId,
        })),
      ...extra,
    };
  }

  async function run(
    action: 'issue' | 'void' | 'send',
    success: string,
    failure: string,
    init: RequestInit,
  ) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await apiRequest<InvoiceResponse>(
        `/organizations/${organizationId}/invoices/${invoice.id}/${action}`,
        init,
      );
      setNotice(success);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : failure);
    } finally {
      setBusy(null);
    }
  }

  const sendInvoice = () =>
    run('send', 'Invoice sent.', 'The invoice could not be sent.', { method: 'POST' });
  const issueInvoice = () =>
    run('issue', 'Invoice issued.', 'The invoice could not be issued.', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  const voidInvoice = () => {
    if (!window.confirm('Void this invoice? Its journal entry will be reversed.')) return;
    void run('void', 'Invoice voided.', 'The invoice could not be voided.', { method: 'POST' });
  };

  async function cloneInvoice() {
    setBusy('clone');
    setError(null);
    setNotice(null);
    try {
      const response = await apiRequest<InvoiceResponse>(`/organizations/${organizationId}/invoices`, {
        method: 'POST',
        body: JSON.stringify({
          contactId: invoice.contactId,
          currency: invoice.currency,
          lines: seedFromInvoice().lines.map((line) => ({
            itemId: line.itemId ?? undefined,
            description: line.itemId ? undefined : line.description,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            discountMinor: line.discountMinor === '0' ? undefined : line.discountMinor,
            taxCodeId: line.taxCodeId ?? undefined,
          })),
        }),
      });
      router.push(`/invoices/${response.data.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The invoice could not be cloned.');
      setBusy(null);
    }
  }

  async function deleteInvoice() {
    if (!window.confirm('Delete this draft invoice? This cannot be undone.')) return;
    setBusy('delete');
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/organizations/${organizationId}/invoices/${invoice.id}`, {
        method: 'DELETE',
      });
      await onDeleted();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The invoice could not be deleted.');
      setBusy(null);
    }
  }

  function openExpectedDate() {
    setExpectedDate(invoice.expectedPaymentDate ?? '');
    setDialogError(null);
    setDialog('expected-date');
  }

  function openWriteOff() {
    setWriteOffAmount(minorToDecimal(invoice.balanceMinor));
    setWriteOffReason('');
    setDialogError(null);
    setDialog('write-off');
  }

  /** Runs a dialog-driven mutation; the dialog stays open with the error on failure. */
  async function submitDialog(path: string, init: RequestInit, success: string) {
    setSaving(true);
    setDialogError(null);
    try {
      await apiRequest<InvoiceResponse>(
        `/organizations/${organizationId}/invoices/${invoice.id}${path}`,
        init,
      );
      setDialog(null);
      setNotice(success);
      setError(null);
      await onChanged();
    } catch (caught) {
      setDialogError(
        caught instanceof ApiError ? caught.message : 'The change could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleReminders() {
    const stopping = !remindersStopped;
    setBusy('send');
    setError(null);
    setNotice(null);
    try {
      await apiRequest<InvoiceResponse>(
        `/organizations/${organizationId}/invoices/${invoice.id}/reminders/${stopping ? 'stop' : 'resume'}`,
        { method: 'POST' },
      );
      setNotice(stopping ? 'Payment reminders stopped.' : 'Payment reminders resumed.');
      await onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Reminders could not be updated.');
    } finally {
      setBusy(null);
    }
  }

  async function shareLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/invoices/${invoice.id}`);
      setNotice('Invoice link copied.');
      setError(null);
    } catch {
      setError('The link could not be copied.');
    }
  }

  const printAs = (variant: InvoiceDocumentVariant) => {
    if (variant === 'invoice') window.print();
    else setPrintVariant(variant);
  };

  const disabled = busy !== null;

  return (
    <div className="rb-invoice-pane">
      <div className="rb-invoice-toolbar" role="toolbar" aria-label="Invoice actions">
        {permissions.canManage ? (
          <Link className="rb-invoice-toolbar__button" href={`/invoices/${invoice.id}`}>
            <Pencil aria-hidden="true" />
            <span>Edit</span>
          </Link>
        ) : null}
        {canSendNow ? (
          <button
            type="button"
            className="rb-invoice-toolbar__button"
            onClick={sendInvoice}
            disabled={disabled}
          >
            <Send aria-hidden="true" />
            <span>{busy === 'send' ? 'Sending…' : 'Send Email'}</span>
          </button>
        ) : null}
        <button type="button" className="rb-invoice-toolbar__button" onClick={shareLink}>
          <Share2 aria-hidden="true" />
          <span>Share</span>
        </button>
        {!isDraft && !isVoid ? (
          <ToolbarMenu icon={AlarmClock} label="Reminders">
            {(close) => (
              <>
                <MenuItem
                  icon={Mail}
                  label="Send Email"
                  disabled={disabled || !canSendNow}
                  onSelect={() => {
                    close();
                    void sendInvoice();
                  }}
                />
                <MenuItem
                  icon={remindersStopped ? AlarmClock : AlarmClockOff}
                  label={remindersStopped ? 'Resume Reminders' : 'Stop Reminders'}
                  disabled={disabled || !isOpen || !permissions.canSend}
                  onSelect={() => {
                    close();
                    void toggleReminders();
                  }}
                />
                <MenuItem
                  icon={CalendarClock}
                  label="Expected Payment Date"
                  disabled={!canSetExpectedDate}
                  onSelect={() => {
                    close();
                    openExpectedDate();
                  }}
                />
              </>
            )}
          </ToolbarMenu>
        ) : null}
        <ToolbarMenu icon={Printer} label="PDF/Print">
          {(close) => (
            <>
              <MenuItem
                icon={FileText}
                label="PDF"
                onSelect={() => {
                  close();
                  printAs('invoice');
                }}
              />
              <MenuItem
                icon={Printer}
                label="Print"
                onSelect={() => {
                  close();
                  printAs('invoice');
                }}
              />
              <MenuItem
                icon={Truck}
                label="Print Delivery Note"
                onSelect={() => {
                  close();
                  printAs('delivery-note');
                }}
              />
              <MenuItem
                icon={Package}
                label="Print Packing Slip"
                onSelect={() => {
                  close();
                  printAs('packing-slip');
                }}
              />
            </>
          )}
        </ToolbarMenu>
        {canRecordNow ? (
          <ToolbarMenu icon={Banknote} label="Record Payment">
            {(close) => (
              <>
                <MenuItem
                  icon={Banknote}
                  label="Record Payment"
                  onSelect={() => {
                    close();
                    setRecordingPayment(true);
                  }}
                />
                <MenuItem
                  icon={WalletCards}
                  label="Write Off"
                  disabled={!canWriteOffNow}
                  onSelect={() => {
                    close();
                    openWriteOff();
                  }}
                />
              </>
            )}
          </ToolbarMenu>
        ) : null}
        <ToolbarMenu icon={MoreHorizontal} ariaLabel="More actions">
          {(close) => (
            <>
              <MenuItem
                icon={Repeat}
                label="Make Recurring"
                href="/recurring-invoices"
                disabled={!permissions.canManageRecurring || isVoid}
                onSelect={() => {
                  saveInvoiceSeed('recurring-invoice', seedFromInvoice());
                  close();
                }}
              />
              <MenuItem
                icon={FileMinus}
                label="Create Credit Note"
                href="/credit-notes/new"
                disabled={!permissions.canCreateCreditNote || isDraft || isVoid}
                onSelect={() => {
                  saveInvoiceSeed('credit-note', seedFromInvoice());
                  close();
                }}
              />
              <MenuItem
                icon={Copy}
                label="Clone"
                disabled={disabled || !permissions.canManage}
                onSelect={() => {
                  close();
                  void cloneInvoice();
                }}
              />
              <MenuItem
                icon={Ban}
                label="Void"
                disabled={disabled || !canVoidNow}
                onSelect={() => {
                  close();
                  voidInvoice();
                }}
              />
              {canIssueNow ? (
                <MenuItem
                  icon={Check}
                  label="Issue"
                  disabled={disabled}
                  onSelect={() => {
                    close();
                    void issueInvoice();
                  }}
                />
              ) : null}
              <div className="rb-invoice-toolbar__divider" role="separator" />
              <MenuItem
                icon={BookOpen}
                label="View Journal"
                href={invoice.journalId ? `/journals/${invoice.journalId}` : undefined}
                disabled={!invoice.journalId}
                onSelect={close}
              />
              <MenuItem
                icon={Trash2}
                label="Delete"
                danger
                disabled={disabled || !canDeleteNow}
                title={canDeleteNow ? undefined : 'Only draft invoices can be deleted; void issued invoices instead.'}
                onSelect={() => {
                  close();
                  void deleteInvoice();
                }}
              />
              <div className="rb-invoice-toolbar__divider" role="separator" />
              <MenuItem
                icon={Settings2}
                label="Invoice Preferences"
                href="/numbering"
                disabled={!permissions.canViewNumbering}
                onSelect={close}
              />
            </>
          )}
        </ToolbarMenu>
      </div>

      <div className="rb-invoice-pane__scroll">
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

        <section className="rb-invoice-next" aria-label="What's next">
          <div className="rb-invoice-next__row">
            <Sparkles aria-hidden="true" />
            <p>
              <strong>WHAT&apos;S NEXT?</strong>{' '}
              {isVoid ? (
                'This invoice was voided and can no longer receive payments.'
              ) : isDraft ? (
                'Review this draft, then issue it to post it to the ledger and send it to your customer.'
              ) : isPaid ? (
                'This invoice is fully paid. No further action is needed.'
              ) : overdueDays > 0 ? (
                <>
                  Payment is overdue. Send a{' '}
                  {canSendNow ? (
                    <button type="button" className="rb-invoice-next__link" onClick={sendInvoice}>
                      payment reminder
                    </button>
                  ) : (
                    'payment reminder'
                  )}{' '}
                  {canRecordNow ? (
                    <>
                      or{' '}
                      <button
                        type="button"
                        className="rb-invoice-next__link"
                        onClick={() => setRecordingPayment(true)}
                      >
                        record payment
                      </button>
                    </>
                  ) : null}
                  .
                </>
              ) : (
                'Send this invoice to your customer, then record payment when it arrives.'
              )}
            </p>
            {canIssueNow ? (
              <button
                type="button"
                className="rb-invoice-next__cta"
                onClick={issueInvoice}
                disabled={disabled}
              >
                <Check aria-hidden="true" />
                {busy === 'issue' ? 'Issuing…' : 'Issue Invoice'}
              </button>
            ) : canRecordNow ? (
              <button
                type="button"
                className="rb-invoice-next__cta"
                onClick={() => setRecordingPayment(true)}
              >
                <Banknote aria-hidden="true" />
                Record Payment
              </button>
            ) : null}
          </div>
        </section>

        {invoice.expectedPaymentDate || remindersStopped || writtenOff ? (
          <ul className="rb-invoice-flags" aria-label="Collections status">
            {invoice.expectedPaymentDate ? (
              <li>Expected payment: {formatInvoiceDate(invoice.expectedPaymentDate)}</li>
            ) : null}
            {remindersStopped ? <li>Reminders stopped</li> : null}
            {writtenOff ? (
              <li>Written off: {formatMinor(invoice.writtenOffMinor, invoice.currency)}</li>
            ) : null}
          </ul>
        ) : null}

        <InvoiceDocument
          invoice={invoice}
          organizationName={organizationName}
          variant={printVariant}
        />
      </div>

      <Dialog
        open={dialog === 'expected-date'}
        onOpenChange={(next) => {
          if (!saving) setDialog(next ? 'expected-date' : null);
        }}
      >
        <DialogContent
          className="rb-invoice-dialog"
          title="Expected payment date"
          description="Record when the customer has promised to pay. This does not change the invoice or the ledger."
        >
          <form
            className="rb-invoice-dialog__form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDialog(
                '/expected-payment-date',
                {
                  method: 'PATCH',
                  body: JSON.stringify({ expectedPaymentDate: expectedDate || null }),
                },
                expectedDate ? 'Expected payment date saved.' : 'Expected payment date cleared.',
              );
            }}
          >
            {dialogError ? (
              <div className="rb-auth-error" role="alert">
                {dialogError}
              </div>
            ) : null}
            <div className="rb-field">
              <Label htmlFor="expected-payment-date">Expected payment date</Label>
              <Input
                id="expected-payment-date"
                type="date"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.target.value)}
              />
            </div>
            <footer className="rb-invoice-dialog__footer">
              <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save
              </Button>
            </footer>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'write-off'}
        onOpenChange={(next) => {
          if (!saving) setDialog(next ? 'write-off' : null);
        }}
      >
        <DialogContent
          className="rb-invoice-dialog"
          title="Write off invoice"
          description={`Moves the written-off amount from receivables to Bad debt expense. Open balance: ${formatMinor(invoice.balanceMinor, invoice.currency)}.`}
        >
          <form
            className="rb-invoice-dialog__form"
            onSubmit={(event) => {
              event.preventDefault();
              const cleaned = writeOffAmount.replace(/,/g, '').trim();
              if (!/^\d+(\.\d{1,2})?$/.test(cleaned) || Number(cleaned) <= 0) {
                setDialogError('Enter a positive amount with up to two decimals.');
                return;
              }
              const [whole = '0', fraction = ''] = cleaned.split('.');
              const amountMinor = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
              void submitDialog(
                '/write-off',
                {
                  method: 'POST',
                  body: JSON.stringify({ amountMinor, reason: writeOffReason.trim() || undefined }),
                },
                'Invoice written off.',
              );
            }}
          >
            {dialogError ? (
              <div className="rb-auth-error" role="alert">
                {dialogError}
              </div>
            ) : null}
            <div className="rb-field">
              <Label htmlFor="write-off-amount">Amount to write off ({invoice.currency})</Label>
              <Input
                id="write-off-amount"
                inputMode="decimal"
                value={writeOffAmount}
                onChange={(event) => setWriteOffAmount(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="write-off-reason">Reason (optional)</Label>
              <Input
                id="write-off-reason"
                maxLength={240}
                value={writeOffReason}
                onChange={(event) => setWriteOffReason(event.target.value)}
              />
            </div>
            <footer className="rb-invoice-dialog__footer">
              <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Write off
              </Button>
            </footer>
          </form>
        </DialogContent>
      </Dialog>

      <RecordPaymentDialog
        open={recordingPayment}
        onOpenChange={setRecordingPayment}
        organizationId={organizationId}
        baseCurrency={invoice.currency}
        canAllocate={permissions.canAllocatePayment}
        seed={{
          contactId: invoice.contactId,
          amount: minorToDecimal(invoice.balanceMinor),
          invoiceId: invoice.id,
          lockCustomer: true,
        }}
        onRecorded={() => {
          setNotice('Payment recorded.');
          void onChanged();
        }}
      />
    </div>
  );
}
