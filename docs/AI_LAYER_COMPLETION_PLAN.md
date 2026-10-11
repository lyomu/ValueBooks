# AI Layer Completion Plan

**Prepared:** 2026-10-11
**Scope:** Phase 13 AI review follow-up
**Status:** Priorities 1 and 2 implemented locally on 2026-10-11; hosted AI remains disabled for
real tenants. Full API test-suite confirmation is pending release of the local Prisma engine lock.

This plan follows the independent technical review recorded in
`docs/PHASE13_AI_THREAT_MODEL.md` and the proposed privacy decisions in
`docs/PHASE13_AI_PRIVACY_REVIEW.md`. The accounting system remains the authority for amounts,
authorization, and financial changes. AI may only interpret authorized evidence or prepare a
reviewable suggestion.

## Priority 1 — Close hosted egress and kill-switch gaps

- [x] Require an explicit organization-scoped approval record before hosted egress can occur.
      A global, country, plan, or default feature-flag setting must not enable hosted inference for
      a real tenant.
- [x] Gate `POST /organizations/:organizationId/ai/ask` behind the new
      `phase13.ai_assistant` capability flag. `explain-number` now requires that flag and
      `phase13.report_drilldown`.
- [x] Add focused unit coverage proving that hosted access requires the explicit organization rule,
      generic rollout scopes cannot satisfy that rule, every required route flag must resolve on,
      and a provider failure with revoked access returns no fallback data.
- [ ] Add API integration coverage for approval/revocation endpoints and the two assistant routes.
      This remains pending because the local API dev process locks Prisma's Windows query engine,
      preventing the integration runner's required `prisma generate` step.

**Implemented control:** hosted DeepSeek calls require `AI_MODE=hosted_limited`, an active
`HostedAiEgressApproval` record for `DEEPSEEK`/`REPORT_EVIDENCE`, and an enabled
organization-scoped `phase13.hosted_ai_egress` rule. Approval and revocation write platform audit
events; revocation disables the organization rule in the same transaction.

**Acceptance:** Hosted DeepSeek remains unreachable for every tenant unless a documented,
organization-specific approval path is satisfied. The capability kill switch covers both AI
assistant endpoints.

## Priority 2 — Recheck authorization before deterministic fallback

- [x] In `AiOrchestrator.explainNumber`, re-resolve membership and `reports.view` before returning
      the deterministic drill-down after model failure.
- [x] Add a unit test in which the model fails while the caller loses report permission; the result
      contains no drill-down data.
- [ ] Add an integration test in which the model fails while the caller loses membership or report
      permission; the response must contain no drill-down data.

**Acceptance:** A provider outage cannot return financial evidence to a user whose access changed
while the request was in progress.

## Priority 3 — Harden document extraction

- [x] Move PDF rasterization and OCR into a dedicated document-extraction worker entry point and
      provide a restricted production container manifest. It runs as non-root with a read-only
      filesystem, dropped capabilities, PID/CPU/memory limits, a small temporary filesystem, and
      one concurrent extraction. Deployment must use this manifest or an equivalent policy.
- [x] Set and enforce file-size, page-count, page-pixel, aggregate-pixel, OCR-text, and wall-clock
      limits. Permanent limit violations are marked unsupported rather than retried.
- [x] Correct the PDF JavaScript claim: `pdfjs-dist` now receives `isEvalSupported: false`, covered
      by a direct regression test. It also stops at parse errors and disables system fonts/font-face
      loading.
- [ ] Complete adversarial integration coverage for malformed PDFs, oversized images, extreme page
      dimensions, and partial multi-page worker failure. Unit coverage now includes malformed PDFs,
      extreme PNG dimensions, arithmetic overflow, and the exact PDF load options.
- [ ] Run a full worker-process test that queues a document and verifies processing through the
      deployed worker, rather than constructing the extraction service directly.

