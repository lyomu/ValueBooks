# ValueBooks — Pending Work Tracker

**Audit date:** 2026-10-10 · **Branch:** `chore/verification-closure` (58 commits ahead of `main`,
0 behind)

This is the working list of everything still open, built from a fresh audit that re-ran the
repository gates and checked `docs/GAPS.md`, `docs/HANDOVER.md`, `docs/PHASE13_TODO.md`, and
`docs/PHASE14_RELEASE_GATE.md` against the code. `docs/GAPS.md` remains the long-form record with
original item numbers; the `GAPS #n` references below point into it.

**How to use it:** work top to bottom — tiers are in priority order, and so are the items inside
each tier. Every item is broken into the actual tasks. Check a task when it is done and verified;
check the item when all its tasks are. Update this file in the same commit as the work.

Effort is a rough estimate per item: **S** = under 2 hours, **M** = half a day to 2 days, **L** =
several days.

## Gate status (updated 2026-10-10, end of P0 session)

| Check                      | Result                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------- |
| Typecheck (all workspaces) | Pass                                                                                |
| Unit tests                 | Pass — 260/260 (API 201)                                                            |
| API production build       | Pass                                                                                |
| `npm run format:check`     | Pass                                                                                |
| `npm run lint`             | Pass — 0 errors, 0 warnings                                                         |
| Web production build       | Pass                                                                                |
| Integration suite          | Pass — 458/458, 66/66 files (run with `AI_MODE=off`; see `P0_HANDOVER.md`)          |
| Playwright E2E             | 38 passed, 10 failed — 7 stale visual baselines, 3 functional (2 fixed, unverified) |

**All changes from the P0 session are uncommitted.** `docs/P0_HANDOVER.md` explains every change
and what is left; read it before picking up items 5 and 6.

---

## P0 — Restore the release gate

_Why first:_ the web app does not build, and nothing else can be verified or merged until it does.

### [x] 1 · G1 · Fix the 3 lint errors (S)

- [x] Remove the unused `Users` import in `apps/web/src/components/marketing/sections.tsx:8` (this
      is what breaks the web build)
- [x] Remove the unused `CreateExpenseDto` import in `apps/api/src/demo-week-seed.service.ts:20`
- [x] Type the `JSON.parse(JSON.stringify(query))` value in
      `apps/api/src/reporting/async-report-export.service.ts:55` (cast to `Prisma.InputJsonValue`
      or the query type) instead of leaving it `any`
- [x] Run `npm run lint` and confirm 0 errors — also fixed the `<img>` warning (item 36), since
      `--max-warnings=0` fails on it

### [x] 2 · G2 · Format the 12 files (S)

- [x] Run `npm run format`
- [x] Review the diff to confirm it is formatting only (marketing pages and components,
      `apps/web/src/lib/currency.ts`, `docs/PHASE13_TODO.md`)
- [x] Run `npm run format:check` and confirm it passes — needed a fix for a Prettier
      non-idempotency bug in `docs/PHASE13_TODO.md` (see `P0_HANDOVER.md`)

### [x] 3 · G3 · Confirm the web production build passes (S)

- [x] Run `npm run build --workspace @valuebooks/web`
- [x] Fix anything else the build reports — nothing else
- [x] Start it with `npm run start --workspace @valuebooks/web` and open `/`, `/pricing`, `/login`
      — served by the E2E runs on port 3300

### [x] 4 · G4 · Run the integration suite (M)

- [x] Start Docker Desktop
- [x] Run `npm run infra:up` and check all five services are healthy with `docker compose ps`
      (Postgres, Redis, MinIO, Mailpit, ClamAV)
- [x] Run `npm run test:integration` and save the output to a log
- [x] Confirm the new `profile_completed_at` migration applies cleanly to `valuebooks_test`
- [x] Fix any failures and re-run until green — added 11 missing routes to the
      authorization-boundary matrix; the one AI test failure comes from the local
      `AI_MODE=hosted_limited` in `apps/api/.env`, so run the gate with `AI_MODE=off`

### [ ] 5 · G5 · Run the Playwright E2E suites (M)

- [x] Free memory first: the last run crashed in `nest build` with only 1.3 GB free
- [x] Run `npm run e2e:prepare --workspace @valuebooks/web` — fixed the MinIO port and two
      demo-seed bugs to get it passing
