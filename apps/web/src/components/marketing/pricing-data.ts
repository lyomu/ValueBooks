/**
 * Approved commercial plan catalog for the public marketing site (billing/subscriptions spec
 * Sections 3 and 10). `id` doubles as the tier key the real backend catalog groups monthly/yearly
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
  ctaLabel?: string;
  ctaHref?: string;
};

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For solo owners getting invoices and expenses organized.',
    monthlyPriceUsd: 1,
    yearlyPriceUsd: 10,
    yearlySavingsPercent: 17,
    topFeatures: [
      '1 user',
      '10 customers, 5 invoices/mo',
      'Expense tracking',
      'Core financial reports',
      'Email support',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For small teams who need banking and multi-user access.',
    monthlyPriceUsd: 4.99,
    yearlyPriceUsd: 55,
    yearlySavingsPercent: 8,
    topFeatures: [
      '2 users',
      'Bills & purchase orders',
      'Banking & reconciliation',
      'Basic inventory',
      '50 customers, 20 invoices/mo',
      'Chat support',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    tagline: 'For growing businesses that need deeper reporting and roles.',
    monthlyPriceUsd: 9.99,
    yearlyPriceUsd: 100,
    yearlySavingsPercent: 17,
    highlighted: true,
    topFeatures: [
      '5 users',
      'Projects & timesheets',
      'Advanced reporting & insights',
      'Inventory & multi-currency',
      '100 customers, 100 invoices/mo',
      'Priority support',
    ],
  },
  {
    id: 'advanced',
    name: 'Advanced',
    tagline: 'For established businesses with complex workflows.',
    monthlyPriceUsd: 20,
    yearlyPriceUsd: 220,
    yearlySavingsPercent: 8,
    topFeatures: [
      '10 users',
      'Unlimited customers & invoices',
      'Unlimited projects',
      'Advanced automation & approvals',
      'Custom roles',
      'Priority support',
    ],
  },
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

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'core',
    name: 'Core accounting',
    rows: [
      {
        label: 'Users included',
        values: { starter: '1', growth: '2', professional: '5', advanced: '10' },
      },
      {
        label: 'Chart of accounts',
        values: { starter: true, growth: true, professional: true, advanced: true },
      },
      {
        label: 'Multi-currency support',
        values: { starter: false, growth: false, professional: true, advanced: true },
      },
      {
        label: 'Role-based permissions',
        values: { starter: false, growth: false, professional: true, advanced: true },
      },
      {
        label: 'Audit trail',
        values: { starter: false, growth: false, professional: true, advanced: true },
      },
    ],
  },
  {
    id: 'invoicing',
    name: 'Invoicing & payments',
    rows: [
      {
        label: 'Invoices & quotes',
        values: {
          starter: 'Unlimited',
          growth: 'Unlimited',
          professional: 'Unlimited',
          advanced: 'Unlimited',
        },
      },
      {
        label: 'Recurring invoices',
        values: { starter: false, growth: true, professional: true, advanced: true },
      },
      {
        label: 'Customer portal',
        values: { starter: false, growth: true, professional: true, advanced: true },
      },
      {
        label: 'Online payment collection',
        values: { starter: true, growth: true, professional: true, advanced: true },
      },
      {
        label: 'Payment reminders',
        values: { starter: true, growth: true, professional: true, advanced: true },
      },
    ],
  },
  {
    id: 'banking',
    name: 'Banking',
    rows: [
      {
        label: 'Bank feed connections',
        values: { starter: false, growth: true, professional: true, advanced: true },
      },
      {
        label: 'Bank reconciliation',
        values: { starter: false, growth: true, professional: true, advanced: true },
      },
      {
        label: 'Transaction rules',
        values: { starter: false, growth: false, professional: true, advanced: true },
      },
      {
        label: 'Multi-currency transactions',
        values: { starter: false, growth: false, professional: true, advanced: true },
      },
    ],
  },
  {
    id: 'reporting',
    name: 'Reporting & insights',
    rows: [
      {
        label: 'P&L and balance sheet',
        values: { starter: true, growth: true, professional: true, advanced: true },
      },
      {
        label: 'Custom reports',
        values: { starter: false, growth: true, professional: true, advanced: true },
      },
      {
        label: 'Budgets & cashflow forecasting',
        values: { starter: false, growth: false, professional: true, advanced: true },
      },
      {
        label: 'ValueBooks AI insights',
        values: { starter: false, growth: false, professional: true, advanced: true },
      },
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
