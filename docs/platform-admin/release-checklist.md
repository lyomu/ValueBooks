# Platform Admin: release checklist

**Branch:** `feat/platform-admin-commercial-correctness`, 45 commits and 18 database migrations ahead of `main`.
**Owner of this checklist:** the release owner, who ticks each box and links the evidence. A box is ticked only when the
step was observed to pass, not when it was delegated.

## 0. Owner decisions that affect the release

| Item | Decision needed | Blocks release? |
|---|---|---|
| O4 | `PATCH users/:id/status` target restrictions | **Decided and fixed 2026-10-23.** No longer open |
| O9 | Run the local UAT drill with synthetic tenants; skip staging deployment | **Yes: the local drill is the release requirement** (owner, 2026-10-23). The fixture seeder is built ([uat-plan.md §3](uat-plan.md)); the drill is not run |
| O10 | Webhook retry audit records the real state | **Decided and fixed 2026-10-23.** No longer open |
| O11 | [suspension-policy.md](suspension-policy.md) | **Ratified 2026-10-23.** No longer open |
| O5 | Controlled plan-change workflow and 30-day email notice before increases | **In progress** ([plan](plan-catalog-management-plan.md)). The 30-day notice is built and enforced per subscriber before Paystack is contacted, so the blanket block on increases is gone. Two things remain before any real price increase: a browser pass over the console flow, and confirming in Paystack **test mode** that an increase on an existing mandate is charged without customer action. New tiers, entitlement versioning and catalog invariants are still unbuilt; do not release them as done |
| O7 | Second approver for country-pack publishing | **Decided 2026-10-23: not needed.** No longer open |
| O8 | Make recurring retry complete safely without duplicate documents | **Code and focused integration checks complete.** Run the production read-only [legacy claim check](runbooks/recurring-claim-reconciliation.md), reconcile any old claims, and require Jenkins accounting integration checks before release |
| O3 | Read-only production catalog check ([runbook](runbooks/plan-catalog-verification.md)) | **Yes: run before deploy (§2)** |
| O6 | Production run of the [dropped-renewals report](runbooks/dropped-renewals-report.md) | Run after deploy (§4) |

## 1. Before merge

- [ ] Jenkins **Lint**, **Typecheck** and **Test** green on the branch head.
- [ ] Jenkins **Test (integration)** green, including the migration-drift step. **Mandatory:** this branch changes
      billing, authorization, audit storage and tenant-visible behaviour.
- [ ] Platform browser spec run locally and passed ([qa-test-plan.md §4](qa-test-plan.md)). Date and result: ____.
- [ ] Code review done. The PR description lists the 18 migrations and links this checklist.
- [ ] **Local UAT drill run and signed off** ([uat-plan.md](uat-plan.md)), using synthetic tenants and Paystack test
      mode. Seed the four §22.4 fixtures with `ALLOW_UAT_FIXTURES=true npm run uat:fixtures`. Date, who ran it
      and the result: ____. **Not yet done, and not satisfied by fixture verification alone.**
- [ ] Unrelated local files are not in the PR (`apps/web/next-env.d.ts`, `.freebuff/`, `.tmp-*.png`, `apps/web/AGENTS.md`).

## 2. Before deploy

- [ ] **Establish what production holds.** The go-live runbook (2026-10-20) says nothing has ever been deployed, but O3
      reports a live admin Plans page. Run the O3 read-only check and record the answer here: ____.
- [ ] **No live Paddle subscriptions.** If production has data, run read-only:
      `SELECT count(*) FROM organization_subscriptions WHERE billing_provider = 'PADDLE' AND status IN ('ACTIVE','PAST_DUE','CANCEL_SCHEDULED');`
      It must be 0. Otherwise the consolidation migration aborts the deploy by design, and the owner must reconcile
      those subscriptions first.
- [ ] **If production has data:** take a backup with the procedure in `docs/BACKUP_RESTORE_RUNBOOK.md` and confirm
      it restores (`restore.js`, then `compare.js`).
- [ ] **Rehearse the migrations** on a restored copy, never on production: `npx prisma migrate deploy` against the
      restore target, then compare. Seven migrations change data. All of it is reference data or scheduled jobs; none
      touches subscriber data. Check each result:

| Migration | Data it changes | Check after rehearsal |
|---|---|---|
| `20261014065845_add_billing_providers_transactions_usage` | Back-fills `plans.tier_key` from `key` | No plan has a null `tier_key` |
| `20261014070000_seed_official_plan_catalog` | Retires `free`/`growth`/`scale` placeholders; inserts the eight official plans and their entitlements | O3 query 3 returns no rows; subscriber counts unchanged |
| `20261014080000_correct_advanced_unlimited_entitlements` | Enables Advanced's unlimited entitlements | Matches `OFFICIAL_PLAN_CATALOG` |
| `20261014091000_end_trial_one_shots` | Sets an end date on trial reminder and expiry jobs | Each such job has `schedule.endDate` |
| `20261014092000_billing_maintenance_jobs` | Inserts one billing maintenance job per organization | One `billing.maintenance` job per organization |
| `20261016100000_consolidate_paystack_billing` | **Stops the deploy** (raises an exception) if any Paddle subscription is ACTIVE, PAST_DUE or CANCEL_SCHEDULED; otherwise sets Starter monthly and yearly to Paystack and clears their old Paddle ids | Starter's two Paystack codes must then be entered (Providers page) |
| `20261022090000_correct_professional_unlimited_entitlements` | Enables Professional's unlimited quotes and sales orders | Matches `OFFICIAL_PLAN_CATALOG` |

      The other 11 migrations only add tables, columns, constraints or (D9) a trigger.
- [ ] **Paystack:** the eight plan codes are entered and the Providers page shows 8 of 8 ready, in the live
      environment, with live keys. Sandbox keys must not be present in production.
- [ ] **Environment:** `BILLING_PAST_DUE_GRACE_DAYS` is set deliberately (default 3).

## 3. Deploy

- [ ] Follow `devops-infra/docs/VALUEBOOKS_GO_LIVE_RUNBOOK.md` for Approval and Deploy Prod. `scripts/deploy.sh`
      runs `prisma migrate deploy`.
- [ ] Deploy log shows all 18 migrations applied, and no `rolled_back_at` in `_prisma_migrations`.

## 4. After deploy

- [ ] Smoke Tests (Prod) green.
- [ ] Sign in to the console as a superadmin. Overview, Organizations, Billing (Providers 8/8), Jobs and queues,
      Security events and Audit logs load without errors.
- [ ] Audit append-only is active: `SELECT tgname FROM pg_trigger WHERE tgname = 'platform_audit_events_append_only';`
      returns one row.
- [ ] O6: run the dropped-renewals report and file its output with the owner.
- [ ] Jobs and queues: the worker is consuming (waiting count and oldest-waiting age are not growing).

## 5. Rollback

- **Application:** redeploy the previous images. No migration on this branch drops or renames a table or column,
  so rolling the schema back is not part of an application rollback. Whether the previous image works against the
  new schema has **not been tested**. Rehearse it on the §2 restored copy if a rollback path is required for
  sign-off.
- **Data:** if a data-changing migration produced a wrong result, restore from the §2 backup. Do not hand-edit
  `plans` or `plan_entitlements`.
- **D9 trigger:** an older application never edits or deletes platform audit rows, so it is unaffected. Removing the
  trigger is a reviewed migration, never an ad hoc statement.
- **Runbooks for incidents after release:** [runbooks/](runbooks/).
