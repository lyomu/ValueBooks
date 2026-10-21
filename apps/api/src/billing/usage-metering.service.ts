import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

type QueryClient = PrismaService | Prisma.TransactionClient;

export interface QuotaCheck {
  resourceKey: string;
  used: number;
  limit: number | null;
  allowed: boolean;
}

/**
 * Counts usage of one metered resource (issued invoices, active customers, ...) against the
 * organization's current plan limit, in the exact monthly window the spec requires even under an
 * annual subscription term (Section 3.0/4): a yearly subscriber's invoice quota still resets every
 * month, it does not receive twelve months of allowance up front.
 *
 * Callers are responsible for calling `assertWithinLimit` immediately before the action that would
 * exceed quota, and `increment` only once that action has actually completed (e.g. an invoice is
 * issued, not merely drafted) — counting here, not in a request guard, is what keeps a failed
 * business-rule validation from silently consuming a unit of quota.
 */
@Injectable()
export class UsageMeteringService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The monthly window usage for `resourceKey` currently counts against. Anchored to the UTC
   * calendar month rather than the subscription's billing-cycle anniversary. The real
   * provider-driven renewal date (`currentPeriodStart`/`currentPeriodEnd` on
   * `OrganizationSubscription`) should become the authoritative billing period once live
   * subscriptions exist; this calendar window is the documented interim simplification used by
   * trial organizations and any subscription missing that data.
   */
  currentPeriod(now = new Date()): { start: Date; end: Date } {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
  }

  /** Paid yearly terms contain twelve separate monthly quota windows. Trial usage is bounded by
   * the exact 336-hour trial. Older organizations without billing rows retain calendar windows. */
  async periodForOrganization(organizationId: string, now = new Date()) {
    const subscription = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId },
      select: { status: true, startedAt: true, trialEndsAt: true, currentPeriodStart: true, currentPeriodEnd: true },
    });
    if (subscription?.status === 'TRIALING' && subscription.trialEndsAt) {
      return { start: subscription.startedAt, end: subscription.trialEndsAt };
    }
    if (subscription?.currentPeriodStart && subscription.currentPeriodEnd) {
      let start = subscription.currentPeriodStart;
      let monthIndex = 1;
      let end = monthlyBoundary(subscription.currentPeriodStart, monthIndex);
      while (end <= now && end < subscription.currentPeriodEnd) {
        start = end;
        end = monthlyBoundary(subscription.currentPeriodStart, ++monthIndex);
      }
      return { start, end: end < subscription.currentPeriodEnd ? end : subscription.currentPeriodEnd };
    }
    return this.currentPeriod(now);
  }

  /**
   * Null means "not enforced", for two different reasons that both resolve the same way: an
   * organization with no subscription row at all (every organization created before billing
   * existed, and any test fixture that does not go through the real signup flow) is not missing
   * an entitlement, it simply predates having one to check -- failing open here, the same way
   * `EntitlementsService.forOrganization` resolves a missing subscription to `plan: null` rather
   * than an error. A *disabled* entitlement on a real plan (`enabled: false`) is the only case
   * that actually means "not included on this tier", and that one still returns 0.
   */
  async resolveLimit(organizationId: string, resourceKey: string): Promise<number | null> {
    const override = await this.prisma.billingEntitlementOverride.findFirst({
      where: { organizationId, entitlementKey: resourceKey, status: 'ACTIVE', effectiveAt: { lte: new Date() }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' }, select: { enabled: true, unlimited: true, limitValue: true },
    });
    if (override) return override.enabled === false ? 0 : override.unlimited ? null : override.limitValue;
    const subscription = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId },
      select: {
        status: true,
        plan: {
          select: { entitlements: { where: { key: resourceKey }, select: { enabled: true, limitValue: true } } },
        },
      },
    });
    if (!subscription) return null;
    if (subscription.status === 'TRIALING' && resourceKey === 'ai_insights.max') return 10;
    const entitlement = subscription.plan.entitlements[0];
    if (!entitlement) return null;
    if (!entitlement.enabled) return 0;
    return entitlement.limitValue;
  }

  async getUsage(organizationId: string, resourceKey: string): Promise<QuotaCheck> {
    const limit = await this.resolveLimit(organizationId, resourceKey);
    const { start } = await this.periodForOrganization(organizationId);
    const counter = await this.prisma.usageCounter.findUnique({
      where: { organizationId_resourceKey_periodStart: { organizationId, resourceKey, periodStart: start } },
      select: { usedCount: true },
    });
    const used = counter?.usedCount ?? 0;
    return { resourceKey, used, limit, allowed: limit === null || used < limit };
  }

  /** Throws a structured, upgrade-aware error if the organization is already at its limit. Does
   * not itself count anything — call `increment` after the metered action succeeds. */
  async assertWithinLimit(organizationId: string, resourceKey: string): Promise<QuotaCheck> {
    const check = await this.getUsage(organizationId, resourceKey);
    if (!check.allowed) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        feature: resourceKey,
        currentUsage: check.used,
        limit: check.limit,
        upgradeRequired: true,
      });
    }
    return check;
  }

  /**
   * For a concurrent-cap resource (active customers, seats, ...) rather than a monthly flow
   * counter: the caller already knows the live count (e.g. `COUNT(*) WHERE status = 'ACTIVE'`),
   * since archived/deactivated records legitimately come back out of the cap. This never touches
   * `UsageCounter` — there is nothing to reset monthly for a resource that is a standing count.
   */
  async assertWithinConcurrentLimit(
    organizationId: string,
    resourceKey: string,
    currentCount: number,
  ): Promise<QuotaCheck> {
    const limit = await this.resolveLimit(organizationId, resourceKey);
    const allowed = limit === null || currentCount < limit;
    if (!allowed) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        feature: resourceKey,
        currentUsage: currentCount,
        limit,
        upgradeRequired: true,
      });
    }
    return { resourceKey, used: currentCount, limit, allowed };
  }

  /** Uses the same entitlement source as numeric quotas for an included capability. A disabled
   * entitlement resolves to zero and yields the structured upgrade response the client understands. */
  async assertFeatureAvailable(organizationId: string, resourceKey: string): Promise<void> {
    const limit = await this.resolveLimit(organizationId, resourceKey);
    if (limit === 0) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED', feature: resourceKey,
        currentUsage: 0, limit: 0, upgradeRequired: true,
      });
    }
  }

  /**
   * Atomic increment, safe under concurrent requests: the row is created at zero and bumped with
   * a single `UPDATE ... SET used_count = used_count + 1`, never a read-then-write race. Accepts
   * an optional transaction client so a caller already inside a `$transaction` (e.g. invoice
   * issuance) can count in the same transaction the business action commits in, rather than in a
   * separate round trip that could succeed or fail independently of it.
   */
  async increment(
    organizationId: string,
    resourceKey: string,
    by = 1,
    client: QueryClient = this.prisma,
  ): Promise<void> {
    const { start, end } = await this.periodForOrganization(organizationId);
    await client.$executeRaw`
      INSERT INTO "usage_counters" ("organization_id", "resource_key", "period_start", "period_end", "used_count")
      VALUES (${organizationId}::uuid, ${resourceKey}, ${start}, ${end}, ${by})
      ON CONFLICT ("organization_id", "resource_key", "period_start")
      DO UPDATE SET "used_count" = "usage_counters"."used_count" + ${by}, "updated_at" = now()
    `;
  }

  /** Atomically reserves a monthly unit in the caller's business transaction. A competing request
   * cannot pass the cap between a separate read and increment. A rollback returns the unit. */
  async consume(organizationId: string, resourceKey: string, client: QueryClient, by = 1) {
    const [limit, period] = await Promise.all([
      this.resolveLimit(organizationId, resourceKey),
      this.periodForOrganization(organizationId),
    ]);
    const changed = await client.$queryRaw<{ used_count: number }[]>`
      INSERT INTO "usage_counters" ("organization_id", "resource_key", "period_start", "period_end", "used_count")
      SELECT ${organizationId}::uuid, ${resourceKey}, ${period.start}, ${period.end}, ${by}
      WHERE ${limit}::integer IS NULL OR ${by} <= ${limit}::integer
      ON CONFLICT ("organization_id", "resource_key", "period_start")
      DO UPDATE SET "used_count" = "usage_counters"."used_count" + ${by}, "updated_at" = now()
      WHERE ${limit}::integer IS NULL OR "usage_counters"."used_count" + ${by} <= ${limit}::integer
      RETURNING "used_count"
    `;
    if (!changed.length) {
      const check = await this.getUsage(organizationId, resourceKey);
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED', feature: resourceKey,
        currentUsage: check.used, limit, upgradeRequired: true,
      });
    }
  }
}

function monthlyBoundary(date: Date, monthIndex: number) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + monthIndex;
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}
