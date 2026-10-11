import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { type UploadedFileLike, validateAttachment } from '../attachments/attachments.service.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { CreateVendorDto } from '../purchases/vendors.dto.js';
import { parseCsv } from '../banking/csv.js';
import { CreateItemDto } from '../sales/catalog.dto.js';
import { CreateContactDto } from '../sales/customers.dto.js';

export const MAX_MASTER_DATA_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_MASTER_DATA_IMPORT_ROWS = 10_000;
export type MasterDataKind = 'customers' | 'vendors' | 'items';
type ImportAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'IMPORT_ANYWAY';

export interface MasterDataImportResult {
  kind: MasterDataKind;
  dryRun: boolean;
  totalRows: number;
  createCount: number;
  updateCount: number;
  skipCount: number;
  invalidCount: number;
  rows: Array<{
    rowNumber: number;
    action: ImportAction | 'INVALID';
    errors: string[];
    match?: { id: string; displayName: string; matchedOn: string };
  }>;
}

@Injectable()
export class MasterDataImportService {
  constructor(private readonly prisma: PrismaService) {}

  async run(
    kind: MasterDataKind,
    context: OrganizationContext,
    user: PublicUser,
    file: UploadedFileLike,
    rawMapping: string | undefined,
    rawActions: string | undefined,
    dryRun: boolean,
    idempotencyKey: string | undefined,
    metadata: RequestMetadata,
  ): Promise<MasterDataImportResult> {
    this.assertFile(file);
    const { header, rows } = this.read(file);
    const mapping = jsonObject(rawMapping, 'mapping');
    const actions = jsonObject(rawActions, 'actions');
    const preview = await this.preview(kind, context.id, header, rows, mapping, actions);
    if (dryRun) return preview;
    const commitResult = { ...preview, dryRun: false };
    if (!idempotencyKey?.trim())
      throw new BadRequestException('An Idempotency-Key header is required.');

    return this.prisma.$transaction(
      async (tx) => {
        const operation = `${kind.slice(0, -1).toUpperCase()}_IMPORT`;
        const previous = await tx.ledgerIdempotencyKey.findUnique({
          where: {
            organizationId_operation_key: {
              organizationId: context.id,
              operation,
              key: idempotencyKey,
            },
          },
        });
        if (previous) {
          const audit = await tx.auditEvent.findFirst({
            where: { id: previous.resourceId, organizationId: context.id },
          });
          if (!audit) throw new ConflictException('The prior import result is unavailable.');
          return audit.after as unknown as MasterDataImportResult;
        }

        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: context.id },
          select: { baseCurrency: true },
        });

