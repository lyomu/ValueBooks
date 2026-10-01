/**
 * Minor-unit money helpers. Amounts cross the API as integer strings in the currency's minor unit,
 * so every conversion here goes through BigInt -- a float would lose cents on large totals.
 */

/** "6,550.5" -> "655050". Fractional digits beyond `scale` are truncated, not rounded. */
export function decimalToMinor(value: string, scale = 2): string {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return '0';
  const [whole = '0', fraction = ''] = normalized.split('.');
  return `${whole}${fraction.padEnd(scale, '0').slice(0, scale)}`.replace(/^0+(?=\d)/, '');
}

/** "655050" -> "6550.50", the plain decimal an amount input expects. */
export function minorToDecimal(value: string, scale = 2): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const divisor = 10n ** BigInt(scale);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** "655050", "KES" -> "KES 6,550.50". */
export function formatMinor(value: string, currency: string): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const cents = absolute % 100n;
  const formattedWhole = new Intl.NumberFormat('en-KE').format(Number(whole));
  return `${negative ? '-' : ''}${currency} ${formattedWhole}.${cents.toString().padStart(2, '0')}`;
}
