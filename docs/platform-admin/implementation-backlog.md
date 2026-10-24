# Platform Admin redesign — implementation tracker

Live progress record for the Platform Admin redesign. Scope authority:
`VALUEBOOKS_PLATFORM_ADMIN_PRODUCT_REDESIGN_IMPLEMENTATION_MASTER.md` (v1.0, 21 Oct 2026) together with the root
`AGENTS.md`. Supporting audit: [current-state-audit.md](current-state-audit.md),
[plan-source-of-truth-audit.md](plan-source-of-truth-audit.md), [permissions-matrix.md](permissions-matrix.md).

Updated after every item: status, commit/PR, the focused checks actually run, and the checks deferred to Jenkins.

**Legend:** ⬜ todo · 🔄 in progress · ✅ done · ⛔ needs owner decision · ➖ descoped

## Still open (as of 24 Oct 2026, production read-only checks)

### 23 Oct 2026 — A/B production read-only check handoff

- **A (1.0/O3) — blocked, not run.** The operator with production database access must run the exact
  `BEGIN READ ONLY; ... ROLLBACK;` block in
  [plan-catalog-verification.md](runbooks/plan-catalog-verification.md) against the production database
  before deployment. Record the execution date and operator, migration rows, plan/status and subscriber
  counts, all eight active-plan code/price mismatches (or an empty mismatch result), subscriptions on
  retired plans, organizations without subscriptions, and Professional entitlement rows. Omit organization
  identifiers. A nonempty mismatch or retired-plan result requires review under the runbook; no production
  catalog change is authorized by this handoff.
- **B (O8) — blocked, not run.** The same operator must run the query in
  [recurring-claim-reconciliation.md](runbooks/recurring-claim-reconciliation.md) against production in a
  read-only transaction, ending with `ROLLBACK;`. Record the date, operator, and count of legacy
  template-only claims by operation in the release record. Keep any tenant, claim, and document IDs in
  restricted operational evidence, not this tracker. For each hit, follow the runbook's execution, audit,
  document, and invoice-email checks; leave uncertain claims failed for manual review. No deletion,
  document recreation, or row-level correction is authorized.
- **Access path established 24 Oct 2026:** the repository deploy script identified the production
  host; the local ValueBooks SSH key matched a saved host key. Non-interactive SSH succeeded, and
  `/srv/valuebooks/prod` and the `valuebooks-postgres` container were present. The target database
  and non-superuser `valuebooks_app` role were confirmed in a read-only transaction. There is no
  dedicated read-only login; the A/B transactions below enforce read-only at the PostgreSQL level.
- **24 Oct 2026 A executed; verification failed on missing provider codes.** Via the local ValueBooks
  SSH key, connected to the production `valuebooks-postgres` container as non-superuser
  `valuebooks_app` on database `valuebooks`. The exact SQL block from
  [plan-catalog-verification.md](runbooks/plan-catalog-verification.md) ran with `psql -X -v
  ON_ERROR_STOP=1` inside `BEGIN READ ONLY; ... ROLLBACK;` (exit 0). All four queried catalog
  migrations are applied. There are eight ACTIVE Paystack plans with the expected eight prices,
  plus three RETIRED placeholder plans; all eleven have zero subscribers. **All eight active
  `provider_price_id` values are NULL**, so the expected-code mismatch query returned eight rows
  and checkout remains blocked for those plans. The subscription-by-plan query returned zero rows,
  including none on retired plans. One organization has no subscription row and needs investigation
  before the uncapped fallback is removed. Both Professional `quotes.max` and
  `sales_orders.enabled` are disabled on monthly and yearly rows, as expected before the fix.
  No production change or Paystack call was made. Missing codes must be resolved through the
  controlled, audited path and verified before live checkout; the no-subscription organization
  also needs an owner-reviewed disposition before the relevant release step.
- **24 Oct 2026 B passed the read-only legacy-claim inventory.** On the same production database
  and role, a count grouped by operation using the exact operation/resource-type predicate from
  [recurring-claim-reconciliation.md](runbooks/recurring-claim-reconciliation.md) ran inside
  `BEGIN READ ONLY; ... ROLLBACK;` with `psql -X -v ON_ERROR_STOP=1` (exit 0). It returned zero
  groups: **zero template-only legacy claims** across recurring invoices, bills and expenses.
  There are no matching rows requiring per-occurrence document or email reconciliation. No
  correction or retry was attempted. Jenkins accounting integration checks remain mandatory.
- **24 Oct 2026 A follow-up — investigated, unresolved.** A further production read-only
  transaction selected only non-identifying facts for the sole organization without a
  subscription: it is ACTIVE, onboarding COMPLETE, created 21 Oct before the 22 Oct catalog
  migration, has one member, and has zero invoices, journals and billing transactions. This
  suggests a pre-catalog onboarding gap but does not prove which subscription or trial dates
  should be assigned. No subscription was created or backdated. `printenv
  BILLING_LIVE_CHECKOUT_ENABLED` in the production API container returned exit 1 with no value;
  under the current checkout guard, unset means live checkout is disabled. The deployed
  controlled plan-code action verifies each code by calling Paystack with the production key.
  The standing instruction forbids using that live key, so the eight codes cannot be verified
  and saved through that path in this session. Copying the expected strings directly into
  production would bypass provider verification and the platform audit; it was not done.
  **Next blockers:** an approved provider-verification path that honors the no-live-key rule,
  and an owner decision on the subscriptionless organization's intended plan and effective
  dates. No production write, Paystack request, or charge occurred.
- **24 Oct 2026 owner direction and execution dependency:** the owner will check all eight codes
  in the Paystack dashboard and share each plan's amount, currency and interval. The owner chose
  a **fresh Professional trial now** for the one active organization without a subscription.
  No code has been set and no trial has been started yet. The existing SUPERADMIN
  `POST /platform/organizations/:organizationId/plan` action creates a TRIALING subscription
  and platform audit entry without a provider charge, but an authenticated SUPERADMIN session
  is needed to invoke it as the actual operator. Direct SQL would bypass that actor audit and
  the ordinary customer-facing flow; no such write was made. The dashboard verification
  results and the authenticated action remain the concrete dependencies.
- **24 Oct 2026 authenticated console inspection:** signed in to the production console as
  `hello@lyomu.com` (SUPERADMIN). The sole organization appears ACTIVE with no plan or billing
  subscription; the Subscriptions page has zero records. The deployed organization detail and
  subscriptions UI expose no Assign plan control. The audited SUPERADMIN assignment exists as
  `POST /platform/organizations/:organizationId/plan` in the API, but no browser form invokes it.
  The earlier description of a console **Assign plan action** was inaccurate. Under the owner's
  computer-use-only direction for this step, no API request or direct SQL write was made; the
  Professional trial is **not started**. The supplied Paystack dashboard screenshot visibly shows
  seven active plans with prices and intervals matching the runbook; Starter monthly is outside
  its crop. The codes need character-accurate confirmation before any production assignment.
  The screenshot is not a substitute for the controlled action's live provider verification, and
  no provider code was saved.
- **24 Oct 2026 trial control implemented locally, not deployed.** The organization detail's
  Subscription tab now offers **Start 14-day Professional trial** only to SUPERADMIN for an
  ACTIVE, fully onboarded organization with no subscription. It checks for the active
  Professional monthly plan, then uses the shared `AdminActionDialog` (reason and typed slug)
  and the existing audited `POST /platform/organizations/:organizationId/plan` endpoint.
  `PlatformTenantsService.assignPlan` now schedules the normal reminder, expiry and maintenance
  jobs when that action creates a first TRIALING subscription, in the same transaction as the
  subscription and audit event. The action makes no Paystack call or charge.
  **Focused checks observed:** API and web `npx tsc --noEmit --pretty false` exited 0;
  targeted ESLint on the three touched source/spec files exited 0; the new
  `plan-entitlements.int.test.ts` case passed 1/1 against the local test database with dummy
  Paystack keys. The first full-file integration attempt passed 17/18 but the new test failed
  on a duplicate fixture email; the fixture helper was made idempotent before the focused
  rerun. An earlier invocation was stopped before test results when the root environment was
  seen loading without the dummy key override; no provider request was made. `git diff --check`
  passed for the touched code. **Not run:** browser verification of the new control, Jenkins
  `Test (integration)` and the full pipeline. No commit, merge, deployment, production trial,
  provider-code update or charge occurred. The approved trial can be created in the console
  only after review, owner-authorized commit/deploy and required Jenkins gates.
- **24 Oct 2026 pre-commit review — release findings, no code fix yet.** Reviewed the new trial
  path, catalog-tier migration, price-increase publication, renewal validation and relevant
  tests. (1) `20261023100000_plan_tiers` backfills every historical tier as ACTIVE, including
  `free` and `scale`, whose only plans are RETIRED in production. The catalog health invariant
  will therefore report missing monthly/yearly active plans for both tiers after deploy.
  (2) Price publication checks notified subscribers before calling Paystack, then sends
  `update_existing_subscriptions: true` when any subscriber was present. A new subscriber
  joining between those steps can be repriced without 30 days' notice; the existing latecomer
  test covers a join *before* the check, not this race. A zero-subscriber publication instead
  uses `false`; a subscriber joining in that window can retain the old provider amount while
  ValueBooks stores the new catalog price, causing renewal verification to refuse the charge.
  (3) The new trial button is shown only for no subscription, but the server uses an upsert:
  another session can create a subscription after the page read, and the stale confirmation
  would replace it and reset trial dates. Lifecycle jobs are scheduled only when no prior
  subscription was read. These need correction and focused regression coverage before commit.
  Also observed a low-priority `git diff --check` failure: a blank line at EOF in
  `apps/api/src/billing/billing-provider.ts`. No production query, write, charge, commit or
  deployment was made during this review; Jenkins gates remain not run.
- **24 Oct 2026 review-fix progress — in progress, not release-ready.** The tier migration now
  backfills a tier as ACTIVE only when it has an ACTIVE historical plan; retired-only `free` and
  `scale` remain RETIRED. The first-trial API now accepts `requireNoSubscription`, locks the
  organization row for that path, rejects an existing subscription, and creates rather than
  upserts; the console sends that condition. Added a regression assertion that a stale first-trial
  request preserves the existing subscription and audit log. Removed the blank line at EOF in
  `billing-provider.ts`. **Passed:** API and web `npx tsc --noEmit --pretty false`; `git diff --check`
  (exit 0, with line-ending warnings). **Failed/environmental:** focused Vitest integration
  command `npx vitest run --config vitest.integration.config.ts test/plan-entitlements.int.test.ts
  -t 'first subscription|stale first-trial'` stopped with `ERR_IPC_CHANNEL_CLOSED` before any test
  result; focused ESLint stopped with a Node zone-allocation out-of-memory error. Both were run
  locally with dummy Paystack keys where applicable; neither result is a pass. **Not run:** the
  changed tier migration against a fresh integration database, Jenkins `Test (integration)` and
  full pipeline. Owner approved a stricter temporary price-increase pause because a zero-subscriber
  count still permits an in-flight checkout. `PlanPricingService` now refuses all increases and
  increase notices before any Paystack request or email. The console disables increase publication
  and hides the notice action; reductions remain publishable. Existing notice-rule tests remain
  available behind a test-only method spy, and new assertions cover the live pause with and without
  subscribers. The preview reports `publishable: false` during the pause. **Passed after the final
  fixes:** API and web `npx tsc --noEmit --pretty false` (exit 0); targeted ESLint on the changed
  pricing service, pricing integration spec and plan-catalog console (exit 0); the earlier targeted
  ESLint pass covered the trial API, DTO, trial spec and organization console (exit 0); `git diff
  --check` (exit 0). **Further local
  blockers:** a one-time Vitest retry with `--pool=threads` and 2048 MB heap could not connect to
  local PostgreSQL at `127.0.0.1:5433` (`ECONNREFUSED`); no test result. Targeted ESLint with a
  larger heap found one assertion-type error in the new test; it was corrected and both typecheck
  and focused lint subsequently passed. **Not run:** these integration cases to completion, the tier migration on a fresh DB,
  Jenkins `Test (integration)` and its full pipeline. No production action occurred.
