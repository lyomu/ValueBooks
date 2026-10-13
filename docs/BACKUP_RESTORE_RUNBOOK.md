# Backup and Restore Runbook

## Scope

This runbook covers backing up and restoring ValueBooks' PostgreSQL database and MinIO
attachment storage in the local Docker Compose environment, and records the first
disaster-recovery drill run against it (PENDING_WORK #16, GAPS #12/#33).

It does **not** cover Redis. BullMQ job state is not the durable source of truth: every
job is backed by a database row (`DomainEventOutbox` for domain events, `ScheduledJob`/
`ScheduledJobExecution` for recurring work), and `outbox-relay.service.ts` re-drives
pending work from those tables once a worker reconnects. A lost Redis instance loses
in-flight queue position, not data — the worker rebuilds its queue from the database on
restart. Backing up Redis would add operational weight without reducing data-loss risk.

## Components backed up

| Component                 | Tool                                                 | What's captured                             | What's excluded                                       |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| PostgreSQL (`valuebooks`) | `pg_dump -Fc`                                        | Full schema, data, RLS policies, RLS is DDL | Nothing — custom-format dump is a full logical backup |
| MinIO attachments         | `mc mirror` (via the MinIO container's bundled `mc`) | All objects in the target bucket            | Nothing within the bucket                             |
| Redis / BullMQ            | —                                                    | —                                           | Entire component — see Scope above                    |

## Drill environment

The drill never touches `valuebooks`, `valuebooks_test`, `valuebooks_e2e`, or the
existing objects in the `valuebooks-local` bucket. Every script in
`infrastructure/backup/` refuses to run against those names (see
`infrastructure/backup/lib/constants.js`).

| Role           | Database                   | Bucket                                                                                              |
| -------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| Drill source   | `valuebooks_drill`         | `valuebooks-local` (shared dev bucket — seeding only adds new objects, never touches existing ones) |
| Restore target | `valuebooks_drill_restore` | `valuebooks-drill-restore`                                                                          |

## Scripts

All scripts are plain Node (no new dependencies) under `infrastructure/backup/`, and
shell out to `docker exec`/`docker cp` against the running Compose containers.

| Script              | Purpose                                                                | Example invocation                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `setup-drill-db.js` | Creates `valuebooks_drill`, migrates it, seeds demo data + attachments | `node infrastructure/backup/setup-drill-db.js`                                                                                          |
| `backup.js`         | `pg_dump -Fc` + MinIO mirror + manifest                                | `node infrastructure/backup/backup.js [--db valuebooks_drill] [--bucket valuebooks-local]`                                              |
| `restore.js`        | Fresh db/bucket, `pg_restore`, role grants, RLS check, boot + verify   | `node infrastructure/backup/restore.js --from latest [--target-db valuebooks_drill_restore] [--target-bucket valuebooks-drill-restore]` |
| `compare.js`        | Row counts, trial balance, login, attachment download, evidence        | `node infrastructure/backup/compare.js [--source-db ...] [--restored-db ...] [--out latest]`                                            |

## Procedure

1. `npm run infra:up` — Postgres, Redis, MinIO, Mailpit, and ClamAV must all be healthy.
2. `node infrastructure/backup/setup-drill-db.js` — creates and seeds `valuebooks_drill`.
   Confirms MinIO is reachable first; the demo seed uploads real attachments through the
   application's own `AttachmentsService`, so this step proves attachments are seedable,
   not just that rows exist.
3. `node infrastructure/backup/backup.js` — produces a timestamped folder under
   `infrastructure/backup/.output/` with `dump.pgdump`, a mirrored `objects/` folder, and
   `manifest.json` (duration, dump size, object count/size, latest migration).
4. `node infrastructure/backup/restore.js --from latest` — creates
   `valuebooks_drill_restore`, restores the dump with `pg_restore --no-owner`, re-applies
   the runtime-role grants from `infrastructure/postgres-runtime-role.sql`, queries
   `pg_policies` to confirm RLS survived, mirrors the bucket back in, boots a transient API
   instance against the restored environment, and asserts `GET /health/ready` is healthy
   and `prisma migrate status` reports up to date. Writes `restore-manifest.json` next to
   the backup (duration here is the measured recovery time).
5. `node infrastructure/backup/compare.js --out latest` — diffs row counts for
   `journals`, `journal_lines`, `invoices`, `payments_received`, `payments_made`,
   `contacts`, and `attachments`; boots both the source and restored API instances, logs in
   as the seeded demo user on each, fetches and compares trial balance totals, and
   downloads one attachment from the restored instance. Writes `evidence.json`/
   `evidence.md` into the same output folder (gitignored) and prints a sanitized summary.
6. Paste the printed summary into this runbook's "Measured numbers" section below.

## Verification checklist

- [ ] All row counts match between source and restored database
- [ ] Trial balance debit/credit totals and `balanced` flag match
- [ ] A login against the restored instance succeeds
- [ ] An attachment downloads successfully from the restored instance
- [ ] `GET /health/ready` on the restored instance reports `ok`
- [ ] `prisma migrate status` against the restored database reports up to date
- [ ] RLS policies exist on `ai_runs`, `ai_evidence`, `ai_suggestions`, `ai_feedback` in the restored database
- [ ] `valuebooks`, `valuebooks_test`, `valuebooks_e2e`, and the `valuebooks-local` bucket's existing objects are unchanged

## Measured numbers (drill run 2026-10-10)

**Backup**

| Metric                    | Value                                        |
| ------------------------- | -------------------------------------------- |
| Duration                  | 7.98s                                        |
| Dump size                 | 731,330 bytes (714 KB)                       |
| Objects mirrored          | 505 objects, 11,264,177 bytes (10.7 MB)      |
| Latest migration captured | `20261008090000_add_user_profile_completion` |

**Restore**

| Metric                            | Value                                                                    |
| --------------------------------- | ------------------------------------------------------------------------ |
| Duration (measured recovery time) | 18.1s                                                                    |
| RLS policies verified             | `ai_runs`, `ai_evidence`, `ai_suggestions`, `ai_feedback` — all present  |
| `/health/ready`                   | `ok` (postgres, redis, minio, email-delivery, automation, outbox all up) |
| `prisma migrate status`           | up to date                                                               |

**Comparison**

| Table             | Source | Restored | Match |
| ----------------- | -----: | -------: | :---: |
| journals          |     84 |       84 |  yes  |
| journal_lines     |    189 |      189 |  yes  |
| invoices          |     14 |       14 |  yes  |
| payments_received |      6 |        6 |  yes  |
| payments_made     |      3 |        3 |  yes  |
| contacts          |      9 |        9 |  yes  |
| attachments       |      4 |        4 |  yes  |

Trial balance: debit = credit = 141,553,240 minor units on both source and restored,
`balanced: true` on both. Login succeeded on both instances as
`demo.owner@valuebooks.local`. Attachment download from the restored instance returned
`200` with 56 bytes.

## Recovery time and recovery point

**Recovery time (RTO):** the scripted restore — recreate database, `pg_restore`,
re-grant the runtime role, verify RLS, mirror the bucket back in, boot the API, and
confirm health/migrations — took **18.1 seconds** against a ~730 KB dump and ~11 MB of
attachments on local Docker Compose. This measures the restore procedure itself, not a
full incident response; a real outage also includes time to notice the failure, provision
replacement infrastructure, and redirect traffic, none of which this drill can measure
locally.

**Recovery point (RPO):** backups today are on-demand only — there is no scheduled backup
job. The recovery point is therefore **however long it has been since the last manual
backup.run**, which is an open-ended and unacceptable RPO for production. This is the
other half of GAPS #12 ("disaster procedures") this drill does not close by itself.

**Recommended schedule:** a nightly `pg_dump` plus MinIO mirror as a minimum baseline,
with a goal of hourly snapshots once the backup job is automated (e.g. a scheduled job
hitting `backup.js`'s same steps against the production database), giving an RPO of at
most one hour. In production this should be paired with the managed database's own
continuous backup/point-in-time recovery (see below), which gives a much tighter RPO than
periodic dumps alone.

## Known limitations

- The restore target reuses the same Postgres/MinIO containers as the drill source
  (a new database and bucket, not a fully separate environment) — this is one of the two
  options the drill scope allows and keeps the drill runnable without a second Compose
  stack, but it does not prove the restore works against infrastructure that is
  completely absent, only against infrastructure that is present but empty.
- RLS verification only checks the four tables that currently carry row-level security
  policies. If a future migration adds RLS to another table, this runbook's verification
  query (and `infrastructure/backup/lib/constants.js`'s `RLS_TABLES` list) must be updated.
- The attachment check is a single spot-check (the oldest seeded attachment), not an
  exhaustive integrity check of every mirrored object.
- No automated recurring backup job exists yet; this runbook documents the manual
  procedure a scheduled job should eventually run unattended.

## Production differences

- **Point-in-time recovery:** a managed PostgreSQL service (e.g. RDS, Cloud SQL) provides
  continuous WAL-based backup and point-in-time restore, giving a recovery point measured
  in minutes rather than "since the last manual dump." Production should rely on this
  rather than solely on periodic `pg_dump`.
- **Object storage versioning:** production S3 (or equivalent) should have versioning and
  cross-region replication enabled, so individual object loss or corruption is recoverable
  without a full bucket restore.
- **Secrets:** the drill uses the local, hardcoded `valuebooks_app` password from
  `infrastructure/postgres-init.sql`. Production uses
  `infrastructure/postgres-runtime-role.sql`, which takes the password from a secrets
  manager injection, never a value committed to the repository.
- **Role grants:** production's `ALTER DEFAULT PRIVILEGES` for the runtime role must be
  re-run by the migration owner after every new table (see the comment in
  `infrastructure/postgres-runtime-role.sql`); the drill's restore script re-grants
  `ALL TABLES IN SCHEMA public` directly, which works after the fact but should not be the
  only mechanism relied on for new tables going forward.

## Troubleshooting

- **Seed shows 0 attachments:** MinIO was not reachable when `setup-drill-db.js` ran.
  `AttachmentsService.upload()` swallows failures and logs `Skipped attachment ...`, so the
  seed "succeeds" with no attachments to verify. Confirm
  `http://127.0.0.1:59300/minio/health/live` responds, then re-run the seed step.
- **`pg_restore` ownership errors:** expected and harmless if it mentions needing
  superuser privileges to set an object's owner — the restore uses `--no-owner`, so these
  are warnings, not failures. A real failure (nonzero exit) means the dump or target
  database is in an unexpected state; recreate the drill database and try again.
- **A restored table is missing its RLS policy:** should not happen, since RLS is DDL
  captured by `pg_dump`. If it does, re-run that table's `CREATE POLICY` statement from
  its originating migration file directly against the restored database.
- **`valuebooks_app` role missing entirely:** only possible on a from-scratch Postgres
  volume where `infrastructure/postgres-init.sql` has not run. Recreate the Postgres
  container (`docker compose up -d` recreates it against the init script) rather than
  trying to create the role by hand.
- **Login fails on a repeated drill run:** `/auth/login` rate-limits at 8 attempts per 15
  minutes per IP+email. Running `compare.js` back-to-back several times in a short window
  can trip this; wait out the window or use a different demo user
  (`demo.admin@valuebooks.local`, `demo.accountant@valuebooks.local`, etc., same password).
