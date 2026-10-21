# Billing/Subscriptions implementation — handover

Written for: whoever picks up migrations, full test runs, and the remaining build-out for the
ValueBooks subscription/billing system (`VALUEBOOKS_BILLING_MASTER_UPDATED.md` is the authoritative
spec this work implements).

> Provider consolidation update (2026-10-16): Paystack is now the sole active payment provider.
> Older Paddle references below describe the retired implementation only; historical database rows
> remain for audit and reconciliation and are not active checkout or webhook configuration.

## 1. Run this first

```bash
docker compose up -d                                   # postgres/redis/mailpit/minio/clamav
npm run db:deploy --workspace @valuebooks/api           # applies 3 new migrations below
npm run db:generate --workspace @valuebooks/api
npm run typecheck --workspace apps/api
npm run typecheck --workspace apps/web
npm run lint
npm test --workspace apps/api                           # fast, DB-free unit suite
npm run test:integration --workspace apps/api           # real API against Postgres
npm run build --workspace apps/web
```

A concurrent process (looked like a Codex runtime, `Get-Process node` showed several) was holding
a file lock on `node_modules/.prisma/client/query_engine-windows.dll.node` for part of my session,
which made `prisma generate` intermittently fail with `EPERM`. If you hit that, close whatever
else is touching this repo first, or just retry — it's a Windows file-lock race, not a code
problem (confirmed by running `tsc --noEmit` directly, bypassing the `pretypecheck` hook, which
came back clean throughout).

**`test:integration` found a real bug, which I then fixed — re-run is needed to confirm the fix is
complete.** First run: 176 failed / 316 passed. Every failure trace I could inspect
(`ForbiddenException` out of `UsageMeteringService.assertWithinConcurrentLimit` /
`CustomersService.create`) was the same root cause: `UsageMeteringService.resolveLimit` treated
"this organization has no subscription row at all" the same as "this entitlement is explicitly
disabled" and returned a limit of `0` — silently blocking customer creation (and would have
blocked invoice issuance too) for *any* organization without a subscription, which is the normal
case for most test fixtures and for every real organization that predates this feature. Fixed in
`usage-metering.service.ts`: a missing subscription now resolves to `null` (not enforced), the
same "fail open on missing data" behavior `EntitlementsService.forOrganization` already uses.
Typecheck is clean after the fix, but **I have not re-run the full integration suite since fixing
it** — please run `npm run test:integration --workspace apps/api` fresh and confirm it's green
before trusting anything else in this list. The output buffer I could see only retained the last
~150 lines of a 15-minute run, so I can't rule out a second, different failure cause earlier in
the run that scrolled out of view — if the re-run isn't fully green, check for unrelated causes
too, not just this one.

**Other likely blast-radius areas if anything is still red:**
- `test/platform-resolution.int.test.ts` — I touched this (see §4) because `organizations.finalize()`
  now auto-creates a trial subscription; grep the suite for other tests that call
  `organizations.finalize()` and then assert something about `organization_subscriptions` — I did
  not find any others, but I did not read every integration test file.
- Anything under `apps/api/test/*.int.test.ts` touching `Plan`, `OrganizationSubscription`,
  invoice issuance, or customer creation (I added quota checks to both — see §3).

## 2. What's actually running vs. scaffolded

Reuse-first, per the spec's own instruction and `AGENTS.md`'s Design System First rule — I
extended existing Phase-12 scaffolding (`Plan`/`PlanEntitlement`/`OrganizationSubscription`,
`BillingService`, `EntitlementsService`, the platform Plans admin page) rather than building a
parallel system.

**Built and verified (typecheck + lint + a manual boot of the API + a direct Prisma query against
the seeded catalog):**
- Schema: `BillingTransaction`, `UsageCounter`, `BillingWebhookEvent`, `SubscriptionChange` models;
  provider/tier columns on `Plan` and `OrganizationSubscription`; new `SubscriptionStatus` values
  (`TRIAL_EXPIRED`, `CANCEL_SCHEDULED`). Three migrations:
  `20261014065845_add_billing_providers_transactions_usage`,
  `20261014070000_seed_official_plan_catalog`, `20261014070239_add_subscription_intended_plan`.
- The official 8-row plan catalog (4 tiers × monthly/yearly) with the approved prices and a
  machine-enforceable entitlement matrix, replacing the Phase-12 `free`/`growth`/`scale`
  placeholders (retired, not deleted — zero live subscribers referenced them, verified before
  retiring).
