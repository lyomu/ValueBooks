# P1 Handover — Make the Trackers True, Then Merge

**Written:** 2026-10-10 · **Branch:** `chore/verification-closure` · **Status:** not started (one
task already done, noted below)

P1 is items 7–13 in `docs/PENDING_WORK.md`. Most of it is documentation. The planning docs have
drifted from the code, and the next session will make wrong decisions if they're left that way.
The one non-doc item is the merge to `main`.

## Before you start

- **Read `docs/P0_HANDOVER.md` first.** P0 isn't finished, and none of its work is committed: 29
  modified files plus `apps/web/e2e/lib/rate-limits.ts`, `docs/PENDING_WORK.md`,
  `docs/P0_HANDOVER.md` and this file. Don't reset or discard any of it.
- **Do items 7–10, 12 and 13 now.** They don't depend on P0.
- **Item 11 (the merge) waits until P0 is green and committed.**
- **Keep `docs/PENDING_WORK.md` in step.** Tick each task in the same commit as the work. The
  tracker page at https://claude.ai/artifact/Cgw6kVzJGWC6PPEfNaae6h mirrors that file but doesn't
  sync with it; tick it there too, or regenerate it.

## The items

### 7 · Update `docs/GAPS.md` (S)

**Already done (2026-10-10):**

- #44 is ticked with evidence.
- #43 has a status note. Leave it open until E2E is green.
- The snapshot line now explains which parts were re-checked.

**Still to do:**

- **Tick #23, #25, #27, #28.** The file's own "Reconciliation update (2026-10-06)" note in section
  C says they're closed, but their boxes (lines ~138–148) are still `[ ]`. Re-check before
  ticking:
  - #25: `async-report-export.service.ts` returns `202` and an export-status route exists. (That
    route was one of the 11 added to the authorization matrix in P0.)
  - #27 and #28: `docs/AUTOMATION_OPERATIONS_RUNBOOK.md` exists.
  - #23: the update-task action is in the action registry.
- **Fix the duplicate numbering.** Section F (line ~217) and section G (line ~251) both use 43
  and 44. Renumber section G to 47–50, and search the repo for anything that cites "GAPS #43–46"
  in the section-G sense.
- **Mark #35 and #24 as partial; don't tick them:**
  - #35: `version` is enforced on Invoice, CreditNote, Quote, PurchaseOrder, Bill and Expense
    (plus the two Phase 10 models). PaymentReceived, PaymentMade, Journal, VendorCredit and
    SalesOrder have none. That's `PENDING_WORK` item 17.
  - #24: interactive XLSX export streams (`report-export.service.ts`), but
    `report-artifact.service.ts` still buffers (`Buffer.from`, `writeBuffer`).
- **Update the "Totals" paragraph** at the bottom.

### 8 · Reconcile `docs/PHASE11_TODO.md` lines 91 and 99 (S)

- **Line 91:** says the portal E2E spec is "written but never executed". It has now run:
  `phase11-portal.spec.ts` passes in the P0 runs, except its `@visual` baseline, which is P0
  item 6. Tick it and cite the P0 run.
- **Line 99:** "Visually review desktop and mobile portal states".
  - Do it with the portal screenshots from P0 item 6.
  - The mobile 9px horizontal-scroll bug found there is already fixed (`.rb-portal__table-wrap`).
- **GAPS section G #43 (to be renumbered 47):** claims all four boxes were checked. Correct it so
  it matches.

### 9 · Correct `docs/PHASE14_RELEASE_GATE.md` (S)

- **Performance row (line 16):** it says "CSV/XLSX export streams". Only interactive XLSX
  streams; CSV and stored report artifacts are built in memory. Link it to `PENDING_WORK` item 33.
- **Security row (line 13):** add that MFA isn't implemented. Only the `security.mfa.manage`
  permission key exists, with no TOTP code (`PENDING_WORK` item 15).
