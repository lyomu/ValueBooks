# Mock Data Plan: one week of test data across all modules

Status: plan only, nothing implemented. Target window: **Fri 18 Sep 2026 to Thu 24 Sep 2026** (7 days ending "today").

## 1. Goal

Give developers and testers a realistic, repeatable week of business activity for the demo organization, so every screen (lists, detail panes, reports, dashboard) has data worth looking at, including the edge states we keep needing: overdue, partially paid, draft, void, written off.

## 2. Approach

Extend the existing seed instead of writing SQL.

- `apps/api/src/demo-seed.service.ts` already builds the "ValueBooks Demo Company Ltd" org (KES base, USD/EUR enabled, VAT-STD/VAT-ZERO, five role users, one portal customer). It runs through the real services, so ledger postings, numbering, audit events and tax snapshots are correct.
- Add **`apps/api/src/demo-week-seed.service.ts`**, called from `DemoSeedService.run()` after `ensurePortalDemo`. Register it in `app.module.ts`.
- Everything goes through service methods (`InvoicesService.createDraft/issueInvoice`, `PaymentsService.record/allocate`, and so on). No direct Prisma inserts except where a service cannot backdate.
- **Idempotent:** each record carries a stable seed key (`sourceType: 'DEMO_WEEK'`, `sourceId: '<slug>'`, or a name we look up first). Re-running skips what exists. Guarded by the same production check (`ALLOW_DEMO_SEED`).
- Run with the existing `npm run db:seed` in `apps/api`. Add `--reset-week` later only if needed.

Known constraint: services stamp "today" as the issue date. Backdating invoices across the week needs either a date override parameter on the seed path or a documented direct update of `issue_date`/`due_date` after posting. Decide during implementation; the journal date must match, so prefer a service-level override.

## 3. Master data (created once, before the week)

| Module | Records |
| --- | --- |
| Customers | 8: mix of KES/USD, with and without email, one deactivated, one in credit |
| Vendors | 5: stationery, logistics, utilities, packaging supplier, one USD supplier |
| Catalog items | 12: 7 goods (tracked stock), 3 services, 2 non-inventory; default prices, VAT-STD or VAT-ZERO |
| Warehouses | 2 (Main, Westlands) |
| Financial accounts | Cash till, Equity bank, M-Pesa paybill |
| Expense categories | Rent, Utilities, Transport, Office supplies, Marketing |
| Projects | 2, used to tag a few invoice lines |
| Reminder policy | 1 active (offsets -3, 0, +7) |

Customer names should include an overdue-prone one and a long name (to test list truncation).

## 4. Transactions by day

Amounts in KES unless stated. "Issued" means posted to the ledger.

| Day | Sales | Purchases | Banking / other |
| --- | --- | --- | --- |
| Fri 18 | 3 invoices issued (one 30-day terms, one due on receipt, one with 16% VAT lines). 1 quote drafted then approved and sent. | 2 vendor bills issued. 1 purchase order created and approved. | Opening bank and till balances posted as a journal. |
| Sat 19 | 2 invoices issued (one to a USD customer). 1 sales order approved. | 1 expense (transport) paid from till. | Statement import: 6 bank lines. |
| Sun 20 | 1 walk-in invoice, paid same day by payment. | 1 recurring expense template created (rent, monthly). | None (quiet day). |
| Mon 21 | Payment received in full for a Friday invoice. Partial payment (50%) on another. 1 quote converted to invoice. | Goods received against the purchase order, 1 bill posted from it. Inventory adjustment (-2 damaged). | Bank rule created; 3 statement lines matched. |
| Tue 22 | 1 credit note issued and allocated to an invoice. 1 invoice voided (no payments). 1 draft invoice left unissued. | Payment made against a Friday bill. Vendor credit issued. | Transfer between till and Equity bank. |
| Wed 23 | Overdue invoice: issued on a past date so it shows "overdue by N days". Reminder stopped on one open invoice; expected payment date set on another. | 1 recurring bill template. | Reconciliation started (left open). |
| Thu 24 | 1 invoice partly written off (exercises the new write-off flow). 1 recurring invoice template run manually via run-due. Payment received unapplied (to test allocation). | Expense claim awaiting approval. | Timesheet entries for 2 users, one submitted. |