- **K/Jenkins — blocked before run.** Reviewed work was committed locally as `de4fd91` on 24 Oct 2026.
  `origin/feat/platform-admin-commercial-correctness` still resolves to `6c0449f`, so Jenkins cannot
  check out the reviewed commit until the branch is pushed. Once it is available remotely, observe the
  pipeline for that exact commit, including **Test (integration)** and every required gate, before
  requesting merge authorization. Merge, deployment, and post-deployment C remain not run.
- **K/Jenkins build #2 — failed, CI configuration corrected, rerun pending.** Jenkins built the
  pushed commercial-correctness commit and passed Checkout, Build CI images, Lint, Typecheck and
  Test. **Test (integration) failed before any integration spec ran:** PostgreSQL was healthy in
  its container, but `prisma migrate diff` returned `P1001` because the generated service hostname
  for this long branch exceeded Docker DNS's 63-character label limit. `Jenkinsfile` now assigns
  short aliases (`ci-postgres`, `ci-redis`, `ci-s3`, `ci-clamav`, `ci-mailpit`) in the isolated CI
  network and makes every cross-container URL use those aliases. The correction is unverified until
  the follow-up commit is pushed and its exact Jenkins build completes. Docker Build, image smoke,
  Docker Push, approval, deployment and post-deployment C were skipped/not run.

E–I and O12 were **executed and verified** on 23 Oct 2026 (see the progress-log entries below for exact commands,
pass counts and fixes). Production checks A and B ran on 24 Oct: B found no legacy claims, while A found all
eight active Paystack codes missing and one organization without a subscription. C remains post-deployment,
and the location of the Paystack test-mode keys remains open. Jenkins **Test (integration)** and the full
pipeline remain mandatory before merge and have not been run.

How to pick the remaining work up, item by item, with the build order and the known local traps:
[next-session-brief.md](next-session-brief.md).

### Production and owner dependencies

| # | What | Why it cannot be done here | Blocks |
|---|---|---|---|
| A | **Read-only production catalog check** (rows 1.0 / O3) | Ran 24 Oct. Eight active provider codes NULL; one organization without a subscription. See observed results above. | Resolve missing codes and uncapped fallback before applicable release steps |
| B | **Production legacy recurring-claim check** (O8) | Ran 24 Oct; zero legacy template-only claims. See observed results above. | Jenkins accounting gates still required |
| C | **Production dropped-renewals report run** (O6) — lists renewals never applied; correcting any row needs the owner's per-row approval | Not run; scheduled after deployment. [Runbook](runbooks/dropped-renewals-report.md) | Post-deploy |
| D | **Where the Paystack test-mode keys live** — the root configuration is live mode (confirmed 23 Oct 2026) and was deliberately not used | A live key cannot be used for testing, and no test key is available here | UAT F5, F8, F9, F10, F11; confirming an increase actually charges an existing mandate |

The owner approved the Next.js security upgrade on 23 Oct 2026. Next.js and its ESLint plugin are now pinned to
16.4.3, above the 16.4.1 patched floor for the reported image-optimization vulnerability. The web typecheck,
repository lint and standalone production build passed; the former security abort did not recur.

### Engineering work remaining

| # | What | Status |
|---|---|---|
| E | **Phase 7 §4.1 — new tiers.** A durable tier record to replace the compiled baseline, and a create/retire workflow, including how a newly created tier appears in the console and on the public pricing page | ✅ **Verified 23 Oct 2026.** Migration applied cleanly (drift check clean); `createTier`/`activateTier`/`retireTier` exercised by `platform-plan-pricing.int.test.ts` and the console flow in `platform-uat-accessibility.spec.ts` (mobile/tablet/desktop "Create tier" dialog). Public pricing verified live in `platform-marketing-prices.spec.ts` 6/6 across viewports. |
| F | **Phase 7 §4.2 — catalog governance.** The published-catalog invariant that replaces `OFFICIAL_PLAN_CATALOG` as the source of truth | ✅ **Verified 23 Oct 2026.** `catalog-health.service.ts` invariants exercised by `plan-entitlements.int.test.ts` (17/17), `platform-plan-code.int.test.ts` (6/6) and `platform-audit.int.test.ts` (1/1, after a fix — see below). Catalog health panel confirmed rendering in the browser (keyboard-nav spec reads its table). Launch entitlement drift is asserted separately from price in `plan-entitlements.int.test.ts`. |
| G | **Phase 7 §4.3 — entitlement versioning.** The plan's own "expensive part": an entitlement set that can change without rewriting what existing subscribers were sold | ✅ **Verified 23 Oct 2026.** `plan-entitlement-versions.int.test.ts` 1/1 proves: publishing a new version pins the existing subscriber; the enforced limit does not move immediately; a verified renewal (`billing-renewals.int.test.ts`, "keeps a pinned sold limit until a verified renewal starts the new period") clears the pin; the subscriber then resolves to the current published projection. |
| H | **Phase 7 browser pass.** The console price-change and new notice flow (§4.5), and the two marketing pages now reading live prices (§4.8), have never been exercised in a browser | ✅ **Verified 23 Oct 2026.** `platform-plan-notice.spec.ts` 1/1 (desktop): propose → send notice → publication refused inside 30 days → `billing_notices.queued_at` aged in the isolated DB → publication succeeds and reprices via the stub. `platform-marketing-prices.spec.ts` 6/6 across desktop/tablet/mobile. |
| I | **6.3 / O9 — remaining UAT fixtures.** F1, F2, F12, F13, F14, F15, F16 in a browser, plus the 1440/1024/390 viewport sweep and keyboard-only navigation | ✅ **Verified 23 Oct 2026.** F1/F2/F12/F16 — `platform-uat-remaining.spec.ts` 4/4 (desktop). F15 — `platform-uat-email.spec.ts` 1/1 (desktop, dedicated invalid-SMTP worker). F13/F14 — covered by the existing `phase12-platform.spec.ts` (suspend/reactivate; country-pack "Fallback" read), re-run 4/4 as a baseline check, not duplicated. Viewport sweep and keyboard-only navigation — `platform-uat-accessibility.spec.ts` 18/18 across desktop/tablet/mobile. F3/F4/F6/F7 re-verified 4/4 (`platform-uat-nonpayment.spec.ts`), consistent with the previously recorded result. |
| J | **O12 — SUPPORT operators could not open the billing overview.** `platform-billing-overview.tsx` fetched `billing/overview` (SUPPORT) and `billing/revenue` (OPERATIONS) as one failure unit. | ✅ **Fixed and verified 23 Oct 2026 after owner approval.** The reads settle independently. A revenue 403 keeps the SUPPORT overview visible and replaces verified collections with higher-role copy; a genuine failure still uses `ErrorState`, and a successful empty response still says “No verified payments yet.” No API role floor changed. Focused unit 3/3, web typecheck and targeted ESLint passed. |
| K | **Jenkins `Test (integration)` and the full lint/typecheck/test suites.** Mandatory before merge: this branch touches billing, authorization and accounting | Local full lint and typecheck passed 23 Oct 2026. The initial full workspace unit run exposed a Windows PDF font URL bug and an API app-setup hook timeout; the PDF bug was fixed, both focused specs passed, and the full API unit suite then passed 231/231. Other workspace unit suites passed in the initial run. Jenkins `Test (integration)` and its full pipeline remain unrun and mandatory before merge; the current uncommitted worktree cannot be verified by Jenkins as-is. |
| L | **6.1 — the platform Playwright spec is still not in Jenkins.** A documented deferral: the CI box is over capacity | Revisit when there is CI headroom or a staging target. Not added in this pass, per instruction. |

**Not in scope:** 5.7 Support Operations (➖, only if justified later), and the separate accounting defect in
`docs/ACCOUNTING_ISSUE_INVENTORY_ADJUSTMENTS_IN_PROFIT_AND_LOSS.md`, which awaits accountant sign-off.

## Owner decisions

