import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'platform-security-test', userAgent: 'platform-security-test' };

type EventRow = { eventKey: string; userEmail: string | null; metadata: Record<string, unknown> };

/**
 * Phase 5.4: the severity filter matches what emitters write, the account search works, and session
 * detail in event metadata is limited to superadmins (master plan §14.1).
 */
describe('platform security events', () => {
  let harness: TestHarness;
  let supportCookie: string;
  let superadminCookie: string;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const [subject, support, superadmin] = await Promise.all(
      [
        'Subject.Person@example.test',
        'security-support@example.test',
        'security-super@example.test',
      ].map((email) =>
        harness.prisma.user.create({
          data: { email, displayName: email, emailVerifiedAt: new Date(), status: 'ACTIVE' },
        }),
      ),
    );
    await harness.prisma.platformAdmin.createMany({
      data: [
        { userId: support!.id, role: 'SUPPORT' },
        { userId: superadmin!.id, role: 'SUPERADMIN' },
      ],
    });
    supportCookie = await cookieFor(support!.id);
    superadminCookie = await cookieFor(superadmin!.id);
    await harness.prisma.securityEvent.createMany({
      data: [
        {
          userId: subject!.id,
          eventKey: 'auth.login_failed',
          severity: 'WARNING',
          ipHash: 'a'.repeat(64),
          metadata: { reason: 'invalid_credentials' },
        },
        {
          userId: subject!.id,
          eventKey: 'auth.login_succeeded',
          ipHash: 'a'.repeat(64),
          metadata: { sessionId: 'session-row-id' },
        },
        { eventKey: 'auth.signup', metadata: { outcome: 'created' } },
      ],
    });
  });

  it('filters on the severity value emitters actually write', async () => {
    const response = await list(supportCookie, 'severity=WARNING');
    expect(response.map((row) => row.eventKey)).toEqual(['auth.login_failed']);
  });

  it('searches by part of the account email, ignoring case', async () => {
    const response = await list(supportCookie, 'actor=subject.person');
    expect(response.map((row) => row.eventKey).sort()).toEqual([
      'auth.login_failed',
      'auth.login_succeeded',
    ]);
    expect(response.every((row) => row.userEmail === 'Subject.Person@example.test')).toBe(true);
  });

  it('shows session detail to superadmins only and never returns the network hash', async () => {
    const asSupport = await list(supportCookie, 'eventKey=auth.login_succeeded');
    const asSuperadmin = await list(superadminCookie, 'eventKey=auth.login_succeeded');
    expect(asSupport[0]!.metadata).toEqual({});
    expect(asSuperadmin[0]!.metadata).toEqual({ sessionId: 'session-row-id' });
    for (const row of [...asSupport, ...asSuperadmin]) expect(row).not.toHaveProperty('ipHash');
    // Other recorded details are not withheld from support.
    const failed = await list(supportCookie, 'eventKey=auth.login_failed');
    expect(failed[0]!.metadata).toEqual({ reason: 'invalid_credentials' });
  });

  async function list(cookie: string, query: string): Promise<EventRow[]> {
    const response = await harness
      .http()
      .get(`${API}/platform/security-events?${query}`)
      .set('Cookie', cookie)
      .expect(200);
    return (response.body as { data: EventRow[] }).data;
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