- [x] From `apps/web`, run `npx playwright test --project=desktop`
- [x] Run the never-executed `phase13-ai-workflows.spec.ts` and `phase13-workflow-actions.spec.ts`
      — found and fixed the worker crash (`worker-app.module.ts`)
- [x] Run the tablet and mobile projects — fixed a 9px mobile overflow on the portal
- [ ] Re-run once to verify the bank-match and journal fixes (applied after the last run)
- [ ] Investigate the order-dependent "Explain panel by keyboard" failure (demo org briefly had no
      ACTIVE status; suspect the Phase 12 suspend/reactivate test)
- [ ] Record the results in `docs/PHASE13_TODO.md` (milestone 13G)

### [ ] 6 · G6 · Re-verify the visual baselines (S)

- [x] Run `npm run test:visual --workspace @valuebooks/web` (ran as part of the full E2E runs)
- [ ] Review each diff — catalog and portal reviewed (intended: rebrand, new sidebar, demo user);
      dashboard desktop/tablet/mobile not yet reviewed
- [ ] Mask seed-relative dates first (portal `toLocaleDateString()` in `portal-workbench.tsx`,
      check the dashboard too) — otherwise the baselines fail the next day
- [ ] Where the change is intended, run `npm run test:visual:update` and commit the new screenshots

### Follow-ups found during P0

- [ ] **F1** · About ten other `overflow-x: auto` scrollers in `apps/web/src/app/styles.css` have
      the same latent bug as the portal table (an absolutely positioned child escapes an
      unpositioned scroller). Only the portal one was proven and fixed. (S)
- [ ] **F2** · Focus doesn't return to the Explain button when the Explain panel closes (noted in
      `phase13-ai-workflows.spec.ts`). (S)

## P1 — Make the trackers true, then merge

_Why next:_ cheap, and it stops the next session from working off wrong information. The merge
puts four phases of work on `main`.

### [ ] 7 · D1 · Update `docs/GAPS.md` (S)

- [ ] Tick #23, #25, #27, #28 (closed per the file's own 2026-10-06 note)
- [x] Tick #44 — `prisma generate` now runs before typecheck, test and build in
      `apps/api/package.json` (done 2026-10-10)
- [ ] Renumber section G's items 43–46 so they no longer clash with section F's 43/44
- [ ] Note that #35 is partial (6 document types have version checks) and #24 is partial
      (interactive XLSX streams)
- [ ] Update #43 with today's gate status, and close it once P0 is green — status note added
      2026-10-10; close it when E2E is green
- [ ] Update the totals and snapshot date

### [ ] 8 · D2 · Reconcile `docs/PHASE11_TODO.md` lines 91 and 99 (S)

- [ ] Check the evidence ledger in that file for the 2026-09-11 portal E2E run
- [ ] If `phase11-portal.spec.ts` ran green, tick line 91 with a reference; otherwise run it as
      part of G5
- [ ] Review the portal at desktop and mobile, then tick line 99
- [ ] Correct GAPS G43, which claims all four boxes are already checked

### [ ] 9 · D3 · Correct `docs/PHASE14_RELEASE_GATE.md` (S)

- [ ] Performance row: only interactive XLSX export streams; CSV and stored artifacts still buffer
      (link to T2)
- [ ] Security row: add that MFA is not implemented (only the `security.mfa.manage` permission key
      exists)

### [ ] 10 · D4 · Update `docs/HANDOVER.md` (S)

- [ ] Phase table: 13 = implemented, acceptance open; 14 = in progress
- [ ] Replace the "What is genuinely open" list with a pointer to this file
- [ ] Refresh the "Last refreshed" date

### [ ] 11 · M1 · Merge `chore/verification-closure` into `main` (S)

- [ ] Confirm P0 is green and the working tree is clean
- [ ] `git checkout main && git merge --ff-only chore/verification-closure`
- [ ] `git push origin main`
- [ ] Set GitHub's default branch back to `main` (`origin/HEAD` currently points at
      `chore/verification-closure`)
- [ ] Decide whether to keep or delete the old branch

### [ ] 12 · D5 · Clean stale boxes in the roadmap and execution plan (S)

