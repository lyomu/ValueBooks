import { Controller, HttpCode, InternalServerErrorException, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { BillingWebhookService, type NormalizedBillingEvent } from './billing-webhook.service.js';
import { PaystackBillingAdapter } from './paystack-billing.adapter.js';

/**
 * Paystack's webhook endpoint. No `SessionGuard`/`OrganizationGuard` here by design -- the
 * caller is the payment provider, not a logged-in user, and authenticity comes entirely from
 * `verifyWebhook`'s signature check (Section 15: "never bypass signatures or allow raw arbitrary
 * event injection", applies equally to development environments).
 */
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(
    private readonly paystackAdapter: PaystackBillingAdapter,
    private readonly webhooks: BillingWebhookService,
  ) {}

  @Post('paystack')
  @HttpCode(200)
  async paystack(@Req() request: RawBodyRequest<Request>) {
    // The signature covers the exact bytes Paystack sent. Re-serialising a parsed body could
    // verify a payload that differs from what was signed, so a missing raw body (a server
    // misconfiguration -- `rawBody: true` is set in main.ts) fails closed; the 5xx makes Paystack
    // retry once the server is fixed.
    if (!request.rawBody) {
      throw new InternalServerErrorException('Raw webhook body unavailable; refusing to verify.');
    }
    const verified = await this.paystackAdapter.verifyWebhook({
      rawBody: request.rawBody,
      headers: request.headers,
    });
    await this.webhooks.recordAndProcess('PAYSTACK', verified, normalizePaystackEvent(verified));
    return { received: true };
  }
}

interface PaystackEventPayload {
  event: string;
  data: {
    id: number;
    reference?: string;
    amount?: number;
    currency?: string;
    paid_at?: string | null;
    customer?: { customer_code?: string };
    subscription_code?: string;
    status?: string;
    metadata?: { clientReference?: string } | null;
    transaction_reference?: string;
    refund_reference?: string | null;
  };
}

export function normalizePaystackEvent(verified: { eventType: string; payload: unknown }): NormalizedBillingEvent {
  const payload = verified.payload as PaystackEventPayload;
  const data = payload.data;
  const clientReference = data.metadata?.clientReference;

  switch (payload.event) {
    case 'refund.pending':
    case 'refund.processing':
    case 'refund.needs-attention':
    case 'refund.failed':
    case 'refund.processed':
      return { refund: { providerReference: data.refund_reference ?? undefined,
        providerTransactionId: data.transaction_reference,
        amountMinor: data.amount === undefined ? undefined : BigInt(data.amount),
        status: payload.event === 'refund.processed' ? 'COMPLETED' : payload.event === 'refund.failed' ? 'FAILED' : 'PENDING' } };
    case 'charge.success':
      return {
        providerCustomerId: data.customer?.customer_code,
        clientReference,
        transaction: {
          providerTransactionId: data.reference ?? String(data.id),
          amountMinor: BigInt(data.amount ?? 0),
          currency: data.currency ?? 'USD',
          status: 'SUCCESSFUL',
          paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
          periodStart: null,
          periodEnd: null,
          receiptUrl: null,
        },
      };
    case 'subscription.create':
      return {
        providerSubscriptionId: data.subscription_code,
        providerCustomerId: data.customer?.customer_code,
        clientReference,
        subscriptionStatus: undefined,
      };
    case 'subscription.disable':
      return {
        providerSubscriptionId: data.subscription_code,
        providerCustomerId: data.customer?.customer_code,
        clientReference,
        subscriptionStatus: 'CANCELLED',
      };
    case 'subscription.not_renew':
      return {
        providerSubscriptionId: data.subscription_code,
        providerCustomerId: data.customer?.customer_code,
        clientReference,
        // Paystack keeps the current paid term active but will not charge the next one.
        cancelAtPeriodEnd: true,
      };
    case 'invoice.payment_failed':
      return {
        providerSubscriptionId: data.subscription_code,
        clientReference,
        subscriptionStatus: 'PAST_DUE',
      };
    default:
      return {};
  }
}
