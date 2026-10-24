import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

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

/** The fields of a Paystack plan that must agree with the ValueBooks catalog row it backs. */
export type PaystackRemotePlan = {
  plan_code: string;
  amount: number;
  currency: string;
  interval: string;
};

/**
 * Every way a Paystack plan disagrees with a catalog row, or an empty list when it matches.
 * Checkout and the console's plan-code change both use this, so the two can never disagree about
 * what "matches" means.
 */
export function paystackPlanMismatches(
  remote: PaystackRemotePlan,
  plan: { providerPriceId: string; priceMinor: bigint; currency: string; billingInterval: string },
): string[] {
  const interval = plan.billingInterval === 'MONTHLY' ? 'monthly' : 'annually';
  return [
    ...(remote.plan_code !== plan.providerPriceId ? ['plan code'] : []),
    ...(!Number.isSafeInteger(remote.amount) || BigInt(remote.amount) !== plan.priceMinor
      ? [`amount (Paystack ${remote.amount}, catalog ${plan.priceMinor.toString()})`]
      : []),
    ...(remote.currency !== plan.currency
      ? [`currency (Paystack ${remote.currency}, catalog ${plan.currency})`]
      : []),
    ...(remote.interval !== interval
      ? [`interval (Paystack ${remote.interval}, catalog ${interval})`]
      : []),
  ];
}

/**
 * Paystack REST adapter (api.paystack.co), the sole active subscription provider.
 * ValueBooks is the merchant of record for these; Paystack's customer-facing documents are its own
 * payment receipts, not a ValueBooks tax invoice (billing spec Section 7.2/16).
 *
 * No Paystack SDK dependency is added; the handful of endpoints used are called directly.
 */
@Injectable()
export class PaystackBillingAdapter implements BillingProvider {
  readonly name = 'PAYSTACK' as const;

  private get apiBase(): string {
    return 'https://api.paystack.co';
  }

