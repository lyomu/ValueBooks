#!/usr/bin/env node
'use strict';

// Restores a backup produced by backup.js into a fresh database and bucket, re-applies
// the runtime-role grants, verifies RLS policies survived, mirrors the bucket back in,
// boots a transient API against the restored environment, and confirms it is healthy and
// migrated. Never touches `valuebooks`, `valuebooks_test`, `valuebooks_e2e`, the drill
// source database, or the `valuebooks-local` bucket.

const path = require('node:path');
const { dockerExec, dockerCpToContainer } = require('./lib/docker');
const { resolveOutputDir } = require('./lib/paths');
const { writeManifest } = require('./lib/manifest');
const { buildEnv } = require('./lib/env');
const { startApi } = require('./lib/api-process');
const { getHealthReady } = require('./lib/http');
const { run, NPX } = require('./lib/run');
const {
  POSTGRES_CONTAINER,
  POSTGRES_OWNER_USER,
  POSTGRES_APP_USER,
  DRILL_DB,
  MINIO_CONTAINER,
  MINIO_IN_CONTAINER_ENDPOINT,
  MINIO_ROOT_USER,
  MINIO_ROOT_PASSWORD,
  DEFAULT_RESTORE_DB,
  DEFAULT_RESTORE_BUCKET,
  RLS_TABLES,
  assertNotProtectedDatabase,
  assertNotProtectedBucket,
} = require('./lib/constants');

const API_ROOT = path.join(__dirname, '..', '..', 'apps', 'api');
const MAINTENANCE_DB = 'postgres';
const RESTORE_API_PORT = 3091;
const MC_RESTORE_DIR = '/tmp/restore-drill-mirror';

function parseArgs(argv) {
  const args = {
    from: 'latest',
    targetDb: DEFAULT_RESTORE_DB,
    targetBucket: DEFAULT_RESTORE_BUCKET,
    port: RESTORE_API_PORT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') args.from = argv[++i];
    else if (argv[i] === '--target-db') args.targetDb = argv[++i];
    else if (argv[i] === '--target-bucket') args.targetBucket = argv[++i];
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
  }
  return args;
}

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

function recreateDatabase(targetDb) {
  psql(`DROP DATABASE IF EXISTS ${targetDb};`);
  psql(`CREATE DATABASE ${targetDb} OWNER ${POSTGRES_OWNER_USER};`);
}

function restoreDump(targetDb, dumpPath) {
  const containerDumpPath = '/tmp/restore-drill.pgdump';
  dockerCpToContainer(dumpPath, POSTGRES_CONTAINER, containerDumpPath);
  dockerExec(POSTGRES_CONTAINER, [
    'pg_restore',
    '-U',
    POSTGRES_OWNER_USER,
    '-d',
    targetDb,
    '--no-owner',
    containerDumpPath,
  ]);
  dockerExec(POSTGRES_CONTAINER, ['rm', '-f', containerDumpPath]);
}