- [ ] `docs/EXECUTION_PLAN.md:283-343` — the Phase 7 build list is done; tick it with references to
      `PHASE7_TODO.md`
- [ ] `docs/EXECUTION_PLAN.md:511-559` — tick the Phase 10 items or point them at the named debt
- [ ] `docs/BUILD_ROADMAP.md:397` and `:408` — resolve the Phase 4 deferred item and the line
      "blocked on Phase 6" (Phase 6 is done)
- [ ] `docs/BUILD_ROADMAP.md:118` and the Definition-of-Done boxes at `:941-945` — link them to
      the matching items here

### [ ] 13 · D6 · Clear out the log clutter (S)

- [ ] Delete the ~20 `*.log` files in the repository root
- [ ] Empty `.dev-logs/`
- [ ] Optional: send future logs to one ignored `logs/` folder

## P2 — Launch blockers: missing features and data safety

_Why here:_ these are gaps a customer or an attacker would hit on day one. Tests cannot paper over
them.

### [ ] 14 · H8 · Extend tenant-isolation tests to exports, portal and jobs (M)

- [ ] List every way tenant data leaves the main API: sync and async report exports, export status
      resources, the 20 portal routes, attachment download links, AI evidence, background jobs
- [ ] Add cross-org tests: org B cannot read org A's export execution, status, or file
- [ ] Portal: a customer of org A cannot reach org B documents with guessed IDs
- [ ] Jobs: workflow, scheduler, and document-extraction workers re-check `organizationId` before
      acting
- [ ] Run the RLS tests with the production-style runtime role
      (`infrastructure/postgres-runtime-role.sql`)
- [ ] Tick GAPS #10

### [ ] 15 · H6 · Dependency scanning and security review (M)

- [ ] Add a dependency scan (`npm audit --audit-level=high`, Dependabot, or OSV) to
      `.github/workflows/ci.yml` — there is none today
- [ ] Triage and fix what it finds
- [ ] **MFA decision:** only the `security.mfa.manage` permission key exists, with no TOTP code.
      Either build TOTP MFA for V1 or record it as post-V1
- [ ] Review rate limits on auth, portal and AI routes
- [ ] Review session lifetime, cookie flags and CSRF protection
- [ ] Confirm production config validation rejects missing secrets (`@valuebooks/config`)
- [ ] Write the findings up for the security owner (S1)

### [ ] 16 · H2 · Backup and restore drill (M)

- [ ] Set up a non-production copy with seeded data
- [ ] Write a backup script: `pg_dump` plus a MinIO bucket copy
- [ ] Restore into a fresh environment
- [ ] Compare trial balance and record counts before and after
- [ ] Record how long it took (recovery time) and how much data could be lost (recovery point)
- [ ] Write `docs/BACKUP_RESTORE_RUNBOOK.md`
- [ ] Tick GAPS #12 and #33

### [ ] 17 · T4 · Version checks on the remaining financial records (M)

- [ ] Add `version Int @default(0)` to `PaymentReceived`, `PaymentMade`, `Journal`,
      `VendorCredit` and `SalesOrder` in one new migration (shadow-db `migrate diff`, never edit an
      applied migration)
- [ ] Enforce it in `payments.service.ts`, `payments-made.service.ts`, `ledger.service.ts`,
      `vendor-credits.service.ts` and `sales-orders.service.ts`, following `invoices.service.ts`
- [ ] Add `version` to the DTOs and Zod contracts, and send it from the web forms
- [ ] Integration test per type: a stale version returns 409 and changes nothing
- [ ] Tick GAPS #35 and `BUILD_ROADMAP.md:118`

### [ ] 18 · H1 · Build customer, vendor and item import (L)

- [ ] Design: a downloadable CSV template per type, column mapping, a preview with row errors,
      then commit
- [ ] API: `POST .../customers/import`, `.../vendors/import` and `.../catalog/import`, reusing the
      parser in `apps/api/src/banking/csv.ts` and the existing DTO validation
- [ ] Dry-run preview mode, idempotency key on commit, and an audit event
- [ ] Duplicate handling: match on name/email for contacts and SKU for items
- [ ] Permission keys, in all four places (catalog keys, catalog entries, `roles-catalog.ts`,
      contracts)
