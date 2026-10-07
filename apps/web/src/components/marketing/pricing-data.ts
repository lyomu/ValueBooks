/**
 * Placeholder plan catalog for the public marketing site. Names, prices, and feature lists are
 * illustrative — swap this file's contents for real commercial figures when they're finalized.
 * Both the homepage pricing teaser and the /pricing page read from here so they can't drift.
 */

export type Plan = {
  id: string;
  name: string;
  tagline: string;
  monthlyPriceUsd: number;
  /** Already-discounted annual total, not monthlyPriceUsd * 12. */
  yearlyPriceUsd: number;
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
    monthlyPriceUsd: 9,
    yearlyPriceUsd: 90,
    topFeatures: [
      '1 user',
      'Unlimited invoices & quotes',
      'Expense tracking',
      'Basic reports',
      'Email support',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For small teams who need banking and multi-user access.',
    monthlyPriceUsd: 19,
    yearlyPriceUsd: 190,
    topFeatures: [
      'Up to 3 users',
      'Bank feeds & reconciliation',
      'Recurring invoices',
      'Customer portal',
      'Standard reports',
      'Chat support',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    tagline: 'For growing businesses that need deeper reporting and roles.',
    monthlyPriceUsd: 39,
    yearlyPriceUsd: 390,
    highlighted: true,
    topFeatures: [
      'Up to 10 users',
      'Role-based access & audit trail',
      'Advanced reports & budgets',
      'Multi-currency (140+)',
      'ValueBooks AI assistant',
      'Priority support',
    ],
  },
  {
    id: 'advanced',
    name: 'Advanced',
    tagline: 'For established businesses with complex workflows.',
    monthlyPriceUsd: 79,
    yearlyPriceUsd: 790,
    topFeatures: [
      'Unlimited users',
      'Custom roles & approvals',
      'Advanced AI insights',
      'Dedicated account manager',
      'API access',
      'Priority + phone support',
    ],
    ctaLabel: 'Talk to sales',
    ctaHref: '/contact',
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
        values: { starter: '1', growth: '3', professional: '10', advanced: 'Unlimited' },
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
        values: { starter: 'Unlimited', growth: 'Unlimited', professional: 'Unlimited', advanced: 'Unlimited' },
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
