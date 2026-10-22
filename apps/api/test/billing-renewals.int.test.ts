import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { normalizePaystackEvent } from '../src/billing/billing-webhook.controller.js';
import { BillingWebhookService } from '../src/billing/billing-webhook.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'billing-renewals-test', userAgent: 'billing-renewals-test' };
const PAID_THROUGH = new Date('2026-10-01T00:00:00.000Z');
const LAST_PAID = new Date('2026-09-01T00:00:00.000Z');

/**
 * Paystack renewals (D12). A renewal arrives as `charge.success`, which names the customer and the
 * plan but not the subscription, followed by `invoice.update`, which names the subscription. Both
 * carry the same charge reference. Either must apply the renewal exactly once, with the same
 * amount and currency checks as any other payment, and never to a guessed subscription.
 * Payload shapes follow Paystack's subscription documentation.
 */
describe('Paystack subscription renewals', () => {
  let harness: TestHarness;
  let webhooks: BillingWebhookService;
  let planId: string;
  let owner: PublicUser;
  let organizationId: string;
  let deliveries = 0;

  beforeAll(async () => {
    harness = await createTestHarness();
    webhooks = harness.app.get(BillingWebhookService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const plan = await harness.prisma.plan.create({
      data: {
        key: 'starter_monthly',
        tierKey: 'starter',
        name: 'Starter',
        status: 'ACTIVE',
        priceMinor: 100n,
        currency: 'USD',
        billingInterval: 'MONTHLY',
        billingProvider: 'PAYSTACK',
        providerPriceId: 'PLN_starter',
      },
    });
    planId = plan.id;
    owner = await user('renewal-owner@example.test');
    organizationId = await subscribedOrganization(owner, 'Renewal Books Ltd', 'SUB_renew');
  });

  it('applies a renewal charge.success by customer and plan code', async () => {
    await deliver(renewalCharge('renewal_ref_1'));

    const subscription = await currentSubscription(organizationId);
    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.lastPaymentAt?.toISOString()).toBe('2026-10-01T00:05:00.000Z');
    expect(subscription.currentPeriodEnd!.getTime()).toBeGreaterThan(PAID_THROUGH.getTime());
    const transactions = await harness.prisma.billingTransaction.findMany({
      where: { organizationId },
    });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      providerTransactionId: 'renewal_ref_1',
      amountMinor: 100n,
      currency: 'USD',
      status: 'SUCCESSFUL',
      planId,
    });
  });

  it("applies a paid invoice.update by subscription code with Paystack's period", async () => {
    await deliver(paidInvoice('renewal_ref_2'));

    const subscription = await currentSubscription(organizationId);
    expect(subscription.currentPeriodStart?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(subscription.currentPeriodEnd?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(subscription.lastPaymentAt?.toISOString()).toBe('2026-10-01T00:05:00.000Z');
    expect(await harness.prisma.billingTransaction.count({ where: { organizationId } })).toBe(1);
  });

  it('records one transaction when both reports of the same renewal arrive, in either order', async () => {
    await deliver(paidInvoice('renewal_ref_3'));
    await deliver(renewalCharge('renewal_ref_3'));
    expect(await harness.prisma.billingTransaction.count({ where: { organizationId } })).toBe(1);
    // The charge report states no period, so it leaves Paystack's invoice period in place.
    expect((await currentSubscription(organizationId)).currentPeriodEnd?.toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );

    const second = await subscribedOrganization(
      await user('renewal-second@example.test'),
      'Second Books Ltd',
      'SUB_second',
      'CUS_second',
    );
    await deliver(renewalCharge('renewal_ref_4', 'CUS_second'));
    await deliver(paidInvoice('renewal_ref_4', 'SUB_second', 'CUS_second'));
    expect(
      await harness.prisma.billingTransaction.count({ where: { organizationId: second } }),
    ).toBe(1);
    expect((await currentSubscription(second)).currentPeriodEnd?.toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });

  it('refuses a renewal whose amount or currency differs from the plan, applying nothing', async () => {
    await expect(
      deliver(paidInvoice('renewal_ref_5', 'SUB_renew', 'CUS_renew', { amount: 999 })),
    ).rejects.toThrow(/does not match/);
    await expect(
      deliver(renewalCharge('renewal_ref_6', 'CUS_renew', { currency: 'NGN' })),
    ).rejects.toThrow(/does not match/);

    const subscription = await currentSubscription(organizationId);
    expect(subscription.lastPaymentAt?.toISOString()).toBe(LAST_PAID.toISOString());
    expect(subscription.currentPeriodEnd?.toISOString()).toBe(PAID_THROUGH.toISOString());
    expect(await harness.prisma.billingTransaction.count()).toBe(0);
    expect(
      await harness.prisma.billingWebhookEvent.count({ where: { processingState: 'FAILED' } }),
    ).toBe(2);
  });

  it('refuses a renewal charge that fits more than one subscription', async () => {
    // The same Paystack customer pays for two organizations on the same plan.
    const twin = await subscribedOrganization(owner, 'Twin Books Ltd', 'SUB_twin', 'CUS_renew');
    await expect(deliver(renewalCharge('renewal_ref_7'))).rejects.toThrow(/more than one/);

    expect(await harness.prisma.billingTransaction.count()).toBe(0);
    for (const id of [organizationId, twin]) {
      expect((await currentSubscription(id)).lastPaymentAt?.toISOString()).toBe(
        LAST_PAID.toISOString(),
      );
    }
    const event = await harness.prisma.billingWebhookEvent.findFirstOrThrow();
    expect(event.processingState).toBe('FAILED');
    expect(event.lastError).toMatch(/more than one subscription/);
  });

  it('ignores unpaid invoices and one-off charges that name no plan, as before', async () => {
    await deliver(paidInvoice('renewal_ref_8', 'SUB_renew', 'CUS_renew', {}, { paid: false }));
    const oneOff = renewalCharge('renewal_ref_9');
    oneOff.data.plan = {};
    await deliver(oneOff);

    expect(await harness.prisma.billingTransaction.count()).toBe(0);
    expect((await currentSubscription(organizationId)).lastPaymentAt?.toISOString()).toBe(
      LAST_PAID.toISOString(),
    );
  });

  function renewalCharge(
    reference: string,
    customer = 'CUS_renew',
    override: { amount?: number; currency?: string } = {},
  ) {
    return {
      event: 'charge.success',
      data: {
        id: 9000,
        reference,
        amount: override.amount ?? 100,
        currency: override.currency ?? 'USD',
        paid_at: '2026-10-01T00:05:00.000Z',
        status: 'success',
        metadata: '',
        customer: { customer_code: customer },
        plan: { plan_code: 'PLN_starter' } as { plan_code?: string },
      },
    };
  }

  function paidInvoice(
    reference: string,
    subscriptionCode = 'SUB_renew',
    customer = 'CUS_renew',
    charge: { amount?: number; currency?: string } = {},
    invoice: { paid?: boolean } = {},
  ) {
    return {
      event: 'invoice.update',
      data: {
        id: 7000,
        invoice_code: `INV_${reference}`,
        amount: charge.amount ?? 100,
        period_start: '2026-10-01T00:00:00.000Z',
        period_end: '2026-11-01T00:00:00.000Z',
        status: 'success',
        paid: invoice.paid ?? true,
        paid_at: '2026-10-01T00:05:00.000Z',
        subscription: { subscription_code: subscriptionCode, status: 'active' },
        customer: { customer_code: customer },
        transaction: {
          reference,
          status: 'success',
          amount: charge.amount ?? 100,
          currency: charge.currency ?? 'USD',
        },
      },
    };
  }

  async function deliver(payload: { event: string }) {
    deliveries += 1;
    const verified = {
      providerEventId: `renewal-spec-${deliveries}`,
      eventType: payload.event,
      payload,
    };
    return webhooks.recordAndProcess('PAYSTACK', verified, normalizePaystackEvent(verified));
  }

  function currentSubscription(id: string) {
    return harness.prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: id },
    });
  }

  async function user(email: string): Promise<PublicUser> {
    const row = await harness.prisma.user.create({
      data: { email, displayName: email, emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      emailVerified: true,
      status: row.status,
    };
  }

  async function subscribedOrganization(
    member: PublicUser,
    legalName: string,
    subscriptionCode: string,
    customer = 'CUS_renew',
  ): Promise<string> {
    const organizations = harness.app.get(OrganizationService);
    const created = await organizations.create(
      member,
      { legalName, businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    await organizations.finalize(
      await harness.app.get(OrganizationAccessService).requireMembership(member.id, created.id),
      member,
      metadata,
    );
    const paid = {
      planId,
      status: 'ACTIVE' as const,
      billingProvider: 'PAYSTACK' as const,
      providerSubscriptionId: subscriptionCode,
      providerCustomerId: customer,
      currentPeriodStart: LAST_PAID,
      currentPeriodEnd: PAID_THROUGH,
      lastPaymentAt: LAST_PAID,
      trialEndsAt: null,
    };
    await harness.prisma.organizationSubscription.upsert({
      where: { organizationId: created.id },
      create: { organizationId: created.id, ...paid },
      update: paid,
    });
    return created.id;
  }
});
