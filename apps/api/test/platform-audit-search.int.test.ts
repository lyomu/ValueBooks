import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'platform-audit-search', userAgent: 'platform-audit-search' };

type AuditRow = {
  eventKey: string;
  actorEmail: string;
  organizationId: string | null;
  organizationName: string | null;
};

/**
 * Phase 5.5: the platform audit log is searchable by administrator, action, tenant and UTC date
 * (master plan §14.2), and names the tenant an action concerned.
 */
describe('platform audit search', () => {
  let harness: TestHarness;
  let supportCookie: string;
  let organizationId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const [first, second] = await Promise.all(
      ['Audit.First@example.test', 'audit-second@example.test'].map((email) =>
        harness.prisma.user.create({
          data: { email, displayName: email, emailVerifiedAt: new Date(), status: 'ACTIVE' },
        }),
      ),
    );
    const [firstGrant, secondGrant] = await Promise.all([
      harness.prisma.platformAdmin.create({ data: { userId: first!.id, role: 'SUPPORT' } }),
      harness.prisma.platformAdmin.create({ data: { userId: second!.id, role: 'OPERATIONS' } }),
    ]);
    supportCookie = await cookieFor(first!.id);
    const organization = await harness.prisma.organization.create({
      data: {
        legalName: 'Audit Search Holdings Ltd',
        tradingName: 'Audit Search',
        slug: 'audit-search',
        countryCode: 'KE',
        baseCurrency: 'KES',
        timeZone: 'Africa/Nairobi',
        locale: 'en-KE',
        createdByUserId: first!.id,
      },
    });
    organizationId = organization.id;
    await harness.prisma.platformAuditEvent.createMany({
      data: [
        {
          platformAdminId: firstGrant.id,
          actorUserId: first!.id,
          eventKey: 'platform.organization_suspended',
          targetType: 'organization',
          targetId: organization.id,
          organizationId: organization.id,
          reason: 'Suspended while a chargeback is investigated.',
          before: { status: 'ACTIVE' },
          after: { status: 'SUSPENDED' },
          occurredAt: new Date('2026-03-01T23:30:00.000Z'),
        },
        {
          platformAdminId: secondGrant.id,
          actorUserId: second!.id,
          eventKey: 'platform.feature_flag_created',
          targetType: 'feature_flag',
          after: { key: 'audit.search', defaultEnabled: false },
          occurredAt: new Date('2026-03-02T00:30:00.000Z'),
        },
      ],
    });
  });

  it('finds actions by part of the administrator email, ignoring case', async () => {
    const rows = await search('actor=audit.first');
    expect(rows.map((row) => row.eventKey)).toEqual(['platform.organization_suspended']);
  });

  it('treats the date range as whole UTC days', async () => {
    expect((await search('from=2026-03-02')).map((row) => row.eventKey)).toEqual([
      'platform.feature_flag_created',
    ]);
    expect((await search('to=2026-03-01')).map((row) => row.eventKey)).toEqual([
      'platform.organization_suspended',
    ]);
    expect(await search('from=2026-03-03')).toEqual([]);
  });

  it('names the tenant an action concerned, and none for platform-wide changes', async () => {
    const rows = await search('');
    expect(rows.find((row) => row.organizationId === organizationId)?.organizationName).toBe(
      'Audit Search',
    );
    expect(
      rows.find((row) => row.eventKey === 'platform.feature_flag_created')?.organizationName,
    ).toBeNull();
    expect((await search(`organizationId=${organizationId}`)).length).toBe(1);
  });

  async function search(query: string): Promise<AuditRow[]> {
    const response = await harness
      .http()
      .get(`${API}/platform/audit?${query}`)
      .set('Cookie', supportCookie)
      .expect(200);
    return (response.body as { data: AuditRow[] }).data;
  }

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
});
