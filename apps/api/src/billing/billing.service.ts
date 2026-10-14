import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanStatus } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { PaddleBillingAdapter } from './paddle-billing.adapter.js';
import { PaystackBillingAdapter } from './paystack-billing.adapter.js';

const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

/** Subscription billing only. Customer invoice payment collection never enters this service. */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paddle: PaddleBillingAdapter,
    private readonly paystack: PaystackBillingAdapter,
  ) {}

  async publicPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { status: PlanStatus.ACTIVE },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      select: {
        id: true,
        key: true,
        tierKey: true,
        name: true,
        description: true,
        isMostPopular: true,
        priceMinor: true,
        currency: true,
        billingInterval: true,
        trialDays: true,
        billingProvider: true,
        providerPriceId: true,
        entitlements: { where: { enabled: true }, select: { key: true, limitValue: true } },
      },
    });
    // `priceMinor` is a BigInt column; Nest's default JSON serializer cannot stringify a BigInt at
    // all (even zero), so every numeric-money field this endpoint returns is converted to a string
    // here, the same convention `createIntent`/`serialize` below already use.
    return plans.map((plan) => ({
      id: plan.id,
      key: plan.key,
      tierKey: plan.tierKey,
      name: plan.name,
      description: plan.description,
      isMostPopular: plan.isMostPopular,
      priceMinor: plan.priceMinor.toString(),
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      trialDays: plan.trialDays,
      // Whether this plan can actually be checked out yet (a provider price is configured), not
      // the provider identifiers themselves -- those stay internal.
      checkoutAvailable: Boolean(plan.billingProvider && plan.providerPriceId),
      entitlements: plan.entitlements,
    }));
  }

  async createIntent(planKey: string) {
    const plan = await this.prisma.plan.findFirst({
      where: { key: planKey, status: PlanStatus.ACTIVE },
    });
    if (!plan) throw new NotFoundException('This plan is no longer available.');
    return this.prisma.registrationIntent.create({
      data: { planId: plan.id, expiresAt: new Date(Date.now() + INTENT_TTL_MS) },
      select: {
        id: true,
        expiresAt: true,
        plan: {
          select: {
            key: true,
            name: true,
            priceMinor: true,
            currency: true,
            billingInterval: true,
            trialDays: true,
          },
        },
      },
    });
  }

  async checkout(
    intentId: string,
    userId: string,
    userEmail: string,
    successUrl?: string,
    cancelUrl?: string,
  ) {
    const intent = await this.intentForUser(intentId, userId);
    if (intent.paymentVerifiedAt) return this.serialize(intent);
    if (intent.plan.status !== PlanStatus.ACTIVE)
      throw new BadRequestException(
        'This plan is no longer available. Select an available plan to continue.',
      );

    // A real provider checkout requires both a chosen provider and its price identifier to be
    // configured on the plan (Section 20: never silently reprice or route a plan that has not been
    // deliberately wired to a provider), plus the redirect URLs a hosted checkout needs. Any
    // missing piece falls back to the existing development simulation, itself blocked outside
    // non-production environments.
    if (
      intent.plan.billingProvider &&
      intent.plan.providerPriceId &&
      intent.plan.providerProductId &&
      successUrl &&
      cancelUrl
    ) {
      const adapter = intent.plan.billingProvider === 'PADDLE' ? this.paddle : this.paystack;
      const result = await adapter.createCheckout({
        organizationId: '', // not yet created at signup time; clientReference carries the intent id
        providerCustomerId: null,
        customerEmail: userEmail,
        plan: {
          providerProductId: intent.plan.providerProductId,
          providerPriceId: intent.plan.providerPriceId,
          priceMinor: intent.plan.priceMinor,
          currency: intent.plan.currency,
        },
        successUrl,
        cancelUrl,
        clientReference: intent.id,
      });
      await this.prisma.registrationIntent.update({
        where: { id: intent.id },
        data: { providerReference: result.providerCheckoutId },
      });
      return { ...this.serialize(intent), checkoutUrl: result.checkoutUrl };
    }

    return this.serialize(intent);
  }

  async confirmDevelopmentCheckout(intentId: string, userId: string) {
    if (process.env.NODE_ENV === 'production')
      throw new BadRequestException('A configured payment provider is required for checkout.');
    const intent = await this.intentForUser(intentId, userId);
    if (!intent.paymentVerifiedAt) {
      await this.prisma.registrationIntent.update({
        where: { id: intent.id },
        data: { paymentVerifiedAt: new Date(), providerReference: `dev_${intent.id}` },
      });
    }
    return this.checkout(intentId, userId, '');
  }

  private async intentForUser(id: string, userId: string) {
    const intent = await this.prisma.registrationIntent.findFirst({
      where: { id, userId, consumedAt: null, expiresAt: { gt: new Date() } },
      include: { plan: true },
    });
    if (!intent)
      throw new NotFoundException('This checkout session is unavailable. Choose a plan again.');
    return intent;
  }
  private serialize(intent: Awaited<ReturnType<BillingService['intentForUser']>>) {
    return {
      id: intent.id,
      paymentVerified: Boolean(intent.paymentVerifiedAt),
      provider: process.env.NODE_ENV === 'production' ? 'not-configured' : 'development-simulation',
      plan: {
        key: intent.plan.key,
        name: intent.plan.name,
        amountMinor: intent.plan.priceMinor.toString(),
        currency: intent.plan.currency,
        billingInterval: intent.plan.billingInterval,
        trialDays: intent.plan.trialDays,
      },
      providerReference: intent.providerReference,
    };
  }
}
