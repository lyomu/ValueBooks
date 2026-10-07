import type { Invoice } from '@valuebooks/contracts';
import Link from 'next/link';

import {
  daysOverdue,
  formatAmount,
  formatInvoiceDate,
  formatMinor,
  formatQuantity,
  paymentTerms,
} from './invoice-format';

type RibbonTone = 'danger' | 'success' | 'muted' | 'info' | 'warning';

function ribbonFor(invoice: Invoice): { label: string; tone: RibbonTone } {
  if (invoice.status === 'VOID') return { label: 'Void', tone: 'muted' };
  if (invoice.status === 'PAID') return { label: 'Paid', tone: 'success' };
  if (invoice.status === 'DRAFT') return { label: 'Draft', tone: 'muted' };
  if (invoice.status === 'PENDING_APPROVAL') return { label: 'Pending', tone: 'warning' };
  if (
    invoice.status === 'OVERDUE' ||
    daysOverdue(invoice.dueDate, invoice.balanceMinor, invoice.status) > 0
  ) {
    return { label: 'Overdue', tone: 'danger' };
  }
  if (invoice.status === 'PARTIALLY_PAID') return { label: 'Partial', tone: 'info' };
  return { label: 'Sent', tone: 'info' };
}

export type InvoiceDocumentVariant = 'invoice' | 'delivery-note' | 'packing-slip';

const variantTitle: Record<InvoiceDocumentVariant, string> = {
  invoice: 'Invoice',
  'delivery-note': 'Delivery Note',
  'packing-slip': 'Packing Slip',
};

/**
 * Paper-style rendering of an invoice, also used as the print layout. The delivery note and
 * packing slip variants drop every price and total and list only what is being shipped.
 */
export function InvoiceDocument({
  invoice,
  organizationName,
  variant = 'invoice',
}: {
  invoice: Invoice;
  organizationName: string;
  variant?: InvoiceDocumentVariant;
}) {
  const isInvoice = variant === 'invoice';
  const ribbon = ribbonFor(invoice);
  const lines = [...invoice.lines].sort((a, b) => a.lineNumber - b.lineNumber);
  const taxTotal = BigInt(invoice.taxTotalMinor);
  const paid = BigInt(invoice.paidMinor);

  return (
    <div className="rb-invoice-document" data-print-root>
      {isInvoice ? (
        <div className={`rb-invoice-document__ribbon rb-invoice-document__ribbon--${ribbon.tone}`}>
          <span>{ribbon.label}</span>
        </div>
      ) : null}

      <header className="rb-invoice-document__head">
        <div className="rb-invoice-document__org">
          <strong>{organizationName}</strong>
        </div>
        <div className="rb-invoice-document__title">
          <h2>{variantTitle[variant]}</h2>
          <p># {invoice.invoiceNumber ?? 'DRAFT'}</p>
          {isInvoice ? (
            <div className="rb-invoice-document__balance">
              <span>Balance Due</span>
              <strong>{formatMinor(invoice.balanceMinor, invoice.currency)}</strong>
            </div>
          ) : null}
        </div>
      </header>

      <div className="rb-invoice-document__parties">
        <div className="rb-invoice-document__bill-to">
          <span>{isInvoice ? 'Bill To' : 'Ship To'}</span>
          <Link href="/customers">{invoice.contactName}</Link>
        </div>
        <dl className="rb-invoice-document__meta">
          <div>
            <dt>{isInvoice ? 'Invoice Date :' : 'Date :'}</dt>
            <dd>{formatInvoiceDate(invoice.issueDate)}</dd>
          </div>
          {isInvoice ? (
            <>
              <div>
                <dt>Terms :</dt>
                <dd>{paymentTerms(invoice.issueDate, invoice.dueDate)}</dd>
              </div>
              <div>
                <dt>Due Date :</dt>
                <dd>{formatInvoiceDate(invoice.dueDate)}</dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>

      <table className="rb-invoice-document__table">
        <thead>
          <tr>
            <th className="is-index">#</th>
            <th>Item &amp; Description</th>
            <th className="is-number">Qty</th>
            {isInvoice ? (
              <>
                <th className="is-number">Rate</th>
                <th className="is-number">Amount</th>
              </>
            ) : null}
            {variant === 'packing-slip' ? <th className="is-index">Packed</th> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={line.id}>
              <td className="is-index">{index + 1}</td>
              <td>{line.descriptionSnapshot}</td>
              <td className="is-number">{formatQuantity(line.quantity)}</td>
              {isInvoice ? (
                <>
                  <td className="is-number">{formatAmount(line.unitPriceMinor)}</td>
                  <td className="is-number">{formatAmount(line.lineTotalMinor)}</td>
                </>
              ) : null}
              {variant === 'packing-slip' ? (
                <td className="is-index">
                  <span className="rb-invoice-document__box" aria-hidden="true" />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {isInvoice ? (
        <dl className="rb-invoice-document__totals">
          <div>
            <dt>Sub Total</dt>
            <dd>{formatAmount(invoice.subtotalMinor)}</dd>
          </div>
          {taxTotal > 0n ? (
            <div>
              <dt>Tax</dt>
              <dd>{formatAmount(invoice.taxTotalMinor)}</dd>
            </div>
          ) : null}
          <div className="is-strong">
            <dt>Total</dt>
            <dd>{formatMinor(invoice.totalMinor, invoice.currency)}</dd>
          </div>
          {paid > 0n ? (
            <div>
              <dt>Payment Made</dt>
              <dd>(-) {formatAmount(invoice.paidMinor)}</dd>
            </div>
          ) : null}
          {BigInt(invoice.writtenOffMinor) > 0n ? (
            <div>
              <dt>Written Off</dt>
              <dd>(-) {formatAmount(invoice.writtenOffMinor)}</dd>
            </div>
          ) : null}
          <div className="is-balance">
            <dt>Balance Due</dt>
            <dd>{formatMinor(invoice.balanceMinor, invoice.currency)}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
