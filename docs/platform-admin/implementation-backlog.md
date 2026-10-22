# Platform Admin redesign — implementation tracker

Live progress record for the Platform Admin redesign. Scope authority:
`VALUEBOOKS_PLATFORM_ADMIN_PRODUCT_REDESIGN_IMPLEMENTATION_MASTER.md` (v1.0, 21 Oct 2026) together with the root
`AGENTS.md`. Supporting audit: [current-state-audit.md](current-state-audit.md),
[plan-source-of-truth-audit.md](plan-source-of-truth-audit.md), [permissions-matrix.md](permissions-matrix.md).

Updated after every item: status, commit/PR, the focused checks actually run, and the checks deferred to Jenkins.

**Legend:** ⬜ todo · 🔄 in progress · ✅ done · ⛔ needs owner decision · ➖ descoped

## Owner decisions

| Date | Decision |
|---|---|
| 2026-10-22 | Professional `quotes.max` and `sales_orders.enabled` are **unlimited**, which also covers trials because they run on Professional. |
| 2026-10-22 | Workflow automation is **Advanced only**, gated on the existing `approval_workflows.enabled` entitlement. |
| 2026-10-22 | The Free/Growth/Scale screenshot came from **production**. A read-only verification (1.0) must run before any Phase 1 deploy. |
| 2026-10-22 | The tracker lives in this file. |
| 2026-10-22 | The dashboard in scope is the Platform Admin **Overview** (task 3.2), built after Phases 1–2. The customer-app dashboard is out of scope. |

## Phase 0 — Audit (P0)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 0.1 | Create `docs/platform-admin/` and this tracker | ✅ | — |
| 0.2 | `current-state-audit.md`: routes, services, components, defects D1–D11 | ✅ | [current-state-audit.md](current-state-audit.md) |
| 0.3 | `plan-source-of-truth-audit.md`: catalog, entitlements, Paystack mapping, consumers | ✅ | [plan-source-of-truth-audit.md](plan-source-of-truth-audit.md) |
| 0.4 | `permissions-matrix.md`: endpoint → minimum platform role, sensitive actions | ✅ | [permissions-matrix.md](permissions-matrix.md) |

## Phase 1 — Commercial correctness (P0/P1)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 1.0 | Read-only production catalog verification (script and runbook): migration status, plan rows by status, Paystack codes on all 8 ACTIVE plans, subscriptions on retired plans | 🔄 | SQL check written ([runbook](runbooks/plan-catalog-verification.md)); **awaiting an owner/ops run against production** |
| 1.1 | D1: migration making Professional quotes and sales orders unlimited, plus an entitlement-matrix integration test | ✅ | `20261022090000_correct_professional_unlimited_entitlements`; `test/plan-entitlements.int.test.ts` 11/11 locally (replays catalog migrations; all 8 plans + trial) |
| 1.2 | D2: gate workflows on `approval_workflows.enabled` (Advanced only) | ✅ | `workflows.service.ts`; key resolution covered by the matrix spec. Existing rules are untouched; only creation is gated |
| 1.3 | `OFFICIAL_PLAN_CATALOG` in `packages/contracts`; DB == constant test; marketing and plan picker derive from it; fix the "unlimited invoices" copy (D4) | ✅ | Constant + `OFFICIAL_TRIAL` in contracts; `plan-entitlements.int.test.ts` asserts DB prices, provider and limits equal it; `pricing-data.ts` derives prices, savings, most-popular and quantitative copy; the invoice row now shows 5/20/100/Unlimited, with a new "Quotes per month" row. `pricing-data.test.ts` 3/3. Qualitative marketing mismatches → ⛔ O1 |
| 1.4 | D5: contract schemas (subscription statuses, platform plan fields) | ✅ | `subscriptionStatusSchema` +TRIAL_EXPIRED/CANCEL_SCHEDULED; `platformPlanSchema` +tierKey/isMostPopular/provider fields; `billingProviderSchema` |
| 1.5 | D3: admin plan list exposes status; assign-plan rejects non-ACTIVE plans; trial length from the trial policy | ✅ | `listPlans` already returned status (UI fix in 4.1). `assignPlan` rejects RETIRED/DRAFT; an assigned trial is 336h. Spec cases in `plan-entitlements.int.test.ts`; `platform-audit.int.test.ts` passes. Paid status granted without payment → ⛔ O2 |
| 1.6 | D6: webhook rejects a missing raw body; atomic event claim | ✅ | Migration `20261022091000_billing_webhook_processing_claim` (additive: enum `PROCESSING` + `processing_started_at`); conditional-update claim with a 5-minute stale takeover; P2002 insert race handled; the controller fails closed without a raw body. `billing-webhook-claim.int.test.ts` 5/5 |
| 1.7 | D7: trial creation fails loudly when the Professional plan is missing | ✅ | Finalization logs an error (it still completes and does not block signup); Billing issues lists "Active organizations without a subscription". The console never auto-creates trials or charges |
| 1.8 | Explicit plan-state labels on organizations (no bare `—`) | ✅ | `describeOrganizationPlan` in contracts (6 unit tests); list badge plus `planStatus` projection; detail row; the plan filter is now a tier select (backend matches the tier or exact key) |
| 1.9 | Paystack plan-code coverage on the Providers page | ✅ | `providers()` measures all 8 official keys: READY / MISSING_CODE / DUPLICATE_CODE / WRONG_PROVIDER / MISSING_PLAN; rendered with the shared `DataTable` + `Badge` |

## Open items for owner review

