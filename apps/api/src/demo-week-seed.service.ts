import { Injectable, Logger } from '@nestjs/common';

import type { PublicUser } from './auth/auth.service.js';
import { DemoWeekExtrasSeedService } from './demo-week-extras-seed.service.js';
import { BankRulesService } from './banking/bank-rules.service.js';
import { BankTransactionsService } from './banking/bank-transactions.service.js';
import { FinancialAccountsService } from './banking/financial-accounts.service.js';
import { ReconciliationsService } from './banking/reconciliations.service.js';
import { StatementImportsService } from './banking/statement-imports.service.js';
import { TransfersService } from './banking/transfers.service.js';
import type { RequestMetadata } from './auth/request-context.js';
import { PrismaService } from './database/prisma.service.js';
import type { CreateWarehouseDto } from './inventory/inventory.dto.js';
import { InventoryService } from './inventory/inventory.service.js';
import type { OrganizationContext } from './organizations/organization-context.js';
import { LedgerService } from './organizations/ledger.service.js';
import { TaxService } from './organizations/tax.service.js';
import { BillsService } from './purchases/bills.service.js';
import { ExpenseCategoriesService } from './purchases/expense-categories.service.js';
import { ExpensesService } from './purchases/expenses.service.js';
import { PaymentsMadeService } from './purchases/payments-made.service.js';
import { PurchaseOrdersService } from './purchases/purchase-orders.service.js';
import { RecurringBillsService } from './purchases/recurring-bills.service.js';
import { RecurringExpensesService } from './purchases/recurring-expenses.service.js';
import { VendorCreditsService } from './purchases/vendor-credits.service.js';
import type { CreateVendorDto } from './purchases/vendors.dto.js';
import { VendorsService } from './purchases/vendors.service.js';
import type { CreateProjectDto } from './projects/projects.dto.js';
import { ProjectsService } from './projects/projects.service.js';
import type { CreateItemDto } from './sales/catalog.dto.js';
import { CatalogService } from './sales/catalog.service.js';
import { CreditNotesService } from './sales/credit-notes.service.js';
import type { CreateContactDto } from './sales/customers.dto.js';
import { CustomersService } from './sales/customers.service.js';
import type { InvoiceLineDto } from './sales/invoices.dto.js';
import { InvoicesService } from './sales/invoices.service.js';
import { PaymentsService } from './sales/payments.service.js';
import { QuotesService } from './sales/quotes.service.js';
import { SalesOrdersService } from './sales/sales-orders.service.js';

/**
 * Operation name for this seed's step registry. Every step writes one `LedgerIdempotencyKey` row
 * keyed `(organizationId, 'DEMO_WEEK_STEP', key)`, so re-running the seed skips the steps that
 * already produced their record instead of duplicating a week of activity -- the same uniqueness the
 * posting paths rely on, pointed at seed steps rather than at client retries.
 */
const STEP_OPERATION = 'DEMO_WEEK_STEP';
const WEEK_LENGTH_DAYS = 7;

/**
 * One week of realistic business activity for the demo organization, per docs/MOCK_DATA_PLAN.md.
 *
 * Runs through the real services, so ledger postings, tax snapshots, numbering, audit events and
 * domain events are all exactly what a user would produce by hand. Dates are anchored to the run day
 * (`day(-6)` ... `day(0)`) rather than hard-coded, so the week stays current on every run; on
 * 24 Sep 2026 that reproduces the plan's 18-24 Sep window literally.
 *
 * Backdating goes through the optional `businessDate` parameter the issuing posting methods accept
 * (invoice issue/write-off, bill issue, credit note issue/allocate/refund, vendor credit
 * issue/allocate, expense post, PO receipt): the document date, its journal date, the tax rate
 * resolved for that date and the number allocation all move together, which is what keeps a posted
 * journal line and its source document in agreement.
 */
@Injectable()
export class DemoWeekSeedService {
  private readonly logger = new Logger(DemoWeekSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tax: TaxService,
    private readonly ledger: LedgerService,
    private readonly customers: CustomersService,
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly vendors: VendorsService,
    private readonly expenseCategories: ExpenseCategoriesService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly bills: BillsService,
    private readonly paymentsMade: PaymentsMadeService,
    private readonly vendorCredits: VendorCreditsService,
    private readonly expenses: ExpensesService,
    private readonly recurringBills: RecurringBillsService,
    private readonly recurringExpenses: RecurringExpensesService,
    private readonly projects: ProjectsService,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly creditNotes: CreditNotesService,
    private readonly quotes: QuotesService,
    private readonly salesOrders: SalesOrdersService,
    private readonly financialAccounts: FinancialAccountsService,
    private readonly bankRules: BankRulesService,
    private readonly statementImports: StatementImportsService,
    private readonly bankTransactions: BankTransactionsService,
    private readonly transfers: TransfersService,
    private readonly reconciliations: ReconciliationsService,
    private readonly extras: DemoWeekExtrasSeedService,
  ) {}

  async run(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    users: ReadonlyMap<string, PublicUser> = new Map([['OWNER', owner]]),
  ) {
    const week = new WeekDates(dateOnly(new Date()));
    const state = createWeekState();

    await this.ensureTaxRates(context, owner, metadata, state);
    await this.ensureCustomers(context, owner, metadata, state);
    await this.ensureItems(context, owner, metadata, state);
    await this.ensureWarehouses(context, owner, metadata, state);
    await this.ensureProjects(context, owner, metadata, state);
    await this.ensureVendors(context, owner, metadata, state);
    await this.ensureExpenseCategories(context, owner, metadata, state);
    await this.seedOpeningStock(context, owner, metadata, week, state);
    await this.seedInventoryWeek(context, owner, metadata, week, state);
    await this.seedSalesWeek(context, owner, metadata, week, state);
    await this.seedPurchasesWeek(context, owner, metadata, week, state);
    await this.seedBankingWeek(context, owner, metadata, week, state);
    await this.extras.run(context, owner, users, metadata, week, state);

    const counts = await this.verify(context, state);
    this.logger.log(
      `Demo week ${week.day(-6)}..${week.day(0)} ready: ${Object.entries(counts)
        .map(([table, rows]) => `${table}=${rows}`)
        .join(' ')}`,
    );
    return {
      window: { from: week.day(-6), to: week.day(0) },
      counts,
    };
  }

  /**
   * Runs a step at most once per organization. The registry row is written only after the step
   * succeeded, so a failed run is retried next time rather than recorded as done.
   */
  private async step<T extends { id: string }>(
    context: OrganizationContext,
    key: string,
    resourceType: string,
    run: () => Promise<T>,
  ): Promise<{ id: string; created: boolean }> {
    const existing = await this.prisma.ledgerIdempotencyKey.findUnique({
      where: {
        organizationId_operation_key: {
          organizationId: context.id,
          operation: STEP_OPERATION,
          key,
        },
      },
      select: { resourceId: true },
    });
    if (existing) return { id: existing.resourceId, created: false };
    const created = await run();
    await this.prisma.ledgerIdempotencyKey.create({
      data: {
        organizationId: context.id,
        operation: STEP_OPERATION,
        key,
        resourceType,
        resourceId: created.id,
      },
    });
    return { id: created.id, created: true };
  }