- 14-day cardless trial on signup: `organizations.finalize()` now starts a `TRIALING` subscription
  on the Professional plan (trial always carries Professional entitlements per spec §6) and
  remembers the customer's actual selection on `intendedPlanId`.
- Day-13 reminder email + exact-boundary expiry, as two one-shot `ScheduledJob`s dispatched through
  the existing `AutomationWorker`/`SchedulerService` (not a new cron mechanism). Email copy is
  verbatim from spec §6.1, sent through a new `BillingMailerService` following the
  `AuthMailerService` convention.
- `UsageMeteringService`: real quota enforcement, wired into **two** call sites as a concrete,
  tested pattern — invoice issuance (`invoices.issued.max`, counted inside the issuance
  transaction, immune to the idempotent-replay path) and customer creation
  (`customers.active.max`, a live-count check since archived customers legitimately free up the
  cap). Every other quota in the entitlement matrix (seats, expenses, vendors, bills, POs,
  products, bank accounts, warehouses, projects, reports, AI insights) has **data** but **no
  enforcement call site yet** — see §3.
- `PaddleBillingAdapter`/`PaystackBillingAdapter`: real REST calls (no SDK dependency) against each
  provider's documented API shape — checkout creation, subscription lookup, cancellation,
  signature-verified webhooks (Paddle HMAC-SHA256 over `ts:body`, Paystack HMAC-SHA512 over the raw
  body). **Untested against a live sandbox** — I have no credentials. `rawBody: true` is now set on
  the Nest app (`main.ts` and the test harness) so signature verification hashes the actual bytes
  the provider signed.
- `BillingWebhookController`/`BillingWebhookService`: records every webhook
  (`RECEIVED`→`VERIFIED`→`PROCESSED`/`FAILED`), deduplicates on `(provider, providerEventId)`,
  applies successful-payment/subscription-status events to `OrganizationSubscription` +
  `BillingTransaction`. Event-type coverage is pragmatic, not exhaustive — see §3.
- Fixed a **pre-existing bug** unrelated to this feature but blocking it: `BillingService.publicPlans()`
  returned a raw `BigInt` (`priceMinor`) straight into the HTTP response, which NestJS's JSON
  serializer cannot handle at all (not even for zero) — `GET /billing/plans` was silently broken
  before my seed migration made it matter. Fixed by stringifying, same convention `createIntent`
  already used elsewhere in that file.
