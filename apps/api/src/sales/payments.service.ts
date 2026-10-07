import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';
import { roundHalfUpDivide } from '@valuebooks/accounting-core';

import type { PublicUser } from '../auth/auth.service.js';
import { DomainEventsService } from '../automation/domain-events.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { PAYMENT_RECEIVED_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import { LedgerService } from '../organizations/ledger.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type { AllocatePaymentDto, CreatePaymentDto } from './payments.dto.js';

type PaymentWithAllocations = Prisma.PaymentReceivedGetPayload<{
  include: typeof paymentDetailInclude;
}>;

const paymentDetailInclude = {
  allocations: {
    include: { invoice: { select: { id: true, invoiceNumber: true } } },
  },
  contact: { select: { id: true, displayName: true, currency: true, receivableAccountId: true } },
  depositAccount: { select: { id: true, code: true, name: true } },
} satisfies Prisma.PaymentReceivedInclude;

const OPEN_INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID'] as const;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly numbering: DocumentNumberingService,
    private readonly events: DomainEventsService,
  ) {}

  async list(organizationId: string, status?: string) {
    const payments = await this.prisma.paymentReceived.findMany({
      where: { organizationId, ...(status ? { status: status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      include: paymentDetailInclude,
      take: 200,
    });
    return payments.map(summarizePayment);
  }

  async detail(organizationId: string, paymentId: string) {
    const payment = await this.findOrThrow(organizationId, paymentId);
    return summarizePayment(payment);
  }

  async openInvoicesFor(organizationId: string, paymentId: string) {
    const payment = await this.findOrThrow(organizationId, paymentId);
    return this.openInvoicesForCustomer(organizationId, payment.contactId);
  }

  /**
   * The customer's open invoices, without needing a payment to exist first. The record-payment
   * dialog calls this as soon as a customer is chosen so it can offer the allocation table in the
   * same step as recording.
   */
  async openInvoicesForCustomer(organizationId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId, type: 'CUSTOMER' },
      select: { id: true },
    });
    if (!contact) throw new NotFoundException('Customer not found.');
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        contactId,
        status: { in: [...OPEN_INVOICE_STATUSES] },
        balanceMinor: { gt: 0n },
      },
      orderBy: [{ issueDate: 'asc' }],
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        dueDate: true,
        currency: true,
        totalMinor: true,
        paidMinor: true,
        balanceMinor: true,
      },
    });
    return invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate ? dateOnly(invoice.issueDate) : null,
      dueDate: invoice.dueDate ? dateOnly(invoice.dueDate) : null,
      currency: invoice.currency,
      totalMinor: invoice.totalMinor.toString(),
      paidMinor: invoice.paidMinor.toString(),
      balanceMinor: invoice.balanceMinor.toString(),
    }));
  }

  /**
   * Records a customer payment and posts its deposit-account debit / AR credit journal in one step
   * -- unlike Invoice, there is no draft state (PHASE2_TODO: "post once at recording time"). The
   * `PaymentReceived` row is created *before* the journal post (rather than after, as
   * `InvoicesService#issueInvoice` does with an already-existing draft) because
   * `postJournalFromLines` needs a `sourceId`; both happen inside the same transaction, so the
   * intermediate unposted state is never observable to another connection. Idempotency is scoped to
   * this service (operation `'PAYMENT_RECEIVED_RECORD'`), mirroring `InvoicesService`'s own
   * invoice-scoped idempotency rather than reusing `LedgerService`'s private helpers.
   */
  async record(
    context: OrganizationContext,
    user: PublicUser,
    input: CreatePaymentDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
    });
    if (!contact) throw new NotFoundException('Customer not found.');
    if (contact.status !== 'ACTIVE') {
      throw new ConflictException('Cannot record a payment for a deactivated customer.');
    }
    const currency = input.currency ?? contact.currency;
    const amountMinor = BigInt(input.amountMinor);
    if (amountMinor <= 0n) {
      throw new BadRequestException('A payment amount must be greater than zero.');
    }
    const bankChargesMinor = BigInt(input.bankChargesMinor ?? '0');
    const withholdingTaxMinor = BigInt(input.withholdingTaxMinor ?? '0');
    const depositedMinor = amountMinor - bankChargesMinor - withholdingTaxMinor;
    if (depositedMinor < 0n) {
      throw new BadRequestException(
        'Bank charges and withholding tax together cannot exceed the amount received.',
      );
    }
    const receivedDate = isoDate(input.receivedDate);
    // `record` is guarded by `sales.payments.record`; applying the receipt to invoices in the same
    // request is the allocate capability, so it is checked separately rather than ridden in on the
    // weaker permission.
    if (input.allocations?.length && !context.permissions.has('sales.payments.allocate')) {
      throw new ForbiddenException('You cannot apply payments to invoices.');
    }

    const recorded = await this.prisma.$transaction(async (tx) => {
      await this.lockPaymentIdempotency(tx, context.id, 'PAYMENT_RECEIVED_RECORD', idempotencyKey);
      const existingResult = await this.findPaymentIdempotentResult(
        context.id,
        'PAYMENT_RECEIVED_RECORD',
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.paymentReceived.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: paymentDetailInclude,
        });
      }

      const depositAccount = await this.resolveDepositAccount(
        tx,
        context.id,
        input.depositAccountId,
      );
      const arAccount = contact.receivableAccountId
        ? await tx.ledgerAccount.findUniqueOrThrow({ where: { id: contact.receivableAccountId } })
        : await this.ledger.accountBySystemKey(context.id, 'accounts_receivable', tx);
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { baseCurrency: true },
      });
      const isForeignCurrency = currency !== organization.baseCurrency;

      const payment = await tx.paymentReceived.create({
        data: {
          organizationId: context.id,
          contactId: contact.id,
          status: 'UNAPPLIED',
          receivedDate,
          currency,
          amountMinor,
          allocatedMinor: 0n,
          unappliedMinor: amountMinor,
          bankChargesMinor,
          withholdingTaxMinor,
          paymentMode: input.paymentMode ?? 'BANK_TRANSFER',
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          depositAccountId: depositAccount.id,
          createdByUserId: user.id,
        },
      });

      const description = `Payment from ${contact.displayName}`;
      const line = (accountId: string, debitMinor: bigint, creditMinor: bigint) => ({
        accountId,
        debitMinor,
        creditMinor,
        foreignAmountMinor: isForeignCurrency ? debitMinor + creditMinor : undefined,
        description,
      });

      // The customer is relieved of `amountMinor`, but only `depositedMinor` reaches the bank: a
      // bank fee and tax the customer withheld at source are both settled out of the same receipt.
      const lines = [
        ...(depositedMinor > 0n ? [line(depositAccount.id, depositedMinor, 0n)] : []),
        ...(bankChargesMinor > 0n
          ? [
              line(
                (await this.ledger.accountBySystemKey(context.id, 'bank_charges', tx)).id,
                bankChargesMinor,
                0n,
              ),
            ]
          : []),
        ...(withholdingTaxMinor > 0n
          ? [
              line(
                (await this.ledger.accountBySystemKey(context.id, 'withholding_tax_receivable', tx))
                  .id,
                withholdingTaxMinor,
                0n,
              ),
            ]
          : []),
        line(arAccount.id, 0n, amountMinor),
      ];

      const postedJournal = await this.ledger.postJournalFromLines(
        context,
        user,
        'PAYMENT_RECEIVED_RECORD',
        {
          journalDate: receivedDate,
          currency,
          description,
          sourceType: 'PAYMENT_RECEIVED',
          sourceId: payment.id,
          lines,
        },
        metadata,
        undefined,
        tx,
      );

      const allocation = await this.numbering.allocateDocumentNumberWithClient(
        tx,
        context.id,
        PAYMENT_RECEIVED_DOCUMENT_TYPE,
        receivedDate,
      );

      const updated = await tx.paymentReceived.update({
        where: { id: payment.id },
        data: { paymentNumber: allocation.value, journalId: postedJournal.id },
        include: paymentDetailInclude,
      });

      // Recording and allocating in one request is what the record-payment dialog submits. Running
      // it inside this same transaction keeps the two atomic -- a rejected allocation (an invoice
      // that closed since the dialog loaded) rolls the payment back too, rather than stranding an
      // unapplied payment the person did not intend to create. Lock order is unchanged: this
      // payment's row is ours already, invoices are then locked ascending by id.
      const allocated =
        input.allocations && input.allocations.length > 0
          ? await this.applyAllocations(tx, context, user, updated.id, input.allocations, metadata)
          : updated;

      await this.recordPaymentIdempotency(
        tx,
        context.id,
        'PAYMENT_RECEIVED_RECORD',
        idempotencyKey,
        payment.id,
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.payment_received_recorded',
        entityType: 'payment_received',
        entityId: payment.id,
        action: AuditAction.CREATE,
        after: { contactId: contact.id, amountMinor: amountMinor.toString() },
        ipHash: metadata.ipHash,
      });
      await this.events.emit(tx, {
        organizationId: context.id,
        aggregateType: 'payment_received',
        aggregateId: payment.id,
        eventName: 'payment.recorded',
        payload: {
          paymentId: payment.id,
          contactId: contact.id,
          amountMinor: amountMinor.toString(),
          currency,
        },
      });

      return allocated;
    });

    return summarizePayment(recorded);
  }

  /**
   * Resolves the bank account a receipt lands in. An explicit choice must be an active asset
   * account in this organization -- otherwise a payment could be deposited into a revenue or
   * receivable account and silently distort the balance sheet.
   */
  private async resolveDepositAccount(
    tx: Prisma.TransactionClient,
    organizationId: string,
    depositAccountId: string | undefined,
  ) {
    if (!depositAccountId) {
      return this.ledger.accountBySystemKey(organizationId, 'bank_default', tx);
    }
    const account = await tx.ledgerAccount.findFirst({
      where: { id: depositAccountId, organizationId, status: 'ACTIVE' },
    });
    if (!account) throw new NotFoundException('Deposit account not found.');
    if (account.type !== 'ASSET') {
      throw new BadRequestException('A payment can only be deposited into an asset account.');
    }
    return account;
  }

  /**
   * Applies a recorded payment against one or more of the customer's open invoices. This is the
   * money-invariant-critical method: locks are taken in a fixed order (payment row, then invoice
   * rows in ascending id order) so that any future unallocate/void path taking the same two locks
   * cannot deadlock against a concurrent `allocate` call. Balances are re-read only after both locks
   * are held, and both invariants -- the whole-call total against `payment.unappliedMinor`, and each
   * invoice's own existing-plus-requested against `invoice.balanceMinor` -- are checked before any
   * row is written, so a violation rolls back the entire transaction with no partial allocation.
   */
  async allocate(
    context: OrganizationContext,
    user: PublicUser,
    paymentId: string,
    input: AllocatePaymentDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockPaymentIdempotency(tx, context.id, 'PAYMENT_ALLOCATE', idempotencyKey);
      const existingResult = await this.findPaymentIdempotentResult(
        context.id,
        'PAYMENT_ALLOCATE',
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.paymentReceived.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: paymentDetailInclude,
        });
      }

      const allocated = await this.applyAllocations(
        tx,
        context,
        user,
        paymentId,
        input.allocations,
        metadata,
      );

      await this.recordPaymentIdempotency(
        tx,
        context.id,
        'PAYMENT_ALLOCATE',
        idempotencyKey,
        paymentId,
      );
      return allocated;
    });

    return summarizePayment(updated);
  }

  /**
   * The allocation core, shared by `allocate` and by `record`'s one-step record-and-apply path. It
   * takes the caller's transaction so the caller decides the atomicity boundary and owns the
   * idempotency bookkeeping; the lock order inside is fixed either way.
   */
  private async applyAllocations(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    user: PublicUser,
    paymentId: string,
    allocations: readonly { invoiceId: string; amountMinor: string }[],
    metadata: RequestMetadata,
  ): Promise<PaymentWithAllocations> {
    const requestedByInvoice = new Map<string, bigint>();
    for (const line of allocations) {
      if (requestedByInvoice.has(line.invoiceId)) {
        throw new BadRequestException(
          `Invoice ${line.invoiceId} appears more than once in this allocation request.`,
        );
      }
      const amount = BigInt(line.amountMinor);
      if (amount <= 0n) {
        throw new BadRequestException('Each allocation amount must be greater than zero.');
      }
      requestedByInvoice.set(line.invoiceId, amount);
    }

    {
      // Lock order, fixed for all time: payment row first, then invoice rows ascending by id.
      await this.lockPaymentRow(tx, context.id, paymentId);
      const payment = await tx.paymentReceived.findFirst({
        where: { id: paymentId, organizationId: context.id },
      });
      if (!payment) throw new NotFoundException('Payment not found.');
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { baseCurrency: true },
      });
      const isForeignCurrency = payment.currency !== organization.baseCurrency;

      const sortedInvoiceIds = [...requestedByInvoice.keys()].sort();
      await this.lockInvoiceRowsInOrder(tx, context.id, sortedInvoiceIds);
      const invoices = await tx.invoice.findMany({
        where: { id: { in: sortedInvoiceIds }, organizationId: context.id },
      });
      const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const invoiceId of sortedInvoiceIds) {
        const invoice = invoicesById.get(invoiceId);
        if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found.`);
        if (invoice.contactId !== payment.contactId) {
          throw new ConflictException(
            `Invoice ${invoiceId} does not belong to this payment's customer.`,
          );
        }
        if (invoice.currency !== payment.currency) {
          throw new ConflictException(
            `Invoice ${invoiceId} is in ${invoice.currency}, but this payment is in ${payment.currency}.`,
          );
        }
        if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
          throw new ConflictException(`Invoice ${invoiceId} is not open for allocation.`);
        }
      }

      const totalRequestedMinor = [...requestedByInvoice.values()].reduce(
        (sum, amount) => sum + amount,
        0n,
      );
      if (totalRequestedMinor > payment.unappliedMinor) {
        throw new ConflictException("Allocation total exceeds the payment's unapplied amount.");
      }

      // `invoice.balanceMinor` is already net of every prior allocation against this invoice --
      // from this payment or any other -- since it is decremented atomically each time an
      // allocation is applied. So the guard compares the newly requested amount directly against
      // the fresh balance; re-adding this payment's own prior allocations here would double-count
      // an amount the balance has already had subtracted from it.
      for (const [invoiceId, amount] of requestedByInvoice) {
        const invoice = invoicesById.get(invoiceId)!;
        if (amount > invoice.balanceMinor) {
          throw new ConflictException(
            `Allocation for invoice ${invoiceId} exceeds its remaining balance.`,
          );
        }
      }

      if (isForeignCurrency) {
        await this.postRealizedFxAdjustment(
          tx,
          context,
          user,
          payment,
          organization.baseCurrency,
          invoicesById,
          requestedByInvoice,
          metadata,
        );
      }

      for (const [invoiceId, amount] of requestedByInvoice) {
        const invoice = invoicesById.get(invoiceId)!;
        await tx.paymentAllocation.upsert({
          where: { paymentId_invoiceId: { paymentId, invoiceId } },
          create: { organizationId: context.id, paymentId, invoiceId, amountMinor: amount },
          update: { amountMinor: { increment: amount } },
        });
        const newBalanceMinor = invoice.balanceMinor - amount;
        await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            paidMinor: invoice.paidMinor + amount,
            balanceMinor: newBalanceMinor,
            status: newBalanceMinor === 0n ? 'PAID' : 'PARTIALLY_PAID',
          },
        });
      }

      const newAllocatedMinor = payment.allocatedMinor + totalRequestedMinor;
      const newUnappliedMinor = payment.unappliedMinor - totalRequestedMinor;
      const updatedPayment = await tx.paymentReceived.update({
        where: { id: paymentId },
        data: {
          allocatedMinor: newAllocatedMinor,
          unappliedMinor: newUnappliedMinor,
          status: newUnappliedMinor === 0n ? 'FULLY_ALLOCATED' : 'PARTIALLY_ALLOCATED',
        },
        include: paymentDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.payment_allocated',
        entityType: 'payment_received',
        entityId: paymentId,
        action: AuditAction.UPDATE,
        after: {
          totalRequestedMinor: totalRequestedMinor.toString(),
          invoiceIds: sortedInvoiceIds,
        },
        ipHash: metadata.ipHash,
      });

      return updatedPayment;
    }
  }

  private async findOrThrow(organizationId: string, paymentId: string) {
    const payment = await this.prisma.paymentReceived.findFirst({
      where: { id: paymentId, organizationId },
      include: paymentDetailInclude,
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    return payment;
  }

  private async lockPaymentIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    operation: string,
    key?: string,
  ): Promise<void> {
    if (!key) return;
    const lockKey = `${organizationId}:${operation}:${key}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
  }

  private async findPaymentIdempotentResult(
    organizationId: string,
    operation: string,
    key: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<{ resourceId: string } | null> {
    if (!key) return null;
    return tx.ledgerIdempotencyKey.findUnique({
      where: { organizationId_operation_key: { organizationId, operation, key } },
      select: { resourceId: true },
    });
  }

  private recordPaymentIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    operation: string,
    key: string | undefined,
    paymentId: string,
  ) {
    if (!key) return undefined;
    return tx.ledgerIdempotencyKey.create({
      data: {
        organizationId,
        operation,
        key,
        resourceType: 'PAYMENT_RECEIVED',
        resourceId: paymentId,
      },
    });
  }

  private async lockPaymentRow(
    tx: Prisma.TransactionClient,
    organizationId: string,
    paymentId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id
      FROM payments_received
      WHERE id = ${paymentId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE
    `;
  }

  private async lockInvoiceRowsInOrder(
    tx: Prisma.TransactionClient,
    organizationId: string,
    invoiceIds: readonly string[],
  ): Promise<void> {
    if (invoiceIds.length === 0) return;
    await tx.$queryRaw`
      SELECT id
      FROM invoices
      WHERE id = ANY(${invoiceIds}::uuid[]) AND organization_id = ${organizationId}::uuid
      ORDER BY id
      FOR UPDATE
    `;
  }

  private async postRealizedFxAdjustment(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    user: PublicUser,
    payment: {
      id: string;
      contactId: string;
      amountMinor: bigint;
      receivedDate: Date;
      journalId: string | null;
    },
    baseCurrency: string,
    invoicesById: ReadonlyMap<
      string,
      { id: string; invoiceNumber: string | null; totalMinor: bigint; journalId: string | null }
    >,
    requestedByInvoice: ReadonlyMap<string, bigint>,
    metadata: RequestMetadata,
  ): Promise<void> {
    if (!payment.journalId) {
      throw new ConflictException('This payment has no posted journal for FX realization.');
    }

    const contact = await tx.contact.findUniqueOrThrow({
      where: { id: payment.contactId },
      select: { receivableAccountId: true, displayName: true },
    });
    const arAccount = contact.receivableAccountId
      ? await tx.ledgerAccount.findUniqueOrThrow({ where: { id: contact.receivableAccountId } })
      : await this.ledger.accountBySystemKey(context.id, 'accounts_receivable', tx);
    const paymentJournal = await tx.journal.findUniqueOrThrow({
      where: { id: payment.journalId },
      include: { lines: true },
    });
    const paymentArLine = paymentJournal.lines.find(
      (line) => line.accountId === arAccount.id && line.creditMinor > 0n,
    );
    if (!paymentArLine) {
      throw new ConflictException('This payment has no accounts-receivable credit line.');
    }

    let arDebitMinor = 0n;
    let arCreditMinor = 0n;
    let fxGainMinor = 0n;
    let fxLossMinor = 0n;

    for (const [invoiceId, amountMinor] of requestedByInvoice) {
      const invoice = invoicesById.get(invoiceId)!;
      if (!invoice.journalId) {
        throw new ConflictException(`Invoice ${invoiceId} has no posted journal.`);
      }
      const invoiceJournal = await tx.journal.findUniqueOrThrow({
        where: { id: invoice.journalId },
        include: { lines: true },
      });
      const invoiceArLine = invoiceJournal.lines.find(
        (line) => line.accountId === arAccount.id && line.debitMinor > 0n,
      );
      if (!invoiceArLine) {
        throw new ConflictException(
          `Invoice ${invoice.invoiceNumber ?? invoiceId} has no AR line.`,
        );
      }

      const invoiceBaseMinor = prorate(invoiceArLine.debitMinor, amountMinor, invoice.totalMinor);
      const paymentBaseMinor = prorate(paymentArLine.creditMinor, amountMinor, payment.amountMinor);
      const difference = paymentBaseMinor - invoiceBaseMinor;
      if (difference > 0n) {
        arDebitMinor += difference;
        fxGainMinor += difference;
      } else if (difference < 0n) {
        arCreditMinor += -difference;
        fxLossMinor += -difference;
      }
    }

    const lines: {
      accountId: string;
      debitMinor: bigint;
      creditMinor: bigint;
      description: string;
    }[] = [];
    const description = `Realized FX on payment from ${contact.displayName}`;
    if (arDebitMinor > 0n) {
      lines.push({
        accountId: arAccount.id,
        debitMinor: arDebitMinor,
        creditMinor: 0n,
        description,
      });
    }
    if (fxLossMinor > 0n) {
      const lossAccount = await this.ledger.accountBySystemKey(context.id, 'fx_loss', tx);
      lines.push({
        accountId: lossAccount.id,
        debitMinor: fxLossMinor,
        creditMinor: 0n,
        description,
      });
    }
    if (arCreditMinor > 0n) {
      lines.push({
        accountId: arAccount.id,
        debitMinor: 0n,
        creditMinor: arCreditMinor,
        description,
      });
    }
    if (fxGainMinor > 0n) {
      const gainAccount = await this.ledger.accountBySystemKey(context.id, 'fx_gain', tx);
      lines.push({
        accountId: gainAccount.id,
        debitMinor: 0n,
        creditMinor: fxGainMinor,
        description,
      });
    }
    if (lines.length === 0) return;

    await this.ledger.postJournalFromLines(
      context,
      user,
      'PAYMENT_ALLOCATE_FX',
      {
        journalDate: payment.receivedDate,
        currency: baseCurrency,
        description,
        sourceType: 'PAYMENT_ALLOCATION',
        sourceId: payment.id,
        postingRule: 'PAYMENT_ALLOCATE_FX@v1',
        lines,
      },
      metadata,
      undefined,
      tx,
    );
  }
}

