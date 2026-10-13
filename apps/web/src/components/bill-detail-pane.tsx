'use client';

import type { Bill } from '@valuebooks/contracts';
import { Button, StatusBadge } from '@valuebooks/ui';
import { FileText, Pencil, Printer, XCircle } from 'lucide-react';
import Link from 'next/link';

import { DocumentDetailView } from './master-detail/document-detail-view';

type BillDetailPaneProps = {
  bill: Bill;
  canManage: boolean;
  canVoid: boolean;
  onIssue: () => void;
  onVoid: () => void;
  busy?: 'issue' | 'void' | null;
};

export function BillDetailPane({
  bill,
  canManage,
  canVoid,
  onIssue,
  onVoid,
  busy,
}: BillDetailPaneProps) {
  const canIssue = bill.status === 'DRAFT' && canManage;
  const canVoidNow =
    (bill.status === 'ISSUED' || bill.status === 'PARTIALLY_PAID') &&
    bill.paidMinor === '0' &&
    canVoid;

  return (
    <DocumentDetailView>
      <div className="rb-bill-detail__toolbar" role="toolbar" aria-label="Bill actions">
        {canManage ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/bills/${bill.id}/edit`}>
              <Pencil aria-hidden="true" /> Edit
            </Link>
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer aria-hidden="true" /> Print
        </Button>
        {canIssue ? (
          <Button type="button" size="sm" onClick={onIssue} loading={busy === 'issue'}>
            <FileText aria-hidden="true" /> Issue bill
          </Button>
        ) : null}
        {canVoidNow ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onVoid}
            loading={busy === 'void'}
          >
            <XCircle aria-hidden="true" /> Void
          </Button>
        ) : null}
      </div>

      <article className="rb-bill-detail" aria-label={`Bill ${bill.billNumber ?? 'draft'}`}>
        <header className="rb-bill-detail__head">
          <div>
            <p className="rb-bill-detail__eyebrow">Bill</p>
            <h2>{bill.billNumber ?? 'Draft bill'}</h2>
            {bill.vendorReference ? <p>Vendor reference: {bill.vendorReference}</p> : null}
          </div>
          <div className="rb-bill-detail__status">
            <StatusBadge status={bill.status} />
            <strong className="rb-num">{formatMinor(bill.balanceMinor, bill.currency)}</strong>
            <span>Balance due</span>
          </div>
        </header>

        <section className="rb-bill-detail__parties" aria-label="Bill details">
          <div>
            <span>Vendor</span>
            <strong>{bill.vendorName}</strong>
          </div>
          <dl>
            <div>
              <dt>Bill date</dt>
              <dd>{formatDate(bill.issueDate)}</dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd>{formatDate(bill.dueDate)}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{bill.currency}</dd>
            </div>
          </dl>
        </section>

        <div className="rb-bill-detail__table-wrap">
          <table className="rb-bill-detail__table">
            <caption className="rb-visually-hidden">Bill line items</caption>
            <thead>
              <tr>
                <th>Description</th>
                <th className="is-number">Quantity</th>
                <th className="is-number">Unit price</th>
                <th className="is-number">Tax</th>
                <th className="is-number">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.descriptionSnapshot}</td>
                  <td className="is-number rb-num">{line.quantity}</td>
                  <td className="is-number rb-num">
                    {formatMinor(line.unitPriceMinor, bill.currency)}
                  </td>
                  <td className="is-number rb-num">
                    {line.taxAmountMinor ? formatMinor(line.taxAmountMinor, bill.currency) : '—'}
                  </td>
                  <td className="is-number rb-num">
                    {formatMinor(line.lineTotalMinor, bill.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="rb-bill-detail__totals">
          <div>
            <dt>Subtotal</dt>
            <dd className="rb-num">{formatMinor(bill.subtotalMinor, bill.currency)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd className="rb-num">{formatMinor(bill.taxTotalMinor, bill.currency)}</dd>
          </div>
          <div className="is-total">
            <dt>Total</dt>
            <dd className="rb-num">{formatMinor(bill.totalMinor, bill.currency)}</dd>
          </div>
          <div>
            <dt>Payments applied</dt>
            <dd className="rb-num">{formatMinor(bill.paidMinor, bill.currency)}</dd>
          </div>
          <div className="is-balance">
            <dt>Balance due</dt>
            <dd className="rb-num">{formatMinor(bill.balanceMinor, bill.currency)}</dd>
          </div>
        </dl>
      </article>
    </DocumentDetailView>
  );
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' }).format(new Date(value))
    : '—';
}

function formatMinor(value: string, currency: string) {
  const amount = BigInt(value);
  const whole = amount / 100n;
  const cents = amount % 100n;
  return `${currency} ${new Intl.NumberFormat('en-KE').format(Number(whole))}.${cents.toString().padStart(2, '0')}`;
}