function regrantRuntimeRole(targetDb) {
  // Mirrors infrastructure/postgres-runtime-role.sql's GRANT statements (the production
  // template), applied against the restored database. CREATE ROLE is skipped: the role is
  // cluster-global and already exists from local provisioning.
  psql(`GRANT CONNECT ON DATABASE ${targetDb} TO ${POSTGRES_APP_USER};`, targetDb);
  psql(`GRANT USAGE ON SCHEMA public TO ${POSTGRES_APP_USER};`, targetDb);
  psql(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${POSTGRES_APP_USER};`,
    targetDb,
  );
}

function verifyRlsPolicies(targetDb) {
  const tableList = RLS_TABLES.map((t) => `'${t}'`).join(',');
  const { stdout } = dockerExec(POSTGRES_CONTAINER, [
    'psql',
    '-U',
    POSTGRES_OWNER_USER,
    '-d',
    targetDb,
    '-t',
    '-A',
    '-c',
    `select tablename from pg_policies where tablename in (${tableList}) order by tablename;`,
  ]);
  const found = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const missing = RLS_TABLES.filter((t) => !found.includes(t));
  if (missing.length > 0) {
    throw new Error(`RLS policies missing after restore for: ${missing.join(', ')}`);
  }
  return { checked: RLS_TABLES, found };
}

function mcAlias(alias) {
  dockerExec(MINIO_CONTAINER, [
    'mc',
    'alias',
    'set',
    alias,
    MINIO_IN_CONTAINER_ENDPOINT,
    MINIO_ROOT_USER,
    MINIO_ROOT_PASSWORD,
  ]);
}

function restoreBucket(targetBucket, objectsDir) {
  mcAlias('restore');
  dockerExec(MINIO_CONTAINER, ['mc', 'mb', '--ignore-existing', `restore/${targetBucket}`]);
  dockerExec(MINIO_CONTAINER, ['rm', '-rf', MC_RESTORE_DIR]);
  dockerExec(MINIO_CONTAINER, ['mkdir', '-p', MC_RESTORE_DIR]);
  dockerCpToContainer(`${objectsDir}/.`, MINIO_CONTAINER, MC_RESTORE_DIR);
  dockerExec(MINIO_CONTAINER, [
    'mc',
    'mirror',
    '--overwrite',
    MC_RESTORE_DIR,
    `restore/${targetBucket}`,
  ]);
  dockerExec(MINIO_CONTAINER, ['rm', '-rf', MC_RESTORE_DIR]);
}

async function bootAndVerifyApi(targetDb, targetBucket, port) {
  const env = buildEnv({ db: targetDb, bucket: targetBucket, port });
  const api = await startApi(env, { port, label: 'restored api' });
  try {
    const health = await getHealthReady(api.baseUrl);
    const migrateEnv = buildEnv({ db: targetDb });
    let migrateStatusOutput = '';
    try {
      run(NPX, ['prisma', 'migrate', 'status'], { cwd: API_ROOT, env: migrateEnv });
      migrateStatusOutput = 'up to date (exit 0)';
    } catch (error) {
      migrateStatusOutput = `FAILED: ${error.message}`;
    }
    return { health, migrateStatusOutput };
  } finally {
    await api.stop();
  }
}

async function main() {
  const { from, targetDb, targetBucket, port } = parseArgs(process.argv.slice(2));

  assertNotProtectedDatabase(targetDb, 'restore into');
  assertNotProtectedBucket(targetBucket, 'restore into');
  if (targetDb === DRILL_DB) {
    throw new Error(`Restore target database must differ from the drill source "${DRILL_DB}".`);
  }

  const backup = resolveOutputDir(from);
  console.log(`Restoring from ${backup.slug} into db "${targetDb}" / bucket "${targetBucket}"`);

  const startedAt = new Date();

  console.log('[1/6] Recreating target database...');
  recreateDatabase(targetDb);

  console.log('[2/6] pg_restore (--no-owner)...');
  restoreDump(targetDb, backup.dumpPath);

  console.log('[3/6] Re-applying runtime role grants...');
  regrantRuntimeRole(targetDb);

  console.log('[4/6] Verifying RLS policies survived the restore...');
  const rls = verifyRlsPolicies(targetDb);

  console.log('[5/6] Restoring MinIO bucket...');
  restoreBucket(targetBucket, backup.objectsDir);

  console.log('[6/6] Booting a transient API against the restored environment...');
  const { health, migrateStatusOutput } = await bootAndVerifyApi(targetDb, targetBucket, port);

  const finishedAt = new Date();
  const manifest = {
    kind: 'restore',
    fromBackup: backup.slug,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    targetDb,
    targetBucket,
    rls,
    healthReady: health.status === 200,
    health: health.body,
    migrateStatus: migrateStatusOutput,
  };
  writeManifest(backup.restoreManifestPath, manifest);

  console.log(`\nRestore complete in ${manifest.durationMs}ms (measured RTO candidate):`);
  console.log(JSON.stringify(manifest, null, 2));

  if (!manifest.healthReady) {
    throw new Error('Restored API did not report /health/ready as healthy.');
  }
  if (!migrateStatusOutput.startsWith('up to date')) {
    throw new Error(`prisma migrate status did not report up to date: ${migrateStatusOutput}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
