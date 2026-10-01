'use client';

import type {
  Contact,
  LedgerAccount,
  OpenInvoiceForAllocation,
  PaymentMode,
  PaymentReceived,
} from '@valuebooks/contracts';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  FieldMessage,
  Input,
  Label,
  Select,
  Textarea,
} from '@valuebooks/ui';
import { Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { decimalToMinor, formatMinor, minorToDecimal } from '../lib/money';

type ContactListResponse = { data: Contact[] };
type OpenInvoiceListResponse = { data: OpenInvoiceForAllocation[] };
type AccountListResponse = { data: LedgerAccount[] };
type PaymentResponse = { data: PaymentReceived };

const PAYMENT_MODE_LABELS: Readonly<Record<PaymentMode, string>> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  MOBILE_MONEY: 'Mobile money',
  CARD: 'Card',
  OTHER: 'Other',
};

export type RecordPaymentSeed = {
  /** Pre-selected customer. With `lockCustomer`, the picker becomes read-only. */
  contactId?: string;
  /** Pre-filled amount as a plain decimal, such as "6550.00". */
  amount?: string;
  /** Invoice to allocate to first -- the invoice the dialog was opened from. */
  invoiceId?: string;
  lockCustomer?: boolean;
};

/**
 * Records a customer receipt without leaving the page that raised it. Everything the receipt needs
 * lives here: the deductions that keep the deposit reconcilable against the bank statement, and the
 * invoice allocation, so the common case -- "this invoice was paid" -- is one submit rather than a
 * record step followed by a separate allocation screen.
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  organizationId,
  baseCurrency,
  canAllocate,
  seed,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
  baseCurrency: string;
  canAllocate: boolean;
  seed?: RecordPaymentSeed | null;
  onRecorded: (payment: PaymentReceived) => void;
}) {
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceForAllocation[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const [contactId, setContactId] = useState('');
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [bankCharges, setBankCharges] = useState('');
  const [taxDeducted, setTaxDeducted] = useState(false);
  const [withholdingTax, setWithholdingTax] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('BANK_TRANSFER');
  const [depositAccountId, setDepositAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  /** Set once the person edits an allocation cell, so auto-fill stops overwriting their intent. */
  const [allocationsTouched, setAllocationsTouched] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seedContactId = seed?.contactId ?? '';
  const seedAmount = seed?.amount ?? '';
  const seedInvoiceId = seed?.invoiceId;

  // Reset to the seed each time the dialog opens, so a second receipt never inherits the first.
  useEffect(() => {
    if (!open) return;
    setContactId(seedContactId);
    setReceivedDate(new Date().toISOString().slice(0, 10));
    setAmount(seedAmount);
    setBankCharges('');
    setTaxDeducted(false);
    setWithholdingTax('');
    setPaymentMode('BANK_TRANSFER');
    setDepositAccountId('');
    setReference('');
    setNotes('');
    setAllocations({});
    setAllocationsTouched(false);
    setError(null);
  }, [open, seedContactId, seedAmount]);

  useEffect(() => {
    if (!open || !organizationId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [customerResponse, accountResponse] = await Promise.all([
          apiRequest<ContactListResponse>(
            `/organizations/${organizationId}/customers?status=ACTIVE`,
          ),
          apiRequest<AccountListResponse>(`/organizations/${organizationId}/accounts`),
        ]);
        if (cancelled) return;
        setCustomers(customerResponse.data);
        setAccounts(accountResponse.data);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'The form could not be loaded.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, organizationId]);

  const loadOpenInvoices = useCallback(async () => {
    if (!organizationId || !contactId || !canAllocate) {
      setOpenInvoices([]);
      return;
    }
    setLoadingInvoices(true);
    try {
      const response = await apiRequest<OpenInvoiceListResponse>(
        `/organizations/${organizationId}/payments/open-invoices?contactId=${contactId}`,
      );
      setOpenInvoices(response.data);
    } catch {
      // Allocation is optional: a failure here still leaves a recordable payment.
      setOpenInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  }, [organizationId, contactId, canAllocate]);

  useEffect(() => {
    if (!open) return;
    void loadOpenInvoices();
  }, [open, loadOpenInvoices]);

  const customer = customers.find((candidate) => candidate.id === contactId) ?? null;
  const currency = customer?.currency ?? baseCurrency;
  const depositAccounts = useMemo(
    () => accounts.filter((account) => account.type === 'ASSET' && account.status === 'ACTIVE'),
    [accounts],
  );

  const amountMinor = amount ? BigInt(decimalToMinor(amount)) : 0n;
  const bankChargesMinor = bankCharges ? BigInt(decimalToMinor(bankCharges)) : 0n;
  const withholdingMinor =
    taxDeducted && withholdingTax ? BigInt(decimalToMinor(withholdingTax)) : 0n;
  const depositedMinor = amountMinor - bankChargesMinor - withholdingMinor;

  // Oldest invoice first, up to the amount received -- how a receipt applies unless told otherwise.
  useEffect(() => {
    if (allocationsTouched || openInvoices.length === 0 || amountMinor <= 0n) return;
    let remaining = amountMinor;
    const next: Record<string, string> = {};
    const ordered = seedInvoiceId
      ? [...openInvoices].sort((a, b) =>
          a.id === seedInvoiceId ? -1 : b.id === seedInvoiceId ? 1 : 0,
        )
      : openInvoices;
    for (const invoice of ordered) {
      if (remaining <= 0n) break;
      const balance = BigInt(invoice.balanceMinor);
      const apply = balance < remaining ? balance : remaining;
      if (apply > 0n) {
        next[invoice.id] = minorToDecimal(apply.toString());
        remaining -= apply;
      }
    }
    setAllocations(next);
  }, [openInvoices, amountMinor, allocationsTouched, seedInvoiceId]);

  const allocatedMinor = useMemo(
    () =>
      Object.values(allocations).reduce(
        (sum, value) => sum + (value.trim() ? BigInt(decimalToMinor(value)) : 0n),
        0n,
      ),
    [allocations],
  );
  const unappliedMinor = amountMinor - allocatedMinor;

  const deductionsExceedAmount = depositedMinor < 0n;
  const overAllocated = allocatedMinor > amountMinor;
  const valid = Boolean(contactId) && amountMinor > 0n && !deductionsExceedAmount && !overAllocated;

  async function submit() {
    if (!organizationId || !valid) return;
    setSaving(true);
    setError(null);
    try {
      const lines = Object.entries(allocations)
        .filter(([, value]) => value.trim() !== '' && BigInt(decimalToMinor(value)) > 0n)
        .map(([invoiceId, value]) => ({ invoiceId, amountMinor: decimalToMinor(value) }));
      const response = await apiRequest<PaymentResponse>(
        `/organizations/${organizationId}/payments`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            contactId,
            receivedDate,
            amountMinor: decimalToMinor(amount),
            bankChargesMinor: bankChargesMinor > 0n ? bankChargesMinor.toString() : undefined,
            withholdingTaxMinor: withholdingMinor > 0n ? withholdingMinor.toString() : undefined,
            paymentMode,
            depositAccountId: depositAccountId || undefined,
            reference: reference.trim() || undefined,
            notes: notes.trim() || undefined,
            allocations: lines.length > 0 ? lines : undefined,
          }),
        },
      );
      onRecorded(response.data);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The payment could not be recorded.');
    } finally {
      setSaving(false);
    }
  }

  const customerLocked = Boolean(seed?.lockCustomer && seedContactId);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="rb-payment-dialog"
        title="Record payment"
        description="Capture a customer receipt and apply it to their open invoices. It posts to the ledger immediately."
      >
        <form
          className="rb-payment-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {error ? (
            <div className="rb-auth-error" role="alert">
              {error}
            </div>
          ) : null}

          <section className="rb-payment-form__section">
            <div className="rb-payment-form__grid">
              <div className="rb-field rb-payment-form__wide-field">
                <Label htmlFor="record-payment-customer">Customer</Label>
                {customerLocked ? (
                  <Input
                    id="record-payment-customer"
                    value={customer?.displayName ?? 'Loading'}
                    disabled
                  />
                ) : (
                  <Select
                    id="record-payment-customer"
                    value={contactId}
                    onChange={(event) => {
                      setContactId(event.target.value);
                      setAllocations({});
                      setAllocationsTouched(false);
                    }}
                  >
                    <option value="">Choose customer</option>
                    {customers.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.displayName}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
              <div className="rb-field">
                <Label htmlFor="record-payment-amount">Amount received ({currency})</Label>
                <Input
                  id="record-payment-amount"
                  inputMode="decimal"
                  value={amount}
                  placeholder="0.00"
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setAllocationsTouched(false);
                  }}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="record-payment-date">Payment date</Label>
                <Input
                  id="record-payment-date"
                  type="date"
                  value={receivedDate}
                  onChange={(event) => setReceivedDate(event.target.value)}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="record-payment-mode">Payment mode</Label>
                <Select
                  id="record-payment-mode"
                  value={paymentMode}
                  onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}
                >
                  {(Object.keys(PAYMENT_MODE_LABELS) as PaymentMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {PAYMENT_MODE_LABELS[mode]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="record-payment-deposit">Deposit to</Label>
                <Select
                  id="record-payment-deposit"
                  value={depositAccountId}
                  onChange={(event) => setDepositAccountId(event.target.value)}
                >
                  <option value="">Default bank account</option>
                  {depositAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} {account.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field rb-payment-form__wide-field">
                <Label htmlFor="record-payment-reference">Reference #</Label>
                <Input
                  id="record-payment-reference"
                  value={reference}
                  placeholder="Cheque number, M-Pesa code, transfer reference"
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="rb-payment-form__section">
            <div className="rb-payment-form__section-heading">
              <h2>Deductions</h2>
              <p>What was taken out of the receipt before it reached your bank.</p>
            </div>
            <div className="rb-payment-form__grid">
              <div className="rb-field">
                <Label htmlFor="record-payment-bank-charges">Bank charges (if any)</Label>
                <Input
                  id="record-payment-bank-charges"
                  inputMode="decimal"
                  value={bankCharges}
                  placeholder="0.00"
                  onChange={(event) => setBankCharges(event.target.value)}
                />
              </div>
              <fieldset className="rb-field rb-payment-form__fieldset">
                <legend>Tax deducted?</legend>
                <div className="rb-payment-form__choices">
                  <label className="rb-payment-form__choice">
                    <input
                      type="radio"
                      name="record-payment-tds"
                      checked={!taxDeducted}
                      onChange={() => {
                        setTaxDeducted(false);
                        setWithholdingTax('');
                      }}
                    />
                    No tax deducted
                  </label>
                  <label className="rb-payment-form__choice">
                    <input
                      type="radio"
                      name="record-payment-tds"
                      checked={taxDeducted}
                      onChange={() => setTaxDeducted(true)}
                    />
                    Yes, withheld at source
                  </label>
                </div>
              </fieldset>
              {taxDeducted ? (
                <div className="rb-field">
                  <Label htmlFor="record-payment-wht">Tax withheld</Label>
                  <Input
                    id="record-payment-wht"
                    inputMode="decimal"
                    value={withholdingTax}
                    placeholder="0.00"
                    onChange={(event) => setWithholdingTax(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
            <p className="rb-payment-form__summary">
              <span>Net deposited</span>
              <strong className="rb-num">
                {formatMinor((depositedMinor < 0n ? 0n : depositedMinor).toString(), currency)}
              </strong>
            </p>
            {deductionsExceedAmount ? (
              <FieldMessage error>
                Bank charges and tax withheld together cannot exceed the amount received.
              </FieldMessage>
            ) : null}
          </section>

          {canAllocate ? (
            <section className="rb-payment-form__section">
              <div className="rb-payment-form__section-heading">
                <h2>Apply to invoices</h2>
                <p>
                  Filled oldest first. Adjust any row, or clear it to leave the receipt unapplied.
                </p>
              </div>
              {!contactId ? (
                <p className="rb-payment-form__hint">
                  Choose a customer to see their open invoices.
                </p>
              ) : loadingInvoices ? (
                <p className="rb-payment-form__hint">Loading open invoices</p>
              ) : openInvoices.length === 0 ? (
                <p className="rb-payment-form__hint">
                  This customer has no open invoices. The receipt will be recorded as unapplied.
                </p>
              ) : (
                <>
                  <div className="rb-payment-allocations" role="table" aria-label="Open invoices">
                    <div className="rb-payment-allocations__head" role="row">
                      <span>Invoice</span>
                      <span>Due</span>
                      <span>Balance</span>
                      <span>Amount to apply</span>
                    </div>
                    {openInvoices.map((invoice) => (
                      <div className="rb-payment-allocations__row" role="row" key={invoice.id}>
                        <span>{invoice.invoiceNumber ?? 'Invoice'}</span>
                        <span className="rb-table-secondary">{invoice.dueDate ?? '-'}</span>
                        <span className="rb-table-secondary rb-num">
                          {formatMinor(invoice.balanceMinor, invoice.currency)}
                        </span>
                        <Input
                          aria-label={`Amount to apply to invoice ${invoice.invoiceNumber ?? invoice.id}`}
                          inputMode="decimal"
                          value={allocations[invoice.id] ?? ''}
                          placeholder="0.00"
                          onChange={(event) => {
                            setAllocationsTouched(true);
                            setAllocations((current) => ({
                              ...current,
                              [invoice.id]: event.target.value,
                            }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="rb-payment-form__summary">
                    <span>Applied</span>
                    <strong className="rb-num">
                      {formatMinor(allocatedMinor.toString(), currency)}
                    </strong>
                    <span>Left unapplied</span>
                    <strong className="rb-num">
                      {formatMinor(
                        (unappliedMinor < 0n ? 0n : unappliedMinor).toString(),
                        currency,
                      )}
                    </strong>
                    {overAllocated ? <Badge tone="danger">Exceeds the amount received</Badge> : null}
                  </p>
                </>
              )}
            </section>
          ) : null}

          <section className="rb-payment-form__section">
            <div className="rb-field">
              <Label htmlFor="record-payment-notes">Notes</Label>
              <Textarea
                id="record-payment-notes"
                rows={3}
                value={notes}
                placeholder="Anything worth remembering about this receipt."
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </section>

          <div className="rb-payment-form__footer">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={!valid}>
              <Save aria-hidden="true" /> Record payment
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
