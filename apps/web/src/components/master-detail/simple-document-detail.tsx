import { StatusBadge } from '@valuebooks/ui';

import { DocumentDetailView } from './document-detail-view';

type DocumentLine = {
  id: string;
  descriptionSnapshot: string;
  quantity: string;
  unitPriceMinor: string;
  lineTotalMinor: string;
};

export type SimpleDocumentDetailProps = {
  type: string;
  reference: string;
  partyLabel: string;
  partyName: string;
  status: string;
  currency: string;
  issueDate: string | null;
  secondaryDate?: { label: string; value: string | null };
  subtotalMinor: string;
  totalMinor: string;
  lines: readonly DocumentLine[];
};

/**
 * Read-only document surface for document modules that share a line-item model.
 * It deliberately receives display data only: mutation remains in each module's editor.
 */
export function SimpleDocumentDetail({
  type,
  reference,
  partyLabel,
  partyName,
  status,
  currency,
  issueDate,
  secondaryDate,
  subtotalMinor,
  totalMinor,
  lines,
}: SimpleDocumentDetailProps) {
  return (
    <DocumentDetailView>
      <article className="rb-bill-detail" aria-label={`${type} ${reference}`}>
        <header className="rb-bill-detail__head">
          <div>
            <p className="rb-bill-detail__eyebrow">{type}</p>
            <h2>{reference}</h2>
          </div>
          <div className="rb-bill-detail__status">
            <StatusBadge status={status} />
            <strong className="rb-num">{formatMinor(totalMinor, currency)}</strong>
            <span>Total</span>
          </div>
        </header>
        <section className="rb-bill-detail__parties" aria-label={`${type} metadata`}>
          <div>
            <span>{partyLabel}</span>
            <strong>{partyName}</strong>
          </div>
          <dl>
            <div>
              <dt>Date</dt>
              <dd>{formatDate(issueDate)}</dd>
            </div>
            {secondaryDate ? (
              <div>
                <dt>{secondaryDate.label}</dt>
                <dd>{formatDate(secondaryDate.value)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Currency</dt>
              <dd>{currency}</dd>
            </div>
          </dl>
        </section>
        <div className="rb-bill-detail__table-wrap">
          <table className="rb-bill-detail__table">
            <caption className="rb-visually-hidden">{type} line items</caption>
            <thead>
              <tr>
                <th>Description</th>
                <th className="is-number">Quantity</th>
                <th className="is-number">Unit price</th>
                <th className="is-number">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.descriptionSnapshot}</td>
                  <td className="is-number rb-num">{line.quantity}</td>
                  <td className="is-number rb-num">{formatMinor(line.unitPriceMinor, currency)}</td>
                  <td className="is-number rb-num">{formatMinor(line.lineTotalMinor, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="rb-bill-detail__totals">
          <div>
            <dt>Subtotal</dt>
            <dd className="rb-num">{formatMinor(subtotalMinor, currency)}</dd>
          </div>
          <div className="is-total">
            <dt>Total</dt>
            <dd className="rb-num">{formatMinor(totalMinor, currency)}</dd>
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
