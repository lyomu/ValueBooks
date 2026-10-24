import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Prisma } from '@prisma/client';

import {
  PaystackBillingAdapter,
  paystackPlanMismatches,
} from '../billing/paystack-billing.adapter.js';
import { PrismaService } from '../database/prisma.service.js';
import { findCountry } from '../organizations/jurisdiction-catalog.js';
import { APPROVAL_GOVERNED_FLAGS } from './phase13-feature-flags.js';
import { writePlatformAudit } from './platform-audit.js';
import { CatalogHealthService } from './catalog-health.service.js';
import type { PlatformContext } from './platform-context.js';
import type {
  CreateFeatureFlagDto,
  CreatePlanDto,
  CreateTierDto,
  FlagAudienceDto,
  SetProviderPlanCodeDto,
  UpdateFeatureFlagDto,
  UpdatePlanDto,
  UpsertEntitlementDto,
  UpsertFlagRuleDto,
} from './platform.dto.js';

type PlanRow = {
  name: string;
  status: string;
  isDefault: boolean;
  isMostPopular: boolean;
  tierKey: string;
  trialDays: number;
  priceMinor: bigint;
  currency: string;
  billingInterval: string;
  billingProvider: string | null;
  providerProductId: string | null;
  providerPriceId: string | null;
  sortOrder: number;
};

function planAuditSnapshot(plan: PlanRow) {
  return {
    name: plan.name,
    status: plan.status,
    isDefault: plan.isDefault,
    isMostPopular: plan.isMostPopular,
    tierKey: plan.tierKey,
    trialDays: plan.trialDays,
    priceMinor: plan.priceMinor.toString(),
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    billingProvider: plan.billingProvider,
    providerProductId: plan.providerProductId,
    providerPlanCode: plan.providerPriceId,
    sortOrder: plan.sortOrder,
  };
}

/**
 * Global reference data a superadmin owns: plans, their entitlements, and feature flags with their
 * targeting rules. Every tenant depends on these rows, which is why they sit behind the highest
 * platform role rather than an organization permission.
 */
