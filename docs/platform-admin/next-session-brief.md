# Next session brief — remaining Platform Admin work

**Written 23 Oct 2026** for the agent or engineer who picks up `feat/platform-admin-commercial-correctness` next.
This is a working brief, not a status record: the authoritative status is the **Still open** section of
[implementation-backlog.md](implementation-backlog.md), and items are referred to here by the letters A–L used
there. Two owner decisions are embedded below and marked **ASK**, because they change what gets built.

Continue the ValueBooks Platform Admin redesign in:
`C:\Users\gmnyo\Desktop\Engineering projects\ValueBooks`
Branch: `feat/platform-admin-commercial-correctness`

Read `AGENTS.md` and [implementation-backlog.md](implementation-backlog.md) first.

## Hard rules for this session

1. **CODE CHANGES ONLY. Do not run tests, builds, browser runs, `prisma generate`, `prisma migrate dev`, or
   typechecks.** Write the code, then STOP and report what changed and what needs verifying. The owner approves
   before anything is executed. A consequence to accept: new Prisma models will show as type errors in the editor
   until `prisma generate` runs after approval — do not "fix" that by hand-writing types.
2. Preserve the existing uncommitted work. Do not commit, stash, reset, or touch unrelated files. The tree already
   contains generated/temporary files (`apps/web/next-env.d.ts`, `.freebuff/`, `apps/web/AGENTS.md`, `.tmp-*.png`)
   — leave them.
3. **Design System First** (`AGENTS.md` §1). Reuse `packages/ui`, the shared `DataTable`, `AdminActionDialog`,
   `Button`, `Badge`, `PlatformPage`, and the existing `rb-platform__*` tokens in `apps/web/src/app/styles.css`.
   Do not invent tokens or page-local patterns.
4. Migrations are **additive only**, hand-authored SQL in a new timestamped folder matching the existing convention
   under `apps/api/prisma/migrations/`, kept in step with `schema.prisma`. Backfill in the same migration. Never
   edit an applied migration.
5. Never use the live Paystack configuration. The repository root `.env` holds a **live** key; `apps/api/.env` holds
   none. Anything that could reach Paystack must be stubbed at `fetch`.
6. Do not reformat files Prettier already flags: the files in scope carry CRLF line endings at HEAD and fail
   `--check` unchanged. Reformatting creates whole-file churn.
7. Do not weaken any existing guard, role floor, invariant, or test to make new work fit.

## Already done — do not redo

- **O5 §4.7: the durable 30-day price-increase notice is built and enforced.** It reuses the `billing_notices`
  ledger (unique on `organizationId + eventKey + sourceId`, event key `billing.plan_price_increase_notice`, source
  = the price-change id). The clock runs from `queuedAt`.
  `POST platform/plans/:planId/price-changes/:changeId/notice` (SUPERADMIN) sends and tops up. Publication of an
  increase is refused before Paystack while anyone is unnotified or still inside the window.
  `update_existing_subscriptions` is always explicit. The blanket block on increases is gone.
  `platform-plan-pricing.int.test.ts` passed 13/13.
- **O8** recovery for journals, invoices, bills and expenses.
- **O9** nonpayment drill F3/F4/F6/F7 passed 4/4 in a browser.

## Build in this order

### Item 1 — O12 (tracker row J). ONLY IF THE OWNER HAS SAID YES.

If there is no explicit yes, skip this and say so.

`apps/web/src/components/platform-billing-overview.tsx` loads `billing/overview` (SUPPORT floor) and
`billing/revenue` (OPERATIONS floor) in one `Promise.all`, so the expected 403 on revenue fails the entire page for
a SUPPORT operator — the one role whose whole job is read-only investigation.

Settle the two reads independently (`Promise.allSettled`). Render the page from `overview`; omit the revenue card
when that read was refused, with copy saying revenue needs a higher role — not an error, and not a zero. Keep the
existing `ErrorState` for a genuine load failure, so "refused for your role", "failed to load" and "a true zero"
stay three visibly different things. **Do not change any API role floor.**

### Item 2 — E / §4.1: tiers as data, with a create and retire workflow

Today `Plan.tierKey` is a bare `VarChar(40)` and the set of tiers that *exist* is the compiled
`OFFICIAL_PLAN_TIERS` in `packages/contracts/src/index.ts`. The Providers page currently unions four seeded tier
keys with active catalog tier keys as a temporary compiled baseline. Replace that baseline with a durable record.

Add a `PlanTier` model: `key` (unique, `VarChar(40)`), `name`, `description?`, `sortOrder`,
`status` (`DRAFT | ACTIVE | RETIRED`), `isMostPopular`, timestamps, plus the marketing fields in Item 5. Point
`Plan.tierKey` at it by relation. The migration creates the table, backfills one row per existing distinct
`tier_key` (ACTIVE, with the current `is_most_popular` folded up from the plan rows), then adds the FK.

