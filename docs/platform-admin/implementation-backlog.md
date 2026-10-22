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
| 1.0 | Read-only production catalog verification (script and runbook): migration status, plan rows by status, Paystack codes on all 8 ACTIVE plans, subscriptions on retired plans | ⏸ | SQL check written ([runbook](runbooks/plan-catalog-verification.md)); owner will run it at release time, before deploying |
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
| O1 | Marketing comparison table disagreed with enforced entitlements. **Owner decision 2026-10-22: fix the copy, not the plans.** Done: every on/off row now reads `OFFICIAL_PLAN_CATALOG.features` or is marked as included on every plan; rows for features the product does not have (online payment collection, bank feed connections) are removed, and the homepage line "accept secure online payments" now reads "record customer payments as they arrive". | ✅ |
| O2 | Admin assign-plan could mint a paid subscription. **Owner decision 2026-10-22: trials and complimentary grants only.** Done: the endpoint accepts only TRIALING or ACTIVE + `complimentary: true`, the reason is now mandatory (≥10 chars), and it refuses to overwrite a provider-billed subscription. New `organization_subscriptions.complimentary` column keeps such grants out of MRR, ARR and active-paid counts; a verified payment clears the flag. | ✅ |
| O4 | **Authorization gap (found in 3.5, not changed):** `PATCH users/:id/status` (OPERATIONS) has no target restrictions. An operator can suspend or close their own account, a SUPERADMIN's account, or the **last active superadmin's** account, which locks everyone out of the console and bypasses the guard on `revokeAdmin`. **Recommendation:** refuse self-targeting, refuse when the target is the last active superadmin, and require SUPERADMIN to change the status of any account holding a platform grant. Needs an owner decision because it changes who may do what. | ⛔ needs owner |
| O5 | **Direct plan edits removed from the console UI (4.1).** The old Plans page let a superadmin edit a live plan's entitlements inline and set `isDefault`. Spec §10.3 requires versioned, previewed, approved changes; inline edits retroactively change what subscribers hold and silently break the DB == `OFFICIAL_PLAN_CATALOG` invariant from 1.3. `isDefault` has no consumers (trials follow `OFFICIAL_TRIAL`). The audited API endpoints are unchanged, so an emergency correction remains possible. **Owner to decide:** build the controlled change workflow (propose → preview → approve → publish), or accept catalog changes as migrations only. | ⛔ needs owner |
| O3 | Read-only production catalog check. **Owner decision 2026-10-22: run it once all phases are complete**, before the deploy. Runbook ready: `runbooks/plan-catalog-verification.md`. | ⏸ deferred to release |

## Phase 2 — Shared admin shell & design system (P1/P2)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 2.1 | Shell: spec §5 nav groups, active-group auto-expand, one collapse control, ValueBooks mark when collapsed, tooltips, contrast-safe hover | ✅ | `PlatformShell` uses the tenant `rb-app-shell` structure plus a light `rb-app-shell--platform` variant: sidebar logo, `CollapsedSidebarMark` (moved to `brand-logo.tsx`, shared with `AppShell`), `Dialog`/`DrawerContent` mobile drawer (replaces the hand-rolled focus trap), shared profile dropdown with Exit console / Sign out. The billing group opens on billing routes and stays open after the operator opens it. Screenshots checked at desktop, collapsed and 390px drawer |
| 2.2 | Shared platform session context (single `/platform/me` fetch) | ✅ | `PlatformSessionProvider` in `lib/platform.ts`; `usePlatformSession()` reads the shell's session and only fetches outside a provider |
| 2.3 | `PlatformPage` → shared `PageHeader` (meta / updated-at slot) | ✅ | `PlatformPage` now renders `PageHeader` plus an optional `meta` line; the old `.rb-platform__heading` CSS was removed |
| 2.4 | `StatusPill` → `StatusBadge`; `Pager` → shared DataTable pagination | ✅ | New `DataTablePagination` in `packages/ui` replaces `Pager` and the billing pages' inline pager; `StatusBadge` tone map gains platform statuses; every `rb-platform__pill` replaced; dead CSS removed. D11 mojibake fixed |
| 2.5 | `StatCard` variant: period, delta, drilldown, loading/error/no-data | ✅ | Borrowed from the customer dashboard: `dashboard-panels.tsx` (`DashboardKpi` with `delta` + `href`, `DashboardPanelHeading`, `ChartLegend`, `ChartLoading`) is now used by `dashboard.tsx` (unchanged rendering, verified by screenshot) and is ready for the 3.2 Overview; `.rb-dash-kpis--four` 4/2/1 grid |
| 2.6 | Remove the global `.rb-platform button` override | ✅ | Scoped to `:where(.rb-platform__page) button:not(.rb-button)` with the same specificity, so shared `Button`s and chrome are no longer restyled. Raw buttons on legacy pages keep their look until each page is rebuilt |
| 2.7 | `AdminActionDialog` pattern (impact, reason, typed confirmation) | ✅ | `admin-action-dialog.tsx` on shared `Dialog` and form fields. Adopted page by page in Phases 3–5; suspend/reactivate moves in 3.3 together with the Playwright spec |
| 2.8 | Skeleton/Empty/Error states on every page; shared filters; billing page titles | 🔄 | Done: plain "Loading…" text replaced with `CardSkeleton`/`DetailSkeleton` on every platform page; metadata titles on all 13 billing pages. Remaining: filter bars move to `DataTableToolbar` as each list is rebuilt (3.4, 3.5, 4.3, 5.x) |
| 2.9 | Document the variants in `DESIGN.md` and `/design-system` | ✅ | `DESIGN.md` → "Platform Admin variant" |

