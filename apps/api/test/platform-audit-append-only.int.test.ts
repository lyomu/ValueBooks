import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestHarness, type TestHarness } from './support/app.js';

/**
 * Phase 5.6 (D9): the platform audit log is append-only in the database, and deleting a grant
 * cannot take its audit history with it. The organization foreign key's own SET NULL still works,
 * so an organization can be purged while its audit rows keep their evidence.
 */
describe('platform audit append-only storage', () => {
  let harness: TestHarness;
  let grantId: string;
  let organizationId: string;
  let auditId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const admin = await harness.prisma.user.create({
      data: {
        email: 'append-only@example.test',
        displayName: 'Append Only',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const grant = await harness.prisma.platformAdmin.create({
      data: { userId: admin.id, role: 'SUPERADMIN' },
    });
    grantId = grant.id;
    const organization = await harness.prisma.organization.create({
      data: {
        legalName: 'Append Only Ltd',
        slug: 'append-only',
        countryCode: 'KE',
        baseCurrency: 'KES',
        timeZone: 'Africa/Nairobi',
        locale: 'en-KE',
        createdByUserId: admin.id,
      },
    });
    organizationId = organization.id;
    const audit = await harness.prisma.platformAuditEvent.create({
      data: {
        platformAdminId: grant.id,
        actorUserId: admin.id,
        eventKey: 'platform.organization_suspended',
        targetType: 'organization',
        targetId: organization.id,
        organizationId: organization.id,
        reason: 'Suspended while a chargeback is investigated.',
        before: { status: 'ACTIVE' },
        after: { status: 'SUSPENDED' },
      },
    });
    auditId = audit.id;
  });

  it('refuses to edit or delete an audit row', async () => {
    await expect(
      harness.prisma.platformAuditEvent.update({
        where: { id: auditId },
        data: { reason: 'Rewritten after the fact.' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.prisma.platformAuditEvent.delete({ where: { id: auditId } }),
    ).rejects.toThrow(/append-only/);
    // Clearing the organization together with any other change is still an edit.
    await expect(
      harness.prisma.platformAuditEvent.update({
        where: { id: auditId },
        data: { organizationId: null, reason: 'Rewritten after the fact.' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.prisma.platformAuditEvent.findUniqueOrThrow({ where: { id: auditId } }),
    ).resolves.toMatchObject({
      reason: 'Suspended while a chargeback is investigated.',
      organizationId,
    });
  });

  it('refuses to delete a grant that has audit history', async () => {
    await expect(harness.prisma.platformAdmin.delete({ where: { id: grantId } })).rejects.toThrow();
    await expect(harness.prisma.platformAuditEvent.count({ where: { id: auditId } })).resolves.toBe(
      1,
    );
  });

  it('still lets an organization be deleted, keeping the audit evidence', async () => {
    await harness.prisma.organization.delete({ where: { id: organizationId } });
    await expect(
      harness.prisma.platformAuditEvent.findUniqueOrThrow({ where: { id: auditId } }),
    ).resolves.toMatchObject({
      organizationId: null,
      targetId: organizationId,
      reason: 'Suspended while a chargeback is investigated.',
      before: { status: 'ACTIVE' },
      after: { status: 'SUSPENDED' },
    });
  });
});