- **Reliability row:** add that the background worker couldn't boot until 2026-10-10 (missing
  `DatabaseModule`, fixed in P0). Any earlier "worker verified" claim is suspect.

### 10 · Update `docs/HANDOVER.md` (S)

- **Phase table (§1):** still says "13–14 | No code".
  - Phase 13: implemented, behind feature flags; acceptance open (`PHASE13_TODO.md`,
    `PENDING_WORK` P4).
  - Phase 14: in progress (`PHASE14_RELEASE_GATE.md`, `PENDING_WORK` P2–P3).
- **"What is genuinely open, in priority order":** it's from September and wrong in several
  places. For example it still says env validation is open, and that the quote→payment scenario
  is missing. Replace it with a short pointer to `docs/PENDING_WORK.md` and the two P0/P1
  handovers.
- **"Last refreshed" date:** update it.

### 11 · Merge `chore/verification-closure` into `main` (S)

- **Facts:**
  - The branch is 58 commits ahead of `main` with 0 behind, so a fast-forward is possible.
  - Phases 10–13 and all the October UI work exist only on this branch.
  - `origin/HEAD` points at `chore/verification-closure`, so GitHub treats it as the default
    branch.
- **Order:**
  1. Finish and commit P0.
  2. Confirm `git status` is clean.
  3. `git checkout main && git merge --ff-only chore/verification-closure`.
  4. `git push origin main`.
  5. Set the default branch back to `main` (GitHub repo settings, or
     `gh repo edit --default-branch main`).
  6. Decide whether to keep the old branch.
- **Don't do it without the owner's go-ahead.** Pushing to `main` and changing the default branch
  are outward-facing. Earlier sessions explicitly left the merge decision to the repository owner.

### 12 · Clean stale boxes in the roadmap and execution plan (S)

- **`docs/EXECUTION_PLAN.md:283–343`:** the Phase 7 build checklist is all `[ ]`, but Phase 7 is
  complete (`docs/PHASE7_TODO.md`). Tick it with a reference, or replace it with "Done — see
  PHASE7_TODO.md".
- **`docs/EXECUTION_PLAN.md:511–559`:** Phase 10 stage boxes. Tick what's done, and point the
  rest at the named debt in `PHASE10_TODO.md` and GAPS section C.
- **`docs/BUILD_ROADMAP.md`:**
  - Line 397: a deferred Phase 4 refactor. Leave it open or move it to GAPS.
  - Line 408: says "BLOCKED on Phase 6", but Phase 6 is done, so check whether inventory COGS
    posting exists. `inventory.int.test.ts` proves cross-module scenario 2, which covers it.
- **`docs/BUILD_ROADMAP.md:118` and `:941–945`:** link them to `PENDING_WORK` items 17 (version
  fields), 14–15 and 22 (security and accessibility), 24 (support notes). The analytics-events
  item has no tracker entry yet; add one or record it as post-V1.

### 13 · Clear out the log clutter (S)

- There are 24 `*.log` files in the repository root, plus `.dev-logs/`. They're git-ignored, so
  deleting them doesn't affect git.
- Keep `apps/api/e2e-worker.log` if E2E work is still under way: it's the only place
  document-extraction worker errors show up during Playwright runs.
- Optional: point future logs at one ignored `logs/` folder.

## Suggested order

1. Items 7, 8, 9, 10 and 12, in one docs commit (roughly an hour).
2. Item 13.
3. Item 11, once P0 is committed and the owner agrees.

## Facts already verified — don't re-derive them

- `prisma generate` runs before every API gate: `pre*` scripts in `apps/api/package.json`.
- The idempotency, domain-event, retry-safe consumer and PDF-snapshot contracts (GAPS #34,
  #36–38) are closed with tests.
- All 8 cross-module acceptance scenarios have integration coverage (GAPS section B).
- The integration suite is 458/458 with `AI_MODE=off`. The local `apps/api/.env` deliberately uses
  `hosted_limited`; don't change it.