| Date | Decision |
|---|---|
| 2026-10-22 | Professional `quotes.max` and `sales_orders.enabled` are **unlimited**, which also covers trials because they run on Professional. |
| 2026-10-22 | Workflow automation is **Advanced only**, gated on the existing `approval_workflows.enabled` entitlement. |
| 2026-10-22 | The Free/Growth/Scale screenshot came from **production**. A read-only verification (1.0) must run before any Phase 1 deploy. |
| 2026-10-22 | The tracker lives in this file. |
| 2026-10-22 | The dashboard in scope is the Platform Admin **Overview** (task 3.2), built after Phases 1–2. The customer-app dashboard is out of scope. |
| 2026-10-23 | 6.3: **build the UAT fixture seeder now** (option B), restricted to local and staging, through the existing services and the approved plans. **Staging and the staging UAT run stay explicit release requirements** and 6.3 is not marked passed. |
| 2026-10-23 | Action **O4** (self/console-account status guard), **O10** (webhook retry audit) and **O11** (suspension policy). O7 and O8 stay open. |
| 2026-10-23 | **[suspension-policy.md](suspension-policy.md) ratified.** Grounds G1–G5 are standing authority; Operations act on G3–G5 without a per-case owner decision, G1 and G2 stay the owner's. |
| 2026-10-23 | **O7: country-pack publishing needs no second approver.** `DRAFT → PUBLISHED → DEPRECATED` stays; spec §12.2's review states are an accepted deviation. |
| 2026-10-23 | **O5: build admin-editable pricing** (full catalog and new tiers; reprice existing subscribers at next renewal; single superadmin publishes; the console calls Paystack). Its own phase — [plan-catalog-management-plan.md](plan-catalog-management-plan.md). |
| 2026-10-23 | **O8: make retry complete a failed recurring posting safely**, with no duplicate financial document. The existing occurrence claim must be reconciled with any document already created before it can be released or reused. |
| 2026-10-23 | **O5 customer notice: 30 days by email** before a price increase affects existing subscribers. Publication must enforce the notice condition; no real price change may bypass it. |
| 2026-10-23 | **O9: skip staging deployment and run the documented local UAT drill** with synthetic tenants as the release check (owner decision). Record the scenarios actually exercised; do not mark UAT passed on fixture seeding alone. |
| 2026-10-23 | **§4.3 entitlement changes reach existing subscribers at their next renewal**, matching the O5 pricing decision. Existing subscribers are pinned at publication. |

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
| 1.0 | Read-only production catalog verification (script and runbook): migration status, plan rows by status, Paystack codes on all 8 ACTIVE plans, subscriptions on retired plans | ⛔ findings require resolution | Ran 24 Oct in a read-only transaction: all four migrations applied; eight active plan codes NULL; no subscriptions on retired plans; one organization has no subscription. See the A result above and [runbook](runbooks/plan-catalog-verification.md). |
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
| O4 | **Authorization gap (found in 3.5).** `PATCH users/:id/status` (OPERATIONS) had no target restrictions. **Owner decision 2026-10-23: fix it.** Done: the endpoint refuses the acting administrator's own account, and refuses any account holding an active platform grant unless the actor is SUPERADMIN; the console shows the reason instead of the buttons. A standalone "last active superadmin" count was deliberately not added — with self-targeting refused and grant holders superadmin-only, the only actor who can reach a superadmin target is an active superadmin, so it could never fire. `platform-operations` 6/6 (new case: self refused 400, OPERATIONS → superadmin refused 403 with no audit row, SUPERADMIN → superadmin allowed, ordinary tenant account unaffected). | ✅ |
| O5 | **Direct plan edits removed from the console UI (4.1).** **Owner decision 2026-10-23: build the controlled change workflow — administrators must be able to change pricing from the dashboard without engineering.** Scope decided with it: the **full catalog including new tiers**; existing subscribers **repriced at their next renewal**; a **single superadmin** publishes; and **the console calls Paystack**. Phase 7, tracked in [plan-catalog-management-plan.md](plan-catalog-management-plan.md). The price-change backend and console flow are built. The homepage teaser and pricing page now read live prices for the four authored tiers, with a five-minute cache and compiled-price fallback; browser verification remains. The durable 30-day email notice (§4.7) was built, but **owner decision 2026-10-24 temporarily pauses every price increase and increase notice**, including plans with zero current subscribers: an in-flight checkout can cross the Paystack update and cause an unnotified increase or a renewal amount mismatch. Reductions remain publishable. The notice ledger and its focused rule coverage remain for a coordinated publication design. | 🔄 increase publication blocked pending redesign |
| O6 | **D12, renewal payments not applied (billing, P1).** **Owner decision 2026-10-22: fix it, and report past drops without backfilling.** Done: paid `invoice.update` is handled by subscription code; a renewal `charge.success` is matched by customer + plan code and refused when more than one subscription fits; amount and currency are checked as before, and one transaction is recorded per charge reference. The read-only [dropped-renewals report](runbooks/dropped-renewals-report.md) lists past drops; correcting any of them needs the owner's approval per row. **The production run of the report is the owner's** (no production access here). | ✅ (report run pending in production) |
| O7 | **Country pack review states (found in 5.2, not built).** Spec §12.2 describes `DRAFT → IN_REVIEW → APPROVED → PUBLISHED → DEPRECATED`. **Owner decision 2026-10-23: no second approver is needed.** The domain keeps `DRAFT → PUBLISHED → DEPRECATED`; no migration and no review states will be built. The controls that exist stand: publishing requires a reason, the pack identifier typed back and an impact statement, and is recorded in the append-only platform audit log. Spec §12.2 is a documented, accepted deviation. | ✅ decided, no work |
| O8 | **Retrying a recurring posting can create nothing (found in 5.3).** **Owner decision 2026-10-23: make retry complete safely without duplicating a financial document.** New invoice, bill and expense claims now link to their draft atomically; retries resume that document after issue/post failures. Journals use the posting rule's atomic idempotency key. Focused real-database tests pass. The read-only production [legacy claim check](runbooks/recurring-claim-reconciliation.md) ran 24 Oct and found zero matching claims. Full Jenkins accounting checks remain mandatory. | 🔄 code and production inventory complete; Jenkins pending |
| O9 | **No staging environment for UAT (6.3).** **Owner decision 2026-10-23: skip staging deployment and run the documented local UAT drill** with synthetic tenants instead. **Verified 23 Oct 2026:** F1, F2, F3, F4, F6, F7, F12, F16 all pass in a browser against isolated `valuebooks_e2e`, plus the 1440/1024/390 viewport sweep and keyboard-only navigation (18/18). F15 passes with a dedicated invalid-SMTP worker. **Owner decision 2026-10-23: skip the Paystack payment scenarios for now and record them as untested.** F5, F8–F11 remain untested (Paystack test-mode key location unknown). See [uat-plan.md §4a](uat-plan.md). | ✅ F1/F2/F3/F4/F6/F7/F12/F15/F16, viewport sweep and keyboard nav all verified; F5/F8–F11 remain untested by owner decision |
| O10 | **Webhook retry audit (found in 6.2).** **Owner decision 2026-10-23: fix it.** Done: `retryWebhook` audits every attempt with the event's state, `lastError` and `retryCount` read back afterwards, then rethrows a failure; it returns `{ processed, state }`, and the console reports that another delivery may hold the claim instead of claiming a recovery. `billing-webhook-claim` 6/6 (new case: a failed retry audits FAILED and still throws; a stood-down retry audits FAILED and reports `processed: false`; a working retry audits PROCESSED). | ✅ |
| O11 | **No written tenant-suspension policy.** **Owner decision 2026-10-23: write it; ratified the same day.** Done: [suspension-policy.md](suspension-policy.md) — what suspension is and is not (not collections, not deletion, not support convenience; Paystack keeps charging), five grounds G1–G5 with who may authorise each and what notice is owed, what is explicitly not a ground, the record to write in the mandatory reason, reactivation authority, and a 30-day owner review. G1 and G2 are the owner's alone; Operations may act on G3–G5 without a per-case owner decision. The suspension runbook follows it. Note: the console enforces only role ≥ OPERATIONS, a reason and a typed confirmation — the authority split and the 30-day review are procedural, evidenced by the audit log, not enforced in code. | ✅ |
| O12 | **SUPPORT operators could not open the billing overview (found 23 Oct 2026 while listing open work).** `platform-billing-overview.tsx` loaded `billing/overview` (SUPPORT floor) and `billing/revenue` (OPERATIONS floor) as one failure unit, so the expected revenue 403 failed the whole page. | ✅ Owner approved and fixed 23 Oct 2026. Independent settlement preserves the SUPPORT overview without exposing revenue collections or changing either API role floor; refusal, failure and a true zero have distinct UI states. Focused unit 3/3, web typecheck and targeted ESLint passed. |
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
| 2.8 | Skeleton/Empty/Error states on every page; shared filters; billing page titles | ✅ | `CardSkeleton`/`DetailSkeleton` on every platform page and metadata titles on all 13 billing pages (earlier). Closed 2026-10-23: every platform list that has filters is now on `DataTableToolbar` (organizations, users, billing, feature flags, country packs, jobs, security, audit). The remaining raw `<select>`s are a create form and the overview period selector, neither of which is a table filter, and the dead `.rb-platform__filters` / `.rb-platform__inline-form` rules were removed. |
| 2.9 | Document the variants in `DESIGN.md` and `/design-system` | ✅ | `DESIGN.md` → "Platform Admin variant" |

