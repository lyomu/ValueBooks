import { createHmac, timingSafeEqual } from 'node:crypto';

import { BadGatewayException, Injectable, UnauthorizedException } from '@nestjs/common';

import type {
  BillingProvider,
  CancelSubscriptionInput,
  CheckoutInput,
  CheckoutResult,
  ProviderSubscription,
  VerifiedWebhookEvent,
  WebhookInput,
} from './billing-provider.js';

/**
 * Paddle Billing (api.paddle.com / sandbox-api.paddle.com) REST adapter. Paddle is the merchant
 * of record for Starter: Paddle issues the customer-facing receipt/tax invoice, ValueBooks never
 * duplicates one (billing spec Section 7.1/16).
 *
 * No Paddle SDK dependency is added here; the Billing API v2 surface used is small enough that a
 * typed `fetch` wrapper is less to maintain than a generated client, and keeps this adapter's
 * actual HTTP calls auditable in one file.
 */
@Injectable()
export class PaddleBillingAdapter implements BillingProvider {
  readonly name = 'PADDLE' as const;

  private get apiBase(): string {
    return process.env.PADDLE_ENVIRONMENT === 'production'
      ? 'https://api.paddle.com'
      : 'https://sandbox-api.paddle.com';
  }

  private get apiKey(): string {
    const key = process.env.PADDLE_API_KEY;
    if (!key) {
      throw new BadGatewayException(
        'Paddle is not configured. Set PADDLE_API_KEY before enabling Starter checkout.',
      );
    }
    return key;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new BadGatewayException(`Paddle API error (${response.status}): ${body.slice(0, 500)}`);
    }
    return (await response.json()) as T;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const result = await this.request<{
      data: { id: string; checkout: { url: string } };
    }>('/transactions', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ price_id: input.plan.providerPriceId, quantity: 1 }],
        customer_email: input.customerEmail,
        custom_data: { clientReference: input.clientReference, organizationId: input.organizationId },
        checkout: { url: input.successUrl },
      }),
    });
    return { checkoutUrl: result.data.checkout.url, providerCheckoutId: result.data.id };
  }

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    const result = await this.request<{
      data: {
        id: string;
        customer_id: string;
        status: string;
        current_billing_period: { starts_at: string; ends_at: string } | null;
        scheduled_change: { action: string } | null;
      };
    }>(`/subscriptions/${providerSubscriptionId}`, { method: 'GET' });
    const data = result.data;
    return {
      providerSubscriptionId: data.id,
      providerCustomerId: data.customer_id,
      status: mapPaddleStatus(data.status),
      currentPeriodStart: data.current_billing_period
        ? new Date(data.current_billing_period.starts_at)
        : null,
      currentPeriodEnd: data.current_billing_period
        ? new Date(data.current_billing_period.ends_at)
        : null,
      cancelAtPeriodEnd: data.scheduled_change?.action === 'cancel',
    };
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<void> {
    await this.request(`/subscriptions/${input.providerSubscriptionId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        effective_from: input.immediately ? 'immediately' : 'next_billing_period',
      }),
    });
  }

  async getCustomerPortalUrl(input: { providerCustomerId: string }): Promise<string> {
    const result = await this.request<{ data: { urls: { general: { overview: string } } } }>(
      `/customers/${input.providerCustomerId}/portal-sessions`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    return result.data.urls.general.overview;
  }

  /**
   * Paddle signs `Paddle-Signature: ts=<unix>;h1=<hex hmac-sha256>` over `${ts}:${rawBody}`.
   * Verification happens against the exact raw bytes Paddle sent — never a re-serialized JSON
   * object, which would not reproduce the same signed payload.
   */
  // Not `async`: signature verification here is entirely synchronous HMAC comparison. The shared
  // `BillingProvider` interface still returns a Promise (other adapter methods genuinely await a
  // network call), so the result is wrapped rather than declared `async` with nothing to await.
  verifyWebhook(input: WebhookInput): Promise<VerifiedWebhookEvent> {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) throw new BadGatewayException('PADDLE_WEBHOOK_SECRET is not configured.');

    const header = input.headers['paddle-signature'];
    const signatureHeader = Array.isArray(header) ? header[0] : header;
    if (!signatureHeader) throw new UnauthorizedException('Missing Paddle-Signature header.');

    const parts = new Map(
      signatureHeader.split(';').map((part) => {
        const [key, value] = part.split('=');
        return [key, value] as const;
      }),
    );
    const timestamp = parts.get('ts');
    const providedHash = parts.get('h1');
    if (!timestamp || !providedHash) {
      throw new UnauthorizedException('Malformed Paddle-Signature header.');
    }

    const rawBody = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
    const expected = createHmac('sha256', secret).update(`${timestamp}:${rawBody}`).digest('hex');
    if (!safeEqualHex(expected, providedHash)) {
      throw new UnauthorizedException('Paddle webhook signature verification failed.');
    }

    const payload = JSON.parse(rawBody) as { event_id: string; event_type: string };
    return Promise.resolve({
      providerEventId: payload.event_id,
      eventType: payload.event_type,
      payload,
    });
  }
}

function mapPaddleStatus(status: string): ProviderSubscription['status'] {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'cancelled';
    case 'paused':
      return 'paused';
    default:
      return 'unknown';
  }
}

function safeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
