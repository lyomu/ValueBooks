# P0 Handover — Restoring the Release Gate

**Written:** 2026-10-10 · **Branch:** `chore/verification-closure` · **Status:** in progress, nothing
committed yet

This picks up the P0 tier of `docs/PENDING_WORK.md` (items 1–6). Read this before touching any of
them: most of the work is already done and verified, and several failures that look like new bugs
were already diagnosed and fixed. Don't redo them.

## Where things stand

| #   | Item                  | State                                                                            |
| --- | --------------------- | -------------------------------------------------------------------------------- |
| 1   | Lint errors           | **Done.** `npm run lint` exits 0 with 0 warnings.                                |
| 2   | Formatting            | **Done.** `npm run format:check` passes.                                         |
| 3   | Web production build  | **Done.** `npm run build --workspace @valuebooks/web` passes.                    |
| 4   | Integration suite     | **Done.** 458/458 tests, 66/66 files (see the `AI_MODE` note below).             |
| 5   | Playwright E2E        | **Mostly done.** Last run: 38 passed, 10 failed; 3 functional, 7 visual.         |
| 6   | Visual baselines      | **Not done.** Diffs reviewed for two pages; baselines not yet updated.           |
| —   | Tracker/docs + commit | **Not done.** `PENDING_WORK.md` boxes are still unchecked. Nothing is committed. |

Typecheck and unit tests (260/260) also pass after all the changes below.

## Uncommitted changes — keep them

There are 29 modified files plus 2 new ones (`apps/web/e2e/lib/rate-limits.ts`,
`docs/PENDING_WORK.md`). All of them are intentional. Do **not** `git checkout` or reset them. The
marketing-page files under `apps/web/src/app/(marketing)/` and
`apps/web/src/components/marketing/` changed only from `npm run format` (item 2).

## What was fixed, and why

### Product bugs (real defects, not just tests)

1. **The background worker crashed on every start.** `apps/api/src/worker-app.module.ts` never
   imported `DatabaseModule`. It is `@Global()`, but that only applies once a root module imports
   it, so `DomainEventsService` couldn't get `PrismaService`. As a result no document extraction,
   automation or scheduled job ran outside the API process. Fixed by importing it; the worker now
   boots cleanly (verified by starting `node dist/src/worker.js`).
2. **Users landed on the marketing homepage instead of their workspace.** `/` is now the
   marketing site, but two components still sent users there: `onboarding-wizard.tsx` (after
   "Finish setup") and `organization-switcher.tsx` (after switching organization). Both now go to
   `/dashboard`.
3. **On phones the portal scrolled sideways by 9px.** A screen-reader-only label
   (`.rb-visually-hidden`, `position: absolute`) in a portal table header escaped its scroll
   container because `.rb-portal__table-wrap` wasn't positioned. Fixed with `position: relative`
   in `apps/web/src/app/styles.css`. **Follow-up:** about ten other `overflow-x: auto` scrollers
   in that file have the same latent pattern; only the portal one was proven and fixed.
4. **The demo seed failed partway through** (`apps/api/src/demo-week-seed.service.ts`):
   - The "accepted" quote used the `no-email` customer, but reaching ACCEPTED means calling
     `quotes.send()`, which requires an email. It now uses the `credit` customer. `no-email` still
     shows the missing-email state through a sales order and a dedicated invoice.
   - After converting a quote or sales order to an invoice, the seed issued the invoice using the
     **quote's/order's** id. `convertToInvoice()` returns the source document, not the invoice, and
     `step()` stores whatever `.id` its callback returns. Both callbacks now return
     `{ id: convertedInvoiceId }`.

### Gate and harness fixes

- **Lint:** removed unused imports (`sections.tsx`, `demo-week-seed.service.ts`), typed a JSON
  payload as `Prisma.InputJsonValue` (`async-report-export.service.ts`), and switched
  `item-dialog.tsx` to `next/image` with `unoptimized` (it previews a local data-URL).
- **Prettier bug in `docs/PHASE13_TODO.md`:** Prettier wasn't idempotent on one checklist item.
  Several blank-line-separated paragraphs under a single `- [ ]` item made it add 4 spaces of
  indent on every run. Fixed by merging that item's evidence notes into one unwrapped paragraph;
  the content is unchanged. **If you edit that item, keep it as a single paragraph.**
- **MinIO port:** this repo remaps MinIO to **59300**, because Windows reserves 58957–59056 (see
  the root `.env`). `apps/web/e2e/prepare.mjs` and `apps/web/playwright.config.ts` both still
  defaulted to 59000, so the demo seed couldn't reach storage and every E2E upload returned a 500.
  Both now default to 59300.
- **Permission-matrix test:** `apps/api/test/authorization-boundary.int.test.ts` was missing 11
  real routes, now added. Each permission key was checked against its controller:
  - customers `transactions`, `summary`, `activity`, `mails`
  - invoice `DELETE`, `expected-payment-date`, `write-off`, `reminders/stop`, `reminders/resume`
  - `payments/open-invoices`
  - `reports/exports/:executionId`

