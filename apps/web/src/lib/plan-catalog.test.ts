import { describe, expect, it } from 'vitest';

import {
  approvedAllowance,
  describeAllowance,
  enforcedAllowance,
  sameAllowance,
} from './plan-catalog';

const plan = (key: string, enabled: boolean, limitValue: number | null) => ({
  entitlements: [{ key, enabled, limitValue }],
});

describe('plan catalog drift checks', () => {
  it('treats a disabled row and a zero limit as the same "not included"', () => {
    const disabled = enforcedAllowance(plan('projects.enabled', false, null), 'projects.enabled');
    const zero = enforcedAllowance(plan('projects.enabled', true, 0), 'projects.enabled');
    expect(sameAllowance(disabled, zero)).toBe(true);
    expect(sameAllowance(zero, approvedAllowance('starter', 'projects.enabled'))).toBe(true);
  });

  it('flags an enforced cap that differs from the approved catalog', () => {
    const enforced = enforcedAllowance(plan('quotes.max', true, 50), 'quotes.max');
    const approved = approvedAllowance('professional', 'quotes.max');
    expect(approved).toEqual({ included: true, limit: null });
    expect(sameAllowance(enforced, approved)).toBe(false);
  });

  it('treats a missing row as different from anything the catalog sells', () => {
    const missing = enforcedAllowance(plan('other.key', true, 1), 'seats.max');
    expect(missing).toBeUndefined();
    expect(sameAllowance(missing, approvedAllowance('growth', 'seats.max'))).toBe(false);
    expect(describeAllowance(missing, false)).toBe('No row');
  });

  it('reads uncapped features as included and uncapped limits as unlimited', () => {
    const uncapped = { included: true, limit: null };
    expect(describeAllowance(uncapped, true)).toBe('Included');
    expect(describeAllowance(uncapped, false)).toBe('Unlimited');
    expect(approvedAllowance('advanced', 'custom_roles.enabled')).toEqual(uncapped);
    expect(approvedAllowance('starter', 'custom_roles.enabled')).toEqual({
      included: false,
      limit: null,
    });
  });
});