Target totals for the week: about 12 sales invoices, 6 payments received, 3 bills, 2 payments made, 1 credit note, 1 vendor credit, 2 quotes, 1 sales order, 1 purchase order, 5 expenses, 1 reconciliation.

## 5. Cross-cutting states that must exist

- Every invoice status: DRAFT, ISSUED, PARTIALLY_PAID, PAID, VOID (and an overdue-by-date one).
- At least one invoice with a written-off amount, one with reminders stopped, one with an expected payment date.
- One foreign-currency invoice and payment (USD) so FX lines appear.
- One pending approval (quote or expense) for the approvals screen.
- One overdue bill, so payables ageing is not empty.
- Stock movements for the goods items (opening stock, sales, receipt, adjustment) so inventory valuation reports have rows.

### 5a. Status coverage per document type

Every status below should have at least one record, so filters and badges are testable. Quantities are minimums.

| Document | Statuses to cover |
| --- | --- |
| Invoices | DRAFT, PENDING_APPROVAL (1), ISSUED, PARTIALLY_PAID, PAID, OVERDUE by date, VOID |
| Quotes | DRAFT, PENDING_APPROVAL, APPROVED, SENT, ACCEPTED, DECLINED, EXPIRED, CONVERTED (to an invoice) |
| Sales orders | DRAFT, APPROVED, CONFIRMED, PARTIALLY_FULFILLED, FULFILLED, CANCELLED |
| Credit notes | DRAFT, ISSUED, APPLIED, REFUNDED, VOID |
| Payments received | UNAPPLIED, PARTIALLY_ALLOCATED, FULLY_ALLOCATED |
| Bills | DRAFT, ISSUED, PARTIALLY_PAID, PAID, VOID |
| Purchase orders | DRAFT, APPROVED, ISSUED, CLOSED, CANCELLED; receipt status NOT_RECEIVED, PARTIALLY_RECEIVED, RECEIVED |
| Vendor credits | DRAFT, ISSUED, APPLIED, VOID |

### 5b. Linked document chains

The "invoiced" relationships need real links, not just matching customers, so drill-downs and "converted" badges work.

- **Sales:** quote (ACCEPTED, then CONVERTED) → sales order (CONFIRMED) → invoice (ISSUED) → payment → allocation. Build one full chain, plus one sales order that is only partly fulfilled and invoiced.
- **Purchases:** purchase order (ISSUED) → goods receipt → bill (ISSUED) → payment made → allocation. One PO stays partly received.
- **Credits:** invoice → credit note allocated back to that invoice; one credit note refunded in cash.
- **Recurring:** one recurring invoice template that has already produced an invoice, so it appears in both the template list and the invoice list.
- **Write-off / reminders:** on the same open invoice where possible, so one record shows several collections flags.

### 5c. Module coverage matrix (every route under `apps/web/src/app`)

Rule: no module ships empty. Each row lists the minimum seed. "From week" means it is filled by the transactions in section 4 rather than seeded separately.

**Sales**

| Module | Minimum data |
| --- | --- |
| Customers | 8 (see section 3) |
| Quotes | 8, one per status |
| Sales orders | 6, one per status |
| Invoices | 12, all statuses (5a) |
| Recurring invoices | 2 templates (one active, one deactivated) |
| Payments received | 6, all three statuses |
| Credit notes | 4, one per status except VOID plus one VOID |
| Statements | From week (customer statement for the overdue customer) |

**Purchases**

| Module | Minimum data |
| --- | --- |
| Vendors | 5 |
| Purchase orders | 4, all statuses |
| Bills | 5, all statuses |
| Recurring bills | 1 |
| Payments made | 3 |
| Vendor credits | 2 |
| Expenses | 6, across 4 categories, one pending approval |
| Expense categories | 5 |
| Recurring expenses | 2 |

**Inventory**

| Module | Minimum data |
| --- | --- |
| Catalog (items) | 12 (goods, services, non-inventory) |
| Warehouses | 2 |
| Stock movements | From week (opening, sale, receipt, adjustment) |
| Inventory adjustments | 2 (one write-down, one recount) |
| Inventory transfers | 2 between the warehouses |
| Inventory valuation | From week |
| Reorder | 3 items below reorder point |

**Banking**

