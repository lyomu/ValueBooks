import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { BillingWebhookService, type NormalizedBillingEvent } from './billing-webhook.service.js';
import { PaddleBillingAdapter } from './paddle-billing.adapter.js';
import { PaystackBillingAdapter } from './paystack-billing.adapter.js';

/**
 * Both providers' webhook endpoints. No `SessionGuard`/`OrganizationGuard` here by design -- the
 * caller is the payment provider, not a logged-in user, and authenticity comes entirely from
 * `verifyWebhook`'s signature check (Section 15: "never bypass signatures or allow raw arbitrary
 * event injection", applies equally to development environments).
 */
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(
    private readonly paddleAdapter: PaddleBillingAdapter,
    private readonly paystackAdapter: PaystackBillingAdapter,
    private readonly webhooks: BillingWebhookService,
  ) {}

  @Post('paddle')
  @HttpCode(200)
  async paddle(@Req() request: RawBodyRequest<Request>) {
    const verified = await this.paddleAdapter.verifyWebhook({
      rawBody: request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {})),
      headers: request.headers,
    });
    await this.webhooks.recordAndProcess('PADDLE', verified, normalizePaddleEvent(verified));
    return { received: true };
  }

  @Post('paystack')
  @HttpCode(200)
  async paystack(@Req() request: RawBodyRequest<Request>) {
    const verified = await this.paystackAdapter.verifyWebhook({
      rawBody: request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {})),
      headers: request.headers,
    });
    await this.webhooks.recordAndProcess('PAYSTACK', verified, normalizePaystackEvent(verified));
    return { received: true };
  }
}

interface PaddleSubscriptionPayload {
  event_type: string;
  data: {
    id: string;
    customer_id: string;
    subscription_id?: string;
    status?: string;
    currency_code?: string;
    billed_at?: string | null;
    invoice_id?: string;
    custom_data?: { clientReference?: string } | null;
    current_billing_period?: { starts_at: string; ends_at: string } | null;
    scheduled_change?: { action: string } | null;
    details?: { totals?: { total?: string } };
  };
}

function normalizePaddleEvent(verified: { eventType: string; payload: unknown }): NormalizedBillingEvent {
  const payload = verified.payload as PaddleSubscriptionPayload;
  const data = payload.data;
  const clientReference = data.custom_data?.clientReference;

  switch (payload.event_type) {
    case 'transaction.completed':
      return {
        providerSubscriptionId: data.subscription_id,
        providerCustomerId: data.customer_id,
        clientReference,
        transaction: {
          providerTransactionId: data.id,
          amountMinor: BigInt(data.details?.totals?.total ?? '0'),
          currency: data.currency_code ?? 'USD',
          status: 'SUCCESSFUL',
          paidAt: data.billed_at ? new Date(data.billed_at) : new Date(),
          periodStart: data.current_billing_period ? new Date(data.current_billing_period.starts_at) : null,
          periodEnd: data.current_billing_period ? new Date(data.current_billing_period.ends_at) : null,
          receiptUrl: null,
        },
      };
    case 'subscription.created':
    case 'subscription.activated':
    case 'subscription.updated':
      return {
        providerSubscriptionId: data.id,
        providerCustomerId: data.customer_id,
        clientReference,
        subscriptionStatus: data.status === 'past_due' ? 'PAST_DUE' : 'ACTIVE',
        cancelAtPeriodEnd: data.scheduled_change?.action === 'cancel',
        currentPeriodStart: data.current_billing_period ? new Date(data.current_billing_period.starts_at) : null,
        currentPeriodEnd: data.current_billing_period ? new Date(data.current_billing_period.ends_at) : null,
      };
    case 'subscription.canceled':
      return {
        providerSubscriptionId: data.id,
        providerCustomerId: data.customer_id,
        clientReference,
        subscriptionStatus: 'CANCELLED',
      };
    case 'subscription.past_due':
      return {
        providerSubscriptionId: data.id,
        providerCustomerId: data.customer_id,
        clientReference,
        subscriptionStatus: 'PAST_DUE',
      };
    default:
      return {};
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
  };
}

function normalizePaystackEvent(verified: { eventType: string; payload: unknown }): NormalizedBillingEvent {
  const payload = verified.payload as PaystackEventPayload;
  const data = payload.data;
  const clientReference = data.metadata?.clientReference;

  switch (payload.event) {
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
        subscriptionStatus: 'ACTIVE',
      };
    case 'subscription.disable':
      return {
        providerSubscriptionId: data.subscription_code,
        providerCustomerId: data.customer?.customer_code,
        clientReference,
        subscriptionStatus: 'CANCELLED',
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
