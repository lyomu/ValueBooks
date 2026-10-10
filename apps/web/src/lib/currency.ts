/**
 * Approximate USD exchange rates used only to give visitors a rough sense of local pricing.
 * These are NOT live rates — replace with a real FX data source before relying on them for
 * anything beyond friendly display conversion (billing always happens in USD).
 */
const APPROX_USD_RATES: Record<string, number> = {
  USD: 1,
  KES: 129,
  NGN: 1550,
  GHS: 15.5,
  UGX: 3750,
  TZS: 2600,
  ZAR: 18,
  EUR: 0.92,
  GBP: 0.78,
};

/** Minimal locale -> currency guesses for the markets ValueBooks' marketing copy already targets. */
const LOCALE_CURRENCY_MAP: Record<string, string> = {
  'en-KE': 'KES',
  'sw-KE': 'KES',
  'en-NG': 'NGN',
  'en-GH': 'GHS',
  'en-UG': 'UGX',
  'sw-TZ': 'TZS',
  'en-TZ': 'TZS',
  'en-ZA': 'ZAR',
  'en-GB': 'GBP',
};

export type CurrencyDisplay = {
  code: string;
  amount: number;
  /** True when the amount is a converted estimate rather than the canonical USD price. */
  isApproximate: boolean;
};

/**
 * Client-side only — relies on the visitor's browser locale, which differs from the server's.
 * Call inside an effect (never at module scope) so the server render and first client render
 * both default to USD and avoid a hydration mismatch.
 */
export function detectLikelyCurrency(): string {
  try {
    const locale = Intl.NumberFormat().resolvedOptions().locale;
    if (LOCALE_CURRENCY_MAP[locale]) return LOCALE_CURRENCY_MAP[locale];
    const region = locale.split('-')[1];
    if (region) {
      const byRegion = Object.entries(LOCALE_CURRENCY_MAP).find(([key]) =>
        key.endsWith(`-${region}`),
      );
      if (byRegion) return byRegion[1];
    }
    return 'USD';
  } catch {
    return 'USD';
  }
}

export function convertUsd(amountUsd: number, currencyCode: string): CurrencyDisplay {
  const rate = APPROX_USD_RATES[currencyCode];
  if (!rate || currencyCode === 'USD') {
    return { code: 'USD', amount: Math.round(amountUsd), isApproximate: false };
  }
  return { code: currencyCode, amount: Math.round(amountUsd * rate), isApproximate: true };
}

export function formatCurrency(display: CurrencyDisplay): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: display.code,
    maximumFractionDigits: 0,
  }).format(display.amount);
}