| Module | Minimum data |
| --- | --- |
| Financial accounts | 3 |
| Bank transactions | 20 (matched and unmatched) |
| Statement imports | 2 (one CSV parsed, one with duplicate lines) |
| Bank rules | 3 |
| Transfers | 2 |
| Reconciliation | 1 completed, 1 open |

**Accounting**

| Module | Minimum data |
| --- | --- |
| Chart of accounts | Starter chart plus 3 custom accounts (including 5180 if missing) |
| Journals | 10 (manual, posted, one reversed, one draft) |
| Recurring journals | 1 |
| Opening balances | 1 batch |
| Periods | Fiscal year open; one earlier period closed |
| Tax | VAT-STD, VAT-ZERO, one exempt code |
| Trial balance / Reports | From week; verified in section 6 |
| Numbering | Prefixes set for invoice, bill, quote, order |

**Projects and time**

| Module | Minimum data |
| --- | --- |
| Projects | 3 (with budgets), invoice and bill lines tagged to them |
| Project profitability | From week |
| Timesheets | 2 users, 5 days each, one submitted |
| Time approvals | 2 entries awaiting approval |

**Platform and workspace**

| Module | Minimum data |
| --- | --- |
| Dashboard | From week |
| Insights | From week (collections priorities need the overdue invoices) |
| Approvals | 3 pending (quote, expense, invoice) |
| Automation | Reminder policy plus 1 workflow rule |
| Documents / attachments | 4 files attached to invoices and bills |
| Comments and activity | Comments on 3 invoices, so collaboration threads show |
| Notifications | 6, mixed read and unread |
| Portal | Existing customer, plus 2 more invoices visible to them |
| Settings: team | 5 demo users (existing), one pending invitation |
| Settings: currencies, security, audit log | Currencies existing; audit log from week |
| Platform admin | 2 extra organizations (one suspended) |

Any module not listed here that turns up under `apps/web/src/app` when implementation starts is added to this table before the seed is considered done. The final `verify()` step should loop over a list of these tables and fail if any has zero rows.

## 6. Reporting checks

After seeding, these should be non-empty and internally consistent:

- Trial balance balances (debits equal credits).
- Receivables ageing shows current, 1-30 and 31-60 buckets.
- Dashboard cards: outstanding, overdue, cash, this week's sales.
- Sales by customer and by item, with today included.
- Inventory valuation matches stock movements.

Add assertions for these in the seed's `verify()` step, the same way the existing seed asserts its own proof points.

## 7. Files to touch

| File | Change |
| --- | --- |
| `apps/api/src/demo-week-seed.service.ts` | New. Master data, per-day steps, verify. |
| `apps/api/src/demo-seed.service.ts` | Call the new service; include its counts in the summary. |
| `apps/api/src/app.module.ts` | Register the provider. |
| `docs/MOCK_DATA_PLAN.md` | This plan; update with credentials and counts once built. |

## 11. Implementation status

**Decision taken:** option A from section 10 -- one optional `businessDate` parameter on the posting
methods only (invoice issue and write-off, bill issue, credit-note issue/allocate/refund, vendor-credit
issue/allocate, expense post, PO receipt), defaulting to today, internal to the API.

Done:

- The override is implemented and threaded into the document date, the journal date, the tax-rate
  resolution date and the document-number allocation. `InventoryService#postInvoiceCogs` already reads
  `invoice.issueDate`, so COGS movements and their journal inherit a backdated invoice for free.
  `purchase-orders.service.ts` still stamps today on PO issue -- that is option A+ territory, left out
  deliberately.
- `apps/api/src/demo-week-seed.service.ts` exists with: tax rates (including a 0% rate so VAT-EXEMPT
  resolves), the eight customers, twelve items, two warehouses, three projects, opening stock as
  posted adjustments (required -- `consumeStock` refuses an issue with no layers), the invoice week
  including the two ageing-history invoices, the quote and order ladders with both conversion chains,
  six receipts across all three allocation states, five credit notes across all statuses, and the
  collections states (reminders stopped, expected payment date, void, partial write-off).
- Idempotency: each transaction step writes one `LedgerIdempotencyKey` row under operation
  `DEMO_WEEK_STEP`, so a re-run adopts what exists instead of duplicating the week. Master data is
  matched on its natural key (name/code) so an existing record is reused.