function prorate(baseMinor: bigint, allocatedMinor: bigint, totalMinor: bigint): bigint {
  if (totalMinor <= 0n) throw new ConflictException('Cannot prorate against a zero total.');
  return roundHalfUpDivide(baseMinor * allocatedMinor, totalMinor);
}

function summarizePayment(payment: PaymentWithAllocations) {
  return {
    id: payment.id,
    contactId: payment.contactId,
    contactName: payment.contact.displayName,
    paymentNumber: payment.paymentNumber,
    status: payment.status,
    receivedDate: dateOnly(payment.receivedDate),
    currency: payment.currency,
    amountMinor: payment.amountMinor.toString(),
    allocatedMinor: payment.allocatedMinor.toString(),
    unappliedMinor: payment.unappliedMinor.toString(),
    bankChargesMinor: payment.bankChargesMinor.toString(),
    withholdingTaxMinor: payment.withholdingTaxMinor.toString(),
    depositedMinor: (
      payment.amountMinor -
      payment.bankChargesMinor -
      payment.withholdingTaxMinor
    ).toString(),
    paymentMode: payment.paymentMode,
    reference: payment.reference,
    notes: payment.notes,
    depositAccountId: payment.depositAccountId,
    depositAccountName: payment.depositAccount
      ? `${payment.depositAccount.code} ${payment.depositAccount.name}`
      : null,
    journalId: payment.journalId,
    allocations: payment.allocations.map((allocation) => ({
      id: allocation.id,
      paymentId: allocation.paymentId,
      invoiceId: allocation.invoiceId,
      invoiceNumber: allocation.invoice.invoiceNumber,
      amountMinor: allocation.amountMinor.toString(),
      createdAt: allocation.createdAt.toISOString(),
    })),
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