        for (const row of commitResult.rows) {
          if (row.action === 'INVALID' || row.action === 'SKIP') continue;
          const payload = rowPayload(header, rows[row.rowNumber - 2]!, mapping);
          assertImportCurrency(context, kind, payload, organization.baseCurrency);
          if (kind === 'customers')
            await this.writeCustomer(tx, context.id, payload, row, organization.baseCurrency);
          if (kind === 'vendors')
            await this.writeVendor(tx, context.id, payload, organization.baseCurrency);
          if (kind === 'items') await this.writeItem(tx, context.id, payload, row);
        }
        const audit = await writeAuditEvent(tx, {
          organizationId: context.id,
          actorUserId: user.id,
          eventKey: `master_data.${kind}_imported`,
          entityType: 'master_data_import',
          entityId: context.id,
          action: AuditAction.CREATE,
          after: commitResult as unknown as Prisma.InputJsonValue,
          ipHash: metadata.ipHash,
        });
        await tx.ledgerIdempotencyKey.create({
          data: {
            organizationId: context.id,
            operation,
            key: idempotencyKey,
            resourceType: 'MASTER_DATA_IMPORT',
            resourceId: audit.id,
          },
        });
        return commitResult;
      },
      { timeout: 60_000 },
    );
  }

  private assertFile(file: UploadedFileLike) {
    if (!file) throw new BadRequestException('A CSV file is required.');
    if (file.size > MAX_MASTER_DATA_IMPORT_BYTES)
      throw new BadRequestException('An import file is limited to 8MB.');
    validateAttachment(file);
    if (!file.originalname.toLowerCase().endsWith('.csv'))
      throw new BadRequestException('Only CSV files can be imported.');
  }

  private read(file: UploadedFileLike) {
    const table = parseCsv(file.buffer.toString('utf8'));
    if (table.length < 2)
      throw new BadRequestException('The file must include a header and at least one row.');
    if (table.length - 1 > MAX_MASTER_DATA_IMPORT_ROWS)
      throw new BadRequestException(
        `A single import is limited to ${MAX_MASTER_DATA_IMPORT_ROWS} rows.`,
      );
    return { header: table[0]!.map((cell) => cell.trim()), rows: table.slice(1) };
  }

  private async preview(
    kind: MasterDataKind,
    organizationId: string,
    header: string[],
    rows: string[][],
    mapping: Record<string, unknown>,
    actions: Record<string, unknown>,
  ): Promise<MasterDataImportResult> {
    const outcomes: MasterDataImportResult['rows'] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const payload = rowPayload(header, rows[index]!, mapping);
      const errors = await dtoErrors(kind, payload);
      if (errors.length === 0)
        errors.push(...(await referenceErrors(this.prisma, kind, organizationId, payload)));
      const match = errors.length ? undefined : await this.match(kind, organizationId, payload);
      if (match?.matchedOn === 'conflicting name/email matches') {
        errors.push(
          'The name and email match different customers; resolve the conflict before importing.',
        );
      }
      let action: ImportAction | 'INVALID' = errors.length ? 'INVALID' : match ? 'SKIP' : 'CREATE';
      const selected = actions[String(index + 2)];
      if (
        typeof selected === 'string' &&
        ['CREATE', 'UPDATE', 'SKIP', 'IMPORT_ANYWAY'].includes(selected)
      )
        action = selected as ImportAction;
      if (kind === 'vendors' && action === 'UPDATE') {
        errors.push('Vendors with a near-duplicate match cannot be updated by import.');
        action = 'INVALID';
      }
      if (kind !== 'vendors' && action === 'IMPORT_ANYWAY') {
        errors.push('Only vendors support importing despite a duplicate warning.');
        action = 'INVALID';
      }
      if (match && kind !== 'vendors' && action === 'CREATE') {
        errors.push('A matching record already exists; choose update or skip.');
        action = 'INVALID';
      }
      outcomes.push({ rowNumber: index + 2, action, errors, ...(match ? { match } : {}) });
    }
    return summarize(kind, true, outcomes);
  }

  private async match(
    kind: MasterDataKind,
    organizationId: string,
    payload: Record<string, unknown>,
  ) {
    if (kind === 'customers') {
      const name = string(payload.displayName);
      const email = string(payload.email)?.toLowerCase();
      const matches = await this.prisma.contact.findMany({
        where: {
          organizationId,
          type: 'CUSTOMER',
          OR: [
            { displayName: name },
            ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
          ],
        },
        take: 2,
      });
      if (matches.length > 1)
        return { id: '', displayName: '', matchedOn: 'conflicting name/email matches' };
      return matches[0]
        ? {
            id: matches[0].id,
            displayName: matches[0].displayName,
            matchedOn: matches[0].email?.toLowerCase() === email ? 'email' : 'name',
          }
        : undefined;
    }
    if (kind === 'items') {
      const sku = string(payload.sku);
      if (!sku) return undefined;
      const item = await this.prisma.item.findFirst({
        where: { organizationId, sku: { equals: sku, mode: 'insensitive' } },
      });
      return item ? { id: item.id, displayName: item.name, matchedOn: 'sku' } : undefined;
    }
    const name = string(payload.displayName) ?? '';
    const taxIdValues = Array.isArray(payload.taxIds)
      ? payload.taxIds
          .map((taxId) => (isObject(taxId) ? string(taxId.value)?.trim() : undefined))
          .filter((value): value is string => Boolean(value))
      : [];
    const vendor = await this.prisma.vendor.findFirst({
      where: {
        organizationId,
        status: 'ACTIVE',
        OR: [
          { displayName: { equals: name, mode: 'insensitive' } },
          ...(taxIdValues.length ? [{ taxIds: { some: { value: { in: taxIdValues } } } }] : []),
        ],
      },
    });
    return vendor
      ? {
          id: vendor.id,
          displayName: vendor.displayName,
          matchedOn:
            vendor.displayName.toLowerCase() === name.toLowerCase() ? 'displayName' : 'taxId',
        }
      : undefined;
  }

  private async writeCustomer(
    tx: Prisma.TransactionClient,
    organizationId: string,
    payload: Record<string, unknown>,
    row: MasterDataImportResult['rows'][number],
    baseCurrency: string,
  ) {
    const input = payload as unknown as CreateContactDto;
    if (row.action === 'UPDATE' && row.match?.id) {
      if (input.addresses)
        await tx.contactAddress.deleteMany({ where: { contactId: row.match.id } });
      if (input.taxIds) await tx.contactTaxId.deleteMany({ where: { contactId: row.match.id } });
      await tx.contact.update({
        where: { id: row.match.id },
        data: customerPatchData(input, organizationId),
      });
      return;
    }
    await tx.contact.create({
      data: {
        ...customerData(input, organizationId, baseCurrency),
        organizationId,
        type: 'CUSTOMER',
      },
    });
  }
  private async writeVendor(
    tx: Prisma.TransactionClient,
    organizationId: string,
    payload: Record<string, unknown>,
    baseCurrency: string,
  ) {
    const input = payload as unknown as CreateVendorDto;
    await tx.vendor.create({
      data: { ...vendorData(input, organizationId, baseCurrency), organizationId },
    });
  }
  private async writeItem(
    tx: Prisma.TransactionClient,
    organizationId: string,
    payload: Record<string, unknown>,
    row: MasterDataImportResult['rows'][number],
  ) {
    const input = payload as unknown as CreateItemDto;
    if (row.action === 'UPDATE' && row.match?.id) {
      if (input.prices) await tx.itemPrice.deleteMany({ where: { itemId: row.match.id } });
      await tx.item.update({
        where: { id: row.match.id },
        data: itemPatchData(input, organizationId),
      });
      return;
    }
    await tx.item.create({ data: { ...itemData(input, organizationId), organizationId } });
  }
}

