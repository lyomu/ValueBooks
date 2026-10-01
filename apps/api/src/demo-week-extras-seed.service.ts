import { Injectable, Logger } from '@nestjs/common';
import { BusinessType, OrganizationStatus } from '@prisma/client';

import { ApprovalTargetsService } from './automation/approval-targets.service.js';
import { ApprovalsService } from './automation/approvals.service.js';
import { RemindersService } from './automation/reminders.service.js';
import { WorkflowsService } from './automation/workflows.service.js';
import type { PublicUser } from './auth/auth.service.js';
import type { RequestMetadata } from './auth/request-context.js';
import { AttachmentsService } from './attachments/attachments.service.js';
import { CollaborationService } from './collaboration/collaboration.service.js';
import { PrismaService } from './database/prisma.service.js';
import type { WeekDates, WeekState } from './demo-week-seed.service.js';
import { FiscalPeriodsService } from './organizations/fiscal-periods.service.js';
import { LedgerService } from './organizations/ledger.service.js';
import type { OrganizationContext } from './organizations/organization-context.js';
import { OrganizationMembersService } from './organizations/organization-members.service.js';
import { OrganizationService } from './organizations/organization.service.js';
import { OpeningBalancesService } from './organizations/opening-balances.service.js';
import { RecurringJournalsService } from './organizations/recurring-journals.service.js';
import { ProjectsService } from './projects/projects.service.js';
import { RecurringInvoicesService } from './sales/recurring-invoices.service.js';

/** Same registry operation the main week seed uses, so the two stages share one idempotency table. */
const STEP_OPERATION = 'DEMO_WEEK_STEP';

/**
 * The tail of the demo week (docs/MOCK_DATA_PLAN.md section 5c): everything that is not a document
 * in the sales/purchases/banking flow. Runs after those stages so it can hang approvals, comments
 * and attachments on the documents they created, and closes an old fiscal period last so nothing
 * above is refused by the period gate.
 *
 * Deviations from "only through services", each because the service is not reachable from here:
 * notifications are written directly (the service also queues an email per row, which a seed must
 * not do), and the suspended tenant is flipped on the row (platform suspension needs a platform
 * administrator context this seed does not hold).
 */
@Injectable()
export class DemoWeekExtrasSeedService {
  private readonly logger = new Logger(DemoWeekExtrasSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly periods: FiscalPeriodsService,
    private readonly openingBalances: OpeningBalancesService,
    private readonly recurringJournals: RecurringJournalsService,
    private readonly recurringInvoices: RecurringInvoicesService,
    private readonly projects: ProjectsService,
    private readonly approvals: ApprovalsService,
    private readonly approvalTargets: ApprovalTargetsService,
    private readonly collaboration: CollaborationService,
    private readonly attachments: AttachmentsService,
    private readonly workflows: WorkflowsService,
    private readonly reminders: RemindersService,
    private readonly members: OrganizationMembersService,
    private readonly organizations: OrganizationService,
  ) {}

  async run(
    context: OrganizationContext,
    owner: PublicUser,
    users: ReadonlyMap<string, PublicUser>,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    await this.seedAccounting(context, owner, metadata, week);
    await this.seedRecurringInvoices(context, owner, metadata, week, state);
    await this.seedTimesheets(context, owner, metadata, week, state);
    await this.seedApprovals(context, owner, users, metadata, state);
    await this.seedCollaboration(context, owner, state);
    await this.seedAutomation(context, owner, users, metadata);
    await this.seedNotifications(context, users);
    await this.seedTeamAndPlatform(context, owner, users, metadata);
    await this.seedAttachments(context, owner, metadata, state);
    await this.closeEarlierPeriod(context, owner, metadata, week);
  }

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