- `verify()` fails if any table this stage owns is empty and re-adds the posted journal lines itself to
  prove the ledger balances.

Also written (25 Sep 2026, still never executed):

- Purchases: five vendors, five expense categories, six purchase orders (received, partly received,
  draft, approved, closed, cancelled), seven bills (from the PO, overdue, paid, half paid, USD, draft,
  void), three payments made, four vendor credits, seven expenses (one pending approval, one draft),
  two recurring bills and two recurring expenses.
- Inventory: four adjustments (write-down and recount posted, one pending approval, one draft) and two
  main-to-Westlands transfers.
- Banking: three financial accounts, three rules, two transfers, two CSV imports (the second with a
  duplicate and a malformed row), 21 bank transactions in matched/categorized/excluded/unresolved
  states, one completed and one open reconciliation. Banking and Organizations modules now export
  the services the seed needs.
- `apps/api/src/demo-week-extras-seed.service.ts`: custom accounts, ten manual journals (one
  reversed, one draft), a recurring journal, a draft opening-balance batch, recurring invoice
  templates plus a run-due occurrence, timesheets for two users, approval policies with three pending
  requests, invoice comments, a reminder policy and workflow rule, six notifications, a pending
  invitation, two extra tenants (one suspended), four attachments (best effort -- needs object
  storage) and an earlier closed fiscal period.
- `verify()` now asserts every section 5c table and its states, ledger balance, and the receivables
  ageing buckets; the valuation-vs-ledger comparison only logs.

Deliberately not done: numbering prefixes, tax extras, portal documents, and finalizing the
opening-balance batch. Deviations from "services only": notifications are inserted directly (the
service queues emails) and the suspended tenant is flipped on the row.

Known unknowns to confirm on the first run (nothing has been executed yet): the exact
`RecurringInvoicesService#createTemplate` input shape, the inventory adjustment approval path for
non-opening adjustments, and whether `QuotesService#submitForApproval` reaches PENDING_APPROVAL
without an approval policy (it is assumed to, because the base seed already calls it).



## 8. Risks and open questions

1. **Backdating.** See section 2, and section 10 for the confirmed mechanics and the options. Blocked on the decision below.
2. **Existing demo dates.** CONFIRMED 24 Sep 2026: the demo org's period `FY2026-P09` (1-30 Sep 2026) is OPEN, so a week ending 24 Sep needs no new period.
3. **Write-off** requires ledger account 5180 to exist. CONFIRMED 24 Sep 2026: `5180 Bad debt expense` (EXPENSE, debit) exists in the demo org, so `POST /invoices/:id/write-off` will post.
4. **Run time.** Around 100 service calls in one process. Expect a minute or two; keep it in one seed run, not per test.
5. **Email side effects.** Sending invoices enqueues real email jobs. The seed should skip sends or point at the local mail sink.
6. **Prerequisites are not in place yet (24 Sep 2026).** `npx prisma generate` in `apps/api` failed with EPERM (the query-engine DLL was locked by a running API), and `apps/api/node_modules/.prisma/client` is absent -- so `npm run db:seed` (which builds first) and `npm run dev` both fail until the API is stopped, `prisma generate` + `prisma migrate deploy` (migration `20260924100000_add_invoice_collections_fields`) run, and the API restarts.
7. **Baseline in the demo org (24 Sep 2026).** One contact (the portal customer Karibu Wholesale Ltd), 1 invoice, 1 quote, 5 journals; zero vendors, items, bills, financial accounts, bank transactions. So the week seed owns section 3 master data as well as the week itself, and must not disturb the portal demo records (`sourceType: 'DEMO_SEED'`).

## 9. Suggested order of work

1. Master data and idempotency helpers.
2. Sales flow (invoices, payments, credit note, void, write-off).
3. Purchases flow (bills, payments made, PO receipt).
4. Banking and inventory.
5. Cross-cutting states, then `verify()` assertions.
6. Document credentials, counts and how to re-run.

## 10. Backdating mechanics (investigated 24 Sep 2026)

Services stamp the document date from the server clock (`dateOnly(new Date())` inline); there is no
business-date seam on the sales/purchases paths. The stamping sites that matter here:

| Service call | Stamps | Consequence of using the run day |
| --- | --- | --- |
| `InvoicesService#issueInvoice` (`invoices.service.ts:310`) | `issueDate` | Journal date, tax rate resolved as of that date, document-number allocation date, invoice/due date; COGS movement + journal dates already read `invoice.issueDate` (`inventory.service.ts:656,676`) |
| `InvoicesService#writeOff` (`invoices.service.ts:667`) | Journal date | Bad-debt posting lands on the run day |
| `BillsService#issueBill` (`bills.service.ts:250`) | `issueDate` | AP journal date, bill date, recoverable-tax date |
| `CreditNotesService#issueCreditNote` (`:273`), `#applyToInvoices` (`:641`), `#refund` (`:772`) | Issue, allocation, refund dates | Customer-credit postings |
| `VendorCreditsService#issue` (`:261`), `#apply` (`:607`) | Issue, application dates | Vendor-credit postings |
| `ExpensesService` post/approve (`expenses.service.ts:278`) | `postDate` | Expense journal date (the `expenseDate` itself is already an input) |
| `QuotesService#approve` (`quotes.service.ts:218`), `SalesOrdersService#approve` (`:212`), `PurchaseOrdersService#issue` (`:236`) | Approval/issue date | Display only -- these never post |
| `InventoryService#recordPurchaseOrderReceipt` (`inventory.service.ts:600`) | Movement date | Inbound stock layer date |
| `InvoicesService#sendInvoice`, reminder sweeps | `sentAt`, reminder schedule | Enqueues real email jobs |

Already backdatable through existing inputs, so no change needed: payments received
(`CreatePaymentDto.receivedDate`), payments made (`CreatePaymentDto.paidDate`), expenses
(`expenseDate`), inventory adjustments (`adjustmentDate`), banking transfers (`transferDate`),
journals (`journalDate`), opening balances (`asOfDate`), FX revaluation (`asOfDate`), statement
imports (CSV dates), and both `LedgerService#reverseJournal` and `#postJournalFromLines`, which take
an explicit `journalDate` and check the period against that date.

Two further facts that narrow the work:

- Quote to invoice and sales-order to invoice conversion both only create a **DRAFT** invoice
  (`convertedInvoiceId` link, nothing posted), so a converted invoice can still be issued through
  whatever override is chosen.
- Recurring run-due derives its `occurrenceDate` from the template's `nextRunDate` (seed-controlled
  via `startDate`), but the generated invoice's `issueDate` still comes from `issueInvoice`.

Options:

- **A. Service-level date override (recommended).** One optional ISO-date parameter on the posting
  methods above, defaulting to today and threaded into the journal date, the tax resolution date,
  the number allocation and the document date. Internal parameter only: no DTO, controller or
  contract change, so nothing becomes client-settable. About ten signatures plus their call sites;
  it is what makes the seed's journal dates match its document dates, which section 2 requires.
- **A+. Override on the posting paths and the order/quote approvals too.** As A, plus
  `QuotesService#approve`, `SalesOrdersService#approve`, `PurchaseOrdersService#issue` and the PO
  receipt, so every list date in the week narrative matches section 4 rather than only the ones with
  ledger consequences.
- **B. Override plus a public field.** As A/A+, but threaded through the DTOs, controllers and
  `packages/contracts` as a real backdating feature (Zoho allows a chosen invoice date). A product
  decision with contract and UI work, not a seed requirement.
- **C. Ambient business date.** Replace every `dateOnly(new Date())` with an injected provider,
  mirroring the existing `CLOCK` seam (`automation/clock.ts`), and set the business date per seed
  step. One seam, reusable for posting-date defaults; touches every stamping site and adds ambient
  state that a later real posting could inherit if not reset.
- **D. Post-hoc database update.** Seed everything as "today", then update `issue_date`/`due_date`
  and the journal dates directly. Fastest, but rewrites posted journals after the period gate and
  audit events were written and desynchronises the posting-time snapshots. Section 2 advises against
  it.

Whichever is chosen, the seed should compute its dates relative to the run day (`D-6` ... `D0`)
rather than hard-coding 18-24 Sep 2026, so it stays fresh on every run; with the run day being
24 Sep 2026 today, that reproduces section 4 exactly.
