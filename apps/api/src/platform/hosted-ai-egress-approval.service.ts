import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { writePlatformAudit } from './platform-audit.js';
import type { PlatformContext } from './platform-context.js';
import type {
  CreateHostedAiEgressApprovalDto,
  RevokeHostedAiEgressApprovalDto,
} from './platform.dto.js';
import { EntitlementsService } from './entitlements.service.js';
import { PHASE13_FEATURE_FLAGS } from './phase13-feature-flags.js';

const PROVIDER = 'DEEPSEEK';
const DATA_SCOPE = 'REPORT_EVIDENCE';

/**
 * Owns the legal approval that is required in addition to the technical organization-scoped flag.
 * Both writes occur in one transaction so no approval is ever live without its corresponding
 * opt-in rule, and revocation removes both permissions at the same commit.
 */
@Injectable()
export class HostedAiEgressApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async isEnabled(organizationId: string): Promise<boolean> {
    const approval = await this.prisma.hostedAiEgressApproval.findFirst({
      where: { organizationId, status: 'ACTIVE', provider: PROVIDER, dataScope: DATA_SCOPE },
      select: { id: true },
    });
    if (!approval) return false;
    return this.entitlements.isOrganizationFlagExplicitlyEnabled(
      organizationId,
      PHASE13_FEATURE_FLAGS.HOSTED_AI_EGRESS,
    );
  }

  async status(organizationId: string) {
    const approval = await this.prisma.hostedAiEgressApproval.findFirst({
      where: { organizationId },
      orderBy: { approvedAt: 'desc' },
      select: {
        id: true,
        status: true,
        provider: true,
        dataScope: true,
        jurisdictionCountryCode: true,
        approvedAt: true,
        revokedAt: true,
      },
    });
    if (!approval) {
      await this.ensureOrganization(organizationId);
      return { approval: null, runtimeEgressEnabled: false };
    }
    return {
      approval: serializeStatus(approval),
      runtimeEgressEnabled: await this.isEnabled(organizationId),
    };
  }

  async listRecords(organizationId: string) {
    await this.ensureOrganization(organizationId);
    const records = await this.prisma.hostedAiEgressApproval.findMany({
      where: { organizationId },
      orderBy: { approvedAt: 'desc' },
    });
    return records.map(serializeRecord);
  }

  async approve(
    actor: PlatformContext,
    organizationId: string,
    input: CreateHostedAiEgressApprovalDto,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { id: true },
      });
      if (!organization) throw new NotFoundException('Organization not found.');

      const active = await tx.hostedAiEgressApproval.findFirst({
        where: { organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (active) throw new ConflictException('Hosted AI egress already has an active approval.');

      const flag = await tx.featureFlag.findUnique({
        where: { key: PHASE13_FEATURE_FLAGS.HOSTED_AI_EGRESS },
        select: { id: true, status: true },
      });
      if (!flag || flag.status !== 'ACTIVE') {
        throw new ConflictException('The hosted AI egress feature flag is not active.');
      }

      const approval = await tx.hostedAiEgressApproval.create({
        data: {
          organizationId,
          provider: PROVIDER,
          dataScope: DATA_SCOPE,
          jurisdictionCountryCode: input.jurisdictionCountryCode,
          signerName: input.signerName,
          signerEmail: input.signerEmail,
          signerAuthority: input.signerAuthority,
          disclosureVersion: input.disclosureVersion,
          legalDecisionReference: input.legalDecisionReference,
          consentDocumentReference: input.consentDocumentReference,
          consentDocumentHash: input.consentDocumentHash.toLowerCase(),
          approvedByPlatformAdminId: actor.id,
        },
      });

      const existingRule = await tx.featureFlagRule.findFirst({
        where: { flagId: flag.id, scope: 'ORGANIZATION', organizationId },
        select: { id: true, enabled: true },
      });
      const rule = existingRule
        ? await tx.featureFlagRule.update({
            where: { id: existingRule.id },
            data: {
              enabled: true,
              note: 'Enabled by active hosted AI egress approval.',
            },
          })
        : await tx.featureFlagRule.create({
            data: {
              flagId: flag.id,
              scope: 'ORGANIZATION',
              organizationId,
              enabled: true,
              note: 'Enabled by active hosted AI egress approval.',
            },
          });

      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.hosted_ai_egress_approved',
        targetType: 'hosted_ai_egress_approval',
        targetId: approval.id,
        organizationId,
        reason: input.legalDecisionReference,
        after: {
          provider: PROVIDER,
          dataScope: DATA_SCOPE,
          jurisdictionCountryCode: input.jurisdictionCountryCode,
          disclosureVersion: input.disclosureVersion,
          consentDocumentHash: approval.consentDocumentHash,
          featureFlagRuleId: rule.id,
        },
        ipHash,
      });
      return serializeRecord(approval);
    });
  }

  async revoke(
    actor: PlatformContext,
    organizationId: string,
    approvalId: string,
    input: RevokeHostedAiEgressApprovalDto,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const approval = await tx.hostedAiEgressApproval.findFirst({
        where: { id: approvalId, organizationId, status: 'ACTIVE' },
      });
      if (!approval) throw new NotFoundException('Active hosted AI egress approval not found.');

      const updated = await tx.hostedAiEgressApproval.update({
        where: { id: approval.id },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedByPlatformAdminId: actor.id,
          revocationReason: input.reason,
        },
      });
      const flag = await tx.featureFlag.findUnique({
        where: { key: PHASE13_FEATURE_FLAGS.HOSTED_AI_EGRESS },
        select: { id: true },
      });
      if (flag) {
        const rule = await tx.featureFlagRule.findFirst({
          where: { flagId: flag.id, scope: 'ORGANIZATION', organizationId },
          select: { id: true },
        });
        if (rule) {
          await tx.featureFlagRule.update({
            where: { id: rule.id },
            data: { enabled: false, note: 'Disabled when hosted AI egress approval was revoked.' },
          });
        }
      }
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.hosted_ai_egress_revoked',
        targetType: 'hosted_ai_egress_approval',
        targetId: updated.id,
        organizationId,
        reason: input.reason,
        before: { status: approval.status },
        after: { status: updated.status, revokedAt: updated.revokedAt?.toISOString() ?? null },
        ipHash,
      });
      return serializeRecord(updated);
    });
  }

  private async ensureOrganization(organizationId: string): Promise<void> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!organization) throw new NotFoundException('Organization not found.');
  }
}