In `apps/api/src/platform/platform-catalog.service.ts`, add SUPERADMIN-only, reason-required, audited
(`writePlatformAudit`) operations:

- `createTier` — creates it `DRAFT`. A DRAFT tier is invisible to customers and unassignable.
- `activateTier` — refuses unless the tier has exactly one ACTIVE `MONTHLY` and one ACTIVE `YEARLY` plan, each with
  a Paystack code and `billingProvider: 'PAYSTACK'`, and a complete entitlement set. This is the invariant that
  stops a half-built tier reaching the pricing page.
- `retireTier` — refuses while any subscription in a non-terminal state (`TRIALING`, `ACTIVE`, `PAST_DUE`,
  `CANCEL_SCHEDULED`) references a plan in that tier, naming how many. On success, retires the tier and its plans.
  Retiring must never touch an existing subscriber's entitlements.

Then make `providers()` and the plan-code coverage read ACTIVE `PlanTier` rows instead of the compiled baseline, so
a new tier shows up and a missing interval is visible.

### Item 3 — F / §4.2: catalog invariants and governance

`OFFICIAL_PLAN_CATALOG` must stay in `packages/contracts` — it is the owner-approved launch definition and
`plan-entitlements.int.test.ts` asserts the database matches it. What changes is its role: the **database becomes
the source of truth for what is sold today**, and the constant becomes the launch baseline that drift is reported
against.

Write one service that evaluates the whole catalog and returns a list of named violations:

- every ACTIVE tier has exactly one ACTIVE MONTHLY and one ACTIVE YEARLY plan;
- every ACTIVE plan has a Paystack code, unique across plans, provider `PAYSTACK`;
- for each tier, the yearly price is at most twelve monthly payments;
- at most one ACTIVE plan `isDefault`; at most one ACTIVE tier `isMostPopular`;
- every ACTIVE plan carries every `OFFICIAL_ENTITLEMENT_KEYS` entry;
- no ACTIVE plan has `priceMinor` 0;
- drift from `OFFICIAL_PLAN_CATALOG` **entitlements** for the four launch tiers, reported separately from prices.

Prices must **not** be treated as drift — administrators now change them legitimately (§4.7). When you touch
`plan-entitlements.int.test.ts`, scope its equality assertion to entitlements and provider fields rather than
prices, and say so in the tracker.

Refuse `activateTier`, plan activation and price publication when the operation would create a violation, checked
before Paystack is contacted. Surface the violations in the console as a "Catalog health" panel on the Plans &
pricing page, reusing the shared `DataTable` + `Badge` exactly as the Providers coverage table does. An empty list
must read as "no violations", never as a blank.

### Item 4 — G / §4.3: entitlement versioning

**ASK THE OWNER BEFORE BUILDING THIS.** The question: when an administrator changes what a plan includes, does that
apply to existing subscribers **at their next renewal** (consistent with the O5 pricing decision) or
**immediately**? Do not guess — it decides the model's pinning behaviour. State the recommendation: at next
renewal, matching O5, because an entitlement cut is commercially the same act as a price rise. Stop and ask; build
the other items meanwhile.

Problem being solved: changing entitlements today mutates `PlanEntitlement` rows in place, silently changing what
existing subscribers were sold.

Recommended shape, assuming "next renewal":

- `PlanEntitlementVersion` (planId, version int, status, publishedAt, publishedByPlatformAdminId, reason) with
  `@@unique([planId, version])`, and `PlanEntitlementValue` (versionId, key, enabled, limitValue) with
  `@@unique([versionId, key])`.
- `OrganizationSubscription.entitlementVersionId` (nullable) pins a subscriber to the version they bought. Null
  means "the plan's current published version", which is what every existing row means today — so the migration
  backfills nothing and changes no behaviour.
- Keep `PlanEntitlement` as the live projection of the current published version, so the many existing reads keep
  working. Change only the resolution paths: `resolveLimit` in `apps/api/src/billing/usage-metering.service.ts`
  and `apps/api/src/platform/entitlements.service.ts` read the pinned version when present.
- Publishing a version: SUPERADMIN, reason required, audited, with a preview stating how many subscribers stay on
  the old version and when they move. Pin existing subscribers at publish time; clear the pin at renewal so they
  pick up the current version.

This is the riskiest item in the phase. Keep it in its own slice and do not mix it with Item 5.

### Item 5 — E/H: console and public presentation of new tiers

