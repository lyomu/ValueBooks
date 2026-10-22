import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OFFICIAL_PLAN_TIERS } from '@valuebooks/contracts';

import {
  PaystackBillingAdapter,
  paystackPlanMismatches,
} from '../billing/paystack-billing.adapter.js';
import { PrismaService } from '../database/prisma.service.js';
import { writePlatformAudit } from './platform-audit.js';
import type { PlatformContext } from './platform-context.js';
import type {
  CreateFeatureFlagDto,
  CreatePlanDto,
  SetProviderPlanCodeDto,
  UpdateFeatureFlagDto,
  UpdatePlanDto,
  UpsertEntitlementDto,
  UpsertFlagRuleDto,
} from './platform.dto.js';

const OFFICIAL_PLAN_KEYS = new Set(
  OFFICIAL_PLAN_TIERS.flatMap((tier) => [`${tier}_monthly`, `${tier}_yearly`]),
);

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
  ) {}

  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      include: {
        entitlements: { orderBy: { key: 'asc' } },
        _count: { select: { subscriptions: true } },
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
    }));
  }

  async createPlan(actor: PlatformContext, input: CreatePlanDto, ipHash: string | null) {
    const existing = await this.prisma.plan.findUnique({
      where: { key: input.key },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A plan with that key already exists.');

    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          key: input.key,
          tierKey: input.tierKey ?? input.key,
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
    if (!OFFICIAL_PLAN_KEYS.has(plan.key) || plan.status !== 'ACTIVE') {
      throw new BadRequestException('Only the eight active official plans carry a Paystack code.');
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
      include: {
        rules: {
          orderBy: { scope: 'asc' },
          include: {
            plan: { select: { key: true, name: true } },
            organization: { select: { legalName: true, tradingName: true } },
          },
        },
      },
    });
    return flags.map((flag) => ({
      id: flag.id,
      key: flag.key,
      name: flag.name,
      description: flag.description,
      defaultEnabled: flag.defaultEnabled,
      status: flag.status,
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
    }));
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
        after: { key: flag.key, defaultEnabled: flag.defaultEnabled },
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
        before: { defaultEnabled: existing.defaultEnabled, status: existing.status },
        after: { defaultEnabled: updated.defaultEnabled, status: updated.status },
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
      const flag = await tx.featureFlag.findUnique({ where: { id: flagId }, select: { id: true } });
      if (!flag) throw new NotFoundException('Feature flag not found.');

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
        select: { id: true, enabled: true },
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
        before: existing ? { enabled: existing.enabled } : undefined,
        after: { scope: rule.scope, enabled: rule.enabled },
        ipHash,
      });
      return { id: rule.id, scope: rule.scope, enabled: rule.enabled };
    });
  }

  async removeFlagRule(actor: PlatformContext, ruleId: string, ipHash: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.featureFlagRule.findUnique({ where: { id: ruleId } });
      if (!existing) throw new NotFoundException('Feature flag rule not found.');
      await tx.featureFlagRule.delete({ where: { id: ruleId } });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.feature_flag_rule_removed',
        targetType: 'feature_flag_rule',
        targetId: ruleId,
        organizationId: existing.organizationId,
        before: { scope: existing.scope, enabled: existing.enabled },
        ipHash,
      });
    });
  }
}

/**
 * The scope and its target must agree. The table carries the same check, but a constraint violation
 * surfaces as a 500; this makes it a 400 that names the mistake.
 */
function assertScopeTarget(input: UpsertFlagRuleDto): void {
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
