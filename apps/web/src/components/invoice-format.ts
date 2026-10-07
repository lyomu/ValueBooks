export function formatAmount(value: string): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const cents = absolute % 100n;
  const formattedWhole = new Intl.NumberFormat('en-KE').format(Number(whole));
  return `${negative ? '-' : ''}${formattedWhole}.${cents.toString().padStart(2, '0')}`;
}

export function formatMinor(value: string, currency: string): string {
  return `${currency} ${formatAmount(value)}`;
}

export function formatInvoiceDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

/** Whole days an open invoice is past due, or 0 when not overdue. */
export function daysOverdue(dueDate: string | null, balanceMinor: string, status: string): number {
  if (!dueDate || status === 'VOID' || status === 'DRAFT' || BigInt(balanceMinor) <= 0n) return 0;
  const due = new Date(`${dueDate}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - due) / 86_400_000);
  return days > 0 ? days : 0;
}

export function paymentTerms(issueDate: string | null, dueDate: string | null): string {
  if (!issueDate || !dueDate || issueDate === dueDate) return 'Due on Receipt';
  const days = Math.round(
    (new Date(`${dueDate}T00:00:00`).getTime() - new Date(`${issueDate}T00:00:00`).getTime()) /
      86_400_000,
  );
  return days > 0 ? `Net ${days}` : 'Due on Receipt';
}

/** Trims a decimal quantity such as "2000.0000" to at most two decimals. */
export function formatQuantity(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(parsed);
}

/** Minor units as a plain decimal string (no grouping), e.g. "6550.00". */
export function minorToDecimal(value: string): string {
  const amount = BigInt(value);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}
