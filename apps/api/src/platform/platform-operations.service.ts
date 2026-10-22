import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AutomationQueueService } from '../automation/automation-queue.service.js';
import { SchedulerService } from '../automation/scheduler.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { EmailQueueService } from '../jobs/email-queue.service.js';
import { writePlatformAudit } from './platform-audit.js';
import type { PlatformContext } from './platform-context.js';
import type {
  FailedJobSearchDto,
  PlatformAnalyticsQueryDto,
  PlatformAuditSearchDto,
  SecurityEventSearchDto,
} from './platform.dto.js';

const DEFAULT_PAGE_SIZE = 25;

/**
 * Operational visibility across every tenant: queue health, failed scheduled work, the security
 * feed, and the platform's own audit log.
 *
 * The tenant-scoped equivalents already exist — `AutomationJobsController` shows one organization
 * its own failures, and `AuditLogController` shows one organization its own history. What is new
 * here is the cross-tenant view, which is exactly the thing an organization permission must never
 * be able to reach.
 */
@Injectable()
export class PlatformOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly automationQueue: AutomationQueueService,
    private readonly emailQueue: EmailQueueService,
  ) {}

  /**
   * Queue depth plus the database's own view of scheduled work. The two disagree in a meaningful
   * way when they disagree at all: BullMQ knows what is enqueued right now, while the execution
   * table knows what was supposed to happen. A backlog in one and not the other is the signal an
   * operator is looking for.
   */
  async queueHealth() {
    const [automation, email, dueNow, failedLastDay, runningNow] = await Promise.all([
      this.automationQueue.counts(),
      this.emailQueue.counts(),
      this.prisma.scheduledJob.count({
        where: { status: 'ACTIVE', nextRunAt: { lte: new Date() } },
      }),
      this.prisma.scheduledJobExecution.count({
        where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 86_400_000) } },
      }),
      this.prisma.scheduledJobExecution.count({ where: { status: 'RUNNING' } }),
    ]);
    return {
      queues: { automation, email },
      scheduler: { dueNow, failedLastDay, runningNow },
      observedAt: new Date().toISOString(),
    };
  }

  async failedJobs(query: FailedJobSearchDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.ScheduledJobExecutionWhereInput = {
      status: 'FAILED',
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    };
    const [totalRows, rows] = await Promise.all([
      this.prisma.scheduledJobExecution.count({ where }),
      this.prisma.scheduledJobExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          organizationId: true,
          occurrenceKey: true,
          attempts: true,
          error: true,
          createdAt: true,
          completedAt: true,
          scheduledJob: { select: { handler: true, sourceType: true, sourceId: true } },
          organization: { select: { legalName: true, tradingName: true } },
        },
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        organizationName: row.organization.tradingName ?? row.organization.legalName,
        handler: row.scheduledJob.handler,
        sourceType: row.scheduledJob.sourceType,
        sourceId: row.scheduledJob.sourceId,
        occurrenceKey: row.occurrenceKey,
        attempts: row.attempts,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
      })),
      pagination: { page, pageSize, totalRows },
    };
  }

  /**
   * Retries one failed execution. The work itself is done by the same `SchedulerService` a tenant
   * administrator would use, with the tenant read from the execution row rather than from the
   * caller — a platform operator has no organization context of their own to supply.
   */
  async retryJob(actor: PlatformContext, executionId: string, ipHash: string | null) {
    const execution = await this.prisma.scheduledJobExecution.findUnique({
      where: { id: executionId },
      select: { id: true, organizationId: true, status: true },
    });
    if (!execution) throw new NotFoundException('Job execution not found.');

    const result = await this.scheduler.retryExecution(
      execution.organizationId,
      // The scheduler records who retried the work. A platform operator is a real, verified user,
      // so the PublicUser it wants is assembled from the grant rather than from a membership.
      {
        id: actor.userId,
        email: actor.email,
        displayName: actor.displayName,
        emailVerified: true,
        status: 'ACTIVE',
      },
      executionId,
      { ipHash: ipHash ?? '', userAgent: 'ValueBooks platform console' },
    );
    await this.prisma.$transaction((tx) =>
      writePlatformAudit(tx, actor, {
        eventKey: 'platform.job_retried',
        targetType: 'scheduled_job_execution',
        targetId: executionId,
        organizationId: execution.organizationId,
        before: { status: execution.status },
        ipHash,
      }),
    );
    return result;
  }

  async securityEvents(query: SecurityEventSearchDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.SecurityEventWhereInput = {
      ...(query.eventKey ? { eventKey: query.eventKey } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to
                ? { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) }
                : {}),
            },
          }
        : {}),
    };
    const [totalRows, rows] = await Promise.all([
      this.prisma.securityEvent.count({ where }),
      this.prisma.securityEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          eventKey: true,
          severity: true,
          occurredAt: true,
          metadata: true,
          user: { select: { id: true, email: true } },
          organization: { select: { id: true, legalName: true, tradingName: true } },
        },
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        eventKey: row.eventKey,
        severity: row.severity,
        occurredAt: row.occurredAt.toISOString(),
        metadata: row.metadata,
        userId: row.user?.id ?? null,
        userEmail: row.user?.email ?? null,
        organizationId: row.organization?.id ?? null,
        organizationName: row.organization
          ? (row.organization.tradingName ?? row.organization.legalName)
          : null,
      })),
      pagination: { page, pageSize, totalRows },
    };
  }

  /** The platform's own audit trail — who did what in the console, and why. */
  async platformAudit(query: PlatformAuditSearchDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.PlatformAuditEventWhereInput = {
      ...(query.eventKey ? { eventKey: query.eventKey } : {}),
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    };
    const [totalRows, rows] = await Promise.all([
      this.prisma.platformAuditEvent.count({ where }),
      this.prisma.platformAuditEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          eventKey: true,
          targetType: true,
          targetId: true,
          organizationId: true,
          reason: true,
          before: true,
          after: true,
          occurredAt: true,
          actor: { select: { email: true, displayName: true } },
          platformAdmin: { select: { role: true } },
        },
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        eventKey: row.eventKey,
        targetType: row.targetType,
        targetId: row.targetId,
        organizationId: row.organizationId,
        reason: row.reason,
        before: row.before,
        after: row.after,
        actorEmail: row.actor.email,
        actorName: row.actor.displayName,
        actorRole: row.platformAdmin.role,
        occurredAt: row.occurredAt.toISOString(),
      })),
      pagination: { page, pageSize, totalRows },
    };
  }

  /**
   * Product analytics: activation and module adoption across the platform.
   *
   * Every figure is a count of rows or organizations. Nothing here reads a monetary column, and
   * that is a deliberate constraint rather than an omission — "how much did tenants invoice" is
   * exactly the question a platform console must not be able to answer casually. Adoption is
   * measured by whether a module has been used at all, which needs no amounts.
   */
  async analytics(query: PlatformAnalyticsQueryDto) {
    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * 86_400_000);
    const ninetyDaysAgo = new Date(now - 90 * 86_400_000);
    const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : thirtyDaysAgo;
    const to = query.to
      ? new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000 - 1)
      : new Date(now);
    const createdInPeriod = { gte: from, lte: to };
    const rangeDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
    const grouping = rangeDays <= 31 ? 'day' : rangeDays <= 120 ? 'week' : 'month';
    // The immediately preceding window of the same length, so a KPI can state its change honestly
    // -- or say nothing at all when there is no earlier window to compare against.
    const periodMs = to.getTime() - from.getTime();
    const previousFrom = new Date(from.getTime() - periodMs - 1);
    const previousTo = new Date(from.getTime() - 1);
    const createdInPreviousPeriod = { gte: previousFrom, lte: previousTo };
    const dayAgo = new Date(now - 86_400_000);
    const dayAhead = new Date(now + 86_400_000);

    const [
      totalOrganizations,
      activeOrganizations,
      suspendedOrganizations,
      draftOrganizations,
      newInPeriod,
      totalUsers,
      activeUsers,
      newUsersInPeriod,
      activatedOrganizations,
      byCountry,
      byPlan,
      invoicing,
      banking,
      inventory,
      projects,
      portals,
      automation,
      activeLast30,
      activeLast90,
      registrationRows,
      activationRows,
      previousNewOrganizations,
      previousNewUsers,
      previousActivated,
      failedJobsLast24Hours,
      stalledOnboarding,
      failedWebhooks,
      highSeveritySecurityEvents,
      recentActivity,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { status: 'ACTIVE' } }),
      this.prisma.organization.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.organization.count({ where: { status: 'DRAFT' } }),
      this.prisma.organization.count({ where: { createdAt: createdInPeriod } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { createdAt: createdInPeriod } }),
      // Activation: onboarding finished. The first real question about any tenant.
      this.prisma.organization.count({ where: { onboardingCompletedAt: { not: null } } }),
      this.prisma.organization.groupBy({ by: ['countryCode'], _count: { _all: true } }),
      this.prisma.organizationSubscription.groupBy({ by: ['planId'], _count: { _all: true } }),
      distinctOrganizations(
        this.prisma.invoice.findMany({
          where: { status: { not: 'DRAFT' } },
          select: { organizationId: true },
          distinct: ['organizationId'],
        }),
      ),
      distinctOrganizations(
        this.prisma.reconciliation.findMany({
          select: { organizationId: true },
          distinct: ['organizationId'],
        }),
      ),
      distinctOrganizations(
        this.prisma.inventoryAdjustment.findMany({
          select: { organizationId: true },
          distinct: ['organizationId'],
        }),
      ),
      distinctOrganizations(
        this.prisma.project.findMany({
          select: { organizationId: true },
          distinct: ['organizationId'],
        }),
      ),
      distinctOrganizations(
        this.prisma.portalUser.findMany({
          where: { status: 'ACTIVE' },
          select: { organizationId: true },
          distinct: ['organizationId'],
        }),
      ),
      distinctOrganizations(
        this.prisma.scheduledJob.findMany({
          select: { organizationId: true },
          distinct: ['organizationId'],
        }),
      ),
      // Retention proxy: a tenant whose audit trail shows activity in the window. Audit rows are
      // written for every state change, so they are the closest thing to a usage heartbeat that
      // already exists, and counting them needs no financial data.
      distinctOrganizations(
        this.prisma.auditEvent.findMany({
          where: { occurredAt: { gte: thirtyDaysAgo }, organizationId: { not: null } },
          select: { organizationId: true },
          distinct: ['organizationId'],
        }),
      ),
      distinctOrganizations(
        this.prisma.auditEvent.findMany({
          where: { occurredAt: { gte: ninetyDaysAgo }, organizationId: { not: null } },
          select: { organizationId: true },
          distinct: ['organizationId'],
        }),
      ),
      this.prisma.organization.findMany({
        where: { createdAt: createdInPeriod },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.organization.findMany({
        where: { onboardingCompletedAt: createdInPeriod },
        select: { onboardingCompletedAt: true },
        orderBy: { onboardingCompletedAt: 'asc' },
      }),
      this.prisma.organization.count({ where: { createdAt: createdInPreviousPeriod } }),
      this.prisma.user.count({ where: { createdAt: createdInPreviousPeriod } }),
      this.prisma.organization.count({
        where: { onboardingCompletedAt: createdInPreviousPeriod },
      }),
      this.prisma.scheduledJobExecution.count({
        where: { status: 'FAILED', createdAt: { gte: dayAgo } },
      }),
      // Signed up, never finished setup, and old enough that it is a stall rather than a tenant
      // still filling the form.
      this.prisma.organization.count({
        where: {
          status: 'DRAFT',
          onboardingCompletedAt: null,
          createdAt: { lt: new Date(now - 7 * 86_400_000) },
        },
      }),
      this.prisma.billingWebhookEvent.count({ where: { processingState: 'FAILED' } }),
      this.prisma.securityEvent.count({
        where: { severity: { in: ['WARNING', 'ERROR', 'CRITICAL'] }, occurredAt: { gte: dayAgo } },
      }),
      this.prisma.platformAuditEvent.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 6,
        select: { id: true, eventKey: true, occurredAt: true },
      }),
    ]);

    const plans = await this.prisma.plan.findMany({ select: { id: true, key: true, name: true } });
    const planName = new Map(plans.map((plan) => [plan.id, plan.name]));

    const registrations = bucketSeries(
      registrationRows.map((row) => row.createdAt),
      grouping,
    );
    // One series per bucket so the chart can draw registrations against activations without the
    // client joining two lists by label.
    const activations = new Map(
      bucketSeries(
        activationRows.flatMap((row) =>
          row.onboardingCompletedAt ? [row.onboardingCompletedAt] : [],
        ),
        grouping,
      ).map((bucket) => [bucket.key, bucket.organizations]),
    );
    const growth = registrations.map((bucket) => ({
      ...bucket,
      activated: activations.get(bucket.key) ?? 0,
    }));
    for (const [key, activated] of activations) {
      if (!registrations.some((bucket) => bucket.key === key))
        growth.push({ key, label: key, organizations: 0, activated });
    }
    growth.sort((a, b) => a.key.localeCompare(b.key));

    const trialsExpiringSoon = await this.prisma.organizationSubscription.count({
      where: { status: 'TRIALING', trialEndsAt: { gte: new Date(now), lte: dayAhead } },
    });

    return {
      organizations: {
        total: totalOrganizations,
        active: activeOrganizations,
        suspended: suspendedOrganizations,
        draft: draftOrganizations,
        createdInPeriod: newInPeriod,
      },
      users: { total: totalUsers, active: activeUsers, createdInPeriod: newUsersInPeriod },
      // `null` where the preceding window holds no data at all: a KPI then shows no change rather
      // than an invented +100%.
      previousPeriod: {
        from: previousFrom.toISOString(),
        to: previousTo.toISOString(),
        organizationsCreated: previousNewOrganizations,
        usersCreated: previousNewUsers,
        organizationsActivated: previousActivated,
        hasData: previousNewOrganizations + previousNewUsers + previousActivated > 0,
      },
      activation: {
        onboardingCompleted: activatedOrganizations,
        onboardingCompletedRate: rate(activatedOrganizations, totalOrganizations),
        reachedFirstInvoice: invoicing,
        reachedFirstInvoiceRate: rate(invoicing, totalOrganizations),
      },
      adoption: {
        invoicing,
        banking,
        inventory,
        projects,
        portals,
        automation,
      },
      retention: {
        activeLast30Days: activeLast30,
        activeLast90Days: activeLast90,
        // Against every organization, not only ACTIVE ones: a tenant still in setup or suspended
        // can have recorded activity, which against the smaller base produced rates above 100%.
        activeLast30DaysRate: rate(activeLast30, totalOrganizations),
      },
      distribution: {
        byCountry: byCountry
          .map((row) => ({ countryCode: row.countryCode, organizations: row._count._all }))
          .sort((a, b) => b.organizations - a.organizations),
        byPlan: byPlan
          .map((row) => ({
            planId: row.planId,
            planName: planName.get(row.planId) ?? 'Unknown',
            organizations: row._count._all,
          }))
          .sort((a, b) => b.organizations - a.organizations),
      },
      reporting: {
        from: from.toISOString(),
        to: to.toISOString(),
        grouping,
        registrations,
        growth,
      },
      attention: {
        failedJobsLast24Hours,
        stalledOnboarding,
        failedWebhooks,
        highSeveritySecurityEvents,
        trialsExpiringSoon,
        suspendedOrganizations,
      },
      recentActivity: recentActivity.map((event) => ({
        id: event.id,
        eventKey: event.eventKey,
        occurredAt: event.occurredAt.toISOString(),
      })),
      observedAt: new Date().toISOString(),
    };
  }
}

function bucketSeries(values: Date[], grouping: 'day' | 'week' | 'month') {
  const counts = new Map<string, number>();
  for (const value of values) {
    const date = new Date(value);
    const key =
      grouping === 'month'
        ? date.toISOString().slice(0, 7)
        : grouping === 'week'
          ? weekStart(date).toISOString().slice(0, 10)
          : date.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, organizations]) => ({ key, label: key, organizations }));
}

function weekStart(value: Date) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

async function distinctOrganizations(
  rows: Promise<Array<{ organizationId: string | null }>>,
): Promise<number> {
  return (await rows).length;
}

/** Percentage to one decimal place, and 0 rather than NaN when the denominator is empty. */
function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}
