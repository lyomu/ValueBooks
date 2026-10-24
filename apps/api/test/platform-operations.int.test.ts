import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'platform-operations-test', userAgent: 'platform-operations-test' };

describe('platform operations acceptance', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let owner: PublicUser;
  let organizationId: string;
  let ownerCookie: string;
  let operationsCookie: string;
  let operatorUserId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const ownerRow = await harness.prisma.user.create({
      data: {
        email: 'suspension-owner@example.test',
        displayName: 'Suspension Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    owner = {
      id: ownerRow.id,
      email: ownerRow.email,
      displayName: ownerRow.displayName,
      emailVerified: true,
      status: ownerRow.status,
    };
    const created = await organizations.create(
      owner,
      { legalName: 'Suspension Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    await organizations.finalize(
      await access.requireMembership(owner.id, created.id),
      owner,
      metadata,
    );
    organizationId = created.id;
    ownerCookie = await cookieFor(owner.id);
    const operator = await harness.prisma.user.create({
      data: {
        email: 'operator@example.test',
        displayName: 'Operator',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    await harness.prisma.platformAdmin.create({
      data: { userId: operator.id, role: 'OPERATIONS' },
    });
    operationsCookie = await cookieFor(operator.id);
    operatorUserId = operator.id;
  });

  it('suspends without deleting tenant data, blocks tenant access, and restores it on reactivation', async () => {
    const before = await tenantFootprint();
    await harness
      .http()
      .post(`${API}/platform/organizations/${organizationId}/suspend`)
      .set('Cookie', operationsCookie)
      .send({ reason: 'Evidence suspension for verification.' })
      .expect(200);
    await harness
      .http()
      .get(`${API}/organizations/${organizationId}`)
      .set('Cookie', ownerCookie)
      .expect(403);
    expect(await tenantFootprint()).toEqual({ ...before, status: 'SUSPENDED' });
    await harness
      .http()
      .post(`${API}/platform/organizations/${organizationId}/reactivate`)
      .set('Cookie', operationsCookie)
      .send({ reason: 'Verification complete.' })
      .expect(200);
    await harness
      .http()
      .get(`${API}/organizations/${organizationId}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(await tenantFootprint()).toEqual({ ...before, status: 'ACTIVE' });
    const audit = await harness.prisma.platformAuditEvent.findMany({
      where: { organizationId },
      orderBy: { occurredAt: 'asc' },
      select: { eventKey: true, reason: true },
    });
    expect(audit).toEqual([
      {
        eventKey: 'platform.organization_suspended',
        reason: 'Evidence suspension for verification.',
      },
      { eventKey: 'platform.organization_reactivated', reason: 'Verification complete.' },
    ]);
  });

  it('reconciles analytics to direct counts and returns no monetary fields', async () => {
    const response = await harness
      .http()
      .get(`${API}/platform/analytics`)
      .set('Cookie', operationsCookie)
      .expect(200);
    const { data } = response.body as { data: Record<string, unknown> };
    expect(data.organizations).toMatchObject({
      total: await harness.prisma.organization.count(),
      active: await harness.prisma.organization.count({ where: { status: 'ACTIVE' } }),
    });
    expect(data.users).toMatchObject({
      total: await harness.prisma.user.count(),
      active: await harness.prisma.user.count({ where: { status: 'ACTIVE' } }),
    });
    expect(forbiddenMoneyKeys(data)).toEqual([]);
  });

  it('filters organizations by subscription and setup state and reports last activity', async () => {
    // A second tenant that never finishes setup.
    const draft = await organizations.create(
      owner,
      { legalName: 'Unfinished Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    type Listed = { id: string; memberCount: number; lastActivityAt: string | null };
    const list = async (query: string) => {
      const response = await harness
        .http()
        .get(`${API}/platform/organizations?${query}`)
        .set('Cookie', operationsCookie)
        .expect(200);
      return (response.body as { data: Listed[] }).data;
    };
    const ids = (rows: Listed[]) => rows.map((row) => row.id).sort();

    expect(ids(await list('onboarding=COMPLETE'))).toEqual([organizationId]);
    expect(ids(await list('onboarding=INCOMPLETE'))).toEqual([draft.id]);

    const unsubscribed = await harness.prisma.organization.findMany({
      where: { subscription: { is: null } },
      select: { id: true },
    });
    expect(unsubscribed.length).toBeGreaterThan(0);
    expect(ids(await list('subscriptionStatus=NONE'))).toEqual(
      unsubscribed.map((row) => row.id).sort(),
    );
    // Plan and subscription state constrain the same relation: they must combine, not replace.
    expect(await list('subscriptionStatus=NONE&planKey=professional')).toEqual([]);
    await harness
      .http()
      .get(`${API}/platform/organizations?subscriptionStatus=PAID`)
      .set('Cookie', operationsCookie)
      .expect(400);

    const [listed] = (await list('onboarding=COMPLETE')) as [Listed];
    const latest = await harness.prisma.auditEvent.findFirst({
      where: { organizationId },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    expect(listed.lastActivityAt).toBe(latest?.occurredAt.toISOString() ?? null);
    expect(listed.memberCount).toBe(
      await harness.prisma.organizationMember.count({
        where: { organizationId, status: 'ACTIVE' },
      }),
    );
  });

  it('separates platform access from organization roles and counts live sessions exactly', async () => {
    type Listed = { id: string; platformRole: string | null };
    const list = async (query: string) => {
      const response = await harness
        .http()
        .get(`${API}/platform/users?${query}`)
        .set('Cookie', operationsCookie)
        .expect(200);
      return (response.body as { data: Listed[] }).data;
    };
    const admins = await list('platformAccess=ADMIN');
    expect(admins.map((row) => row.platformRole)).toEqual(['OPERATIONS']);
    const others = await list('platformAccess=NONE');
    expect(others.map((row) => row.id)).toContain(owner.id);
    expect(others.every((row) => row.platformRole === null)).toBe(true);

    // The owner holds a session (from `cookieFor`) plus one that has already expired.
    await harness.prisma.session.create({
      data: {
        userId: owner.id,
        tokenHash: hashToken(createOpaqueToken()),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const detail = await harness
      .http()
      .get(`${API}/platform/users/${owner.id}`)
      .set('Cookie', operationsCookie)
      .expect(200);
    const { data } = detail.body as {
      data: {
        platformRole: string | null;
        activeSessionCount: number;
        activeSessions: Array<{ lastSeenAt: string }>;
      };
    };
    expect(data.platformRole).toBeNull();
    expect(data.activeSessionCount).toBe(
      await harness.prisma.session.count({
        where: { userId: owner.id, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    );
    expect(data.activeSessions).toHaveLength(data.activeSessionCount);
    expect(data.activeSessions[0]?.lastSeenAt).toEqual(expect.any(String));
  });

  // O4: an account status change revokes every live session, so who may be targeted matters as
  // much as who may call the endpoint.
  it('refuses a status change on the acting administrator and on console accounts below superadmin', async () => {
    const statusOf = (userId: string) =>
      harness.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } });

    const self = await harness
      .http()
      .patch(`${API}/platform/users/${operatorUserId}/status`)
      .set('Cookie', operationsCookie)
      .send({ status: 'SUSPENDED', reason: 'Attempting to suspend my own account.' })
      .expect(400);
    expect((self.body as { error: { message: string } }).error.message).toContain(
      'your own account',
    );
    expect(await statusOf(operatorUserId)).toEqual({ status: 'ACTIVE' });

    // A second console account: OPERATIONS may not touch it, a superadmin may.
    const colleague = await harness.prisma.user.create({
      data: {
        email: 'console-colleague@example.test',
        displayName: 'Console Colleague',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    await harness.prisma.platformAdmin.create({
      data: { userId: colleague.id, role: 'SUPERADMIN' },
    });
    await harness
      .http()
      .patch(`${API}/platform/users/${colleague.id}/status`)
      .set('Cookie', operationsCookie)
      .send({ status: 'SUSPENDED', reason: 'Operator attempting to suspend a superadmin.' })
      .expect(403);
    expect(await statusOf(colleague.id)).toEqual({ status: 'ACTIVE' });
    expect(
      await harness.prisma.platformAuditEvent.count({
        where: { eventKey: 'platform.user_status_changed' },
      }),
    ).toBe(0);

    const superadmin = await harness.prisma.user.create({
      data: {
        email: 'console-superadmin@example.test',
        displayName: 'Console Superadmin',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    await harness.prisma.platformAdmin.create({
      data: { userId: superadmin.id, role: 'SUPERADMIN' },
    });
    await harness
      .http()
      .patch(`${API}/platform/users/${colleague.id}/status`)
      .set('Cookie', await cookieFor(superadmin.id))
      .send({ status: 'SUSPENDED', reason: 'Superadmin suspending another console account.' })
      .expect(200);
    expect(await statusOf(colleague.id)).toEqual({ status: 'SUSPENDED' });

    // A tenant account with no console access stays an ordinary OPERATIONS action.
    await harness
      .http()
      .patch(`${API}/platform/users/${owner.id}/status`)
      .set('Cookie', operationsCookie)
      .send({ status: 'SUSPENDED', reason: 'Ordinary tenant account suspension.' })
      .expect(200);
    expect(await statusOf(owner.id)).toEqual({ status: 'SUSPENDED' });
  });

  it('reports period comparison, growth series and attention counts honestly', async () => {
    // A stalled signup (older than 7 days, setup never finished) and a failed scheduled job, so
    // the attention queue has something real to report.
    const stalled = await harness.prisma.organization.create({
      data: {
        legalName: 'Stalled Books Ltd',
        slug: `stalled-${Date.now()}`,
        countryCode: 'KE',
        baseCurrency: 'KES',
        timeZone: 'Africa/Nairobi',
        locale: 'en-KE',
        status: 'DRAFT',
        createdByUserId: owner.id,
        createdAt: new Date(Date.now() - 30 * 86_400_000),
      },
    });

    const response = await harness
      .http()
      .get(`${API}/platform/analytics?from=2026-10-01&to=2026-10-31`)
      .set('Cookie', operationsCookie)
      .expect(200);
    const { data } = response.body as {
      data: {
        previousPeriod: {
          from: string;
          to: string;
          hasData: boolean;
          organizationsCreated: number;
        };
        reporting: {
          from: string;
          to: string;
          growth: { key: string; organizations: number; activated: number }[];
        };
        attention: Record<string, number>;
      };
    };

    // The previous window is the same length and ends immediately before the selected one.
    expect(new Date(data.previousPeriod.to).getTime()).toBeLessThan(
      new Date(data.reporting.from).getTime(),
    );
    const selectedMs =
      new Date(data.reporting.to).getTime() - new Date(data.reporting.from).getTime();
    const previousMs =
      new Date(data.previousPeriod.to).getTime() - new Date(data.previousPeriod.from).getTime();
    expect(Math.abs(selectedMs - previousMs)).toBeLessThanOrEqual(1);
    // An empty earlier window must say so, so a KPI shows no change rather than inventing one.
    expect(data.previousPeriod.hasData).toBe(data.previousPeriod.organizationsCreated > 0);

    // Growth buckets are ordered and never negative; every bucket carries both series.
    const keys = data.reporting.growth.map((bucket) => bucket.key);
    expect([...keys].sort((a, b) => a.localeCompare(b))).toEqual(keys);
    for (const bucket of data.reporting.growth) {
      expect(bucket.organizations).toBeGreaterThanOrEqual(0);
      expect(bucket.activated).toBeGreaterThanOrEqual(0);
    }

    expect(data.attention).toMatchObject({
      stalledOnboarding: await harness.prisma.organization.count({
        where: {
          status: 'DRAFT',
          onboardingCompletedAt: null,
          createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) },
        },
      }),
      failedWebhooks: await harness.prisma.billingWebhookEvent.count({
        where: { processingState: 'FAILED' },
      }),
      suspendedOrganizations: await harness.prisma.organization.count({
        where: { status: 'SUSPENDED' },
      }),
    });
    expect(data.attention.stalledOnboarding).toBeGreaterThanOrEqual(1);
    expect(forbiddenMoneyKeys(data)).toEqual([]);

    await harness.prisma.organization.delete({ where: { id: stalled.id } });
  });

  async function cookieFor(userId: string): Promise<string> {
    const token = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${token}`;
  }

  async function tenantFootprint() {
    const [organization, members, preferences, accounts] = await Promise.all([
      harness.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { status: true, legalName: true },
      }),
      harness.prisma.organizationMember.count({ where: { organizationId } }),
      harness.prisma.organizationPreference.count({ where: { organizationId } }),
      harness.prisma.ledgerAccount.count({ where: { organizationId } }),
    ]);
    return {
      status: organization.status,
      legalName: organization.legalName,
      members,
      preferences,
      accounts,
    };
  }
});

function forbiddenMoneyKeys(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  const problems: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (/^(amount|balance|price|priceMinor|currency|totalMinor)$/i.test(key))
      problems.push(childPath);
    problems.push(...forbiddenMoneyKeys(child, childPath));
  }
  return problems;
}
