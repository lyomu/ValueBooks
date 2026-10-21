import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { BillingMailerService } from './billing-mailer.service.js';

/** Delivery ledger for subscription notices. Event + source identifies a business transition,
 * so webhook retries and scheduled-job retries cannot enqueue a second notice. */
@Injectable()
export class BillingNotificationService {
  constructor(private readonly prisma: PrismaService, private readonly mailer: BillingMailerService) {}

  async localDate(organizationId: string, date: Date): Promise<string> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { timeZone: true } });
    const timeZone = organization?.timeZone ?? 'UTC';
    try { return `${new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(date)} (${timeZone})`; }
    catch { return `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(date)} (UTC)`; }
  }

  async notify(input: { organizationId: string; eventKey: string; sourceId: string; subject: string; body: string }) {
    const [profile, owner] = await Promise.all([
      this.prisma.billingProfile.findUnique({ where: { organizationId: input.organizationId }, select: { contactEmail: true } }),
      this.prisma.organizationMember.findFirst({ where: { organizationId: input.organizationId, role: { isOwnerRole: true } },
        select: { user: { select: { email: true } } } }),
    ]);
    const email = profile?.contactEmail ?? owner?.user.email;
    if (!email) return;
    const notice = await this.prisma.billingNotice.upsert({
      where: { organizationId_eventKey_sourceId: { organizationId: input.organizationId, eventKey: input.eventKey, sourceId: input.sourceId } },
      create: { organizationId: input.organizationId, eventKey: input.eventKey, sourceId: input.sourceId, recipientEmail: email, subject: input.subject, body: input.body },
      update: {},
    });
    if (notice.queuedAt) return;
    await this.dispatch(notice);
  }

  async retryUnqueued(organizationId?: string) {
    const pending = await this.prisma.billingNotice.findMany({ where: { queuedAt: null, attempts: { lt: 10 }, ...(organizationId ? { organizationId } : {}) }, orderBy: { createdAt: 'asc' }, take: 100 });
    for (const notice of pending) await this.dispatch(notice);
  }

  private async dispatch(notice: { id: string; recipientEmail: string; subject: string; body: string }) {
    try {
      await this.mailer.sendEvent({ to: notice.recipientEmail, subject: notice.subject, body: notice.body,
        actionUrl: `${(process.env.WEB_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/settings/billing`, jobId: `billing-${notice.id}` });
      await this.prisma.billingNotice.update({ where: { id: notice.id }, data: { queuedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
    } catch (error) {
      await this.prisma.billingNotice.update({ where: { id: notice.id }, data: { attempts: { increment: 1 }, lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Queue failure' } });
      throw error;
    }
  }
}
