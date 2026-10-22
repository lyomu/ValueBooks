import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { OFFICIAL_PLAN_TIERS } from '@valuebooks/contracts';

import { PrismaService } from '../database/prisma.service.js';
import { TrialLifecycleService } from '../billing/trial-lifecycle.service.js';
import { PaystackBillingAdapter } from '../billing/paystack-billing.adapter.js';
import { BillingWebhookService } from '../billing/billing-webhook.service.js';
import { normalizePaystackEvent } from '../billing/billing-webhook.controller.js';
import { writePlatformAudit } from './platform-audit.js';
import type { PlatformContext } from './platform-context.js';

function pagination(page?: string, pageSize?: string) {
  const parsedPage = Number(page ?? 1);
  const parsedSize = Number(pageSize ?? 25);
  if (!Number.isInteger(parsedPage) || parsedPage < 1 || !Number.isInteger(parsedSize) || parsedSize < 1 || parsedSize > 100)
    throw new BadRequestException('Invalid page or page size.');
  return { page: parsedPage, pageSize: parsedSize, skip: (parsedPage - 1) * parsedSize };
}

@Injectable()
export class PlatformBillingService {
  constructor(private readonly prisma: PrismaService, private readonly trialLifecycle: TrialLifecycleService,
    private readonly paystack: PaystackBillingAdapter,
    private readonly webhooksService: BillingWebhookService) {}

  async overview() {
    const [subscriptions, transactions, failedWebhooks, unresolvedChanges, failedPayments] = await Promise.all([
      this.prisma.organizationSubscription.findMany({
        select: { status: true, trialEndsAt: true, plan: { select: { priceMinor: true, currency: true, billingInterval: true, tierKey: true } } },
      }),
      this.prisma.billingTransaction.findMany({ where: { status: 'SUCCESSFUL' }, select: { amountMinor: true, currency: true, paidAt: true } }),
      this.prisma.billingWebhookEvent.count({ where: { processingState: 'FAILED' } }),
      this.prisma.subscriptionChange.count({ where: { status: 'CANCELLING_OLD' } }),
      this.prisma.billingTransaction.count({ where: { status: 'FAILED' } }),
    ]);
    const arr = new Map<string, bigint>();
    const mrr = new Map<string, bigint>();
    for (const subscription of subscriptions) {
      if (!['ACTIVE', 'CANCEL_SCHEDULED'].includes(subscription.status)) continue;
      const annual = subscription.plan.priceMinor * (subscription.plan.billingInterval === 'YEARLY' ? 1n : 12n);
      arr.set(subscription.plan.currency, (arr.get(subscription.plan.currency) ?? 0n) + annual);
      // Currency minor units cannot represent every annual-contract monthly equivalent exactly;
      // round each normalized contract to its nearest minor unit and disclose that in methodology.
      mrr.set(subscription.plan.currency, (mrr.get(subscription.plan.currency) ?? 0n) + (annual + 6n) / 12n);
    }
    const cash = new Map<string, bigint>();
    for (const transaction of transactions) cash.set(transaction.currency, (cash.get(transaction.currency) ?? 0n) + transaction.amountMinor);
    return {
      active: subscriptions.filter((row) => row.status === 'ACTIVE').length,
      trialing: subscriptions.filter((row) => row.status === 'TRIALING').length,
      trialExpiring24h: subscriptions.filter((row) => row.status === 'TRIALING' && row.trialEndsAt && row.trialEndsAt.getTime() <= Date.now() + 86_400_000).length,
      activePaid: subscriptions.filter((row) => ['ACTIVE', 'CANCEL_SCHEDULED'].includes(row.status)).length,
      trialConversionRate: (() => {
        const completedTrials = subscriptions.filter((row) => row.status !== 'TRIALING' && row.trialEndsAt).length;
        const converted = subscriptions.filter((row) => ['ACTIVE', 'CANCEL_SCHEDULED'].includes(row.status) && row.trialEndsAt).length;
        return completedTrials ? Number((converted / completedTrials * 100).toFixed(1)) : null;
      })(),
      pastDue: subscriptions.filter((row) => row.status === 'PAST_DUE').length,
      cancelled: subscriptions.filter((row) => row.status === 'CANCELLED').length,
      failedWebhooks,
      failedPayments,
      unresolvedChanges,
      // Annual contract value is divided by twelve only at display time. Group by currency;
      // no unsupported FX conversion or sum of unrelated currencies is presented as USD revenue.
      mrrMinorByCurrency: Object.fromEntries([...mrr].map(([currency, amount]) => [currency, amount.toString()])),
      arrMinorByCurrency: Object.fromEntries([...arr].map(([currency, amount]) => [currency, amount.toString()])),
      settledGrossMinorByCurrency: Object.fromEntries([...cash].map(([currency, amount]) => [currency, amount.toString()])),
      methodology: 'MRR normalizes each active recurring contract from its actual monthly or annual price (annual monthly equivalents round to the nearest minor unit); ARR is MRR × 12. Trial conversion counts completed trials that became active paid subscriptions. Currency groups are not converted or added.',
    };
  }

