/**
 * One-shot hand-off from the invoice detail pane to another editor (credit note, recurring
 * template, payment). Session storage keeps the URL clean and the seed is consumed on first read.
 */
export type InvoiceSeedLine = {
  itemId: string | null;
  description: string;
  quantity: string;
  unitPriceMinor: string;
  discountMinor: string;
  taxCodeId: string | null;
};

export type InvoiceSeed = {
  contactId: string;
  lines: InvoiceSeedLine[];
  /** Payment only: the amount, as a plain decimal such as "6550.00". */
  amount?: string;
  /** Payment only: the invoice the payment should be allocated to after it is recorded. */
  invoiceId?: string;
};

export type InvoiceSeedTarget = 'credit-note' | 'recurring-invoice' | 'payment';

const seedKey = (target: InvoiceSeedTarget) => `rb-invoice-seed:${target}`;

export function saveInvoiceSeed(target: InvoiceSeedTarget, seed: InvoiceSeed): void {
  try {
    window.sessionStorage.setItem(seedKey(target), JSON.stringify(seed));
  } catch {
    // Storage can be unavailable; the destination simply opens blank.
  }
}

export function takeInvoiceSeed(target: InvoiceSeedTarget): InvoiceSeed | null {
  try {
    const raw = window.sessionStorage.getItem(seedKey(target));
    if (!raw) return null;
    window.sessionStorage.removeItem(seedKey(target));
    return JSON.parse(raw) as InvoiceSeed;
  } catch {
    return null;
  }
}

export const PAYMENT_ALLOCATE_INVOICE_KEY = 'rb-payment-allocate-invoice';
