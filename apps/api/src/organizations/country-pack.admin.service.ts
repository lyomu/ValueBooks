import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { writePlatformAudit } from '../platform/platform-audit.js';
import type { PlatformContext } from '../platform/platform-context.js';
import {
  assertPackDefaultsShape,
  type CreateCountryPackDto,
  type TaxPackInputDto,
  type UpdateCountryPackDto,
} from './country-pack.dto.js';

const countryPackWithTaxPacks = {
  taxPacks: { orderBy: { version: 'desc' as const } },
} satisfies Prisma.CountryPackInclude;

type CountryPackWithTaxPacks = Prisma.CountryPackGetPayload<{
  include: typeof countryPackWithTaxPacks;
}>;

function taxPackData(input: TaxPackInputDto) {
  return {
    version: input.version,
    name: input.name,
    rates: input.rates,
    registrationFields: input.registrationFields ?? [],
    exemptions: input.exemptions ?? [],
    reportingMappings: input.reportingMappings ?? {},
    notes: input.notes ?? [],
  };
}

function auditSnapshot(pack: CountryPackWithTaxPacks): Prisma.InputJsonObject {
  return {
    code: pack.code,
    version: pack.version,
    countryCode: pack.countryCode,
    name: pack.name,
    status: pack.status,
    tier: pack.tier,
    defaults: pack.defaults,
    notes: pack.notes,
    supportedEntityTypes: pack.supportedEntityTypes,
    publishedAt: pack.publishedAt?.toISOString() ?? null,
    deprecatedAt: pack.deprecatedAt?.toISOString() ?? null,
    taxPacks: pack.taxPacks.map((taxPack) => ({
      id: taxPack.id,
      version: taxPack.version,
      name: taxPack.name,
      rates: taxPack.rates,
      registrationFields: taxPack.registrationFields,
      exemptions: taxPack.exemptions,
      reportingMappings: taxPack.reportingMappings,
      notes: taxPack.notes,
    })),
  };
}

/**
 * Mutations for the versioned `CountryPack` entity: draft creation, draft edits, publishing,
 * deprecating, and draft deletion. Only a platform administrator reaches these through HTTP
 * (`PlatformGuard`, superadmin); the seed path in `CountryPackStore` deliberately cannot do any of this
 * beyond upserting its own catalog rows, so seeding can never publish a new tier or resurrect a
 * deprecated pack.
 *
 * Status transitions are one-way and narrow: DRAFT -> PUBLISHED -> DEPRECATED. A deprecated pack
 * is never edited or re-published -- the fix is a new version, which is what versioning is for.
 */