### E2E test drift (the app changed, the tests didn't)

- **Ambiguous "Sign in" locator.** The new "Sign in with Google/Apple" buttons also match
  `getByRole('button', { name: 'Sign in' })`, so it now uses `exact: true` (5 spec files).
- **Clicking before hydration.** The "Show password" toggle works; the test clicked before React
  had attached its handlers. `openAuth()` in `authentication.spec.ts` now waits for `networkidle`
  (confirmed with a diagnostic).
- **Login rate limit.** Logins are capped at 8 per account per 15 minutes, and a full run signs
  the demo users in many more times than that. New shared helper `e2e/lib/rate-limits.ts`
  (`clearAuthRateLimits`) is now called by every sign-in helper (all 6 specs).
- **Owner login destination.** It's now `/dashboard`, not `/`; updated in `phase11-portal.spec.ts`.
- **Collaboration panel.** It adds its own hidden status region and a "Post comment" button.
  - The journal assertions now filter the status region by its text.
  - The journal "Post" and "Reverse" buttons now use `exact: true`.
- **Bigger demo-week seed.** It now creates its own bank transactions, invoices and approval
  policies, so three tests were adjusted:
  - Bank match opens the row the test imported, not the first row.
  - The approval-briefing policy uses `priority: 100`, so it beats the seed's priority-10
    "Bill sign-off" policy.
  - The portal comment test opens `INV-FY2026-00001` (the portal customer's invoice).
- **Proposal reason text.** It renders beside the proposal button, not inside it; the bank-match
  test now asserts on the list item.
- **Visual dashboard and catalog tests.** These were written against the Phase 1 static page with
  a developer's personal account. They now sign in as the demo owner and expect
  "Amina Kamau" / "Karibu Retail Demo". The dashboard's removed "Preview journal" demo controls
  were dropped from that test.

### Not a bug — leave it alone

- `apps/api/.env` sets `AI_MODE=hosted_limited`, with a real DeepSeek key, for the owner's manual
  testing. With that set, one assertion in `test/ai.int.test.ts` fails: it expects
  `provider: 'DISABLED'`. Run the integration gate the way a fresh checkout would:
  `AI_MODE=off npm run test:integration`. Don't edit that `.env`.

## What's left

1. **Re-run the E2E suite once** (from `apps/web`: `npx playwright test`; about 7 minutes,
   including builds).
   - The bank-match and journal fixes landed after the last run, so they're unverified.
   - Expect only the visual baselines and possibly item 2 below to fail.
2. **Investigate the order-dependent failure:** `phase13-ai-workflows.spec.ts` › "reaches the
   Explain panel by keyboard".
   - It failed once because the demo owner had **no ACTIVE organization**, so `useWorkspace`
     redirected to `/onboarding`. It passed in the previous full run.
   - Prime suspect: the Phase 12 test "suspends and reactivates an organization" (it suspends the
     shared demo org). It did reactivate, though, and the same order passed on mobile, so this is
     unconfirmed.
   - Check the demo org's status right after that test.
3. **Item 6, visual baselines.**
   - The design-system catalog and portal overview diffs were reviewed. Their changes are
     intended: the old baselines still show "RetailBooks", the old sidebar, a developer account
     and a Next.js dev badge.
   - The dashboard diffs (desktop/tablet/mobile) were **not** reviewed yet.
   - **Mask dates before updating.** The demo seed dates documents relative to the day it runs,
     so any screenshot that shows dates fails the next day. Portal document dates come from
     `toLocaleDateString()` in `portal-workbench.tsx` (lines ~284 and ~455); add a mask (or a
     stable selector) for them. Check the dashboard for the same thing.
   - Then update: `npm run test:visual:update --workspace @valuebooks/web`, review the new PNGs,
     and commit them.
4. **Update the documents in the same commit as the work:**
   - Tick items 1–6 in `docs/PENDING_WORK.md`, and refresh its "Gate status" table.
   - In `docs/GAPS.md`: close #43 (gate restored) and #44 (`prisma generate` now runs
     automatically); see `PENDING_WORK.md` item 7 for the rest.
   - Add the follow-ups above (other scrollers, date masking) to `PENDING_WORK.md`.
5. **Commit** on `chore/verification-closure`, then continue with P1.

## Running things here

- **Infrastructure:**
  - Start Docker Desktop, then run `npm run infra:up`. All 5 containers should report healthy in
    `docker compose ps`.
- **Memory:**
  - The E2E build needs several GB free. It hit out-of-memory errors earlier at about 1 GB free.
- **Fast E2E iteration:**
  - Start the API and web servers yourself and Playwright reuses them (`reuseExistingServer`).
  - Without its normal startup, Playwright skips the reset-and-seed step, so re-running a test
    that creates data hits 409 conflicts.
  - For a verdict, always do a clean full run.
- **After a manual server session:**
  - Stop the web server's `node .next/standalone/apps/web/server.js` process too. Stopping the
    npm wrapper leaves it holding port 3300.
- **Worker logs during E2E:**
  - `apps/api/e2e-worker.log`. The API server's own output isn't captured by Playwright.