**Acceptance:** Resource bounds and a restricted deployment form now exist, but this priority is
not complete until adversarial integration cases and the separately launched worker lifecycle are
proven in CI/deployment.

## Priority 4 — Add provider-use and operational controls

- [ ] Enforce outbound request payload and output-token limits.
- [ ] Add per-organization cost/spend limits and alerts.
- [ ] Decide whether a process-local circuit breaker is sufficient; otherwise implement a shared
      breaker or a central provider-health mechanism.
- [ ] Test logging, tracing, error reporting, and worker failures to confirm they never retain or
      emit prompts, report cells, OCR text, or provider authorization headers.
- [ ] Document and rehearse emergency key revocation, flag revocation, and provider outage
      response.

**Acceptance:** One organization cannot use unbounded provider capacity, and operations can disable
AI quickly without exposing sensitive content through telemetry.

## Priority 5 — Complete hosted-mode privacy decisions

- [ ] Legal obtains the governing API agreement or DPA and written answers on:
  - [ ] provider training use of API inputs and outputs;
  - [ ] provider retention, cache retention, deletion, and deletion request process;
  - [ ] processing regions, data residency, and international transfer safeguards;
  - [ ] named sub-processors and breach-notification terms.
- [ ] Define a per-tenant jurisdiction and data-residency assessment. Record the data classes,
      contractual commitments, legal reviewer, evidence, decision, and reassessment date.
- [x] Build a durable, auditable organization consent/approval record with signer, authority,
      disclosure version, document hash, scope, decision, and withdrawal state.
- [ ] Restrict hosted payloads to approved report keys and fields. Redact free-text descriptions
      and unnecessary source identifiers; cap the payload and tokens.
- [ ] Decide whether the default 90-day `AiRun` metadata retention period is appropriate for
      hosted-mode activity.
- [ ] Have the owner inspect DeepSeek account usage and outbound-network records to determine
      whether the local hosted key ever sent data beyond demo/manual fixtures. Record the outcome.

**Current provider concern:** DeepSeek's public policy describes processing/storage in the People's
Republic of China and possible model improvement/training use. Do not rely on public documentation
as an API-specific no-training, fixed-retention, or subprocessor commitment.

**Acceptance:** Legal and the owner record decisions for every open privacy question before any
organization can use hosted AI. The final terms and data flow are reflected in the public privacy
materials and release sign-off.

## Priority 6 — Complete quality evaluation (A3/A4)

- [ ] Human-review the 110 document cases and 115 question cases in `apps/api/eval/`.
- [ ] Add anonymized real documents and questions where authorized.
- [ ] Define thresholds for field precision, false positives, citation validity, abstention,
      latency, and cost.
- [ ] Compare local OCR alternatives with `tesseract.js` on the frozen holdout.
- [ ] Compare private inference models on the frozen holdout and record chosen versions.

**Acceptance:** The chosen models and supported intents meet documented, measured thresholds on a
human-reviewed frozen evaluation set.

## Priority 7 — Complete live workflow and browser evidence (A5/G5)

- [ ] Run receipt image, PDF, EICAR quarantine, review, and create-expense-draft workflows through
      the actual UI and worker.
- [ ] Run the pending Phase 13 Playwright workflow suites.
- [ ] Resolve general release-gate E2E and visual-baseline failures before merging release work.

**Acceptance:** The full user journey works with live infrastructure and the release evidence is
recorded in the Phase 13 tracker.

## Recommended next implementation slice

1. Stop the local API dev process briefly and run `npm test` plus
   `AI_MODE=off npm run test:integration` to complete the blocked integration evidence.
2. Add endpoint-level integration tests for approval lifecycle, role boundaries, and assistant
   capability switches.
3. Continue Priority 3: sandbox and resource-limit document extraction before enabling untrusted
   production uploads.

The code controls are complete, but hosted mode remains off until legal decisions, integration
evidence, and the later operational/privacy controls in this document are complete.
