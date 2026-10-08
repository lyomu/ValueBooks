import type { NextConfig } from 'next';

/**
 * Routes that moved when configuration was consolidated behind /settings, and when the recurring
 * template pages became a tab on their parent listing. Kept permanently: these URLs were linked
 * from the product and may be bookmarked.
 */
const movedRoutes: ReadonlyArray<{ source: string; destination: string }> = [
  { source: '/tax', destination: '/settings/taxes' },
  { source: '/numbering', destination: '/settings/numbering' },
  { source: '/periods', destination: '/settings/fiscal-periods' },
  { source: '/automation/rules', destination: '/settings/workflow-rules' },
  { source: '/automation/reminders', destination: '/settings/reminders' },
  { source: '/recurring-invoices', destination: '/invoices?tab=recurring' },
  { source: '/recurring-bills', destination: '/bills?tab=recurring' },
  { source: '/recurring-expenses', destination: '/expenses?tab=recurring' },
  { source: '/recurring-journals', destination: '/journals?tab=recurring' },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  redirects: () => Promise.resolve(movedRoutes.map((route) => ({ ...route, permanent: true }))),
  output: 'standalone',
  transpilePackages: ['@valuebooks/contracts', '@valuebooks/localization', '@valuebooks/ui'],
  experimental: {
    cpus: 1,
    staticGenerationMaxConcurrency: 1,
  },
};

export default nextConfig;
