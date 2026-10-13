import { describe, expect, it, vi } from 'vitest';

import { EntitlementsService } from '../src/platform/entitlements.service';

describe('EntitlementsService.isOrganizationFlagExplicitlyEnabled', () => {
  it('ignores default and broad rollout scopes for hosted egress', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      status: 'ACTIVE',
      defaultEnabled: true,
      rules: [{ enabled: false }],
    });
    const service = new EntitlementsService({
      featureFlag: { findUnique },
    } as never);

    await expect(
      service.isOrganizationFlagExplicitlyEnabled('organization-1', 'phase13.hosted_ai_egress'),
    ).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledWith({
      where: { key: 'phase13.hosted_ai_egress' },
      select: {
        status: true,
        rules: {
          where: { scope: 'ORGANIZATION', organizationId: 'organization-1' },
          select: { enabled: true },
        },
      },
    });
  });

  it('requires an active flag and an enabled organization rule', async () => {
    const findUnique = vi.fn().mockResolvedValue({ status: 'ACTIVE', rules: [{ enabled: true }] });
    const service = new EntitlementsService({ featureFlag: { findUnique } } as never);

    await expect(
      service.isOrganizationFlagExplicitlyEnabled('organization-1', 'phase13.hosted_ai_egress'),
    ).resolves.toBe(true);
  });
});
