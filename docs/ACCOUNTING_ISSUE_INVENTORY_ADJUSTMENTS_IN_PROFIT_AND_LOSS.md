# Accounting issue: inventory gains and opening stock are posted as negative expenses

**Status:** Open. Investigated 2026-10-22; nothing has been changed yet.
**Severity:** P1, accounting correctness (General ledger and financial posting integrity, root `AGENTS.md` §5).
**Found during:** a regression check of the customer dashboard while doing the Platform Admin redesign. The issue is
unrelated to that work and is tracked separately.
**Owner decision needed:** see §6. This changes posting behaviour, so it needs product-owner and accountant sign-off
before implementation.

## 1. Symptom

The customer dashboard for the demo tenant *Karibu Retail Demo*, period 1–22 October 2026 (KES), shows:

| Tile | Shown | Expected (if opening stock is not profit) |
|---|---:|---:|
| Total income | KES 649,250.00 | KES 649,250.00 |
| Total expenses | **−KES 100,170.00** | KES 352,030.00 |
| Net profit | **KES 749,420.00** (greater than income) | KES 297,220.00 |

Secondary symptoms:
- The *Top expenses* list adds up to roughly +KES 358k, but its centre total says −KES 100,170. Every row shows
  "0.0%", because each share is divided by a negative total.
- The *Income vs expenses* chart draws expenses below zero.

## 2. The dashboard is reporting the ledger correctly

`DashboardService` (`apps/api/src/organizations/dashboard.service.ts`) sums posted journal lines per account by
normal balance:
- **Income:** `REVENUE`, `OTHER_INCOME`.
- **Expenses:** `EXPENSE`, `COST_OF_SALES`, `OTHER_EXPENSE`.
- **Net profit:** income − expenses.

The arithmetic is right. The ledger itself holds a large **net credit on an expense account**, so the Profit & Loss
report shows the same distortion. This is not a dashboard-only bug.

Read-only query of the demo database (posted journals, 2026-10-01 to 2026-10-22):

| Account | Type | Source | Debit | Credit | Net |
|---|---|---|---:|---:|---:|
| 5190 Miscellaneous expense (`general_expense`) | EXPENSE | INVENTORY_ADJUSTMENT (9 journals) | 800.00 | 458,200.00 | **−457,400.00** |
| All other expense accounts and COGS | | various | | | +357,230.00 |
| **Total expenses** | | | | | **−100,170.00** |

The 9 inventory-adjustment journals:

| Date | Reference | Reason | Dr 1200 Inventory | Cr 5190 Misc expense |
|---|---|---|---:|---:|
| 2026-10-04 | DEMO-FY2026-00006 … 00012 (7 journals) | "Opening stock for the demo week" | 452,200.00 | 452,200.00 |
| 2026-10-11 | DEMO-FY2026-00014 | "Cycle count found extra tins" | 6,000.00 | 6,000.00 |
| 2026-10-10 | DEMO-FY2026-00013 | "Damaged in handling – write-down" | (Cr 800.00) | (Dr 800.00) |

## 3. Root causes

### RC1: product. Positive inventory adjustments default to an expense account

`InventoryService.postAdjustment` (`apps/api/src/inventory/inventory.service.ts`, ~L341–403) uses the
adjustment's `accountId` as the offset. If there is none, it falls back to the `general_expense` system account
(5190 Miscellaneous expense). It uses that same fallback **in both directions**:

- **Stock decrease** (shrinkage, damage): Dr expense, Cr inventory. This is a reasonable default.
- **Stock increase** (count gain, found stock, opening stock): Dr inventory, Cr **expense**. The gain is booked as
  negative expense. Gains then net silently against real costs, and a large gain drives total expenses below zero.

This happens for any tenant that posts a positive adjustment without choosing an offset account, so it is not
limited to demo data.

### RC2: data. Opening stock was entered as in-period adjustments

The demo seed (`apps/api/src/demo-week-seed.service.ts`, `seedOpeningStock`, ~L412) creates the opening inventory as
seven positive adjustments dated inside the reporting period, with no offset account. Opening stock is a
balance-sheet position:
- It belongs in **opening balances** against opening-balance equity (or retained earnings).
- It should not flow through profit and loss.

