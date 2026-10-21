import { Injectable, Logger } from '@nestjs/common';

import { SchedulerService } from '../automation/scheduler.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { BillingNotificationService } from './billing-notification.service.js';
import { PaystackBillingAdapter } from './paystack-billing.adapter.js';

/** Daily provider-aware recovery on the existing durable scheduler. It never creates a charge or
 * activates a paid plan from a redirect; successful payment still requires signed evidence. */
@Injectable()
export class BillingMaintenanceService {
  private readonly logger = new Logger(BillingMaintenanceService.name);
  constructor(private readonly prisma: PrismaService, private readonly scheduler: SchedulerService,
    private readonly notices: BillingNotificationService, private readonly paystack: PaystackBillingAdapter) {}

  async execute(executionId: string) {
    const execution = await this.scheduler.beginExecution(executionId);
    if (!execution) return;
    const organizationId = execution.organizationId;
    const subscription = await this.prisma.organizationSubscription.findUnique({ where: { organizationId } });
    if (subscription) {
      const now = new Date();
      if (subscription.status === 'TRIALING' && subscription.trialEndsAt && subscription.trialEndsAt <= now) {
        await this.prisma.organizationSubscription.updateMany({ where: { id: subscription.id, status: 'TRIALING', trialEndsAt: { lte: now } }, data: { status: 'TRIAL_EXPIRED' } });
        await this.notices.notify({ organizationId, eventKey: 'billing.trial_expired', sourceId: subscription.trialEndsAt.toISOString(),
          subject: 'Your ValueBooks trial has ended', body: 'Your trial has ended. Your records remain available in read-only mode; choose a plan to continue working.' });
      }
      if (subscription.status === 'CANCEL_SCHEDULED' && subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now) {
        await this.prisma.organizationSubscription.updateMany({ where: { id: subscription.id, status: 'CANCEL_SCHEDULED', currentPeriodEnd: { lte: now } },
          data: { status: 'CANCELLED', cancelledAt: now } });
        await this.notices.notify({ organizationId, eventKey: 'billing.subscription_expired', sourceId: subscription.currentPeriodEnd.toISOString(),
          subject: 'Your ValueBooks paid term has ended', body: 'Your paid term has ended. Your financial records remain available to view and export.' });
      }
      if (subscription.status === 'ACTIVE' && !subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd &&
        subscription.currentPeriodEnd.getTime() > now.getTime() && subscription.currentPeriodEnd.getTime() - now.getTime() <= 3 * 86_400_000) {
        await this.notices.notify({ organizationId, eventKey: 'billing.renewal_upcoming', sourceId: subscription.currentPeriodEnd.toISOString(),
          subject: 'Your ValueBooks renewal is coming up', body: `Your current paid term ends ${await this.notices.localDate(organizationId, subscription.currentPeriodEnd)}. Review your subscription and payment method in billing settings.` });
      }
      if (subscription.billingProvider === 'PAYSTACK' && subscription.providerSubscriptionId && ['ACTIVE', 'PAST_DUE', 'CANCEL_SCHEDULED'].includes(subscription.status)) {
        try {
          const remote = await this.paystack.getSubscription(subscription.providerSubscriptionId);
          if (remote.status === 'past_due' && subscription.status === 'ACTIVE') {
            await this.prisma.organizationSubscription.updateMany({ where: { id: subscription.id, status: 'ACTIVE' }, data: { status: 'PAST_DUE', pastDueSince: now } });
            await this.notices.notify({ organizationId, eventKey: 'billing.payment_method_required', sourceId: `${subscription.id}:${subscription.currentPeriodEnd?.toISOString() ?? ''}`,
              subject: 'Action needed: update your ValueBooks payment method', body: 'Your payment provider reports a past-due subscription. Update your payment method through billing settings. Your records remain available.' });
          }
        } catch (error) {
          this.logger.error(`Provider reconciliation failed for subscription ${subscription.id}`, error);
        }
      }
    }
    const changes = await this.prisma.subscriptionChange.findMany({ where: { organizationId, status: 'CANCELLING_OLD' } });
    for (const change of changes) {
      if (!change.priorProviderSubscriptionId || !change.fromProvider) continue;
      try {
        if (change.fromProvider !== 'PAYSTACK') continue;
        const remote = await this.paystack.getSubscription(change.priorProviderSubscriptionId);
        if (!remote.cancelAtPeriodEnd && remote.status !== 'cancelled') {
          await this.paystack.cancelSubscription({ providerSubscriptionId: change.priorProviderSubscriptionId,
            emailToken: remote.emailToken });
        }
        await this.prisma.subscriptionChange.update({ where: { id: change.id }, data: { status: 'COMPLETED', completedAt: new Date(), oldCancellationStatus: 'CONFIRMED', errorMessage: null } });
        await this.notices.notify({ organizationId, eventKey: 'billing.migration_completed', sourceId: change.id,
          subject: 'Your ValueBooks plan migration is complete', body: 'Your replacement plan is active and the previous provider renewal has been canceled.' });
      } catch (error) {
        await this.prisma.subscriptionChange.update({ where: { id: change.id }, data: { oldCancellationStatus: 'FAILED', errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Cancellation failed' } });
        this.logger.error(`Old provider cancellation still needs review for change ${change.id}`, error);
      }
    }
    await this.notices.retryUnqueued(organizationId);
    await this.scheduler.completeExecution(executionId, { checked: true });
  }
}