function jsonObject(value: string | undefined, name: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new BadRequestException(`${name} must be a JSON object.`);
  }
}
function rowPayload(header: string[], row: string[], mapping: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [field, source] of Object.entries(mapping)) {
    if (typeof source !== 'string') continue;
    const value = row[header.indexOf(source)]?.trim();
    if (!value) continue;
    result[field] = ['addresses', 'taxIds', 'prices'].includes(field)
      ? parseJson(value)
      : coerce(field, value);
  }
  return result;
}
function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function coerce(field: string, value: string): unknown {
  if (['paymentTermsDays'].includes(field)) return Number(value);
  if (
    ['salesEnabled', 'purchaseEnabled', 'inventoryTracked', 'freeDescriptionAllowed'].includes(
      field,
    )
  )
    return value.toLowerCase() === 'true';
  if (field === 'tags')
    return value
      .split('|')
      .map((tag) => tag.trim())
      .filter(Boolean);
  return value;
}
async function dtoErrors(kind: MasterDataKind, payload: Record<string, unknown>) {
  const instance =
    kind === 'customers'
      ? plainToInstance(CreateContactDto, payload)
      : kind === 'vendors'
        ? plainToInstance(CreateVendorDto, payload)
        : plainToInstance(CreateItemDto, payload);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}