- `apps/web/src/components/platform-plan-catalog.tsx` currently renders the compiled tiers. Make it render
  `PlanTier` rows (ACTIVE and DRAFT, DRAFT clearly marked), with the create/activate/retire actions from Item 2 via
  `AdminActionDialog`, each with its required reason and a typed confirmation where it is destructive, following
  the existing Paystack-code and price-change dialogs.
- Public pages: `apps/web/src/components/marketing/pricing-data.ts` authors qualitative copy for the four launch
  tiers, and `live-prices.ts` falls back to `OFFICIAL_PLAN_CATALOG`. For a new tier to appear on `/pricing` without
  a deploy, the tier record must carry its own marketing copy: add `tagline` and a small ordered list of highlight
  bullets to `PlanTier`, expose them on the public catalog endpoint, and have the pricing components prefer DB copy
  and fall back to the authored copy for the four launch tiers. A tier with no copy must still render a correct,
  plain card from its real prices and limits — never a card with placeholder text.
- Marketing typography and animation stay on the marketing site; do not carry them into the console (`AGENTS.md`).

### Item 6 — I/H: write the remaining browser specs (do not run them)

Write the code only. Running comes after approval.

- Extend `apps/web/e2e/` with the remaining UAT fixtures: F1 (user with no membership), F2 (partly onboarded
  organization), F12 (cancel at period end), F13 (suspended tenant), F14 (immutable published tax pack), F15
  (failed email job), F16 (repeated failed sign-ins). F13/F14 are partly covered by `phase12-platform.spec.ts` —
  extend rather than duplicate.
- Add the viewport sweep (the config already has `desktop`, `tablet` and `mobile` projects) and a keyboard-only
  pass: Tab reaches every control, Escape closes drawers and dialogs.
- Add a console spec for the price-change and notice flow: propose, send notice, publication refused while inside
  the window. The 30-day elapse cannot be reached in a browser; age the `billing_notices.queuedAt` rows directly
  from the spec, as `platform-plan-pricing.int.test.ts` does.
- F15 needs SMTP pointed at an invalid host; do it per-spec, never by editing a shared `.env`.
- Mirror the opt-in gate the existing UAT spec uses (`ALLOW_UAT_FIXTURES`, desktop-only for mutating drills) so
  ordinary E2E runs are unaffected.

## Then stop

Report, per item: files changed, the design decisions made and why, anything you could not do, and the exact checks
you believe are needed. Update [implementation-backlog.md](implementation-backlog.md) — the **Still open** section
and a progress-log entry — stating plainly that **nothing has been executed yet**. Never write a number you have
not observed; "not run" is the correct entry.

## After the owner approves — verification, in this order

Known traps, all previously observed on this machine:

- Integration specs run **one file at a time**. A four-file invocation died with `ERR_IPC_CHANNEL_CLOSED` and
  produced no results.
- `npx vitest run test/foo.int.test.ts` silently matches nothing; integration specs need
  `--config vitest.integration.config.ts`.
- `next build` aborts once with `SecurityFatalError` (a Next.js security-upgrade recommendation) and continues on
  retry. Playwright starts both web servers in parallel, so that abort kills a whole E2E run before the API prepare
  finishes. Build the web app standalone first, then run Playwright against a hand-started stack with
  `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3300`.
- A failed `next build` leaves `.next/standalone/apps/web/.next/static` empty; every chunk 404s, the login page
  never hydrates, and clicks do nothing — which looks exactly like a bad selector. Fix with
  `node scripts/copy-standalone-static.mjs` **and then restart the web server**.
- The nonpayment UAT drill is one-shot per database reset: it leaves F6 at 20/20 and F7 at 25/25, and the seeder
  only tops up. Re-run the whole prepare step, never the spec alone.

Order: `npx prisma generate` → `npx tsc --noEmit` in `apps/api`, `apps/web` and `packages/contracts` → ESLint on
the touched files → migration drift (`prisma migrate diff --exit-code` against a shadow database) → the focused
integration specs one at a time (`platform-plan-pricing`, `platform-authorization`, `platform-audit`,
`plan-entitlements`, `platform-plan-code`, plus whatever your changes touch — entitlement versioning must be
covered by a usage-enforcement spec proving an existing subscriber's limit does not move) → web unit → the browser
specs last.

Full lint/typecheck/test and Jenkins **Test (integration)** stay mandatory before merge (billing, authorization and
accounting surfaces). Do not claim a check passed unless you watched it pass.

## Do not attempt — these need the owner

- **A:** the read-only production catalog check (1.0/O3).
- **B:** the production legacy recurring-claim check (O8).
- **C:** the production dropped-renewals report run (O6).
- **D:** the location of the Paystack **test-mode** keys, which blocks UAT F5 and F8–F11 and confirming that an
  increase actually charges an existing mandate.

Also the owner's call: whether to run the Next.js security upgrade.