| ID | Item | Status |
|---|---|---|
| O1 | The marketing comparison table makes qualitative claims that disagree with seeded entitlements. Examples: "Role-based permissions" ✓ on Professional, but `custom_roles.enabled` is Advanced only; "Budgets & cashflow forecasting" ✗ on Growth, but `cash_flow_reporting.enabled` is on; "Audit trail", "Transaction rules" and "Customer portal" map to no entitlement key. Owner decision needed: change the copy or the entitlements. | ⛔ |
| O2 | `POST /platform/organizations/:id/plan` (SUPERADMIN, audited) can set a paid plan ACTIVE without a verified payment. Spec §4.4 says not to mint paid subscriptions. Recommendation: restrict it to TRIALING / complimentary use with a mandatory reason, or route complimentary access through the existing approved entitlement overrides. | ⛔ |
| O3 | Run the read-only production check (1.0) before deploying Phase 1. If the 10-14 migrations are missing in production, this deploy will also apply the official catalog. | ⛔ |

## Phase 2 — Shared admin shell & design system (P1/P2)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 2.1 | Shell: spec §5 nav groups, active-group auto-expand, one collapse control, ValueBooks mark when collapsed, tooltips, contrast-safe hover | ⬜ | |
| 2.2 | Shared platform session context (single `/platform/me` fetch) | ⬜ | |
| 2.3 | `PlatformPage` → shared `PageHeader` (meta / updated-at slot) | ⬜ | |
| 2.4 | `StatusPill` → `StatusBadge`; `Pager` → shared DataTable pagination | ⬜ | |
| 2.5 | `StatCard` variant: period, delta, drilldown, loading/error/no-data | ⬜ | |
| 2.6 | Remove the global `.rb-platform button` override | ⬜ | |
| 2.7 | `AdminActionDialog` pattern (impact, reason, typed confirmation) | ⬜ | |
| 2.8 | Skeleton/Empty/Error states on every page; shared filters; billing page titles | ⬜ | |
| 2.9 | Document the variants in `DESIGN.md` and `/design-system` | ⬜ | |

## Phase 3 — Overview dashboard, Organizations, Users (P1)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 3.1 | `metric-dictionary.md`; analytics endpoint: period, series, billing snapshot, attention items, `observedAt` | ⬜ | |
| 3.2a | Overview header: period selector, last updated, refresh | ⬜ | |
| 3.2b | Four KPI cards with deltas and drilldowns | ⬜ | |
| 3.2c | Growth trend chart and organization-health panel | ⬜ | |
| 3.2d | Billing snapshot row | ⬜ | |
| 3.2e | Requires attention, plan mix and platform health panels | ⬜ | |
| 3.2f | Funnel, module adoption, countries, recent activity | ⬜ | |
| 3.2g | Per-widget honest states; responsive 4/2/1 columns | ⬜ | |
| 3.3 | Organization 360° detail tabs | ⬜ | |
| 3.4 | Organizations list: subscription-state and onboarding filters, last activity | ⬜ | |
| 3.5 | Users list and detail: platform role vs memberships, sessions, status dialog | ⬜ | |

## Phase 4 — Billing & Subscriptions consolidation (P1)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 4.1 | Plans & Pricing under Billing: 4×2 catalog table, entitlement matrix, separate Legacy section | ⬜ | |
| 4.2 | Controlled Paystack-code edit dialog (SUPERADMIN, reason, audit) | ⬜ | |
| 4.3 | Billing pages on shared primitives; overview drilldowns | ⬜ | |
| 4.4 | Trial, refund, override and webhook-retry actions in dialogs | ⬜ | |
| 4.5 | Billing integration tests: webhook signature and idempotency, renewal amount, trial read-only | ⬜ | |

## Phase 5 — Configuration, Jobs, Security, Audit (P1/P2)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 5.1 | Feature flags: list, detail drawer, simulator, typed pickers; D11 | ⬜ | |
| 5.2 | Country packs: version detail; lifecycle vs identifier; dialogs | ⬜ | |
| 5.3 | Jobs: per-queue scope labels (D10), failure detail | ⬜ | |
| 5.4 | Security events: readable names, detail drawer, "Platform-wide" | ⬜ | |
| 5.5 | Audit log: filters, readable actions, before/after diff | ⬜ | |
| 5.6 | D9: audit FK `Restrict` and append-only trigger | ⬜ | |
| 5.7 | Support Operations | ➖ | Only if justified later |

## Phase 6 — Hardening & release (gate)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 6.1 | Platform Playwright spec in Jenkins (or documented deferral) | ⬜ | |
| 6.2 | QA plan, release checklist, runbooks | ⬜ | |
| 6.3 | Staging UAT with synthetic fixtures (spec §22.4) | ⬜ | |

## Progress log

- **2026-10-22**: Phase 0 audit completed (three parallel code inspections). The plan was approved and the tracker created.
- **2026-10-22**: Phase 1 implemented (uncommitted, branch `feat/brand-and-plan-picker`).
  - **Checks run locally, all green:**
    - Typecheck: contracts, api, web.
    - ESLint on the touched files.
    - Integration specs: `plan-entitlements` 14/14, `billing-webhook-claim` 5/5, `platform-audit` 1/1, `plan-selection` 4/4, `platform-projections` + `platform-operations` + `platform-resolution` 6/6.
    - Unit tests: contracts 6/6; web `pricing-data` + `plan-picker` 6/6.
    - Migration drift (`prisma migrate diff --exit-code` against a shadow DB): no difference.
  - **Deferred to Jenkins:** full Lint/Typecheck/Test and **Test (integration)**, which is mandatory before merge because this touches billing.
  - **Formatting:** pre-existing Prettier drift remains in 4 billing/organization files that were already unformatted at HEAD; they were not reformatted, to avoid churn.