  /**
   * The rate each seeded tax code needs to be usable. `VAT-EXEMPT` ships as a code with no rate, so
   * an exempt line would otherwise fail to resolve; the window is anchored to the fiscal year's own
   * start rather than a literal date, matching what the base seed does for its two rates.
   */
  private async ensureTaxRates(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    state: WeekState,
  ): Promise<void> {
    const codes = await this.tax.listTaxCodes(context.id);
    const pick = (code: string) => {
      const found = codes.find((entry) => entry.code === code);
      if (!found) throw new Error(`The demo organization is missing starter tax code ${code}.`);
      return found;
    };
    const standard = pick('VAT-STD');
    const zero = pick('VAT-ZERO');
    const exempt = pick('VAT-EXEMPT');
    state.taxCodes = { standard: standard.id, zero: zero.id, exempt: exempt.id };

    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { organizationId: context.id },
      orderBy: { startsOn: 'asc' },
      select: { startsOn: true },
    });
    const effectiveFrom = fiscalYear
      ? dateOnly(fiscalYear.startsOn)
      : dateOnly(new Date(Date.now() - 400 * 86_400_000));

    for (const [code, ratePercent] of [
      [standard, '16.0000'],
      [zero, '0.0000'],
      [exempt, '0.0000'],
    ] as const) {
      const existing = await this.prisma.taxRate.findFirst({
        where: { organizationId: context.id, taxCodeId: code.id },
        select: { id: true },
      });
      if (!existing) {
        await this.tax.createRate(
          context,
          owner,
          code.id,
          { ratePercent, effectiveFrom },
          metadata,
        );
      }
    }
  }

  /**
   * Section 3's eight customers. Keyed by slug, matched on `displayName` so a re-run adopts whatever
   * is already there instead of erroring on `CustomersService#create`'s duplicate check.
   */
  private async ensureCustomers(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_CUSTOMERS) {
      const existing = await this.prisma.contact.findFirst({
        where: {
          organizationId: context.id,
          type: 'CUSTOMER',
          displayName: definition.displayName,
        },
        select: { id: true },
      });
      const contact =
        existing ??
        (await this.customers.create(
          context,
          owner,
          { displayName: definition.displayName, ...definition.dto },
          metadata,
        ));
      state.customers.set(definition.slug, contact.id);
    }

    // One deactivated customer, so the list's status filter and the deactivated-customer guards on
    // payment/invoice creation both have a subject.
    const deactivated = required(
      state.customers.get('deactivated'),
      'The deactivated demo customer was not created.',
    );
    const current = await this.prisma.contact.findUniqueOrThrow({
      where: { id: deactivated },
      select: { status: true },
    });
    if (current.status !== 'INACTIVE') {
      await this.customers.setStatus(context, owner, deactivated, 'INACTIVE', metadata);
    }
  }

  /**
   * Section 3's twelve catalog items: seven stock-tracked goods, three services, two non-inventory
   * resale lines. Three goods carry a reorder threshold high enough that the week's receipts leave
   * them below it, so the reorder report is not empty.
   */
  private async ensureItems(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    state: WeekState,
  ): Promise<void> {
    const existingUnit = await this.prisma.unit.findUnique({
      where: { organizationId_code: { organizationId: context.id, code: 'PCS' } },
      select: { id: true },
    });
    const unitId =
      existingUnit?.id ??
      (await this.catalog.createUnit(context, owner, { code: 'PCS', name: 'Pieces' }, metadata)).id;

    for (const definition of WEEK_ITEMS) {
      const existing = await this.prisma.item.findFirst({
        where: { organizationId: context.id, name: definition.name },
        select: { id: true },
      });
      const taxCodeId = definition.zeroRated ? state.taxCodes.zero : state.taxCodes.standard;
      const item =
        existing ??
        (await this.catalog.createItem(
          context,
          owner,
          {
            ...definition.dto,
            name: definition.name,
            defaultUnitId: unitId,
            defaultTaxCodeId: taxCodeId,
            defaultPurchaseTaxCodeId: taxCodeId,
          },
          metadata,
        ));
      state.items.set(definition.slug, item.id);
    }
  }

  /** Main + Westlands, per section 3. Matched on `code`, which is unique per organization. */
  private async ensureWarehouses(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    state: WeekState,
  ): Promise<void> {
    state.warehouses.main = await this.ensureWarehouse(context, owner, metadata, {
      code: 'MAIN',
      name: 'Main warehouse',
      address: 'Enterprise Road, Industrial Area, Nairobi',
    });
    state.warehouses.westlands = await this.ensureWarehouse(context, owner, metadata, {
      code: 'WEST',
      name: 'Westlands store',
      address: 'Ring Road Westlands, Nairobi',
    });
  }

  private async ensureWarehouse(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    input: CreateWarehouseDto,
  ): Promise<string> {
    const existing = await this.prisma.warehouse.findUnique({
      where: { organizationId_code: { organizationId: context.id, code: input.code } },
      select: { id: true },
    });
    if (existing) return existing.id;
    return (await this.inventory.createWarehouse(context, owner, input, metadata)).id;
  }

  /** Two tagged projects with budgets, so project profitability and billing have a subject. */
  private async ensureProjects(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_PROJECTS) {
      const existing = await this.prisma.project.findFirst({
        where: { organizationId: context.id, name: definition.name },
        select: { id: true },
      });
      const customerId = definition.customerSlug
        ? required(
            state.customers.get(definition.customerSlug),
            `Project ${definition.name} references unknown customer ${definition.customerSlug}.`,
          )
        : undefined;
      const project =
        existing ??
        (await this.projects.create(
          context,
          owner,
          {
            ...definition.dto,
            name: definition.name,
            customerId,
            managerUserId: owner.id,
          },
          metadata,
        ));
      state.projects.set(definition.slug, project.id);
    }
  }

  /**
   * A single invoice line from a seeded item. Prices are always explicit so the seeded totals do not
   * depend on an item's price list staying put, and the tax code is resolved once per line the same
   * way the UI does it.
   */
  private line(
    state: WeekState,
    itemSlug: string,
    quantity: string,
    unitPriceMinor: string,
    options: {
      tax?: 'standard' | 'zero' | 'exempt';
      projectSlug?: string;
      warehouse?: 'main' | 'westlands';
    } = {},
  ): InvoiceLineDto {
    const tax = options.tax ?? 'standard';
    return {
      itemId: required(state.items.get(itemSlug), `Unknown seeded item ${itemSlug}.`),
      quantity,
      unitPriceMinor,
      taxCodeId: state.taxCodes[tax],
      projectId: options.projectSlug
        ? required(state.projects.get(options.projectSlug), 'Unknown seeded project.')
        : undefined,
      warehouseId: options.warehouse ? state.warehouses[options.warehouse] : undefined,
    };
  }

  /**
   * Opening stock for the seven tracked goods, posted as stock adjustments dated before the window.
   * `InventoryService#consumeStock` refuses to issue more than the layers hold, so this has to exist
   * before any invoice with a tracked line is issued -- and it is what makes the Friday sale a real
   * COGS posting rather than a rejection. Quantities are chosen so tiles, cement, tank and tyre end
   * the week below their reorder point.
   */
  private async seedOpeningStock(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_OPENING_STOCK) {
      const key = `opening-stock:${definition.item}`;
      const adjustment = await this.step(context, `${key}:draft`, 'INVENTORY_ADJUSTMENT', () =>
        this.inventory.createAdjustment(
          context,
          owner,
          {
            itemId: required(
              state.items.get(definition.item),
              `Unknown opening-stock item ${definition.item}.`,
            ),
            warehouseId: state.warehouses.main,
            adjustmentDate: week.day(-8),
            quantityDelta: definition.quantity,
            valueDeltaMinor: definition.valueMinor,
            reason: 'Opening stock for the demo week',
          },
          metadata,
        ),
      );
      await this.step(context, `${key}:post`, 'INVENTORY_ADJUSTMENT', () =>
        this.inventory.postAdjustment(context, owner, adjustment.id, metadata),
      );
    }
  }

  /**
   * Section 5c's inventory extras on top of opening stock: a write-down and a recount posted on their
   * own days, one adjustment left waiting for approval, one left in draft, and two transfers between
   * the warehouses. Quantities are sized against the week's sales so no layer runs dry.
   */
  private async seedInventoryWeek(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_STOCK_ADJUSTMENTS) {
      const key = `stock-adjustment:${definition.key}`;
      const adjustment = await this.step(context, `${key}:draft`, 'INVENTORY_ADJUSTMENT', () =>
        this.inventory.createAdjustment(
          context,
          owner,
          {
            itemId: required(
              state.items.get(definition.item),
              `Unknown adjusted item ${definition.item}.`,
            ),
            warehouseId: state.warehouses.main,
            adjustmentDate: week.day(definition.on),
            quantityDelta: definition.quantityDelta,
            valueDeltaMinor: definition.valueDeltaMinor,
            reason: definition.reason,
          },
          metadata,
        ),
      );
      if (definition.target === 'DRAFT') continue;
      if (definition.target === 'PENDING_APPROVAL') {
        await this.step(context, `${key}:submit`, 'INVENTORY_ADJUSTMENT', () =>
          this.inventory.submitAdjustment(context, owner, adjustment.id, metadata),
        );
        continue;
      }
      await this.step(context, `${key}:post`, 'INVENTORY_ADJUSTMENT', () =>
        this.inventory.postAdjustment(context, owner, adjustment.id, metadata),
      );
    }

    for (const definition of WEEK_STOCK_TRANSFERS) {
      await this.step(context, `stock-transfer:${definition.key}`, 'INVENTORY_TRANSFER', () =>
        this.inventory.transferStock(
          context,
          owner,
          {
            itemId: required(
              state.items.get(definition.item),
              `Unknown transferred item ${definition.item}.`,
            ),
            fromWarehouseId: state.warehouses.main,
            toWarehouseId: state.warehouses.westlands,
            transferDate: week.day(definition.on),
            quantity: definition.quantity,
          },
          metadata,
        ),
      );
    }
  }

  /**
   * Six customer receipts covering all three allocation states: the walk-in settled the day it was
   * invoiced, the Friday invoices paid in full and half, a USD receipt against the USD invoice (so
   * the FX path has a real counter-entry), and one receipt left unapplied on Thursday to exercise
   * allocation as a separate action.
   */
  private async seedPayments(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_PAYMENTS) {
      const invoiceId = required(
        state.invoices.get(definition.invoice),
        `Payment ${definition.key} references unknown invoice ${definition.invoice}.`,
      );
      const invoice = await this.prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { balanceMinor: true, currency: true },
      });
      const amountMinor =
        definition.fraction === 'half' ? invoice.balanceMinor / 2n : invoice.balanceMinor;
      if (amountMinor <= 0n) continue;

      const payment = await this.step(
        context,
        `payment:${definition.key}:record`,
        'PAYMENT_RECEIVED',
        () =>
          this.payments.record(
            context,
            owner,
            {
              contactId: this.customerId(state, definition.customer),
              receivedDate: week.day(definition.receivedOn),
              currency: definition.currency ?? invoice.currency,
              amountMinor: amountMinor.toString(),
            },
            metadata,
          ),
      );
      state.payments.set(definition.key, payment.id);
      if (!definition.allocate) continue;

      await this.step(context, `payment:${definition.key}:allocate`, 'PAYMENT_RECEIVED', () =>
        this.payments.allocate(
          context,
          owner,
          payment.id,
          { allocations: [{ invoiceId, amountMinor: amountMinor.toString() }] },
          metadata,
        ),
      );
    }
  }

  /**
   * Section 5b's credit-note set for the customer in credit: one applied back to an open invoice, one
   * refunded in cash, one voided, one left issued, one left in draft.
   */
  private async seedCreditNotes(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_CREDIT_NOTES) {
      const creditNote = await this.step(
        context,
        `credit-note:${definition.key}:draft`,
        'CREDIT_NOTE',
        () =>
          this.creditNotes.createDraft(
            context,
            owner,
            {
              contactId: this.customerId(state, definition.customer),
              currency: definition.currency,
              lines: definition.lines.map((line) => this.quoteLine(state, line)),
            },
            metadata,
          ),
      );
      state.creditNotes.set(definition.key, creditNote.id);
      if (definition.target === 'DRAFT') continue;

      await this.step(context, `credit-note:${definition.key}:issue`, 'CREDIT_NOTE', () =>
        this.creditNotes.issueCreditNote(
          context,
          owner,
          creditNote.id,
          metadata,
          undefined,
          week.day(definition.issuedOn),
        ),
      );

      if (definition.target === 'VOID') {
        await this.step(context, `credit-note:${definition.key}:void`, 'CREDIT_NOTE', () =>
          this.creditNotes.voidCreditNote(context, owner, creditNote.id, metadata),
        );
        continue;
      }

      if (definition.target === 'REFUNDED') {
        const issued = await this.prisma.creditNote.findUniqueOrThrow({
          where: { id: creditNote.id },
          select: { remainingMinor: true },
        });
        if (issued.remainingMinor > 0n) {
          await this.step(context, `credit-note:${definition.key}:refund`, 'CREDIT_NOTE', () =>
            this.creditNotes.refund(
              context,
              owner,
              creditNote.id,
              { amountMinor: issued.remainingMinor.toString() },
              metadata,
              undefined,
              week.day(0),
            ),
          );
        }
        continue;
      }

      if (definition.target === 'APPLIED') {
        const invoiceId = required(
          state.invoices.get(
            required(definition.invoice, 'An applied credit note needs an invoice.'),
          ),
          'Applied credit note references an unknown invoice.',
        );
        const invoice = await this.prisma.invoice.findUniqueOrThrow({
          where: { id: invoiceId },
          select: { balanceMinor: true },
        });
        const issued = await this.prisma.creditNote.findUniqueOrThrow({
          where: { id: creditNote.id },
          select: { remainingMinor: true },
        });
        const amountMinor =
          issued.remainingMinor < invoice.balanceMinor
            ? issued.remainingMinor
            : invoice.balanceMinor;
        if (amountMinor > 0n) {
          await this.step(context, `credit-note:${definition.key}:allocate`, 'CREDIT_NOTE', () =>
            this.creditNotes.allocate(
              context,
              owner,
              creditNote.id,
              { allocations: [{ invoiceId, amountMinor: amountMinor.toString() }] },
              metadata,
              undefined,
              week.day(definition.issuedOn),
            ),
          );
        }
      }
    }
  }

  /**
   * Section 5a's quote and order ladders: one document per reachable status, plus the two chains the
   * plan asks for -- an accepted quote converted to an invoice, and a confirmed order converted to
   * one. Transitions go through the services, so `sentAt`, the conversion links (`convertedInvoiceId`)
   * and the audit trail are genuine rather than hand-written. PENDING_APPROVAL is reached later, once
   * the automation step has created an approval policy for a quote to hang a request on.
   */
  private async seedQuotesAndOrders(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_QUOTES) {
      const quote = await this.step(context, `quote:${definition.key}:draft`, 'QUOTE', () =>
        this.quotes.createDraft(
          context,
          owner,
          {
            contactId: this.customerId(state, definition.customer),
            expiryDate: week.day(definition.expiryOn),
            currency: definition.currency,
            lines: definition.lines.map((line) => this.quoteLine(state, line)),
          },
          metadata,
        ),
      );
      state.quotes.set(definition.key, quote.id);
      if (definition.target === 'DRAFT') continue;

      await this.step(context, `quote:${definition.key}:submit`, 'QUOTE', () =>
        this.quotes.submitForApproval(context, owner, quote.id, metadata),
      );
      if (definition.target === 'PENDING_APPROVAL') continue;
      await this.step(context, `quote:${definition.key}:approve`, 'QUOTE', () =>
        this.quotes.approve(context, owner, quote.id, metadata),
      );
      if (definition.target === 'APPROVED') continue;

      await this.step(context, `quote:${definition.key}:send`, 'QUOTE', () =>
        this.quotes.send(context, owner, quote.id, metadata),
      );
      if (definition.target === 'SENT') continue;

      if (definition.target === 'DECLINED') {
        await this.step(context, `quote:${definition.key}:decline`, 'QUOTE', () =>
          this.quotes.decline(context, owner, quote.id, metadata),
        );
        continue;
      }
      if (definition.target === 'EXPIRED') {
        await this.step(context, `quote:${definition.key}:expire`, 'QUOTE', () =>
          this.quotes.expire(context, owner, quote.id, metadata),
        );
        continue;
      }

      await this.step(context, `quote:${definition.key}:accept`, 'QUOTE', () =>
        this.quotes.accept(context, owner, quote.id, metadata),
      );
      if (definition.target !== 'CONVERTED') continue;

      // convertToInvoice() returns the now-CONVERTED quote, not the invoice -- its own id
      // never changes, so step()'s idempotency bookkeeping (which remembers run()'s `.id`)
      // would otherwise record the quote's id instead of the invoice this step actually
      // creates. Re-shape the result so `.id` is the invoice id, same as every other step.
      const converted = await this.step(
        context,
        `quote:${definition.key}:convert`,
        'INVOICE',
        async () => {
          const result = await this.quotes.convertToInvoice(context, owner, quote.id, metadata);
          if (!result.convertedInvoiceId) {
            throw new Error(
              `convertToInvoice did not set convertedInvoiceId for quote ${quote.id}`,
            );
          }
          return { id: result.convertedInvoiceId };
        },
      );
      await this.step(context, `quote:${definition.key}:issue`, 'INVOICE', () =>
        this.invoices.issueInvoice(context, owner, converted.id, metadata, undefined, week.day(-3)),
      );
      state.invoices.set(`quote-${definition.key}`, converted.id);
    }

    for (const definition of WEEK_ORDERS) {
      const order = await this.step(context, `order:${definition.key}:draft`, 'SALES_ORDER', () =>
        this.salesOrders.createDraft(
          context,
          owner,
          {
            contactId: this.customerId(state, definition.customer),
            currency: definition.currency,
            lines: definition.lines.map((line) => this.quoteLine(state, line)),
          },
          metadata,
        ),
      );
      state.orders.set(definition.key, order.id);
      if (definition.target === 'DRAFT') continue;

      await this.step(context, `order:${definition.key}:approve`, 'SALES_ORDER', () =>
        this.salesOrders.approve(context, owner, order.id, metadata),
      );
      if (definition.target === 'APPROVED') continue;

      await this.step(context, `order:${definition.key}:confirm`, 'SALES_ORDER', () =>
        this.salesOrders.confirm(context, owner, order.id, metadata),
      );
      if (definition.target === 'CANCELLED') {
        await this.step(context, `order:${definition.key}:cancel`, 'SALES_ORDER', () =>
          this.salesOrders.cancel(context, owner, order.id, metadata),
        );
        continue;
      }
      if (definition.target === 'CONFIRMED') {
        // The plan's chain: a confirmed order invoiced through the real conversion path.
        // convertToInvoice() returns the now-converted order, not the invoice -- its own id
        // never changes, so step()'s idempotency bookkeeping (which remembers run()'s `.id`)
        // would otherwise record the order's id instead of the invoice this step actually
        // creates. Re-shape the result so `.id` is the invoice id, same as every other step.
        const converted = await this.step(
          context,
          `order:${definition.key}:convert`,
          'INVOICE',
          async () => {
            const result = await this.salesOrders.convertToInvoice(
              context,
              owner,
              order.id,
              metadata,
            );
            if (!result.convertedInvoiceId) {
              throw new Error(
                `convertToInvoice did not set convertedInvoiceId for order ${order.id}`,
              );
            }
            return { id: result.convertedInvoiceId };
          },
        );
        await this.step(context, `order:${definition.key}:issue`, 'INVOICE', () =>
          this.invoices.issueInvoice(
            context,
            owner,
            converted.id,
            metadata,
            undefined,
            week.day(-2),
          ),
        );
        state.invoices.set(`order-${definition.key}`, converted.id);
        continue;
      }
      if (definition.target === 'PARTIALLY_FULFILLED') {
        await this.step(context, `order:${definition.key}:partial`, 'SALES_ORDER', () =>
          this.salesOrders.markPartiallyFulfilled(context, owner, order.id, metadata),
        );
        continue;
      }
      if (definition.target === 'FULFILLED') {
        await this.step(context, `order:${definition.key}:fulfil`, 'SALES_ORDER', () =>
          this.salesOrders.markFulfilled(context, owner, order.id, metadata),
        );
      }
    }
  }

  /** Quotes and sales orders take the same line shape: item, quantity, price, optional discount. */
  private quoteLine(state: WeekState, line: WeekLineDefinition) {
    return {
      itemId: required(state.items.get(line.item), `Unknown seeded item ${line.item}.`),
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discountMinor: line.discount,
    };
  }

  /**
   * Collections metadata and lifecycle states that only matter once documents are open: reminders
   * switched off, a promised payment date, a void with no payments against it, and a partial bad-debt
   * write-off. Each goes through the service, so the audit events and the reminder-job cancellation
   * are real.
   */
  private async seedCollections(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    const partial = required(state.invoices.get('vat-lines'), 'Missing the part-paid invoice.');
    const dueReceipt = required(
      state.invoices.get('due-receipt'),
      'Missing the due-on-receipt invoice.',
    );
    const voidTarget = required(state.invoices.get('void-me'), 'Missing the invoice to void.');
    const writeOffTarget = required(
      state.invoices.get('aging-45'),
      'Missing the invoice to write off.',
    );

    // Wed: one open invoice with reminders switched off, another with a promised payment date.
    await this.step(context, 'collections:stop-reminders', 'INVOICE', () =>
      this.invoices.setRemindersStopped(context, owner, partial, true, metadata),
    );
    await this.step(context, 'collections:expected-date', 'INVOICE', () =>
      this.invoices.setExpectedPaymentDate(
        context,
        owner,
        dueReceipt,
        { expectedPaymentDate: week.day(3) },
        metadata,
      ),
    );

    // Tue: an issued invoice voided with no payments against it (reversed, never deleted).
    await this.step(context, 'collections:void', 'INVOICE', () =>
      this.invoices.voidInvoice(context, owner, voidTarget, metadata),
    );

    // Thu: partial bad-debt write-off of the 45-day-old receivable, dated inside the window. Base
    // currency only, and it needs account 5180, which the retail starter chart provides.
    await this.step(context, 'collections:write-off', 'INVOICE', () =>
      this.invoices.writeOff(
        context,
        owner,
        writeOffTarget,
        { amountMinor: '1000000', reason: 'Agreed partial settlement after liquidation notice' },
        metadata,
        week.day(0),
      ),
    );
  }

  /**
   * The seed's own proof points: every table this stage owns must have rows, and the ledger must
   * balance. Counts are read straight from the tables (and the trial balance from the posted lines)
   * rather than through a report, so a passing verify means the data is really there.
   */
  private async verify(
    context: OrganizationContext,
    state: WeekState,
  ): Promise<Record<string, number>> {
    const [
      customers,
      items,
      warehouses,
      projects,
      invoices,
      quotes,
      orders,
      payments,
      creditNotes,
      journals,
      stockMovements,
      adjustments,
    ] = await Promise.all([
      this.prisma.contact.count({ where: { organizationId: context.id, type: 'CUSTOMER' } }),
      this.prisma.item.count({ where: { organizationId: context.id } }),
      this.prisma.warehouse.count({ where: { organizationId: context.id } }),
      this.prisma.project.count({ where: { organizationId: context.id } }),
      this.prisma.invoice.count({ where: { organizationId: context.id } }),
      this.prisma.quote.count({ where: { organizationId: context.id } }),
      this.prisma.salesOrder.count({ where: { organizationId: context.id } }),
      this.prisma.paymentReceived.count({ where: { organizationId: context.id } }),
      this.prisma.creditNote.count({ where: { organizationId: context.id } }),
      this.prisma.journal.count({ where: { organizationId: context.id } }),
      this.prisma.stockMovement.count({ where: { organizationId: context.id } }),
      this.prisma.inventoryAdjustment.count({ where: { organizationId: context.id } }),
    ]);

    const where = { organizationId: context.id };
    const [
      vendors,
      purchaseOrders,
      bills,
      paymentsMade,
      vendorCredits,
      expenses,
      recurringBills,
      recurringExpenses,
    ] = await Promise.all([
      this.prisma.vendor.count({ where }),
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.bill.count({ where }),
      this.prisma.paymentMade.count({ where }),
      this.prisma.vendorCredit.count({ where }),
      this.prisma.expense.count({ where }),
      this.prisma.recurringBillTemplate.count({ where }),
      this.prisma.recurringExpenseTemplate.count({ where }),
    ]);

    const [
      financialAccounts,
      bankTransactions,
      statementImports,
      bankRules,
      bankTransfers,
      reconciliations,
    ] = await Promise.all([
      this.prisma.financialAccount.count({ where }),
      this.prisma.bankTransaction.count({ where }),
      this.prisma.statementImport.count({ where }),
      this.prisma.bankRule.count({ where }),
      this.prisma.transfer.count({ where }),
      this.prisma.reconciliation.count({ where }),
    ]);

    const counts = {
      financialAccounts,
      bankTransactions,
      statementImports,
      bankRules,
      bankTransfers,
      reconciliations,
      customers,
      items,
      warehouses,
      projects,
      invoices,
      quotes,
      orders,
      payments,
      creditNotes,
      journals,
      stockMovements,
      adjustments,
      vendors,
      purchaseOrders,
      bills,
      paymentsMade,
      vendorCredits,
      expenses,
      recurringBills,
      recurringExpenses,
    };
    // Status coverage for the purchases ladders (section 5a): every state the screens filter on must
    // have at least one row, not merely a non-empty table.
    const [billStatuses, poStatuses, expenseStatuses] = await Promise.all([
      this.prisma.bill.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.purchaseOrder.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.expense.groupBy({ by: ['status'], where, _count: true }),
    ]);
    const has = (rows: { status: string }[], ...statuses: string[]) =>
      statuses.every((status) => rows.some((row) => row.status === status));
    assert(has(billStatuses, 'DRAFT', 'VOID'), 'The demo week is missing draft/void bills.');
    assert(
      has(poStatuses, 'DRAFT', 'APPROVED', 'CANCELLED'),
      'The demo week is missing purchase order statuses.',
    );
    assert(
      has(expenseStatuses, 'DRAFT', 'PENDING_APPROVAL', 'POSTED'),
      'The demo week is missing expense statuses.',
    );
    // Banking and inventory minimums from section 5c, plus the states their screens filter on.
    assert(financialAccounts >= 3, `Expected 3 financial accounts, found ${financialAccounts}.`);
    assert(bankTransactions >= 20, `Expected 20 bank transactions, found ${bankTransactions}.`);
    assert(statementImports >= 2, `Expected 2 statement imports, found ${statementImports}.`);
    assert(bankRules >= 3, `Expected 3 bank rules, found ${bankRules}.`);
    assert(bankTransfers >= 2, `Expected 2 bank transfers, found ${bankTransfers}.`);
    const [
      dispositions,
      reconciliationStatuses,
      adjustmentStatuses,
      stockTransfers,
      duplicateImports,
    ] = await Promise.all([
      this.prisma.bankTransaction.groupBy({ by: ['disposition'], where, _count: true }),
      this.prisma.reconciliation.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.inventoryAdjustment.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.stockMovement.count({ where: { ...where, sourceType: 'TRANSFER' } }),
      this.prisma.statementImport.count({ where: { ...where, duplicateCount: { gt: 0 } } }),
    ]);
    assert(
      ['UNRESOLVED', 'MATCHED', 'POSTED', 'EXCLUDED'].every((disposition) =>
        dispositions.some((row) => row.disposition === disposition),
      ),
      'The demo week is missing a bank transaction disposition.',
    );
    assert(
      has(reconciliationStatuses, 'COMPLETED', 'IN_PROGRESS'),
      'The demo week needs one completed and one open reconciliation.',
    );
    assert(
      has(adjustmentStatuses, 'POSTED', 'PENDING_APPROVAL', 'DRAFT'),
      'The demo week is missing inventory adjustment statuses.',
    );
    assert(stockTransfers >= 4, 'The demo week needs two stock transfers (an out and an in each).');
    assert(duplicateImports >= 1, 'The demo week needs a statement import with a duplicate line.');
    const extraCounts = await this.verifyExtras(context);
    const allCounts = { ...counts, ...extraCounts };
    for (const [table, rows] of Object.entries(allCounts)) {
      // Attachments need object storage; a missing one is warned about in verifyExtras, not fatal.
      if (table === 'attachments') continue;
      assert(rows > 0, `The demo week left ${table} empty.`);
    }

    const lines = await this.prisma.journalLine.findMany({
      where: { organizationId: context.id, journal: { status: 'POSTED' } },
      select: { debitMinor: true, creditMinor: true },
    });
    let debitMinor = 0n;
    let creditMinor = 0n;
    for (const line of lines) {
      debitMinor += line.debitMinor;
      creditMinor += line.creditMinor;
    }
    assert(
      debitMinor === creditMinor,
      `The demo week ledger does not balance: debit ${debitMinor} vs credit ${creditMinor}.`,
    );
    assert(
      state.invoices.size >= 12,
      `The demo week should leave at least 12 invoices, found ${state.invoices.size}.`,
    );
    await this.verifyReporting(context);
    return allCounts;
  }

  /** Section 5c's accounting, projects, platform and workspace rows, with the states they need. */
  private async verifyExtras(context: OrganizationContext): Promise<Record<string, number>> {
    const where = { organizationId: context.id };
    const [
      recurringInvoiceTemplates,
      recurringJournalTemplates,
      openingBalanceBatches,
      timeEntries,
      approvalPolicies,
      comments,
      notifications,
      reminderPolicies,
      workflowRules,
      invitations,
      tenants,
      manualJournals,
      customAccounts,
      attachments,
    ] = await Promise.all([
      this.prisma.recurringInvoiceTemplate.count({ where }),
      this.prisma.recurringJournalTemplate.count({ where }),
      this.prisma.openingBalanceBatch.count({ where }),
      this.prisma.timeEntry.count({ where }),
      this.prisma.approvalPolicy.count({ where }),
      this.prisma.comment.count({ where: { ...where, targetType: 'INVOICE' } }),
      this.prisma.notification.count({ where }),
      this.prisma.reminderPolicy.count({ where }),
      this.prisma.workflowRule.count({ where }),
      this.prisma.organizationInvitation.count({ where: { ...where, status: 'PENDING' } }),
      this.prisma.organization.count({}),
      this.prisma.journal.count({ where: { ...where, sourceType: null } }),
      this.prisma.ledgerAccount.count({ where: { ...where, systemSeed: false } }),
      this.prisma.attachment.count({ where }),
    ]);

    const [
      templateStates,
      timeStates,
      pendingApprovals,
      notificationStates,
      suspended,
      closed,
      journalStates,
    ] = await Promise.all([
      this.prisma.recurringInvoiceTemplate.groupBy({ by: ['active'], where, _count: true }),
      this.prisma.timeEntry.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.approvalRequest.count({ where: { ...where, status: 'PENDING' } }),
      this.prisma.notification.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.organization.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.fiscalPeriod.count({ where: { ...where, status: 'CLOSED' } }),
      this.prisma.journal.groupBy({ by: ['status'], where, _count: true }),
    ]);
    assert(
      templateStates.length === 2,
      'The demo week needs one active and one deactivated recurring invoice template.',
    );
    assert(
      ['SUBMITTED', 'APPROVED', 'DRAFT'].every((status) =>
        timeStates.some((row) => row.status === status),
      ),
      'The demo week is missing time entry states.',
    );
    assert(pendingApprovals >= 3, `Expected 3 pending approvals, found ${pendingApprovals}.`);
    assert(
      notificationStates.length === 2,
      'The demo week needs both read and unread notifications.',
    );
    assert(suspended >= 1, 'The demo week needs one suspended organization.');
    assert(closed >= 1, 'The demo week needs one closed fiscal period.');
    assert(
      ['DRAFT', 'POSTED', 'REVERSED'].every((status) =>
        journalStates.some((row) => row.status === status),
      ),
      'The demo week is missing draft, posted or reversed journals.',
    );
    assert(manualJournals >= 10, `Expected 10 manual journals, found ${manualJournals}.`);
    assert(customAccounts >= 3, `Expected 3 custom accounts, found ${customAccounts}.`);
    assert(tenants >= 3, `Expected the demo organization plus 2 extra tenants, found ${tenants}.`);
    if (attachments === 0) {
      this.logger.warn('No attachments were seeded - is object storage running?');
    }

    return {
      recurringInvoiceTemplates,
      recurringJournalTemplates,
      openingBalanceBatches,
      timeEntries,
      approvalPolicies,
      invoiceComments: comments,
      notifications,
      reminderPolicies,
      workflowRules,
      pendingInvitations: invitations,
      attachments,
    };
  }

  /**
   * Section 6's reporting checks, computed from the tables rather than a report so a pass means the
   * data supports the report: receivables ageing spans current/1-30/31-60, and the stock valuation
   * agrees with the inventory account on the ledger (a mismatch is logged, not fatal -- receipts
   * against a bill can legitimately sit in a clearing account).
   */
  private async verifyReporting(context: OrganizationContext): Promise<void> {
    const today = isoDate(dateOnly(new Date())).getTime();
    const open = await this.prisma.invoice.findMany({
      where: {
        organizationId: context.id,
        balanceMinor: { gt: 0n },
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
        dueDate: { not: null },
      },
      select: { dueDate: true },
    });
    const buckets = { current: 0, days1to30: 0, days31to60: 0 };
    for (const invoice of open) {
      const overdue = Math.floor((today - (invoice.dueDate as Date).getTime()) / 86_400_000);
      if (overdue <= 0) buckets.current += 1;
      else if (overdue <= 30) buckets.days1to30 += 1;
      else if (overdue <= 60) buckets.days31to60 += 1;
    }
    assert(
      buckets.current > 0 && buckets.days1to30 > 0 && buckets.days31to60 > 0,
      `Receivables ageing should span current, 1-30 and 31-60 days: ${JSON.stringify(buckets)}.`,
    );

    const [layers, inventoryAccount] = await Promise.all([
      this.prisma.valuationLayer.findMany({
        where: { organizationId: context.id },
        select: { costRemainingMinor: true },
      }),
      this.ledger.accountBySystemKey(context.id, 'inventory_asset'),
    ]);
    const valuation = layers.reduce((sum, layer) => sum + layer.costRemainingMinor, 0n);
    const ledgerLines = await this.prisma.journalLine.findMany({
      where: {
        organizationId: context.id,
        accountId: inventoryAccount.id,
        journal: { status: 'POSTED' },
      },
      select: { debitMinor: true, creditMinor: true },
    });
    const ledgerBalance = ledgerLines.reduce(
      (sum, line) => sum + line.debitMinor - line.creditMinor,
      0n,
    );
    if (valuation !== ledgerBalance) {
      this.logger.warn(
        `Inventory valuation ${valuation} differs from the inventory account balance ${ledgerBalance}.`,
      );
    }
  }

  /**
   * Six expenses across four categories: five posted on their own day (three from the till, two from
   * the bank) and one submitted for approval, which is the row the approvals screen needs.
   */
  private async seedExpenses(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_EXPENSES) {
      const paidThroughAccountId = await this.expenseAccount(context, definition.paidThroughCode);
      const expense = await this.step(context, `expense:${definition.key}:draft`, 'EXPENSE', () =>
        this.expenses.createDraft(
          context,
          owner,
          {
            payeeVendorId: definition.vendor ? this.vendorId(state, definition.vendor) : undefined,
            payeeName: definition.payeeName,
            expenseDate: week.day(definition.spentOn),
            paidThroughAccountId,
            categoryId: required(
              state.expenseCategories.get(definition.category),
              `Unknown expense category ${definition.category}.`,
            ),
            projectId: definition.project
              ? required(state.projects.get(definition.project), 'Unknown expense project.')
              : undefined,
            currency: definition.currency,
            amountMinor: definition.amountMinor,
            taxCodeId: definition.tax === 'standard' ? state.taxCodes.standard : undefined,
          },
          metadata,
        ),
      );
      state.expenses.set(definition.key, expense.id);
      if (definition.target === 'DRAFT') continue;
      if (definition.target === 'SUBMITTED') {
        await this.step(context, `expense:${definition.key}:submit`, 'EXPENSE', () =>
          this.expenses.submit(context, owner, expense.id, metadata),
        );
        continue;
      }

      await this.step(context, `expense:${definition.key}:post`, 'EXPENSE', () =>
        this.expenses.post(
          context,
          owner,
          expense.id,
          metadata,
          undefined,
          week.day(definition.spentOn),
        ),
      );
    }
  }

  /** The recurring bill and expense templates section 3 and 5c ask for. */
  private async seedRecurringPurchases(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_RECURRING_BILLS) {
      const accountId = definition.accountCode
        ? await this.expenseAccount(context, definition.accountCode)
        : undefined;
      await this.step(context, `recurring-bill:${definition.key}`, 'RECURRING_BILL_TEMPLATE', () =>
        this.recurringBills.createTemplate(
          context,
          owner,
          {
            vendorId: this.vendorId(state, definition.vendor),
            cadence: definition.cadence,
            startDate: week.day(definition.startsOn),
            currency: definition.currency,
            autoCreate: false,
            lines: definition.lines.map((line) => ({
              description: line.description,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              accountId,
            })),
          },
          metadata,
        ),
      );
    }

    for (const definition of WEEK_RECURRING_EXPENSES) {
      const paidThroughAccountId = await this.expenseAccount(context, definition.paidThroughCode);
      await this.step(
        context,
        `recurring-expense:${definition.key}`,
        'RECURRING_EXPENSE_TEMPLATE',
        () =>
          this.recurringExpenses.createTemplate(
            context,
            owner,
            {
              payeeVendorId: definition.vendor
                ? this.vendorId(state, definition.vendor)
                : undefined,
              payeeName: definition.payeeName,
              cadence: definition.cadence,
              startDate: week.day(definition.startsOn),
              autoCreate: definition.autoCreate ?? false,
              paidThroughAccountId,
              categoryId: required(
                state.expenseCategories.get(definition.category),
                `Unknown recurring expense category ${definition.category}.`,
              ),
              amountMinor: definition.amountMinor,
              taxCodeId: definition.tax === 'standard' ? state.taxCodes.standard : undefined,
            },
            metadata,
          ),
      );
    }
  }

  /**
   * Section 5c's banking module: three financial accounts, three rules (created before the imports
   * so their suggestions land on the rows), two transfers, two CSV statement imports (the second
   * carries a duplicate line and a malformed one), the resolved states -- matched, categorized,
   * excluded -- with the rest left unresolved, and one completed plus one open reconciliation.
   * Statement rows that must match a document are built from that document's real amount.
   */
  private async seedBankingWeek(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_FINANCIAL_ACCOUNTS) {
      const existing = await this.prisma.financialAccount.findFirst({
        where: { organizationId: context.id, name: definition.name },
        select: { id: true },
      });
      const account =
        existing ??
        (await this.financialAccounts.create(
          context,
          owner,
          {
            name: definition.name,
            type: definition.type,
            currency: 'KES',
            glAccountId: await this.expenseAccount(context, definition.glCode),
            openingBalanceMinor: definition.openingBalanceMinor,
          },
          metadata,
        ));
      state.financialAccounts.set(definition.slug, account.id);
    }
    const equity = this.financialAccountId(state, 'equity');
    const mpesa = this.financialAccountId(state, 'mpesa');
    const cash = this.financialAccountId(state, 'cash');

    for (const definition of WEEK_BANK_RULES) {
      const suggestAccountId = await this.expenseAccount(context, definition.accountCode);
      await this.step(context, `bank-rule:${definition.key}`, 'BANK_RULE', () =>
        this.bankRules.create(
          context,
          owner,
          {
            name: definition.name,
            priority: definition.priority,
            matchAny: false,
            conditions: [
              { field: 'description', operator: 'contains', value: definition.contains },
            ],
            suggestAccountId,
            suggestVendorId: definition.vendor
              ? this.vendorId(state, definition.vendor)
              : undefined,
            stopOnMatch: true,
          },
          metadata,
        ),
      );
    }

    const transfers: [string, string, string, string, number][] = [
      ['to-cash', equity, cash, '5000000', -5],
      ['to-mpesa', equity, mpesa, '2000000', -3],
    ];
    for (const [key, from, to, amountMinor, on] of transfers) {
      const transfer = await this.step(context, `bank-transfer:${key}`, 'TRANSFER', () =>
        this.transfers.create(
          context,
          owner,
          {
            fromFinancialAccountId: from,
            toFinancialAccountId: to,
            transferDate: week.day(on),
            fromAmountMinor: amountMinor,
            toAmountMinor: amountMinor,
            description: key === 'to-cash' ? 'Petty cash top-up' : 'M-Pesa float top-up',
          },
          metadata,
        ),
      );
      state.transfers.set(key, transfer.id);
    }

    const receipts = await this.prisma.paymentReceived.findMany({
      where: { organizationId: context.id, currency: 'KES' },
      orderBy: [{ receivedDate: 'asc' }, { createdAt: 'asc' }],
      take: 2,
      select: { id: true, receivedDate: true, amountMinor: true },
    });
    const utilitiesPayment = await this.prisma.paymentMade.findUniqueOrThrow({
      where: {
        id: required(state.paymentsMade.get('utilities-full'), 'Missing the utilities payment.'),
      },
      select: { paidDate: true, amountMinor: true },
    });
    const [rentExpense, adsExpense] = await Promise.all([
      this.prisma.expense.findUniqueOrThrow({
        where: { id: required(state.expenses.get('rent'), 'Missing the rent expense.') },
        select: { expenseDate: true, totalMinor: true },
      }),
      this.prisma.expense.findUniqueOrThrow({
        where: { id: required(state.expenses.get('ads'), 'Missing the ads expense.') },
        select: { expenseDate: true, totalMinor: true },
      }),
    ]);

    const equityRows: StatementRow[] = [
      {
        key: 'rent',
        date: dateOnly(rentExpense.expenseDate),
        description: 'STANDING ORDER PRIME PROPERTIES RENT',
        reference: 'SO-0912',
        amountMinor: -rentExpense.totalMinor,
      },
      {
        key: 'ads',
        date: dateOnly(adsExpense.expenseDate),
        description: 'GOOGLE ADS CARD PAYMENT',
        reference: 'CARD-4410',
        amountMinor: -adsExpense.totalMinor,
      },
      ...receipts.map((receipt, index) => ({
        key: `receipt-${index + 1}`,
        date: dateOnly(receipt.receivedDate),
        description: `CUSTOMER TRANSFER RECEIVED ${index + 1}`,
        reference: `RCV-${index + 1}`,
        amountMinor: receipt.amountMinor,
      })),
      {
        key: 'supplier',
        date: dateOnly(utilitiesPayment.paidDate),
        description: 'EFT KENYA POWER AND LIGHTING',
        reference: 'EFT-2201',
        amountMinor: -utilitiesPayment.amountMinor,
      },
      {
        key: 'transfer',
        date: week.day(-5),
        description: 'TRANSFER TO PETTY CASH',
        reference: 'TRF-01',
        amountMinor: -5000000n,
      },
      {
        key: 'charges',
        date: week.day(-4),
        description: 'EQUITY BANK CHARGES SEP',
        amountMinor: -45000n,
      },
      { key: 'interest', date: week.day(-4), description: 'INTEREST CREDIT', amountMinor: 12000n },
      {
        key: 'fuel',
        date: week.day(-3),
        description: 'SHELL WESTLANDS FUEL',
        reference: 'POS-7731',
        amountMinor: -180000n,
      },
      {
        key: 'kplc',
        date: week.day(-2),
        description: 'KPLC POSTPAID SEP',
        reference: 'KPLC-9921',
        amountMinor: -1850000n,
      },
      {
        key: 'atm',
        date: week.day(-1),
        description: 'ATM WITHDRAWAL NAIROBI CBD',
        amountMinor: -2000000n,
      },
      {
        key: 'deposit',
        date: week.day(0),
        description: 'ONLINE CUSTOMER DEPOSIT',
        reference: 'DEP-5510',
        amountMinor: 3500000n,
      },
      {
        key: 'reversed',
        date: week.day(-3),
        description: 'CARD AUTH REVERSED',
        amountMinor: 150000n,
      },
      {
        key: 'advance',
        date: week.day(-2),
        description: 'STAFF ADVANCE REPAYMENT',
        amountMinor: 500000n,
      },
    ];
    const mpesaRows: StatementRow[] = [
      {
        key: 'transfer',
        date: week.day(-3),
        description: 'TRANSFER FROM EQUITY BANK',
        reference: 'TRF-02',
        amountMinor: 2000000n,
      },
      {
        key: 'sale-1',
        date: week.day(-4),
        description: 'M-PESA TILL 5512 SALES',
        reference: 'MP24A',
        amountMinor: 1240000n,
      },
      {
        key: 'sale-1-dup',
        date: week.day(-4),
        description: 'M-PESA TILL 5512 SALES',
        reference: 'MP24A',
        amountMinor: 1240000n,
      },
      {
        key: 'sale-2',
        date: week.day(-3),
        description: 'M-PESA TILL 5512 SALES',
        reference: 'MP24B',
        amountMinor: 820000n,
      },
      {
        key: 'sale-3',
        date: week.day(-1),
        description: 'M-PESA TILL 5512 SALES',
        reference: 'MP24C',
        amountMinor: 375000n,
      },
      {
        key: 'airtime',
        date: week.day(-2),
        description: 'SAFARICOM AIRTIME BUNDLES',
        amountMinor: -50000n,
      },
      { key: 'ride', date: week.day(-2), description: 'BOLT RIDE NAIROBI', amountMinor: -150000n },
      {
        key: 'groceries',
        date: week.day(-1),
        description: 'NAIVAS SUPERMARKET',
        amountMinor: -220000n,
      },
    ];

    await this.step(context, 'statement-import:equity', 'STATEMENT_IMPORT', () =>
      this.statementImports.import(
        context,
        owner,
        equity,
        this.csvFile('equity-current-sep.csv', equityRows),
        metadata,
      ),
    );
    await this.step(context, 'statement-import:mpesa', 'STATEMENT_IMPORT', () =>
      this.statementImports.import(
        context,
        owner,
        mpesa,
        this.csvFile('mpesa-till-sep.csv', mpesaRows, [
          '24/09,MALFORMED ROW WITH BAD DATE,100.00,BAD-1',
        ]),
        metadata,
      ),
    );

    const transactionId = async (accountId: string, description: string, reference?: string) =>
      (
        await this.prisma.bankTransaction.findFirstOrThrow({
          where: {
            financialAccountId: accountId,
            description,
            ...(reference ? { reference } : {}),
          },
          select: { id: true },
        })
      ).id;

    const matches: {
      key: string;
      description: string;
      reference: string;
      account: string;
      targetType: 'PAYMENT_RECEIVED' | 'PAYMENT_MADE' | 'EXPENSE' | 'TRANSFER';
      targetId: string;
    }[] = [
      {
        key: 'rent',
        description: 'STANDING ORDER PRIME PROPERTIES RENT',
        reference: 'SO-0912',
        account: equity,
        targetType: 'EXPENSE',
        targetId: required(state.expenses.get('rent'), 'Missing the rent expense.'),
      },
      {
        key: 'ads',
        description: 'GOOGLE ADS CARD PAYMENT',
        reference: 'CARD-4410',
        account: equity,
        targetType: 'EXPENSE',
        targetId: required(state.expenses.get('ads'), 'Missing the ads expense.'),
      },
      ...receipts.map((receipt, index) => ({
        key: `receipt-${index + 1}`,
        description: `CUSTOMER TRANSFER RECEIVED ${index + 1}`,
        reference: `RCV-${index + 1}`,
        account: equity,
        targetType: 'PAYMENT_RECEIVED' as const,
        targetId: receipt.id,
      })),
      {
        key: 'supplier',
        description: 'EFT KENYA POWER AND LIGHTING',
        reference: 'EFT-2201',
        account: equity,
        targetType: 'PAYMENT_MADE',
        targetId: required(
          state.paymentsMade.get('utilities-full'),
          'Missing the utilities payment.',
        ),
      },
      {
        key: 'transfer',
        description: 'TRANSFER TO PETTY CASH',
        reference: 'TRF-01',
        account: equity,
        targetType: 'TRANSFER',
        targetId: required(state.transfers.get('to-cash'), 'Missing the petty cash transfer.'),
      },
      {
        key: 'mpesa-transfer',
        description: 'TRANSFER FROM EQUITY BANK',
        reference: 'TRF-02',
        account: mpesa,
        targetType: 'TRANSFER',
        targetId: required(state.transfers.get('to-mpesa'), 'Missing the M-Pesa transfer.'),
      },
    ];
    for (const match of matches) {
      const id = await transactionId(match.account, match.description, match.reference);
      await this.step(context, `bank-tx:${match.key}:match`, 'BANK_MATCH', () =>
        this.bankTransactions.match(
          context,
          owner,
          id,
          { targetType: match.targetType, targetId: match.targetId },
          metadata,
        ),
      );
    }

    const categorizations = [
      { key: 'charges', description: 'EQUITY BANK CHARGES SEP', accountCode: '5130' },
      { key: 'interest', description: 'INTEREST CREDIT', accountCode: '4030' },
      { key: 'fuel', description: 'SHELL WESTLANDS FUEL', accountCode: '5080' },
    ];
    for (const categorization of categorizations) {
      const id = await transactionId(equity, categorization.description);
      const transaction = await this.prisma.bankTransaction.findUniqueOrThrow({
        where: { id },
        select: { amountMinor: true },
      });
      const accountId = await this.expenseAccount(context, categorization.accountCode);
      await this.step(context, `bank-tx:${categorization.key}:categorize`, 'BANK_CATEGORIZE', () =>
        this.bankTransactions.categorize(
          context,
          owner,
          id,
          {
            lines: [{ accountId, amountMinor: transaction.amountMinor.toString() }],
          },
          metadata,
        ),
      );
    }

    const excludedId = await transactionId(equity, 'CARD AUTH REVERSED');
    await this.step(context, 'bank-tx:reversed:exclude', 'BANK_EXCLUDE', () =>
      this.bankTransactions.exclude(
        context,
        owner,
        excludedId,
        'Bank reversed the card authorisation - no ledger effect',
        metadata,
      ),
    );

    await this.seedReconciliations(context, owner, metadata, week, equity, mpesa);
  }

  private async seedReconciliations(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    equity: string,
    mpesa: string,
  ): Promise<void> {
    const clearedRows = await this.prisma.bankTransaction.findMany({
      where: {
        financialAccountId: equity,
        disposition: { in: ['MATCHED', 'POSTED'] },
      },
      select: { id: true, amountMinor: true, direction: true },
    });
    const signed = (row: { amountMinor: bigint; direction: string }) =>
      row.direction === 'INFLOW' ? row.amountMinor : -row.amountMinor;
    const equityClosing = clearedRows.reduce((sum, row) => sum + signed(row), 0n);

    const completed = await this.step(
      context,
      'reconciliation:equity:start',
      'RECONCILIATION',
      () =>
        this.reconciliations.start(
          context,
          owner,
          {
            financialAccountId: equity,
            statementStartDate: week.day(-8),
            statementEndDate: week.day(0),
            openingBalanceMinor: '0',
            closingBalanceMinor: equityClosing.toString(),
          },
          metadata,
        ),
    );
    await this.step(context, 'reconciliation:equity:clear', 'RECONCILIATION', async () => {
      await this.reconciliations.setCleared(
        context,
        owner,
        completed.id,
        { transactionIds: clearedRows.map((row) => row.id) },
        metadata,
        true,
      );
      return { id: completed.id };
    });
    await this.step(context, 'reconciliation:equity:complete', 'RECONCILIATION', () =>
      this.reconciliations.complete(context, owner, completed.id, metadata),
    );

    // The open one is deliberately out of balance: the screen shows a live difference to work down.
    const open = await this.step(context, 'reconciliation:mpesa:start', 'RECONCILIATION', () =>
      this.reconciliations.start(
        context,
        owner,
        {
          financialAccountId: mpesa,
          statementStartDate: week.day(-8),
          statementEndDate: week.day(0),
          openingBalanceMinor: '0',
          closingBalanceMinor: '5000000',
        },
        metadata,
      ),
    );
    const mpesaCleared = await this.prisma.bankTransaction.findMany({
      where: { financialAccountId: mpesa, disposition: 'MATCHED' },
      select: { id: true },
    });
    await this.step(context, 'reconciliation:mpesa:clear', 'RECONCILIATION', async () => {
      await this.reconciliations.setCleared(
        context,
        owner,
        open.id,
        { transactionIds: mpesaCleared.map((row) => row.id) },
        metadata,
        true,
      );
      return { id: open.id };
    });
  }

  private financialAccountId(state: WeekState, slug: string): string {
    return required(state.financialAccounts.get(slug), `Unknown seeded financial account ${slug}.`);
  }

  /** A statement CSV in the importer's own format, with optional raw lines appended verbatim. */
  private csvFile(name: string, rows: readonly StatementRow[], rawLines: readonly string[] = []) {
    const lines = [
      'date,description,amount,reference',
      ...rows.map(
        (row) =>
          `${row.date},${row.description},${minorToDecimal(row.amountMinor)},${row.reference ?? ''}`,
      ),
      ...rawLines,
    ];
    const buffer = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
    return { originalname: name, mimetype: 'text/csv', size: buffer.length, buffer };
  }

  private customerId(state: WeekState, slug: string): string {
    return required(state.customers.get(slug), `Unknown seeded customer ${slug}.`);
  }
  /**
   * Creates a draft and issues it on `issuedOn`. Two steps rather than one so a re-run adopts both
   * halves of the pair; the returned id is what the payment, credit-note and collections steps key
   * off. `issuedOn` is the seed's backdated path -- document date, journal date and number
   * allocation all land on the same day.
   */
  private async issueInvoice(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    input: {
      key: string;
      contactId: string;
      issuedOn: string;
      dueDate?: string;
      currency?: string;
      lines: InvoiceLineDto[];
    },
  ): Promise<string> {
    const draft = await this.step(context, `invoice:${input.key}:draft`, 'INVOICE', () =>
      this.invoices.createDraft(
        context,
        owner,
        {
          contactId: input.contactId,
          dueDate: input.dueDate,
          currency: input.currency,
          lines: input.lines,
        },
        metadata,
      ),
    );
    await this.step(context, `invoice:${input.key}:issue`, 'INVOICE', () =>
      this.invoices.issueInvoice(context, owner, draft.id, metadata, undefined, input.issuedOn),
    );
    return draft.id;
  }

  /**
   * The sales week, following section 4 day by day. Two invoices are deliberately issued *before* the
   * window so receivables ageing shows 1-30 and 31-60 buckets alongside current, and the rest land on
   * their own day so the dashboard's "this week" figures are not one spike. Everything the week's
   * later steps need -- payments, credit notes, the unissued draft -- hangs off the ids collected
   * here.
   */
  /** Section 3's five vendors, matched on `displayName` so a re-run adopts what exists. */
  private async ensureVendors(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_VENDORS) {
      const existing = await this.prisma.vendor.findFirst({
        where: { organizationId: context.id, displayName: definition.displayName },
        select: { id: true },
      });
      const vendor =
        existing ??
        (await this.vendors.create(
          context,
          owner,
          { displayName: definition.displayName, ...definition.dto },
          metadata,
        ));
      state.vendors.set(definition.slug, vendor.id);
    }
  }

  /**
   * Section 3's five expense categories, each mapped to a real starter-chart expense account so
   * posting an expense moves an account a report can name rather than the generic catch-all.
   */
  private async ensureExpenseCategories(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_EXPENSE_CATEGORIES) {
      const existing = await this.prisma.expenseCategory.findFirst({
        where: { organizationId: context.id, name: definition.name },
        select: { id: true },
      });
      const account = await this.expenseAccount(context, definition.accountCode);
      const category =
        existing ??
        (await this.expenseCategories.create(
          context,
          owner,
          { name: definition.name, accountId: account },
          metadata,
        ));
      state.expenseCategories.set(definition.slug, category.id);
    }
  }

  private async expenseAccount(context: OrganizationContext, code: string): Promise<string> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { organizationId: context.id, code },
      select: { id: true },
    });
    if (account) return account.id;
    return (await this.ledger.accountBySystemKey(context.id, 'general_expense')).id;
  }

  private async seedPurchasesWeek(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    await this.seedPurchaseOrders(context, owner, metadata, week, state);
    await this.seedBills(context, owner, metadata, week, state);
    await this.seedPaymentsMade(context, owner, metadata, week, state);
    await this.seedVendorCredits(context, owner, metadata, week, state);
    await this.seedExpenses(context, owner, metadata, week, state);
    await this.seedRecurringPurchases(context, owner, metadata, week, state);
  }

  /**
   * Section 5a's purchase-order ladder plus the receipt half of section 5b: one order per status, one
   * fully received against the Monday goods receipt, and one left partly received. Receipts go through
   * the seed's `businessDate` override so the inbound stock layer lands on the right day, and receipt
   * lines reference the order's own line ids, exactly as the receiving screen does.
   */
  private async seedPurchaseOrders(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_PURCHASE_ORDERS) {
      const order = await this.step(context, `po:${definition.key}:draft`, 'PURCHASE_ORDER', () =>
        this.purchaseOrders.createDraft(
          context,
          owner,
          {
            vendorId: this.vendorId(state, definition.vendor),
            currency: definition.currency,
            expectedDeliveryDate: week.day(definition.expectedOn),
            lines: definition.lines.map((line) =>
              line.item
                ? {
                    itemId: required(state.items.get(line.item), `Unknown PO item ${line.item}.`),
                    quantity: line.quantity,
                    unitPriceMinor: line.unitPriceMinor,
                    warehouseId: line.warehouse ? state.warehouses[line.warehouse] : undefined,
                  }
                : {
                    description: line.description,
                    quantity: line.quantity,
                    unitPriceMinor: line.unitPriceMinor,
                  },
            ),
          },
          metadata,
        ),
      );
      state.purchaseOrders.set(definition.key, order.id);
      if (definition.target === 'DRAFT') continue;

      await this.step(context, `po:${definition.key}:approve`, 'PURCHASE_ORDER', () =>
        this.purchaseOrders.approve(context, owner, order.id, metadata),
      );
      if (definition.target === 'APPROVED') continue;

      await this.step(context, `po:${definition.key}:issue`, 'PURCHASE_ORDER', () =>
        this.purchaseOrders.issue(context, owner, order.id, metadata),
      );
      if (definition.target === 'CANCELLED') {
        await this.step(context, `po:${definition.key}:cancel`, 'PURCHASE_ORDER', () =>
          this.purchaseOrders.cancel(context, owner, order.id, metadata),
        );
        continue;
      }
      if (definition.target === 'CLOSED') {
        await this.step(context, `po:${definition.key}:close`, 'PURCHASE_ORDER', () =>
          this.purchaseOrders.close(context, owner, order.id, metadata),
        );
        continue;
      }
      if (!definition.receipt) continue;

      const detail = await this.purchaseOrders.detail(context.id, order.id);
      const linesByItem = new Map(
        detail.lines
          .filter((line) => line.itemId !== null)
          .map((line) => [line.itemId as string, line.id]),
      );
      const receiptLines = definition.receipt.lines.map((line) => ({
        purchaseOrderLineId: required(
          linesByItem.get(
            required(state.items.get(line.item), `Unknown receipt item ${line.item}.`),
          ),
          `The order has no line for ${line.item}.`,
        ),
        quantity: line.quantity,
        warehouseId: state.warehouses[line.warehouse ?? 'main'],
      }));
      await this.step(context, `po:${definition.key}:receipt`, 'PURCHASE_ORDER', () =>
        this.purchaseOrders.recordReceipt(
          context,
          owner,
          order.id,
          { lines: receiptLines },
          metadata,
          undefined,
          week.day(definition.receipt!.on),
        ),
      );
    }
  }

  private vendorId(state: WeekState, slug: string): string {
    return required(state.vendors.get(slug), `Unknown seeded vendor ${slug}.`);
  }

  /**
   * One bill per status, including the one created from the received purchase order (which increments
   * that order's billed figure) and an overdue one so payables ageing is not empty. Bills are issued
   * through the backdated path, so the bill date and its AP journal land on the same day.
   */
  private async seedBills(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_BILLS) {
      const purchaseOrder = definition.purchaseOrder
        ? await this.purchaseOrders.detail(
            context.id,
            required(state.purchaseOrders.get(definition.purchaseOrder), 'Unknown seeded PO.'),
          )
        : null;
      const linesByItem = new Map(
        (purchaseOrder?.lines ?? [])
          .filter((line) => line.itemId !== null)
          .map((line) => [line.itemId as string, line.id]),
      );
      const defaultAccountId = definition.accountCode
        ? await this.expenseAccount(context, definition.accountCode)
        : undefined;
      const accountByCode = new Map<string, string>();
      for (const line of definition.lines) {
        if (line.accountCode && !accountByCode.has(line.accountCode)) {
          accountByCode.set(line.accountCode, await this.expenseAccount(context, line.accountCode));
        }
      }

      const bill = await this.step(context, `bill:${definition.key}:draft`, 'BILL', () =>
        this.bills.createDraft(
          context,
          owner,
          {
            vendorId: this.vendorId(state, definition.vendor),
            purchaseOrderId: purchaseOrder?.id,
            vendorReference: definition.vendorReference,
            dueDate: week.day(definition.dueOn),
            currency: definition.currency,
            lines: definition.lines.map((line) => ({
              itemId: line.item
                ? required(state.items.get(line.item), `Unknown bill item ${line.item}.`)
                : undefined,
              purchaseOrderLineId: line.item
                ? linesByItem.get(required(state.items.get(line.item), 'Unknown bill item.'))
                : undefined,
              description: line.description,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              accountId: line.accountCode ? accountByCode.get(line.accountCode) : defaultAccountId,
            })),
          },
          metadata,
        ),
      );
      state.bills.set(definition.key, bill.id);
      if (definition.target === 'DRAFT') continue;

      await this.step(context, `bill:${definition.key}:issue`, 'BILL', () =>
        this.bills.issueBill(
          context,
          owner,
          bill.id,
          metadata,
          undefined,
          week.day(definition.issuedOn),
        ),
      );
      if (definition.target === 'VOID') {
        await this.step(context, `bill:${definition.key}:void`, 'BILL', () =>
          this.bills.voidBill(context, owner, bill.id, metadata),
        );
      }
    }
  }

  /**
   * Three vendor payments: one settling a bill in full, one half-paying another, and one left
   * unapplied so the payments-made screen shows all three allocation states.
   */
  private async seedPaymentsMade(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_PAYMENTS_MADE) {
      const billId = required(
        state.bills.get(definition.bill),
        `Payment made ${definition.key} references unknown bill ${definition.bill}.`,
      );
      const bill = await this.prisma.bill.findUniqueOrThrow({
        where: { id: billId },
        select: { balanceMinor: true, currency: true },
      });
      const amountMinor =
        definition.fraction === 'half' ? bill.balanceMinor / 2n : bill.balanceMinor;
      if (amountMinor <= 0n) continue;

      const payment = await this.step(
        context,
        `payment-made:${definition.key}:record`,
        'PAYMENT_MADE',
        () =>
          this.paymentsMade.record(
            context,
            owner,
            {
              vendorId: this.vendorId(state, definition.vendor),
              paidDate: week.day(definition.paidOn),
              currency: definition.currency ?? bill.currency,
              amountMinor: amountMinor.toString(),
            },
            metadata,
          ),
      );
      state.paymentsMade.set(definition.key, payment.id);
      if (!definition.allocate) continue;

      await this.step(context, `payment-made:${definition.key}:allocate`, 'PAYMENT_MADE', () =>
        this.paymentsMade.allocate(
          context,
          owner,
          payment.id,
          { allocations: [{ billId, amountMinor: amountMinor.toString() }] },
          metadata,
        ),
      );
    }
  }

  /**
   * Vendor credits covering section 5a's DRAFT, ISSUED, APPLIED and VOID: one applied against the
   * bill from the purchase order, one voided, one left issued and one in draft.
   */
  private async seedVendorCredits(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_VENDOR_CREDITS) {
      const defaultAccountId = definition.accountCode
        ? await this.expenseAccount(context, definition.accountCode)
        : undefined;
      const credit = await this.step(
        context,
        `vendor-credit:${definition.key}:draft`,
        'VENDOR_CREDIT',
        () =>
          this.vendorCredits.createDraft(
            context,
            owner,
            {
              vendorId: this.vendorId(state, definition.vendor),
              currency: definition.currency,
              lines: definition.lines.map((line) => ({
                itemId: line.item
                  ? required(state.items.get(line.item), `Unknown credit item ${line.item}.`)
                  : undefined,
                description: line.description,
                quantity: line.quantity,
                unitPriceMinor: line.unitPriceMinor,
                accountId: defaultAccountId,
              })),
            },
            metadata,
          ),
      );
      state.vendorCredits.set(definition.key, credit.id);
      if (definition.target === 'DRAFT') continue;

      await this.step(context, `vendor-credit:${definition.key}:issue`, 'VENDOR_CREDIT', () =>
        this.vendorCredits.issueVendorCredit(
          context,
          owner,
          credit.id,
          metadata,
          undefined,
          week.day(definition.issuedOn),
        ),
      );

      if (definition.target === 'VOID') {
        await this.step(context, `vendor-credit:${definition.key}:void`, 'VENDOR_CREDIT', () =>
          this.vendorCredits.voidVendorCredit(context, owner, credit.id, metadata),
        );
        continue;
      }
      if (definition.target !== 'APPLIED') continue;

      const billId = required(
        state.bills.get(required(definition.bill, 'An applied vendor credit needs a bill.')),
        'Applied vendor credit references an unknown bill.',
      );
      const [issued, bill] = await Promise.all([
        this.prisma.vendorCredit.findUniqueOrThrow({
          where: { id: credit.id },
          select: { remainingMinor: true },
        }),
        this.prisma.bill.findUniqueOrThrow({
          where: { id: billId },
          select: { balanceMinor: true },
        }),
      ]);
      const amountMinor =
        issued.remainingMinor < bill.balanceMinor ? issued.remainingMinor : bill.balanceMinor;
      if (amountMinor > 0n) {
        await this.step(context, `vendor-credit:${definition.key}:allocate`, 'VENDOR_CREDIT', () =>
          this.vendorCredits.allocate(
            context,
            owner,
            credit.id,
            { allocations: [{ billId, amountMinor: amountMinor.toString() }] },
            metadata,
            undefined,
            week.day(definition.issuedOn),
          ),
        );
      }
    }
  }

  private async seedSalesWeek(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    for (const definition of WEEK_INVOICES) {
      const id = await this.issueInvoice(context, owner, metadata, {
        key: definition.key,
        contactId: this.customerId(state, definition.customer),
        issuedOn: week.day(definition.issuedOn),
        dueDate: week.day(definition.dueOn === 'receipt' ? definition.issuedOn : definition.dueOn),
        currency: definition.currency,
        lines: definition.lines.map((line) =>
          this.line(state, line.item, line.quantity, line.unitPriceMinor, {
            tax: line.tax,
            projectSlug: line.project,
            warehouse: line.warehouse,
          }),
        ),
      });
      state.invoices.set(definition.key, id);
    }

    // An invoice that never leaves DRAFT: the list's draft filter and the draft-only guards
    // (delete, issue-after-edit) need a subject that is not part of a chain.
    const draft = await this.step(context, 'invoice:unissued:draft', 'INVOICE', () =>
      this.invoices.createDraft(
        context,
        owner,
        {
          contactId: this.customerId(state, 'credit'),
          dueDate: week.day(24),
          lines: [this.line(state, 'install', '3', '85000', { projectSlug: 'westlands-fitout' })],
        },
        metadata,
      ),
    );
    state.invoices.set('unissued', draft.id);

    await this.seedQuotesAndOrders(context, owner, metadata, week, state);
    await this.seedPayments(context, owner, metadata, week, state);
    await this.seedCreditNotes(context, owner, metadata, week, state);
    await this.seedCollections(context, owner, metadata, week, state);
  }
}

