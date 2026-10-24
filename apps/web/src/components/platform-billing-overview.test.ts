import { describe, expect, it } from 'vitest';

import { ApiError } from '../lib/api';
import { resolveBillingReads } from './platform-billing-overview';

const overview = {
  activePaid: 1,
  trialing: 2,
  trialExpiring24h: 0,
  trialConversionRate: null,
  pastDue: 0,
  failedPayments: 0,
  failedWebhooks: 0,
  unresolvedChanges: 0,
  mrrMinorByCurrency: { USD: '100' },
  arrMinorByCurrency: { USD: '1200' },
  methodology: 'Test methodology.',
};

const fulfilledOverview = { status: 'fulfilled', value: { data: overview } } as const;

describe('resolveBillingReads', () => {
  it('keeps the SUPPORT overview and marks an expected revenue refusal separately', () => {
    const result = resolveBillingReads(fulfilledOverview, {
      status: 'rejected',
      reason: new ApiError('Forbidden', 403),
    });

    expect(result).toMatchObject({ overview, revenue: null, revenueState: 'forbidden', error: '' });
  });

  it('reports a genuine revenue load failure', () => {
    const result = resolveBillingReads(fulfilledOverview, {
      status: 'rejected',
      reason: new ApiError('Unavailable', 503),
    });

    expect(result.error).toContain('loading failure');
    expect(result.revenueState).toBe('loading');
  });

  it('keeps a successful response with no collections distinct from a refusal', () => {
    const revenue = { months: [] };
    const result = resolveBillingReads(fulfilledOverview, {
      status: 'fulfilled',
      value: { data: revenue },
    });

    expect(result).toMatchObject({ revenue, revenueState: 'ready', error: '' });
  });
});
