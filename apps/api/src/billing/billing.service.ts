import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanStatus } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

/** Subscription billing only. Customer invoice payment collection never enters this service. */
@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async publicPlans() {
    return this.prisma.plan.findMany({
      where: { status: PlanStatus.ACTIVE },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        priceMinor: true,
        currency: true,
        billingInterval: true,
        trialDays: true,
        entitlements: { where: { enabled: true }, select: { key: true, limitValue: true } },
      },
    });
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

  async checkout(intentId: string, userId: string) {
    const intent = await this.intentForUser(intentId, userId);
    if (intent.paymentVerifiedAt) return this.serialize(intent);
    if (intent.plan.status !== PlanStatus.ACTIVE)
      throw new BadRequestException(
        'This plan is no longer available. Select an available plan to continue.',
      );
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
    return this.checkout(intentId, userId);
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