/**
 * The date anchor for the whole week. `day(0)` is the run day, `day(-6)` the start of the window, so
 * the seed produces a fresh week whenever it runs instead of a window that decays into the past.
 */
export class WeekDates {
  constructor(private readonly today: string) {}

  day(offset: number): string {
    const date = isoDate(this.today);
    date.setUTCDate(date.getUTCDate() + offset);
    return dateOnly(date);
  }

  /** All offsets in the window, oldest first, for sweeps that must stay deterministic. */
  offsets(): number[] {
    return Array.from({ length: WEEK_LENGTH_DAYS }, (_, index) => index - (WEEK_LENGTH_DAYS - 1));
  }
}

/**
 * Ids collected while seeding, so later steps can reference earlier records without re-querying.
 * Master data is keyed by the stable slug used in this file; transactions by their step key.
 */
export interface WeekState {
  taxCodes: { standard: string; zero: string; exempt: string };
  customers: Map<string, string>;
  items: Map<string, string>;
  warehouses: { main: string; westlands: string };
  projects: Map<string, string>;
  invoices: Map<string, string>;
  quotes: Map<string, string>;
  orders: Map<string, string>;
  payments: Map<string, string>;
  creditNotes: Map<string, string>;
  vendors: Map<string, string>;
  expenseCategories: Map<string, string>;
  purchaseOrders: Map<string, string>;
  bills: Map<string, string>;
  paymentsMade: Map<string, string>;
  vendorCredits: Map<string, string>;
  expenses: Map<string, string>;
  financialAccounts: Map<string, string>;
  transfers: Map<string, string>;
}

