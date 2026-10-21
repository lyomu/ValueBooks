import { Injectable, Logger } from '@nestjs/common';
import type { BillingProviderName } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import type { VerifiedWebhookEvent } from './billing-provider.js';
import { PaystackBillingAdapter } from './paystack-billing.adapter.js';
import { BillingNotificationService } from './billing-notification.service.js';

interface NormalizedBillingEvent {
  occurredAt?: Date;
  refund?: { providerReference?: string; providerTransactionId?: string; amountMinor?: bigint; status: 'PENDING' | 'COMPLETED' | 'FAILED' };
  /** The provider's own subscription id, when the event concerns one. */
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  /** Present on a payment event. */
  transaction?: {
    providerTransactionId: string;
    amountMinor: bigint;
    catalogAmountMinor?: bigint;
    currency: string;
    status: 'SUCCESSFUL' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
    paidAt: Date | null;
    periodStart: Date | null;
    periodEnd: Date | null;
    receiptUrl: string | null;
  };
  /** Present when the event itself asserts a new subscription lifecycle state. */
  subscriptionStatus?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  cancelAtPeriodEnd?: boolean;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  /** The `clientReference`/`metadata.clientReference` this checkout was created with, used to find
   * which organization a brand-new (not-yet-linked) subscription belongs to. */
  clientReference?: string;
}

/**
 * Persists every verified webhook event before acting on it (`RECEIVED` -> `VERIFIED` ->
 * `PROCESSED`/`FAILED`), and makes processing idempotent on `(billingProvider, providerEventId)`:
 * a duplicate delivery is recognized and skipped rather than reapplied (Section 15/27).
 *
 * Event-shape normalization lives in `normalizePaystackEvent`; this
 * class owns only what every provider's events have in common: record, deduplicate, apply to
 * `OrganizationSubscription`/`BillingTransaction`, never let a webhook failure throw past the
 * controller that called it (a 5xx causes the provider to retry, which is correct, but the retry
 * must find the same idempotent outcome, not a half-applied one).
 */
