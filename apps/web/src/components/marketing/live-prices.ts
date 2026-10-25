import { OFFICIAL_PLAN_CATALOG, type OfficialPlanTier } from '@valuebooks/contracts';

import { PLANS, type Plan } from './pricing-data';

/**
 * Live prices for the public pricing page (phase 7, §4.8).
 *
 * Prices are administrator-editable from the Platform Admin console and reach Paystack immediately,
 * so the public page cannot keep reading the figure compiled into the bundle: it would advertise a
 * price that checkout no longer charges. This reads the current catalog from the API instead and
 * overlays it on the authored marketing copy, which stays compiled.
 *
 * If the API cannot be reached, callers suppress price cards. Showing compiled launch prices
 * after an administrator has changed a live Paystack price would mislead a buyer.
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

/** How long a rendered pricing page may keep serving a price, in seconds. */
export const PRICING_REVALIDATE_SECONDS = 0;

type CatalogRow = {
  tierKey: string;
  name: string;
  tagline: string | null;
  highlights: string[];
  entitlements: Array<{ key: string; enabled: boolean; limitValue: number | null }>;
  priceMinor: string;
  currency: string;
  billingInterval: string;
  isMostPopular: boolean;
};

/**
 * Reads the public catalog. Returns null when it cannot be read, so callers can show an honest
 * unavailable state instead of an old or incomplete price.
 */
export async function fetchLivePlans(): Promise<Plan[] | null> {
  try {
    const response = await fetch(`${API_URL}/api/v1/billing/plans`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: CatalogRow[] };
    if (!Array.isArray(body.data) || body.data.length === 0) return null;
    return applyLivePrices(body.data);
  } catch {
    return null;
  }
}

/**
 * Builds the sellable cards from the database. The four launch tiers retain their authored
 * qualitative copy as a fallback; new tiers use their stored copy or plain limit descriptions.
 */
export function applyLivePrices(rows: CatalogRow[]): Plan[] {
  const byTier = new Map<string, { monthly?: CatalogRow; yearly?: CatalogRow }>();
  for (const row of rows) {
    const entry = byTier.get(row.tierKey) ?? {};
    if (row.billingInterval === 'MONTHLY') entry.monthly = row;
    if (row.billingInterval === 'YEARLY') entry.yearly = row;
    byTier.set(row.tierKey, entry);
  }

  return [...byTier.entries()].flatMap(([tierKey, live]) => {
    if (!live.monthly || !live.yearly) return [];
    const authored = PLANS.find((plan) => plan.id === tierKey);
    const monthly = Number(live.monthly.priceMinor) / 100;
    const yearly = Number(live.yearly.priceMinor) / 100;
    const limits = live.monthly.entitlements
      .filter((row) => row.enabled && row.key.endsWith('.max'))
      .slice(0, 5)
      .map((row) => `${row.limitValue === null ? 'Unlimited' : row.limitValue} ${row.key.replace(/\.max$/, '').replace(/[._]/g, ' ')}`);
    const includedFeatures = live.monthly.entitlements
      .filter((row) => row.enabled && row.key.endsWith('.enabled'))
      .slice(0, 5)
      .map((row) => row.key.replace(/\.enabled$/, '').replace(/[._]/g, ' '));
    const keyByLabel: Record<string, string> = {
      'Users included': 'seats.max', 'Invoices issued per month': 'invoices.issued.max',
      'Quotes per month': 'quotes.max', 'Active customers': 'customers.active.max',
      'Bank accounts': 'bank_accounts.max', 'Saved reports': 'reports.saved.enabled',
      'Scheduled reports': 'reports.scheduled.enabled', 'ValueBooks AI insights': 'ai_insights.max',
      'Manual journals': 'manual_journals.enabled', 'Multi-currency': 'multi_currency.enabled',
      'Custom roles': 'custom_roles.enabled', 'Recurring invoices': 'recurring_invoices.enabled',
      'Bank reconciliation': 'bank_reconciliation.enabled',
      'Cash-flow reporting': 'cash_flow_reporting.enabled',
      'Advanced financial reports': 'advanced_financial_reports.enabled',
    };
    const catalogValues = Object.fromEntries(Object.entries(keyByLabel).map(([label, key]) => {
      const value = live.monthly!.entitlements.find((row) => row.key === key);
      return [label, !value || !value.enabled ? false : key.endsWith('.max')
        ? value.limitValue === null ? 'Unlimited' : String(value.limitValue)
        : true];
    }));
    return {
      id: tierKey,
      name: live.monthly.name,
      tagline: live.monthly.tagline || authored?.tagline || '',
      topFeatures: live.monthly.highlights.length ? live.monthly.highlights : [...limits, ...includedFeatures].slice(0, 5),
      catalogValues,
      monthlyPriceUsd: monthly,
      yearlyPriceUsd: yearly,
      // Recomputed from the prices actually shown, so the badge can never advertise a saving the
      // two figures on the same card do not support.
      yearlySavingsPercent: savingsPercent(monthly, yearly),
      // The badge follows the catalog row when the API answers, so moving it needs no deploy.
      highlighted: live.monthly.isMostPopular,
    };
  });
}

/** The same rounding as `officialYearlySavingsPercent`, applied to the live figures. */
function savingsPercent(monthlyUsd: number, yearlyUsd: number): number {
  const twelveMonths = monthlyUsd * 12;
  if (twelveMonths <= 0) return 0;
  return Math.max(0, Math.round(((twelveMonths - yearlyUsd) / twelveMonths) * 100));
}

/** The compiled catalog, for a caller that wants the approved figures explicitly. */
export function approvedPlanPrice(tier: OfficialPlanTier) {
  return {
    monthlyPriceUsd: OFFICIAL_PLAN_CATALOG[tier].monthlyPriceMinor / 100,
    yearlyPriceUsd: OFFICIAL_PLAN_CATALOG[tier].yearlyPriceMinor / 100,
  };
}
