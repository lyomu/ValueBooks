import {
  OFFICIAL_PLAN_CATALOG,
  officialYearlySavingsPercent,
  type OfficialEntitlementKey,
  type OfficialFeatureKey,
  type OfficialPlanTier,
} from '@valuebooks/contracts';

/**
 * Marketing copy for the approved commercial plan catalog (billing/subscriptions spec Sections 3
 * and 10). Prices, savings, the "most popular" tier and every quantitative limit are read from
 * `OFFICIAL_PLAN_CATALOG` in `@valuebooks/contracts` -- the same figures the API's catalog
 * migrations are tested against -- so the public page cannot advertise a price or cap checkout and
 * enforcement don't honour. Only taglines and qualitative feature copy are authored here. `id` doubles as the tier key the real backend catalog groups monthly/yearly
 * rows under (`${id}_monthly` / `${id}_yearly` — see `PlanCard`'s checkout call in `pricing.tsx`),
 * so it must stay in sync with the `tierKey` column seeded onto the `Plan` table. Both the
 * homepage pricing teaser and the /pricing page read from here so they can't drift.
 */

export type Plan = {
  id: string;
  name: string;
  tagline: string;
  monthlyPriceUsd: number;
  /** Already-discounted annual total, not monthlyPriceUsd * 12. */
  yearlyPriceUsd: number;
  /** Rounded public "Save N%" badge, shown only when the yearly interval is selected. */
  yearlySavingsPercent: number;
  highlighted?: boolean;
  /** Shown on the homepage teaser card and as the lead bullets on the /pricing card. */
  topFeatures: string[];
  /** Database-backed comparison values for tiers added after the launch catalog. */
  catalogValues?: Record<string, FeatureValue>;
  ctaLabel?: string;
  ctaHref?: string;
};

const catalog = OFFICIAL_PLAN_CATALOG;
const limit = (tier: OfficialPlanTier, key: OfficialEntitlementKey) => catalog[tier].limits[key];
const users = (tier: OfficialPlanTier) => {
  const seats = limit(tier, 'seats.max');
  return seats === 1 ? '1 user' : `${seats ?? 'Unlimited'} users`;
};
/** Limit cell for the comparison table: unlimited, not included, or the cap. */
const limitValue = (key: OfficialEntitlementKey): Record<string, FeatureValue> =>
  Object.fromEntries(
    Object.values(catalog).map((plan) => {
      const value = plan.limits[key];
      return [plan.tierKey, value === null ? 'Unlimited' : value === 0 ? false : String(value)];
    }),
  );

/** On/off cell for the comparison table, read from the catalog the API enforces. */
const featureValue = (key: OfficialFeatureKey): Record<string, FeatureValue> =>
  Object.fromEntries(Object.values(catalog).map((plan) => [plan.tierKey, plan.features[key]]));
/** Monthly allowance cell: unlimited, not included, or "N / month". */
const monthlyValue = (key: OfficialEntitlementKey): Record<string, FeatureValue> =>
  Object.fromEntries(
    Object.values(catalog).map((plan) => {
      const value = plan.limits[key];
      return [
        plan.tierKey,
        value === null ? 'Unlimited' : value === 0 ? false : `${value} / month`,
      ];
    }),
  );
const everyPlan: Record<string, FeatureValue> = {
  starter: true,
  growth: true,
  professional: true,
  advanced: true,
};

function plan(tier: OfficialPlanTier, copy: Pick<Plan, 'tagline' | 'topFeatures'>): Plan {
  return {
    id: tier,
    name: catalog[tier].name,
    monthlyPriceUsd: catalog[tier].monthlyPriceMinor / 100,
    yearlyPriceUsd: catalog[tier].yearlyPriceMinor / 100,
    yearlySavingsPercent: officialYearlySavingsPercent(catalog[tier]),
    highlighted: catalog[tier].mostPopular,
    ...copy,
  };
}

