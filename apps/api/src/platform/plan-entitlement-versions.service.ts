import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OFFICIAL_ENTITLEMENT_KEYS, OFFICIAL_FEATURE_KEYS } from '@valuebooks/contracts';

import { PrismaService } from '../database/prisma.service.js';
import { writePlatformAudit } from './platform-audit.js';
import type { PlatformContext } from './platform-context.js';

const REQUIRED_KEYS: readonly string[] = [...OFFICIAL_ENTITLEMENT_KEYS, ...OFFICIAL_FEATURE_KEYS];
const NON_TERMINAL = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCEL_SCHEDULED'] as const;

/** A draft is a full immutable-at-publication snapshot, never an edit to the live projection. */
@Injectable()
export class PlanEntitlementVersionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(planId: string) {
    return this.prisma.planEntitlementVersion.findMany({ where: { planId }, orderBy: { version: 'desc' },
      include: { values: { orderBy: { key: 'asc' } } } });
  }

  async createDraft(actor: PlatformContext, planId: string, reason: string, ipHash: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({ where: { id: planId },
        include: { entitlements: { select: { key: true, enabled: true, limitValue: true } } } });
      if (!plan) throw new NotFoundException('Plan not found.');
      if (await tx.planEntitlementVersion.count({ where: { planId, status: 'DRAFT' } }))
        throw new ConflictException('This plan already has an entitlement draft.');
      const last = await tx.planEntitlementVersion.findFirst({ where: { planId }, orderBy: { version: 'desc' } });
      // Reserve version 1 for the current projection when this is the first change.
      const version = (last?.version ?? 1) + 1;
      const draft = await tx.planEntitlementVersion.create({ data: { planId, version, reason,
        values: { create: plan.entitlements.map((row) => ({ key: row.key, enabled: row.enabled, limitValue: row.limitValue })) } },
        include: { values: true } });
      await writePlatformAudit(tx, actor, { eventKey: 'platform.plan_entitlement_draft_created',
        targetType: 'plan', targetId: planId, reason, after: { version, values: draft.values }, ipHash });
      return draft;
    });
  }

  async setDraftValue(actor: PlatformContext, planId: string, versionId: string,
    input: { key: string; enabled: boolean; limitValue?: number | null; reason: string }, ipHash: string | null) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM plan_entitlement_versions WHERE id = ${versionId}::uuid FOR UPDATE`;
      const draft = await tx.planEntitlementVersion.findFirst({ where: { id: versionId, planId, status: 'DRAFT' } });
      if (!draft) throw new NotFoundException('Entitlement draft not found.');
      if (!REQUIRED_KEYS.includes(input.key)) throw new BadRequestException('Unknown entitlement key.');
      const before = await tx.planEntitlementValue.findUnique({ where: { versionId_key: { versionId, key: input.key } } });
      const value = await tx.planEntitlementValue.upsert({ where: { versionId_key: { versionId, key: input.key } },
        create: { versionId, key: input.key, enabled: input.enabled, limitValue: input.limitValue ?? null },
        update: { enabled: input.enabled, ...(input.limitValue !== undefined ? { limitValue: input.limitValue } : {}) } });
      await writePlatformAudit(tx, actor, { eventKey: 'platform.plan_entitlement_draft_value_changed',
        targetType: 'plan', targetId: planId, reason: input.reason,
        before: before ? { key: before.key, enabled: before.enabled, limitValue: before.limitValue } : undefined,
        after: { version: draft.version, key: value.key, enabled: value.enabled, limitValue: value.limitValue }, ipHash });
      return value;
    });
  }

  async preview(planId: string, versionId: string) {
    const draft = await this.prisma.planEntitlementVersion.findFirst({ where: { id: versionId, planId, status: 'DRAFT' },
      include: { values: { orderBy: { key: 'asc' } } } });
    if (!draft) throw new NotFoundException('Entitlement draft not found.');
    const subscribers = await this.prisma.organizationSubscription.findMany({
      where: { planId, status: { in: [...NON_TERMINAL] } },
      select: { entitlementVersionId: true, currentPeriodEnd: true, trialEndsAt: true },
    });
    const missing = REQUIRED_KEYS.filter((key) => !draft.values.some((row) => row.key === key));
    return { id: draft.id, version: draft.version, values: draft.values,
      subscribersStayingOnCurrentTerms: subscribers.length,
      subscribersToPinAtPublish: subscribers.filter((row) => !row.entitlementVersionId).length,
      earliestRenewalAt: subscribers.map((row) => row.currentPeriodEnd ?? row.trialEndsAt).filter((date): date is Date => !!date)
        .sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString() ?? null,
      missingKeys: missing,
      // Every paid renewal (or trial conversion) clears a pin only after a verified payment.
      migration: 'Existing subscribers keep their current entitlements until their next verified renewal or trial conversion.',
    };
  }

  async publish(actor: PlatformContext, planId: string, versionId: string, reason: string, ipHash: string | null) {
    return this.prisma.$transaction(async (tx) => {
      // Serialise subscription joins against the pin-and-projection swap. A subscription FK
      // check takes KEY SHARE on this row and waits until publication commits.
      await tx.$queryRaw`SELECT id FROM plans WHERE id = ${planId}::uuid FOR UPDATE`;
      const plan = await tx.plan.findUnique({ where: { id: planId },
        include: { entitlements: { select: { key: true, enabled: true, limitValue: true } } } });
      if (!plan) throw new NotFoundException('Plan not found.');
      await tx.$queryRaw`SELECT id FROM plan_entitlement_versions WHERE id = ${versionId}::uuid FOR UPDATE`;
      const draft = await tx.planEntitlementVersion.findFirst({ where: { id: versionId, planId, status: 'DRAFT' },
        include: { values: true } });
      if (!draft) throw new NotFoundException('Entitlement draft not found.');
      const missing = REQUIRED_KEYS.filter((key) => !draft.values.some((row) => row.key === key));
      if (missing.length) throw new BadRequestException(`Draft is missing ${missing.join(', ')}.`);
      let current = await tx.planEntitlementVersion.findFirst({ where: { planId, status: 'PUBLISHED' },
        orderBy: { version: 'desc' } });
      if (!current) {
        current = await tx.planEntitlementVersion.create({ data: { planId, version: 1, status: 'PUBLISHED',
          reason: 'Initial snapshot of the existing live entitlements before the first publication',
          publishedAt: new Date(), publishedByPlatformAdminId: actor.id,
          values: { create: plan.entitlements.map((row) => ({ key: row.key, enabled: row.enabled, limitValue: row.limitValue })) } } });
      }
      const pinned = await tx.organizationSubscription.updateMany({ where: { planId, entitlementVersionId: null,
        status: { in: [...NON_TERMINAL] } }, data: { entitlementVersionId: current.id } });
      // The live projection is retained for all unpinned reads and new subscriptions.
      await tx.planEntitlement.deleteMany({ where: { planId } });
      await tx.planEntitlement.createMany({ data: draft.values.map((row) => ({ planId, key: row.key,
        enabled: row.enabled, limitValue: row.limitValue })) });
      await tx.planEntitlementVersion.update({ where: { id: draft.id }, data: { status: 'PUBLISHED',
        publishedAt: new Date(), publishedByPlatformAdminId: actor.id, reason } });
      await writePlatformAudit(tx, actor, { eventKey: 'platform.plan_entitlement_version_published',
        targetType: 'plan', targetId: planId, reason,
        before: { version: current.version, values: plan.entitlements },
        after: { version: draft.version, values: draft.values, subscribersPinned: pinned.count }, ipHash });
      return { version: draft.version, subscribersPinned: pinned.count };
    });
  }
}
