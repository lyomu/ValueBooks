import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { TaxService } from '../src/organizations/tax.service.js';
import { BillsService } from '../src/purchases/bills.service.js';
import { ExpensesService } from '../src/purchases/expenses.service.js';
import { PaymentsMadeService } from '../src/purchases/payments-made.service.js';
import { VendorCreditsService } from '../src/purchases/vendor-credits.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { PaymentsService } from '../src/sales/payments.service.js';
import { SalesOrdersService } from '../src/sales/sales-orders.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'optimistic-concurrency-test',
  userAgent: 'ValueBooks integration test',
};

describe('optimistic concurrency on financial documents (GAPS #35)', () => {
  let harness: TestHarness;
  let invoices: InvoicesService;
  let bills: BillsService;
  let expenses: ExpensesService;
  let ledger: LedgerService;
  let payments: PaymentsService;
  let paymentsMade: PaymentsMadeService;
  let vendorCredits: VendorCreditsService;
  let salesOrders: SalesOrdersService;
  let paidThroughAccountId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    invoices = harness.app.get(InvoicesService);
    bills = harness.app.get(BillsService);
    expenses = harness.app.get(ExpensesService);
    ledger = harness.app.get(LedgerService);
    payments = harness.app.get(PaymentsService);
    paymentsMade = harness.app.get(PaymentsMadeService);
    vendorCredits = harness.app.get(VendorCreditsService);
    salesOrders = harness.app.get(SalesOrdersService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });
  /** Seed org + tax + customer for invoice tests. */
  async function setupInvoiceOrg() {
    const organizations = harness.app.get(OrganizationService);
    const access = harness.app.get(OrganizationAccessService);
    const periods = harness.app.get(FiscalPeriodsService);
    const tax = harness.app.get(TaxService);
    const customers = harness.app.get(CustomersService);

    const user = await harness.prisma.user.create({
      data: {
        email: 'oc-owner@example.test',
        displayName: 'OC Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const owner: PublicUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };

    const created = await organizations.create(
      owner,
      { legalName: 'Concurrency Inc', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    const context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const code = await tax.createTaxCode(
      context,
      owner,
      { code: 'VAT', name: 'VAT', treatment: 'EXCLUSIVE', recoverable: true },
      metadata,
    );
    await tax.createRate(
      context,
      owner,
      code.id,
      { ratePercent: '16', effectiveFrom: '2026-01-01' },
      metadata,
    );
    const contact = await customers.create(
      context,
      owner,
      { displayName: 'Test Customer' },
      metadata,
    );
    return { owner, context, contactId: contact.id, taxCodeId: code.id };
  }

  /** Seed org + tax + vendor for bill/expense tests. */
  async function setupBillOrg() {
    const organizations = harness.app.get(OrganizationService);
    const access = harness.app.get(OrganizationAccessService);
    const periods = harness.app.get(FiscalPeriodsService);
    const tax = harness.app.get(TaxService);
    const vendors = harness.app.get(VendorsService);
    const ledger = harness.app.get(LedgerService);

    const user = await harness.prisma.user.create({
      data: {
        email: 'oc-vendor@example.test',
        displayName: 'OC Vendor',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const owner: PublicUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };

    const created = await organizations.create(
      owner,
      { legalName: 'Bill Inc', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    const context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const code = await tax.createTaxCode(
      context,
      owner,
      { code: 'VAT', name: 'VAT', treatment: 'EXCLUSIVE', recoverable: true },
      metadata,
    );
    await tax.createRate(
      context,
      owner,
      code.id,
      { ratePercent: '16', effectiveFrom: '2026-01-01' },
      metadata,
    );
    const vendor = await vendors.create(context, owner, { displayName: 'Test Vendor' }, metadata);
    paidThroughAccountId = (await ledger.accountBySystemKey(context.id, 'bank_default')).id;
    return { owner, context, vendorId: vendor.id, taxCodeId: code.id };
  }
  it('rejects a stale invoice update when the version does not match', async () => {
    const { owner, context, contactId } = await setupInvoiceOrg();

    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    expect(draft.version).toBe(0);

    // Simulate a concurrent write that bumps the version.
    await harness.prisma.invoice.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    // The stale update - based on version 0 - must fail.
    await expect(
      invoices.updateDraft(
        context,
        owner,
        draft.id,
        { version: 0, lines: [{ description: 'Widget', quantity: '2', unitPriceMinor: '1000' }] },
        metadata,
      ),
    ).rejects.toThrow();

    // A correct update (version 1) succeeds and increments the counter.
    const updated = await invoices.updateDraft(
      context,
      owner,
      draft.id,
      { version: 1, lines: [{ description: 'Widget', quantity: '2', unitPriceMinor: '1000' }] },
      metadata,
    );
    expect(updated.version).toBe(2);
  });

  it('allows an unversioned invoice update for backward compatibility', async () => {
    const { owner, context, contactId } = await setupInvoiceOrg();

    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );

    const updated = await invoices.updateDraft(
      context,
      owner,
      draft.id,
      { lines: [{ description: 'Updated Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    expect(updated.version).toBe(1);
  });
  it('rejects a stale bill update when the version does not match', async () => {
    const { owner, context, vendorId, taxCodeId } = await setupBillOrg();

    const draft = await bills.createDraft(
      context,
      owner,
      {
        vendorId,
        currency: 'KES',
        lines: [{ description: 'Service', quantity: '1', unitPriceMinor: '5000', taxCodeId }],
      },
      metadata,
    );

    await harness.prisma.bill.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      bills.updateDraft(
        context,
        owner,
        draft.id,
        {
          version: 0,
          lines: [{ description: 'Service', quantity: '1', unitPriceMinor: '6000', taxCodeId }],
        },
        metadata,
      ),
    ).rejects.toThrow();

    const updated = await bills.updateDraft(
      context,
      owner,
      draft.id,
      {
        version: 1,
        lines: [{ description: 'Service', quantity: '1', unitPriceMinor: '6000', taxCodeId }],
      },
      metadata,
    );
    expect(updated.version).toBe(2);
  });

  it('rejects a stale expense update when the version does not match', async () => {
    const { owner, context, vendorId, taxCodeId } = await setupBillOrg();

    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        expenseDate: '2026-06-01',
        paidThroughAccountId,
        amountMinor: '1000',
        taxCodeId,
      },
      metadata,
    );

    await harness.prisma.expense.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      expenses.updateDraft(context, owner, draft.id, { version: 0, amountMinor: '2000' }, metadata),
    ).rejects.toThrow();

    const updated = await expenses.updateDraft(
      context,
      owner,
      draft.id,
      { version: 1, amountMinor: '2000' },
      metadata,
    );
    expect(updated.version).toBe(2);
  });

  async function issuedInvoice(
    context: Awaited<ReturnType<typeof setupInvoiceOrg>>['context'],
    owner: PublicUser,
    contactId: string,
    unitPriceMinor: string,
  ) {
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor }] },
      metadata,
    );
    return invoices.issueInvoice(context, owner, draft.id, metadata);
  }

  async function issuedBill(
    context: Awaited<ReturnType<typeof setupBillOrg>>['context'],
    owner: PublicUser,
    vendorId: string,
    unitPriceMinor: string,
  ) {
    const draft = await bills.createDraft(
      context,
      owner,
      { vendorId, lines: [{ description: 'Service', quantity: '1', unitPriceMinor }] },
      metadata,
    );
    return bills.issueBill(context, owner, draft.id, metadata);
  }

  it('rejects a stale payment allocation when the version does not match', async () => {
    const { owner, context, contactId } = await setupInvoiceOrg();
    const invoice = await issuedInvoice(context, owner, contactId, '1500');
    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: '2026-02-01', amountMinor: '1500' },
      metadata,
    );
    expect(payment.version).toBe(0);

    await harness.prisma.paymentReceived.update({
      where: { id: payment.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      payments.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ invoiceId: invoice.id, amountMinor: '1500' }], version: 0 },
        metadata,
      ),
    ).rejects.toThrow();

    const updated = await payments.allocate(
      context,
      owner,
      payment.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '1500' }], version: 1 },
      metadata,
    );
    expect(updated.version).toBe(2);
  });

  it('allows an unversioned payment allocation for backward compatibility', async () => {
    const { owner, context, contactId } = await setupInvoiceOrg();
    const invoice = await issuedInvoice(context, owner, contactId, '1500');
    const payment = await payments.record(
      context,
      owner,
      { contactId, receivedDate: '2026-02-01', amountMinor: '1500' },
      metadata,
    );

    const updated = await payments.allocate(
      context,
      owner,
      payment.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '1500' }] },
      metadata,
    );
    expect(updated.version).toBe(1);
  });

  it('rejects a stale payment-made allocation when the version does not match', async () => {
    const { owner, context, vendorId } = await setupBillOrg();
    const bill = await issuedBill(context, owner, vendorId, '1500');
    const payment = await paymentsMade.record(
      context,
      owner,
      { vendorId, paidDate: '2026-02-01', amountMinor: '1500' },
      metadata,
    );
    expect(payment.version).toBe(0);

    await harness.prisma.paymentMade.update({
      where: { id: payment.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      paymentsMade.allocate(
        context,
        owner,
        payment.id,
        { allocations: [{ billId: bill.id, amountMinor: '1500' }], version: 0 },
        metadata,
      ),
    ).rejects.toThrow();

    const updated = await paymentsMade.allocate(
      context,
      owner,
      payment.id,
      { allocations: [{ billId: bill.id, amountMinor: '1500' }], version: 1 },
      metadata,
    );
    expect(updated.version).toBe(2);
  });

  it('allows an unversioned payment-made allocation for backward compatibility', async () => {
    const { owner, context, vendorId } = await setupBillOrg();
    const bill = await issuedBill(context, owner, vendorId, '1500');
    const payment = await paymentsMade.record(
      context,
      owner,
      { vendorId, paidDate: '2026-02-01', amountMinor: '1500' },
      metadata,
    );

    const updated = await paymentsMade.allocate(
      context,
      owner,
      payment.id,
      { allocations: [{ billId: bill.id, amountMinor: '1500' }] },
      metadata,
    );
    expect(updated.version).toBe(1);
  });

  async function journalInput(context: Awaited<ReturnType<typeof setupBillOrg>>['context']) {
    const bankId = (await ledger.accountBySystemKey(context.id, 'bank_default')).id;
    const expenseId = (await ledger.accountBySystemKey(context.id, 'general_expense')).id;
    return {
      journalDate: '2026-06-01',
      currency: 'KES',
      description: 'OC journal test',
      lines: [
        { accountId: bankId, debitMinor: '1000', creditMinor: '0' },
        { accountId: expenseId, debitMinor: '0', creditMinor: '1000' },
      ],
    };
  }

  it('rejects a stale journal draft update when the version does not match', async () => {
    const { owner, context } = await setupBillOrg();
    const input = await journalInput(context);
    const draft = await ledger.createJournalDraft(context, owner, input);
    expect(draft.version).toBe(0);

    await harness.prisma.journal.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      ledger.updateJournalDraft(context, draft.id, { ...input, version: 0 }),
    ).rejects.toThrow();

    const updated = await ledger.updateJournalDraft(context, draft.id, { ...input, version: 1 });
    expect(updated.version).toBe(2);
  });

  it('allows an unversioned journal draft update for backward compatibility', async () => {
    const { owner, context } = await setupBillOrg();
    const input = await journalInput(context);
    const draft = await ledger.createJournalDraft(context, owner, input);

    const updated = await ledger.updateJournalDraft(context, draft.id, input);
    expect(updated.version).toBe(1);
  });

  it('rejects a stale journal post when the version does not match', async () => {
    const { owner, context } = await setupBillOrg();
    const input = await journalInput(context);
    const draft = await ledger.createJournalDraft(context, owner, input);

    await harness.prisma.journal.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      ledger.postJournal(context, owner, draft.id, metadata, 'post-stale', 0),
    ).rejects.toThrow();

    const posted = await ledger.postJournal(context, owner, draft.id, metadata, 'post-ok', 1);
    expect(posted.version).toBe(2);
  });

  it('rejects a stale journal reversal when the version does not match', async () => {
    const { owner, context } = await setupBillOrg();
    const input = await journalInput(context);
    const draft = await ledger.createJournalDraft(context, owner, input);
    const posted = await ledger.postJournal(context, owner, draft.id, metadata, 'reverse-setup');
    expect(posted.version).toBe(1);

    await harness.prisma.journal.update({
      where: { id: posted.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      ledger.reverseJournal(
        context,
        owner,
        posted.id,
        { version: 1, idempotencyKey: 'reverse-stale' },
        metadata,
      ),
    ).rejects.toThrow();

    await ledger.reverseJournal(
      context,
      owner,
      posted.id,
      { version: 2, idempotencyKey: 'reverse-ok' },
      metadata,
    );
    const afterReverse = await harness.prisma.journal.findUniqueOrThrow({
      where: { id: posted.id },
    });
    expect(afterReverse.version).toBe(3);
  });

  it('rejects a stale vendor credit draft update when the version does not match', async () => {
    const { owner, context, vendorId } = await setupBillOrg();
    const draft = await vendorCredits.createDraft(
      context,
      owner,
      { vendorId, lines: [{ description: 'Return', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    expect(draft.version).toBe(0);

    await harness.prisma.vendorCredit.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      vendorCredits.updateDraft(
        context,
        owner,
        draft.id,
        {
          version: 0,
          lines: [{ description: 'Return', quantity: '1', unitPriceMinor: '1200' }],
        },
        metadata,
      ),
    ).rejects.toThrow();

    const updated = await vendorCredits.updateDraft(
      context,
      owner,
      draft.id,
      { version: 1, lines: [{ description: 'Return', quantity: '1', unitPriceMinor: '1200' }] },
      metadata,
    );
    expect(updated.version).toBe(2);
  });

  it('allows an unversioned vendor credit draft update for backward compatibility', async () => {
    const { owner, context, vendorId } = await setupBillOrg();
    const draft = await vendorCredits.createDraft(
      context,
      owner,
      { vendorId, lines: [{ description: 'Return', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );

    const updated = await vendorCredits.updateDraft(
      context,
      owner,
      draft.id,
      { lines: [{ description: 'Return', quantity: '1', unitPriceMinor: '1200' }] },
      metadata,
    );
    expect(updated.version).toBe(1);
  });

  it('rejects a stale vendor credit allocation when the version does not match', async () => {
    const { owner, context, vendorId } = await setupBillOrg();
    const bill = await issuedBill(context, owner, vendorId, '1500');
    const draft = await vendorCredits.createDraft(
      context,
      owner,
      { vendorId, lines: [{ description: 'Return', quantity: '1', unitPriceMinor: '1500' }] },
      metadata,
    );
    const issued = await vendorCredits.issueVendorCredit(context, owner, draft.id, metadata);
    expect(issued.version).toBe(0);

    await harness.prisma.vendorCredit.update({
      where: { id: issued.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      vendorCredits.allocate(
        context,
        owner,
        issued.id,
        { allocations: [{ billId: bill.id, amountMinor: '1500' }], version: 0 },
        metadata,
      ),
    ).rejects.toThrow();

    const updated = await vendorCredits.allocate(
      context,
      owner,
      issued.id,
      { allocations: [{ billId: bill.id, amountMinor: '1500' }], version: 1 },
      metadata,
    );
    expect(updated.version).toBe(2);
  });

  it('rejects a stale sales order draft update when the version does not match', async () => {
    const { owner, context, contactId } = await setupInvoiceOrg();
    const draft = await salesOrders.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    expect(draft.version).toBe(0);

    await harness.prisma.salesOrder.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      salesOrders.updateDraft(
        context,
        owner,
        draft.id,
        {
          version: 0,
          lines: [{ description: 'Widget', quantity: '2', unitPriceMinor: '1000' }],
        },
        metadata,
      ),
    ).rejects.toThrow();

    const updated = await salesOrders.updateDraft(
      context,
      owner,
      draft.id,
      { version: 1, lines: [{ description: 'Widget', quantity: '2', unitPriceMinor: '1000' }] },
      metadata,
    );
    expect(updated.version).toBe(2);
  });

  it('allows an unversioned sales order draft update for backward compatibility', async () => {
    const { owner, context, contactId } = await setupInvoiceOrg();
    const draft = await salesOrders.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );

    const updated = await salesOrders.updateDraft(
      context,
      owner,
      draft.id,
      { lines: [{ description: 'Widget', quantity: '2', unitPriceMinor: '1000' }] },
      metadata,
    );
    expect(updated.version).toBe(1);
  });

  it('rejects a stale sales order confirm when the version does not match', async () => {
    const { owner, context, contactId } = await setupInvoiceOrg();
    const draft = await salesOrders.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const approved = await salesOrders.approve(context, owner, draft.id, metadata);
    expect(approved.version).toBe(0);

    await harness.prisma.salesOrder.update({
      where: { id: approved.id },
      data: { version: { increment: 1 } },
    });

    await expect(salesOrders.confirm(context, owner, approved.id, metadata, 0)).rejects.toThrow();

    const confirmed = await salesOrders.confirm(context, owner, approved.id, metadata, 1);
    expect(confirmed.version).toBe(2);
  });

  it('rejects a stale sales order conversion when the version does not match', async () => {
    const { owner, context, contactId } = await setupInvoiceOrg();
    const draft = await salesOrders.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const approved = await salesOrders.approve(context, owner, draft.id, metadata);
    const confirmed = await salesOrders.confirm(context, owner, approved.id, metadata);
    expect(confirmed.version).toBe(1);

    await harness.prisma.salesOrder.update({
      where: { id: confirmed.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      salesOrders.convertToInvoice(context, owner, confirmed.id, metadata, 1),
    ).rejects.toThrow();

    const converted = await salesOrders.convertToInvoice(context, owner, confirmed.id, metadata, 2);
    expect(converted.version).toBe(3);
  });
});

describe('optimistic concurrency returns 409 Conflict over HTTP (GAPS #35)', () => {
  let harness: TestHarness;
  let invoices: InvoicesService;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let customers: CustomersService;

  beforeAll(async () => {
    harness = await createTestHarness();
    invoices = harness.app.get(InvoicesService);
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    customers = harness.app.get(CustomersService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  async function sessionCookieFor(userId: string): Promise<string> {
    const rawToken = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${rawToken}`;
  }

  async function setupOrg() {
    const user = await harness.prisma.user.create({
      data: {
        email: 'oc-http-owner@example.test',
        displayName: 'OC HTTP Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const owner: PublicUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
    const created = await organizations.create(
      owner,
      { legalName: 'OC HTTP Inc', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    const context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
    const contact = await customers.create(
      context,
      owner,
      { displayName: 'OC HTTP Customer' },
      metadata,
    );
    const cookie = await sessionCookieFor(owner.id);
    return { owner, context, contactId: contact.id, cookie };
  }

  it('returns 409 for a stale invoice PATCH, proving the shared mapping covers an existing type', async () => {
    const { owner, context, contactId, cookie } = await setupOrg();
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );

    await harness.prisma.invoice.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    const response = await harness
      .http()
      .patch(`${API}/organizations/${context.id}/invoices/${draft.id}`)
      .set('Cookie', cookie)
      .send({
        version: 0,
        lines: [{ description: 'Widget', quantity: '2', unitPriceMinor: '1000' }],
      });

    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('CONFLICT');
  });

  it('returns 409 for a stale journal PATCH, proving the new mapping covers a new type', async () => {
    const { owner, context, cookie } = await setupOrg();
    const bankId = (await ledger.accountBySystemKey(context.id, 'bank_default')).id;
    const expenseId = (await ledger.accountBySystemKey(context.id, 'general_expense')).id;
    const input = {
      journalDate: '2026-06-01',
      currency: 'KES',
      description: 'OC HTTP journal test',
      lines: [
        { accountId: bankId, debitMinor: '1000', creditMinor: '0' },
        { accountId: expenseId, debitMinor: '0', creditMinor: '1000' },
      ],
    };
    const draft = await ledger.createJournalDraft(context, owner, input);

    await harness.prisma.journal.update({
      where: { id: draft.id },
      data: { version: { increment: 1 } },
    });

    const response = await harness
      .http()
      .patch(`${API}/organizations/${context.id}/journals/${draft.id}`)
      .set('Cookie', cookie)
      .send({ ...input, version: 0 });

    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('CONFLICT');
  });
});