function createWeekState(): WeekState {
  return {
    taxCodes: { standard: '', zero: '', exempt: '' },
    customers: new Map(),
    items: new Map(),
    warehouses: { main: '', westlands: '' },
    projects: new Map(),
    invoices: new Map(),
    quotes: new Map(),
    orders: new Map(),
    payments: new Map(),
    creditNotes: new Map(),
    vendors: new Map(),
    expenseCategories: new Map(),
    purchaseOrders: new Map(),
    bills: new Map(),
    paymentsMade: new Map(),
    vendorCredits: new Map(),
    expenses: new Map(),
    financialAccounts: new Map(),
    transfers: new Map(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface WeekCustomerDefinition {
  slug: string;
  displayName: string;
  dto: Omit<CreateContactDto, 'displayName'>;
}

/**
 * Eight customers covering section 3's edge cases: an overdue-prone one on 30-day terms, a name long
 * enough to exercise list truncation, a USD customer, one with no email at all, a walk-in with no
 * terms, one sitting in credit after a credit note, a deactivated account, and a steady regular.
 */
const WEEK_CUSTOMERS: readonly WeekCustomerDefinition[] = [
  {
    slug: 'overdue',
    displayName: 'Tumaini Hardware & General Stores Ltd',
    dto: {
      email: 'accounts@tumaini-hardware.example',
      phone: '+254733111222',
      currency: 'KES',
      paymentTermsDays: 30,
      tags: ['Demo week', 'Collections risk'],
      addresses: [
        {
          kind: 'BILLING',
          line1: 'Shop 14, Kenyatta Avenue',
          city: 'Nakuru',
          countryCode: 'KE',
          isDefault: true,
        },
      ],
    },
  },
  {
    slug: 'longname',
    displayName: 'Mombasa Road Wholesale Distributors and Retail Suppliers Limited',
    dto: {
      email: 'finance@mombasa-road-distributors.example',
      currency: 'KES',
      paymentTermsDays: 30,
      tags: ['Demo week', 'Long name'],
    },
  },
  {
    slug: 'usd',
    displayName: 'Nairobi Tech Imports Ltd',
    dto: {
      email: 'ap@nairobitechimports.example',
      currency: 'USD',
      paymentTermsDays: 14,
      tags: ['Demo week', 'USD'],
    },
  },
  { slug: 'no-email', displayName: 'Wanjiru Grocers', dto: { phone: '+254701222333' } },
  { slug: 'walkin', displayName: 'Walk-in customer', dto: { paymentTermsDays: 0 } },
  {
    slug: 'credit',
    displayName: 'Kilimani Interiors Ltd',
    dto: { email: 'hello@kilimani-interiors.example', paymentTermsDays: 15, tags: ['Demo week'] },
  },
  {
    slug: 'deactivated',
    displayName: 'Coastal Supplies Ltd (closed account)',
    dto: { email: 'closed@coastal-supplies.example', phone: '+254711999000' },
  },
  {
    slug: 'regular',
    displayName: 'Westlands Pharmacy Ltd',
    dto: { email: 'admin@westlands-pharmacy.example', paymentTermsDays: 30, tags: ['Demo week'] },
  },
];

interface WeekItemDefinition {
  slug: string;
  name: string;
  zeroRated?: boolean;
  dto: Omit<
    CreateItemDto,
    'name' | 'defaultUnitId' | 'defaultTaxCodeId' | 'defaultPurchaseTaxCodeId'
  >;
}

const KES = (minor: string) => [{ currency: 'KES', unitPriceMinor: minor }];

/**
 * Twelve items: seven tracked goods (three deliberately left below their reorder point once the
 * week's receipts are in), three services, two non-inventory resale lines.
 */
const WEEK_ITEMS: readonly WeekItemDefinition[] = [
  {
    slug: 'tiles',
    name: 'Ceramic floor tiles 60x60 (box of 4)',
    dto: {
      sku: 'TILE-6060',
      itemType: 'GOODS',
      inventoryTracked: true,
      salesDescription: 'Glazed ceramic floor tiles, four pieces per box.',
      prices: KES('145000'),
      reorderThreshold: '40',
      reorderQuantity: '60',
    },
  },
  {
    slug: 'tank',
    name: 'Water storage tank 1000L',
    dto: {
      sku: 'TANK-1000',
      itemType: 'GOODS',
      inventoryTracked: true,
      prices: KES('1250000'),
      reorderThreshold: '6',
      reorderQuantity: '4',
    },
  },
  {
    slug: 'padlock',
    name: 'Heavy-duty padlock 50mm',
    dto: {
      sku: 'LOCK-HD',
      itemType: 'GOODS',
      inventoryTracked: true,
      prices: KES('68500'),
      reorderThreshold: '30',
      reorderQuantity: '40',
    },
  },
  {
    slug: 'paint',
    name: 'Weatherguard paint 4L (white)',
    dto: {
      sku: 'PAINT-4LW',
      itemType: 'GOODS',
      inventoryTracked: true,
      prices: KES('320000'),
      reorderThreshold: '25',
      reorderQuantity: '30',
    },
  },
  {
    slug: 'cement',
    name: 'Cement 50kg bag',
    zeroRated: true,
    dto: {
      sku: 'CEM-50',
      itemType: 'GOODS',
      inventoryTracked: true,
      prices: KES('78000'),
      reorderThreshold: '200',
      reorderQuantity: '400',
    },
  },
  {
    slug: 'solar',
    name: 'Solar LED lamp 20W',
    dto: {
      sku: 'SOLAR-20W',
      itemType: 'GOODS',
      inventoryTracked: true,
      prices: KES('195000'),
      reorderThreshold: '20',
      reorderQuantity: '25',
    },
  },
  {
    slug: 'tyre',
    name: 'Bicycle tyre 26 inch',
    dto: {
      sku: 'TYRE-26',
      itemType: 'GOODS',
      inventoryTracked: true,
      prices: KES('95000'),
      reorderThreshold: '15',
      reorderQuantity: '20',
    },
  },
  {
    slug: 'delivery',
    name: 'Delivery and handling',
    dto: {
      sku: 'SVC-DELIVERY',
      itemType: 'SERVICE',
      purchaseEnabled: false,
      prices: KES('120000'),
    },
  },
  {
    slug: 'install',
    name: 'Installation labour (per hour)',
    dto: { sku: 'SVC-INSTALL', itemType: 'SERVICE', purchaseEnabled: false, prices: KES('85000') },
  },
  {
    slug: 'survey',
    name: 'Site survey and quotation visit',
    zeroRated: true,
    dto: { sku: 'SVC-SURVEY', itemType: 'SERVICE', purchaseEnabled: false, prices: KES('250000') },
  },
  {
    slug: 'airfreshener',
    name: 'Air freshener sachets (resale pack)',
    dto: { sku: 'NS-AIR', itemType: 'NON_STOCK', prices: KES('25000') },
  },
  {
    slug: 'consumables',
    name: 'Hardware consumables kit',
    dto: { sku: 'NS-KIT', itemType: 'NON_STOCK', prices: KES('45000') },
  },
];

interface WeekOpeningStockDefinition {
  item: string;
  quantity: string;
  /** Total cost of the opening layer, in base-currency minor units. */
  valueMinor: string;
}

/**
 * Opening layers, sized against WEEK_INVOICES so nothing over-issues: tiles 60 - 40 = 20 of a 40
 * reorder point, cement 300 - 120 = 180 of 200, tank 6 - 2 = 4 of 6, and tyre stays at 12 of 15.
 */
const WEEK_OPENING_STOCK: readonly WeekOpeningStockDefinition[] = [
  { item: 'tiles', quantity: '60', valueMinor: '5400000' },
  { item: 'paint', quantity: '40', valueMinor: '8000000' },
  { item: 'tank', quantity: '6', valueMinor: '5400000' },
  { item: 'cement', quantity: '300', valueMinor: '16500000' },
  { item: 'padlock', quantity: '80', valueMinor: '3200000' },
  { item: 'solar', quantity: '50', valueMinor: '6000000' },
  { item: 'tyre', quantity: '12', valueMinor: '720000' },
];

interface WeekStockAdjustmentDefinition {
  key: string;
  item: string;
  on: number;
  /** Signed quantity: negative writes stock down, positive recounts it up (and needs a value). */
  quantityDelta: string;
  valueDeltaMinor?: string;
  reason: string;
  target: 'POSTED' | 'PENDING_APPROVAL' | 'DRAFT';
}

const WEEK_STOCK_ADJUSTMENTS: readonly WeekStockAdjustmentDefinition[] = [
  {
    key: 'writedown',
    item: 'padlock',
    on: -2,
    quantityDelta: '-2',
    reason: 'Damaged in handling - write-down',
    target: 'POSTED',
  },
  {
    key: 'recount',
    item: 'paint',
    on: -1,
    quantityDelta: '3',
    valueDeltaMinor: '600000',
    reason: 'Cycle count found extra tins',
    target: 'POSTED',
  },
  {
    key: 'pending',
    item: 'cement',
    on: 0,
    quantityDelta: '-5',
    reason: 'Torn bags - awaiting approval',
    target: 'PENDING_APPROVAL',
  },
  {
    key: 'draft',
    item: 'tank',
    on: 0,
    quantityDelta: '1',
    valueDeltaMinor: '900000',
    reason: 'Returned display unit',
    target: 'DRAFT',
  },
];

interface WeekStockTransferDefinition {
  key: string;
  item: string;
  on: number;
  quantity: string;
}

/** Two transfers main to Westlands; they leave the Westlands warehouse with stock of its own. */
const WEEK_STOCK_TRANSFERS: readonly WeekStockTransferDefinition[] = [
  { key: 'paint', item: 'paint', on: -2, quantity: '5' },
  { key: 'padlock', item: 'padlock', on: -1, quantity: '10' },
];

interface WeekPaymentDefinition {
  key: string;
  customer: string;
  invoice: string;
  receivedOn: number;
  currency?: string;
  fraction?: 'half';
  /** `false` leaves the receipt unapplied, which is the UNAPPLIED state the list must show. */
  allocate: boolean;
}

const WEEK_PAYMENTS: readonly WeekPaymentDefinition[] = [
  { key: 'walkin', customer: 'walkin', invoice: 'walkin', receivedOn: -4, allocate: true },
  {
    key: 'thursday-full',
    customer: 'longname',
    invoice: 'thirty-day',
    receivedOn: -3,
    allocate: true,
  },
  {
    key: 'vat-half',
    customer: 'overdue',
    invoice: 'vat-lines',
    receivedOn: -3,
    fraction: 'half',
    allocate: true,
  },
  {
    key: 'usd-half',
    customer: 'usd',
    invoice: 'usd',
    receivedOn: -2,
    fraction: 'half',
    allocate: true,
  },
  {
    key: 'converted',
    customer: 'regular',
    invoice: 'quote-converted',
    receivedOn: -2,
    allocate: true,
  },
  { key: 'unapplied', customer: 'credit', invoice: 'aging-25', receivedOn: 0, allocate: false },
];

type CreditNoteTarget = 'DRAFT' | 'ISSUED' | 'APPLIED' | 'REFUNDED' | 'VOID';

interface WeekCreditNoteDefinition {
  key: string;
  customer: string;
  target: CreditNoteTarget;
  issuedOn: number;
  currency?: string;
  /** Set for APPLIED, naming the invoice the credit is allocated back to. */
  invoice?: string;
  lines: readonly WeekLineDefinition[];
}

/**
 * One credit note per status. Lines deliberately use services and non-inventory items: returning
 * tracked goods is a stock movement this seed does not model, and a credit note is not the place to
 * invent one.
 */
const WEEK_CREDIT_NOTES: readonly WeekCreditNoteDefinition[] = [
  {
    key: 'draft',
    customer: 'credit',
    target: 'DRAFT',
    issuedOn: -1,
    lines: [{ item: 'install', quantity: '2', unitPriceMinor: '85000' }],
  },
  {
    key: 'applied',
    customer: 'credit',
    target: 'APPLIED',
    issuedOn: -2,
    invoice: 'aging-25',
    lines: [{ item: 'consumables', quantity: '4', unitPriceMinor: '45000' }],
  },
  {
    key: 'refunded',
    customer: 'credit',
    target: 'REFUNDED',
    issuedOn: -1,
    lines: [{ item: 'delivery', quantity: '1', unitPriceMinor: '120000' }],
  },
  {
    key: 'void',
    customer: 'credit',
    target: 'VOID',
    issuedOn: -1,
    lines: [{ item: 'airfreshener', quantity: '3', unitPriceMinor: '25000' }],
  },
  {
    key: 'issued',
    customer: 'credit',
    target: 'ISSUED',
    issuedOn: 0,
    lines: [{ item: 'survey', quantity: '1', unitPriceMinor: '250000' }],
  },
];

type QuoteTarget =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SENT'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'CONVERTED';

interface WeekQuoteDefinition {
  key: string;
  customer: string;
  target: QuoteTarget;
  /** Expiry day relative to the run day; the expired quote's is deliberately in the past. */
  expiryOn: number;
  currency?: string;
  lines: readonly WeekLineDefinition[];
}

/**
 * One quote per status section 5a lists. The pending one is only submitted here; the extras stage
 * attaches its approval request once a policy exists.
 */
const WEEK_QUOTES: readonly WeekQuoteDefinition[] = [
  {
    key: 'pending',
    customer: 'regular',
    target: 'PENDING_APPROVAL',
    expiryOn: 25,
    lines: [{ item: 'tank', quantity: '3', unitPriceMinor: '1250000' }],
  },
  {
    key: 'draft',
    customer: 'credit',
    target: 'DRAFT',
    expiryOn: 20,
    lines: [{ item: 'paint', quantity: '8', unitPriceMinor: '320000' }],
  },
  {
    key: 'approved',
    customer: 'longname',
    target: 'APPROVED',
    expiryOn: 21,
    lines: [{ item: 'cement', quantity: '80', unitPriceMinor: '78000' }],
  },
  {
    key: 'sent',
    customer: 'regular',
    target: 'SENT',
    expiryOn: 24,
    lines: [{ item: 'install', quantity: '12', unitPriceMinor: '85000' }],
  },
  {
    key: 'accepted',
    // Not 'no-email': reaching ACCEPTED falls through the loop below to quotes.send(), which
    // requires an email on file. 'no-email' demonstrates that missing-email state elsewhere
    // (the fulfilled sales order and the dedicated 'no-email' invoice below), neither of which
    // sends anything.
    customer: 'credit',
    target: 'ACCEPTED',
    expiryOn: 27,
    lines: [{ item: 'consumables', quantity: '20', unitPriceMinor: '45000' }],
  },
  {
    key: 'declined',
    customer: 'overdue',
    target: 'DECLINED',
    expiryOn: 19,
    lines: [{ item: 'tiles', quantity: '30', unitPriceMinor: '145000' }],
  },
  {
    key: 'expired',
    customer: 'usd',
    target: 'EXPIRED',
    expiryOn: -2,
    currency: 'USD',
    lines: [{ item: 'solar', quantity: '10', unitPriceMinor: '15000' }],
  },
  {
    key: 'converted',
    customer: 'regular',
    target: 'CONVERTED',
    expiryOn: 24,
    lines: [
      { item: 'install', quantity: '4', unitPriceMinor: '85000' },
      { item: 'delivery', quantity: '1', unitPriceMinor: '120000' },
    ],
  },
];

type SalesOrderTarget =
  'DRAFT' | 'APPROVED' | 'CONFIRMED' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED';

interface WeekOrderDefinition {
  key: string;
  customer: string;
  target: SalesOrderTarget;
  currency?: string;
  lines: readonly WeekLineDefinition[];
}

/**
 * One order per status. The CONFIRMED one is the sales-order-to-invoice chain, so its lines are
 * deliberately non-tracked (a tracked line would need a warehouse on an invoice built by conversion,
 * and would consume stock a second time).
 */
const WEEK_ORDERS: readonly WeekOrderDefinition[] = [
  {
    key: 'draft',
    customer: 'credit',
    target: 'DRAFT',
    lines: [{ item: 'tank', quantity: '2', unitPriceMinor: '1250000' }],
  },
  {
    key: 'approved',
    customer: 'walkin',
    target: 'APPROVED',
    lines: [{ item: 'padlock', quantity: '10', unitPriceMinor: '68500' }],
  },
  {
    key: 'confirmed',
    customer: 'regular',
    target: 'CONFIRMED',
    lines: [
      { item: 'consumables', quantity: '12', unitPriceMinor: '45000' },
      { item: 'delivery', quantity: '2', unitPriceMinor: '120000' },
    ],
  },
  {
    key: 'partial',
    customer: 'longname',
    target: 'PARTIALLY_FULFILLED',
    lines: [{ item: 'cement', quantity: '200', unitPriceMinor: '78000' }],
  },
  {
    key: 'fulfilled',
    customer: 'no-email',
    target: 'FULFILLED',
    lines: [{ item: 'airfreshener', quantity: '50', unitPriceMinor: '25000' }],
  },
  {
    key: 'cancelled',
    customer: 'usd',
    target: 'CANCELLED',
    currency: 'USD',
    lines: [{ item: 'airfreshener', quantity: '10', unitPriceMinor: '2500' }],
  },
];

interface WeekVendorDefinition {
  slug: string;
  displayName: string;
  dto: Omit<CreateVendorDto, 'displayName'>;
}

/** Section 3's five vendors: stationery, logistics, utilities, packaging, and one USD supplier. */
const WEEK_VENDORS: readonly WeekVendorDefinition[] = [
  {
    slug: 'stationery',
    displayName: 'Nairobi Stationery Mart',
    dto: {
      email: 'orders@nairobi-stationery.example',
      phone: '+254720111222',
      paymentTermsDays: 30,
      tags: ['Demo week', 'Office supplies'],
    },
  },
  {
    slug: 'logistics',
    displayName: 'Kifaru Logistics Ltd',
    dto: {
      email: 'billing@kifaru-logistics.example',
      paymentTermsDays: 14,
      tags: ['Demo week', 'Freight'],
    },
  },
  {
    slug: 'utilities',
    displayName: 'Kenya Power & Lighting Company',
    dto: { email: 'accounts@kplc.example', paymentTermsDays: 21 },
  },
  {
    slug: 'packaging',
    displayName: 'Thika Packaging Supplies',
    dto: { email: 'sales@thika-packaging.example', paymentTermsDays: 30, tags: ['Demo week'] },
  },
  {
    slug: 'usd-supplier',
    displayName: 'Shenzhen Hardware Exports',
    dto: {
      email: 'export@shenzhen-hardware.example',
      currency: 'USD',
      paymentTermsDays: 45,
      tags: ['Demo week', 'USD supplier'],
    },
  },
];

interface WeekExpenseCategoryDefinition {
  slug: string;
  name: string;
  /** Starter-chart account code the category posts to. */
  accountCode: string;
}

const WEEK_EXPENSE_CATEGORIES: readonly WeekExpenseCategoryDefinition[] = [
  { slug: 'rent', name: 'Rent', accountCode: '5000' },
  { slug: 'utilities', name: 'Utilities', accountCode: '5010' },
  { slug: 'supplies', name: 'Office supplies', accountCode: '5060' },
  { slug: 'transport', name: 'Transport', accountCode: '5080' },
  { slug: 'marketing', name: 'Marketing', accountCode: '5110' },
];

interface WeekPurchaseOrderLine {
  item?: string;
  description?: string;
  quantity: string;
  unitPriceMinor: string;
  warehouse?: 'main' | 'westlands';
}

interface WeekPurchaseOrderDefinition {
  key: string;
  vendor: string;
  target: 'DRAFT' | 'APPROVED' | 'ISSUED' | 'CLOSED' | 'CANCELLED';
  expectedOn: number;
  currency?: string;
  lines: readonly WeekPurchaseOrderLine[];
  /** Goods receipt: the day it happened and what arrived (a subset leaves the order partly received). */
  receipt?: {
    on: number;
    lines: readonly { item: string; quantity: string; warehouse?: 'main' | 'westlands' }[];
  };
}

/**
 * Six orders covering section 5a's five statuses plus the receipt states: one fully received on the
 * Monday, one partly received, one closed without receipt, one cancelled after approval.
 */
const WEEK_PURCHASE_ORDERS: readonly WeekPurchaseOrderDefinition[] = [
  {
    key: 'received',
    vendor: 'packaging',
    target: 'ISSUED',
    expectedOn: -3,
    lines: [
      { item: 'tiles', quantity: '20', unitPriceMinor: '90000', warehouse: 'main' },
      { item: 'padlock', quantity: '40', unitPriceMinor: '40000', warehouse: 'main' },
    ],
    receipt: {
      on: -3,
      lines: [
        { item: 'tiles', quantity: '20' },
        { item: 'padlock', quantity: '40' },
      ],
    },
  },
  {
    key: 'partial',
    vendor: 'usd-supplier',
    target: 'ISSUED',
    expectedOn: 5,
    currency: 'USD',
    lines: [{ item: 'solar', quantity: '20', unitPriceMinor: '12000', warehouse: 'westlands' }],
    receipt: { on: -2, lines: [{ item: 'solar', quantity: '8', warehouse: 'westlands' }] },
  },
  {
    key: 'draft',
    vendor: 'stationery',
    target: 'DRAFT',
    expectedOn: 7,
    lines: [{ item: 'consumables', quantity: '10', unitPriceMinor: '38000' }],
  },
  {
    key: 'approved',
    vendor: 'utilities',
    target: 'APPROVED',
    expectedOn: 9,
    lines: [
      { description: 'Electricity supply — September', quantity: '1', unitPriceMinor: '2400000' },
    ],
  },
  {
    key: 'closed',
    vendor: 'logistics',
    target: 'CLOSED',
    expectedOn: -2,
    lines: [
      { description: 'Weekly deliveries — September', quantity: '4', unitPriceMinor: '450000' },
    ],
  },
  {
    key: 'cancelled',
    vendor: 'stationery',
    target: 'CANCELLED',
    expectedOn: 12,
    lines: [{ description: 'Cancelled paper order', quantity: '1', unitPriceMinor: '150000' }],
  },
];

interface WeekBillLine {
  item?: string;
  description?: string;
  quantity: string;
  unitPriceMinor: string;
  /** Starter-chart account for a non-stock line; item lines post through the item. */
  accountCode?: string;
}

interface WeekBillDefinition {
  key: string;
  vendor: string;
  target: 'DRAFT' | 'ISSUED' | 'VOID';
  issuedOn: number;
  dueOn: number;
  vendorReference?: string;
  currency?: string;
  accountCode?: string;
  /** Key of the purchase order this bill is raised from, for the order-to-bill chain. */
  purchaseOrder?: string;
  lines: readonly WeekBillLine[];
}

/**
 * Seven bills: one from the received purchase order, one overdue (ageing), one paid in full, one
 * half paid, one USD, one draft and one void. Every issued date stays inside the open period.
 */
const WEEK_BILLS: readonly WeekBillDefinition[] = [
  {
    key: 'received',
    vendor: 'packaging',
    target: 'ISSUED',
    issuedOn: -3,
    dueOn: 27,
    vendorReference: 'TPS-INV-2291',
    purchaseOrder: 'received',
    lines: [
      { item: 'tiles', quantity: '20', unitPriceMinor: '90000' },
      { item: 'padlock', quantity: '40', unitPriceMinor: '40000' },
    ],
  },
  {
    key: 'overdue',
    vendor: 'stationery',
    target: 'ISSUED',
    issuedOn: -35,
    dueOn: -5,
    vendorReference: 'NSM-0871',
    accountCode: '5060',
    lines: [
      { description: 'Printer paper and toner - August', quantity: '1', unitPriceMinor: '620000' },
    ],
  },
  {
    key: 'utilities',
    vendor: 'utilities',
    target: 'ISSUED',
    issuedOn: -4,
    dueOn: 17,
    vendorReference: 'KPLC-SEP-4471',
    accountCode: '5010',
    lines: [{ description: 'Electricity - September', quantity: '1', unitPriceMinor: '1850000' }],
  },
  {
    key: 'freight',
    vendor: 'logistics',
    target: 'ISSUED',
    issuedOn: -5,
    dueOn: 9,
    vendorReference: 'KIF-2209',
    accountCode: '5080',
    lines: [
      { description: 'Freight - customer deliveries', quantity: '3', unitPriceMinor: '450000' },
    ],
  },
  {
    key: 'usd',
    vendor: 'usd-supplier',
    target: 'ISSUED',
    issuedOn: -1,
    dueOn: 44,
    currency: 'USD',
    vendorReference: 'SZH-7730',
    accountCode: '5060',
    lines: [
      {
        description: 'Sample shipment - hardware fittings',
        quantity: '1',
        unitPriceMinor: '250000',
      },
    ],
  },
  {
    key: 'draft',
    vendor: 'stationery',
    target: 'DRAFT',
    issuedOn: 0,
    dueOn: 30,
    accountCode: '5060',
    lines: [{ description: 'Filing supplies', quantity: '5', unitPriceMinor: '35000' }],
  },
  {
    key: 'void',
    vendor: 'logistics',
    target: 'VOID',
    issuedOn: -2,
    dueOn: 12,
    accountCode: '5080',
    lines: [{ description: 'Duplicate freight charge', quantity: '1', unitPriceMinor: '90000' }],
  },
];

interface WeekPaymentMadeDefinition {
  key: string;
  vendor: string;
  /** Bill the payment is sized from (and, when `allocate`, applied to). */
  bill: string;
  paidOn: number;
  fraction: 'full' | 'half';
  allocate: boolean;
  currency?: string;
}

/** Full, half and unapplied: the three allocation states of the payments-made screen. */
const WEEK_PAYMENTS_MADE: readonly WeekPaymentMadeDefinition[] = [
  {
    key: 'utilities-full',
    vendor: 'utilities',
    bill: 'utilities',
    paidOn: -3,
    fraction: 'full',
    allocate: true,
  },
  {
    key: 'freight-half',
    vendor: 'logistics',
    bill: 'freight',
    paidOn: -2,
    fraction: 'half',
    allocate: true,
  },
  {
    key: 'stationery-unapplied',
    vendor: 'stationery',
    bill: 'overdue',
    paidOn: -1,
    fraction: 'full',
    allocate: false,
  },
];

interface WeekVendorCreditDefinition {
  key: string;
  vendor: string;
  target: 'DRAFT' | 'ISSUED' | 'APPLIED' | 'VOID';
  issuedOn: number;
  /** Bill an APPLIED credit is allocated against. */
  bill?: string;
  currency?: string;
  accountCode?: string;
  lines: readonly {
    item?: string;
    description?: string;
    quantity: string;
    unitPriceMinor: string;
  }[];
}

/** One credit per section 5a status; the applied one reduces the bill raised from the PO. */
const WEEK_VENDOR_CREDITS: readonly WeekVendorCreditDefinition[] = [
  {
    key: 'applied',
    vendor: 'packaging',
    target: 'APPLIED',
    issuedOn: -2,
    bill: 'received',
    accountCode: '5060',
    lines: [
      {
        description: 'Credit - chipped tiles in delivery',
        quantity: '1',
        unitPriceMinor: '180000',
      },
    ],
  },
  {
    key: 'issued',
    vendor: 'logistics',
    target: 'ISSUED',
    issuedOn: -1,
    accountCode: '5080',
    lines: [
      {
        description: 'Credit - late delivery penalty waived',
        quantity: '1',
        unitPriceMinor: '120000',
      },
    ],
  },
  {
    key: 'draft',
    vendor: 'stationery',
    target: 'DRAFT',
    issuedOn: 0,
    accountCode: '5060',
    lines: [
      { description: 'Credit - returned toner cartridges', quantity: '2', unitPriceMinor: '45000' },
    ],
  },
  {
    key: 'void',
    vendor: 'utilities',
    target: 'VOID',
    issuedOn: -3,
    accountCode: '5010',
    lines: [
      { description: 'Credit - meter reading correction', quantity: '1', unitPriceMinor: '60000' },
    ],
  },
];

interface WeekExpenseDefinition {
  key: string;
  /** Vendor slug, or a free-text `payeeName` for one-off payees. */
  vendor?: string;
  payeeName?: string;
  spentOn: number;
  /** Cash (1000) or bank (1010) account the money left from. */
  paidThroughCode: '1000' | '1010';
  category: string;
  project?: string;
  currency?: string;
  amountMinor: string;
  tax?: 'standard';
  target: 'DRAFT' | 'SUBMITTED' | 'POSTED';
}

/** Section 5c's expense states: five posted (three cash, two bank), one awaiting approval, one draft. */
const WEEK_EXPENSES: readonly WeekExpenseDefinition[] = [
  {
    key: 'rent',
    payeeName: 'Prime Properties Ltd',
    spentOn: -6,
    paidThroughCode: '1010',
    category: 'rent',
    amountMinor: '15000000',
    target: 'POSTED',
  },
  {
    key: 'fuel',
    payeeName: 'Shell Westlands',
    spentOn: -5,
    paidThroughCode: '1000',
    category: 'transport',
    amountMinor: '350000',
    target: 'POSTED',
  },
  {
    key: 'snacks',
    payeeName: 'Naivas Supermarket',
    spentOn: -4,
    paidThroughCode: '1000',
    category: 'supplies',
    amountMinor: '128000',
    tax: 'standard',
    target: 'POSTED',
  },
  {
    key: 'ads',
    payeeName: 'Google Ads',
    spentOn: -2,
    paidThroughCode: '1010',
    category: 'marketing',
    amountMinor: '480000',
    tax: 'standard',
    target: 'POSTED',
  },
  {
    key: 'site-transport',
    payeeName: 'Uber Business',
    spentOn: -1,
    paidThroughCode: '1000',
    category: 'transport',
    project: 'westlands-fitout',
    amountMinor: '95000',
    target: 'POSTED',
  },
  {
    key: 'flights',
    payeeName: 'Kenya Airways',
    spentOn: 0,
    paidThroughCode: '1010',
    category: 'transport',
    amountMinor: '2850000',
    target: 'SUBMITTED',
  },
  {
    key: 'stamps',
    vendor: 'stationery',
    spentOn: 0,
    paidThroughCode: '1000',
    category: 'supplies',
    amountMinor: '24000',
    target: 'DRAFT',
  },
];

interface WeekRecurringBillDefinition {
  key: string;
  vendor: string;
  cadence: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';
  startsOn: number;
  currency?: string;
  accountCode?: string;
  lines: readonly { description: string; quantity: string; unitPriceMinor: string }[];
}

const WEEK_RECURRING_BILLS: readonly WeekRecurringBillDefinition[] = [
  {
    key: 'electricity',
    vendor: 'utilities',
    cadence: 'MONTHLY',
    startsOn: 26,
    accountCode: '5010',
    lines: [{ description: 'Electricity - monthly', quantity: '1', unitPriceMinor: '1850000' }],
  },
  {
    key: 'packaging',
    vendor: 'packaging',
    cadence: 'WEEKLY',
    startsOn: 3,
    accountCode: '5060',
    lines: [
      { description: 'Packaging supplies - weekly', quantity: '10', unitPriceMinor: '32000' },
    ],
  },
];

interface WeekRecurringExpenseDefinition {
  key: string;
  vendor?: string;
  payeeName?: string;
  cadence: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';
  startsOn: number;
  paidThroughCode: '1000' | '1010';
  category: string;
  amountMinor: string;
  tax?: 'standard';
  autoCreate?: boolean;
}

const WEEK_RECURRING_EXPENSES: readonly WeekRecurringExpenseDefinition[] = [
  {
    key: 'rent',
    payeeName: 'Prime Properties Ltd',
    cadence: 'MONTHLY',
    startsOn: 25,
    paidThroughCode: '1010',
    category: 'rent',
    amountMinor: '15000000',
  },
  {
    key: 'ads',
    payeeName: 'Google Ads',
    cadence: 'WEEKLY',
    startsOn: 5,
    paidThroughCode: '1010',
    category: 'marketing',
    amountMinor: '480000',
    tax: 'standard',
    autoCreate: true,
  },
];

interface WeekFinancialAccountDefinition {
  slug: string;
  name: string;
  type: 'BANK' | 'CASH' | 'CREDIT_CARD' | 'OTHER';
  /** Starter-chart asset account the financial account posts through. */
  glCode: string;
  openingBalanceMinor: string;
}

/** Three accounts: the current account, petty cash, and a mobile-money till. */
const WEEK_FINANCIAL_ACCOUNTS: readonly WeekFinancialAccountDefinition[] = [
  {
    slug: 'equity',
    name: 'Equity Bank - Current',
    type: 'BANK',
    glCode: '1010',
    openingBalanceMinor: '0',
  },
  { slug: 'cash', name: 'Petty cash', type: 'CASH', glCode: '1000', openingBalanceMinor: '0' },
  {
    slug: 'mpesa',
    name: 'M-Pesa Till 5512',
    type: 'OTHER',
    glCode: '1030',
    openingBalanceMinor: '0',
  },
];

interface WeekBankRuleDefinition {
  key: string;
  name: string;
  priority: number;
  /** Case-insensitive fragment of the statement description the rule keys on. */
  contains: string;
  accountCode: string;
  vendor?: string;
}

const WEEK_BANK_RULES: readonly WeekBankRuleDefinition[] = [
  {
    key: 'kplc',
    name: 'Kenya Power bills',
    priority: 10,
    contains: 'KPLC',
    accountCode: '5010',
    vendor: 'utilities',
  },
  { key: 'fuel', name: 'Fuel stations', priority: 20, contains: 'SHELL', accountCode: '5080' },
  {
    key: 'bank-charges',
    name: 'Bank charges',
    priority: 30,
    contains: 'BANK CHARGES',
    accountCode: '5130',
  },
];

interface StatementRow {
  key: string;
  date: string;
  description: string;
  reference?: string;
  /** Signed: positive is an inflow, negative an outflow. */
  amountMinor: bigint;
}

function minorToDecimal(amountMinor: bigint): string {
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

interface WeekLineDefinition {
  item: string;
  quantity: string;
  unitPriceMinor: string;
  discount?: string;
  tax?: 'standard' | 'zero' | 'exempt';
  project?: string;
  warehouse?: 'main' | 'westlands';
}

interface WeekInvoiceDefinition {
  key: string;
  customer: string;
  /** Issue day relative to the run day. Negative days feed the ageing buckets. */
  issuedOn: number;
  /** Due day relative to the run day, or `receipt` for due-on-receipt terms. */
  dueOn: number | 'receipt';
  currency?: string;
  lines: readonly WeekLineDefinition[];
}

/**
 * Section 4's sales documents, oldest first. `aging-45` and `aging-25` sit outside the window on
 * purpose so receivables ageing has a 1-30 and a 31-60 row; `due-receipt` is the one that later
 * carries an expected payment date, `vat-lines` the one whose reminders get stopped, `walkin` the one
 * settled the same day, and `void-me` the one voided with no payments against it.
 */
const WEEK_INVOICES: readonly WeekInvoiceDefinition[] = [
  {
    key: 'aging-45',
    customer: 'overdue',
    issuedOn: -45,
    dueOn: -35,
    lines: [
      {
        item: 'tiles',
        quantity: '40',
        unitPriceMinor: '145000',
        warehouse: 'main',
        project: 'tumaini-refit',
      },
      {
        item: 'paint',
        quantity: '10',
        unitPriceMinor: '320000',
        warehouse: 'main',
        project: 'tumaini-refit',
      },
    ],
  },
  {
    key: 'aging-25',
    customer: 'credit',
    issuedOn: -25,
    dueOn: -10,
    lines: [{ item: 'tank', quantity: '2', unitPriceMinor: '1250000', warehouse: 'main' }],
  },
  {
    key: 'thirty-day',
    customer: 'longname',
    issuedOn: -6,
    dueOn: 24,
    lines: [
      { item: 'cement', quantity: '120', unitPriceMinor: '78000', warehouse: 'main', tax: 'zero' },
      { item: 'delivery', quantity: '1', unitPriceMinor: '120000' },
    ],
  },
  {
    key: 'due-receipt',
    customer: 'regular',
    issuedOn: -6,
    dueOn: 'receipt',
    lines: [
      { item: 'install', quantity: '6', unitPriceMinor: '85000', project: 'westlands-fitout' },
    ],
  },
  {
    key: 'vat-lines',
    customer: 'overdue',
    issuedOn: -6,
    dueOn: 24,
    lines: [
      { item: 'padlock', quantity: '25', unitPriceMinor: '68500', warehouse: 'main' },
      { item: 'solar', quantity: '8', unitPriceMinor: '195000', warehouse: 'main' },
      { item: 'survey', quantity: '1', unitPriceMinor: '250000', tax: 'zero' },
    ],
  },
  {
    key: 'usd',
    customer: 'usd',
    issuedOn: -5,
    dueOn: 9,
    currency: 'USD',
    lines: [
      { item: 'solar', quantity: '20', unitPriceMinor: '15000', warehouse: 'main' },
      { item: 'airfreshener', quantity: '30', unitPriceMinor: '2500' },
    ],
  },
  {
    key: 'no-email',
    customer: 'no-email',
    issuedOn: -5,
    dueOn: 'receipt',
    lines: [
      { item: 'airfreshener', quantity: '40', unitPriceMinor: '25000' },
      { item: 'consumables', quantity: '5', unitPriceMinor: '45000' },
    ],
  },
  {
    key: 'walkin',
    customer: 'walkin',
    issuedOn: -4,
    dueOn: 'receipt',
    lines: [
      { item: 'consumables', quantity: '3', unitPriceMinor: '45000' },
      { item: 'padlock', quantity: '4', unitPriceMinor: '68500', warehouse: 'main' },
    ],
  },
  {
    key: 'void-me',
    customer: 'regular',
    issuedOn: -4,
    dueOn: 26,
    lines: [{ item: 'padlock', quantity: '6', unitPriceMinor: '68500', warehouse: 'main' }],
  },
];

interface WeekProjectDefinition {
  slug: string;
  name: string;
  customerSlug?: string;
  dto: Omit<CreateProjectDto, 'name' | 'customerId' | 'managerUserId'>;
}

/**
 * Three projects per section 5c: one fixed-price refit for the collections-risk customer, one
 * time-and-materials fit-out with a rate card, and one internal non-billable job.
 */
const WEEK_PROJECTS: readonly WeekProjectDefinition[] = [
  {
    slug: 'tumaini-refit',
    name: 'Tumaini Hardware shop refit',
    customerSlug: 'overdue',
    dto: {
      code: 'PRJ-REFIT',
      billingMethod: 'FIXED_PRICE',
      budgetAmountMinor: '250000000',
      description: 'Shop refit: tiling, painting and lock replacement across two floors.',
    },
  },
  {
    slug: 'westlands-fitout',
    name: 'Westlands Pharmacy fit-out',
    customerSlug: 'regular',
    dto: {
      code: 'PRJ-FITOUT',
      billingMethod: 'TIME_AND_MATERIALS',
      budgetAmountMinor: '90000000',
      budgetHours: '120.00',
      defaultRateMinor: '85000',
    },
  },
  {
    slug: 'warehouse-reorg',
    name: 'Internal: warehouse reorganisation',
    dto: { code: 'PRJ-INT-01', billingMethod: 'NON_BILLABLE', budgetHours: '80.00' },
  },
];