@Injectable()
export class CountryPackAdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every version, each with how many organizations are pinned to it and whether it is the version
   * a new organization receives (`CountryPackStore.resolve`: the latest published of its code).
   */
  async listAll() {
    const [packs, pins] = await Promise.all([
      this.prisma.countryPack.findMany({
        orderBy: [{ code: 'asc' }, { version: 'desc' }],
        include: countryPackWithTaxPacks,
      }),
      this.prisma.organizationPreference.groupBy({
        by: ['countryPackCode', 'countryPackVersion'],
        _count: { _all: true },
      }),
    ]);
    const pinned = new Map(
      pins.map((row) => [`${row.countryPackCode}\u0000${row.countryPackVersion}`, row._count._all]),
    );
    const current = new Map<string, CountryPackWithTaxPacks>();
    for (const pack of packs) {
      if (pack.status !== 'PUBLISHED' || !pack.publishedAt) continue;
      const held = current.get(pack.code);
      if (!held || (held.publishedAt && pack.publishedAt > held.publishedAt)) {
        current.set(pack.code, pack);
      }
    }
    return packs.map((pack) => ({
      ...pack,
      pinnedOrganizations: pinned.get(`${pack.code}\u0000${pack.version}`) ?? 0,
      current: current.get(pack.code)?.id === pack.id,
    }));
  }

  /** One version with its usage and the audit trail of the version and its tax definitions. */
  async getVersion(code: string, version: string) {
    const all = await this.listAll();
    const pack = all.find(
      (candidate) => candidate.code === code.toUpperCase() && candidate.version === version,
    );
    if (!pack) throw new NotFoundException('Country pack version not found.');
    const history = await this.prisma.platformAuditEvent.findMany({
      where: {
        targetType: { in: ['country_pack', 'tax_pack'] },
        targetId: { in: [pack.id, ...pack.taxPacks.map((taxPack) => taxPack.id)] },
      },
      orderBy: { occurredAt: 'desc' },
      take: 100,
      select: {
        id: true,
        eventKey: true,
        reason: true,
        occurredAt: true,
        actor: { select: { displayName: true, email: true } },
      },
    });
    return {
      ...pack,
      versions: all
        .filter((candidate) => candidate.code === pack.code)
        .map((candidate) => ({
          id: candidate.id,
          version: candidate.version,
          status: candidate.status,
          current: candidate.current,
          publishedAt: candidate.publishedAt,
          pinnedOrganizations: candidate.pinnedOrganizations,
        })),
      history: history.map((event) => ({
        id: event.id,
        eventKey: event.eventKey,
        reason: event.reason,
        occurredAt: event.occurredAt,
        actor: event.actor.displayName || event.actor.email,
      })),
    };
  }

  async createDraft(
    actor: PlatformContext,
    input: CreateCountryPackDto,
    ipHash: string | null,
  ): Promise<CountryPackWithTaxPacks> {
    assertPackDefaultsShape(input.defaults);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.countryPack.findUnique({
          where: { code_version: { code: input.code, version: input.version } },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException('A country pack with that code and version already exists.');
        }
        const created = await tx.countryPack.create({
          data: {
            code: input.code,
            version: input.version,
            countryCode: input.countryCode,
            name: input.name,
            tier: input.tier,
            status: 'DRAFT',
            defaults: input.defaults,
            notes: input.notes ?? [],
            supportedEntityTypes: input.supportedEntityTypes ?? [],
            taxPacks: input.taxPack ? { create: taxPackData(input.taxPack) } : undefined,
          },
          include: countryPackWithTaxPacks,
        });
        await writePlatformAudit(tx, actor, {
          eventKey: 'platform.country_pack_created',
          targetType: 'country_pack',
          targetId: created.id,
          after: auditSnapshot(created),
          ipHash,
        });
        return created;
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A country pack with that code and version already exists.');
      }
      throw error;
    }
  }

  async updateDraft(
    actor: PlatformContext,
    code: string,
    version: string,
    input: UpdateCountryPackDto,
    ipHash: string | null,
  ): Promise<CountryPackWithTaxPacks> {
    if (input.defaults) assertPackDefaultsShape(input.defaults);
    return this.prisma.$transaction(async (tx) => {
      const pack = await this.findOrThrow(tx, code, version);
      if (pack.status !== 'DRAFT') {
        throw new ConflictException(
          'Only draft packs can be edited; publish a new version to change a live pack.',
        );
      }
      const updated = await tx.countryPack.update({
        where: { id: pack.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.tier !== undefined ? { tier: input.tier } : {}),
          ...(input.defaults !== undefined ? { defaults: input.defaults } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.supportedEntityTypes !== undefined
            ? { supportedEntityTypes: input.supportedEntityTypes }
            : {}),
          ...(input.taxPack
            ? {
                taxPacks: {
                  upsert: {
                    where: {
                      countryPackId_version: {
                        countryPackId: pack.id,
                        version: input.taxPack.version,
                      },
                    },
                    create: taxPackData(input.taxPack),
                    update: taxPackData(input.taxPack),
                  },
                },
              }
            : {}),
        },
        include: countryPackWithTaxPacks,
      });
      await writePlatformAudit(tx, actor, {
        eventKey: input.taxPack
          ? 'platform.country_pack_tax_definition_upserted'
          : 'platform.country_pack_updated',
        targetType: input.taxPack ? 'tax_pack' : 'country_pack',
        targetId: input.taxPack
          ? (updated.taxPacks.find((taxPack) => taxPack.version === input.taxPack?.version)?.id ??
            pack.id)
          : pack.id,
        before: auditSnapshot(pack),
        after: auditSnapshot(updated),
        ipHash,
      });
      return updated;
    });
  }

  async publish(
    actor: PlatformContext,
    code: string,
    version: string,
    reason: string,
    ipHash: string | null,
  ): Promise<CountryPackWithTaxPacks> {
    return this.prisma.$transaction(async (tx) => {
      const pack = await this.findOrThrow(tx, code, version);
      if (pack.status !== 'DRAFT') {
        throw new ConflictException('Only draft packs can be published.');
      }
      const published = await tx.countryPack.update({
        where: { id: pack.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), deprecatedAt: null },
        include: countryPackWithTaxPacks,
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.country_pack_published',
        targetType: 'country_pack',
        targetId: pack.id,
        reason,
        before: auditSnapshot(pack),
        after: auditSnapshot(published),
        ipHash,
      });
      return published;
    });
  }

  async deprecate(
    actor: PlatformContext,
    code: string,
    version: string,
    reason: string,
    ipHash: string | null,
  ): Promise<CountryPackWithTaxPacks> {
    return this.prisma.$transaction(async (tx) => {
      const pack = await this.findOrThrow(tx, code, version);
      if (pack.status !== 'PUBLISHED') {
        throw new ConflictException('Only published packs can be deprecated.');
      }
      const deprecated = await tx.countryPack.update({
        where: { id: pack.id },
        data: { status: 'DEPRECATED', deprecatedAt: new Date() },
        include: countryPackWithTaxPacks,
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.country_pack_deprecated',
        targetType: 'country_pack',
        targetId: pack.id,
        reason,
        before: auditSnapshot(pack),
        after: auditSnapshot(deprecated),
        ipHash,
      });
      return deprecated;
    });
  }

  async deleteDraft(
    actor: PlatformContext,
    code: string,
    version: string,
    reason: string,
    ipHash: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const pack = await this.findOrThrow(tx, code, version);
      if (pack.status !== 'DRAFT') {
        throw new ConflictException(
          'Only draft packs can be deleted; deprecate a published pack instead.',
        );
      }
      await tx.countryPack.delete({ where: { id: pack.id } });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.country_pack_deleted',
        targetType: 'country_pack',
        targetId: pack.id,
        reason,
        before: auditSnapshot(pack),
        ipHash,
      });
    });
  }

  private async findOrThrow(
    tx: Prisma.TransactionClient,
    code: string,
    version: string,
  ): Promise<CountryPackWithTaxPacks> {
    const pack = await tx.countryPack.findUnique({
      where: { code_version: { code: code.toUpperCase(), version } },
      include: countryPackWithTaxPacks,
    });
    if (!pack) throw new NotFoundException('Country pack version not found.');
    return pack;
  }
}