@Injectable()
export class PlatformCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackBillingAdapter,
    private readonly health: CatalogHealthService,
  ) {}

  listTiers() {
    return this.prisma.planTier.findMany({ orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] });
  }

  catalogHealth() { return this.health.violations(); }

  async createTier(actor: PlatformContext, input: CreateTierDto, ipHash: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const tier = await tx.planTier.create({ data: {
        key: input.key, name: input.name, description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0, isMostPopular: input.isMostPopular ?? false,
        tagline: input.tagline ?? null, highlights: input.highlights ?? [], status: 'DRAFT',
      } });
      await writePlatformAudit(tx, actor, { eventKey: 'platform.plan_tier_created', targetType: 'plan_tier',
        targetId: tier.id, reason: input.reason, after: { key: tier.key, name: tier.name, status: tier.status }, ipHash });
      return tier;
    });
  }

  async activateTier(actor: PlatformContext, key: string, reason: string, ipHash: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const tier = await tx.planTier.findUnique({ where: { key } });
      if (!tier) throw new NotFoundException('Tier not found.');
      if (tier.status !== 'DRAFT') throw new BadRequestException('Only a draft tier can be activated.');
      const tierPlans = await tx.plan.findMany({ where: { tierKey: key }, select: { key: true } });
      const proposed = await this.health.violations({ activateTier: key }, tx);
      const blocking = proposed.filter((row) => row.category === 'INVARIANT' &&
        (row.subject === key || tierPlans.some((plan) => plan.key === row.subject)));
      if (blocking.length) throw new BadRequestException(`Tier is incomplete: ${blocking.map((row) => row.detail).join(' ')}`);
      await this.health.assertNoNewViolations({ activateTier: key }, tx);
      const updated = await tx.planTier.update({ where: { key }, data: { status: 'ACTIVE' } });
      await writePlatformAudit(tx, actor, { eventKey: 'platform.plan_tier_activated', targetType: 'plan_tier',
        targetId: tier.id, reason, before: { status: tier.status }, after: { status: updated.status }, ipHash });
      return updated;
    }, { isolationLevel: 'Serializable' });
  }

  async retireTier(actor: PlatformContext, key: string, reason: string, ipHash: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const tier = await tx.planTier.findUnique({ where: { key } });
      if (!tier) throw new NotFoundException('Tier not found.');
      if (tier.status === 'RETIRED') throw new BadRequestException('Tier is already retired.');
      await tx.$queryRaw`SELECT id FROM plans WHERE tier_key = ${key} FOR UPDATE`;
      const subscribers = await tx.organizationSubscription.count({ where: { plan: { tierKey: key },
        status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCEL_SCHEDULED'] } } });
      if (subscribers) throw new BadRequestException(`${subscribers} non-terminal subscription(s) still use this tier. Move them before retiring it.`);
      await tx.plan.updateMany({ where: { tierKey: key }, data: { status: 'RETIRED', isDefault: false } });
      const updated = await tx.planTier.update({ where: { key }, data: { status: 'RETIRED', isMostPopular: false } });
      await writePlatformAudit(tx, actor, { eventKey: 'platform.plan_tier_retired', targetType: 'plan_tier',
        targetId: tier.id, reason, before: { status: tier.status }, after: { status: updated.status, plansRetired: true }, ipHash });
      return updated;
    }, { isolationLevel: 'Serializable' });
  }

  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      include: {
        entitlements: { orderBy: { key: 'asc' } },
        entitlementVersions: { where: { status: 'DRAFT' }, take: 1,
          select: { id: true, version: true, reason: true } },
        _count: { select: { subscriptions: true } },
        // At most one DRAFT per plan, enforced by a partial unique index.
        priceChanges: {
          where: { status: 'DRAFT' },
          take: 1,
          select: {
            id: true,
            toPriceMinor: true,
            currency: true,
            reason: true,
            createdAt: true,
            subscribersAtProposal: true,
            proposedBy: { select: { user: { select: { email: true } } } },
          },
        },
      },
    });
    return plans.map((plan) => ({
      id: plan.id,
      key: plan.key,
      tierKey: plan.tierKey,
      name: plan.name,
      description: plan.description,
      status: plan.status,
      isDefault: plan.isDefault,
      isMostPopular: plan.isMostPopular,
      trialDays: plan.trialDays,
      priceMinor: plan.priceMinor.toString(),
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      billingProvider: plan.billingProvider,
      providerProductId: plan.providerProductId,
      providerPriceId: plan.providerPriceId,
      sortOrder: plan.sortOrder,
      subscriberCount: plan._count.subscriptions,
      entitlements: plan.entitlements.map((entitlement) => ({
        key: entitlement.key,
        enabled: entitlement.enabled,
        limitValue: entitlement.limitValue,
      })),
      pendingEntitlementVersion: plan.entitlementVersions[0] ?? null,
      pendingPriceChange: plan.priceChanges[0]
        ? {
            id: plan.priceChanges[0].id,
            toPriceMinor: plan.priceChanges[0].toPriceMinor.toString(),
            currency: plan.priceChanges[0].currency,
            reason: plan.priceChanges[0].reason,
            proposedBy: plan.priceChanges[0].proposedBy.user.email,
            proposedAt: plan.priceChanges[0].createdAt.toISOString(),
            subscribersAtProposal: plan.priceChanges[0].subscribersAtProposal,
          }
        : null,
    }));
  }

  async createPlan(actor: PlatformContext, input: CreatePlanDto, ipHash: string | null) {
    const tierKey = input.tierKey ?? input.key;
    const tier = await this.prisma.planTier.findUnique({ where: { key: tierKey } });
    if (!tier || tier.status === 'RETIRED') throw new BadRequestException('Create a draft tier before adding its plans.');
    const existing = await this.prisma.plan.findUnique({
      where: { key: input.key },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A plan with that key already exists.');

    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          key: input.key,
          tierKey,
          name: input.name,
          description: input.description ?? null,
          isMostPopular: input.isMostPopular ?? false,
          trialDays: input.trialDays ?? 0,
          priceMinor: BigInt(input.priceMinor ?? '0'),
          currency: input.currency ?? 'USD',
          billingInterval: input.billingInterval ?? 'MONTHLY',
          billingProvider: input.billingProvider,
          providerProductId: input.providerProductId,
          providerPriceId: input.providerPriceId,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      // Opening price-history row, in the same transaction as the plan. The phase 7 migration
      // seeded one for every plan that existed then; a plan created later needs its own, or its
      // price history would begin at the first change rather than at what it launched with.
      await tx.planPriceHistory.create({
        data: {
          planId: plan.id,
          priceMinor: plan.priceMinor,
          currency: plan.currency,
          billingInterval: plan.billingInterval,
          effectiveFrom: plan.createdAt,
        },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.plan_created',
        targetType: 'plan',
        targetId: plan.id,
        after: { key: plan.key, name: plan.name },
        ipHash,
      });
      return { id: plan.id, key: plan.key };
    });
  }

  async updatePlan(
    actor: PlatformContext,
    planId: string,
    input: UpdatePlanDto,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.plan.findUnique({ where: { id: planId } });
      if (!existing) throw new NotFoundException('Plan not found.');
      if (existing.status === 'ACTIVE' && input.status === 'RETIRED') {
        throw new BadRequestException('Retire the tier through the governed tier action.');
      }
      if (existing.status === 'ACTIVE' &&
        ((input.priceMinor !== undefined && BigInt(input.priceMinor) !== existing.priceMinor) ||
          (input.billingProvider !== undefined && input.billingProvider !== existing.billingProvider) ||
          (input.billingInterval !== undefined && input.billingInterval !== existing.billingInterval))) {
        throw new BadRequestException('Active plan pricing and provider terms require their governed actions.');
      }
      if (input.tierKey !== undefined && input.tierKey !== existing.tierKey) {
        throw new BadRequestException('Move plans by creating a new plan in the intended tier; tier membership is immutable.');
      }
      const subscriberCount = await tx.organizationSubscription.count({ where: { planId } });
      if (input.status === 'RETIRED' && subscriberCount > 0) {
        // Retiring a plan that tenants are on would leave them pointing at a tier nobody can
        // reason about. Move them first; the console offers that as an explicit action.
        throw new BadRequestException(
          `${subscriberCount} organization(s) are still on this plan. Move them before retiring it.`,
        );
      }
      if (
        subscriberCount > 0 &&
        ((input.priceMinor !== undefined && BigInt(input.priceMinor) !== existing.priceMinor) ||
          (input.billingInterval !== undefined &&
            input.billingInterval !== existing.billingInterval) ||
          (input.currency !== undefined && input.currency !== existing.currency))
      ) {
        // Billing spec Section 20: never silently reprice current subscribers. A real commercial
        // repricing is a new plan row (new key/tier) that existing subscribers are migrated onto
        // deliberately, not an in-place edit of the row they are already on.
        throw new BadRequestException(
          `${subscriberCount} organization(s) are already billed on this plan's current price/interval/currency. ` +
            'Create a new plan version and migrate them deliberately rather than editing this one in place.',
        );
      }
      // The database enforces a single default with a partial unique index, so the previous holder
      // has to be cleared in the same transaction rather than relying on write order.
      if (input.isDefault === true) {
        await tx.plan.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      if (input.isDefault === false && existing.isDefault) {
        throw new BadRequestException(
          'Make another plan the default rather than leaving the platform without one.',
        );
      }
      if (
        input.providerPriceId !== undefined &&
        input.providerPriceId !== existing.providerPriceId
      ) {
        throw new BadRequestException(
          'Change a Paystack plan code through the plan-code action, which verifies it with Paystack and records a reason.',
        );
      }
      const catalogBeforeActivation = input.status === 'ACTIVE' && existing.status !== 'ACTIVE'
        ? await this.health.violations(undefined, tx) : null;
      const updated = await tx.plan.update({
        where: { id: planId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.isMostPopular !== undefined ? { isMostPopular: input.isMostPopular } : {}),
          ...(input.tierKey !== undefined ? { tierKey: input.tierKey } : {}),
          ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
          ...(input.priceMinor !== undefined ? { priceMinor: BigInt(input.priceMinor) } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.billingInterval !== undefined
            ? { billingInterval: input.billingInterval }
            : {}),
          ...(input.billingProvider !== undefined
            ? { billingProvider: input.billingProvider }
            : {}),
          ...(input.providerProductId !== undefined
            ? { providerProductId: input.providerProductId }
            : {}),
          ...(input.providerPriceId !== undefined
            ? { providerPriceId: input.providerPriceId }
            : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
      });
      if (catalogBeforeActivation) {
        // Evaluate the persisted proposal, including any other fields changed in this request.
        await this.health.assertNoNewViolations({}, tx, catalogBeforeActivation);
      }
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.plan_updated',
        targetType: 'plan',
        targetId: planId,
        // Record every commercial field, so a change to any of them leaves evidence.
        before: planAuditSnapshot(existing),
        after: planAuditSnapshot(updated),
        ipHash,
      });
      return { id: updated.id, key: updated.key, status: updated.status };
    });
  }

  async setProviderPlanCode(
    actor: PlatformContext,
    planId: string,
    input: SetProviderPlanCodeDto,
    ipHash: string | null,
  ) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found.');
    if (plan.status === 'RETIRED') {
      throw new BadRequestException('A retired plan cannot receive a Paystack code.');
    }
    if (plan.billingProvider !== 'PAYSTACK') {
      throw new BadRequestException('This plan is not billed through Paystack.');
    }
    if (plan.providerPriceId === input.providerPlanCode) {
      throw new BadRequestException("That is already this plan's Paystack code.");
    }
    const holder = await this.prisma.plan.findFirst({
      where: { providerPriceId: input.providerPlanCode, id: { not: planId } },
      select: { key: true },
    });
    if (holder) {
      throw new ConflictException(`That Paystack code is already used by ${holder.key}.`);
    }
    // Verify before storing: an unverifiable code is never saved. Checkout re-verifies anyway, but
    // a wrong code caught here never reaches a customer.
    // The adapter's 5xx would reach the operator as a generic failure; its message (Paystack's
    // status and error text, or "not configured") is what they need, and carries no secret.
    const remote = await this.paystack.getPlan(input.providerPlanCode).catch((error: unknown) => {
      if (error instanceof BadGatewayException) {
        throw new BadRequestException(
          `Paystack could not confirm ${input.providerPlanCode}: ${error.message} Nothing was changed.`,
        );
      }
      throw error;
    });
    const mismatches = paystackPlanMismatches(remote, {
      ...plan,
      providerPriceId: input.providerPlanCode,
    });
    if (mismatches.length > 0) {
      throw new BadRequestException(
        `The Paystack plan does not match ${plan.key}: ${mismatches.join('; ')}. Nothing was changed.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      // Conditional on the code read above, so two concurrent changes cannot both apply.
      const changed = await tx.plan.updateMany({
        where: { id: planId, providerPriceId: plan.providerPriceId },
        data: { providerPriceId: input.providerPlanCode },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'The plan changed while this was being verified. Reload and try again.',
        );
      }
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.plan_provider_code_changed',
        targetType: 'plan',
        targetId: planId,
        reason: input.reason,
        before: { key: plan.key, providerPlanCode: plan.providerPriceId },
        after: {
          key: plan.key,
          providerPlanCode: input.providerPlanCode,
          verified: { amount: remote.amount, currency: remote.currency, interval: remote.interval },
        },
        ipHash,
      });
      return { key: plan.key, providerPlanCode: input.providerPlanCode };
    });
  }

  async upsertEntitlement(
    actor: PlatformContext,
    planId: string,
    input: UpsertEntitlementDto,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({ where: { id: planId }, select: { id: true } });
      if (!plan) throw new NotFoundException('Plan not found.');
      if (await tx.planEntitlementVersion.count({ where: { planId } }))
        throw new BadRequestException('This plan uses entitlement versions. Create a draft and publish it instead.');
      if (await tx.organizationSubscription.count({ where: { planId } })) {
        throw new BadRequestException(
          'This plan has subscribers. Create a new version and migrate with customer authorization before changing entitlements.',
        );
      }
      const before = await tx.planEntitlement.findUnique({
        where: { planId_key: { planId, key: input.key } },
        select: { enabled: true, limitValue: true },
      });
      const entitlement = await tx.planEntitlement.upsert({
        where: { planId_key: { planId, key: input.key } },
        update: {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          // `limitValue` is tri-state: absent leaves it alone, null means unlimited, a number caps.
          ...(input.limitValue !== undefined ? { limitValue: input.limitValue } : {}),
        },
        create: {
          planId,
          key: input.key,
          enabled: input.enabled ?? true,
          limitValue: input.limitValue ?? null,
        },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.entitlement_updated',
        targetType: 'plan_entitlement',
        targetId: entitlement.id,
        before: before ?? undefined,
        after: {
          key: entitlement.key,
          enabled: entitlement.enabled,
          limitValue: entitlement.limitValue,
        },
        ipHash,
      });
      return {
        key: entitlement.key,
        enabled: entitlement.enabled,
        limitValue: entitlement.limitValue,
      };
    });
  }

  async removeEntitlement(
    actor: PlatformContext,
    planId: string,
    key: string,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.planEntitlement.findUnique({
        where: { planId_key: { planId, key } },
      });
      if (!existing) throw new NotFoundException('Entitlement not found.');
      if (await tx.planEntitlementVersion.count({ where: { planId } }))
        throw new BadRequestException('This plan uses entitlement versions. Create a draft and publish it instead.');
      if (await tx.organizationSubscription.count({ where: { planId } })) {
        throw new BadRequestException(
          'This plan has subscribers. Its entitlements cannot be removed in place.',
        );
      }
      await tx.planEntitlement.delete({ where: { id: existing.id } });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.entitlement_removed',
        targetType: 'plan_entitlement',
        targetId: existing.id,
        before: { key: existing.key, enabled: existing.enabled, limitValue: existing.limitValue },
        ipHash,
      });
    });
  }

  async listFlags() {
    const flags = await this.prisma.featureFlag.findMany({
      orderBy: [{ status: 'asc' }, { key: 'asc' }],
      include: FLAG_INCLUDE,
    });
    const lastChanges = await Promise.all(
      flags.map((flag) =>
        this.prisma.platformAuditEvent.findFirst({
          where: flagHistoryWhere(
            flag.id,
            flag.rules.map((rule) => rule.id),
          ),
          orderBy: { occurredAt: 'desc' },
          select: FLAG_HISTORY_SELECT,
        }),
      ),
    );
    return flags.map((flag, index) => {
      const lastChange = lastChanges[index];
      return {
        ...serializeFlag(flag),
        lastChange: lastChange ? serializeFlagChange(lastChange) : null,
      };
    });
  }

  /** One flag with its rules and its change history, for the flag detail page. */
  async getFlag(flagId: string) {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { id: flagId },
      include: FLAG_INCLUDE,
    });
    if (!flag) throw new NotFoundException('Feature flag not found.');
    const history = await this.prisma.platformAuditEvent.findMany({
      where: flagHistoryWhere(
        flag.id,
        flag.rules.map((rule) => rule.id),
      ),
      orderBy: { occurredAt: 'desc' },
      take: 100,
      select: FLAG_HISTORY_SELECT,
    });
    return { ...serializeFlag(flag), history: history.map(serializeFlagChange) };
  }

  /**
   * How many organizations a rule's target matches today. More specific rules can still override
   * it for some of them, which the console states alongside the number.
   */
  async flagAudience(input: FlagAudienceDto) {
    assertScopeTarget(input);
    await assertTargetExists(this.prisma, input);
    const organizations =
      input.scope === 'GLOBAL'
        ? await this.prisma.organization.count()
        : input.scope === 'COUNTRY'
          ? await this.prisma.organization.count({ where: { countryCode: input.countryCode } })
          : input.scope === 'PLAN'
            ? await this.prisma.organizationSubscription.count({ where: { planId: input.planId } })
            : 1;
    return { organizations };
  }

  async createFlag(actor: PlatformContext, input: CreateFeatureFlagDto, ipHash: string | null) {
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key: input.key },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A feature flag with that key already exists.');
    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.create({
        data: {
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          defaultEnabled: input.defaultEnabled ?? false,
        },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.feature_flag_created',
        targetType: 'feature_flag',
        targetId: flag.id,
        reason: input.reason ?? null,
        after: flagSnapshot(flag),
        ipHash,
      });
      return { id: flag.id, key: flag.key };
    });
  }

  async updateFlag(
    actor: PlatformContext,
    flagId: string,
    input: UpdateFeatureFlagDto,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.featureFlag.findUnique({ where: { id: flagId } });
      if (!existing) throw new NotFoundException('Feature flag not found.');
      if (APPROVAL_GOVERNED_FLAGS.has(existing.key) && input.defaultEnabled !== undefined) {
        throw new BadRequestException(
          'This flag is governed by its approval workflow, so its default cannot be changed here. It can still be archived.',
        );
      }
      const updated = await tx.featureFlag.update({
        where: { id: flagId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.defaultEnabled !== undefined ? { defaultEnabled: input.defaultEnabled } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.feature_flag_updated',
        targetType: 'feature_flag',
        targetId: flagId,
        reason: input.reason,
        before: flagSnapshot(existing),
        after: flagSnapshot(updated),
        ipHash,
      });
      return { id: updated.id, key: updated.key, status: updated.status };
    });
  }

  async upsertFlagRule(
    actor: PlatformContext,
    flagId: string,
    input: UpsertFlagRuleDto,
    ipHash: string | null,
  ) {
    assertScopeTarget(input);
    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.findUnique({
        where: { id: flagId },
        select: { id: true, key: true },
      });
      if (!flag) throw new NotFoundException('Feature flag not found.');
      assertNotApprovalGoverned(flag.key);
      await assertTargetExists(tx, input);

      // One rule per flag per target, matching the partial unique indexes on the table. Finding the
      // existing one first turns a repeat call into an edit rather than a constraint violation.
      const existing = await tx.featureFlagRule.findFirst({
        where: {
          flagId,
          scope: input.scope,
          countryCode: input.countryCode ?? null,
          planId: input.planId ?? null,
          organizationId: input.organizationId ?? null,
        },
      });

      const rule = existing
        ? await tx.featureFlagRule.update({
            where: { id: existing.id },
            data: { enabled: input.enabled, note: input.note ?? null },
          })
        : await tx.featureFlagRule.create({
            data: {
              flagId,
              scope: input.scope,
              countryCode: input.countryCode ?? null,
              planId: input.planId ?? null,
              organizationId: input.organizationId ?? null,
              enabled: input.enabled,
              note: input.note ?? null,
            },
          });

      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.feature_flag_rule_set',
        targetType: 'feature_flag_rule',
        targetId: rule.id,
        organizationId: input.organizationId ?? null,
        reason: input.reason,
        before: existing ? ruleSnapshot(flag, existing) : undefined,
        after: ruleSnapshot(flag, rule),
        ipHash,
      });
      return { id: rule.id, scope: rule.scope, enabled: rule.enabled };
    });
  }

  async removeFlagRule(
    actor: PlatformContext,
    ruleId: string,
    reason: string,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.featureFlagRule.findUnique({
        where: { id: ruleId },
        include: { flag: { select: { id: true, key: true } } },
      });
      if (!existing) throw new NotFoundException('Feature flag rule not found.');
      assertNotApprovalGoverned(existing.flag.key);
      await tx.featureFlagRule.delete({ where: { id: ruleId } });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.feature_flag_rule_removed',
        targetType: 'feature_flag_rule',
        targetId: ruleId,
        organizationId: existing.organizationId,
        reason,
        before: ruleSnapshot(existing.flag, existing),
        ipHash,
      });
    });
  }
}

const FLAG_INCLUDE = {
  rules: {
    orderBy: { scope: 'asc' },
    include: {
      plan: { select: { key: true, name: true } },
      organization: { select: { legalName: true, tradingName: true } },
    },
  },
} satisfies Prisma.FeatureFlagInclude;

const FLAG_HISTORY_SELECT = {
  id: true,
  eventKey: true,
  reason: true,
  before: true,
  after: true,
  occurredAt: true,
  actor: { select: { displayName: true, email: true } },
} satisfies Prisma.PlatformAuditEventSelect;

type FlagWithRules = Prisma.FeatureFlagGetPayload<{ include: typeof FLAG_INCLUDE }>;

function serializeFlag(flag: FlagWithRules) {
  return {
    id: flag.id,
    key: flag.key,
    name: flag.name,
    description: flag.description,
    defaultEnabled: flag.defaultEnabled,
    status: flag.status,
    updatedAt: flag.updatedAt.toISOString(),
    /** Set when an approval workflow, not this console, owns the flag's targeting. */
    governedBy: APPROVAL_GOVERNED_FLAGS.get(flag.key) ?? null,
    rules: flag.rules.map((rule) => ({
      id: rule.id,
      scope: rule.scope,
      enabled: rule.enabled,
      note: rule.note,
      countryCode: rule.countryCode,
      planId: rule.planId,
      planName: rule.plan?.name ?? null,
      organizationId: rule.organizationId,
      organizationName: rule.organization
        ? (rule.organization.tradingName ?? rule.organization.legalName)
        : null,
    })),
  };
}

function serializeFlagChange(
  event: Prisma.PlatformAuditEventGetPayload<{ select: typeof FLAG_HISTORY_SELECT }>,
) {
  return {
    id: event.id,
    eventKey: event.eventKey,
    reason: event.reason,
    before: event.before,
    after: event.after,
    occurredAt: event.occurredAt.toISOString(),
    actor: event.actor.displayName || event.actor.email,
  };
}

/**
 * A flag's own events plus its rules' events. Rule events written since phase 5.1 carry the flag
 * id; older ones are found through the rules the flag still has (a rule removed before 5.1 left no
 * link back to its flag).
 */
function flagHistoryWhere(flagId: string, ruleIds: string[]): Prisma.PlatformAuditEventWhereInput {
  return {
    OR: [
      { targetType: 'feature_flag', targetId: flagId },
      { targetType: 'feature_flag_rule', after: { path: ['flagId'], equals: flagId } },
      { targetType: 'feature_flag_rule', before: { path: ['flagId'], equals: flagId } },
      ...(ruleIds.length ? [{ targetType: 'feature_flag_rule', targetId: { in: ruleIds } }] : []),
    ],
  };
}

function flagSnapshot(flag: {
  key: string;
  name: string;
  description: string | null;
  defaultEnabled: boolean;
  status: string;
}) {
  return {
    key: flag.key,
    name: flag.name,
    description: flag.description,
    defaultEnabled: flag.defaultEnabled,
    status: flag.status,
  };
}

function ruleSnapshot(
  flag: { id: string; key: string },
  rule: {
    scope: string;
    enabled: boolean;
    countryCode: string | null;
    planId: string | null;
    organizationId: string | null;
    note: string | null;
  },
) {
  return {
    flagId: flag.id,
    flagKey: flag.key,
    scope: rule.scope,
    countryCode: rule.countryCode,
    planId: rule.planId,
    organizationId: rule.organizationId,
    enabled: rule.enabled,
    note: rule.note,
  };
}

function assertNotApprovalGoverned(key: string): void {
  if (APPROVAL_GOVERNED_FLAGS.has(key)) {
    throw new BadRequestException(
      "This flag's targeting is owned by its approval workflow. Grant or revoke it from the organization's AI egress approval instead.",
    );
  }
}

/**
 * Typed targets: a rule must name a supported country, an existing plan or an existing
 * organization. Without this a typo becomes a rule that silently matches nothing, or a 500.
 */
async function assertTargetExists(
  db: Prisma.TransactionClient,
  input: { scope: string; countryCode?: string; planId?: string; organizationId?: string },
): Promise<void> {
  if (input.scope === 'COUNTRY' && !findCountry(input.countryCode ?? '')) {
    throw new BadRequestException(`${input.countryCode} is not a supported country.`);
  }
  if (
    input.scope === 'PLAN' &&
    !(await db.plan.findUnique({ where: { id: input.planId }, select: { id: true } }))
  ) {
    throw new BadRequestException('That plan does not exist.');
  }
  if (
    input.scope === 'ORGANIZATION' &&
    !(await db.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true },
    }))
  ) {
    throw new BadRequestException('That organization does not exist.');
  }
}

/**
 * The scope and its target must agree. The table carries the same check, but a constraint violation
 * surfaces as a 500; this makes it a 400 that names the mistake.
 */
function assertScopeTarget(input: FlagAudienceDto): void {
  const targets = {
    COUNTRY: input.countryCode,
    PLAN: input.planId,
    ORGANIZATION: input.organizationId,
  };
  for (const [scope, value] of Object.entries(targets)) {
    if (scope === input.scope && !value) {
      throw new BadRequestException(`A ${scope} rule must name a ${scope.toLowerCase()}.`);
    }
    if (scope !== input.scope && value) {
      throw new BadRequestException(
        `A ${input.scope} rule must not name a ${scope.toLowerCase()}.`,
      );
    }
  }
}
