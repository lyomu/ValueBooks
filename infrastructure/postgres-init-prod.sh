#!/bin/bash
# Production runtime-role bootstrap for the dedicated box (161.97.140.207).
#
# WHY THIS EXISTS AS A SHELL SCRIPT, NOT A .sql FILE
# --------------------------------------------------
# `infrastructure/postgres-init.sql` is the *local dev* equivalent and is
# mounted by docker-compose.yml. It can't be reused here: it hardcodes the
# role password (`valuebooks-app-local`) and the migration-owner role name
# (`valuebooks`). Postgres' docker-entrypoint-initdb.d performs no variable
# substitution on `.sql` files, but it *executes* `.sh` files with the
# POSTGRES_* environment available -- so the password and the owner role can
# be injected from .env.production instead of being committed.
#
# WHY THE ORDERING MATTERS
# ------------------------
# Files in docker-entrypoint-initdb.d run exactly once, on an empty data
# directory, before Postgres accepts outside connections -- i.e. strictly
# before scripts/deploy.sh's `prisma migrate deploy`. That is the only point
# at which ALTER DEFAULT PRIVILEGES can be set so that *every* table the 52+
# migrations go on to create is automatically readable/writable by the
# runtime role. Creating the role after migrations instead would require a
# fresh GRANT ... ON ALL TABLES after every future migration that adds a
# table, and forgetting one surfaces as a runtime permission-denied on a
# single endpoint rather than a loud startup failure.
#
# WHY A SEPARATE ROLE AT ALL (don't "simplify" this away)
# -------------------------------------------------------
# apps/api/src/database/database-role.guard.ts refuses to boot the API in
# production if its connection's current_user is a superuser, has BYPASSRLS,
# or owns the `ai_runs`/`ai_evidence` tables. Those tables are protected by
# RLS, which superusers and owners silently evade. POSTGRES_USER is the
# cluster superuser and ends up owning every migrated table, so DATABASE_URL
# can never point at it -- the API would crash-loop on boot. Migrations run
# as POSTGRES_USER (DATABASE_MIGRATION_URL); the API connects as the
# restricted role created below (DATABASE_URL).

set -euo pipefail

if [ -z "${VALUEBOOKS_APP_PASSWORD:-}" ]; then
  echo "postgres-init-prod.sh: VALUEBOOKS_APP_PASSWORD is not set." >&2
  echo "Set it in /srv/valuebooks/prod/.env.production -- it is the password half of" >&2
  echo "DATABASE_URL, and the database is initialized exactly once, so a wrong or" >&2
  echo "missing value here means wiping the volume to fix it." >&2
  exit 1
fi

# psql's :'var' binding quotes/escapes the value properly, so the password
# never goes through shell interpolation into the SQL text.
psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     -v app_password="$VALUEBOOKS_APP_PASSWORD" \
     -v owner="$POSTGRES_USER" \
     -v dbname="$POSTGRES_DB" <<'EOSQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valuebooks_app') THEN
    CREATE ROLE valuebooks_app
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE valuebooks_app PASSWORD :'app_password';

GRANT CONNECT ON DATABASE :"dbname" TO valuebooks_app;
GRANT USAGE ON SCHEMA public TO valuebooks_app;

-- Applies to tables/sequences created *later* by the migration owner, which
-- is the whole point of running at init time. See the ordering note above.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO valuebooks_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO valuebooks_app;
EOSQL

echo "postgres-init-prod.sh: created restricted runtime role valuebooks_app and default privileges for ${POSTGRES_USER}."
