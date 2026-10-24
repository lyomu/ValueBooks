import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BillingNotificationService } from '../billing/billing-notification.service.js';
import {
  PaystackBillingAdapter,
  paystackPlanMismatches,
} from '../billing/paystack-billing.adapter.js';
import { PrismaService } from '../database/prisma.service.js';
import { writePlatformAudit } from './platform-audit.js';
import { CatalogHealthService } from './catalog-health.service.js';
import type { PlatformContext } from './platform-context.js';
import type { ProposePlanPriceDto } from './platform.dto.js';

/**
 * A price increase of more than this share of the current price has to be confirmed by repeating
 * the figure, because a misplaced decimal point is the realistic way this goes wrong and it reaches
 * every current subscriber at their next renewal.
 */
const LARGE_INCREASE_RATIO = 0.5;

/**
 * Owner decision, 23 Oct 2026: an increase that reaches existing subscribers is preceded by 30
 * days' email notice. The clock runs from when each subscriber's notice was *queued for delivery*,
 * not from when the operator pressed the button, so a notice that never reached the email queue
 * buys no time.
 */
const NOTICE_DAYS = 30;
const NOTICE_EVENT_KEY = 'billing.plan_price_increase_notice';

/**
 * The subscription states Paystack reprices at the next renewal: a live mandate exists. TRIALING is
 * absent because a trial is not being charged, and CANCELLED has no future renewal.
 */
const REPRICEABLE_STATUSES = ['ACTIVE', 'PAST_DUE', 'CANCEL_SCHEDULED'] as const;

/**
 * Administrator-managed plan pricing (phase 7, O5).
 *
 * **Owner decision, 24 Oct 2026:** reductions can publish, but increases and their notices are
 * paused until in-flight checkouts can be coordinated with Paystack publication. The earlier
 * 30-day notice rules remain here and covered for when that path can safely resume.
 *
 * It deliberately does **not** relax `updatePlan`'s refusal to reprice a plan in place (billing
 * spec §20, "never silently reprice current subscribers"). That guard still stands for ad-hoc
 * edits; what this service adds is a path where the repricing is *not* silent: it is proposed with
 * a reason, previewed against the subscribers it will affect, published by a named administrator,
 * applied at Paystack with the repricing flag stated explicitly, and recorded in both the
 * append-only platform audit log and the plan's own price history.
 *
 * Paystack is the price of record for checkout (`paystackPlanMismatches` stops a charge when the
 * two disagree), so publishing updates Paystack first and verifies the result before ValueBooks
 * stores the new price. The order matters: a ValueBooks price that Paystack has not accepted is a
 * plan nobody can buy.
 */
@Injectable()
export class PlanPricingService {
  private readonly logger = new Logger(PlanPricingService.name);

  priceIncreasesPaused(): boolean {
    return true;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackBillingAdapter,
    private readonly notices: BillingNotificationService,
    private readonly health: CatalogHealthService,
  ) {}