  private get secretKey(): string {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key) {
      throw new BadGatewayException(
        'Paystack is not configured. Set PAYSTACK_SECRET_KEY before enabling subscription checkout.',
      );
    }
    return key;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    if (!response.ok) {
      throw new BadGatewayException(
        `Paystack API error (${response.status}): ${body?.message ?? 'unknown error'}`,
      );
    }
    return body as T;
  }

  /**
   * Paystack's transaction-initialize call both starts the first charge and, when a `plan` code is
   * supplied, creates the recurring subscription once that first charge succeeds — there is no
   * separate "create subscription" call for a brand-new subscriber.
   */
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    // Paystack ignores `amount` when a plan code is present. Verify the remote plan
    // immediately before initialization so a stale dashboard price cannot charge differently.
    const remote = await this.getPlan(input.plan.providerPriceId);
    if (paystackPlanMismatches(remote, input.plan).length > 0) {
      throw new BadGatewayException('Paystack plan price, currency or interval differs from the ValueBooks catalog. Checkout was stopped.');
    }
    const result = await this.request<{
      data: { authorization_url: string; reference: string };
    }>('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: input.customerEmail,
        amount: Number(input.plan.priceMinor),
        currency: input.plan.currency,
        plan: input.plan.providerPriceId,
        callback_url: input.successUrl,
        metadata: { clientReference: input.clientReference, organizationId: input.organizationId },
      }),
    });
    return { checkoutUrl: result.data.authorization_url, providerCheckoutId: result.data.reference };
  }

  /** Reads one plan from Paystack. Throws when credentials are missing or the code is unknown. */
  async getPlan(planCode: string): Promise<PaystackRemotePlan> {
    const remote = await this.request<{ data: PaystackRemotePlan }>(
      `/plan/${encodeURIComponent(planCode)}`,
      { method: 'GET' },
    );
    return remote.data;
  }

  /**
   * Creates a plan at Paystack and returns its code, for a tier that does not exist there yet.
   */
  async createPlan(input: {
    name: string;
    amountMinor: bigint;
    currency: string;
    interval: 'monthly' | 'annually';
    description?: string | null;
  }): Promise<PaystackRemotePlan> {
    const result = await this.request<{ data: PaystackRemotePlan }>('/plan', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        amount: Number(input.amountMinor),
        currency: input.currency,
        interval: input.interval,
        ...(input.description ? { description: input.description } : {}),
      }),
    });
    return result.data;
  }

  /**
   * Changes a plan's amount at Paystack.
   *
   * `update_existing_subscriptions` is sent explicitly on every call and is never left to
   * Paystack's default, which is `true`: whether current subscribers are repriced is a commercial
   * decision, and it must be stated at the call site rather than inherited. ValueBooks sends `true`
   * (owner decision, 23 Oct 2026: existing subscribers are repriced at their next renewal), and
   * Paystack reports how many subscriptions it touched, which the console records and shows.
   *
   * `interval` is deliberately not updatable here. A monthly and a yearly plan are separate catalog
   * rows with separate Paystack codes; moving a plan between intervals would silently change what
   * its subscribers are billed for, not just how much.
   */
  async updatePlanAmount(input: {
    planCode: string;
    amountMinor: bigint;
    currency: string;
    updateExistingSubscriptions: boolean;
  }): Promise<{ affectedSubscriptions: number | null; message: string }> {
    if (typeof input.updateExistingSubscriptions !== 'boolean') {
      throw new Error('An explicit subscription repricing choice is required before updating a Paystack plan.');
    }
    const result = await this.request<{ message?: string }>(
      `/plan/${encodeURIComponent(input.planCode)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          amount: Number(input.amountMinor),
          currency: input.currency,
          update_existing_subscriptions: input.updateExistingSubscriptions,
        }),
      },
    );
    const message = result.message ?? '';
    // Paystack answers "Plan updated. 1 subscription(s) affected." The count is the only report of
    // how many live subscriptions it repriced, so it is parsed rather than assumed, and left null
    // when the wording changes instead of being reported as zero.
    const affected = /(\d+)\s+subscription/i.exec(message);
    return {
      affectedSubscriptions: affected?.[1] ? Number(affected[1]) : null,
      message,
    };
  }

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    const result = await this.request<{
      data: {
        subscription_code: string;
        customer: { customer_code: string };
        status: string;
        next_payment_date: string | null;
        email_token?: string;
      };
    }>(`/subscription/${providerSubscriptionId}`, { method: 'GET' });
    const data = result.data;
    return {
      providerSubscriptionId: data.subscription_code,
      providerCustomerId: data.customer.customer_code,
      status: mapPaystackStatus(data.status),
      currentPeriodStart: null,
      currentPeriodEnd: data.next_payment_date ? new Date(data.next_payment_date) : null,
      cancelAtPeriodEnd: data.status === 'cancelled' || data.status === 'non-renewing',
      emailToken: data.email_token,
    };
  }

  /**
   * Paystack's disable-subscription endpoint takes the subscription code *and* its email token
   * together, not the code alone — both must be fetched from `getSubscription`-equivalent data
   * before calling this, which `SubscriptionService` is responsible for.
   */
  async cancelSubscription(input: CancelSubscriptionInput & { emailToken?: string }): Promise<void> {
    if (!input.emailToken) {
      throw new BadGatewayException(
        'Paystack subscription cancellation requires the subscription email token.',
      );
    }
    await this.request('/subscription/disable', {
      method: 'POST',
      body: JSON.stringify({ code: input.providerSubscriptionId, token: input.emailToken }),
    });
  }

  async enableSubscription(providerSubscriptionId: string, emailToken?: string) {
    if (!emailToken) throw new BadGatewayException('Paystack subscription reactivation requires the subscription email token.');
    await this.request('/subscription/enable', { method: 'POST',
      body: JSON.stringify({ code: providerSubscriptionId, token: emailToken }) });
  }

  async getPaymentMethodUrl(providerSubscriptionId: string): Promise<string> {
    const result = await this.request<{ data: { link: string } }>(
      `/subscription/${encodeURIComponent(providerSubscriptionId)}/manage/link`,
      { method: 'GET' },
    );
    return result.data.link;
  }

  async requestRefund(providerTransactionId: string, amountMinor: bigint, currency: string, reason: string) {
    const result = await this.request<{ data: { id: number; status: string } }>('/refund', {
      method: 'POST',
      body: JSON.stringify({ transaction: providerTransactionId, amount: Number(amountMinor), currency,
        merchant_note: reason }),
    });
    return { reference: String(result.data.id), status: result.data.status };
  }

  /**
   * Paystack signs the raw request body with HMAC-SHA512 using the secret key, hex-encoded, in
   * the `x-paystack-signature` header.
   */
  // Not `async`: signature verification here is entirely synchronous HMAC comparison. The shared
  // `BillingProvider` interface still returns a Promise (other adapter methods genuinely await a
  // network call), so the result is wrapped rather than declared `async` with nothing to await.
  verifyWebhook(input: WebhookInput): Promise<VerifiedWebhookEvent> {
    const header = input.headers['x-paystack-signature'];
    const providedHash = Array.isArray(header) ? header[0] : header;
    if (!providedHash) throw new UnauthorizedException('Missing x-paystack-signature header.');

    const rawBody = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    if (!safeEqualHex(expected, providedHash)) {
      throw new UnauthorizedException('Paystack webhook signature verification failed.');
    }

    const payload = JSON.parse(rawBody) as { event: string; data: { id: number } };
    return Promise.resolve({
      // Paystack does not supply a stable webhook-event UUID. A transaction/resource ID alone
      // collides across distinct lifecycle event types. Exact signed payload bytes identify a
      // delivery retry; the transaction/reference unique key protects payment application too.
      providerEventId: createHash('sha256').update(rawBody).digest('hex'),
      eventType: payload.event,
      payload,
    });
  }
}

function mapPaystackStatus(status: string): ProviderSubscription['status'] {
  switch (status) {
    case 'active':
      return 'active';
    case 'attention':
      return 'past_due';
    case 'cancelled':
    case 'completed':
      return 'cancelled';
    case 'non-renewing':
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
