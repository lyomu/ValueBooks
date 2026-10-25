# Billing management merge handover

Updated 2026-10-25. The user asked to stop the merge/build follow-up and move on.

## Current state

- PR: https://github.com/lyomu/ValueBooks/pull/57, from `feat/platform-admin-commercial-correctness` into `main`. **Not merged.**
- Remote branch head: `43eb860` (`Use HTTPS Debian sources for API runtime image`).
- Local branch is one commit ahead: `a6fcfa2` (`Install CA certificates before HTTPS apt sources`). This correction has **not been pushed**, to avoid starting another time-consuming Jenkins build after the user asked to skip that work.
- The local branch already merged the then-current `origin/main` in `bff1923`. Re-fetch `main` before any future merge.
- Unrelated untracked `.freebuff/` and `.tmp-header-*.png` files were left alone.

## Verification and failures

- Focused billing/security integration suites passed locally before the PR: 78 API integration tests, 12 web tests, 4 Paystack unit tests, API/web typechecks, and changed-file lint. No real provider charge was made.
- Jenkins feature build #1 on `d0af019` failed migration drift. The migration now matches Prisma's foreign-key update action and constraint name. A local migration replay returned **No difference detected**.
- Jenkins feature build #2 on `bff1923` passed CI image builds, lint, typechecks, unit tests, migration replay, and all 82 API integration suites. It failed later in the final API runtime image build: Playwright's `install-deps chromium` reported invalid signatures for Debian package metadata fetched over HTTP.
- `43eb860` switched runtime package sources to HTTPS too early, before the slim image installed CA certificates. The local follow-up found that issue. Local `a6fcfa2` changes the order to install CA certificates first, then switch sources to HTTPS. A narrow container check of that exact apt sequence exited successfully. A complete runtime image build has **not** verified `a6fcfa2`.
- Jenkins feature build #3 for `43eb860` later reported **ABORTED**. Jenkins has one executor; when this work was paused it had been held by unrelated `drift/master` build #43 at a “Deploy or Abort” approval, with `retailflow/main` also waiting. Jenkins API POST attempts to stop or rescan returned 403, so no unrelated job was changed by this agent.
- The local full API integration run on the merged tree was stopped after Jenkins exposed the migration issue; it is not a recorded full pass. Jenkins build #2 supplied the complete integration result.

## If the merge resumes

1. Check current `main`, PR #57, and Jenkins state. Do not infer success from GitHub's CodeRabbit check; Jenkins does not report its result there.
2. Push local `a6fcfa2` only if the corrected runtime-image build is still needed. Build #3 was aborted; do not alter unrelated Drift or Retailflow jobs.
3. Verify the Jenkins feature build uses the pushed SHA, passes the final runtime image build and smoke test, and completes successfully. The billing and tenant-isolation checks must pass before merge.
4. Merge PR #57 into `main`, then verify the merge commit. Production Paystack configuration remains a separate operational task.

Production still needs `PAYSTACK_SECRET_KEY`, the matching `PAYSTACK_ENVIRONMENT`, verified links for all eight monthly/yearly Paystack plans, and a signed webhook before live checkout is enabled. No production credential or plan link was changed here.
