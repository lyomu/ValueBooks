import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduledJobMisfirePolicy, type Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { SchedulerService, nextOccurrence } from '../automation/scheduler.service.js';
import { BillingMailerService } from './billing-mailer.service.js';
import { BillingNotificationService } from './billing-notification.service.js';

export const TRIAL_REMINDER_HANDLER = 'billing.trial_reminder';
export const TRIAL_EXPIRY_HANDLER = 'billing.trial_expired';

/**
 * The two scheduled one-shot jobs around a 14-day cardless trial (Section 6.1/6.3): the day-13
 * reminder email, and the status flip to `TRIAL_EXPIRED` at the exact trial boundary. Both ride
 * the existing `ScheduledJob`/`ScheduledJobExecution` infrastructure (`SchedulerService`) rather
 * than a bespoke cron, dispatched from `AutomationWorker` the same way invoice reminders are.
 */
@Injectable()
export class TrialLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly mailer: BillingMailerService,
    private readonly config: ConfigService,
    private readonly notices: BillingNotificationService,
  ) {}

  /** Call once, right after a trial subscription is created. */
  async scheduleTrialJobs(
    tx: Prisma.TransactionClient,
    input: { organizationId: string; createdByUserId: string; trialEndsAt: Date; timeZone: string },
  ): Promise<void> {
    const policy = await tx.billingTrialPolicy.findUnique({ where: { id: 1 }, select: { reminderLeadHours: true } });
    const leadHours = policy?.reminderLeadHours ?? Number(this.config.get('BILLING_TRIAL_REMINDER_LEAD_HOURS') ?? 24);
    const reminderAt = new Date(input.trialEndsAt.getTime() - leadHours * 60 * 60 * 1000);
    const shared = {
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId,
      sourceType: `ORGANIZATION_TRIAL:${input.organizationId}`,
      timeZone: input.timeZone,
      misfirePolicy: ScheduledJobMisfirePolicy.RUN_ONCE,
    };
    if (reminderAt.getTime() > Date.now()) {
      await tx.scheduledJob.create({
        data: {
          ...shared,
          handler: TRIAL_REMINDER_HANDLER,
          schedule: { cadence: 'DAILY', localTime: '09:00', endDate: this.scheduler.templateDateForOccurrence(reminderAt, input.timeZone) },
          sourceId: randomUUID(),
          payload: {},
          nextRunAt: reminderAt,
        },
      });
    }
    await tx.scheduledJob.create({
      data: {
        ...shared,
        handler: TRIAL_EXPIRY_HANDLER,
      schedule: { cadence: 'DAILY', localTime: '09:00', endDate: this.scheduler.templateDateForOccurrence(input.trialEndsAt, input.timeZone) },
        sourceId: randomUUID(),
        payload: {},
        nextRunAt: input.trialEndsAt,
      },
    });
    const maintenanceSchedule = { cadence: 'DAILY' as const, localTime: process.env.BILLING_MAINTENANCE_LOCAL_TIME ?? '03:00' };
    await tx.scheduledJob.upsert({
      where: { organizationId_handler_sourceType_sourceId: { organizationId: input.organizationId, handler: 'billing.maintenance', sourceType: 'ORGANIZATION_BILLING', sourceId: input.organizationId } },
      create: { organizationId: input.organizationId, createdByUserId: input.createdByUserId,
        handler: 'billing.maintenance', sourceType: 'ORGANIZATION_BILLING', sourceId: input.organizationId,
        schedule: maintenanceSchedule, timeZone: 'UTC', misfirePolicy: ScheduledJobMisfirePolicy.RUN_ONCE,
        nextRunAt: nextOccurrence(new Date(), maintenanceSchedule, 'UTC') },
      update: {},
    });
  }

  /** Sends the day-13 "trial ends tomorrow" email, exactly once (Section 6.1). */
  async executeReminder(executionId: string): Promise<void> {
    const execution = await this.scheduler.beginExecution(executionId);
    if (!execution) return;

    const subscription = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId: execution.organizationId },
      select: { status: true, trialEndsAt: true, trialReminderSentAt: true },
    });
    // A subscription that already converted to paid, or has no trial boundary any more, gets no
    // reminder -- the whole point is to prompt someone who has not yet decided.
    if (!subscription || subscription.status !== 'TRIALING' || subscription.trialReminderSentAt ||
      !subscription.trialEndsAt || subscription.trialEndsAt.getTime() - Date.now() > 86_400_000 ||
      subscription.trialEndsAt.getTime() <= Date.now()) {
      await this.scheduler.completeExecution(executionId, { skipped: true });
      return;
    }

    const owner = await this.prisma.organizationMember.findFirst({
      where: { organizationId: execution.organizationId, role: { isOwnerRole: true } },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { email: true, displayName: true } } },
    });
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: execution.organizationId },
      select: { legalName: true, timeZone: true },
    });
    if (owner?.user.email && subscription.trialEndsAt) {
      await this.mailer.sendTrialEndingTomorrow({
        to: owner.user.email,
        organizationName: organization.legalName,
        trialEndsAt: subscription.trialEndsAt,
        timeZone: organization.timeZone,
      });
      await this.prisma.organizationSubscription.update({
        where: { organizationId: execution.organizationId },
        data: { trialReminderSentAt: new Date() },
      });
    }
    await this.scheduler.completeExecution(executionId, { notified: Boolean(owner?.user.email) });
  }

  /** Flips an unconverted trial to `TRIAL_EXPIRED` at the exact boundary (Section 6.3). Leaves an
   * already-paid subscription untouched -- conversion before expiry is the common, happy path. */
  async executeExpiry(executionId: string): Promise<void> {
    const execution = await this.scheduler.beginExecution(executionId);
    if (!execution) return;

    await this.prisma.organizationSubscription.updateMany({
      where: { organizationId: execution.organizationId, status: 'TRIALING', trialEndsAt: { lte: new Date() } },
      data: { status: 'TRIAL_EXPIRED' },
    });
    const subscription = await this.prisma.organizationSubscription.findUnique({ where: { organizationId: execution.organizationId }, select: { status: true, trialEndsAt: true } });
    if (subscription?.status === 'TRIAL_EXPIRED' && subscription.trialEndsAt && subscription.trialEndsAt <= new Date()) {
      await this.notices.notify({ organizationId: execution.organizationId, eventKey: 'billing.trial_expired',
        sourceId: subscription.trialEndsAt.toISOString(), subject: 'Your ValueBooks trial has ended',
        body: 'Your free trial has ended, but your business records are still here. Choose a subscription plan to continue managing your finances.' });
    }
    await this.scheduler.completeExecution(executionId, { expired: true });
  }
}
