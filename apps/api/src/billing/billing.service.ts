import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanStatus, type OrganizationSubscription } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { PaddleBillingAdapter } from './paddle-billing.adapter.js';
import { PaystackBillingAdapter } from './paystack-billing.adapter.js';
import { BILLING_PROVIDER_ROUTING } from './billing-provider.js';
import { UsageMeteringService } from './usage-metering.service.js';
import { BillingNotificationService } from './billing-notification.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';

const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

/** Subscription billing only. Customer invoice payment collection never enters this service. */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paddle: PaddleBillingAdapter,
    private readonly paystack: PaystackBillingAdapter,
    private readonly usage: UsageMeteringService,
    private readonly notices: BillingNotificationService,
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
        providerProductId: true,
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
      checkoutAvailable: Boolean(plan.billingProvider && plan.providerProductId && plan.providerPriceId &&
        (process.env.NODE_ENV !== 'production' || process.env.BILLING_LIVE_CHECKOUT_ENABLED === 'true')),
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
      if (process.env.NODE_ENV === 'production' && process.env.BILLING_LIVE_CHECKOUT_ENABLED !== 'true')
        throw new BadRequestException('Live subscription checkout is awaiting merchant readiness approval.');
      if (BILLING_PROVIDER_ROUTING[intent.plan.tierKey] !== intent.plan.billingProvider)
        throw new BadRequestException('This plan has an invalid payment provider configuration.');
      this.validateCheckoutUrls(successUrl, cancelUrl);
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
          billingInterval: intent.plan.billingInterval,
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

  async startOrganizationCheckout(input: {
    organizationId: string;
    userId: string;
    userEmail: string;
    planKey: string;
    idempotencyKey: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    this.validateCheckoutUrls(input.successUrl, input.cancelUrl);
    const [subscription, plan] = await Promise.all([
      this.prisma.organizationSubscription.findUnique({ where: { organizationId: input.organizationId }, include: { plan: true } }),
      this.prisma.plan.findFirst({ where: { key: input.planKey, status: 'ACTIVE' } }),
    ]);
    if (!subscription || !plan) throw new NotFoundException('Subscription or selected plan not found.');
    if (process.env.NODE_ENV === 'production' && process.env.BILLING_LIVE_CHECKOUT_ENABLED !== 'true')
      throw new BadRequestException('Live subscription checkout is awaiting merchant readiness approval.');
    if (!plan.billingProvider || !plan.providerProductId || !plan.providerPriceId ||
      BILLING_PROVIDER_ROUTING[plan.tierKey] !== plan.billingProvider)
      throw new BadRequestException('This plan is not ready for secure checkout.');
    if (subscription.status === 'ACTIVE' && subscription.planId === plan.id)
      throw new BadRequestException('This is already your current plan.');
    const tierOrder: Record<string, number> = { starter: 1, growth: 2, professional: 3, advanced: 4 };
    const isPaidDowngrade = Boolean(subscription.billingProvider && subscription.currentPeriodEnd &&
      ['ACTIVE', 'CANCEL_SCHEDULED'].includes(subscription.status) &&
      (tierOrder[plan.tierKey] ?? 0) < (tierOrder[subscription.plan.tierKey] ?? 0));
    const scheduled = await this.prisma.subscriptionChange.findFirst({ where: { organizationId: input.organizationId, status: 'SCHEDULED' }, orderBy: { createdAt: 'desc' } });
    if (scheduled && scheduled.toPlanId !== plan.id) throw new BadRequestException('A different downgrade is already scheduled.');
    if (scheduled && scheduled.effectiveAt && scheduled.effectiveAt > new Date())
      return { changeId: scheduled.id, checkoutUrl: null, status: 'SCHEDULED', effectiveAt: scheduled.effectiveAt };
    if (isPaidDowngrade && subscription.currentPeriodEnd && subscription.currentPeriodEnd > new Date() && !scheduled)
      return this.scheduleDowngrade(subscription, plan, input.userId, input.idempotencyKey);
    const replay = await this.prisma.subscriptionChange.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } },
    });
    if (replay?.checkoutUrl) return { changeId: replay.id, checkoutUrl: replay.checkoutUrl, status: replay.status };
    if (replay) throw new BadRequestException('This checkout is already being prepared. Refresh and try again.');
    const pending = await this.prisma.subscriptionChange.findFirst({
      where: { organizationId: input.organizationId, status: { in: ['PENDING', 'PAYMENT_PENDING', 'ACTIVE_NEW', 'CANCELLING_OLD'] },
        ...(scheduled ? { id: { not: scheduled.id } } : {}) },
      select: { id: true },
    });
    if (pending) throw new BadRequestException('A plan change is already in progress.');
    const change = scheduled ? await this.prisma.subscriptionChange.update({ where: { id: scheduled.id },
      data: { status: 'PENDING', idempotencyKey: input.idempotencyKey } }) : await this.prisma.subscriptionChange.create({
      data: {
        organizationId: input.organizationId,
        fromPlanId: subscription.planId,
        toPlanId: plan.id,
        fromProvider: subscription.billingProvider,
        toProvider: plan.billingProvider,
        requestedByUserId: input.userId,
        idempotencyKey: input.idempotencyKey,
        priorProviderSubscriptionId: subscription.providerSubscriptionId,
      },
    });
    try {
      const adapter = plan.billingProvider === 'PADDLE' ? this.paddle : this.paystack;
      const checkout = await adapter.createCheckout({
        organizationId: input.organizationId,
        providerCustomerId: subscription.billingProvider === plan.billingProvider ? subscription.providerCustomerId : null,
        customerEmail: input.userEmail,
        plan: { providerProductId: plan.providerProductId, providerPriceId: plan.providerPriceId, priceMinor: plan.priceMinor, currency: plan.currency, billingInterval: plan.billingInterval },
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        clientReference: change.id,
      });
      await this.prisma.subscriptionChange.update({
        where: { id: change.id },
        data: { status: 'PAYMENT_PENDING', providerCheckoutId: checkout.providerCheckoutId, checkoutUrl: checkout.checkoutUrl },
      });
      return { changeId: change.id, checkoutUrl: checkout.checkoutUrl, status: 'PAYMENT_PENDING' };
    } catch (error) {
      await this.prisma.subscriptionChange.update({ where: { id: change.id }, data: { status: 'FAILED', errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Checkout failed' } });
      throw error;
    }
  }

  private async scheduleDowngrade(subscription: OrganizationSubscription, plan: { id: string; billingProvider: 'PADDLE' | 'PAYSTACK' | null }, userId: string, idempotencyKey: string) {
    if (!subscription?.billingProvider || !subscription.providerSubscriptionId || !subscription.currentPeriodEnd || !plan.billingProvider)
      throw new BadRequestException('A linked paid subscription is required to schedule a downgrade.');
    const adapter = subscription.billingProvider === 'PADDLE' ? this.paddle : this.paystack;
    const remote = await adapter.getSubscription(subscription.providerSubscriptionId);
    await adapter.cancelSubscription({ providerSubscriptionId: subscription.providerSubscriptionId,
      ...(subscription.billingProvider === 'PAYSTACK' ? { emailToken: remote.emailToken } : {}) });
    const change = await this.prisma.$transaction(async (tx) => {
      const created = await tx.subscriptionChange.create({ data: { organizationId: subscription.organizationId,
        fromPlanId: subscription.planId, toPlanId: plan.id, fromProvider: subscription.billingProvider,
        toProvider: plan.billingProvider!, requestedByUserId: userId, idempotencyKey,
        priorProviderSubscriptionId: subscription.providerSubscriptionId, status: 'SCHEDULED',
        effectiveAt: subscription.currentPeriodEnd, oldCancellationStatus: 'CONFIRMED' } });
      await tx.organizationSubscription.update({ where: { id: subscription.id }, data: { status: 'CANCEL_SCHEDULED', cancelAtPeriodEnd: true } });
      await writeAuditEvent(tx, { organizationId: subscription.organizationId, actorUserId: userId,
        eventKey: 'billing.downgrade_scheduled', entityType: 'organization_subscription', entityId: subscription.id,
        action: 'UPDATE', before: { planId: subscription.planId, status: subscription.status },
        after: { targetPlanId: plan.id, effectiveAt: subscription.currentPeriodEnd!.toISOString() } });
      return created;
    });
    await this.notices.notify({ organizationId: subscription.organizationId, eventKey: 'billing.downgrade_scheduled',
      sourceId: change.id, subject: 'Your ValueBooks downgrade is scheduled',
      body: `Your current paid plan remains available until ${await this.notices.localDate(subscription.organizationId, subscription.currentPeriodEnd)}. At that point, authorize your new plan checkout from billing settings to continue editing. No replacement charge was made today.` }).catch(() => undefined);
    return { changeId: change.id, checkoutUrl: null, status: 'SCHEDULED', effectiveAt: subscription.currentPeriodEnd };
  }

  private validateCheckoutUrls(successUrl: string, cancelUrl: string) {
    const trustedOrigin = new URL(process.env.WEB_APP_URL ?? 'http://localhost:3000').origin;
    for (const url of [successUrl, cancelUrl]) {
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new BadRequestException('Invalid checkout return URL.'); }
      if (parsed.origin !== trustedOrigin)
        throw new BadRequestException('Checkout return URLs must use the application origin.');
    }
  }

  async organizationSummary(organizationId: string) {
    const [subscription, transactions, billingProfile, pendingChange] = await Promise.all([
      this.prisma.organizationSubscription.findUnique({
        where: { organizationId },
        include: {
          plan: { select: { id: true, key: true, name: true, tierKey: true, priceMinor: true, currency: true, billingInterval: true, entitlements: { where: { enabled: true }, select: { key: true, limitValue: true } } } },
          intendedPlan: { select: { key: true, name: true, billingInterval: true } },
        },
      }),
      this.prisma.billingTransaction.findMany({
        where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 20,
        select: { id: true, status: true, amountMinor: true, currency: true, paidAt: true, createdAt: true, receiptUrl: true, billingProvider: true, planNameSnapshot: true, billingIntervalSnapshot: true, periodStart: true, periodEnd: true, providerTransactionId: true },
      }),
      this.prisma.billingProfile.findUnique({ where: { organizationId } }),
      this.prisma.subscriptionChange.findFirst({ where: { organizationId, status: { in: ['SCHEDULED', 'PAYMENT_PENDING', 'CANCELLING_OLD'] } },
        orderBy: { createdAt: 'desc' }, select: { id: true, status: true, effectiveAt: true, toPlan: { select: { name: true, billingInterval: true } } } }),
    ]);
    const [customers, seats, vendors, products, bankAccounts, warehouses, projects, invoiceUsage, aiUsage] = await Promise.all([
      this.prisma.contact.count({ where: { organizationId, type: 'CUSTOMER', status: 'ACTIVE' } }),
      this.prisma.organizationMember.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.vendor.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.item.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.financialAccount.count({ where: { organizationId, active: true } }),
      this.prisma.warehouse.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.project.count({ where: { organizationId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
      this.usage.getUsage(organizationId, 'invoices.issued.max'),
      this.usage.getUsage(organizationId, 'ai_insights.max'),
    ]);
    const keys = ['customers.active.max', 'seats.max', 'vendors.max', 'products.max', 'bank_accounts.max', 'warehouses.enabled', 'projects.enabled'];
    const concurrentCounts = [customers, seats, vendors, products, bankAccounts, warehouses, projects];
    const entitlements = subscription?.plan.entitlements ?? [];
    const usage = await Promise.all(keys.map(async (key, index) => ({
      key, used: concurrentCounts[index], limit: await this.usage.resolveLimit(organizationId, key),
    })));
    usage.push({ key: 'invoices.issued.max', used: invoiceUsage.used, limit: invoiceUsage.limit });
    usage.push({ key: 'ai_insights.max', used: aiUsage.used, limit: aiUsage.limit });
    const period = await this.usage.periodForOrganization(organizationId);
    return {
      subscription: subscription ? {
        id: subscription.id,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        billingProvider: subscription.billingProvider,
        plan: { ...subscription.plan, priceMinor: subscription.plan.priceMinor.toString() },
        intendedPlan: subscription.intendedPlan,
      } : null,
      transactions: transactions.map(({ amountMinor, ...transaction }) => ({ ...transaction, amountMinor: amountMinor.toString() })),
      billingProfile,
      pendingChange,
      usage: { periodStart: period.start, periodEnd: period.end, resources: usage.filter(({ key }) => entitlements.some((item) => item.key === key)) },
    };
  }

  async transactionHistory(organizationId: string, pageInput?: string, pageSizeInput?: string, status?: string) {
    const page = Number(pageInput ?? 1);
    const pageSize = Number(pageSizeInput ?? 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw new BadRequestException('Invalid payment history page.');
    if (status && !['INITIATED', 'PENDING', 'SUCCESSFUL', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED'].includes(status))
      throw new BadRequestException('Invalid payment status filter.');
    const where = { organizationId, ...(status ? { status: status as 'SUCCESSFUL' } : {}) };
    const [rows, totalRows] = await Promise.all([
      this.prisma.billingTransaction.findMany({ where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, status: true, amountMinor: true, currency: true, paidAt: true, createdAt: true,
          receiptUrl: true, billingProvider: true, planNameSnapshot: true, billingIntervalSnapshot: true,
          periodStart: true, periodEnd: true, providerTransactionId: true } }),
      this.prisma.billingTransaction.count({ where }),
    ]);
    return { data: rows.map(({ amountMinor, ...row }) => ({ ...row, amountMinor: amountMinor.toString() })),
      pagination: { page, pageSize, totalRows } };
  }

  async transactionDocument(organizationId: string, transactionId: string) {
    const transaction = await this.prisma.billingTransaction.findFirst({
      where: { id: transactionId, organizationId, status: { in: ['SUCCESSFUL', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
    });
    if (!transaction) throw new NotFoundException('A verified payment document is unavailable.');
    const url = transaction.billingProvider === 'PADDLE'
      ? await this.paddle.getTransactionInvoiceUrl(transaction.providerTransactionId)
      : transaction.receiptUrl;
    if (!url || new URL(url).protocol !== 'https:')
      throw new NotFoundException('The provider has not supplied a receipt for this payment.');
    return { url, issuer: transaction.billingProvider };
  }

  async saveBillingProfile(organizationId: string, userId: string, input: {
    contactName: string; contactEmail: string; countryCode: string; addressLine1?: string;
    addressLine2?: string; city?: string; region?: string; postalCode?: string; taxId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.billingProfile.findUnique({ where: { organizationId } });
      const next = await tx.billingProfile.upsert({ where: { organizationId },
        create: { organizationId, ...input }, update: input });
      await writeAuditEvent(tx, { organizationId, actorUserId: userId,
        eventKey: 'billing.profile_updated', entityType: 'billing_profile', entityId: organizationId,
        action: previous ? 'UPDATE' : 'CREATE',
        before: previous ? { contactName: previous.contactName, contactEmail: previous.contactEmail, countryCode: previous.countryCode } : null,
        after: { contactName: next.contactName, contactEmail: next.contactEmail, countryCode: next.countryCode },
      });
      return next;
    });
  }

  async paymentMethodUrl(organizationId: string) {
    const subscription = await this.prisma.organizationSubscription.findUnique({ where: { organizationId } });
    if (!subscription?.billingProvider || !subscription.providerSubscriptionId)
      throw new BadRequestException('No paid subscription payment method is available yet.');
    const url = subscription.billingProvider === 'PADDLE'
      ? subscription.providerCustomerId
        ? await this.paddle.getCustomerPortalUrl({ providerCustomerId: subscription.providerCustomerId })
        : null
      : await this.paystack.getPaymentMethodUrl(subscription.providerSubscriptionId);
    if (!url || new URL(url).protocol !== 'https:') throw new BadRequestException('A secure payment method link is unavailable.');
    return { url, provider: subscription.billingProvider };
  }

  async cancelAtPeriodEnd(organizationId: string, userId: string, reason: string) {
    const subscription = await this.prisma.organizationSubscription.findUnique({ where: { organizationId } });
    if (!subscription || !['ACTIVE', 'PAST_DUE'].includes(subscription.status) ||
      !subscription.billingProvider || !subscription.providerSubscriptionId || !subscription.currentPeriodEnd)
      throw new BadRequestException('This subscription cannot be cancelled from billing settings.');
    const adapter = subscription.billingProvider === 'PADDLE' ? this.paddle : this.paystack;
    const remote = await adapter.getSubscription(subscription.providerSubscriptionId);
    await adapter.cancelSubscription({
      providerSubscriptionId: subscription.providerSubscriptionId,
      ...(subscription.billingProvider === 'PAYSTACK' ? { emailToken: remote.emailToken } : {}),
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationSubscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCEL_SCHEDULED', cancelAtPeriodEnd: true },
      });
      await writeAuditEvent(tx, {
        organizationId, actorUserId: userId, eventKey: 'billing.cancellation_scheduled',
        entityType: 'organization_subscription', entityId: subscription.id, action: 'UPDATE',
        before: { status: subscription.status, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd },
        after: { status: 'CANCEL_SCHEDULED', cancelAtPeriodEnd: true },
        metadata: { reason, provider: subscription.billingProvider },
      });
    });
    await this.notices.notify({ organizationId, eventKey: 'billing.cancellation_scheduled', sourceId: subscription.id,
      subject: 'Your ValueBooks cancellation is scheduled',
      body: `Your subscription renewal was canceled with ${subscription.billingProvider}. Paid access continues through ${await this.notices.localDate(organizationId, subscription.currentPeriodEnd)}. Your records remain stored.` }).catch(() => undefined);
    return { status: 'CANCEL_SCHEDULED', accessEndsAt: subscription.currentPeriodEnd };
  }

  async resumeCancellation(organizationId: string, userId: string) {
    const subscription = await this.prisma.organizationSubscription.findUnique({ where: { organizationId } });
    if (!subscription || subscription.status !== 'CANCEL_SCHEDULED' || !subscription.billingProvider ||
      !subscription.providerSubscriptionId || !subscription.currentPeriodEnd || subscription.currentPeriodEnd <= new Date())
      throw new BadRequestException('This cancellation cannot be resumed. Choose a new plan after the paid term ends.');
    const remote = await (subscription.billingProvider === 'PADDLE' ? this.paddle : this.paystack).getSubscription(subscription.providerSubscriptionId);
    if (subscription.billingProvider === 'PADDLE')
      await this.paddle.removeScheduledCancellation(subscription.providerSubscriptionId);
    else await this.paystack.enableSubscription(subscription.providerSubscriptionId, remote.emailToken);
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationSubscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE', cancelAtPeriodEnd: false, cancelledAt: null } });
      await tx.subscriptionChange.updateMany({ where: { organizationId, status: 'SCHEDULED' }, data: { status: 'FAILED', errorMessage: 'Customer resumed prior subscription.' } });
      await writeAuditEvent(tx, { organizationId, actorUserId: userId, eventKey: 'billing.cancellation_resumed',
        entityType: 'organization_subscription', entityId: subscription.id, action: 'UPDATE',
        before: { status: 'CANCEL_SCHEDULED' }, after: { status: 'ACTIVE', cancelAtPeriodEnd: false } });
    });
    await this.notices.notify({ organizationId, eventKey: 'billing.cancellation_resumed', sourceId: `${subscription.id}:${Date.now()}`,
      subject: 'Your ValueBooks subscription will continue', body: 'Your scheduled cancellation has been removed with your payment provider. Your current plan will continue.' }).catch(() => undefined);
    return { status: 'ACTIVE' };
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