## Phase 3 — Overview dashboard, Organizations, Users (P1)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 3.1 | `metric-dictionary.md`; analytics endpoint: period, series, billing snapshot, attention items, `observedAt` | ✅ | [metric-dictionary.md](metric-dictionary.md). `analytics` gains `previousPeriod` (equal-length preceding window with `hasData`), `reporting.growth` (registrations + activations per bucket) and five more attention counts. The billing snapshot stays in `/platform/billing/overview`, preserving the documented "analytics reads no tenant money" boundary; the page calls both. Fixed: retention rate divided by ACTIVE organizations, which could exceed 100% |
| 3.2a | Overview header: period selector, last updated, refresh | ✅ | `PlatformPage` meta line: date range + "Updated HH:MM" |
| 3.2b | Four KPI cards with deltas and drilldowns | ✅ | Shared `DashboardKpi`; change badge only when the previous window has data; every tile links to its filtered list |
| 3.2c | Growth trend chart and organization-health panel | ✅ | Two-series area chart (registered vs finished setup) + clickable lifecycle distribution; "Limited data" note under 3 points |
| 3.2d | Billing snapshot row | ✅ | MRR/ARR per currency (never summed), active paid, trialing, conversion, past due, complimentary; methodology shown; fails independently of analytics |
| 3.2e | Requires attention, plan mix and platform health panels | ✅ | Attention queue (6 sources, severity-toned, each linking to its records) and plan mix done earlier. Closed 2026-10-23: a **Platform health** panel now reads the 5.3 per-queue figures from `GET jobs/health` (SUPPORT) — automations and emails waiting and retained-failed, scheduler due now and overdue beyond its own window — fetched in the same `allSettled` so a queue outage shows "unknown" rather than zero, with its own skeleton, error and retry. Scope is stated on the panel: queue depth now versus scheduled executions in the database. The operations row is 3/2/1 columns. |
| 3.2f | Funnel, module adoption, countries, recent activity | ✅ | Kept and moved onto the shared panel primitives; audit event keys now render as readable names |
| 3.2g | Per-widget honest states; responsive 4/2/1 columns | ✅ | `Promise.allSettled` so a billing outage shows "unknown", never 0; per-panel skeleton/empty/error with retry; 4/2/1 KPI grid |
| 3.3 | Organization 360° detail tabs | ✅ | `platform-organization-detail.tsx`: seven tabs on shared `Tabs`/`DataTable`/`StatusBadge`; lifecycle and subscription shown as separate badges; suspension banner. Suspend/reactivate moved to `AdminActionDialog` (reason, slug typed back for suspend) and `e2e/phase12-platform.spec.ts` updated to match. Side feeds (billing, security, audit, failed jobs) keep loading, error-with-retry and empty apart; previously a failed feed read as "nothing recorded". API detail gains an uncapped active `memberCount` (the member list is capped at 100). Legacy raw-button rule now excludes tab triggers, icon buttons and the combobox clear via a selector-list `:not()` that keeps its (0,1,1) specificity |
| 3.4 | Organizations list: subscription-state and onboarding filters, last activity | ✅ | API: `subscriptionStatus` (six states + `NONE`) and `onboarding` (COMPLETE/INCOMPLETE) filters, both readable from the query string for drilldowns; plan and subscription filters are ANDed (they share a relation and previously would have overwritten each other); `lastActivityAt` on list and detail ([metric-dictionary.md](metric-dictionary.md)); list `memberCount` now counts active members, matching the detail. UI: shared `DataTableToolbar`/`DataTableSearch`/`DataTableFilters`/`Select` inside the table card, debounced search and country (a one-letter code is never sent), honest error state with retry, methodology footnote. The legacy `.rb-platform` label/input/select/textarea rules now skip shared primitives at unchanged specificity (this also fixes the billing list's search box) |
| 3.5 | Users list and detail: platform role vs memberships, sessions, status dialog | ✅ | List: shared toolbar, account-status and new `platformAccess` (ADMIN/NONE) filters, a platform-access column (`platformRole` in the contract), error state with retry. Detail: Account, Platform access (stated as separate from organization roles), memberships, live sessions (device hint, last seen, uncapped `activeSessionCount`), security events; Suspend/Close/Reactivate via `AdminActionDialog` (email typed back for suspend and close; an unverified account is never activated by hand). Shared `Panel` exported from the organization detail. Fix-forward from 3.3: the security and audit pages now honour `?organizationId=`/`?userId=` and show a "one organization/account only · Show all" note. Self/admin-target guard → ⛔ O4 |

## Phase 4 — Billing & Subscriptions consolidation (P1)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 4.1 | Plans & Pricing under Billing: 4×2 catalog table, entitlement matrix, separate Legacy section | ✅ | `/platform/billing/plans` (`/platform/plans` redirects; nav and overview links updated). Catalog: four tiers × monthly/yearly from the DB, each price checked against `OFFICIAL_PLAN_CATALOG` and showing its Paystack code state from `providers()`, plus subscriber counts linked to the filtered organization list. Matrix: all 27 catalog keys (labels now `OFFICIAL_ENTITLEMENT_LABELS` in contracts), with a red badge when the enforced value differs from the approved one and an amber badge when the yearly row differs from the monthly; drift logic in `lib/plan-catalog.ts` with 4 unit tests. Legacy section: non-official or inactive plans with their remaining subscribers. **The page is read-only:** the inline entitlement editor and "Make default" were removed from the UI (see O5) |
| 4.2 | Controlled Paystack-code edit dialog (SUPERADMIN, reason, audit) | ✅ | `PUT plans/:id/provider-code` (SUPERADMIN): only the eight active official Paystack plans; `PLN_…` format; refuses duplicates and unchanged codes; **verifies the code with Paystack before saving** through `paystackPlanMismatches`, now shared with checkout so the two cannot disagree; a conditional update guards concurrent changes; audited with reason, old and new code and Paystack's verified figures. Upstream failures come back as a clear 400, so the operator sees Paystack's reason instead of a masked 5xx. Fixed: the generic `PATCH plans/:id` could change a code with no reason, and its audit row recorded only name, status and isDefault. It now refuses code changes and audits every commercial field. UI: "Change code" per price cell (SUPERADMIN) using `AdminActionDialog`'s new documented `fields`/`confirmDisabled` slot. `DEPLOYMENT_HANDOVER_PAYSTACK.md` and `permissions-matrix.md` updated |
| 4.3 | Billing pages on shared primitives; overview drilldowns | ✅ | Lists: shared toolbar/`Select`/`StatusBadge`, error state with retry, per-page descriptions, webhook "Last error", `?state=`/`?status=` drilldowns honoured. Revenue and Issues rebuilt on `Panel` with honest empty states; Issues links to the records behind each count. Providers: `Panel` + `Row`, readable plan labels, status kept visible at 390px, link to Plans & pricing for code changes. Detail: subscription (Term, Provider with read-only "Compare with Paystack", Payments, Usage, Plan changes, Billing actions) and transaction (Payment, Context) replace the raw key dump. Overview: KPI tiles on the shared `DashboardKpi` with exact drilldowns (`TRIALING`, `PAST_DUE`, failed transactions); "Active paid" opens the full list, since no single filter reproduces it. A load failure shows `ErrorState` with retry, not a skeleton forever. Money is shown exactly through `lib/money` (`formatMinor`), no longer `Number()/100` |
| 4.4 | Trial, refund, override and webhook-retry actions in dialogs | ✅ | All through `AdminActionDialog`. Trial extension: `datetime-local` bounded by the current trial end and now + 30 days. Refund request: amount typed in currency units and parsed by the new strict `parseDecimalToMinor` (BigInt, refuses >2 decimals rather than truncating), capped at amount − refunded. Offered only for `SUCCESSFUL` Paystack payments, matching the API; the dialog states that pending requests also count against the cap (the API enforces it). Override request/approve/revoke; **fixed**: revoke used to send the request form's shared reason |
| 4.5 | Billing integration tests: webhook signature and idempotency, renewal amount, trial read-only | ✅ | `billing-renewals.int.test.ts` 6/6 (with the D12 fix). `billing-enforcement.int.test.ts` 10/10 over real HTTP: a signed Paystack delivery is accepted and recorded once on redelivery; missing, forged and tampered signatures get 401 and record nothing. The read-only matrix covers running trial (writable), expired trial, trial past end before the job runs, active paid (writable), past due within grace (writable) and beyond it, ended cancellation, and cancelled. Reads always stay open; billing routes never get `SUBSCRIPTION_READ_ONLY`. Idempotency under concurrency was already covered by `billing-webhook-claim` |

## Phase 5 — Configuration, Jobs, Security, Audit (P1/P2)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 5.1 | Feature flags: list, detail drawer, simulator, typed pickers; D11 | ✅ | **List:** `DataTable` with search, status and targeting filters, default/status badges, a targeting summary and the last change (who, when). Create goes through `AdminActionDialog` and lands on the new flag. **Detail page** (`/platform/feature-flags/:id`, a page like org/user detail rather than a drawer): flag panel, rules most-specific-first, change history in words with reasons, and dialogs for default, archive (key typed back) and rule add/remove. **Typed targets:** country combobox from the jurisdiction catalog, plan select, organization search; the API now refuses an unknown country, plan or organization (previously a typo matched nothing, or 500'd). The rule dialog shows how many organizations the target matches. **Simulator:** a real organization (its country and plan come from its record, as at runtime) or a hypothetical country and plan. **Preview fixed to match runtime:** an archived flag now reports off (`ARCHIVED`); before, preview showed its rules while runtime returned off. **Reasons:** required on every flag change except create; audit rows now carry full before/after, and rule events carry the flag id so history survives a rule's removal. **Egress safety:** `phase13.hosted_ai_egress` targeting is owned by `HostedAiEgressApprovalService` (approval and rule change together); the console could edit that rule around the approval. Its rules and default are now refused there; archive (fail-closed kill switch) stays. D11 was fixed in 2.4 |
| 5.2 | Country packs: version detail; lifecycle vs identifier; dialogs | ✅ | **List:** one row per pack code (it used to be one row per version): jurisdiction (`ZZ` shown as "Fallback (no jurisdiction)", never as a country), current published version and date, review tier, version counts, organizations pinned, validation (required defaults and a tax definition), last change. **Version page** (`/platform/country-packs/:code/:version`) with tabs: Overview (lifecycle, which version new organizations get, pinned count, tier explanation, validation, notes), Tax definitions (a rate table instead of raw JSON), Defaults (labelled), Versions, Audit. **Identifier vs state:** both seeded packs are published under identifiers containing "draft" (`2026.1-draft`, `2026.1-generic-draft`); the page states that the word belongs to the identifier and the version is published. Ids are not renamed, because documents reference them. **Dialogs:** publish (identifier typed back; says it becomes current for new organizations and in place of which version; existing organizations and issued documents keep theirs; not a certification; blocked while a required default is missing), deprecate (pinned-organization count, what new organizations get instead, Tier A consequence) and delete draft; all three now **require a reason** in the API. The JSON editor is unchanged and opens from both pages. Review/approval states → ⛔ O7 |
| 5.3 | Jobs: per-queue scope labels (D10), failure detail | ✅ | **D10:** queue health is now a table per BullMQ queue (Automations, Emails) with waiting, active, delayed, **Failed (retained)** and oldest-waiting age. A note says the retained count is every exhausted job ever kept, not a 24-hour figure. The **Scheduler** panel is labelled as the database view of scheduled executions only: due now, overdue (> 15 min, meaning the scheduler is not picking work up), running, failed in the last 24 hours, next run. **Failures and recovery** has three tabs. Scheduled executions has a task filter, readable task names, a details drawer (error, source, attempts, what a retry does) and Retry through `AdminActionDialog`. Retry now **requires a reason** and is audited `FAILED → QUEUED`, with impact text per task. Email queue and Automation queue are read-only: the 25 most recent retained failures, with no job payloads, first line of the reason only, email addresses redacted. They are not retryable from the console, because a resend cannot be made exactly-once. **Race fixed:** two concurrent retries of one execution used to both reset it and both audit; the reset is now conditional on `FAILED`, so one gets 409. This also covers the tenant retry endpoint. Recurring-claim behaviour → ⛔ O8 |
| 5.4 | Security events: readable names, detail drawer, "Platform-wide" | ✅ | **List:** a readable name for each of the 43 keys the API can emit (`auth.login_failed` → "Failed sign-in attempt", `organization.finalized` → "Organization setup completed"), with the raw key underneath. Unknown keys show the key itself, made readable. Severity badge; account (linked to the user page) or "No account"; organization (linked) or **"Platform-wide"**; time. **Filters** on the shared toolbar: account email search (new `actor` param), event (grouped: sign-in and account security, team access, organization and books activity), severity, and a UTC date range. Loading, load failure, "no events recorded" and "no events match these filters" are all distinct. **Detail drawer:** event id, UTC and local time, severity, account, organization, recorded details with labelled fields (minor-unit amounts say so), and related links (all events for the account or organization, the platform audit for the organization). **Evidence is read-only:** there is no edit or delete path. **Role restriction:** `metadata.sessionId` (the session row id, never the token) is returned to SUPERADMIN only. `ipHash` was never returned and still is not. **Bug fixed:** emitters write severity `WARNING`, but the filter only accepted `WARN`, so "Warning" could never match; `WARNING` is now accepted and `WARN` still validates. |
| 5.5 | Audit log: filters, readable actions, before/after diff | ✅ | **List:** a readable name for each of the 29 platform audit actions (for example "Organization suspended", "Country pack published", "Billing override approved"), with the raw key underneath; unknown keys fall back to the key made readable. Organization by name (linked) or "Platform-wide"; reason, or "None recorded" for older rows; administrator email and role; time. **Filters** on the shared toolbar: administrator email search (new `actor` param), action (grouped: organizations and users, plans and subscriptions, configuration, operations and access) and a UTC date range (new `from`/`to`). Tenant scoping stays on `?organizationId=`, which detail pages and the drawer link to. **Detail drawer:** administrator and role at the time, UTC and local time, target, organization, audit record id, reason, and **what changed**: a field-by-field before/after table that lists unchanged fields by name, says "Created" or "Removed" when one side is missing, and says so when no state was recorded rather than implying nothing changed. Related links to the organization's audit and security events. No web or API diff helper existed (searched), so `AuditDiff` lives next to its only consumer. Append-only storage → 5.6 (D9). |
| 5.6 | D9: audit FK `Restrict` and append-only trigger | ✅ | **Owner decision 2026-10-22: block every edit and delete, allowing only the organization foreign key's own SET NULL.** Migration `20261022100000_platform_audit_append_only` is additive and idempotent (it was run twice against the dev DB). (1) `platform_audit_events.platform_admin_id` changes from `ON DELETE CASCADE` to `RESTRICT`: deleting a grant can no longer delete its audit history. Grants are revoked by status and never deleted, so no current flow is affected. (2) The trigger `platform_audit_events_append_only` (BEFORE UPDATE OR DELETE, per row) refuses with SQLSTATE 55000, with one exception: an UPDATE that only clears `organization_id`. That keeps a future organization purge possible while the row keeps its actor, target id, reason and before/after. `TRUNCATE` is not intercepted (the test harness resets with it). No application code updates or deletes audit rows. `prisma migrate diff` (dev DB against the schema) is empty, so there is no drift. |
| 5.7 | Support Operations | ➖ | Only if justified later |

## Phase 6 — Hardening & release (gate)

| ID | Task | Status | Evidence |
|---|---|---|---|
| 6.1 | Platform Playwright spec in Jenkins (or documented deferral) | ✅ (deferral) | **Not added to Jenkins; the deferral is documented** in [qa-test-plan.md §4](qa-test-plan.md). The CI box is over capacity (6 products on hardware for 3, swap full at idle, one executor), and the Playwright web server needs a production Next build with a 4 GiB heap on top of the five service containers. **The spec was extended and run instead:** `phase12-platform.spec.ts` gains a read-only test of jobs (scoped figures), security events (readable names, drawer), the audit log (the suspension's before/after diff) and country packs ("Fallback (no jurisdiction)"). **4/4 passed** locally against the dev stack, the first run of the 5.1 flag flow. To revisit when CI headroom or a staging target exists. |
| 6.2 | QA plan, release checklist, runbooks | ✅ | [qa-test-plan.md](qa-test-plan.md) maps every §22.1–22.3 criterion to a named test, the browser spec, UAT, or a stated gap. [release-checklist.md](release-checklist.md) covers owner items, before merge, before deploy (production state, a Paddle check that would otherwise abort the deploy, backup, rehearsal of the seven data-changing migrations with what to check for each), deploy, after deploy (trigger present, O6 report) and rollback. Five runbooks in [runbooks/](runbooks/): failed subscription payment, webhook recovery, failed email jobs, tenant suspension, country-pack rollback. Every step was checked against the code (statuses, grace days, role floors, what each action does and does not do). |
| 6.3 | UAT with synthetic fixtures (spec §22.4) | ✅ (F5/F8–F11 remain owner-deferred) | **Owner decision 2026-10-23: skip staging deployment and run the documented local UAT drill.** `uat-fixture-seed.service.ts` produces F1–F4, F6, F7 and F12 through the real services, with production and live Paystack keys refused. **Verified 23 Oct 2026, all in a browser against isolated `valuebooks_e2e`:** nonpayment drill 4/4 (`platform-uat-nonpayment.spec.ts`: F3/F4 distinct trial states, F4 read-only refusal, F6 invoice 20 then 21 refused, F7 project 25 then 26 refused); remaining-fixtures drill 4/4 (`platform-uat-remaining.spec.ts`: F1 no-membership account refused console entry and visible to support, F2 incomplete-setup filter, F12 cancel-at-period-end, F16 repeated failed sign-ins as warning evidence); F15 failed-email-job 1/1 (`platform-uat-email.spec.ts`, dedicated invalid-SMTP worker, job contents withheld); viewport/keyboard sweep 18/18 (`platform-uat-accessibility.spec.ts`, 1440/1024/390 plus Tab/Escape). F13/F14 covered by the existing `phase12-platform.spec.ts` (4/4, re-run as a baseline check). See [uat-plan.md §4a](uat-plan.md) for prior per-test evidence. **F5, F8, F9, F10, F11 recorded as untested, not passed** (payment scenarios deferred by the owner; Paystack test-mode key location still unknown). |

## Progress log

- **2026-10-23 — K and production checks A–C:** `npm run lint` and `npm run typecheck` at the repository root passed. The initial `npm test` passed the web, accounting-core, config, contracts, localization and UI suites, but API had one failing PDF rasterizer test and an app-setup suite hook timeout. On Windows, pdf.js rejected the raw `standardFontDataUrl` path before parsing; `pdf-rasterizer.service.ts` now supplies a `file:` URL via `pathToFileURL`, preserving the existing PDF limits and evaluation controls. Both affected specs passed when run individually; the full API `npm test --workspace apps/api` then passed **34 files, 231 tests**. Focused ESLint on the fix passed. The app-setup timeout did not reproduce in isolation or the API rerun. **Jenkins has not run**: it checks committed branch content, while this branch's work remains uncommitted. The Jenkins `Test (integration)` gate and full pipeline are still required before merge. A and B require production database access, which is unavailable in this workspace; no production query was run. C remains a post-deploy read-only report; no report was run. No production data was changed and no live Paystack call was made.

- **2026-10-23 — full verification pass, executed:** owner approved running verification for the E–I code written in the
  prior two entries. Work proceeded through the stages below; evidence is the exact commands and results actually
  observed.

  **1. Prisma generation.** `npm run db:generate` (apps/api) — ✅ generated cleanly against `schema.prisma`.

  **2. Typechecks**, run separately: `npm run typecheck` in `apps/api` (clean), `packages/contracts` (clean),
  `apps/web` — **found 2 errors** in the new `platform-entitlement-versions.tsx` (`KEYS[0]` typed
  `string | undefined` under `noUncheckedIndexedAccess`). Fixed with a `?? ''` fallback at both sites; re-run clean.

  **3. Focused ESLint**, run once over every touched file (not the whole tree). **Found and fixed 3 issues**, none
  weakening a guard or invariant: (a) `recurring-document-claim.ts` imported `PrismaService` as a value when it is
  only used as a type — changed to `import type`; (b) three browser specs (`platform-plan-notice.spec.ts`,
  `platform-uat-nonpayment.spec.ts` ×2) read an untyped `response.json()` and accessed `.price_minor`/`.error` on
  `any` — added explicit response-shape types; (c) the new `apps/web/e2e/stub-paystack.cjs` has no tsconfig project
  membership, so `recommendedTypeChecked` could not attach — added a narrow `eslint.config.mjs` exemption mirroring
  the existing `infrastructure/backup/**/*.js` pattern (plain CommonJS script run via `node`, outside any project).
  No whole-file reformatting; CRLF line endings were left alone.

  **4. Migration drift.** Created an isolated `valuebooks_shadow_verify` database on the running dev Postgres
  container; `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma
  --exit-code` (with `SHADOW_DATABASE_URL` pointed at it) — **"No difference detected."** The two new migrations
  (`20261023100000_plan_tiers`, `20261023101000_plan_entitlement_versions`) are in step with `schema.prisma`. The
  shadow database was dropped afterward. No applied migration was edited.

  **5. Focused integration tests**, each run as its own `npx vitest run test/<file> --config
  vitest.integration.config.ts` invocation (never combined): `platform-plan-pricing` 13/13,
  `platform-authorization` 3/3, `platform-audit` 1/1 (after a fix, below), `plan-entitlements` 17/17,
  `platform-plan-code` 6/6, `plan-entitlement-versions` 1/1, `billing-renewals` 7/7, `billing-webhook-claim` 6/6,
  `platform-feature-flags` 5/5, `platform-resolution` 3/3, `platform-operations` 6/6, `recurring-bills` 10/10,
  `recurring-expenses` 11/11, `recurring-invoices` 9/9, `recurring-journals` 7/7, plus the unit spec
  `paystack-plan-update` 1/1. **One real regression found and fixed:** `platform-audit.int.test.ts` (unmodified by
  the E–I work, so not previously exercised against it) created a bare plan with no tier/Paystack code/entitlements
  and activated it; the new F catalog-governance invariant correctly refused the activation
  (`MISSING_ENTITLEMENT`/`PAYSTACK_CODE` violations newly introduced). Fixed the fixture, not the invariant: the test
  now supplies `tierKey`, `billingProvider`/`providerPriceId` at creation and seeds every official entitlement key
  before activating, so it exercises audit coverage rather than catalog completeness (which is covered elsewhere).
  `plan-entitlement-versions.int.test.ts` is the proof that publishing pins an existing subscriber, the enforced
  limit does not move immediately, and a verified renewal clears the pin; `billing-renewals.int.test.ts`'s "keeps a
  pinned sold limit until a verified renewal starts the new period" case covers the renewal-release path over the
  real webhook path.

  **6. Focused web unit tests.** Ran the full web unit suite (only 7 files, 34 tests) rather than hand-picking, since
  it is cheap: `pricing-data`, `plan-picker`, `plan-catalog`, plus the four unrelated existing suites — **34/34
  passed**, no regressions.

  **7–8. Browser stack and specs.** Built an isolated e2e stack by hand (never via Playwright's own parallel
  `webServer` auto-start): created `valuebooks_e2e` against the running dev Postgres (port 5433, not the 55432
  default — the repo's `.env` was not read, so `E2E_DATABASE_URL`/`E2E_MAINTENANCE_URL` were passed explicitly), ran
  `node e2e/prepare.mjs` with `ALLOW_UAT_FIXTURES=true` (seeds F1–F4, F6, F7, F12 through the real services), started
  the API (`node --require ./apps/web/e2e/stub-paystack.cjs apps/api/dist/src/main.js`, `PAYSTACK_SECRET_KEY` set to
  a non-live stub value) and the web app (`next build` — hit the documented one-time `SecurityFatalError`, retried
  per the known trap, succeeded; `scripts/copy-standalone-static.mjs` ran automatically as the build's own
  `postbuild` step; started with `HOSTNAME=127.0.0.1 PORT=3300`), then ran Playwright with
  `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3300` against the already-running pair. The Next.js security upgrade was
  **not** performed (owner's call, left alone).

  **Browser scenarios actually completed, all desktop unless noted:**
  - `phase12-platform.spec.ts` 4/4 — baseline regression check (unchanged by this branch's own test code, confirms
    E–I did not break existing platform console coverage).
  - `platform-marketing-prices.spec.ts` 6/6 across desktop/tablet/mobile — live prices on `/` and `/pricing`.
  - `platform-plan-notice.spec.ts` 1/1 — propose a price increase, send the notice, publication refused inside the
    30-day window (`400`, message mentions "30"), `billing_notices.queued_at` aged **31 days** by direct `UPDATE`
    scoped to that change's `source_id` only, publication then succeeds (`201`) and the stored price moves to the
    proposed amount through the Paystack stub.
  - `platform-uat-nonpayment.spec.ts` 4/4 (F3/F4/F6/F7) — re-run twice from a fresh `prepare.mjs`, confirming the
    one-shot drill behaviour the brief documents.
  - `platform-uat-remaining.spec.ts` 4/4 (F1/F2/F12/F16) — **found and fixed 3 test bugs**, no product code
    changed: (a) its `signIn` helper clicked "Sign in" without waiting for navigation, racing the next `page.goto`
    against the still-in-flight login — added `page.waitForURL` away from `/login`; (b) F1 searched the users list
    with `getByPlaceholder(/search/i)`, but the real placeholder text is "Email or name" (the accessible name is
    "Search users") — switched to `getByRole('textbox', { name: 'Search users' })`; (c) F16 asserted
    `getByText('Warning', { exact: true })`, which also matches the hidden `<option value="WARNING">` in the
    severity filter — scoped the locator to `getByRole('table')`.
  - `platform-uat-accessibility.spec.ts` 18/18 across desktop/tablet/mobile (five pages at three viewports, plus the
    Tab/Escape keyboard-navigation case at all three) — **found and fixed one race**: the keyboard test captured the
    focusable-control set before the catalog health, plan catalog and entitlement matrix panels had finished their
    async loads, so Tab could not reach a control that only existed after more content streamed in; added a wait for
    the "Create tier" button (used later in the same test) before capturing the control set.
  - `platform-uat-email.spec.ts` (F15) 1/1, run alone with its own single `worker.js` process started with
    `SMTP_HOST=invalid.invalid` (killed every other stray worker process first, confirmed exactly one via
    `Get-CimInstance` before and after) — **found and fixed two test bugs**: the default 30s Playwright test timeout
    was shorter than BullMQ's 5-attempt exponential backoff against an unreachable host, so the test died before the
    job even reached the failed queue (`test.setTimeout(120_000)` added); and the retained-failures panel fetches
    once on mount with no live polling, so waiting on the already-rendered page never saw the job land no matter how
    long the assertion's own timeout was — changed to `expect.poll` that reloads `/platform/jobs` and re-opens the
    tab on each attempt. Confirmed via the worker log and a direct API probe that the job did fail
    (`getaddrinfo ENOTFOUND invalid.invalid`, 5/5 attempts) before fixing the test, ruling out a product defect.
  - **Paystack:** every API process in this pass was started with `--require ./apps/web/e2e/stub-paystack.cjs`,
    which always intercepts `api.paystack.co` regardless of the opt-in flag. The notice-flow spec's plan update,
    the plan-code verification path, and checkout all went through the stub (confirmed in the API log: `PLN_uatgrowth`
    responses, no outbound calls logged to the real host). **No live Paystack call occurred** at any point in this
    pass; `PAYSTACK_SECRET_KEY` was set to the stub value `sk_test_uat_stub`, never the root `.env`'s live key.
  - F5, F8–F11 were **not attempted** (Paystack test-mode key location still unknown, per item D).
  - All manually-started servers and workers (API, web, and the dedicated F15 worker) were stopped at the end of
    this pass; nothing was left running.

  **9. Full required gates.** Not run in this pass, by design — deferred to Jenkins **Test (integration)** and the
  repository's full lint/typecheck/test suites before merge, per the mandatory-for-billing/authorization/accounting
  rule. **Jenkins itself has not been triggered or observed; its result is not claimed.**

  **Scope discipline:** no uncommitted file outside the ones already listed as touched by E–I (plus this tracker and
  the fixes above) was changed; nothing was committed, stashed, reset, or discarded. O12/J was left untouched — no
  new explicit owner yes was given in this pass.

- **2026-10-23 — code-only continuation, nothing executed yet:** E adds `PlanTier` with additive backfill and FK, SUPERADMIN create/activate/retire actions, a draft console workflow, and database-driven public tier cards. F adds named catalog violations; `OFFICIAL_PLAN_CATALOG` remains the launch entitlement baseline, while today's prices come from the database. `plan-entitlements.int.test.ts` now compares entitlements and provider fields, **not prices**. G follows the owner's next-renewal choice with version snapshots, pinning, resolution, and renewal release; usage and real webhook-path specs were added but not run. H/I add opt-in browser spec code for the notice sequence, marketing pages, F1/F2/F12–F16, viewports, and keyboard navigation. **No migration, Prisma generation, typecheck, lint, unit/integration spec, build, browser run, or Paystack call has been executed in this continuation.** O12/J was skipped because no explicit owner yes was given. E–I are unverified; full suites and Jenkins **Test (integration)** remain required before merge.
- **2026-10-23 — final code review additions, still nothing executed:** G's separate entitlement-version console route now exposes draft, impact preview and publish actions. Tier creation captures the commercial order used by dynamic checkout downgrade detection; checkout now admits ACTIVE database tiers with PAYSTACK plans rather than a compiled four-tier routing map. The public comparison reads each live entitlement's enabled state. These changes are also **not run**.
- **2026-10-23 — Next.js security upgrade:** upgraded and pinned `next` and `@next/eslint-plugin-next` from the vulnerable 16.4.0/15.5.x combination to 16.4.3. `npm ls` resolved both at 16.4.3; `npm audit --omit=dev` no longer reported Next.js; the web typecheck, repository ESLint, web unit suite (7 files, 34/34 tests) and standalone production build with its static-copy postbuild all passed. The build completed on its first attempt without `SecurityFatalError`. Six unrelated existing audit findings remain in Prisma and ExcelJS dependency paths and were not changed as part of this focused upgrade.
- **2026-10-23 — O12/J SUPPORT billing overview:** after explicit owner approval, replaced the coupled `Promise.all` with independent settlement. The SUPPORT-authorized overview now renders when the OPERATIONS revenue read returns 403; verified collections is omitted and replaced by clear higher-role copy. Non-403 failures retain the shared `ErrorState`, while a successful response with no collections retains the true-zero copy. No API role floor changed. `platform-billing-overview.test.ts` passed 3/3, the web typecheck passed, targeted ESLint passed, and the Impeccable detector returned no findings. No browser run was performed for this focused fix.

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
- **2026-10-22**: Phase 4.2, the Paystack plan-code action.
  - **Checks, all green:** api + web typecheck; ESLint on the touched files; new unit spec `paystack-plan-verification` 3/3 (the checkout price guard had no test before; it does now); integration `platform-plan-code` 5/5 (verify-and-audit, mismatch, unknown code, pre-Paystack refusals, SUPERADMIN-only and PATCH lockdown, all with Paystack stubbed at `fetch`) plus `platform-audit`, `plan-entitlements` and `plan-selection`, 26/26 together.
  - **Browser:** before a dev-server restart, the dialog was exercised end to end: confirm disabled for a malformed code, a well-formed fake code refused in the dialog, the DB code unchanged. A re-check of the clearer refusal text could not run: the workstation dropped to about 0.6 GB free RAM (other applications), and Chrome could not finish loading pages. That text is covered by the integration spec.
  - **API unit suite:** 223 passed; `document-extraction-limits` fails on this Windows machine (pdfjs rejects a `C:\` factory URL) and `app-setup` failed once in the parallel run but passes alone. Both are unrelated to this work.
  - **Deferred to Jenkins (mandatory before merge, billing):** full lint, typecheck and test, plus **Test (integration)**.
- **2026-10-22**: Phase 4.5 stopped on a confirmed billing defect, **D12**: Paystack renewal payments are never applied. Evidence: Paystack's documented renewal payload, a reading of `normalizePaystackEvent`/`applyToSubscription`, and a throwaway integration check through the real webhook service (renewal → 0 transactions, dates unchanged, event PROCESSED; the scratch spec was deleted, not committed). Owner decision O6 is open.
  - **4.3 and 4.4 (UI) not started:** the workstation is at about 0.6 GB free RAM (other applications) and Chrome cannot load pages, so new UI could not be verified in a browser.
- **2026-10-22**: D12 fixed on the owner's instruction (O6).
  - `normalizePaystackEvent` maps paid `invoice.update` (subscription code, charge reference, Paystack's period) and passes a charge's plan code.
  - `applyToSubscription` matches a renewal charge to the single linked subscription of that customer on that plan and refuses when several fit. A second report of an already-recorded charge does not move the period unless it states one. Signup and plan-change payments keep their existing path.
  - **Checks, all green:** api typecheck; ESLint on the touched files; new `billing-renewals` 6/6; regression `billing-webhook-claim`, `plan-selection`, `plan-entitlements`, `platform-plan-code` and `platform-audit` 32/32; API unit 227/228 (only the known Windows pdfjs failure).
  - **Report:** [dropped-renewals-report.md](runbooks/dropped-renewals-report.md). Local DB: 0 rows, and it holds no webhook events at all. The query was also checked on rolled-back fixtures: a dropped renewal appeared once with its candidate subscription, a refused payment showed as FAILED, an unpaid invoice was excluded, and nothing persisted. **Production run is the owner's.**
  - **Deferred to Jenkins (mandatory before merge, billing):** full lint, typecheck and test, plus **Test (integration)**.
- **2026-10-22**: Phases 4.3 and 4.4.
  - Found while finishing: the detail rebuild had not typechecked (`describeOrganizationPlan` now needs `planStatus`). The refund action was offered on `PARTIALLY_REFUNDED` payments that the API refuses. Usage was titled "this period" but lists every period. The overview showed "0%" for a conversion rate that does not exist yet. All fixed.
  - **Checks, all green:** web typecheck; ESLint and Prettier on the touched files; web unit 34/34 (new `lib/money.test.ts` 3/3, which includes a value above 2^53).
  - **Browser pass (1440px and 390px):** the overview, the five lists with drilldown filters, refunds, issues, revenue, providers, one subscription detail and the overrides page. No page overflow and no browser errors. The local DB has no billing transactions, so the transaction detail was rendered from a synthetic API response injected by Playwright (nothing written to any DB). The refund dialog was opened and checked: exact default, over-cap disabled, three-decimal message. It was never submitted.
  - **Not exercised in a browser:** submitting any billing action (no transactions, webhooks or live trials locally). The endpoints are unchanged and covered by the existing integration specs.
  - **Follow-up, not changed:** a SUPPORT-role operator cannot load the billing overview. It fetches `revenue` (OPERATIONS) together with `overview` (SUPPORT), so the whole page fails. This predates 4.3.
  - **Deferred to Jenkins:** full lint, typecheck and test. There is no API change in 4.3/4.4; **Test (integration)** stays mandatory before merge for this billing branch.
- **2026-10-22**: Phase 5.1, feature flags.
  - **API (additive except reasons):** `GET feature-flags/:flagId`, `GET feature-flags/audience`; `reason` (10–500) now required on PATCH flag, POST rule and DELETE rule (body). The console is the only client; the e2e spec and the integration specs were updated.
  - **Checks, all green:** api + web typecheck; ESLint and Prettier on the touched files; integration: new `platform-feature-flags` 5/5 (reasons required and nothing written without one; unknown targets refused; egress flag rules/default refused, archive allowed, `governedBy` exposed; organization preview equals `isFlagEnabled` through plan, organization and archived states; history with reasons and before/after after a rule's removal; audience count equals the DB), plus `platform-resolution` 3/3, `platform-audit` 1/1, `platform-projections` 1/1, `phase13-feature-flags` 5/5, `platform-authorization` 3/3; api unit `feature-flag.guard` + `hosted-ai-egress-entitlement` 7/7; web unit 34/34.
  - **Fixed in passing: `platform-authorization` was broken since 4.2.** Its route discovery threw on the new PUT `plans/:planId/provider-code`, and it never covered `platform/billing` at all (it only walked the `platform` controller). It now handles PUT, walks every `platform/*` controller and asserts the billing refund and approval routes are inside the boundary; every role floor holds.
  - **Browser pass on the dev stack (1440px and 390px):** list; create → country rule via the combobox (impact: 5 organizations) → hypothetical and real-organization previews (both decided by the country rule, as expected) → rule removal → archive with the key typed back; the history read back all four changes with their reasons. No page overflow, no browser errors. **Left behind in the local dev DB:** one archived flag `qa.phase5_flag_*` (flags cannot be deleted).
  - **Not run:** `e2e/phase12-platform.spec.ts` (updated to the new flow; needs the :3300 stack, see 6.1).
  - **Deferred to Jenkins:** full lint, typecheck, test and **Test (integration)** (mandatory before merge: authorization surfaces changed).
- **2026-10-22**: Phase 5.2, country packs.
  - **API:** `admin/all` adds `pinnedOrganizations` (from `OrganizationPreference`) and `current` (the latest published version of the code, the same rule `CountryPackStore.resolve` uses for new organizations). New read `admin/:code/versions/:version`. Publish, deprecate and delete take a required reason.
  - **Checks, all green:** api + web typecheck; ESLint and Prettier on the touched files; integration `country-packs` 6/6 (new case: publish refused without a reason and the version stays a draft; pinned count equals the DB; current flag; version history with the reason), `platform-audit` 1/1 (now asserts the lifecycle reasons), `platform-projections` 1/1.
  - **Browser pass (1440px and 390px):** list; KE and GENERIC version pages and all five tabs; a throwaway KE draft created from the published version, its publish dialog opened and cancelled, then the draft deleted through the dialog. **Nothing was published**, so local KE onboarding is unchanged. No page overflow, no browser errors.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus Test (integration).
- **2026-10-22**: Phase 4.5 completed: `billing-enforcement` 10/10 (signatures over HTTP; trial and subscription read-only matrix). Deferred to Jenkins: Test (integration), mandatory before merge.
- **2026-10-22**: Phase 5.3, jobs and queues.
  - **API:** `queueHealth` adds `oldestWaitingAt` per queue and a scheduler block (`dueNow`, `overdue`, `overdueAfterMinutes: 15`, `failedLastDay`, `runningNow`, `nextRunAt`). New read `GET jobs/queues/:queue/failed` (SUPPORT; `automation` or `email` only) returns retained failures without payloads, through `queue-diagnostics.ts` (first line, emails → `[email]`, 300 chars). `GET jobs/failed` takes a `handler` filter. `POST jobs/:id/retry` now **requires a reason** (10–500) and audits `after: QUEUED`. `SchedulerService.retryExecution` resets with a conditional `updateMany` on `FAILED`, so a racing second retry gets 409 and writes no second audit row (tenant endpoint included).
  - **Web:** `PlatformJobs` rebuilt on `Panel`/`Row`, `DataTable`, `DataTableToolbar`, `Tabs`, `DrawerContent` and `AdminActionDialog`. Shared CSS: `.rb-explain-panel--surface` gains `align-content: start`, so short drawer content is no longer spread over the full height. This also affects the report explain and receipt extraction drawers, which had the same gap when their content was short. The unused legacy `.rb-platform__table-actions button` rule is narrowed to `:not(.rb-button)`.
  - **Checks, all green:** api + web typecheck; ESLint and Prettier on the touched files; integration: new `platform-jobs` 3/3 (reason required; the race returns `[200, 409]` with one tenant and one platform audit row; scheduler overdue and next-run figures equal the DB; unknown queue → 400), plus `platform-audit`, `automation-jobs`, `platform-projections` and `platform-authorization`, 11/11 in all; api unit `queue-diagnostics` 2/2; web unit 34/34.
  - **Browser pass (1440px and 390px):** real data (13 retained email failures, no failed scheduled executions), all three tabs; no page overflow, no browser errors. The first layout put queue health and the scheduler side by side, which clipped the queue table at 1440; they are now stacked. The details drawer and retry dialog were checked against a **synthetic** failed execution injected by Playwright (fetch/XHR only). The dialog was cancelled, and **nothing was retried**.
  - **Found, not changed:** O8 (recurring claim). Row 3.2e's platform-health panel can now reuse these per-queue figures. Not done here.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus **Test (integration)** (mandatory before merge: a privileged action and its authorization changed).
- **2026-10-22**: Phase 5.4, security events.
  - **API (additive except the restriction):** `SecurityEventSearchDto` accepts `WARNING` (the value actually stored; `WARN` kept) and a new `actor` filter (case-insensitive substring of the account email). `securityEvents` takes the platform actor and removes `sessionId` from metadata for roles below SUPERADMIN. The console was the only consumer, and it never displayed metadata.
  - **Shared UI, extended rather than added:** `DrawerContent` gains `size="wide"` (`.rb-drawer--wide`, 28rem) for record detail; the 18rem default is meant for navigation. `.rb-explain-panel--surface` now wraps long ids and emails (`minmax(0, 1fr)` and `overflow-wrap: anywhere`) instead of widening the drawer. New `DataTableFilterField` keeps a visible label with its control when the toolbar wraps, and toolbar date inputs keep their natural width. The 5.3 jobs drawer now uses the wide size.
  - **Checks, all green:** api + web + ui typecheck; ESLint and Prettier on the touched files; integration: new `platform-security-events` 3/3 (the `WARNING` filter matches; account search ignores case; SUPPORT gets no `sessionId` and SUPERADMIN does; no row carries `ipHash`; other details are not withheld), plus `platform-authorization` 3/3 and `platform-projections` 1/1; web unit 34/34; ui unit 8/8.
  - **Browser pass (1440px and 390px), read-only:** list; Warning filter (2 events, where the old filter returned none); event filter; account search; drawers for a sign-in and for an organization event. No page overflow, no browser errors. Seen only as SUPERADMIN in the browser; the SUPPORT view of metadata is covered by the integration test.
  - **Found, not changed (§14.3):** `security_events` also stores books activity (`ledger.journal_posted`, `tax.rate_added`, `periods.period_closed` and so on), so security telemetry and audit share one table and one retention. The console groups those events separately. Moving them is an emitter change in accounting code, so it is left to the owner.
  - **Environment:** the API dev server (`nest start --watch`) exits on Windows after a hot reload ("process not found"). It was restarted by hand for each browser pass. Free RAM dropped below 100 MB twice; each pass waited for memory to recover and was not retried in a loop.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus **Test (integration)** (mandatory before merge: what each role can see changed).
- **2026-10-22**: Phase 5.5, platform audit log.
  - **API (additive):** `PlatformAuditSearchDto` gains `actor` (case-insensitive substring of the administrator's email), `from` and `to` (UTC calendar dates, `to` inclusive). Rows gain `organizationName` (trading name, else legal name; null for platform-wide changes), and the contract schema matches. The date-range clause is now one helper, `occurredWithin`, shared with security events.
  - **Checks, all green:** api + web typecheck; ESLint and Prettier on the touched files; integration: new `platform-audit-search` 3/3 (administrator search ignores case; `from`/`to` are whole UTC days, checked either side of midnight; the organization name is present for a tenant action and null for a platform-wide one; the `organizationId` scope still works), plus `platform-audit` 1/1, `platform-projections` 1/1 and `platform-security-events` 3/3; web unit 34/34.
  - **Browser pass (1440px and 390px), read-only:** list; drawers for a flag change (only `status` changed; the other four fields listed as unchanged), a country pack creation (every field shown as created) and an organization suspension (organization named, related links); an administrator search with no match shows "No actions match these filters". No page overflow and no application errors. **Font note:** `fonts.gstatic.com` stalled from this machine and blocked the page load event, so this pass aborted Google Fonts requests and rendered with fallback fonts. The only console errors were those aborted requests. The dev login form also took about 36 s to become interactive, so the script waits for it.
  - **CSS:** `.rb-platform__row dt` keeps `overflow-wrap: normal`, so labels in the drawer never split mid-word next to a long value.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus Test (integration).
- **2026-10-22**: Phase 5.6, D9: append-only platform audit.
  - **Owner decision:** reject every UPDATE and DELETE except the organization FK's own SET NULL. (Offered: allow only that, strict, FK change only, or hold.)
  - **Schema:** `PlatformAuditEvent.platformAdmin` is `onDelete: Restrict`. The migration drops and re-adds the FK, creates the function with `CREATE OR REPLACE` and recreates the trigger with `DROP TRIGGER IF EXISTS`; no data is touched.
  - **Checks, all green:** `prisma validate`; `migrate deploy` applied to the dev DB, and the SQL was run a second time without error; `prisma migrate diff --from-config-datasource --to-schema` is empty; integration: new `platform-audit-append-only` 3/3 (editing the reason, deleting a row, and clearing the organization together with another change are all refused and the row is unchanged; deleting a grant with history is refused; deleting an organization succeeds and its audit row keeps the target id, reason and before/after with `organization_id` cleared), plus every suite that writes platform audit: `platform-audit`, `platform-audit-search`, `platform-jobs`, `platform-feature-flags`, `country-packs` and `platform-authorization`, 24/24 in all.
  - **Operational note:** a hand-run `DELETE` or `UPDATE` on `platform_audit_events` in any environment now fails by design. Retention or purge of platform audit rows needs its own reviewed migration that disables the trigger explicitly.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus **Test (integration)** (mandatory before merge: a migration on audit storage). The production `migrate deploy` runs with the release.
- **2026-10-23**: Phase 6.
  - **6.1:** browser stage deferred, with reasons and a revisit trigger in `qa-test-plan.md`. `phase12-platform.spec.ts` gained a read-only investigation-pages test; **4/4 passed** (desktop) against the dev stack via `PLAYWRIGHT_BASE_URL`. The run used a scratchpad wrapper config to select the installed Chrome (Playwright's bundled browser is not installed here); the repo config is unchanged. Two earlier attempts failed on environment issues, not the product: the API dev server had exited, and Google Fonts stalled the load event. Both were resolved before the passing run. **Left in the local dev DB:** two `e2e.platform.flag.*` flags and suspend/reactivate audit pairs for Karibu Retail Demo, which is active again.
  - **6.2:** QA plan, release checklist and five runbooks written and checked against the code. Found while checking: O10 (webhook retry audit), O11 (no suspension policy), and that `20261016100000_consolidate_paystack_billing` aborts the deploy if a Paddle subscription is still live (now a pre-deploy check). The go-live runbook says production has never been deployed, while O3 reports a live admin page; the release checklist makes establishing which is true its first step.
  - **6.3:** blocked on O9 (no staging). `uat-plan.md` is ready to run.
  - **Checks:** ESLint and Prettier on the spec; the browser spec as above. The documents have no automated check.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus Test (integration), mandatory before merge.
- **2026-10-23**: Closing out — the two 🔄 rows, and the owner items O4, O10, O11 and the 6.3 seeder.
  - **3.2e:** a **Platform health** panel on the overview, reading `GET jobs/health` (SUPPORT) beside analytics and
    billing in the same `Promise.allSettled`, so a queue outage reads "unknown" and never zero. Six figures with their
    scope stated (queue depth now; retained failures have no time window; scheduler figures are database executions),
    each linking to Jobs, warning-toned only when a retained failure or an overdue scheduled job exists. The
    operations row is 3 columns at desktop, 2 below 75rem, 1 below 48rem. The billing snapshot's figure grid is now
    the shared `.rb-platform-overview__figure-grid` used by both panels.
  - **2.8:** closed. Every filtered platform list is on `DataTableToolbar`; the dead `.rb-platform__filters` and
    `.rb-platform__inline-form` rules were removed.
  - **O4:** `updateUserStatus` refuses the acting administrator's own account (400) and any account holding an active
    platform grant unless the actor is SUPERADMIN (403), before anything is written or any session revoked. The user
    detail page shows the reason in place of the buttons. The recommended "last active superadmin" count was not
    added, with the reasoning recorded in the code: it cannot fire once self-targeting is refused.
  - **O10:** `retryWebhook` audits every attempt with the state read back from the event, rethrows a failure after
    auditing it, and returns `{ processed, state }`; the console says when another delivery may hold the claim.
  - **O11:** [suspension-policy.md](suspension-policy.md), drafted for ratification, linked from the runbook.
  - **6.3:** `uat-fixture-seed.service.ts`, `prisma/uat-fixtures.ts` and `npm run uat:fixtures` produce F3, F4, F6 and
    F7. Local and staging only: production refused with no override flag, a live Paystack key refused,
    `ALLOW_UAT_FIXTURES=true` required, and no console access created (it acts as an existing OPERATIONS/SUPERADMIN
    grant and refuses if none exists). Everything a service can do goes through that service, including the console's
    own audited plan assignment; only the two time-based values (trial remaining, trial expired) are written
    directly, with the reason in the code. Limits are read back from the organization's entitlements and compared
    with `OFFICIAL_PLAN_CATALOG`, so catalog drift fails the run. `PlatformTenantsService` is now exported from
    `PlatformModule` for this; no route authorization depends on that export.
  - **Checks, all green:** api + web typecheck; ESLint and Prettier on the touched files; web unit 34/34; integration
    `platform-operations` 6/6 (new O4 case), `billing-webhook-claim` 6/6 (new O10 case), regression
    `platform-authorization` 3/3 and `platform-audit` 1/1.
  - **Seeder run twice against the development database** (an API build was needed, as `db:seed` needs): same four
    organizations, no extra invoices or projects on the second run; 19/20 issued invoices with the usage counter on
    1 Oct – 1 Nov, 24/25 active projects, TRIALING ending in 24 h with no reminder sent, TRIAL_EXPIRED; four
    `platform.plan_assigned` audit rows per run. Results in [uat-plan.md §3](uat-plan.md).
  - **Not done:** no browser pass over the new overview panel or the user-detail refusal text (the API dev server and
    Chrome do not fit in the free memory on this machine alongside the containers; the panel is plain markup on
    existing primitives and the endpoint is covered by integration tests). **Staging UAT remains a release
    requirement** (O9), and O7 and O8 stay open.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus **Test (integration)**, mandatory before merge:
    authorization and billing audit behaviour changed.
- **2026-10-23**: [suspension-policy.md](suspension-policy.md) **ratified by the owner**. Its status line, the
  suspension runbook's first step and the release checklist now read as standing authority rather than a draft, so a
  G3–G5 suspension no longer needs a separate owner decision. Nothing in the code changed: the console still enforces
  only role ≥ OPERATIONS, a mandatory reason and a typed confirmation, and the authority split and the 30-day review
  remain procedural rules evidenced by the append-only audit log.
- **2026-10-23**: Owner decisions on **O5** and **O7**.
  - **O7 closed with no work:** country-pack publishing needs no second approver. `DRAFT → PUBLISHED → DEPRECATED`
    stays, and spec §12.2's `IN_REVIEW`/`APPROVED` states become a documented, accepted deviation. The existing
    controls (reason, identifier typed back, impact statement, append-only audit) are the whole control set.
  - **O5 decided and planned, not built:** administrators must be able to change pricing from the dashboard. Scope
    settled at the same time — full catalog including new tiers, existing subscribers repriced at next renewal, a
    single superadmin publishes, and the console calls Paystack. Written up as
    [plan-catalog-management-plan.md](plan-catalog-management-plan.md): the three constraints it has to solve
    (Paystack is the price of record for checkout, the public pricing page is compiled rather than fetched, and the
    DB == `OFFICIAL_PLAN_CATALOG` invariant has to be rebuilt rather than dropped), an eight-part work breakdown and
    the sequencing.
  - **One dependency blocks the design, not the decision:** whether Paystack can reprice a live subscription without
    new customer authorisation. It decides whether repricing is a background job or a customer-facing flow. To be
    answered against Paystack's API before anything in that phase is built.
  - **No code changed for either item.** Phase 7 is after this release; the current branch is unaffected.
- **2026-10-23**: Phase 7 started (O5), first slice: the price-change backend.
  - **§3 dependency resolved in ValueBooks' favour.** Paystack's `PUT /plan/:id_or_code` takes
    `update_existing_subscriptions`, which defaults to `true`, and reports how many subscriptions it affected. The
    owner's "reprice at next renewal" is Paystack's native behaviour, so the repricing job the plan budgeted for
    (§4.6) collapsed into one flag — which is now sent explicitly on every call rather than inherited from a provider
    default, because whether current subscribers are repriced is a commercial decision.
  - **Migration `20261023090000_admin_managed_plan_pricing`** (additive): `plan_price_changes`, with a partial unique
    index allowing one DRAFT per plan, and `plan_price_history`, seeded with the price every existing plan carries.
    `plan_price_history` is what keeps an old charge explainable once Paystack's plan holds the new amount. Drift
    clean against a shadow database.
  - **`PlanPricingService`:** propose → preview → publish → discard, plus a pricing read. Publishing updates Paystack
    first, reads the plan back, runs the existing `paystackPlanMismatches` check and stores the new price only once
    the provider agrees — so the surviving failure is Paystack ahead of ValueBooks, which leaves checkout working on
    the old price, not the reverse, which would stop every charge. Publication is conditional on the price the
    proposal was made against; a stale change is refused and flagged in the preview. An increase of more than 50%
    must be confirmed by repeating the figure.
  - **`updatePlan` was not relaxed.** Billing spec §20's refusal to reprice a plan in place still stands for ad-hoc
    edits; what phase 7 adds is a path where the repricing is not silent.
  - **Found and fixed while building:** `createPlan` wrote no opening price-history row, so a plan created after the
    migration would have had a price history starting at its first change. It now writes one in the same transaction,
    with a test.
  - **Checks, all green:** api typecheck; ESLint and Prettier on the touched files; new `platform-plan-pricing` 6/6
    (Paystack stubbed at `fetch`, nobody charged); regression `platform-authorization` 3/3 — which confirms the five
    new routes declare a guard and a role floor — `platform-audit` 1/1, `platform-plan-code` 5/5 and
    `plan-entitlements` 17/17.
  - **Not built:** the console flow, the public pricing page on live data (so a price change reaches checkout but the
    marketing page still shows the compiled figure), new tiers, entitlement versioning, the invariant rework and
    customer notice. **Still to confirm in Paystack test mode before any real price change:** that an increase on an
    existing mandate is charged without customer action in practice, not only per the documentation.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus **Test (integration)**, mandatory before merge
    (billing and authorization surfaces).
- **2026-10-23**: Phase 7 §4.8, live prices on the public pages, wired into the two marketing server pages.
  - The homepage teaser and `/pricing` call `fetchLivePlans()` and pass its result to the existing pricing components.
    The read uses the public catalog endpoint with a 300-second revalidation window. An unavailable or empty response
    falls back to the compiled approved prices. New tiers are still outside the four authored marketing cards.
  - **Checks observed green:** `apps/web` `npx tsc --noEmit` (exit 0) and `npx vitest run` (34/34, including
    `pricing-data.test.ts` 3/3). The two pages have not been exercised in a browser.
  - **Deferred to Jenkins:** full lint, typecheck and test; **Test (integration)** remains mandatory before merge for
    the broader Phase 7 billing and authorization changes.
- **2026-10-23**: Phase 7 §4.1, new-tier groundwork.
  - The Providers page now uses the four seeded tier keys plus active catalog tier keys, so a newly
    activated tier appears in coverage and a missing partner interval is visible without hiding a launch tier whose
    two rows are missing. A durable tier record must replace that temporary compiled baseline. The verified Paystack plan-code
    action now accepts any active Paystack plan, including a new tier, instead of only eight compiled keys.
  - **Checks observed green:** API `npx tsc --noEmit` (exit 0); targeted `platform-plan-code.int.test.ts` 6/6,
    including a new-tier coverage and verified-code case, with Paystack stubbed at `fetch`.
  - **Still open:** a controlled create/retire workflow, the published-catalog invariant, entitlement versioning,
    notice delivery, and console and marketing support for newly created tiers. Full checks remain with Jenkins;
    **Test (integration)** is mandatory before merge.
- **2026-10-23**: The owner chose 30 days' email notice for an increase affecting existing subscribers. Until a
  durable notice and delivery workflow exists, `PlanPricingService.publishPriceChange` now refuses **all increases**
  before calling Paystack, including a plan with no subscribers (which avoids a new-subscriber race between the
  count and provider call). The console disables publication of an increase and explains why. Reductions still
  publish with `update_existing_subscriptions: true` sent explicitly.
  - The console no longer marks a legitimately published price as drift from the compiled launch catalog; its
    yearly-savings figure is calculated from the current database prices. The public page still uses live prices.
  - Publishing a monthly reduction also checks that the active yearly price does not exceed twelve monthly
    payments, before Paystack is called.
  - **Checks observed green:** API and web `npx tsc --noEmit`; targeted `platform-plan-pricing.int.test.ts` 8/8,
    including both pre-Paystack refusals, with the provider stubbed; Impeccable detector `[]`.
  - **Still open:** build and verify the 30-day email notice path, then replace the temporary increase block with
    a durable, race-safe publication condition. Browser verification and full Jenkins checks remain outstanding.
- **2026-10-23**: O8 recurring journals recovery slice.
  - Journal posting's existing atomic idempotency key now serves as the occurrence claim. A retry after posting
    reads the same journal and advances the template once; concurrent triggers cannot create a second journal.
    The separate pre-post claim was removed for journals only. Invoices, bills and expenses still need a safe
    claim-to-document link and recovery path before O8 can close.
  - **Checks observed green:** API `npx tsc --noEmit`; targeted `recurring-journals.int.test.ts` 7/7, including
    simulated failure after posting and before template advancement. The first run caught and led to a fix for a
    null occurrence marker; the second exposed a test fixture that had not advanced its scheduler job. The final
    rerun passed. Full accounting integration checks remain mandatory before merge.
- **2026-10-23**: O8 invoice, bill and expense recovery slice.
  - A new occurrence claim and its draft now commit together, with the claim pointing at the
    document. Retrying after issue/post resumes that document and advances the template once.
    Existing template-only claims fail closed for manual reconciliation; see the
    [runbook](runbooks/recurring-claim-reconciliation.md). This avoids guessing whether an old
    claim created a financial document.
  - **Checks observed green:** API `npx tsc --noEmit`; targeted recurring invoice, bill and
    expense integration suites 28/28, then the invoice suite 9/9 after adding transaction
    rollback and old-claim refusal cases. Full Jenkins accounting checks remain mandatory.
- **2026-10-23**: O9 local nonpayment UAT drill — **passed 4/4 in a browser**, the first browser run of these
  four scenarios and therefore the first verification of the spec's own selectors.
  - `platform-uat-nonpayment.spec.ts --project=desktop` against isolated `valuebooks_e2e`: F3/F4 as distinct trial
    states in the console (6.3s), F4 reads customers and billing while a tenant write is refused 403
    `SUBSCRIPTION_READ_ONLY` (4.3s), F6 issues invoice 20 and the 21st is refused 403 `PLAN_LIMIT_REACHED`
    `invoices.issued.max` limit 20 (4.0s), F7 creates project 25 and the 26th is refused 403 `PLAN_LIMIT_REACHED`
    `projects.enabled` limit 25 (3.8s). Fixtures seeded at F6 19/20 and F7 24/25.
  - **Fix that unblocked it:** the opt-in `seedUatCatalog()` call in `apps/web/e2e/prepare.mjs` moved from just
    after `resetDatabase()` into the `ALLOW_UAT_FIXTURES` block, after the ordinary demo seed and before the fixture
    seeder. Restoring the catalog first made the demo tenant resolve to a tier without `approval_workflows.enabled`,
    so the demo seed's `approvals.createPolicy` step failed with `PLAN_LIMIT_REACHED` — D2's Advanced-only gate
    behaving correctly against a tenant the demo seed assumes is ungated. The demo seed again runs with the catalog
    absent and logs its existing D7 message that no cardless trial was started.
  - **Paystack was not contacted.** `PAYSTACK_SECRET_KEY=sk_test_local_nonpayment_drill` was passed only to keep the
    live key in the root `.env` out of reach; these scenarios make no provider call, and the API and seeds ran with
    cwd `apps/api`, whose `.env` holds no Paystack key.
  - **Two environment findings, recorded in [uat-plan.md §4a](uat-plan.md):** (1) `next build` aborts once with
    `SecurityFatalError` and, because Playwright starts both web servers in parallel, that abort killed two whole
    runs before the API prepare finished; the drill was run against a hand-started stack with
    `PLAYWRIGHT_BASE_URL`. **No Next.js upgrade was performed; the security-upgrade recommendation stands.**
    (2) A failed `next build` leaves the standalone `.next/static` empty, so every chunk 404s, the login page never
    hydrates and Sign in does nothing — this produced two identical false failures before it was diagnosed;
    `copy-standalone-static.mjs` plus a server restart fixes it.
  - **The drill is one-shot per database reset:** it leaves F6 at 20/20 and F7 at 25/25, and the seeder only tops a
    fixture up, never down, so a rerun needs the full prepare step.
  - **Not run:** F1, F2, F12–F16 in a browser, and the 1440/1024/390 viewport and keyboard sweep. **F5, F8–F11 are
    untested, not passed** — payment scenarios deferred by the owner.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus **Test (integration)**, still mandatory before merge.
    This drill changed only an E2E preparation script; no application code was touched.
- **2026-10-23**: Phase 7 §4.7, the durable 30-day price-increase notice (O5). **The interim blanket refusal of
  every increase is removed**, replaced by the owner's condition enforced per subscriber.
  - **No schema change.** The notice reuses the existing `billing_notices` ledger, already unique on
    `(organizationId, eventKey, sourceId)`: event key `billing.plan_price_increase_notice`, source the price-change
    id. "Has this subscriber been told, and when?" is answered by the same durable row that recorded the email.
  - New `POST platform/plans/:planId/price-changes/:changeId/notice` (SUPERADMIN) notifies every live mandate
    (`ACTIVE`, `PAST_DUE`, `CANCEL_SCHEDULED`); trials are not notified because they are not being charged. It is
    idempotent and never restarts an existing subscriber's 30 days, so a top-up after new signups notifies only the
    newcomers and publication waits on the newest notice. The clock runs from `queuedAt`, so a failed send starts
    nobody's period.
  - Publication of an increase is refused **before Paystack is contacted** while anybody is unnotified or still
    inside the window, and the refusal names which. A subscriber with neither a billing contact nor an owner email
    can never be covered, so it is reported as `withoutDeliverableAddress` rather than leaving an unexplained
    permanent refusal.
  - `update_existing_subscriptions` stays explicit on every call and now carries the decision: `true` for a
    notified increase or any reduction, `false` for an increase on a plan with no live mandate — which also closes
    the last race, since a customer subscribing between the notice check and the provider call keeps the old price
    instead of being raised without notice.
  - **Deliberate consequence, stated rather than hidden:** a plan taking a steady stream of new subscribers will
    keep deferring an increase until the operator stops topping up and lets the window close. Fail-closed was
    chosen over repricing somebody who was never told.
  - Console: the publish dialog states the notice position and disables confirmation while the condition fails; a
    **Send notice** action appears beside *Review and publish* for a pending increase and reports what it queued,
    who is now covered, the earliest publication date and anybody it could not reach. Built from the existing
    shared `AdminActionDialog`, `Button` and `rb-platform__alert`; no new component or token.
  - **Checks observed green:** API and web `npx tsc --noEmit` (exit 0); `platform-plan-pricing.int.test.ts`
    **13/13** with Paystack stubbed at `fetch` and nobody charged (refusal while unnotified; the ledger row and its
    copy; idempotency; both audit rows; one day short of 30; publication at 31 days with
    `update_existing_subscriptions: true`; a latecomer re-refusing publication; an undeliverable subscriber; the
    no-subscriber case publishing with `false`; the SUPERADMIN floor); `platform-authorization.int.test.ts` 3/3,
    which discovers routes dynamically and so confirms the new endpoint declares a guard and a role floor; regression
    `platform-audit` 1/1, `platform-plan-code` 6/6 and `plan-entitlements` 17/17; web unit 34/34.
  - **One failure found and fixed during the run**, in the new spec rather than the code: it proposed a reduction
    against the deliberately code-less Growth fixture, which the service refuses by design. The other 12 cases
    passed on the first run.
  - **A four-file integration invocation crashed** with `ERR_IPC_CHANNEL_CLOSED` and produced no results; the files
    were rerun one at a time. That was an infrastructure failure, not a test result.
  - **Formatting:** Prettier flags every file touched here, but each already had CRLF line endings at HEAD and
    fails `--check` unchanged, so they were not reformatted (whole-file churn). Untouched LF files pass.
  - **Not done:** a browser pass over the new console flow, and confirming in Paystack **test mode** that an
    increase on an existing mandate is charged without customer action in practice. Phase 7 stays open: new tiers,
    entitlement versioning, catalog invariants and the public presentation of new tiers remain.
  - **Deferred to Jenkins:** full lint, typecheck and test, plus **Test (integration)**, mandatory before merge
    (billing and authorization surfaces).
- **2026-10-23**: Reviewed every row and added the **Still open** section above, so the pending work and the items
  that need the owner are in one place instead of spread across row evidence and the progress log.
  - Pending engineering: Phase 7 §4.1 new tiers, §4.2 catalog governance, §4.3 entitlement versioning, a browser
    pass over the §4.5/§4.8 flows, and the remaining 6.3 UAT fixtures with the viewport and keyboard sweep.
  - Needs the owner: the production catalog check (1.0/O3), the production legacy recurring-claim check (O8), the
    production dropped-renewals report run (O6), and where the Paystack **test-mode** keys live.
  - **New open item O12**, found while listing the work rather than by a test: `platform-billing-overview.tsx`
    loads `billing/overview` (SUPPORT floor) and `billing/revenue` (OPERATIONS floor) in one `Promise.all`, so the
    expected 403 on revenue fails the whole page for a SUPPORT operator — the one role whose entire job is
    read-only investigation. It predates 4.3 and is not caused by this branch, so whether to fix it here is a scope
    decision. Verified still present in the current code; no change made.
  - No code was changed by this review.
