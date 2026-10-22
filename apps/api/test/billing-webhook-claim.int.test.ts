import { randomUUID } from 'node:crypto';

import { InternalServerErrorException } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingWebhookController } from '../src/billing/billing-webhook.controller.js';
import {
  BillingWebhookService,
  WEBHOOK_CLAIM_STALE_MS,
} from '../src/billing/billing-webhook.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

/**
 * Webhook idempotency under concurrency (defect D6): a signed Paystack delivery is applied at most
 * once even when duplicates arrive together, a crashed worker's claim can be taken over, and the
 * controller never verifies a re-serialised body.
 */
describe('billing webhook processing claim', () => {
  let harness: TestHarness;
  let webhooks: BillingWebhookService;
  let apply: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    harness = await createTestHarness();
    webhooks = harness.app.get(BillingWebhookService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    // Stand in for the subscription mutation so the spec counts applications, not side effects.
    apply = vi.fn(async () => new Promise<void>((done) => setTimeout(done, 150)));
    vi.spyOn(
      webhooks as unknown as { applyToSubscription: () => Promise<void> },
      'applyToSubscription',
    ).mockImplementation(apply);
  });

  afterEach(() => vi.restoreAllMocks());

  const delivery = () => ({
    providerEventId: randomUUID(),
    eventType: 'charge.success',
    payload: { event: 'charge.success', data: { id: 1 } },
  });

  it('applies concurrent duplicate deliveries exactly once', async () => {
    const verified = delivery();
    const results = await Promise.all([
      webhooks.recordAndProcess('PAYSTACK', verified, {}),
      webhooks.recordAndProcess('PAYSTACK', verified, {}),
      webhooks.recordAndProcess('PAYSTACK', verified, {}),
    ]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
    const row = await harness.prisma.billingWebhookEvent.findUniqueOrThrow({
      where: {
        billingProvider_providerEventId: {
          billingProvider: 'PAYSTACK',
          providerEventId: verified.providerEventId,
        },
      },
    });
    expect(row.processingState).toBe('PROCESSED');
  });

  it('skips a redelivery of an already processed event', async () => {
    const verified = delivery();
    await webhooks.recordAndProcess('PAYSTACK', verified, {});
    await expect(webhooks.recordAndProcess('PAYSTACK', verified, {})).resolves.toEqual({
      deduplicated: true,
    });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('stands down while another delivery holds a fresh claim, and takes over a stale one', async () => {
    const verified = delivery();
    await harness.prisma.billingWebhookEvent.create({
      data: {
        billingProvider: 'PAYSTACK',
        providerEventId: verified.providerEventId,
        eventType: verified.eventType,
        signatureVerified: true,
        processingState: 'PROCESSING',
        processingStartedAt: new Date(),
        payload: verified.payload,
      },
    });
    await expect(webhooks.recordAndProcess('PAYSTACK', verified, {})).resolves.toEqual({
      deduplicated: true,
    });
    expect(apply).not.toHaveBeenCalled();

    await harness.prisma.billingWebhookEvent.updateMany({
      where: { providerEventId: verified.providerEventId },
      data: { processingStartedAt: new Date(Date.now() - WEBHOOK_CLAIM_STALE_MS - 1000) },
    });
    await expect(webhooks.recordAndProcess('PAYSTACK', verified, {})).resolves.toEqual({
      deduplicated: false,
    });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('records FAILED and lets a later delivery re-claim the event', async () => {
    const verified = delivery();
    apply.mockRejectedValueOnce(new Error('downstream unavailable'));
    await expect(webhooks.recordAndProcess('PAYSTACK', verified, {})).rejects.toThrow(
      'downstream unavailable',
    );
    const failed = await harness.prisma.billingWebhookEvent.findFirstOrThrow({
      where: { providerEventId: verified.providerEventId },
    });
    expect(failed.processingState).toBe('FAILED');

    await expect(webhooks.recordAndProcess('PAYSTACK', verified, {})).resolves.toEqual({
      deduplicated: false,
    });
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('refuses to verify when the raw request body is unavailable', async () => {
    const controller = harness.app.get(BillingWebhookController);
    await expect(
      controller.paystack({ body: { event: 'charge.success' }, headers: {} } as never),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
