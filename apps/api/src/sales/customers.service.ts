import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type CollaborationTargetType, type Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type {
  ContactAddressDto,
  ContactTaxIdDto,
  CreateContactDto,
  UpdateContactDto,
} from './customers.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, status?: 'ACTIVE' | 'INACTIVE') {
    const contacts = await this.prisma.contact.findMany({
      where: { organizationId, type: 'CUSTOMER', ...(status ? { status } : {}) },
      orderBy: [{ displayName: 'asc' }],
      include: { addresses: true, taxIds: true },
    });
    return contacts.map(summarize);
  }

  async detail(organizationId: string, contactId: string) {
    const contact = await this.findOrThrow(organizationId, contactId);
    return summarize(contact);
  }

  async create(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateContactDto,
    metadata: RequestMetadata,
  ) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: context.id },
      select: { baseCurrency: true },
    });
    const currency = input.currency ?? organization.baseCurrency;
    this.assertCurrencyAllowed(context, currency, organization.baseCurrency);

    const existing = await this.prisma.contact.findUnique({
      where: {
        organizationId_displayName: { organizationId: context.id, displayName: input.displayName },
      },
    });
    if (existing) throw new ConflictException('A customer with this name already exists.');

    const created = await this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.create({
        data: {
          organizationId: context.id,
          type: 'CUSTOMER',
          displayName: input.displayName,
          legalName: input.legalName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          currency,
          paymentTermsDays: input.paymentTermsDays ?? null,
          receivableAccountId: input.receivableAccountId ?? null,
          tags: input.tags ?? [],
          addresses: { create: (input.addresses ?? []).map((a) => addressData(a, context.id)) },
          taxIds: { create: (input.taxIds ?? []).map((t) => taxIdData(t, context.id)) },
        },
        include: { addresses: true, taxIds: true },
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'customers.created',
        entityType: 'contact',
        entityId: contact.id,
        action: AuditAction.CREATE,
        after: { displayName: contact.displayName, currency: contact.currency },
        ipHash: metadata.ipHash,
      });

      return contact;
    });

    return summarize(created);
  }

  async update(
    context: OrganizationContext,
    user: PublicUser,
    contactId: string,
    input: UpdateContactDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, contactId);
    if (existing.status === 'INACTIVE') {
      throw new ConflictException('Deactivated customers cannot be edited.');
    }

    let nextCurrency = existing.currency;
    if (input.currency && input.currency !== existing.currency) {
      const organization = await this.prisma.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { baseCurrency: true },
      });
      this.assertCurrencyAllowed(context, input.currency, organization.baseCurrency);
      nextCurrency = input.currency;
    }

    if (input.displayName && input.displayName !== existing.displayName) {
      const clash = await this.prisma.contact.findUnique({
        where: {
          organizationId_displayName: {
            organizationId: context.id,
            displayName: input.displayName,
          },
        },
      });
      if (clash) throw new ConflictException('A customer with this name already exists.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.addresses) {
        await tx.contactAddress.deleteMany({ where: { contactId } });
      }
      if (input.taxIds) {
        await tx.contactTaxId.deleteMany({ where: { contactId } });
      }

      const contact = await tx.contact.update({
        where: { id: contactId },
        data: {
          displayName: input.displayName ?? existing.displayName,
          legalName: input.legalName ?? existing.legalName,
          email: input.email ?? existing.email,
          phone: input.phone ?? existing.phone,
          currency: nextCurrency,
          paymentTermsDays: input.paymentTermsDays ?? existing.paymentTermsDays,
          receivableAccountId: input.receivableAccountId ?? existing.receivableAccountId,
          tags: input.tags ?? existing.tags,
          ...(input.addresses
            ? { addresses: { create: input.addresses.map((a) => addressData(a, context.id)) } }
            : {}),
          ...(input.taxIds
            ? { taxIds: { create: input.taxIds.map((t) => taxIdData(t, context.id)) } }
            : {}),
        },
        include: { addresses: true, taxIds: true },
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'customers.updated',
        entityType: 'contact',
        entityId: contact.id,
        action: AuditAction.UPDATE,
        before: { displayName: existing.displayName, currency: existing.currency },
        after: { displayName: contact.displayName, currency: contact.currency },
        ipHash: metadata.ipHash,
      });

      return contact;
    });

    return summarize(updated);
  }

  async setStatus(
    context: OrganizationContext,
    user: PublicUser,
    contactId: string,
    status: 'ACTIVE' | 'INACTIVE',
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, contactId);
    if (existing.status === status) return summarize(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.update({
        where: { id: contactId },
        data: { status },
        include: { addresses: true, taxIds: true },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: status === 'ACTIVE' ? 'customers.reactivated' : 'customers.deactivated',
        entityType: 'contact',
        entityId: contactId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status },
        ipHash: metadata.ipHash,
      });
      return contact;
    });

    return summarize(updated);
  }

  /**
   * Everything the customer workspace shows across its tabs, one round trip per tab.
   *
   * These are read models for one screen, not general list endpoints: each returns only the columns
   * the tab renders, ordered newest first, and capped, so opening a customer with years of history
   * cannot pull their whole ledger into the browser.
   */
  async transactions(organizationId: string, contactId: string) {
    await this.findOrThrow(organizationId, contactId);
    const scope = { organizationId, contactId } as const;
    const [invoices, quotes, salesOrders, creditNotes, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: scope,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          issueDate: true,
          dueDate: true,
          currency: true,
          totalMinor: true,
          balanceMinor: true,
        },
      }),
      this.prisma.quote.findMany({
        where: scope,
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        select: {
          id: true,
          quoteNumber: true,
          status: true,
          issueDate: true,
          currency: true,
          totalMinor: true,
        },
      }),
      this.prisma.salesOrder.findMany({
        where: scope,
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          issueDate: true,
          currency: true,
          totalMinor: true,
        },
      }),
      this.prisma.creditNote.findMany({
        where: scope,
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        select: {
          id: true,
          creditNoteNumber: true,
          status: true,
          issueDate: true,
          currency: true,
          totalMinor: true,
          remainingMinor: true,
        },
      }),
      this.prisma.paymentReceived.findMany({
        where: scope,
        orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
        take: 50,
        select: {
          id: true,
          paymentNumber: true,
          status: true,
          receivedDate: true,
          currency: true,
          amountMinor: true,
          unappliedMinor: true,
          paymentMode: true,
          reference: true,
        },
      }),
    ]);

    return {
      invoices: invoices.map((row) => ({
        id: row.id,
        number: row.invoiceNumber,
        status: row.status,
        date: row.issueDate ? dateOnly(row.issueDate) : null,
        dueDate: row.dueDate ? dateOnly(row.dueDate) : null,
        currency: row.currency,
        totalMinor: row.totalMinor.toString(),
        balanceMinor: row.balanceMinor.toString(),
      })),
      quotes: quotes.map((row) => ({
        id: row.id,
        number: row.quoteNumber,
        status: row.status,
        date: row.issueDate ? dateOnly(row.issueDate) : null,
        currency: row.currency,
        totalMinor: row.totalMinor.toString(),
      })),
      salesOrders: salesOrders.map((row) => ({
        id: row.id,
        number: row.orderNumber,
        status: row.status,
        date: row.issueDate ? dateOnly(row.issueDate) : null,
        currency: row.currency,
        totalMinor: row.totalMinor.toString(),
      })),
      creditNotes: creditNotes.map((row) => ({
        id: row.id,
        number: row.creditNoteNumber,
        status: row.status,
        date: row.issueDate ? dateOnly(row.issueDate) : null,
        currency: row.currency,
        totalMinor: row.totalMinor.toString(),
        remainingMinor: row.remainingMinor.toString(),
      })),
      payments: payments.map((row) => ({
        id: row.id,
        number: row.paymentNumber,
        status: row.status,
        date: dateOnly(row.receivedDate),
        currency: row.currency,
        amountMinor: row.amountMinor.toString(),
        unappliedMinor: row.unappliedMinor.toString(),
        paymentMode: row.paymentMode,
        reference: row.reference,
      })),
    };
  }

  /**
   * Receivables position, aged. Buckets come from `dueDate` against today and count only open
   * invoices; an invoice with no due date is treated as current rather than dropped, so the buckets
   * always sum back to the outstanding total.
   */
  async summary(organizationId: string, contactId: string) {
    const contact = await this.findOrThrow(organizationId, contactId);
    const [openInvoices, credits, unappliedPayments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          contactId,
          status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
          balanceMinor: { gt: 0n },
        },
        select: { dueDate: true, balanceMinor: true },
      }),
      this.prisma.creditNote.aggregate({
        where: { organizationId, contactId, remainingMinor: { gt: 0n } },
        _sum: { remainingMinor: true },
      }),
      this.prisma.paymentReceived.aggregate({
        where: { organizationId, contactId, unappliedMinor: { gt: 0n } },
        _sum: { unappliedMinor: true },
      }),
    ]);

    const today = startOfUtcDay(new Date());
    const buckets = { current: 0n, days1To30: 0n, days31To60: 0n, days61To90: 0n, days90Plus: 0n };
    let outstandingMinor = 0n;
    for (const invoice of openInvoices) {
      outstandingMinor += invoice.balanceMinor;
      const overdueDays = invoice.dueDate
        ? Math.floor((today.getTime() - startOfUtcDay(invoice.dueDate).getTime()) / 86_400_000)
        : 0;
      if (overdueDays <= 0) buckets.current += invoice.balanceMinor;
      else if (overdueDays <= 30) buckets.days1To30 += invoice.balanceMinor;
      else if (overdueDays <= 60) buckets.days31To60 += invoice.balanceMinor;
      else if (overdueDays <= 90) buckets.days61To90 += invoice.balanceMinor;
      else buckets.days90Plus += invoice.balanceMinor;
    }

    return {
      currency: contact.currency,
      outstandingMinor: outstandingMinor.toString(),
      openInvoiceCount: openInvoices.length,
      unusedCreditsMinor: (credits._sum.remainingMinor ?? 0n).toString(),
      unappliedPaymentsMinor: (unappliedPayments._sum.unappliedMinor ?? 0n).toString(),
      aging: {
        current: buckets.current.toString(),
        days1To30: buckets.days1To30.toString(),
        days31To60: buckets.days31To60.toString(),
        days61To90: buckets.days61To90.toString(),
        days90Plus: buckets.days90Plus.toString(),
      },
    };
  }

  /**
   * The customer's activity timeline. Activity rows are written per target, so a customer's story
   * is spread across their documents; this gathers the contact's own rows together with those of
   * every document belonging to them, then merges by time.
   */
  async activity(organizationId: string, contactId: string, limit = 60) {
    await this.findOrThrow(organizationId, contactId);
    const scope = { organizationId, contactId } as const;
    const idOnly = { select: { id: true } } as const;
    const [invoices, quotes, salesOrders, creditNotes, payments] = await Promise.all([
      this.prisma.invoice.findMany({ where: scope, ...idOnly }),
      this.prisma.quote.findMany({ where: scope, ...idOnly }),
      this.prisma.salesOrder.findMany({ where: scope, ...idOnly }),
      this.prisma.creditNote.findMany({ where: scope, ...idOnly }),
      this.prisma.paymentReceived.findMany({ where: scope, ...idOnly }),
    ]);

    const targets: { targetType: CollaborationTargetType; targetId: { in: string[] } }[] = (
      [
        { targetType: 'CONTACT', targetId: { in: [contactId] } },
        { targetType: 'INVOICE', targetId: { in: invoices.map((row) => row.id) } },
        { targetType: 'QUOTE', targetId: { in: quotes.map((row) => row.id) } },
        { targetType: 'SALES_ORDER', targetId: { in: salesOrders.map((row) => row.id) } },
        { targetType: 'CREDIT_NOTE', targetId: { in: creditNotes.map((row) => row.id) } },
        { targetType: 'PAYMENT_RECEIVED', targetId: { in: payments.map((row) => row.id) } },
      ] satisfies { targetType: CollaborationTargetType; targetId: { in: string[] } }[]
    ).filter((target) => target.targetId.in.length > 0);

    const rows = await this.prisma.activity.findMany({
      where: { organizationId, visibility: 'INTERNAL', OR: targets },
      orderBy: [{ occurredAt: 'desc' }],
      take: limit,
      include: { actor: { select: { displayName: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      kind: row.kind,
      eventKey: row.eventKey,
      actorName: row.actor?.displayName ?? null,
      occurredAt: row.occurredAt.toISOString(),
    }));
  }

  /** Outbound document emails sent to this customer, newest first. */
  async mails(organizationId: string, contactId: string, limit = 60) {
    await this.findOrThrow(organizationId, contactId);
    const rows = await this.prisma.documentSendLog.findMany({
      where: { organizationId, contactId },
      orderBy: [{ sentAt: 'desc' }],
      take: limit,
      include: { sentBy: { select: { displayName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      documentNumber: row.documentNumber,
      recipientEmail: row.recipientEmail,
      subject: row.subject,
      sentByName: row.sentBy?.displayName ?? null,
      sentAt: row.sentAt.toISOString(),
    }));
  }

  private async findOrThrow(organizationId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId, type: 'CUSTOMER' },
      include: { addresses: true, taxIds: true },
    });
    if (!contact) throw new NotFoundException('Customer not found.');
    return contact;
  }

  private assertCurrencyAllowed(
    context: OrganizationContext,
    currency: string,
    baseCurrency: string,
  ): void {
    if (currency === baseCurrency) return;
    if (!context.permissions.has('customers.currency_override')) {
      throw new ForbiddenException(
        "Only members with currency-override permission can set a customer's currency to something other than the organization's base currency.",
      );
    }
  }
}

function addressData(input: ContactAddressDto, organizationId: string) {
  return {
    organizationId,
    kind: input.kind,
    line1: input.line1,
    line2: input.line2 ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
    postalCode: input.postalCode ?? null,
    countryCode: input.countryCode,
    isDefault: input.isDefault ?? false,
  };
}

function taxIdData(input: ContactTaxIdDto, organizationId: string) {
  return {
    organizationId,
    label: input.label,
    value: input.value,
    countryCode: input.countryCode ?? null,
  };
}

type ContactWithDetails = Prisma.ContactGetPayload<{
  include: { addresses: true; taxIds: true };
}>;

function summarize(contact: ContactWithDetails) {
  return {
    id: contact.id,
    type: contact.type,
    displayName: contact.displayName,
    legalName: contact.legalName,
    email: contact.email,
    phone: contact.phone,
    currency: contact.currency,
    paymentTermsDays: contact.paymentTermsDays,
    receivableAccountId: contact.receivableAccountId,
    status: contact.status,
    tags: contact.tags,
    addresses: contact.addresses,
    taxIds: contact.taxIds,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

/** Date-only ISO string, matching how every other sales read model renders a date column. */
function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC, so aging compares whole days rather than partial ones. */
function startOfUtcDay(date: Date): Date {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