- [ ] Web: an import wizard following the Import screen pattern in `banking-workbench.tsx`
- [ ] Integration tests: valid file, bad rows, duplicates, replay, tenant isolation
- [ ] Tick GAPS #15

### [ ] 19 · H10 · Publish Terms, Privacy and Accessibility pages (M)

- [ ] Draft Terms of Service, Privacy Policy and an Accessibility statement (needs legal input)
- [ ] Make the privacy policy cover AI processing (ties to A2)
- [ ] Add `/terms`, `/privacy` and `/accessibility` under `apps/web/src/app/(marketing)/`
- [ ] Replace the plain-text footer line (`site-footer.tsx:78`) with links
- [ ] Add "By signing up you agree to the Terms and Privacy Policy" to the signup form

### [ ] 20 · P1 · Social sign-in: build it or remove the buttons (M)

- [ ] Decide: in V1 or not
- [ ] If yes: Google and Apple OAuth in the auth module, account linking by verified email, tests
- [ ] If no: remove the disabled buttons and the "coming soon" note
      (`apps/web/src/components/auth-form.tsx:232`) and update the login/signup screenshots

## P3 — Launch evidence

_Why here:_ the features exist; what is missing is proof they hold up at launch quality.

### [ ] 21 · H9 · Record the accounting golden-scenario run (M)

- [ ] Run together: `cross-module-scenarios`, `accounting-invariants`, `fx-revaluation`,
      `opening-balances`, `reporting` integration tests
- [ ] Save the log
- [ ] Attach it to `docs/PHASE14_RELEASE_GATE.md` and tick GAPS #9

### [ ] 22 · H4 · WCAG 2.2 AA review (L)

- [ ] Pick the critical journeys: sign up and log in, create and issue an invoice, record a
      payment, reconcile a bank account, run a report, view and pay in the portal
- [ ] Walk each journey keyboard-only
- [ ] Screen-reader pass with NVDA
- [ ] Check contrast of the colour tokens in both themes
- [ ] Add automated axe checks to Playwright (`@axe-core/playwright`)
- [ ] Fix the issues and write the report for the accessibility owner (S3)
- [ ] Tick GAPS #14 and #32

### [ ] 23 · H3 · Performance at production-like volumes (L)

- [ ] Write a volume seed (for example 50k customers, 100k invoices, 1M journal lines)
- [ ] Time list endpoints, imports and reports against the budgets in `docs/PERFORMANCE.md`
- [ ] Run `EXPLAIN ANALYZE` on anything slow and add indexes
- [ ] Record the results in `docs/PERFORMANCE.md` and tick GAPS #13

### [ ] 24 · H7 · Monitoring, alerting and runbooks (M)

- [ ] Choose a stack (OpenTelemetry is already a dependency, so start from a collector)
- [ ] Uptime checks on API, worker and web
- [ ] Alerts: error rate, failed or stuck queue jobs, database health, disk space
- [ ] Error tracking for API and web
- [ ] Incident runbook and support runbook
- [ ] Tick GAPS #16

### [ ] 25 · H5 · Visual regression across the full surface (M)

- [ ] Add visual tests for invoices, bills, banking, reports, settings, portal, marketing home and
      pricing
- [ ] Generate baselines at desktop, tablet and mobile
- [ ] Run them in CI
- [ ] Tick GAPS #30, #31 and `EXECUTION_PLAN.md` 4.5/4.6

## P4 — AI layer acceptance (Phase 13)

