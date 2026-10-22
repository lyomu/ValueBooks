import { ScheduledJobExecutionStatus } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { SchedulerService } from '../src/automation/scheduler.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'platform-jobs-test', userAgent: 'platform-jobs-test' };

/**
 * Phase 5.3: a retry records why, two retries racing on one failed execution re-queue it once, and
 * queue health states the scope of every figure (D10).
 */
describe('platform jobs and queues', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let scheduler: SchedulerService;
  let owner: PublicUser;
  let organizationId: string;
  let operationsCookie: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    scheduler = harness.app.get(SchedulerService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const [ownerRow, operator] = await Promise.all([
      harness.prisma.user.create({
        data: {
          email: 'jobs-owner@example.test',
          displayName: 'Jobs Owner',
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
      harness.prisma.user.create({
        data: {
          email: 'jobs-operator@example.test',
          displayName: 'Jobs Operator',
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
    ]);
    owner = {
      id: ownerRow.id,
      email: ownerRow.email,
      displayName: ownerRow.displayName,
      emailVerified: true,
      status: ownerRow.status,
    };
    await harness.prisma.platformAdmin.create({
      data: { userId: operator.id, role: 'OPERATIONS' },
    });
    operationsCookie = await cookieFor(operator.id);
    const organization = await organizations.create(
      owner,
      { legalName: 'Jobs Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    await organizations.finalize(
      await access.requireMembership(owner.id, organization.id),
      owner,
      metadata,
    );
    organizationId = organization.id;
  });

  it('refuses a retry without a reason and leaves the execution failed', async () => {
    const executionId = await createFailedExecution();
    await harness
      .http()
      .post(`${API}/platform/jobs/${executionId}/retry`)
      .set('Cookie', operationsCookie)
      .expect(400);
    await expect(
      harness.prisma.scheduledJobExecution.findUniqueOrThrow({ where: { id: executionId } }),
    ).resolves.toMatchObject({ status: ScheduledJobExecutionStatus.FAILED });
  });

  it('re-queues a failed execution once when two retries race', async () => {
    const executionId = await createFailedExecution();
    const retry = () =>
      harness
        .http()
        .post(`${API}/platform/jobs/${executionId}/retry`)
        .set('Cookie', operationsCookie)
        .send({ reason: 'Report delivery fixed upstream.' });
    const statuses = (await Promise.all([retry(), retry()])).map((response) => response.status);
    expect(statuses.sort()).toEqual([200, 409]);
    await expect(
      harness.prisma.scheduledJobExecution.findUniqueOrThrow({ where: { id: executionId } }),
    ).resolves.toMatchObject({ status: ScheduledJobExecutionStatus.QUEUED, error: null });
    // One reset means one tenant audit row and one platform audit row, with the reason.
    await expect(
      harness.prisma.auditEvent.count({
        where: { entityId: executionId, eventKey: 'automation.job_execution_retried' },
      }),
    ).resolves.toBe(1);
    await expect(
      harness.prisma.platformAuditEvent.findMany({
        where: { targetId: executionId, eventKey: 'platform.job_retried' },
        select: { reason: true },
      }),
    ).resolves.toEqual([{ reason: 'Report delivery fixed upstream.' }]);
  });

  it('labels queue and scheduler figures with their scope and finds overdue work', async () => {
    await createJob('2000-01-01T09:00:00.000Z');
    await createJob('2099-06-01T09:00:00.000Z');
    const health = (
      await harness
        .http()
        .get(`${API}/platform/jobs/health`)
        .set('Cookie', operationsCookie)
        .expect(200)
    ).body as {
      data: {
        oldestWaitingAt: { automation: string | null; email: string | null };
        scheduler: {
          dueNow: number;
          overdue: number;
          overdueAfterMinutes: number;
          nextRunAt: string | null;
        };
      };
    };
    const expectedOverdue = await harness.prisma.scheduledJob.count({
      where: { status: 'ACTIVE', nextRunAt: { lte: new Date(Date.now() - 15 * 60_000) } },
    });
    const expectedNext = await harness.prisma.scheduledJob.findFirst({
      where: { status: 'ACTIVE', nextRunAt: { gt: new Date() } },
      orderBy: { nextRunAt: 'asc' },
    });
    expect(health.data.scheduler).toMatchObject({
      overdue: expectedOverdue,
      overdueAfterMinutes: 15,
      nextRunAt: expectedNext?.nextRunAt?.toISOString() ?? null,
    });
    expect(health.data.scheduler.overdue).toBeGreaterThan(0);
    expect(health.data.scheduler.dueNow).toBeGreaterThanOrEqual(health.data.scheduler.overdue);
    expect(Object.keys(health.data.oldestWaitingAt).sort()).toEqual(['automation', 'email']);

    await harness
      .http()
      .get(`${API}/platform/jobs/queues/email/failed`)
      .set('Cookie', operationsCookie)
      .expect(200);
    await harness
      .http()
      .get(`${API}/platform/jobs/queues/payments/failed`)
      .set('Cookie', operationsCookie)
      .expect(400);
  });

  async function createJob(nextRunAt: string): Promise<string> {
    const job = await scheduler.createJob({
      organizationId,
      createdByUserId: owner.id,
      handler: 'SCHEDULED_REPORT',
      sourceType: 'SCHEDULED_REPORT',
      sourceId: crypto.randomUUID(),
      schedule: { cadence: 'DAILY', localTime: '09:00' },
      timeZone: 'Africa/Nairobi',
    });
    await harness.prisma.scheduledJob.update({
      where: { id: job.id },
      data: { nextRunAt: new Date(nextRunAt) },
    });
    return job.id;
  }

  async function createFailedExecution(): Promise<string> {
    const context = await access.requireMembership(owner.id, organizationId);
    const jobId = await createJob('2099-01-01T09:00:00.000Z');
    const execution = await harness.prisma.scheduledJobExecution.create({
      data: {
        organizationId: context.id,
        scheduledJobId: jobId,
        occurrenceKey: '2099-01-01T09:00:00.000Z',
        status: ScheduledJobExecutionStatus.FAILED,
        startedAt: new Date('2099-01-01T09:00:01.000Z'),
        completedAt: new Date('2099-01-01T09:00:02.000Z'),
        attempts: 1,
        error: 'Jobs retry fixture failed.',
      },
    });
    return execution.id;
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