async function referenceErrors(
  prisma: PrismaService,
  kind: MasterDataKind,
  organizationId: string,
  payload: Record<string, unknown>,
) {
  const references: Array<[string, 'ledgerAccount' | 'category' | 'unit' | 'taxCode' | 'vendor']> =
    kind === 'customers'
      ? [['receivableAccountId', 'ledgerAccount']]
      : kind === 'vendors'
        ? [['payableAccountId', 'ledgerAccount']]
        : [
            ['categoryId', 'category'],
            ['defaultUnitId', 'unit'],
            ['revenueAccountId', 'ledgerAccount'],
            ['purchaseAccountId', 'ledgerAccount'],
            ['defaultTaxCodeId', 'taxCode'],
            ['defaultPurchaseTaxCodeId', 'taxCode'],
            ['preferredVendorId', 'vendor'],
          ];
  const errors: string[] = [];
  for (const [field, model] of references) {
    const id = string(payload[field]);
    if (!id) continue;
    const found =
      model === 'ledgerAccount'
        ? await prisma.ledgerAccount.findFirst({ where: { id, organizationId } })
        : model === 'category'
          ? await prisma.category.findFirst({ where: { id, organizationId } })
          : model === 'unit'
            ? await prisma.unit.findFirst({ where: { id, organizationId } })
            : model === 'taxCode'
              ? await prisma.taxCode.findFirst({ where: { id, organizationId } })
              : await prisma.vendor.findFirst({ where: { id, organizationId } });
    if (!found) errors.push(`${field} must refer to a record in this organization.`);
  }
  return errors;
}
function summarize(
  kind: MasterDataKind,
  dryRun: boolean,
  rows: MasterDataImportResult['rows'],
): MasterDataImportResult {
  return {
    kind,
    dryRun,
    totalRows: rows.length,
    createCount: rows.filter((row) => row.action === 'CREATE' || row.action === 'IMPORT_ANYWAY')
      .length,
    updateCount: rows.filter((row) => row.action === 'UPDATE').length,
    skipCount: rows.filter((row) => row.action === 'SKIP').length,
    invalidCount: rows.filter((row) => row.action === 'INVALID').length,
    rows,
  };
}
function string(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function assertImportCurrency(
  context: OrganizationContext,
  kind: MasterDataKind,
  payload: Record<string, unknown>,
  baseCurrency: string,
) {
  const currency = string(payload.currency);
  if (!currency || currency === baseCurrency) return;
  const permission =
    kind === 'customers' ? 'customers.currency_override' : 'vendors.currency_override';
  if (!context.permissions.has(permission))
    throw new BadRequestException(
      `Only members with currency-override permission can import a ${kind.slice(0, -1)} in another currency.`,
    );
}
function customerData(input: CreateContactDto, organizationId: string, baseCurrency: string) {
  return {
    displayName: input.displayName,
    legalName: input.legalName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    currency: input.currency ?? baseCurrency,
    paymentTermsDays: input.paymentTermsDays ?? null,
    receivableAccountId: input.receivableAccountId ?? null,
    tags: input.tags ?? [],
    addresses: { create: (input.addresses ?? []).map((a) => ({ ...a, organizationId })) },
    taxIds: { create: (input.taxIds ?? []).map((t) => ({ ...t, organizationId })) },
  };
}
function customerPatchData(input: CreateContactDto, organizationId: string) {
  return {
    ...('displayName' in input ? { displayName: input.displayName } : {}),
    ...('legalName' in input ? { legalName: input.legalName ?? null } : {}),
    ...('email' in input ? { email: input.email ?? null } : {}),
    ...('phone' in input ? { phone: input.phone ?? null } : {}),
    ...('currency' in input ? { currency: input.currency } : {}),
    ...('paymentTermsDays' in input ? { paymentTermsDays: input.paymentTermsDays ?? null } : {}),
    ...('receivableAccountId' in input
      ? { receivableAccountId: input.receivableAccountId ?? null }
      : {}),
    ...('tags' in input ? { tags: input.tags ?? [] } : {}),
    ...(input.addresses
      ? { addresses: { create: input.addresses.map((a) => ({ ...a, organizationId })) } }
      : {}),
    ...(input.taxIds
      ? { taxIds: { create: input.taxIds.map((t) => ({ ...t, organizationId })) } }
      : {}),
  };
}
function vendorData(input: CreateVendorDto, organizationId: string, baseCurrency: string) {
  return {
    displayName: input.displayName,
    legalName: input.legalName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    currency: input.currency ?? baseCurrency,
    paymentTermsDays: input.paymentTermsDays ?? null,
    payableAccountId: input.payableAccountId ?? null,
    tags: input.tags ?? [],
    addresses: { create: (input.addresses ?? []).map((a) => ({ ...a, organizationId })) },
    taxIds: { create: (input.taxIds ?? []).map((t) => ({ ...t, organizationId })) },
  };
}
function itemData(input: CreateItemDto, organizationId: string) {
  return {
    sku: input.sku ?? null,
    name: input.name,
    itemType: input.itemType,
    imageDataUrl: input.imageDataUrl ?? null,
    salesEnabled: input.salesEnabled ?? true,
    salesDescription: input.salesDescription ?? null,
    purchaseEnabled: input.purchaseEnabled ?? false,
    purchaseDescription: input.purchaseDescription ?? null,
    categoryId: input.categoryId ?? null,
    defaultUnitId: input.defaultUnitId ?? null,
    revenueAccountId: input.revenueAccountId ?? null,
    purchaseAccountId: input.purchaseAccountId ?? null,
    defaultTaxCodeId: input.defaultTaxCodeId ?? null,
    inventoryTracked: input.inventoryTracked ?? false,
    defaultPurchaseTaxCodeId: input.defaultPurchaseTaxCodeId ?? null,
    reorderThreshold: input.reorderThreshold ?? null,
    reorderQuantity: input.reorderQuantity ?? null,
    preferredVendorId: input.preferredVendorId ?? null,
    freeDescriptionAllowed: input.freeDescriptionAllowed ?? true,
    prices: {
      create: (input.prices ?? []).map((price) => ({
        organizationId,
        priceListKey: price.priceListKey ?? 'default',
        currency: price.currency,
        unitPriceMinor: BigInt(price.unitPriceMinor),
      })),
    },
  };
}
function itemPatchData(input: CreateItemDto, organizationId: string) {
  const scalars = [
    'sku',
    'name',
    'itemType',
    'imageDataUrl',
    'salesEnabled',
    'salesDescription',
    'purchaseEnabled',
    'purchaseDescription',
    'categoryId',
    'defaultUnitId',
    'revenueAccountId',
    'purchaseAccountId',
    'defaultTaxCodeId',
    'inventoryTracked',
    'defaultPurchaseTaxCodeId',
    'reorderThreshold',
    'reorderQuantity',
    'preferredVendorId',
    'freeDescriptionAllowed',
  ] as const;
  const data: Record<string, unknown> = {};
  for (const field of scalars) {
    if (!(field in input)) continue;
    data[field] = input[field] ?? null;
  }
  if (input.prices) {
    data.prices = {
      create: input.prices.map((price) => ({
        organizationId,
        priceListKey: price.priceListKey ?? 'default',
        currency: price.currency,
        unitPriceMinor: BigInt(price.unitPriceMinor),
      })),
    };
  }
  return data;
}
