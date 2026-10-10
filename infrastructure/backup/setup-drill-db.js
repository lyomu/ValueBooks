#!/usr/bin/env node
'use strict';

// Step 1 of the backup/restore drill: create a disposable `valuebooks_drill` database,
// migrate it, and seed it with realistic demo data (including real MinIO attachments).
// Never touches `valuebooks`, `valuebooks_test`, or `valuebooks_e2e`.

const path = require('node:path');
const { dockerExec } = require('./lib/docker');
const { run, NPM, NPX } = require('./lib/run');
const { buildEnv } = require('./lib/env');
const {
  POSTGRES_CONTAINER,
  POSTGRES_OWNER_USER,
  POSTGRES_APP_USER,
  DRILL_DB,
  DRILL_BUCKET,
  MINIO_HOST_ENDPOINT,
  assertNotProtectedDatabase,
} = require('./lib/constants');

const API_ROOT = path.join(__dirname, '..', '..', 'apps', 'api');

// `postgres` is Postgres's own maintenance database, used only for the DROP/CREATE
// DATABASE statements that cannot run against the database being dropped.
const MAINTENANCE_DB = 'postgres';

function psql(sql, database = MAINTENANCE_DB) {
  return dockerExec(POSTGRES_CONTAINER, [
    'psql',
    '-U',
    POSTGRES_OWNER_USER,
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
}

async function assertMinioUp() {
  const response = await fetch(`${MINIO_HOST_ENDPOINT}/minio/health/live`).catch(() => null);
  if (!response || !response.ok) {
    throw new Error(
      `MinIO does not appear to be up at ${MINIO_HOST_ENDPOINT}/minio/health/live. ` +
        'Attachments would silently fail to seed. Run `npm run infra:up` and retry.',
    );
  }
}

async function main() {
  assertNotProtectedDatabase(DRILL_DB, 'create');

  console.log(`[1/5] Ensuring MinIO is reachable before seeding attachments...`);
  await assertMinioUp();

  console.log(`[2/5] Recreating database "${DRILL_DB}"...`);
  psql(`DROP DATABASE IF EXISTS ${DRILL_DB};`);
  psql(`CREATE DATABASE ${DRILL_DB} OWNER ${POSTGRES_OWNER_USER};`);

  console.log(`[3/5] Running prisma migrate deploy against "${DRILL_DB}"...`);
  const migrateEnv = buildEnv({ db: DRILL_DB });
  run(NPX, ['prisma', 'migrate', 'deploy'], { cwd: API_ROOT, env: migrateEnv });

  console.log(`[4/5] Granting the runtime role access on "${DRILL_DB}"...`);
  psql(`GRANT CONNECT ON DATABASE ${DRILL_DB} TO ${POSTGRES_APP_USER};`, DRILL_DB);
  psql(`GRANT USAGE ON SCHEMA public TO ${POSTGRES_APP_USER};`, DRILL_DB);
  psql(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${POSTGRES_APP_USER};`,
    DRILL_DB,
  );

  console.log(`[5/5] Seeding "${DRILL_DB}" with demo data and attachments...`);
  const seedEnv = buildEnv({ db: DRILL_DB, bucket: DRILL_BUCKET, allowDemoSeed: true });
  run(NPM, ['run', 'db:seed'], { cwd: API_ROOT, env: seedEnv });

  console.log(`\nDrill database "${DRILL_DB}" is ready (bucket "${DRILL_BUCKET}").`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