- Added a repricing guard to `PlatformCatalogService.updatePlan`: editing price/interval/currency
  on a plan with live subscribers is now rejected (spec §20 "never silently reprice current
  subscribers"), where previously it was allowed.
- Public pricing page (`pricing-data.ts`/`pricing.tsx`) reconciled to the approved prices, features,
  and "Start Free Trial" CTA on all four cards (Advanced previously overrode this to "Talk to
  sales" — removed). Added the yearly-savings badge per card and the pricing-page FAQ (spec §10).
  **Found and fixed a live integration bug this same pass would have shipped**: the card's signup
  button posted `planKey: plan.id` (e.g. `"starter"`), but the real catalog's keys are
  `"starter_monthly"`/`"starter_yearly"` — fixed to send `` `${plan.id}_${interval}` ``.

**Explicitly NOT done — pending, in spec order:**
1. **Numeric quota enforcement beyond invoices/customers.** `UsageMeteringService` is generic
   (`assertWithinLimit`/`assertWithinConcurrentLimit`/`increment`); wiring the remaining ~12
   resources is mechanical but untouched. Check each call site against whether the resource is a
   monthly flow (use `assertWithinLimit` + `increment` inside the creating transaction) or a
   standing cap (use `assertWithinConcurrentLimit` with a live count, like customers).
2. **Checkout UI wiring beyond the raw `checkout()` service call.** `BillingService.checkout()`
   will call the real adapter once a plan has `billingProvider`+`providerProductId`+
   `providerPriceId` set (currently all null — no sandbox credentials) **and** the caller passes
   `successUrl`/`cancelUrl`; the web signup flow (`checkout-client.tsx`) was not updated to pass
   those or to redirect to `checkoutUrl`. Until credentials exist this is moot, but the frontend
   change is real work once they do.
3. **Upgrade/downgrade/migration flows (spec §8).** `SubscriptionChange` model exists; no service
   logic reads or writes it yet.
4. **Customer-facing Settings → Billing & Subscription page (spec §9).** Does not exist. No
   backend endpoint for it either (current `/billing/*` routes are signup-flow only). Needs an
   org-scoped controller (`organizations/:organizationId/billing/...`, `OrganizationGuard` +
   `@RequirePermission('organization.view')` is the cheapest honest gate — there is no dedicated
   `billing.view` permission in `permission-catalog.ts` yet, and adding one means a role-grants
   migration I did not want to start under time pressure) plus a page under `apps/web/src/app/settings/billing`,
   added to `settings-navigation.ts`.
5. **The other 8 Platform Admin Billing pages (spec §17-28)**: Overview KPIs, Subscriptions
   list/detail, Transactions, Trials administration, Revenue Analytics, Refunds, Payment Providers
   diagnostics, Webhook console, Billing Audit Logs. `PlatformCatalogService`/`platform-catalog.tsx`
   (Plans & Pricing) now returns the new provider/tier columns and has a DTO/validation path to
   edit them, but the admin **page** doesn't render them yet (it's still the card-grid view from
   before this pass). None of the other 8 pages or their backing endpoints exist.
6. **Failed-payment dunning, reconciliation job, entitlement overrides, internal admin alerts**
   (spec §12/15/30/34) — none built.
7. **Read-only enforcement at trial/subscription expiry** (spec §6.3/12). `TRIAL_EXPIRED` is a real
   status the scheduled job sets, but nothing currently checks it to block writes. I deliberately
   did not retrofit this into the shared `OrganizationGuard` (which gates almost every tenant
   route) without being able to run the full test suite myself first — that's a correct,
   centralized place to put it, but it's also the highest-blast-radius change in this whole spec,
   and I did not want to land it unverified.
8. **Legal/tax copy, FX-rate-sourced currency reporting, Paddle/Paystack production approval
   gates** — all explicitly deferred by the spec itself pending real merchant approval; nothing to
   do here yet beyond what's in `.env.example`.

## 3. Files touched, for review

```
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/20261014065845_add_billing_providers_transactions_usage/
apps/api/prisma/migrations/20261014070000_seed_official_plan_catalog/
apps/api/prisma/migrations/20261014070239_add_subscription_intended_plan/
apps/api/src/billing/*                         (new: billing-provider.ts, paddle-billing.adapter.ts,
                                                 paystack-billing.adapter.ts, billing-webhook.*,
                                                 usage-metering.service.ts, trial-lifecycle.service.ts,
                                                 billing-mailer.service.ts; edited: billing.service.ts,
                                                 billing.controller.ts, billing.module.ts)
apps/api/src/organizations/organization.service.ts   (trial creation on finalize)
apps/api/src/organizations/organizations.module.ts    (forwardRef(BillingModule))
apps/api/src/automation/automation.module.ts           (forwardRef(BillingModule))
apps/api/src/automation/automation-worker.module.ts    (TrialLifecycleService wiring)
apps/api/src/automation/automation.worker.ts           (dispatch billing.trial_reminder/expired)
apps/api/src/sales/sales.module.ts, invoices.service.ts, customers.service.ts   (quota checks)
apps/api/src/platform/platform.dto.ts, platform-catalog.service.ts   (plan provider/tier fields)
apps/api/src/jobs/email-job.ts                         (new email job name)
apps/api/src/main.ts, apps/api/test/support/app.ts     (rawBody: true)
apps/api/test/platform-resolution.int.test.ts          (adapted to the new auto-trial behavior)
apps/web/src/components/marketing/pricing-data.ts, pricing.tsx, pricing-section.tsx
apps/web/src/app/(marketing)/marketing-additions.css   (pricing savings-badge styles)
.env.example                                            (PADDLE_*/PAYSTACK_*/BILLING_TRIAL_* vars)
```

## 4. One thing worth knowing about the dev environment

During this session, two other local sessions on this same repo (`valuebooks-9b`, `valuebooks-d0`
per the session list) committed and merged work I did not initiate — a commit titled "Standardize
ValueBooks marketing and forms" and a merge "Resolve base branch conflicts" landed mid-session,
and `node_modules/.prisma` was still lock-contended by what looked like a Codex runtime process at
the end. None of that is this handover's doing, but it means the branch history has moves from more
than one actor — `git log --oneline -15` before you start, so you know what you're building on.