## Phase 3 — Overview dashboard, Organizations, Users (P1)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 3.1 | `metric-dictionary.md`; analytics endpoint: period, series, billing snapshot, attention items, `observedAt` | ✅ | [metric-dictionary.md](metric-dictionary.md). `analytics` gains `previousPeriod` (equal-length preceding window with `hasData`), `reporting.growth` (registrations + activations per bucket) and five more attention counts. The billing snapshot stays in `/platform/billing/overview`, preserving the documented "analytics reads no tenant money" boundary; the page calls both. Fixed: retention rate divided by ACTIVE organizations, which could exceed 100% |
| 3.2a | Overview header: period selector, last updated, refresh | ✅ | `PlatformPage` meta line: date range + "Updated HH:MM" |
| 3.2b | Four KPI cards with deltas and drilldowns | ✅ | Shared `DashboardKpi`; change badge only when the previous window has data; every tile links to its filtered list |
| 3.2c | Growth trend chart and organization-health panel | ✅ | Two-series area chart (registered vs finished setup) + clickable lifecycle distribution; "Limited data" note under 3 points |
| 3.2d | Billing snapshot row | ✅ | MRR/ARR per currency (never summed), active paid, trialing, conversion, past due, complimentary; methodology shown; fails independently of analytics |
| 3.2e | Requires attention, plan mix and platform health panels | 🔄 | Attention queue (6 sources, severity-toned, each linking to its records) and plan mix done. Platform health panel folded into the attention queue for now; revisit in 5.3 when per-queue scopes are fixed |
| 3.2f | Funnel, module adoption, countries, recent activity | ✅ | Kept and moved onto the shared panel primitives; audit event keys now render as readable names |
| 3.2g | Per-widget honest states; responsive 4/2/1 columns | ✅ | `Promise.allSettled` so a billing outage shows "unknown", never 0; per-panel skeleton/empty/error with retry; 4/2/1 KPI grid |
| 3.3 | Organization 360° detail tabs | ✅ | `platform-organization-detail.tsx`: seven tabs on shared `Tabs`/`DataTable`/`StatusBadge`; lifecycle and subscription shown as separate badges; suspension banner. Suspend/reactivate moved to `AdminActionDialog` (reason, slug typed back for suspend) and `e2e/phase12-platform.spec.ts` updated to match. Side feeds (billing, security, audit, failed jobs) keep loading, error-with-retry and empty apart; previously a failed feed read as "nothing recorded". API detail gains an uncapped active `memberCount` (the member list is capped at 100). Legacy raw-button rule now excludes tab triggers, icon buttons and the combobox clear via a selector-list `:not()` that keeps its (0,1,1) specificity |
| 3.4 | Organizations list: subscription-state and onboarding filters, last activity | ✅ | API: `subscriptionStatus` (six states + `NONE`) and `onboarding` (COMPLETE/INCOMPLETE) filters, both readable from the query string for drilldowns; plan and subscription filters are ANDed (they share a relation and previously would have overwritten each other); `lastActivityAt` on list and detail ([metric-dictionary.md](metric-dictionary.md)); list `memberCount` now counts active members, matching the detail. UI: shared `DataTableToolbar`/`DataTableSearch`/`DataTableFilters`/`Select` inside the table card, debounced search and country (a one-letter code is never sent), honest error state with retry, methodology footnote. The legacy `.rb-platform` label/input/select/textarea rules now skip shared primitives at unchanged specificity (this also fixes the billing list's search box) |
| 3.5 | Users list and detail: platform role vs memberships, sessions, status dialog | ✅ | List: shared toolbar, account-status and new `platformAccess` (ADMIN/NONE) filters, a platform-access column (`platformRole` in the contract), error state with retry. Detail: Account, Platform access (stated as separate from organization roles), memberships, live sessions (device hint, last seen, uncapped `activeSessionCount`), security events; Suspend/Close/Reactivate via `AdminActionDialog` (email typed back for suspend and close; an unverified account is never activated by hand). Shared `Panel` exported from the organization detail. Fix-forward from 3.3: the security and audit pages now honour `?organizationId=`/`?userId=` and show a "one organization/account only · Show all" note. Self/admin-target guard → ⛔ O4 |

## Phase 4 — Billing & Subscriptions consolidation (P1)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 4.1 | Plans & Pricing under Billing: 4×2 catalog table, entitlement matrix, separate Legacy section | ✅ | `/platform/billing/plans` (`/platform/plans` redirects; nav and overview links updated). Catalog: four tiers × monthly/yearly from the DB, each price checked against `OFFICIAL_PLAN_CATALOG` and showing its Paystack code state from `providers()`, plus subscriber counts linked to the filtered organization list. Matrix: all 27 catalog keys (labels now `OFFICIAL_ENTITLEMENT_LABELS` in contracts), with a red badge when the enforced value differs from the approved one and an amber badge when the yearly row differs from the monthly; drift logic in `lib/plan-catalog.ts` with 4 unit tests. Legacy section: non-official or inactive plans with their remaining subscribers. **The page is read-only:** the inline entitlement editor and "Make default" were removed from the UI (see O5) |
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
- **2026-10-22**: Phase 1 committed as `b2e7d4c` on `feat/platform-admin-commercial-correctness`.
  - **Checks run locally, all green:**
    - Typecheck: contracts, api, web.
    - ESLint on the touched files.
    - Integration specs: `plan-entitlements` 14/14, `billing-webhook-claim` 5/5, `platform-audit` 1/1, `plan-selection` 4/4, `platform-projections` + `platform-operations` + `platform-resolution` 6/6.
    - Unit tests: contracts 6/6; web `pricing-data` + `plan-picker` 6/6.
    - Migration drift (`prisma migrate diff --exit-code` against a shadow DB): no difference.
  - **Deferred to Jenkins:** full Lint/Typecheck/Test and **Test (integration)**, which is mandatory before merge because this touches billing.
  - **Formatting:** pre-existing Prettier drift remains in 4 billing/organization files that were already unformatted at HEAD; they were not reformatted, to avoid churn.
- **2026-10-22**: Phase 2 implemented; it borrows from the customer app (shell structure, drawer, profile menu, brand mark, dashboard KPI/panel primitives).
  - **Checks run locally, all green:** web + ui typecheck, ESLint on touched files, ui unit 8/8, web unit 27/27.
  - **Manual check:** Playwright screenshots of `/platform`, organizations and providers at desktop; the collapsed rail; the 390px drawer. A regression screenshot of the customer `/dashboard` is unchanged. No browser errors.
  - **Deferred to Jenkins:** full lint/typecheck/test. `e2e/phase12-platform.spec.ts` is not in Jenkins (6.1); its selectors ("Platform console" nav, Reason, Suspend organization) are unchanged.
- **2026-10-22**: Owner decisions O1–O3 actioned.
  - O1 (marketing copy) and O2 (assign-plan) implemented; O3 deferred to release by the owner.
  - New migration `20261022092000_subscription_complimentary_flag` (additive boolean, default false).
  - `OFFICIAL_PLAN_CATALOG` gains a `features` map, so the marketing table and the entitlement spec read the same source.
  - **Checks, all green:** contracts 7/7, web marketing 3/3, api + web + contracts typecheck, ESLint, integration 30/30 (`plan-entitlements`, `platform-audit`, `plan-selection`, `billing-webhook-claim`, `platform-authorization`), migration drift clean.
- **2026-10-22**: Separate accounting defect documented in `docs/ACCOUNTING_ISSUE_INVENTORY_ADJUSTMENTS_IN_PROFIT_AND_LOSS.md` (inventory gains and opening stock posted as negative expense). Not part of this project; awaiting accountant sign-off.
- **2026-10-22**: Phase 3 — overview dashboard (3.1, 3.2) implemented.
  - Organizations listing now reads filters from the query string, so overview drilldowns land pre-filtered (verified: `?status=SUSPENDED` returns the one suspended tenant).
  - **Checks:** api + web typecheck, ESLint, integration `platform-operations` 3/3 (new spec covers the period comparison, ordered growth buckets and attention counts, and re-asserts the no-money boundary), `platform-projections` 2/2. Browser pass over the rebuilt overview at desktop with no errors.
  - **Local dev database:** the three new migrations were applied with `prisma migrate deploy` (they had not been, which is why billing endpoints returned 500 locally).
- **2026-10-22**: Phase 3.3, the organization detail rebuild.
  - **Checks, all green:** web + api typecheck; ESLint on the touched files; web unit 27/27; integration `platform-projections` (new `memberCount` assertion), `platform-operations` 3/3 and `platform-audit` 1/1.
  - **Browser pass against the dev servers:** all seven tabs at 1440px plus the 390px overview; the full suspend → banner → reactivate flow on the demo tenant, using the spec's selectors. Tab triggers render transparent; no browser errors.
  - **Deferred:** `e2e/phase12-platform.spec.ts` itself was not run (it needs the isolated :3300 e2e stack and is not yet in Jenkins, see 6.1). Full lint, typecheck and test, plus **Test (integration)**, go to Jenkins.
- **2026-10-22**: Phase 3.4, the organizations list.
  - **Checks, all green:** contracts + api + web typecheck; ESLint on the touched files; web unit 27/27, contracts 7/7; integration `platform-operations` 4/4 (the new case derives expectations from the DB, proves the plan/state AND, rejects an unknown state with 400, and checks `lastActivityAt` and `memberCount`) and `platform-projections` 1/1.
  - **Browser pass:** filters, the `?onboarding=COMPLETE` deep link, search and country debounce at 1440px and 390px (no page overflow, no browser errors). Regression screenshots of billing subscriptions, users and feature flags after the legacy form-rule change.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus Test (integration).
- **2026-10-22**: Phase 3.5, users list and detail.
  - **Checks, all green:** contracts + api + web typecheck; ESLint on the touched files; integration `platform-operations` 5/5 (new case: platform access versus organization roles, exact live-session count ignoring expired sessions), `platform-projections` 1/1, `platform-audit` 1/1.
  - **Browser pass:** users list filters and search; a user detail with a suspend → reactivate round trip on a local demo account; the scoped security link and its "Show all"; organization detail panels after the shared `Panel` move; 390px with no overflow; no browser errors.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus **Test (integration)**, which is mandatory before merge because this touches authorization surfaces.
- **2026-10-22**: Phase 4.1, Plans & pricing.
  - **Checks, all green:** contracts + web typecheck; ESLint on the touched files; web unit 31/31 (new `plan-catalog.test.ts` 4/4).
  - **Browser pass:** the redirect from `/platform/plans`; the full catalog, matrix and legacy section at 1440px and 390px (no page overflow, no browser errors). Locally all eight Paystack codes read READY and the matrix shows no drift.
  - **Deferred to Jenkins:** full lint, typecheck and test. There is no API change in 4.1.