_Why here:_ the AI features are behind per-organization feature flags, so V1 can launch with them
off. Finish these before turning AI on for real tenants (GAPS A1 #1–8).

### [ ] 26 · A1 · Independent review of the AI threat model (M)

- [ ] Choose a reviewer other than the author
- [ ] Review `docs/PHASE13_AI_THREAT_MODEL.md` against the current code
- [ ] Record the sign-off and how each named gap was resolved

### [ ] 27 · A2 · Answer the 5 privacy-review questions (M)

In `docs/PHASE13_AI_PRIVACY_REVIEW.md`. Hosted mode stays off until all five are answered.

- [ ] §3.1 — legal review of DeepSeek's hosted-API terms
- [ ] §3.2 — process for each tenant's jurisdiction and data residency
- [ ] §3.3 — how consent is captured and recorded
- [ ] §3.4 — whether the current data-minimisation cap is enough
- [ ] §3.6 — who decides on data leaving the system, and who can revoke it

### [ ] 28 · A5 · Live document-extraction round trip (M)

- [ ] Bring infrastructure up with ClamAV running
- [ ] Upload a receipt image and a PDF through the UI
- [ ] Confirm scan → OCR → candidate fields → the user creates the expense draft
- [ ] Upload the EICAR test file and confirm it ends `QUARANTINED`
- [ ] Record the evidence in `docs/PHASE13_TODO.md` (13D)

### [ ] 29 · A3 · Human review of the evaluation set (M)

- [ ] Check the ground truth on the 110 document cases in `apps/api/eval/`
- [ ] Check the labels on the 115 question cases
- [ ] Add some real, anonymised receipts if you can
- [ ] Mark the set as reviewed in `apps/api/eval/README.md`

### [ ] 30 · A4 · Choose models on the frozen holdouts (L)

- [ ] Set a minimum score per feature (field accuracy, abstention rate)
- [ ] Compare OCR options against tesseract.js on the holdout
- [ ] Compare private-mode inference models
- [ ] Record the chosen versions for reproducibility

### [ ] 31 · A6 · Tick the AI items as they pass (S)

- [ ] For each capability that passes A1–A5 and G5: tick its GAPS A1 item, `BUILD_ROADMAP.md`
      lines 856–870, and its `PHASE13_TODO.md` box

## P5 — Tracked debt and polish

_Why last:_ real, but nothing breaks for users while these stay open.

### [ ] 32 · T3 · Approval edge-case tests (M)

- [ ] Multi-level approvals happen in order
- [ ] Criteria boundaries (amount exactly at the threshold)
- [ ] Concurrent approve and reject on the same request
- [ ] A policy edited mid-flight keeps using the frozen snapshot
- [ ] An approver who loses permission can no longer decide
- [ ] Tick GAPS #26

### [ ] 33 · T2 · Stream stored report artifacts (M)

- [ ] Change `ReportArtifactService#generate` to write rows to a stream (ExcelJS
      `stream.xlsx.WorkbookWriter`, a row-by-row CSV writer)
- [ ] Upload to object storage with a streaming multipart upload
- [ ] Test with a large report and check memory stays flat
- [ ] Tick GAPS #24

### [ ] 34 · T1 · State-machine docs for the nine approval types (M)

- [ ] For each type: states, allowed transitions, who can act, which steps need approval
- [ ] Write them into `docs/AUTOMATION_OPERATIONS_RUNBOOK.md` (or a new
      `docs/APPROVAL_STATE_MACHINES.md`)
- [ ] Tick GAPS #21

### [ ] 35 · P2 · Fix the LinkedIn footer link (S)

- [ ] Use the real LinkedIn URL in `apps/web/src/components/marketing/site-footer.tsx:50`, or remove
      the icon

### [x] 36 · P3 · Use `next/image` in the item dialog (S)

- [x] Replace `<img>` in `apps/web/src/components/item-dialog.tsx:288`
- [x] Confirm `npm run lint` shows 0 warnings — done during P0 item 1

## Final — Release sign-off (people, not code)

From `docs/PHASE14_RELEASE_GATE.md`. These come last because each one signs off on evidence the
tiers above produce. They cannot be inferred from tests.

### [ ] 37 · S1 · Security owner sign-off

- [ ] Send the evidence: A1 threat-model review, H6 security review, H8 isolation tests
- [ ] Record the name, date and approval in `docs/PHASE14_RELEASE_GATE.md`

### [ ] 38 · S2 · Operations owner sign-off

- [ ] Send the evidence: H2 backup/restore drill, H7 monitoring and runbooks
- [ ] Record the name, date and approval

### [ ] 39 · S3 · Accessibility owner sign-off

- [ ] Send the evidence: the H4 report
- [ ] Record the name, date and approval

### [ ] 40 · S4 · Legal and compliance owner sign-off

- [ ] Send the evidence: H10 legal pages, A2 privacy answers, the country-pack list
- [ ] Record the name, date and approval
