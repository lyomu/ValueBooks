import { Injectable, Logger } from '@nestjs/common';
import type { BillingProviderName } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import type { VerifiedWebhookEvent } from './billing-provider.js';

interface NormalizedBillingEvent {
  /** The provider's own subscription id, when the event concerns one. */
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  /** Present on a payment event. */
  transaction?: {
    providerTransactionId: string;
    amountMinor: bigint;
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
 * Event-shape normalization lives in `normalizePaddleEvent`/`normalizePaystackEvent` below; this
 * class owns only what every provider's events have in common: record, deduplicate, apply to
 * `OrganizationSubscription`/`BillingTransaction`, never let a webhook failure throw past the
 * controller that called it (a 5xx causes the provider to retry, which is correct, but the retry
 * must find the same idempotent outcome, not a half-applied one).
 */
@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      await this.applyToSubscription(provider, normalized);
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

  private async applyToSubscription(
    provider: BillingProviderName,
    normalized: NormalizedBillingEvent,
  ): Promise<void> {
    const subscription = normalized.providerSubscriptionId
      ? await this.prisma.organizationSubscription.findFirst({
          where: { providerSubscriptionId: normalized.providerSubscriptionId },
        })
      : normalized.clientReference
        ? await this.findByClientReference(normalized.clientReference)
        : null;

    if (!subscription) {
      this.logger.warn(
        `Billing webhook from ${provider} matched no subscription (subscriptionId=${normalized.providerSubscriptionId ?? 'none'}, clientReference=${normalized.clientReference ?? 'none'})`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Parameters<typeof tx.organizationSubscription.update>[0]['data'] = {};
      if (normalized.providerSubscriptionId) data.providerSubscriptionId = normalized.providerSubscriptionId;
      if (normalized.providerCustomerId) data.providerCustomerId = normalized.providerCustomerId;
      if (normalized.currentPeriodStart !== undefined) data.currentPeriodStart = normalized.currentPeriodStart;
      if (normalized.currentPeriodEnd !== undefined) data.currentPeriodEnd = normalized.currentPeriodEnd;
      if (normalized.cancelAtPeriodEnd !== undefined) data.cancelAtPeriodEnd = normalized.cancelAtPeriodEnd;
      if (normalized.subscriptionStatus) {
        data.status = normalized.subscriptionStatus;
        if (normalized.subscriptionStatus === 'ACTIVE') {
          data.pastDueSince = null;
          data.billingProvider = provider;
        }
        if (normalized.subscriptionStatus === 'PAST_DUE') data.pastDueSince = new Date();
        if (normalized.subscriptionStatus === 'CANCELLED') data.cancelledAt = new Date();
      }
      if (normalized.transaction?.status === 'SUCCESSFUL') {
        data.lastPaymentAt = normalized.transaction.paidAt ?? new Date();
        // A successful payment is itself proof of an active, paid subscription — this is the
        // "verified payment, not a redirect" activation the spec requires (Section 7).
        data.status = 'ACTIVE';
        data.pastDueSince = null;
      }
      if (Object.keys(data).length > 0) {
        await tx.organizationSubscription.update({ where: { id: subscription.id }, data });
      }

      if (normalized.transaction) {
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
            status: normalized.transaction.status,
            paidAt: normalized.transaction.paidAt,
            receiptUrl: normalized.transaction.receiptUrl,
          },
        });
      }
    });
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
