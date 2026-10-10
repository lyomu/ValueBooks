# Phase 14 release gate

**Status:** engineering hardening is in progress; public launch remains blocked until every item in
the release-sign-off section is independently recorded. This document replaces the misleading
"not started" shorthand in the roadmap with the evidence required to close the phase safely.

## Engineering evidence

| Track                      | Evidence in the repository                                                                                                                                                                                                                                                                                                                                                                                                                                  | Gate status                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Accounting correctness     | `accounting-invariants.int.test.ts`, `cross-module-scenarios.int.test.ts`, `reporting.int.test.ts`, `fx-revaluation.int.test.ts`, and `opening-balances.int.test.ts` cover balanced entries, control-account ties, period locks, reversals, foreign currency, and opening balances.                                                                                                                                                                         | Automated evidence required in final suite                 |
| Tenant isolation           | Cross-organization scenarios are covered in `cross-module-scenarios.int.test.ts`; export/status reads are organization-scoped; workflow actions scope task lookup to the event organization.                                                                                                                                                                                                                                                                | Automated evidence required in final suite                 |
| Security                   | Identity/rate-limit coverage is in `identity-tenancy.int.test.ts`; permission guards, upload validation, immutable audit history, and secret environment validation are in the application. **MFA is not implemented** — only the `security.mfa.manage` permission key exists, with no TOTP code (`docs/PENDING_WORK.md` item 15).                                                                                                                          | Security review and dependency scan still require sign-off |
| Reliability and operations | Durable queue execution, retry/idempotency, outbox delivery, scheduled-job history, and `AUTOMATION_OPERATIONS_RUNBOOK.md` provide recovery procedures. **Caveat:** the background worker could not boot at all until 2026-10-10 — `worker-app.module.ts` was missing `DatabaseModule`, so no document extraction, automation, or scheduled job ran outside the API process; fixed in the P0 session. Treat any earlier "worker verified" claim as suspect. | Backup/restore drill still requires evidence               |
| Import and migration       | Bank import, opening balances, and transaction import flows have dedicated integration suites.                                                                                                                                                                                                                                                                                                                                                              | Automated evidence required in final suite                 |
| Performance                | Only interactive XLSX export streams (`report-export.service.ts`); CSV export and stored/async report artifacts (`report-artifact.service.ts`) still build the whole file in memory (`docs/PENDING_WORK.md` item 33). Large PDF work is queued to a durable worker once over 2,000 rows.                                                                                                                                                                    | Production-volume benchmark still requires evidence        |
| Accessibility              | Shared accessible primitives and end-to-end journeys are present.                                                                                                                                                                                                                                                                                                                                                                                           | Keyboard and WCAG 2.2 AA review still requires sign-off    |

## Final execution order

1. Run `npm run format:check`, `npm run lint`, `npm run typecheck`, unit tests, API and web builds.
2. Run the full sequential integration suite with Compose PostgreSQL/Redis/MinIO available.
3. Execute and record the backup/restore drill against a non-production environment.
4. Run dependency/security scanning and the keyboard/screen-reader accessibility review.
5. Record legal/privacy/compliance and country-pack owner approval.

## Release sign-off (human authority required)

- [ ] Security owner: threat model, dependency scan, secrets and access-control review approved.
- [ ] Operations owner: backup/restore and incident/recovery drill approved.
- [ ] Accessibility owner: keyboard and WCAG 2.2 AA-oriented review approved.
- [ ] Legal/compliance owner: terms, privacy claims, AI disclosures, and country-pack sign-off approved.

These four attestations cannot be inferred from source code or automated tests. They are the only
non-engineering conditions that prevent a truthful public-launch declaration.