  private async accountId(context: OrganizationContext, code: string): Promise<string> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { organizationId: context.id, code },
      select: { id: true },
    });
    return required(account, `The chart has no account ${code}.`).id;
  }

  private async userId(email: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    return required(user, `Demo user ${email} does not exist.`).id;
  }

  /**
   * Three custom accounts, ten manual journals (nine posted, one left as a draft, one of the posted
   * ones then reversed), one recurring journal and one draft opening-balance batch. The batch stays
   * a draft on purpose: finalizing one posts as of a date before live activity and is refused once
   * the ledger has any.
   */
  private async seedAccounting(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
  ): Promise<void> {
    for (const definition of CUSTOM_ACCOUNTS) {
      const existing = await this.prisma.ledgerAccount.findFirst({
        where: { organizationId: context.id, code: definition.code },
        select: { id: true },
      });
      if (existing) continue;
      await this.ledger.createAccount(
        context,
        owner,
        {
          code: definition.code,
          name: definition.name,
          type: definition.type,
          normalBalance: definition.normalBalance,
          description: 'Demo week custom account',
        },
        metadata,
      );
    }

    for (const definition of MANUAL_JOURNALS) {
      const debitAccountId = await this.accountId(context, definition.debit);
      const creditAccountId = await this.accountId(context, definition.credit);
      const draft = await this.step(context, `journal:${definition.key}:draft`, 'JOURNAL', () =>
        this.ledger.createJournalDraft(context, owner, {
          journalDate: week.day(definition.on),
          currency: 'KES',
          description: definition.description,
          lines: [
            { accountId: debitAccountId, debitMinor: definition.amountMinor, creditMinor: '0' },
            { accountId: creditAccountId, debitMinor: '0', creditMinor: definition.amountMinor },
          ],
        }),
      );
      if (definition.target === 'DRAFT') continue;
      await this.step(context, `journal:${definition.key}:post`, 'JOURNAL', () =>
        this.ledger.postJournal(context, owner, draft.id, metadata),
      );
      if (definition.target !== 'REVERSED') continue;
      await this.step(context, `journal:${definition.key}:reverse`, 'JOURNAL', () =>
        this.ledger.reverseJournal(
          context,
          owner,
          draft.id,
          {
            journalDate: week.day(definition.on + 1),
            description: `Reversal: ${definition.description}`,
          },
          metadata,
        ),
      );
    }

    const insuranceExpense = await this.accountId(context, '5140');
    const prepaidInsurance = await this.accountId(context, '1350');
    await this.step(context, 'recurring-journal:prepaid', 'RECURRING_JOURNAL_TEMPLATE', () =>
      this.recurringJournals.createTemplate(
        context,
        owner,
        {
          name: 'Monthly prepaid insurance release',
          memo: 'Releases one month of prepaid insurance',
          cadence: 'MONTHLY',
          startDate: week.day(8),
          lines: [
            { accountId: insuranceExpense, debitMinor: '300000', creditMinor: '0' },
            { accountId: prepaidInsurance, debitMinor: '0', creditMinor: '300000' },
          ],
        },
        metadata,
      ),
    );

    const equity = await this.prisma.ledgerAccount.findFirst({
      where: { organizationId: context.id, type: 'EQUITY' },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    const bank = await this.accountId(context, '1010');
    await this.step(context, 'opening-balance:draft', 'OPENING_BALANCE_BATCH', () =>
      this.openingBalances.createBatch(
        context,
        owner,
        {
          asOfDate: week.day(-60),
          description: 'Opening balances - draft for review',
          lines: equity
            ? [
                { accountId: bank, debitMinor: '5000000', creditMinor: '0' },
                { accountId: equity.id, debitMinor: '0', creditMinor: '5000000' },
              ]
            : [],
        },
        metadata,
      ),
    );
  }

  /**
   * One active monthly template that is already due (so `runDueTemplates` produces a real
   * occurrence) and one quarterly template that is then deactivated.
   */
  private async seedRecurringInvoices(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    const install = required(state.items.get('install'), 'Missing the installation item.');
    const active = await this.step(context, 'recurring-invoice:active', 'RECURRING_INVOICE', () =>
      this.recurringInvoices.createTemplate(
        context,
        owner,
        {
          contactId: required(state.customers.get('regular'), 'Missing the regular customer.'),
          cadence: 'MONTHLY',
          startDate: week.day(-1),
          autoCreate: true,
          autoSend: false,
          lines: [{ itemId: install, quantity: '10', unitPriceMinor: '85000' }],
        },
        metadata,
      ),
    );
    const paused = await this.step(context, 'recurring-invoice:paused', 'RECURRING_INVOICE', () =>
      this.recurringInvoices.createTemplate(
        context,
        owner,
        {
          contactId: required(state.customers.get('overdue'), 'Missing the overdue customer.'),
          cadence: 'QUARTERLY',
          startDate: week.day(30),
          autoCreate: false,
          autoSend: false,
          lines: [{ itemId: install, quantity: '4', unitPriceMinor: '85000' }],
        },
        metadata,
      ),
    );
    await this.step(context, 'recurring-invoice:paused:deactivate', 'RECURRING_INVOICE', () =>
      this.recurringInvoices.deactivate(context, owner, paused.id, metadata),
    );
    await this.step(context, 'recurring-invoice:run-due', 'RECURRING_INVOICE', async () => {
      await this.recurringInvoices.runDueTemplates(context, owner, metadata);
      return { id: active.id };
    });
  }

  /**
   * Two users, five days each. The accountant's week is fully submitted with three entries approved
   * (so two await approval); the salesperson's week is still in draft.
   */
  private async seedTimesheets(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
    state: WeekState,
  ): Promise<void> {
    const sheets = [
      { key: 'grace', email: 'demo.accountant@valuebooks.local', project: 'westlands-fitout', hours: ['7.50', '8.00', '6.00', '7.00', '8.00'] },
      { key: 'musa', email: 'demo.sales@valuebooks.local', project: 'tumaini-refit', hours: ['4.00', '5.50', '6.00', '4.50', '5.00'] },
    ] as const;
    for (const sheet of sheets) {
      const userId = await this.userId(sheet.email);
      const entryIds: string[] = [];
      for (const [index, hours] of sheet.hours.entries()) {
        const entry = await this.step(
          context,
          `time:${sheet.key}:${index}`,
          'TIME_ENTRY',
          () =>
            this.projects.createTimeEntry(
              context,
              owner,
              {
                projectId: required(state.projects.get(sheet.project), 'Unknown timesheet project.'),
                userId,
                entryDate: week.day(index - 6),
                hours,
                note: `Demo week - day ${index + 1}`,
              },
              metadata,
            ),
        );
        entryIds.push(entry.id);
      }
      if (sheet.key !== 'grace') continue;

      await this.step(context, 'time:grace:submit', 'TIME_ENTRY', async () => {
        await this.projects.submitTime(context, owner, { timeEntryIds: entryIds }, metadata);
        return { id: entryIds[0]! };
      });
      await this.step(context, 'time:grace:approve', 'TIME_ENTRY', async () => {
        await this.projects.approveTime(
          context,
          owner,
          { timeEntryIds: entryIds.slice(0, 3), comment: 'Approved for billing' },
          metadata,
        );
        return { id: entryIds[0]! };
      });
    }
  }

  /**
   * Three active policies (quote, invoice, bill) with a named approver, then one pending request on
   * a document of each type. Created after every document that must flow through unimpeded, since an
   * active policy applies to all later submissions of its type.
   */
  private async seedApprovals(
    context: OrganizationContext,
    owner: PublicUser,
    users: ReadonlyMap<string, PublicUser>,
    metadata: RequestMetadata,
    state: WeekState,
  ): Promise<void> {
    const approver = required(users.get('ADMIN'), 'Missing the demo admin user.');
    const targets = [
      { type: 'QUOTE', label: 'Quote', id: state.quotes.get('pending') },
      { type: 'INVOICE', label: 'Invoice', id: state.invoices.get('unissued') },
      { type: 'BILL', label: 'Bill', id: state.bills.get('draft') },
    ] as const;
    for (const target of targets) {
      const policy = await this.step(
        context,
        `approval-policy:${target.type}`,
        'APPROVAL_POLICY',
        () =>
          this.approvals.createPolicy(
            context,
            owner,
            {
              name: `${target.label} sign-off`,
              targetType: target.type,
              priority: 10,
              allowSelfApproval: false,
              steps: [{ approverUserId: approver.id, label: 'Finance manager' }],
            },
            metadata,
          ),
      );
      await this.step(context, `approval-policy:${target.type}:activate`, 'APPROVAL_POLICY', async () => {
        await this.approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);
        return { id: policy.id };
      });
    }
    for (const target of targets) {
      const targetId = required(target.id, `Missing the ${target.label} awaiting approval.`);
      await this.step(context, `approval-request:${target.type}`, 'APPROVAL_REQUEST', () =>
        this.approvalTargets.submit(context, owner, target.type, targetId, metadata),
      );
    }
  }

  private async seedCollaboration(
    context: OrganizationContext,
    owner: PublicUser,
    state: WeekState,
  ): Promise<void> {
    for (const definition of INVOICE_COMMENTS) {
      const invoiceId = required(state.invoices.get(definition.invoice), `Unknown invoice ${definition.invoice}.`);
      for (const [index, body] of definition.comments.entries()) {
        await this.step(context, `comment:${definition.invoice}:${index}`, 'COMMENT', () =>
          this.collaboration.addCommentInternal(context, owner, 'INVOICE', invoiceId, {
            body,
            visibility: 'INTERNAL',
          }),
        );
      }
    }
  }

  /** A reminder policy (three offsets) and one workflow rule that notifies the admin on issue. */
  private async seedAutomation(
    context: OrganizationContext,
    owner: PublicUser,
    users: ReadonlyMap<string, PublicUser>,
    metadata: RequestMetadata,
  ): Promise<void> {
    const admin = required(users.get('ADMIN'), 'Missing the demo admin user.');
    const policy = await this.step(context, 'reminder-policy:standard', 'REMINDER_POLICY', () =>
      this.reminders.create(
        context,
        owner,
        {
          name: 'Standard payment reminders',
          offsets: [-3, 0, 7],
          subject: 'Invoice {{invoiceNumber}} payment reminder',
          bodyTemplate: 'Hello {{customerName}}, invoice {{invoiceNumber}} is due on {{dueDate}}.',
        },
        metadata,
      ),
    );
    await this.step(context, 'reminder-policy:standard:activate', 'REMINDER_POLICY', async () => {
      await this.reminders.setActive(context, owner, policy.id, true, metadata);
      return { id: policy.id };
    });

    const rule = await this.step(context, 'workflow-rule:invoice-issued', 'WORKFLOW_RULE', () =>
      this.workflows.create(
        context,
        owner,
        {
          name: 'Tell finance when an invoice is issued',
          trigger: 'invoice.issued',
          conditions: [],
          actions: [
            {
              type: 'CREATE_NOTIFICATION',
              recipientUserId: admin.id,
              title: 'An invoice was issued',
              body: 'A new invoice has been issued and is ready for follow-up.',
            },
          ],
        },
        metadata,
      ),
    );
    await this.step(context, 'workflow-rule:invoice-issued:activate', 'WORKFLOW_RULE', async () => {
      await this.workflows.setStatus(context, owner, rule.id, 'ACTIVE', metadata);
      return { id: rule.id };
    });
  }

  /** Six notifications across three recipients, four unread and two read. */
  private async seedNotifications(
    context: OrganizationContext,
    users: ReadonlyMap<string, PublicUser>,
  ): Promise<void> {
    await this.step(context, 'notifications:seed', 'NOTIFICATION', async () => {
      const now = Date.now();
      await this.prisma.notification.createMany({
        data: NOTIFICATIONS.map((notification, index) => ({
          organizationId: context.id,
          recipientUserId: required(users.get(notification.recipient), `Missing user ${notification.recipient}.`).id,
          eventKey: notification.eventKey,
          title: notification.title,
          body: notification.body,
          href: notification.href,
          status: notification.read ? ('READ' as const) : ('UNREAD' as const),
          readAt: notification.read ? new Date(now - index * 3_600_000) : null,
          createdAt: new Date(now - index * 5_400_000),
        })),
      });
      return { id: context.id };
    });
  }

  /**
   * One pending invitation and two extra tenants: a draft workspace owned by the accountant and a
   * suspended one owned by the salesperson (their own drafts, so the per-user draft cap is not hit).
   */
  private async seedTeamAndPlatform(
    context: OrganizationContext,
    owner: PublicUser,
    users: ReadonlyMap<string, PublicUser>,
    metadata: RequestMetadata,
  ): Promise<void> {
    const role = required(
      await this.prisma.role.findFirst({
        where: { organizationId: context.id, key: 'VIEWER' },
        select: { id: true },
      }),
      'The demo organization has no VIEWER role.',
    );
    await this.step(context, 'invitation:pending', 'INVITATION', async () => {
      const issued = await this.members.issueInvitationForBootstrap(
        context,
        owner,
        { email: 'demo.pending@valuebooks.local', roleId: role.id },
        metadata,
      );
      return { id: issued.invitation.id };
    });

    for (const tenant of EXTRA_TENANTS) {
      const creator = required(users.get(tenant.creator), `Missing user ${tenant.creator}.`);
      const existing = await this.prisma.organization.findFirst({
        where: { legalName: tenant.legalName, createdByUserId: creator.id },
        select: { id: true, status: true },
      });
      const created =
        existing ??
        (await this.organizations.create(
          creator,
          {
            legalName: tenant.legalName,
            tradingName: tenant.tradingName,
            businessType: BusinessType.LIMITED_COMPANY,
            countryCode: 'KE',
          },
          metadata,
        ));
      if (tenant.suspended && created.status !== OrganizationStatus.SUSPENDED) {
        await this.prisma.organization.update({
          where: { id: created.id },
          data: { status: OrganizationStatus.SUSPENDED },
        });
      }
    }
  }

  /**
   * Four small text files on invoices and bills. Object storage is a separate service that a bare
   * `db:seed` may not have running, so a failure here is logged rather than fatal; `verify()`
   * reports the attachment count without requiring it.
   */
  private async seedAttachments(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    state: WeekState,
  ): Promise<void> {
    for (const definition of ATTACHMENTS) {
      const entityId = (definition.entityType === 'INVOICE' ? state.invoices : state.bills).get(definition.key);
      if (!entityId) continue;
      try {
        await this.step(context, `attachment:${definition.entityType}:${definition.key}`, 'ATTACHMENT', () => {
          const buffer = Buffer.from(definition.content, 'utf8');
          return this.attachments.upload(
            context,
            owner,
            definition.entityType,
            entityId,
            { originalname: definition.filename, mimetype: 'text/plain', size: buffer.length, buffer },
            metadata,
          );
        });
      } catch (error) {
        this.logger.warn(
          `Skipped attachment ${definition.filename}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** Closes the latest period that ended before the oldest seeded document, per section 5c. */
  private async closeEarlierPeriod(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
    week: WeekDates,
  ): Promise<void> {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: {
        organizationId: context.id,
        status: 'OPEN',
        endsOn: { lt: new Date(`${week.day(-46)}T00:00:00.000Z`) },
      },
      orderBy: { endsOn: 'desc' },
      select: { id: true },
    });
    if (!period) return;
    await this.step(context, 'period:close-earlier', 'FISCAL_PERIOD', async () => {
      await this.periods.close(context, owner, period.id, { note: 'Closed for the demo week' }, metadata);
      return { id: period.id };
    });
  }
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const CUSTOM_ACCOUNTS = [
  { code: '5230', name: 'Staff training', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: '5240', name: 'Security services', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: '1350', name: 'Prepaid insurance', type: 'ASSET', normalBalance: 'DEBIT' },
] as const;

interface ManualJournalDefinition {
  key: string;
  on: number;
  description: string;
  /** Starter-chart (or custom) account codes. */
  debit: string;
  credit: string;
  amountMinor: string;
  target: 'POSTED' | 'DRAFT' | 'REVERSED';
}

/** Ten manual journals: eight posted, one posted then reversed, one draft. */
const MANUAL_JOURNALS: readonly ManualJournalDefinition[] = [
  { key: 'insurance', on: -6, description: 'Annual insurance premium prepaid', debit: '1350', credit: '1010', amountMinor: '3600000', target: 'POSTED' },
  { key: 'software', on: -5, description: 'Accounting software subscription', debit: '5150', credit: '1010', amountMinor: '450000', target: 'POSTED' },
  { key: 'reclass', on: -4, description: 'Reclassify fuel from office supplies to transport', debit: '5080', credit: '5060', amountMinor: '45000', target: 'POSTED' },
  { key: 'welfare', on: -4, description: 'Staff tea and coffee', debit: '5050', credit: '1000', amountMinor: '85000', target: 'POSTED' },
  { key: 'internet', on: -3, description: 'Office internet - September', debit: '5020', credit: '1010', amountMinor: '650000', target: 'POSTED' },
  { key: 'training', on: -3, description: 'Staff training workshop', debit: '5230', credit: '1010', amountMinor: '900000', target: 'POSTED' },
  { key: 'security', on: -2, description: 'Security guard services', debit: '5240', credit: '1010', amountMinor: '1200000', target: 'POSTED' },
  { key: 'wrong', on: -2, description: 'Licence fee posted to the wrong account', debit: '5160', credit: '1010', amountMinor: '300000', target: 'REVERSED' },
  { key: 'permits', on: -1, description: 'County permits', debit: '5160', credit: '1000', amountMinor: '200000', target: 'POSTED' },
  { key: 'draft', on: 0, description: 'Travel accrual - awaiting receipts', debit: '5090', credit: '1010', amountMinor: '250000', target: 'DRAFT' },
];

const INVOICE_COMMENTS: readonly { invoice: string; comments: readonly string[] }[] = [
  {
    invoice: 'aging-45',
    comments: [
      'Called the customer - finance says payment is with the approver this week.',
      'Promised payment by Friday. Reminders paused until then.',
    ],
  },
  { invoice: 'usd', comments: ['Customer asked for the USD statement before paying.'] },
  {
    invoice: 'thirty-day',
    comments: ['Delivery confirmed by the warehouse.', 'Customer disputed one line - checking the delivery note.'],
  },
];

const NOTIFICATIONS: readonly {
  recipient: string;
  eventKey: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
}[] = [
  { recipient: 'OWNER', eventKey: 'approval.submitted', title: 'Approval requested: quote', body: 'A quote is waiting for sign-off.', href: '/approvals', read: false },
  { recipient: 'OWNER', eventKey: 'invoice.overdue', title: 'Invoice overdue', body: 'An invoice is 45 days past issue and unpaid.', href: '/invoices', read: false },
  { recipient: 'OWNER', eventKey: 'payment.recorded', title: 'Payment received', body: 'A customer payment was recorded.', href: '/payments', read: true },
  { recipient: 'ADMIN', eventKey: 'approval.submitted', title: 'You have 3 approvals waiting', body: 'A quote, an invoice and a bill need your decision.', href: '/approvals', read: false },
  { recipient: 'ADMIN', eventKey: 'reconciliation.completed', title: 'Reconciliation completed', body: 'The current account reconciliation balanced.', href: '/reconciliations', read: true },
  { recipient: 'ACCOUNTANT', eventKey: 'bill.posted', title: 'Bill posted', body: 'A supplier bill was posted to accounts payable.', href: '/bills', read: false },
];

const EXTRA_TENANTS = [
  { legalName: 'Mwangaza Traders Ltd', tradingName: 'Mwangaza Traders', creator: 'ACCOUNTANT', suspended: false },
  { legalName: 'Pwani Freight Ltd', tradingName: 'Pwani Freight', creator: 'SALES', suspended: true },
] as const;

const ATTACHMENTS: readonly {
  entityType: 'INVOICE' | 'BILL';
  key: string;
  filename: string;
  content: string;
}[] = [
  { entityType: 'INVOICE', key: 'aging-45', filename: 'signed-delivery-note.txt', content: 'Delivery note DN-2291 signed by the customer on receipt.' },
  { entityType: 'INVOICE', key: 'usd', filename: 'export-packing-list.txt', content: 'Packing list for the USD order: 20 solar panels, 30 air fresheners.' },
  { entityType: 'BILL', key: 'received', filename: 'supplier-invoice-TPS-2291.txt', content: 'Supplier invoice TPS-INV-2291 for tiles and padlocks.' },
  { entityType: 'BILL', key: 'overdue', filename: 'statement-of-account.txt', content: 'Nairobi Stationery Mart statement - August balance outstanding.' },
];
