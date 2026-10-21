# Development conventions

## Design System First

Before implementing new UI, inspect the existing ValueBooks component library, layouts,
typography, design tokens, and interaction patterns. Reuse suitable components first. Extend
existing components through reusable variants when necessary. Create new components only when an
appropriate equivalent does not exist. Do not duplicate styling, introduce arbitrary design
tokens, or build isolated page-specific UI patterns without justification. Respect the distinct
design contexts of the public marketing site, authenticated application, and Platform Admin
Portal.

This applies to the public marketing website, authentication, onboarding, the customer
application, the Platform Admin Portal, billing and subscription management, and all future
ValueBooks modules.

Required order when implementing new UI:

1. **Inspect** — identify whether a suitable component, layout, design token, or styling pattern
   already exists (e.g. `packages/ui`, `apps/web/src/app/(marketing)/marketing.css`,
   `apps/web/src/app/(marketing)/marketing-additions.css`, `apps/web/src/app/styles.css`).
2. **Reuse** — if an appropriate shared component exists, use it without creating a duplicate.
3. **Extend** — if an existing component almost meets the requirement, extend it through a
   documented reusable variant. Do not introduce page-specific modifications that unexpectedly
   affect other consumers.
4. **Create** — only create a new component when the required functionality or design cannot
   reasonably be achieved through the existing system.
5. **Standardize** — if a new reusable component is necessary, place it in the appropriate shared
   component library, follow existing naming conventions, use existing typography/color/spacing
   tokens, implement responsive behavior, support accessibility, and document its intended usage.

Do not introduce a new design system or styling convention for a single feature or page.

Design consistency does not mean forcing every interface to have identical typography or layout:
the public marketing site, the authenticated accounting application, and the Platform Admin
Portal are distinct design contexts that share foundational tokens and components where
appropriate, but marketing-specific typography and animation should not be forced onto financial
tables, application forms, or generated documents.


# ValueBooks — Codex Repository Instructions

These instructions apply to all Codex-assisted work in the ValueBooks repository. Follow any more specific `AGENTS.md` files in subdirectories where applicable. Preserve existing security, accounting correctness, tenant isolation, and established development workflows.

## 1. Design System First

Before adding any UI, inspect and reuse existing ValueBooks shared components, layouts, typography, colors, design tokens, and interaction patterns. Extend shared components via reusable variants where necessary; create a new component only when no appropriate shared solution exists. Do not introduce arbitrary page-level visual styles or duplicate the form, table, sidebar, or dropdown systems.

Keep these design contexts appropriately scoped: public marketing site, authenticated customer app, and Platform Admin. Use the established shared DataTable, controls, status pills, loading skeletons, and accessible behaviors where applicable.

## 2. Token- and Time-Efficient Execution

Codex should prioritize implementation, code review, and focused debugging. Avoid long repetitive execution, excessive logs, unnecessary broad searches, and full-suite reruns after every small edit.

Before validation:
1. Identify the files/modules changed and their risk level.
2. Select the smallest useful tests, lint rules, or type-check commands that validate those changes.
3. Run targeted checks once after the change; rerun only when a relevant fix has been made.
4. Summarize pass/fail outcomes and distinguish checks completed from checks deferred to CI.

Do not run full production builds, entire integration suites, browser E2E suites, or repository-wide regressions by default during interactive Codex tasks. Delegate those to CI for normal validation. Exceptions: the user explicitly requests the check, the change is impossible to validate adequately otherwise, or a focused investigation establishes it is required. Explain the reason before an unusually expensive check.

For accounting, billing, security, authorization, and tenant isolation changes, appropriate integration/security checks remain **mandatory before merge or release**. Deferring these checks to CI is permitted; skipping or disabling them is not.

## 3. Command and Log Discipline

- Do not rerun an unchanged failing command without a corresponding fix or a concrete new diagnostic hypothesis.
- Do not launch redundant builds/tests concurrently.
- Avoid tight polling loops and repeated reads of unchanged process output.
- Prefer short command output; direct verbose logs to files or CI artifacts where possible.
- Read failure summaries, specific failed test names, and relevant stack-trace excerpts rather than entire logs.
- When environmental dependencies, credentials, or external services prevent testing, stop repeated retries and report the blocker accurately.
- Never assert a test/build passed unless its successful execution was observed.

## 4. CI Is the Full Verification Executor

CI and deployment run on Jenkins (`Jenkinsfile`); there are no GitHub Actions workflows. Inspect the `Jenkinsfile` and package scripts before creating or editing CI. Reuse established workflows and project commands; do not guess package managers, scripts, working directories, or service requirements.

Prefer independent CI jobs for:
- Frontend linting, type checking, and unit tests.
- Backend linting, type checking, and unit tests.
- PostgreSQL/Redis-backed integration tests with isolated test services.
- E2E/browser tests when relevant.
- Production frontend/backend builds.

Use dependency caching, concurrency cancellation for superseded runs, reasonable timeouts, and reusable workflows where appropriate. Run lightweight verification on pull requests and run expensive integration/E2E/build checks on the appropriate merge, release, protected-branch, or manual workflow events. **Required checks for high-risk changes must run before those changes can merge or deploy**, not only after merge. Keep detailed logs as CI artifacts and expose concise summaries for review.

Jenkins execution is separate from Codex conversation usage, but consumes the shared CI box's resources (see `devops-infra/docs/CI_BOX_CAPACITY.md`).

## 5. High-Risk ValueBooks Areas

Never weaken automated coverage or bypass validation for:
- General ledger and financial posting integrity.
- Tax and multi-currency calculations.
- Invoicing and document lifecycle/accounting corrections.
- Paddle and Paystack webhook signatures, idempotency, and reconciliation.
- Subscription lifecycle, pricing, entitlements, quotas, and migrations.
- Authentication, authorization, privileged Platform Admin operations.
- Multi-tenant data separation and confidentiality.
- Data deletion, retention, and restore safety.

Use sandbox/mock provider environments for automated payment tests. Never trigger a real customer charge as a test.

## 6. Minimal Scope and Existing Behavior

Do not expand the task to unrelated refactors. Preserve existing working business logic, APIs, schema contracts, migrations, and UI patterns unless the user requested changes. Do not quietly rewrite pricing, subscription behavior, or approved plan definitions. Document any necessary deviations and any migration risk.

## 7. Completion Report

End Codex tasks with a concise report stating:
- What changed (and significant files/components affected).
- Focused validation actually executed and its result.
- Full checks deferred to CI, including the workflow/job when known.
- Any unresolved failures, operational dependencies, or release blockers.

Do not paste entire build/test logs or imply deferred validations have passed.

## 8. Permanent Working Rule

**Implement with existing shared components first; test narrowly during interactive work; let CI perform comprehensive validation; never trade away financial, security, or tenant-isolation correctness to save tokens.**