@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackBillingAdapter,
    private readonly notices: BillingNotificationService,
  ) {}

  async recordAndProcess(
    provider: BillingProviderName,
    verified: VerifiedWebhookEvent,
    normalized: NormalizedBillingEvent,
  ): Promise<{ deduplicated: boolean }> {
    const existing = await this.prisma.billingWebhookEvent.findUnique({
      where: {
        billingProvider_providerEventId: {
          billingProvider: provider,
          providerEventId: verified.providerEventId,
        },
      },
      select: { id: true, processingState: true },
    });
    if (existing && existing.processingState === 'PROCESSED') {
      return { deduplicated: true };
    }

    const event = await this.prisma.billingWebhookEvent.upsert({
      where: {
        billingProvider_providerEventId: {
          billingProvider: provider,
          providerEventId: verified.providerEventId,
        },
      },
      create: {
        billingProvider: provider,
        providerEventId: verified.providerEventId,
        eventType: verified.eventType,
        signatureVerified: true,
        processingState: 'VERIFIED',
        payload: verified.payload as object,
      },
      update: {
        retryCount: { increment: 1 },
        processingState: 'VERIFIED',
      },
    });

    try {
      if (normalized.refund) await this.applyRefund(provider, normalized.refund);
      else await this.applyToSubscription(provider, normalized, verified.providerEventId);
      await this.prisma.billingWebhookEvent.update({
        where: { id: event.id },
        data: { processingState: 'PROCESSED', processedAt: new Date() },
      });
      return { deduplicated: false };
    } catch (error) {
      this.logger.error(`Webhook processing failed for ${provider}/${verified.eventType}`, error);
      await this.prisma.billingWebhookEvent.update({
        where: { id: event.id },
        data: {
          processingState: 'FAILED',
          lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error',
        },
      });
      // Re-thrown so the HTTP layer returns non-2xx and the provider retries delivery later; the
      // event row already recorded above makes that retry idempotent rather than a blind replay.
      throw error;
    }
  }

  private async applyRefund(provider: BillingProviderName, event: NonNullable<NormalizedBillingEvent['refund']>) {
    let refund = event.providerReference ? await this.prisma.billingRefund.findFirst({ where: { providerReference: event.providerReference, transaction: { billingProvider: provider } } }) : null;
    if (!refund && event.providerTransactionId && event.amountMinor !== undefined) {
      const candidates = await this.prisma.billingRefund.findMany({ where: {
        transaction: { billingProvider: provider, providerTransactionId: event.providerTransactionId },
        amountMinor: event.amountMinor, status: 'SUBMITTED',
      }, take: 2 });
      if (candidates.length === 1) refund = candidates[0] ?? null;
    }
    if (!refund) throw new Error('Refund event has no unambiguous approved request to reconcile.');
    if (refund.status === 'COMPLETED' || refund.status === 'FAILED') return;
    await this.prisma.$transaction(async (tx) => {
      await tx.billingRefund.update({ where: { id: refund.id }, data: {
        status: event.status === 'COMPLETED' ? 'COMPLETED' : event.status === 'FAILED' ? 'FAILED' : 'SUBMITTED',
        providerStatus: event.status, completedAt: event.status === 'COMPLETED' ? new Date() : null,
        ...(event.providerReference && !refund.providerReference ? { providerReference: event.providerReference } : {}),
      } });
      if (event.status === 'COMPLETED') {
        const completed = await tx.billingRefund.findMany({ where: { transactionId: refund.transactionId, status: 'COMPLETED' }, select: { amountMinor: true } });
        const total = completed.reduce((sum, item) => sum + item.amountMinor, 0n);
        const transaction = await tx.billingTransaction.findUniqueOrThrow({ where: { id: refund.transactionId }, select: { amountMinor: true } });
        await tx.billingTransaction.update({ where: { id: refund.transactionId }, data: {
          refundedMinor: total, status: total >= transaction.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        } });
      }
    });
  }

  private async applyToSubscription(
    provider: BillingProviderName,
    normalized: NormalizedBillingEvent,
    providerEventId: string,
  ): Promise<void> {
    const candidateChange = normalized.clientReference
      ? await this.prisma.subscriptionChange.findUnique({
          where: { id: normalized.clientReference }, include: { toPlan: true },
        })
      : null;
    if (candidateChange && ['COMPLETED', 'CANCELLING_OLD'].includes(candidateChange.status) &&
      normalized.transaction?.status !== 'SUCCESSFUL' && normalized.providerSubscriptionId &&
      candidateChange.toProvider === provider) {
      const linked = await this.prisma.organizationSubscription.updateMany({
        where: { organizationId: candidateChange.organizationId, planId: candidateChange.toPlanId,
          billingProvider: provider, providerSubscriptionId: null, status: 'ACTIVE' },
        data: { providerSubscriptionId: normalized.providerSubscriptionId,
          ...(normalized.providerCustomerId ? { providerCustomerId: normalized.providerCustomerId } : {}) },
      });
      if (linked.count) await this.prisma.subscriptionChange.update({ where: { id: candidateChange.id },
        data: { replacementProviderSubscriptionId: normalized.providerSubscriptionId } });
      return;
    }
    const change = candidateChange && !['COMPLETED', 'FAILED'].includes(candidateChange.status) ? candidateChange : null;
    const signupIntent = !candidateChange && normalized.clientReference
      ? await this.prisma.registrationIntent.findUnique({
          where: { id: normalized.clientReference }, include: { plan: true },
        })
      : null;
    // Provider-side subscription creation can precede payment. A replacement must not overwrite
    // the customer's still-valid plan, provider IDs or paid-through date until its charge verifies.
    if ((change || signupIntent) && normalized.transaction?.status !== 'SUCCESSFUL') return;
    if (normalized.transaction?.status === 'SUCCESSFUL' && (change || signupIntent)) {
      const expected = change?.toPlan ?? signupIntent!.plan;
      if (provider !== expected.billingProvider ||
        normalized.transaction.currency !== expected.currency ||
        (normalized.transaction.catalogAmountMinor ?? normalized.transaction.amountMinor) !== expected.priceMinor) {
        throw new Error('Verified provider charge does not match the selected plan, currency and amount.');
      }
    }
    if (signupIntent && normalized.transaction?.status === 'SUCCESSFUL') {
      await this.prisma.registrationIntent.updateMany({
        where: { id: signupIntent.id, paymentVerifiedAt: null },
        data: { paymentVerifiedAt: normalized.transaction.paidAt ?? new Date() },
      });
    }
    const subscription = (normalized.providerSubscriptionId
      ? await this.prisma.organizationSubscription.findFirst({
          where: { providerSubscriptionId: normalized.providerSubscriptionId },
        }) : null)
      ?? (change ? await this.prisma.organizationSubscription.findUnique({ where: { organizationId: change.organizationId } }) : null)
      ?? (normalized.providerCustomerId && normalized.providerSubscriptionId
        ? await this.prisma.organizationSubscription.findFirst({
            where: { billingProvider: provider, providerCustomerId: normalized.providerCustomerId, providerSubscriptionId: null },
          }) : null)
      ?? (normalized.clientReference ? await this.findByClientReference(normalized.clientReference) : null);

    if (!subscription) {
      this.logger.warn(
        `Billing webhook from ${provider} matched no subscription (subscriptionId=${normalized.providerSubscriptionId ?? 'none'}, clientReference=${normalized.clientReference ?? 'none'})`,
      );
      return;
    }

    if (normalized.transaction?.status === 'SUCCESSFUL' && !change && !signupIntent) {
      const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: subscription.planId },
        select: { billingProvider: true, priceMinor: true, currency: true } });
      if (plan.billingProvider !== provider || plan.currency !== normalized.transaction.currency ||
        plan.priceMinor !== (normalized.transaction.catalogAmountMinor ?? normalized.transaction.amountMinor)) {
        throw new Error('Verified renewal charge does not match the current plan, currency and amount.');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Parameters<typeof tx.organizationSubscription.update>[0]['data'] = {};
      if (change && normalized.transaction?.status === 'SUCCESSFUL') {
        data.planId = change.toPlanId;
        data.intendedPlanId = null;
        data.billingProvider = provider;
        data.providerSubscriptionId = normalized.providerSubscriptionId ?? null;
        data.providerCustomerId = normalized.providerCustomerId ?? null;
        data.trialEndsAt = null;
        data.cancelAtPeriodEnd = false;
      }
      if (signupIntent && normalized.transaction?.status === 'SUCCESSFUL') {
        data.planId = signupIntent.planId;
        data.intendedPlanId = null;
        data.trialEndsAt = null;
        data.billingProvider = provider;
      }
      if (normalized.providerSubscriptionId) data.providerSubscriptionId = normalized.providerSubscriptionId;
      if (normalized.providerCustomerId) data.providerCustomerId = normalized.providerCustomerId;
      if (normalized.currentPeriodStart !== undefined && normalized.currentPeriodStart &&
        (!subscription.currentPeriodStart || normalized.currentPeriodStart >= subscription.currentPeriodStart))
        data.currentPeriodStart = normalized.currentPeriodStart;
      if (normalized.currentPeriodEnd !== undefined && normalized.currentPeriodEnd &&
        (!subscription.currentPeriodEnd || normalized.currentPeriodEnd >= subscription.currentPeriodEnd))
        data.currentPeriodEnd = normalized.currentPeriodEnd;
      if (normalized.cancelAtPeriodEnd !== undefined) data.cancelAtPeriodEnd = normalized.cancelAtPeriodEnd;
      if (normalized.subscriptionStatus &&
        (!normalized.occurredAt || !subscription.lastPaymentAt || normalized.occurredAt >= subscription.lastPaymentAt)) {
        data.status = normalized.subscriptionStatus;
        if (normalized.subscriptionStatus === 'ACTIVE') {
          data.pastDueSince = null;
          data.billingProvider = provider;
        }
        if (normalized.subscriptionStatus === 'PAST_DUE') data.pastDueSince = new Date();
        if (normalized.subscriptionStatus === 'CANCELLED') data.cancelledAt = new Date();
      }
      if (normalized.transaction?.status === 'SUCCESSFUL') {
        const paidAt = normalized.transaction.paidAt ?? new Date();
        data.lastPaymentAt = paidAt;
        const paidPlan = change?.toPlan ?? (signupIntent?.plan ?? await tx.plan.findUniqueOrThrow({ where: { id: subscription.planId } }));
        data.currentPeriodStart = normalized.transaction.periodStart ?? paidAt;
        data.currentPeriodEnd = normalized.transaction.periodEnd ?? addBillingMonths(paidAt, paidPlan.billingInterval === 'YEARLY' ? 12 : 1);
        // A successful payment is itself proof of an active, paid subscription — this is the
        // "verified payment, not a redirect" activation the spec requires (Section 7).
        data.status = 'ACTIVE';
        data.pastDueSince = null;
      }
      if (Object.keys(data).length > 0) {
        await tx.organizationSubscription.update({ where: { id: subscription.id }, data });
      }

      if (change && normalized.transaction?.status === 'SUCCESSFUL') {
        const needsOldCancellation = Boolean(change.priorProviderSubscriptionId && change.oldCancellationStatus !== 'CONFIRMED');
        await tx.subscriptionChange.update({
          where: { id: change.id },
          data: {
            status: needsOldCancellation ? 'CANCELLING_OLD' : 'COMPLETED',
            effectiveAt: normalized.transaction.paidAt ?? new Date(),
            completedAt: needsOldCancellation ? null : new Date(),
            replacementProviderSubscriptionId: normalized.providerSubscriptionId ?? null,
            oldCancellationStatus: needsOldCancellation ? 'PENDING' : change.oldCancellationStatus ?? 'NOT_REQUIRED',
          },
        });
      }

      if (normalized.transaction) {
        const existingTransaction = await tx.billingTransaction.findUnique({
          where: { billingProvider_providerTransactionId: { billingProvider: provider,
            providerTransactionId: normalized.transaction.providerTransactionId } },
          select: { status: true },
        });
        await tx.billingTransaction.upsert({
          where: {
            billingProvider_providerTransactionId: {
              billingProvider: provider,
              providerTransactionId: normalized.transaction.providerTransactionId,
            },
          },
          create: {
            organizationId: subscription.organizationId,
            subscriptionId: subscription.id,
            planId: change?.toPlanId ?? signupIntent?.planId ?? subscription.planId,
            planNameSnapshot: (change?.toPlan ?? signupIntent?.plan)?.name ?? (await tx.plan.findUniqueOrThrow({ where: { id: subscription.planId }, select: { name: true } })).name,
            billingIntervalSnapshot: (change?.toPlan ?? signupIntent?.plan)?.billingInterval ?? (await tx.plan.findUniqueOrThrow({ where: { id: subscription.planId }, select: { billingInterval: true } })).billingInterval,
            billingProvider: provider,
            providerTransactionId: normalized.transaction.providerTransactionId,
            status: normalized.transaction.status,
            amountMinor: normalized.transaction.amountMinor,
            currency: normalized.transaction.currency,
            periodStart: normalized.transaction.periodStart,
            periodEnd: normalized.transaction.periodEnd,
            paidAt: normalized.transaction.paidAt,
            receiptUrl: normalized.transaction.receiptUrl,
          },
          update: {
            status: existingTransaction && ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(existingTransaction.status)
              ? existingTransaction.status : normalized.transaction.status,
            paidAt: normalized.transaction.paidAt,
            receiptUrl: normalized.transaction.receiptUrl,
          },
        });
      }
    });

    if (change && normalized.transaction?.status === 'SUCCESSFUL' &&
      change.priorProviderSubscriptionId && change.fromProvider === 'PAYSTACK' && change.oldCancellationStatus !== 'CONFIRMED') {
      // Provider consolidation does not mutate historical subscriptions. New and replacement
      // subscriptions are Paystack-only; a legacy record is left for controlled reconciliation.
      const oldAdapter = this.paystack;
      try {
        const old = await oldAdapter.getSubscription(change.priorProviderSubscriptionId);
        await oldAdapter.cancelSubscription({
          providerSubscriptionId: change.priorProviderSubscriptionId,
          emailToken: old.emailToken,
        });
        await this.prisma.subscriptionChange.update({
          where: { id: change.id },
          data: { status: 'COMPLETED', completedAt: new Date(), oldCancellationStatus: 'CONFIRMED' },
        });
      } catch (error) {
        await this.prisma.subscriptionChange.update({
          where: { id: change.id },
          data: { status: 'CANCELLING_OLD', oldCancellationStatus: 'FAILED', errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Old renewal cancellation failed' },
        });
        // The replacement remains active. The unresolved old renewal is visible for reconciliation.
        this.logger.error(`Old subscription cancellation requires review for change ${change.id}`, error);
      }
    }

    const noticeSource = normalized.transaction?.providerTransactionId ?? providerEventId;
    const messages: Array<{ key: string; subject: string; body: string }> = [];
    if (normalized.transaction?.status === 'SUCCESSFUL') {
      messages.push({ key: 'billing.payment_successful', subject: 'ValueBooks payment confirmed', body: 'Your subscription payment was confirmed by your payment provider. View your billing settings for the paid period and receipt.' });
      if (change || signupIntent || subscription.status === 'TRIALING')
        messages.push({ key: 'billing.subscription_activated', subject: 'Your ValueBooks subscription is active', body: 'Your paid subscription is active after verified provider payment. View billing settings for your plan and renewal date.' });
      if (change) messages.push({ key: 'billing.plan_changed', subject: 'Your ValueBooks plan changed', body: 'Your requested plan change has taken effect after payment confirmation. Review your current plan and limits in billing settings.' });
    } else if (normalized.transaction?.status === 'FAILED' || normalized.subscriptionStatus === 'PAST_DUE') {
      messages.push({ key: 'billing.payment_failed', subject: 'Action needed: ValueBooks payment', body: 'A subscription payment needs attention. Your records remain available. Review the provider payment method in billing settings.' });
      messages.push({ key: 'billing.payment_method_required', subject: 'Update your ValueBooks payment method', body: 'Please review your payment method through your subscription provider to avoid interruption.' });
    } else if (normalized.subscriptionStatus === 'CANCELLED') {
      messages.push({ key: 'billing.subscription_canceled', subject: 'Your ValueBooks subscription was canceled', body: 'Your subscription was canceled by the payment provider. Your business records remain stored and available to view.' });
    }
    for (const message of messages) {
      await this.notices.notify({ organizationId: subscription.organizationId, eventKey: message.key,
        sourceId: noticeSource, subject: message.subject, body: message.body }).catch((error) => this.logger.error('Billing notice queue failed', error));
    }
  }

  private async findByClientReference(clientReference: string) {
    // `clientReference` is the registration intent id for a brand-new subscriber whose
    // organization/subscription row does not exist at checkout time; once the organization
    // finishes onboarding its subscription is looked up by organization id instead. Both paths
    // are consulted here so an early (pre-onboarding) payment webhook is not silently dropped.
    const intent = await this.prisma.registrationIntent.findUnique({
      where: { id: clientReference },
      select: { userId: true },
    });
    if (!intent?.userId) return null;
    const member = await this.prisma.organizationMember.findFirst({
      where: { userId: intent.userId },
      orderBy: { createdAt: 'desc' },
      select: { organizationId: true },
    });
    if (!member) return null;
    return this.prisma.organizationSubscription.findUnique({
      where: { organizationId: member.organizationId },
    });
  }
}

export type { NormalizedBillingEvent };

function addBillingMonths(date: Date, months: number) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}
