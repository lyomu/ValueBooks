#!/usr/bin/env node
'use strict';

// Backs up a drill database (pg_dump, custom format) and its MinIO bucket (mc mirror)
// into a timestamped folder under infrastructure/backup/.output/, with a manifest
// recording how long it took, how big the dump/objects are, and the latest migration.

const fs = require('node:fs');
const { dockerExec, dockerCpToHost } = require('./lib/docker');
const { createOutputDir } = require('./lib/paths');
const { writeManifest } = require('./lib/manifest');
const {
  POSTGRES_CONTAINER,
  POSTGRES_OWNER_USER,
  DRILL_DB,
  DRILL_BUCKET,
  MINIO_CONTAINER,
  MINIO_IN_CONTAINER_ENDPOINT,
  MINIO_ROOT_USER,
  MINIO_ROOT_PASSWORD,
  assertNotProtectedDatabase,
} = require('./lib/constants');

const MC_MIRROR_DIR = '/tmp/backup-drill-mirror';

function parseArgs(argv) {
  const args = { db: DRILL_DB, bucket: DRILL_BUCKET };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--bucket') args.bucket = argv[++i];
  }
  return args;
}

function latestMigration(db) {
  const { stdout } = dockerExec(POSTGRES_CONTAINER, [
    'psql',
    '-U',
    POSTGRES_OWNER_USER,
    '-d',
    db,
    '-t',
    '-A',
    '-F',
    '|',
    '-c',
    'select migration_name, finished_at from _prisma_migrations order by finished_at desc nulls last limit 1;',
  ]);
  const [migrationName, finishedAt] = stdout.trim().split('|');
  return { migrationName, finishedAt };
}

function dumpDatabase(db, dumpPath) {
  const containerDumpPath = '/tmp/backup-drill.pgdump';
  dockerExec(POSTGRES_CONTAINER, [
    'pg_dump',
    '-U',
    POSTGRES_OWNER_USER,
    '-d',
    db,
    '-Fc',
    '-f',
    containerDumpPath,
  ]);
  dockerCpToHost(POSTGRES_CONTAINER, containerDumpPath, dumpPath);
  dockerExec(POSTGRES_CONTAINER, ['rm', '-f', containerDumpPath]);
  return fs.statSync(dumpPath).size;
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

function mirrorBucketOut(bucket, objectsDir) {
  mcAlias('drill');
  dockerExec(MINIO_CONTAINER, ['rm', '-rf', MC_MIRROR_DIR]);
  dockerExec(MINIO_CONTAINER, ['mkdir', '-p', MC_MIRROR_DIR]);
  dockerExec(MINIO_CONTAINER, ['mc', 'mirror', '--overwrite', `drill/${bucket}`, MC_MIRROR_DIR]);
  dockerCpToHost(MINIO_CONTAINER, `${MC_MIRROR_DIR}/.`, objectsDir);
  dockerExec(MINIO_CONTAINER, ['rm', '-rf', MC_MIRROR_DIR]);

  const { stdout } = dockerExec(MINIO_CONTAINER, ['mc', 'ls', '-r', '--json', `drill/${bucket}`]);
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let count = 0;
  let bytes = 0;
  for (const line of lines) {
    const entry = JSON.parse(line);
    if (entry.type === 'folder') continue;
    count += 1;
    bytes += entry.size || 0;
  }
  return { count, bytes };
}

async function main() {
  const { db, bucket } = parseArgs(process.argv.slice(2));
  assertNotProtectedDatabase(db, 'back up');

  const startedAt = new Date();
  const output = createOutputDir(startedAt);
  console.log(`Backing up "${db}" / bucket "${bucket}" into ${output.root}`);

  console.log('[1/3] pg_dump (custom format)...');
  const dumpBytes = dumpDatabase(db, output.dumpPath);

  console.log('[2/3] Reading latest migration...');
  const migration = latestMigration(db);

  console.log('[3/3] Mirroring MinIO bucket...');
  const objects = mirrorBucketOut(bucket, output.objectsDir);

  const finishedAt = new Date();
  const manifest = {
    kind: 'backup',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    sourceDb: db,
    sourceBucket: bucket,
    dump: { path: 'dump.pgdump', bytes: dumpBytes, format: 'custom (-Fc)' },
    objects: { count: objects.count, bytes: objects.bytes, mirrorPath: 'objects/' },
    migrations: migration,
  };
  writeManifest(output.manifestPath, manifest);

  console.log(`\nBackup complete in ${manifest.durationMs}ms:`);
  console.log(JSON.stringify(manifest, null, 2));
  console.log(`\nRun folder: ${output.slug}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