  /** Price history and any change awaiting publication, for one plan. */
  async planPricing(planId: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        key: true,
        name: true,
        status: true,
        priceMinor: true,
        currency: true,
        billingInterval: true,
        providerPriceId: true,
        _count: { select: { subscriptions: true } },
      },
    });
    if (!plan) throw new NotFoundException('Plan not found.');
    const [history, pending] = await Promise.all([
      this.prisma.planPriceHistory.findMany({
        where: { planId },
        orderBy: { effectiveFrom: 'desc' },
        select: {
          priceMinor: true,
          currency: true,
          effectiveFrom: true,
          priceChange: {
            select: {
              reason: true,
              publishedBy: { select: { user: { select: { email: true } } } },
            },
          },
        },
      }),
      this.prisma.planPriceChange.findFirst({
        where: { planId, status: 'DRAFT' },
        select: {
          id: true,
          fromPriceMinor: true,
          toPriceMinor: true,
          currency: true,
          subscribersAtProposal: true,
          reason: true,
          createdAt: true,
          proposedBy: { select: { user: { select: { email: true } } } },
        },
      }),
    ]);
    return {
      plan: {
        id: plan.id,
        key: plan.key,
        name: plan.name,
        status: plan.status,
        priceMinor: plan.priceMinor.toString(),
        currency: plan.currency,
        billingInterval: plan.billingInterval,
        subscriberCount: plan._count.subscriptions,
      },
      history: history.map((row) => ({
        priceMinor: row.priceMinor.toString(),
        currency: row.currency,
        effectiveFrom: row.effectiveFrom.toISOString(),
        reason: row.priceChange?.reason ?? null,
        publishedBy: row.priceChange?.publishedBy?.user.email ?? null,
      })),
      pending: pending
        ? {
            id: pending.id,
            fromPriceMinor: pending.fromPriceMinor.toString(),
            toPriceMinor: pending.toPriceMinor.toString(),
            currency: pending.currency,
            subscribersAtProposal: pending.subscribersAtProposal,
            reason: pending.reason,
            proposedBy: pending.proposedBy.user.email,
            proposedAt: pending.createdAt.toISOString(),
          }
        : null,
    };
  }

  /**
   * Records a proposed price and what it would do. Nothing is charged and no customer sees anything
   * until it is published; this exists so the figure and its consequence can be read back before
   * anyone commits to them.
   */
  async proposePriceChange(
    actor: PlatformContext,
    planId: string,
    input: ProposePlanPriceDto,
    ipHash: string | null,
  ) {
    const toPriceMinor = this.parsePrice(input.priceMinor);
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        key: true,
        status: true,
        priceMinor: true,
        currency: true,
        billingInterval: true,
        billingProvider: true,
        providerPriceId: true,
      },
    });
    if (!plan) throw new NotFoundException('Plan not found.');
    if (plan.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Only an active plan carries a price customers can be charged. Activate it first.',
      );
    }
    if (plan.billingProvider !== 'PAYSTACK' || !plan.providerPriceId) {
      throw new BadRequestException(
        'This plan has no Paystack plan code, so a price change could not reach the provider. Set its code first.',
      );
    }
    if (toPriceMinor === plan.priceMinor) {
      throw new BadRequestException("That is already this plan's price.");
    }

    const subscribers = await this.prisma.organizationSubscription.count({
      where: { planId, status: { in: [...REPRICEABLE_STATUSES] } },
    });
    this.assertConfirmedWhenLarge(plan.priceMinor, toPriceMinor, input.confirmPriceMinor);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.planPriceChange.findFirst({
        where: { planId, status: 'DRAFT' },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          'This plan already has a price change awaiting publication. Publish or discard it first.',
        );
      }
      const change = await tx.planPriceChange.create({
        data: {
          planId,
          fromPriceMinor: plan.priceMinor,
          toPriceMinor,
          currency: plan.currency,
          subscribersAtProposal: subscribers,
          reason: input.reason.trim(),
          proposedByPlatformAdminId: actor.id,
        },
        select: { id: true },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.plan_price_change_proposed',
        targetType: 'plan',
        targetId: planId,
        reason: input.reason.trim(),
        before: { key: plan.key, priceMinor: plan.priceMinor.toString(), currency: plan.currency },
        after: {
          key: plan.key,
          priceMinor: toPriceMinor.toString(),
          currency: plan.currency,
          subscribersToReprice: subscribers,
        },
        ipHash,
      });
      return {
        id: change.id,
        planKey: plan.key,
        fromPriceMinor: plan.priceMinor.toString(),
        toPriceMinor: toPriceMinor.toString(),
        currency: plan.currency,
        subscribersToReprice: subscribers,
      };
    });
  }

  /**
   * What publishing this change would do, read fresh. The subscriber count is recounted rather than
   * read from the proposal, because the honest answer is the one at publication time.
   */
  async previewPriceChange(planId: string, changeId: string) {
    const change = await this.requireDraft(planId, changeId);
    const [subscribers, trialing] = await Promise.all([
      this.prisma.organizationSubscription.count({
        where: { planId, status: { in: [...REPRICEABLE_STATUSES] } },
      }),
      this.prisma.organizationSubscription.count({ where: { planId, status: 'TRIALING' } }),
    ]);
    const stale = change.plan.priceMinor !== change.fromPriceMinor;
    const increase = change.toPriceMinor > change.plan.priceMinor;
    const notice = increase ? await this.noticeState(planId, changeId) : null;
    return {
      id: change.id,
      planKey: change.plan.key,
      fromPriceMinor: change.plan.priceMinor.toString(),
      toPriceMinor: change.toPriceMinor.toString(),
      currency: change.currency,
      billingInterval: change.plan.billingInterval,
      direction: increase ? 'INCREASE' : 'DECREASE',
      /** Repriced at their next renewal, by Paystack, on the authorisation they already gave. */
      subscribersToReprice: subscribers,
      /** Trials are not repriced: they are not being charged, and they convert at the new price. */
      trialingUnaffected: trialing,
      /** True when the plan's price moved after this change was proposed; publishing is refused. */
      stale,
      reason: change.reason,
      /** Null for a reduction: the 30-day notice is owed only for an increase. */
      notice,
    };
  }

  /**
   * How the 30-day notice stands for one proposed increase.
   *
   * Everything here is derived from the `billing_notices` ledger rather than from a flag on the
   * change, so "has this subscriber been told?" is answered by the same durable row that recorded
   * the email, per organization. A subscriber who appears after the notice went out is simply not
   * in the ledger for this change, which is what `awaitingNotice` counts.
   */
  private async noticeState(planId: string, changeId: string) {
    const subscriptions = await this.prisma.organizationSubscription.findMany({
      where: { planId, status: { in: [...REPRICEABLE_STATUSES] } },
      select: { organizationId: true },
    });
    const organizationIds = subscriptions.map((row) => row.organizationId);
    const rows =
      organizationIds.length === 0
        ? []
        : await this.prisma.billingNotice.findMany({
            where: {
              eventKey: NOTICE_EVENT_KEY,
              sourceId: changeId,
              organizationId: { in: organizationIds },
            },
            select: { organizationId: true, queuedAt: true },
          });
    // Only a notice that reached the email queue counts. A row with `queuedAt` null is a recorded
    // attempt that failed, and it must not start anybody's 30 days.
    const queued = new Map<string, Date>();
    for (const row of rows) if (row.queuedAt !== null) queued.set(row.organizationId, row.queuedAt);

    const cutoff = new Date(Date.now() - NOTICE_DAYS * 86_400_000);
    const awaitingNotice = organizationIds.filter((id) => !queued.has(id)).length;
    const withinNoticePeriod = [...queued.values()].filter((at) => at > cutoff).length;
    const latest = [...queued.values()].reduce<Date | null>(
      (newest, at) => (newest === null || at > newest ? at : newest),
      null,
    );
    return {
      noticeDays: NOTICE_DAYS,
      /** Live mandates on this plan right now. Zero means nobody is owed notice. */
      subscribersToReprice: organizationIds.length,
      /** Subscribers whose notice reached the email queue. */
      noticesQueued: queued.size,
      /** Subscribers with no queued notice for this change. Publication is refused above zero. */
      awaitingNotice,
      /** Notified, but fewer than `noticeDays` days ago. */
      withinNoticePeriod,
      /**
       * When the most recently notified subscriber's notice period ends. Null when nobody has been
       * notified, or when there is nobody to notify.
       */
      earliestPublishAt:
        latest === null ? null : new Date(latest.getTime() + NOTICE_DAYS * 86_400_000).toISOString(),
      publishable:
        !this.priceIncreasesPaused() &&
        (organizationIds.length === 0 || (awaitingNotice === 0 && withinNoticePeriod === 0)),
    };
  }

  /**
   * Sends, or tops up, the 30-day notice for a proposed increase.
   *
   * One durable `BillingNotice` row per organization, keyed by this change, so the ledger answers
   * per subscriber whether they were told and when. It is idempotent: an organization already
   * holding a queued notice is left alone and its 30 days are not restarted. Re-running it after
   * new subscribers join notifies only those, which is why publication waits on the newest notice
   * rather than the first.
   *
   * A delivery failure for one organization does not abort the rest; it leaves that organization
   * uncovered, so publication stays refused until it is resolved.
   */
  async sendPriceIncreaseNotice(
    actor: PlatformContext,
    planId: string,
    changeId: string,
    ipHash: string | null,
  ) {
    if (this.priceIncreasesPaused()) {
      throw new ConflictException(
        'Price-increase notices are temporarily paused while price increases cannot be published. No notice was sent.',
      );
    }
    const change = await this.requireDraft(planId, changeId);
    if (change.toPriceMinor <= change.fromPriceMinor) {
      throw new BadRequestException(
        'Only a price increase requires notice. A reduction can be published directly.',
      );
    }
    if (change.plan.priceMinor !== change.fromPriceMinor) {
      throw new ConflictException(
        "This plan's price changed after this was proposed. Discard it and propose the change again.",
      );
    }

    const before = await this.noticeState(planId, changeId);
    const subscriptions = await this.prisma.organizationSubscription.findMany({
      where: { planId, status: { in: [...REPRICEABLE_STATUSES] } },
      select: { organizationId: true },
    });
    const subject = `Your ValueBooks subscription price is changing in ${NOTICE_DAYS} days`;
    const body = this.noticeBody(change);

    let failed = 0;
    for (const subscription of subscriptions) {
      try {
        await this.notices.notify({
          organizationId: subscription.organizationId,
          eventKey: NOTICE_EVENT_KEY,
          sourceId: changeId,
          subject,
          body,
        });
      } catch (error: unknown) {
        failed += 1;
        this.logger.warn(
          `A price-increase notice for organization ${subscription.organizationId} on ${change.plan.key} could not be queued: ${error instanceof Error ? error.message : 'unknown failure'}`,
        );
      }
    }

    const after = await this.noticeState(planId, changeId);
    // An organization with neither a billing contact nor an owner email gets no ledger row at all,
    // so it can never be covered. Reporting it is the only way the operator learns why publication
    // stays refused.
    const undeliverable = Math.max(0, after.awaitingNotice - failed);
    await writePlatformAudit(this.prisma, actor, {
      eventKey: 'platform.plan_price_notice_sent',
      targetType: 'plan',
      targetId: planId,
      reason: change.reason,
      before: {
        key: change.plan.key,
        noticesQueued: before.noticesQueued,
        awaitingNotice: before.awaitingNotice,
      },
      after: {
        key: change.plan.key,
        priceMinor: change.fromPriceMinor.toString(),
        proposedPriceMinor: change.toPriceMinor.toString(),
        currency: change.currency,
        noticeDays: NOTICE_DAYS,
        subscribersToReprice: after.subscribersToReprice,
        noticesQueued: after.noticesQueued,
        queuedByThisSend: Math.max(0, after.noticesQueued - before.noticesQueued),
        failedToQueue: failed,
        withoutDeliverableAddress: undeliverable,
        earliestPublishAt: after.earliestPublishAt,
      },
      ipHash,
    });
    return {
      planKey: change.plan.key,
      ...after,
      queuedByThisSend: Math.max(0, after.noticesQueued - before.noticesQueued),
      failedToQueue: failed,
      withoutDeliverableAddress: undeliverable,
    };
  }

  /**
   * The notice a subscriber receives. It states both prices, that nothing is charged today, and
   * that the new amount is taken at their next renewal once the notice period has run -- which is
   * what Paystack does to an existing mandate, rather than a charge now.
   */
  private noticeBody(change: {
    plan: { billingInterval: string };
    fromPriceMinor: bigint;
    toPriceMinor: bigint;
    currency: string;
  }): string {
    const effectiveFrom = new Date(Date.now() + NOTICE_DAYS * 86_400_000);
    const term = change.plan.billingInterval === 'YEARLY' ? 'yearly' : 'monthly';
    const from = formatPrice(change.fromPriceMinor, change.currency);
    const to = formatPrice(change.toPriceMinor, change.currency);
    return [
      `The price of your ValueBooks ${term} subscription is changing from ${from} to ${to}.`,
      '',
      `This takes effect at your next renewal on or after ${effectiveFrom.toISOString().slice(0, 10)}, which is at least ${NOTICE_DAYS} days from today. Nothing is charged now, and the amount you pay before that date does not change.`,
      '',
      'You do not need to do anything to continue. If you would rather move to a different plan, or cancel before the new price applies, you can do either from your billing settings at any time.',
      '',
      'Questions about this change? Contact support@valuebooks.co.',
    ].join('\n');
  }

  /**
   * Publishes the change: Paystack first, then ValueBooks.
   *
   * `update_existing_subscriptions` is sent as `true` explicitly, never left to Paystack's default,
   * and the count Paystack reports is stored next to the count ValueBooks expected so a divergence
   * is visible rather than assumed away.
   */
  async publishPriceChange(
    actor: PlatformContext,
    planId: string,
    changeId: string,
    ipHash: string | null,
  ) {
    const change = await this.requireDraft(planId, changeId);
    if (change.plan.priceMinor !== change.fromPriceMinor) {
      // Someone else moved the price between proposal and publication. Publishing now would apply
      // a figure that was never previewed against the price it is replacing.
      throw new ConflictException(
        "This plan's price changed after this was proposed. Discard it and propose the change again.",
      );
    }
    if (!change.plan.providerPriceId) {
      throw new BadRequestException(
        'This plan no longer has a Paystack plan code. Nothing was changed.',
      );
    }
    const increase = change.toPriceMinor > change.fromPriceMinor;
    // Owner decision, 24 Oct 2026: a checkout can complete after the notice count and before
    // Paystack updates the plan, even when that count was zero. Pause every increase until
    // checkout and publication are coordinated.
    if (increase && this.priceIncreasesPaused()) {
      throw new ConflictException(
        'Price increases are temporarily paused while checkout and Paystack publication are made race-safe. Nothing was changed.',
      );
    }
    // Owner decision, 23 Oct 2026: an increase reaching existing subscribers needs 30 days' email
    // notice first. The condition is checked here, before Paystack is contacted, so a refusal
    // changes nothing at the provider.
    const notice = increase ? await this.noticeState(planId, changeId) : null;
    if (notice && !notice.publishable) {
      throw new BadRequestException(
        noticeRefusal(notice) + ' Nothing was changed.',
      );
    }
    const counterpart = await this.prisma.plan.findFirst({
      where: {
        tierKey: change.plan.tierKey,
        billingInterval: change.plan.billingInterval === 'MONTHLY' ? 'YEARLY' : 'MONTHLY',
        status: 'ACTIVE',
      },
      select: { priceMinor: true },
    });
    if (counterpart) {
      const monthly = change.plan.billingInterval === 'MONTHLY'
        ? change.toPriceMinor : counterpart.priceMinor;
      const yearly = change.plan.billingInterval === 'YEARLY'
        ? change.toPriceMinor : counterpart.priceMinor;
      if (yearly > monthly * 12n) {
        throw new BadRequestException(
          'The yearly price cannot exceed twelve monthly payments. Nothing was changed.',
        );
      }
    }

    await this.health.assertNoNewViolations({ planId, priceMinor: change.toPriceMinor });

    // Paystack first. A ValueBooks price that Paystack has not accepted is a plan nobody can buy,
    // and checkout verifies the two against each other on every charge.
    // Explicit on every call, never left to Paystack's `true` default. The increase path above
    // is paused: a zero-subscriber count cannot rule out an in-flight checkout.
    const repriceExisting = !increase || notice === null || notice.subscribersToReprice > 0;
    const applied = await this.paystack
      .updatePlanAmount({
        planCode: change.plan.providerPriceId,
        amountMinor: change.toPriceMinor,
        currency: change.currency,
        updateExistingSubscriptions: repriceExisting,
      })
      .catch((error: unknown) => {
        if (error instanceof BadGatewayException) {
          throw new BadRequestException(
            `Paystack did not accept the new price: ${error.message} Nothing was changed.`,
          );
        }
        throw error;
      });

    // Read the remote plan back. Paystack answering 200 is not evidence that it now holds the
    // figure we sent, and a silent disagreement here is exactly what stops every checkout.
    const remote = await this.paystack.getPlan(change.plan.providerPriceId).catch(() => null);
    if (remote) {
      const mismatches = paystackPlanMismatches(remote, {
        providerPriceId: change.plan.providerPriceId,
        priceMinor: change.toPriceMinor,
        currency: change.currency,
        billingInterval: change.plan.billingInterval,
      });
      if (mismatches.length > 0) {
        // Paystack accepted the call but does not hold what we sent. Stop before ValueBooks stores
        // the new price: the catalog still matches the old Paystack amount, so checkout keeps
        // working on the old price while this is investigated.
        //
        // Reported as a 400 rather than a 502 for the same reason `setProviderPlanCode` does: the
        // exception filter redacts 5xx messages, and what the operator needs here is exactly which
        // field disagrees and that nothing was changed.
        throw new BadRequestException(
          `Paystack accepted the change but reports ${mismatches.join('; ')}. The ValueBooks price was not changed; reconcile the Paystack plan before retrying.`,
        );
      }
    } else {
      // Could not confirm. The change goes ahead, because Paystack reported success and is now the
      // price of record, but the operator is told the verification did not complete.
      this.logger.warn(
        `Paystack accepted the price change for ${change.plan.key} but the plan could not be read back for verification.`,
      );
    }

    const effectiveFrom = new Date();
    return this.prisma.$transaction(async (tx) => {
      // Conditional on the price read above, so two concurrent publications cannot both apply.
      const moved = await tx.plan.updateMany({
        where: { id: planId, priceMinor: change.fromPriceMinor },
        data: { priceMinor: change.toPriceMinor },
      });
      if (moved.count !== 1) {
        throw new ConflictException(
          'The plan changed while this was being published. Paystack already holds the new price; reconcile before retrying.',
        );
      }
      await tx.planPriceChange.update({
        where: { id: change.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: effectiveFrom,
          publishedByPlatformAdminId: actor.id,
          providerAffectedSubscriptions: applied.affectedSubscriptions,
          providerMessage: applied.message.slice(0, 500) || null,
        },
      });
      await tx.planPriceHistory.create({
        data: {
          planId,
          priceMinor: change.toPriceMinor,
          currency: change.currency,
          billingInterval: change.plan.billingInterval,
          effectiveFrom,
          priceChangeId: change.id,
        },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.plan_price_published',
        targetType: 'plan',
        targetId: planId,
        reason: change.reason,
        before: {
          key: change.plan.key,
          priceMinor: change.fromPriceMinor.toString(),
          currency: change.currency,
        },
        after: {
          key: change.plan.key,
          priceMinor: change.toPriceMinor.toString(),
          currency: change.currency,
          repriceExistingSubscriptions: repriceExisting,
          noticeDays: notice === null ? null : notice.noticeDays,
          subscribersNotified: notice === null ? null : notice.noticesQueued,
          subscribersExpected: change.subscribersAtProposal,
          subscribersReportedByPaystack: applied.affectedSubscriptions,
          providerVerified: remote !== null,
        },
        ipHash,
      });
      return {
        planKey: change.plan.key,
        priceMinor: change.toPriceMinor.toString(),
        currency: change.currency,
        effectiveFrom: effectiveFrom.toISOString(),
        repricedExistingSubscriptions: repriceExisting,
        subscribersNotified: notice === null ? null : notice.noticesQueued,
        subscribersReportedByPaystack: applied.affectedSubscriptions,
        providerVerified: remote !== null,
      };
    });
  }

  /** Abandons a proposed change. The plan is untouched, and the proposal stays on the record. */
  async discardPriceChange(
    actor: PlatformContext,
    planId: string,
    changeId: string,
    reason: string,
    ipHash: string | null,
  ) {
    const change = await this.requireDraft(planId, changeId);
    return this.prisma.$transaction(async (tx) => {
      const discarded = await tx.planPriceChange.updateMany({
        where: { id: change.id, status: 'DRAFT' },
        data: { status: 'DISCARDED', discardedAt: new Date() },
      });
      if (discarded.count !== 1) {
        throw new ConflictException('That price change is no longer awaiting publication.');
      }
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.plan_price_change_discarded',
        targetType: 'plan',
        targetId: planId,
        reason: reason.trim(),
        before: {
          key: change.plan.key,
          proposedPriceMinor: change.toPriceMinor.toString(),
          currency: change.currency,
        },
        after: { key: change.plan.key, priceMinor: change.plan.priceMinor.toString() },
        ipHash,
      });
      return { planKey: change.plan.key, discarded: true };
    });
  }

  // --- Shared ---------------------------------------------------------------------------------

  private async requireDraft(planId: string, changeId: string) {
    const change = await this.prisma.planPriceChange.findUnique({
      where: { id: changeId },
      select: {
        id: true,
        planId: true,
        status: true,
        fromPriceMinor: true,
        toPriceMinor: true,
        currency: true,
        reason: true,
        subscribersAtProposal: true,
        plan: {
          select: {
            key: true,
            tierKey: true,
            priceMinor: true,
            currency: true,
            billingInterval: true,
            providerPriceId: true,
          },
        },
      },
    });
    if (!change || change.planId !== planId) {
      throw new NotFoundException('Price change not found for this plan.');
    }
    if (change.status !== 'DRAFT') {
      throw new BadRequestException(`This price change is already ${change.status.toLowerCase()}.`);
    }
    return change;
  }

  private parsePrice(value: string): bigint {
    let price: bigint;
    try {
      price = BigInt(value);
    } catch {
      throw new BadRequestException('Enter the price in minor units, as a whole number.');
    }
    if (price <= 0n) {
      // A zero price is a free tier, which is a catalog decision rather than a repricing: it
      // changes what the plan is, and Paystack cannot hold a zero-amount plan.
      throw new BadRequestException(
        'A price must be greater than zero. Retire the plan or create a free tier instead.',
      );
    }
    return price;
  }

  /**
   * A large increase has to be confirmed by repeating the figure. The realistic mistake here is a
   * misplaced decimal point, and every current subscriber is charged the result at their next
   * renewal.
   */
  private assertConfirmedWhenLarge(
    from: bigint,
    to: bigint,
    confirmPriceMinor: string | undefined,
  ): void {
    const increase = to - from;
    if (increase <= 0n) return;
    const threshold = (from * BigInt(Math.round(LARGE_INCREASE_RATIO * 100))) / 100n;
    if (increase <= threshold) return;
    if (confirmPriceMinor === undefined) {
      throw new BadRequestException(
        `This raises the price by more than ${Math.round(LARGE_INCREASE_RATIO * 100)}%, from ${from.toString()} to ${to.toString()}. Repeat the new price to confirm it.`,
      );
    }
    let confirmed: bigint;
    try {
      confirmed = BigInt(confirmPriceMinor);
    } catch {
      throw new BadRequestException('The confirmation must repeat the new price exactly.');
    }
    if (confirmed !== to) {
      throw new BadRequestException('The confirmation does not match the new price.');
    }
  }
}

/** A minor-unit amount written the way a subscriber reads it, for the notice email. */
function formatPrice(minor: bigint, currency: string): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${currency} ${whole.toString()}.${fraction}`;
}

/**
 * Why an increase cannot be published yet, in the terms the operator has to act on: who has not
 * been told, and when the people who have been told come out of their notice period.
 */
function noticeRefusal(notice: {
  noticeDays: number;
  subscribersToReprice: number;
  awaitingNotice: number;
  withinNoticePeriod: number;
  earliestPublishAt: string | null;
}): string {
  if (notice.awaitingNotice > 0) {
    return `${notice.awaitingNotice} of ${notice.subscribersToReprice} subscriber${notice.subscribersToReprice === 1 ? '' : 's'} on this plan has not been sent the ${notice.noticeDays}-day price-increase notice. Send the notice, then publish once ${notice.noticeDays} days have passed. An organization with no billing contact and no owner email cannot be notified at all and has to be given one first.`;
  }
  const until = notice.earliestPublishAt ?? 'the notice period ends';
  return `${notice.withinNoticePeriod} notified subscriber${notice.withinNoticePeriod === 1 ? '' : 's'} are still inside the ${notice.noticeDays}-day notice period. This can be published from ${until}.`;
}
