/**
 * Common contract for the active payment processor. Backend-owned routing picks which adapter
 * handles a given plan; neither the client nor the plan's own
 * row is trusted to assert which provider it is, only the server-side routing table
 * (`BILLING_PROVIDER_ROUTING` below) is.
 */
export interface CheckoutInput {
  organizationId: string;
  /** Null for a brand-new signup checkout where the organization does not exist yet; the intent
   * row carries the plan selection until it does. */
  providerCustomerId: string | null;
  customerEmail: string;
  plan: {
    providerPriceId: string;
    priceMinor: bigint;
    currency: string;
    billingInterval: 'MONTHLY' | 'YEARLY';
  };
  successUrl: string;
  cancelUrl: string;
  /** Opaque reference round-tripped through the provider so the webhook handler can find the
   * internal record (registration intent, subscription, or plan-change) that initiated this
   * checkout without guessing from provider IDs alone. */
  clientReference: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  providerCheckoutId: string;
}

export interface ProviderSubscription {
  providerSubscriptionId: string;
  providerCustomerId: string;
  status: 'active' | 'past_due' | 'cancelled' | 'paused' | 'unknown';
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  emailToken?: string;
}

export interface CancelSubscriptionInput {
  providerSubscriptionId: string;
  /** True ends access now; false (the default customers should get) schedules cancellation for
   * the end of the current paid period. */
  immediately?: boolean;
}

export interface WebhookInput {
  /** Raw request body bytes/string, required for signature verification -- never the
   * already-JSON-parsed body, which would not reproduce the same bytes the provider signed. */
  rawBody: string | Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export interface VerifiedWebhookEvent {
  providerEventId: string;
  eventType: string;
  payload: unknown;
}

export interface BillingProvider {
  readonly name: 'PAYSTACK';
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<void>;
  getCustomerPortalUrl?(input: { providerCustomerId: string }): Promise<string>;
  /** Verifies the raw request against the provider's signing secret and returns the parsed event
   * only once verification has succeeded. Throws rather than returning a false/unverified result,
   * so a caller cannot forget to check a boolean. */
  verifyWebhook(input: WebhookInput): Promise<VerifiedWebhookEvent>;
}

/** Backend-owned, not derived from any client input or from the plan row at request time —
 * the plan row's own `billingProvider` column must agree with this table or checkout refuses to
 * proceed, so a misconfigured plan fails closed rather than silently routing to the wrong
 * processor. */
export const BILLING_PROVIDER_ROUTING: Record<string, 'PAYSTACK'> = {
  starter: 'PAYSTACK',
  growth: 'PAYSTACK',
  professional: 'PAYSTACK',
  advanced: 'PAYSTACK',
};
