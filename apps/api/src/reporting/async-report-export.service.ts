import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ScheduledJobExecutionStatus,
  ScheduledJobMisfirePolicy,
  ScheduledJobStatus,
} from '@prisma/client';
import { REPORT_KEYS, type ReportKey } from '@valuebooks/contracts';
import { randomUUID } from 'node:crypto';

import { AutomationQueueService } from '../automation/automation-queue.service.js';
import { NotificationsService } from '../automation/notifications.service.js';
import { SchedulerService } from '../automation/scheduler.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { ReportExportQueryDto } from './reporting.dto.js';
import { ReportArtifactService } from './report-artifact.service.js';

const ASYNC_EXPORT_HANDLER = 'report.export';

/**
 * Durable, user-initiated report exports. We deliberately reuse the scheduler's immutable
 * execution ledger rather than keeping a second, ephemeral queue-status model: retries, tenant
 * scoping and failure evidence are identical to scheduled reports.
 */
@Injectable()
export class AsyncReportExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: AutomationQueueService,
    private readonly scheduler: SchedulerService,
    private readonly artifacts: ReportArtifactService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  async request(
    organizationId: string,
    userId: string,
    key: ReportKey,
    query: ReportExportQueryDto,
  ) {
    const jobId = randomUUID();
    const executionId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.scheduledJob.create({
        data: {
          id: jobId,
          organizationId,
          createdByUserId: userId,
          handler: ASYNC_EXPORT_HANDLER,
          sourceType: 'REPORT_EXPORT',
          sourceId: executionId,
          payload: {
            reportKey: key,
            // `query` is a validated DTO; round-tripping through JSON strips methods/undefined
            // so the stored payload is plain, replayable data, same as workflows.service.ts.
            query: JSON.parse(JSON.stringify(query)) as Prisma.InputJsonValue,
            requestedByUserId: userId,
          },
          // This job is enqueued directly and remains paused so the calendar scheduler can never
          // manufacture a duplicate occurrence.
          schedule: { cadence: 'DAILY', localTime: '00:00' },
          timeZone: 'UTC',
          misfirePolicy: ScheduledJobMisfirePolicy.RUN_ONCE,
          status: ScheduledJobStatus.PAUSED,
          nextRunAt: new Date(),
        },
      });
      await tx.scheduledJobExecution.create({
        data: {
          id: executionId,
          organizationId,
          scheduledJobId: jobId,
          occurrenceKey: `export-${executionId}`,
          status: ScheduledJobExecutionStatus.QUEUED,
        },
      });
    });
    await this.queue.enqueueScheduledExecution(executionId);
    return { executionId, status: 'QUEUED' as const };
  }

  async status(organizationId: string, executionId: string) {
    const execution = await this.prisma.scheduledJobExecution.findFirst({
      where: {
        id: executionId,
        organizationId,
        scheduledJob: { handler: ASYNC_EXPORT_HANDLER },
      },
      include: { scheduledJob: { select: { payload: true } } },
    });
    if (!execution) throw new NotFoundException('Report export not found.');
    const artifactKey = readArtifactKey(execution.result);
    return {
      id: execution.id,
      status: execution.status,
      error: execution.error,
      createdAt: execution.createdAt,
      completedAt: execution.completedAt,
      ...(artifactKey && execution.status === ScheduledJobExecutionStatus.SUCCEEDED
        ? { downloadUrl: await this.storage.getSignedDownloadUrl(artifactKey) }
        : {}),
    };
  }

  async execute(executionId: string): Promise<void> {
    const execution = await this.scheduler.beginExecution(executionId);
    if (!execution) return;
    try {
      if (execution.scheduledJob.handler !== ASYNC_EXPORT_HANDLER) {
        throw new Error(`Async report export cannot process ${execution.scheduledJob.handler}.`);
      }
      const input = readRequest(execution.scheduledJob.payload);
      const artifact = await this.artifacts.generate(
        execution.organizationId,
        input.reportKey,
        input.query,
        'pdf',
      );
      const key = `exports/reports/${execution.organizationId}/${execution.id}.${artifact.extension}`;
      await this.storage.ensureBucket();
      await this.storage.upload(key, artifact.buffer, artifact.contentType);
      await this.scheduler.completeExecution(execution.id, {
        artifactKey: key,
        reportKey: input.reportKey,
        format: artifact.extension,
      });
      await this.prisma
        .$transaction((tx) =>
          this.notifications.create(tx, {
            organizationId: execution.organizationId,
            recipientUserId: input.requestedByUserId,
            eventKey: 'reports.export_ready',
            title: 'Your report export is ready',
            body: `Your ${input.reportKey} PDF export is ready to download.`,
            href: `/organizations/${execution.organizationId}/reports/exports/${execution.id}`,
            metadata: { executionId: execution.id, reportKey: input.reportKey },
          }),
        )
        .catch(() => undefined);
    } catch (error) {
      await this.scheduler.failExecution(execution.id, error);
      throw error;
    }
  }
}

function readRequest(value: unknown): {
  reportKey: ReportKey;
  query: ReportExportQueryDto;
  requestedByUserId: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Async report export payload is invalid.');
  }
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.reportKey !== 'string' ||
    !REPORT_KEYS.includes(payload.reportKey as ReportKey)
  ) {
    throw new Error('Async report export has an unknown report key.');
  }
  if (!payload.query || typeof payload.query !== 'object' || Array.isArray(payload.query)) {
    throw new Error('Async report export has invalid filters.');
  }
  if (typeof payload.requestedByUserId !== 'string') {
    throw new Error('Async report export has no requester.');
  }
  return {
    reportKey: payload.reportKey as ReportKey,
    query: payload.query as ReportExportQueryDto,
    requestedByUserId: payload.requestedByUserId,
  };
}

function readArtifactKey(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const key = (value as Record<string, unknown>).artifactKey;
  return typeof key === 'string' ? key : undefined;
}