export const PLANS: Plan[] = [
  plan('starter', {
    tagline: 'For solo owners getting invoices and expenses organized.',
    topFeatures: [
      users('starter'),
      `${limit('starter', 'customers.active.max')} customers, ${limit('starter', 'invoices.issued.max')} invoices/mo`,
      'Expense tracking',
      'Core financial reports',
      'Email support',
    ],
  }),
  plan('growth', {
    tagline: 'For small teams who need banking and multi-user access.',
    topFeatures: [
      users('growth'),
      'Bills & purchase orders',
      'Banking & reconciliation',
      'Basic inventory',
      `${limit('growth', 'customers.active.max')} customers, ${limit('growth', 'invoices.issued.max')} invoices/mo`,
      'Chat support',
    ],
  }),
  plan('professional', {
    tagline: 'For growing businesses that need deeper reporting and roles.',
    topFeatures: [
      users('professional'),
      'Projects & timesheets',
      'Advanced reporting & insights',
      'Inventory & multi-currency',
      `${limit('professional', 'customers.active.max')} customers, ${limit('professional', 'invoices.issued.max')} invoices/mo`,
      'Priority support',
    ],
  }),
  plan('advanced', {
    tagline: 'For established businesses with complex workflows.',
    topFeatures: [
      users('advanced'),
      'Unlimited customers & invoices',
      'Unlimited projects',
      'Advanced automation & approvals',
      'Custom roles',
      'Priority support',
    ],
  }),
];

export type FeatureValue = boolean | string;

export type FeatureGroup = {
  id: string;
  name: string;
  rows: Array<{
    label: string;
    /** Keyed by Plan.id. */
    values: Record<string, FeatureValue>;
  }>;
};

/**
 * Every row is either read from the catalog (limits and on/off features the API seeds and
 * enforces) or is a capability every plan has. Nothing here may advertise a feature the product
 * does not have -- there is no online invoice payment collection or live bank feed.
 */
export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'core',
    name: 'Core accounting',
    rows: [
      { label: 'Users included', values: limitValue('seats.max') },
      { label: 'Chart of accounts', values: everyPlan },
      { label: 'Manual journals', values: featureValue('manual_journals.enabled') },
      { label: 'Multi-currency', values: featureValue('multi_currency.enabled') },
      { label: 'Custom roles', values: featureValue('custom_roles.enabled') },
      { label: 'Audit trail', values: everyPlan },
    ],
  },
  {
    id: 'invoicing',
    name: 'Invoicing & payments',
    rows: [
      { label: 'Invoices issued per month', values: limitValue('invoices.issued.max') },
      { label: 'Quotes per month', values: limitValue('quotes.max') },
      { label: 'Active customers', values: limitValue('customers.active.max') },
      { label: 'Recurring invoices', values: featureValue('recurring_invoices.enabled') },
      { label: 'Customer portal', values: everyPlan },
      { label: 'Payment recording & reminders', values: everyPlan },
    ],
  },
  {
    id: 'banking',
    name: 'Banking',
    rows: [
      { label: 'Bank accounts', values: limitValue('bank_accounts.max') },
      { label: 'Bank statement imports', values: everyPlan },
      { label: 'Bank reconciliation', values: featureValue('bank_reconciliation.enabled') },
      { label: 'Bank rules', values: everyPlan },
    ],
  },
  {
    id: 'reporting',
    name: 'Reporting & insights',
    rows: [
      { label: 'P&L and balance sheet', values: everyPlan },
      { label: 'Cash-flow reporting', values: featureValue('cash_flow_reporting.enabled') },
      {
        label: 'Advanced financial reports',
        values: featureValue('advanced_financial_reports.enabled'),
      },
      { label: 'Saved reports', values: limitValue('reports.saved.enabled') },
      { label: 'Scheduled reports', values: limitValue('reports.scheduled.enabled') },
      { label: 'ValueBooks AI insights', values: monthlyValue('ai_insights.max') },
    ],
  },
  {
    id: 'support',
    name: 'Support',
    rows: [
      {
        label: 'Email support',
        values: { starter: true, growth: true, professional: true, advanced: true },
      },
      {
        label: 'Chat support',
        values: { starter: false, growth: true, professional: true, advanced: true },
      },
      {
        label: 'Priority support',
        values: { starter: false, growth: false, professional: true, advanced: true },
      },
      {
        label: 'Dedicated account manager',
        values: { starter: false, growth: false, professional: false, advanced: true },
      },
    ],
  },
];
