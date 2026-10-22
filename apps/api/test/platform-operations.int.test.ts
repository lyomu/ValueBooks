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