A real tenant who uses adjustments to load opening stock hits the same problem. That makes RC1's default more
dangerous.

### RC3: presentation. The breakdown hides negative accounts

`topExpenseGroups` drops accounts with a net credit (`item.amount > 0n`). As a result, the *Top expenses* breakdown
doesn't reconcile to the total, and the percentages degrade to 0.0%. This is secondary: once RC1 and RC2 are fixed,
an expense account with a net credit becomes a genuine exception that should be visible, not hidden.

## 4. Impact

- **Customer-facing financial figures are wrong:**
  - Expenses and net profit are misstated on the dashboard, the Profit & Loss report, and any report built on
    expense-account totals.
  - In the demo, net profit is overstated by KES 452,200, which is the opening stock.
- **Tax and statutory exposure:** an overstated profit (or misclassified gains) can flow into tax estimates and
  exported statements.
- **The balance sheet is unaffected:** inventory (1200) is correct; only the offset classification is wrong.
- **Scope in production:** unknown. Run the read-only query in §7 per tenant before deciding on corrections.

## 5. What must not happen

These follow from root `AGENTS.md` §5–6 and the accounting rules:

- **No silent rewrite or deletion of posted journals.** Corrections go through reversing or adjusting entries dated
  in an open period, with an audit trail.
- **No retroactive change to locked periods.**
- **No automatic reclassification of customers' existing entries.** Fixing the default only affects future
  postings. Past entries are corrected deliberately, per tenant, with the tenant's consent.

## 6. Proposed fixes (need sign-off)

| # | Change | Type | Decision needed |
|---|---|---|---|
| F1 | Positive adjustments without an explicit offset post to a dedicated income account, e.g. a new `inventory_gain` system account, *Inventory adjustment gains* (OTHER_INCOME). Decreases keep the expense default, or move to a dedicated *Inventory shrinkage / write-downs* expense account. | Code + chart-of-accounts migration (additive system accounts per organization) | Accountant: which accounts, and whether gains are other income or contra-COGS |
| F2 | Adjustment UI/API: require the offset account for positive adjustments, or default it per F1, and label the choice. Warn when an adjustment's reason looks like opening stock, and point to opening balances. | Code | Product |
| F3 | Opening stock goes through the existing opening-balances flow (`opening-balances.controller.ts`) against opening-balance equity, not adjustments. Fix the demo seed to do this. | Seed / data | None for demo data |
| F4 | Dashboard: keep negative accounts in the expense breakdown, or list them separately as "credits / reversals", so the breakdown always reconciles to the total. Never compute a percentage against a non-positive total. | Code | None |
| F5 | Existing tenants: a read-only detection report (§7). Where opening stock or gains sit in an expense account, the tenant's accountant posts an adjusting journal. No automatic correction. | Ops + support | Owner |

**Order:**
1. F3, demo data only. This is low risk and makes the demo honest.
2. F1 + F2, after accountant sign-off.
3. F4.
4. F5 per tenant.

**Tests to add:** ledger integration tests asserting the posting accounts for:
- a positive adjustment with no offset (F1);
- a negative adjustment;
- an adjustment with an explicit offset.

Plus a dashboard unit test confirming the breakdown reconciles to total expenses when one account is negative.
Before merge, Jenkins *Test (integration)* is mandatory for these changes.

## 7. Detection query (read-only)

```sql
BEGIN READ ONLY;
-- Expense-type accounts with a net credit from inventory adjustments, per organization and month.
SELECT o.id AS organization_id, a.code, a.name, to_char(j.journal_date, 'YYYY-MM') AS month,
       SUM(jl.debit_minor - jl.credit_minor) AS net_debit_minor, count(DISTINCT j.id) AS journals
FROM journal_lines jl
JOIN journals j ON j.id = jl.journal_id
JOIN ledger_accounts a ON a.id = jl.account_id
JOIN organizations o ON o.id = jl.organization_id
WHERE j.status::text = 'POSTED'
  AND j.source_type = 'INVENTORY_ADJUSTMENT'
  AND a.type::text IN ('EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE')
GROUP BY 1, 2, 3, 4
HAVING SUM(jl.debit_minor - jl.credit_minor) < 0
ORDER BY net_debit_minor;
ROLLBACK;
```
