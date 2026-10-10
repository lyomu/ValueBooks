'use strict';

const {
  POSTGRES_APP_USER,
  POSTGRES_APP_PASSWORD,
  POSTGRES_OWNER_USER,
  POSTGRES_HOST_PORT,
} = require('./constants');

const POSTGRES_OWNER_PASSWORD = 'valuebooks';

function databaseUrl(db) {
  return `postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@127.0.0.1:${POSTGRES_HOST_PORT}/${db}`;
}

function databaseMigrationUrl(db) {
  return `postgresql://${POSTGRES_OWNER_USER}:${POSTGRES_OWNER_PASSWORD}@127.0.0.1:${POSTGRES_HOST_PORT}/${db}`;
}

/**
 * Builds a full environment object for a child process (API boot, prisma CLI, or seed),
 * cloned from this process's own env with the drill's DB/bucket/port overrides applied.
 * `apps/api`'s ConfigModule loads `apps/api/.env` for anything not already present in the
 * child's env, so only the keys that must differ from local dev need to be set here.
 */
function buildEnv({ db, bucket, port, allowDemoSeed } = {}) {
  const env = { ...process.env };
  if (db) {
    env.DATABASE_URL = databaseUrl(db);
    env.DATABASE_MIGRATION_URL = databaseMigrationUrl(db);
  }
  if (bucket) {
    env.S3_BUCKET = bucket;
  }
  if (port) {
    env.API_PORT = String(port);
  }
  if (allowDemoSeed) {
    env.ALLOW_DEMO_SEED = 'true';
  }
  return env;
}

module.exports = { buildEnv, databaseUrl, databaseMigrationUrl };