function serializeStatus(record: {
  id: string;
  status: string;
  provider: string;
  dataScope: string;
  jurisdictionCountryCode: string;
  approvedAt: Date;
  revokedAt: Date | null;
}) {
  return {
    id: record.id,
    status: record.status,
    provider: record.provider,
    dataScope: record.dataScope,
    jurisdictionCountryCode: record.jurisdictionCountryCode,
    approvedAt: record.approvedAt.toISOString(),
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
}

function serializeRecord(record: {
  id: string;
  organizationId: string;
  status: string;
  provider: string;
  dataScope: string;
  jurisdictionCountryCode: string;
  signerName: string;
  signerEmail: string;
  signerAuthority: string;
  disclosureVersion: string;
  legalDecisionReference: string;
  consentDocumentReference: string;
  consentDocumentHash: string;
  approvedByPlatformAdminId: string;
  approvedAt: Date;
  revokedByPlatformAdminId: string | null;
  revokedAt: Date | null;
  revocationReason: string | null;
}) {
  return {
    ...serializeStatus(record),
    organizationId: record.organizationId,
    signerName: record.signerName,
    signerEmail: record.signerEmail,
    signerAuthority: record.signerAuthority,
    disclosureVersion: record.disclosureVersion,
    legalDecisionReference: record.legalDecisionReference,
    consentDocumentReference: record.consentDocumentReference,
    consentDocumentHash: record.consentDocumentHash,
    approvedByPlatformAdminId: record.approvedByPlatformAdminId,
    revokedByPlatformAdminId: record.revokedByPlatformAdminId,
    revocationReason: record.revocationReason,
  };
}