  async revenue() {
    const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1));
    const [transactions, refunds, changes] = await Promise.all([
      this.prisma.billingTransaction.findMany({ where: { paidAt: { gte: since }, status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
        select: { amountMinor: true, refundedMinor: true, currency: true, paidAt: true, status: true } }),
      this.prisma.billingRefund.findMany({ where: { completedAt: { gte: since }, status: 'COMPLETED' }, select: { amountMinor: true, currency: true, completedAt: true } }),
      this.prisma.subscriptionChange.findMany({ where: { completedAt: { gte: since }, status: 'COMPLETED' }, select: { fromPlan: { select: { priceMinor: true, currency: true, billingInterval: true } },
        toPlan: { select: { priceMinor: true, currency: true, billingInterval: true } } } }),
    ]);
    const monthly = new Map<string, { gross: bigint; refunds: bigint; count: number }>();
    for (const row of transactions) {
      if (!row.paidAt) continue;
      const key = `${row.paidAt.toISOString().slice(0, 7)}:${row.currency}`;
      const bucket = monthly.get(key) ?? { gross: 0n, refunds: 0n, count: 0 };
      bucket.gross += row.amountMinor; bucket.count += 1; monthly.set(key, bucket);
    }
    for (const row of refunds) {
      if (!row.completedAt) continue;
      const key = `${row.completedAt.toISOString().slice(0, 7)}:${row.currency}`;
      const bucket = monthly.get(key) ?? { gross: 0n, refunds: 0n, count: 0 };
      bucket.refunds += row.amountMinor; monthly.set(key, bucket);
    }
    return {
      months: [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ month: key.slice(0, 7), currency: key.slice(8),
        grossMinor: value.gross.toString(), refundedMinor: value.refunds.toString(), netMinor: (value.gross - value.refunds).toString(), successfulPayments: value.count })),
      completedPlanChanges: changes.length,
      methodology: 'Cash collections use verified successful payments by paid date. Refunds use completed provider events by completion date. Figures retain original currencies; no FX conversion or provider payout estimate is implied.',
    };
  }

  async issues() {
    const [failedPayments, failedWebhooks, unresolvedChanges, unknownRefunds, unsubscribedOrganizations] = await Promise.all([
      this.prisma.billingTransaction.findMany({ where: { status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 100,
        include: { organization: { select: { id: true, legalName: true } } } }),
      this.prisma.billingWebhookEvent.findMany({ where: { processingState: 'FAILED' }, orderBy: { receivedAt: 'desc' }, take: 100,
        select: { id: true, billingProvider: true, eventType: true, lastError: true, receivedAt: true } }),
      this.prisma.subscriptionChange.findMany({ where: { status: 'CANCELLING_OLD' }, orderBy: { updatedAt: 'desc' }, take: 100,
        include: { organization: { select: { id: true, legalName: true } } } }),
      this.prisma.billingRefund.findMany({ where: { providerStatus: 'UNKNOWN_REQUIRES_RECONCILIATION' }, orderBy: { updatedAt: 'desc' }, take: 100 }),
      // A finished organization with no subscription row resolves every quota as unlimited and is
      // never made read-only -- normally impossible, since onboarding starts the trial. Surfaced
      // here for investigation; the console never creates a trial or charge to "fix" it.
      this.prisma.organization.findMany({ where: { status: 'ACTIVE', subscription: { is: null } }, orderBy: { createdAt: 'desc' }, take: 100,
        select: { id: true, legalName: true, createdAt: true } }),
    ]);
    return { failedPayments: failedPayments.map((row) => this.transactionMoney(row)), failedWebhooks, unresolvedChanges, unknownRefunds: unknownRefunds.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() })), unsubscribedOrganizations };
  }

  async subscriptions(query: { page?: string; pageSize?: string; search?: string; status?: string; provider?: string; plan?: string }) {
    const p = pagination(query.page, query.pageSize);
    const where: Prisma.OrganizationSubscriptionWhereInput = {
      ...(query.search ? { OR: [
        { organization: { legalName: { contains: query.search, mode: 'insensitive' } } },
        { providerSubscriptionId: { contains: query.search, mode: 'insensitive' } },
      ] } : {}),
      ...(query.status ? { status: query.status as Prisma.EnumSubscriptionStatusFilter['equals'] } : {}),
      ...(query.provider ? { billingProvider: query.provider as Prisma.EnumBillingProviderNameNullableFilter['equals'] } : {}),
      ...(query.plan ? { plan: { tierKey: query.plan } } : {}),
    };
    const [rows, totalRows] = await Promise.all([
      this.prisma.organizationSubscription.findMany({ where, skip: p.skip, take: p.pageSize, orderBy: { updatedAt: 'desc' },
        include: { organization: { select: { id: true, legalName: true, countryCode: true, timeZone: true, createdBy: { select: { email: true, displayName: true } } } }, plan: { select: { key: true, name: true, priceMinor: true, currency: true, billingInterval: true } } } }),
      this.prisma.organizationSubscription.count({ where }),
    ]);
    return { data: rows.map((row) => ({ ...row, plan: { ...row.plan, priceMinor: row.plan.priceMinor.toString() } })), pagination: { page: p.page, pageSize: p.pageSize, totalRows } };
  }

  async subscription(id: string) {
    const row = await this.prisma.organizationSubscription.findUnique({ where: { id },
      include: { organization: { select: { id: true, legalName: true, countryCode: true, timeZone: true, createdBy: { select: { email: true, displayName: true } } } },
        plan: { include: { entitlements: true } }, transactions: { orderBy: { createdAt: 'desc' }, take: 25 } },
    });
    if (!row) throw new NotFoundException('Subscription not found.');
    const [changes, usage, audits] = await Promise.all([
      this.prisma.subscriptionChange.findMany({ where: { organizationId: row.organizationId }, orderBy: { createdAt: 'desc' }, take: 25 }),
      this.prisma.usageCounter.findMany({ where: { organizationId: row.organizationId }, orderBy: { periodStart: 'desc' }, take: 50 }),
      this.prisma.platformAuditEvent.findMany({ where: { organizationId: row.organizationId, eventKey: { startsWith: 'billing.' } }, orderBy: { occurredAt: 'desc' }, take: 25 }),
    ]);
    return { ...row, plan: { ...row.plan, priceMinor: row.plan.priceMinor.toString() },
      transactions: row.transactions.map((transaction) => this.transactionMoney(transaction)), changes, usage, audits };
  }

  async organizationBilling(organizationId: string) {
    const subscription = await this.prisma.organizationSubscription.findUnique({ where: { organizationId }, select: { id: true } });
    return subscription ? this.subscription(subscription.id) : null;
  }

  async transactions(query: { page?: string; pageSize?: string; search?: string; status?: string; provider?: string }) {
    const p = pagination(query.page, query.pageSize);
    const where: Prisma.BillingTransactionWhereInput = {
      ...(query.search ? { OR: [
        { providerTransactionId: { contains: query.search, mode: 'insensitive' } },
        { organization: { legalName: { contains: query.search, mode: 'insensitive' } } },
      ] } : {}),
      ...(query.status ? { status: query.status as Prisma.EnumBillingTransactionStatusFilter['equals'] } : {}),
      ...(query.provider ? { billingProvider: query.provider as Prisma.EnumBillingProviderNameFilter['equals'] } : {}),
    };
    const [rows, totalRows] = await Promise.all([
      this.prisma.billingTransaction.findMany({ where, skip: p.skip, take: p.pageSize, orderBy: { createdAt: 'desc' },
        include: { organization: { select: { id: true, legalName: true } } } }),
      this.prisma.billingTransaction.count({ where }),
    ]);
    return { data: rows.map((row) => this.transactionMoney(row)), pagination: { page: p.page, pageSize: p.pageSize, totalRows } };
  }

  async transaction(id: string) {
    const row = await this.prisma.billingTransaction.findUnique({ where: { id }, include: { organization: { select: { id: true, legalName: true, countryCode: true } } } });
    if (!row) throw new NotFoundException('Transaction not found.');
    // Raw provider payload may contain personal/payment metadata. The typed columns are the
    // operator-safe detail; raw payload stays on the server for controlled diagnosis.
    const safe = { ...row, rawPayload: undefined };
    delete safe.rawPayload;
    return this.transactionMoney(safe);
  }

  async trials(query: { page?: string; pageSize?: string; state?: string }) {
    const p = pagination(query.page, query.pageSize);
    const where: Prisma.OrganizationSubscriptionWhereInput = { trialEndsAt: { not: null },
      ...(query.state === 'active' ? { status: 'TRIALING' } : query.state === 'expired' ? { status: 'TRIAL_EXPIRED' } :
        query.state === 'converted' ? { status: 'ACTIVE' } : query.state === 'expiring' ? { status: 'TRIALING', trialEndsAt: { lte: new Date(Date.now() + 86_400_000), gt: new Date() } } : {}),
    };
    const [rows, totalRows] = await Promise.all([
      this.prisma.organizationSubscription.findMany({ where, skip: p.skip, take: p.pageSize, orderBy: { trialEndsAt: 'desc' },
        include: { organization: { select: { id: true, legalName: true, timeZone: true } }, plan: { select: { name: true } } } }),
      this.prisma.organizationSubscription.count({ where }),
    ]);
    return { data: rows, pagination: { page: p.page, pageSize: p.pageSize, totalRows } };
  }

  async extendTrial(id: string, newEnd: string, reason: string, actor: PlatformContext) {
    const subscription = await this.prisma.organizationSubscription.findUnique({ where: { id } });
    if (!subscription || !['TRIALING', 'TRIAL_EXPIRED'].includes(subscription.status) || !subscription.trialEndsAt)
      throw new BadRequestException('Only a trial can be extended.');
    const proposed = new Date(newEnd);
    const currentTrialEnd = subscription.trialEndsAt;
    if (!Number.isFinite(proposed.getTime()) || proposed <= new Date() || proposed <= currentTrialEnd || proposed.getTime() > Date.now() + 30 * 86_400_000)
      throw new BadRequestException('Choose a future expiry, at most 30 days from now.');
    if (reason.trim().length < 10) throw new BadRequestException('A reason of at least 10 characters is required.');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.organizationSubscription.update({ where: { id }, data: { status: 'TRIALING', trialEndsAt: proposed, trialReminderSentAt: null } });
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: subscription.organizationId }, select: { createdByUserId: true, timeZone: true } });
      await this.trialLifecycle.scheduleTrialJobs(tx, { organizationId: subscription.organizationId, createdByUserId: organization.createdByUserId, timeZone: organization.timeZone, trialEndsAt: proposed });
      await writePlatformAudit(tx, actor, { eventKey: 'billing.trial_extended', targetType: 'subscription', targetId: id, organizationId: subscription.organizationId, reason,
        before: { trialEndsAt: currentTrialEnd.toISOString(), status: subscription.status }, after: { trialEndsAt: proposed.toISOString(), status: updated.status } });
      return updated;
    });
  }

  async providers() {
    const plans = await this.prisma.plan.findMany({ where: { status: 'ACTIVE' }, select: { key: true, tierKey: true, billingProvider: true, providerProductId: true, providerPriceId: true } });
    const latest = await this.prisma.billingWebhookEvent.findMany({ orderBy: { receivedAt: 'desc' }, distinct: ['billingProvider'], take: 2, select: { billingProvider: true, receivedAt: true, processingState: true } });
    // Coverage is measured against the approved catalog (four tiers x two intervals), not only the
    // rows that happen to exist, so a missing official row shows up as a gap rather than vanishing.
    const expectedKeys = OFFICIAL_PLAN_TIERS.flatMap((tier) => [`${tier}_monthly`, `${tier}_yearly`]);
    const codeCounts = new Map<string, number>();
    for (const plan of plans) if (plan.providerPriceId) codeCounts.set(plan.providerPriceId, (codeCounts.get(plan.providerPriceId) ?? 0) + 1);
    const coverage = expectedKeys.map((key) => {
      const plan = plans.find((candidate) => candidate.key === key);
      const state = !plan ? 'MISSING_PLAN'
        : plan.billingProvider !== 'PAYSTACK' ? 'WRONG_PROVIDER'
          : !plan.providerPriceId ? 'MISSING_CODE'
            : (codeCounts.get(plan.providerPriceId) ?? 0) > 1 ? 'DUPLICATE_CODE'
              : 'READY';
      return { key, state, providerPlanCode: plan?.providerPriceId ?? null, configured: state === 'READY' };
    });
    return [{
      provider: 'PAYSTACK',
      environment: process.env.PAYSTACK_ENVIRONMENT ?? 'test',
      credentialsConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY),
      plans: coverage,
      readyPlans: coverage.filter((row) => row.state === 'READY').length,
      expectedPlans: expectedKeys.length,
      lastWebhook: latest.find((row) => row.billingProvider === 'PAYSTACK') ?? null,
    }];
  }

  async webhooks(query: { page?: string; pageSize?: string; state?: string }) {
    const p = pagination(query.page, query.pageSize);
    const where: Prisma.BillingWebhookEventWhereInput = query.state ? { processingState: query.state as Prisma.EnumWebhookProcessingStateFilter['equals'] } : {};
    const [rows, totalRows] = await Promise.all([
      this.prisma.billingWebhookEvent.findMany({ where, skip: p.skip, take: p.pageSize, orderBy: { receivedAt: 'desc' }, select: { id: true, billingProvider: true, providerEventId: true, eventType: true, signatureVerified: true, processingState: true, retryCount: true, lastError: true, receivedAt: true, processedAt: true } }),
      this.prisma.billingWebhookEvent.count({ where }),
    ]);
    return { data: rows, pagination: { page: p.page, pageSize: p.pageSize, totalRows } };
  }

  async retryWebhook(id: string, reason: string, actor: PlatformContext) {
    if (reason.trim().length < 10) throw new BadRequestException('A retry reason is required.');
    const event = await this.prisma.billingWebhookEvent.findUnique({ where: { id } });
    if (!event || !event.signatureVerified || !['FAILED', 'VERIFIED'].includes(event.processingState))
      throw new BadRequestException('Only previously verified, unprocessed events may be retried.');
    const verified = { providerEventId: event.providerEventId, eventType: event.eventType, payload: event.payload };
    if (event.billingProvider !== 'PAYSTACK')
      throw new BadRequestException('Historical provider webhooks are retained for audit and cannot be replayed.');
    await this.webhooksService.recordAndProcess(event.billingProvider, verified, normalizePaystackEvent(verified));
    await this.prisma.$transaction((tx) => writePlatformAudit(tx, actor, { eventKey: 'billing.webhook_retried',
      targetType: 'billing_webhook_event', targetId: id, reason, before: { state: event.processingState }, after: { state: 'PROCESSED' } }));
    return { processed: true };
  }

  async reconcileSubscription(id: string) {
    const local = await this.prisma.organizationSubscription.findUnique({ where: { id }, select: {
      id: true, billingProvider: true, providerSubscriptionId: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true,
    } });
    if (!local) throw new NotFoundException('Subscription not found.');
    if (!local.billingProvider || !local.providerSubscriptionId) return { local, remote: null, discrepancies: ['No linked provider subscription.'] };
    if (local.billingProvider !== 'PAYSTACK')
      return { local, remote: null, discrepancies: ['Historical provider subscription retained for audit; remote reconciliation is retired.'] };
    const remote = await this.paystack.getSubscription(local.providerSubscriptionId);
    return { local, remote, discrepancies: [
      ...(remote.status === 'unknown' ? ['Remote status is unknown.'] : []),
      ...(remote.status === 'cancelled' && local.status === 'ACTIVE' ? ['Provider is canceled while local subscription is active.'] : []),
      ...(remote.status === 'past_due' && local.status === 'ACTIVE' ? ['Provider is past due while local subscription is active.'] : []),
      ...(remote.cancelAtPeriodEnd !== local.cancelAtPeriodEnd ? ['Cancellation scheduling differs.'] : []),
    ] };
  }

  async audits(query: { page?: string; pageSize?: string; organizationId?: string }) {
    const p = pagination(query.page, query.pageSize);
    const where: Prisma.PlatformAuditEventWhereInput = { eventKey: { startsWith: 'billing.' }, ...(query.organizationId ? { organizationId: query.organizationId } : {}) };
    const [rows, totalRows] = await Promise.all([
      this.prisma.platformAuditEvent.findMany({ where, skip: p.skip, take: p.pageSize, orderBy: { occurredAt: 'desc' }, include: { actor: { select: { displayName: true, email: true } } } }),
      this.prisma.platformAuditEvent.count({ where }),
    ]);
    return { data: rows, pagination: { page: p.page, pageSize: p.pageSize, totalRows } };
  }

  async refunds(query: { page?: string; pageSize?: string; status?: string }) {
    const p = pagination(query.page, query.pageSize);
    const where: Prisma.BillingRefundWhereInput = query.status ? { status: query.status as Prisma.EnumBillingRefundStatusFilter['equals'] } : {};
    const [rows, totalRows] = await Promise.all([
      this.prisma.billingRefund.findMany({ where, skip: p.skip, take: p.pageSize, orderBy: { createdAt: 'desc' },
        include: { organization: { select: { id: true, legalName: true } }, transaction: { select: { providerTransactionId: true, billingProvider: true } } } }),
      this.prisma.billingRefund.count({ where }),
    ]);
    return { data: rows.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() })), pagination: { page: p.page, pageSize: p.pageSize, totalRows } };
  }

  async requestRefund(transactionId: string, amount: string, reason: string, actor: PlatformContext) {
    let amountMinor: bigint;
    try { amountMinor = BigInt(amount); } catch { throw new BadRequestException('Invalid refund amount.'); }
    if (amountMinor <= 0n || reason.trim().length < 10 || reason.length > 500)
      throw new BadRequestException('Enter a positive amount and a reason of 10 to 500 characters.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${transactionId}), 119)::text AS locked`;
      const transaction = await tx.billingTransaction.findUnique({ where: { id: transactionId } });
      if (!transaction || transaction.status !== 'SUCCESSFUL') throw new BadRequestException('Only verified successful payments can be refunded.');
      if (transaction.billingProvider !== 'PAYSTACK')
        throw new BadRequestException('Historical provider transactions are retained for audit and cannot be refunded through Paystack.');
      const existing = await tx.billingRefund.findMany({ where: { transactionId, status: { in: ['REQUESTED', 'SUBMITTED', 'COMPLETED'] } }, select: { amountMinor: true } });
      const reserved = existing.reduce((sum, row) => sum + row.amountMinor, 0n);
      if (amountMinor + reserved > transaction.amountMinor) throw new BadRequestException('Refund requests exceed the original verified payment.');
      const refund = await tx.billingRefund.create({ data: { organizationId: transaction.organizationId, transactionId,
        amountMinor, currency: transaction.currency, reason: reason.trim(), requestedByUserId: actor.userId } });
      await writePlatformAudit(tx, actor, { eventKey: 'billing.refund_requested', targetType: 'billing_refund', targetId: refund.id,
        organizationId: transaction.organizationId, reason, after: { transactionId, amountMinor: amountMinor.toString(), currency: transaction.currency } });
      return { ...refund, amountMinor: refund.amountMinor.toString() };
    });
  }

  async approveRefund(id: string, reason: string, actor: PlatformContext) {
    if (reason.trim().length < 10) throw new BadRequestException('An approval reason is required.');
    const refund = await this.prisma.billingRefund.findUnique({ where: { id }, include: { transaction: true } });
    if (!refund || refund.status !== 'REQUESTED') throw new BadRequestException('Refund request is no longer awaiting approval.');
    if (refund.requestedByUserId === actor.userId) throw new BadRequestException('A different administrator must approve this refund.');
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.billingRefund.updateMany({ where: { id, status: 'REQUESTED' }, data: { status: 'SUBMITTED', approvedByUserId: actor.userId, approvalReason: reason.trim(), providerStatus: 'SUBMISSION_PENDING' } });
      if (claimed.count !== 1) throw new BadRequestException('Refund request was already handled.');
      await writePlatformAudit(tx, actor, { eventKey: 'billing.refund_approved', targetType: 'billing_refund', targetId: id,
        organizationId: refund.organizationId, reason, before: { status: 'REQUESTED' }, after: { status: 'SUBMITTED' } });
    });
    try {
      if (refund.transaction.billingProvider !== 'PAYSTACK')
        throw new BadRequestException('Historical provider refunds require controlled reconciliation outside Paystack.');
      const provider = await this.paystack.requestRefund(refund.transaction.providerTransactionId, refund.amountMinor, refund.currency, refund.reason);
      await this.prisma.billingRefund.update({ where: { id }, data: { providerReference: provider.reference, providerStatus: provider.status } });
    } catch {
      // A network timeout is ambiguous: the provider may have accepted the request. Do not
      // blindly retry and risk refunding twice. Reconciliation must establish provider evidence.
      await this.prisma.billingRefund.update({ where: { id }, data: { providerStatus: 'UNKNOWN_REQUIRES_RECONCILIATION' } });
    }
    return this.prisma.billingRefund.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, providerReference: true, providerStatus: true } });
  }

  async overrides(organizationId: string) {
    return this.prisma.billingEntitlementOverride.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async requestOverride(input: { organizationId: string; entitlementKey: string; limitValue?: number | null; unlimited?: boolean; enabled?: boolean; expiresAt: string; reason: string }, actor: PlatformContext) {
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date() || expiresAt.getTime() > Date.now() + 30 * 86_400_000 ||
      !input.reason || input.reason.trim().length < 10 || !input.entitlementKey || input.entitlementKey.length > 60 ||
      (input.limitValue !== undefined && input.limitValue !== null && (!Number.isInteger(input.limitValue) || input.limitValue < 0)))
      throw new BadRequestException('A valid entitlement, 10-character reason and expiry within 30 days are required.');
    const subscription = await this.prisma.organizationSubscription.findUnique({ where: { organizationId: input.organizationId }, select: { planId: true } });
    const entitlement = subscription ? await this.prisma.planEntitlement.findUnique({ where: { planId_key: { planId: subscription.planId, key: input.entitlementKey } } }) : null;
    if (!entitlement) throw new BadRequestException('This organization does not have the named entitlement.');
    if (input.enabled === undefined && input.limitValue === undefined && !input.unlimited)
      throw new BadRequestException('Specify an enabled state or a limit.');
    return this.prisma.$transaction(async (tx) => {
      const override = await tx.billingEntitlementOverride.create({ data: { organizationId: input.organizationId,
        entitlementKey: input.entitlementKey, enabled: input.enabled ?? null, limitValue: input.limitValue ?? null,
        unlimited: Boolean(input.unlimited), effectiveAt: new Date(), expiresAt, reason: input.reason.trim(), requestedByUserId: actor.userId } });
      await writePlatformAudit(tx, actor, { eventKey: 'billing.override_requested', targetType: 'billing_entitlement_override', targetId: override.id,
        organizationId: input.organizationId, reason: input.reason, before: { enabled: entitlement.enabled, limitValue: entitlement.limitValue },
        after: { enabled: input.enabled ?? null, limitValue: input.limitValue ?? null, unlimited: Boolean(input.unlimited), expiresAt: expiresAt.toISOString() } });
      return override;
    });
  }

  async approveOverride(id: string, actor: PlatformContext) {
    return this.prisma.$transaction(async (tx) => {
      const override = await tx.billingEntitlementOverride.findUnique({ where: { id } });
      if (!override || override.status !== 'PENDING' || override.expiresAt <= new Date()) throw new BadRequestException('Override request is no longer approvable.');
      if (override.requestedByUserId === actor.userId) throw new BadRequestException('A different administrator must approve this override.');
      await tx.billingEntitlementOverride.updateMany({ where: { organizationId: override.organizationId, entitlementKey: override.entitlementKey, status: 'ACTIVE' }, data: { status: 'REVOKED' } });
      const approved = await tx.billingEntitlementOverride.update({ where: { id }, data: { status: 'ACTIVE', approvedByUserId: actor.userId, effectiveAt: new Date() } });
      await writePlatformAudit(tx, actor, { eventKey: 'billing.override_approved', targetType: 'billing_entitlement_override', targetId: id,
        organizationId: override.organizationId, reason: override.reason, before: { status: 'PENDING' }, after: { status: 'ACTIVE', expiresAt: approved.expiresAt.toISOString() } });
      return approved;
    });
  }

  async revokeOverride(id: string, reason: string, actor: PlatformContext) {
    if (reason.trim().length < 10) throw new BadRequestException('A revocation reason is required.');
    return this.prisma.$transaction(async (tx) => {
      const override = await tx.billingEntitlementOverride.findUnique({ where: { id } });
      if (!override || override.status !== 'ACTIVE') throw new BadRequestException('Override is not active.');
      const revoked = await tx.billingEntitlementOverride.update({ where: { id }, data: { status: 'REVOKED' } });
      await writePlatformAudit(tx, actor, { eventKey: 'billing.override_revoked', targetType: 'billing_entitlement_override', targetId: id,
        organizationId: override.organizationId, reason, before: { status: 'ACTIVE' }, after: { status: 'REVOKED' } });
      return revoked;
    });
  }

  private transactionMoney<T extends { amountMinor: bigint; feeMinor: bigint | null; refundedMinor: bigint | null }>(row: T) {
    return { ...row, amountMinor: row.amountMinor.toString(), feeMinor: row.feeMinor?.toString() ?? null, refundedMinor: row.refundedMinor?.toString() ?? null };
  }
}
