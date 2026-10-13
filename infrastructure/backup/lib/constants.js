'use strict';

// Databases the drill must never create, drop, restore over, or otherwise touch.
const PROTECTED_DATABASES = Object.freeze(['valuebooks', 'valuebooks_test', 'valuebooks_e2e']);

// The dev bucket already has real (if disposable) objects in it from normal local
// development. The drill backs it up and seeds into it, but must never mirror objects
// out of a restore into it.
const PROTECTED_BUCKETS = Object.freeze(['valuebooks-local']);

const POSTGRES_CONTAINER = 'valuebooks-postgres-1';
const POSTGRES_OWNER_USER = 'valuebooks';
const POSTGRES_APP_USER = 'valuebooks_app';
const POSTGRES_APP_PASSWORD = 'valuebooks-app-local';
const POSTGRES_HOST_PORT = 55432;

const DOCKER_NETWORK = 'valuebooks_default';
// The running MinIO server container already bundles the `mc` client, so mirroring runs
// via `docker exec` into it (reaching itself over loopback) instead of pulling a separate
// `minio/mc` image — which, as of this writing, Docker Hub no longer serves anonymously.
const MINIO_CONTAINER = 'valuebooks-minio-1';
const MINIO_IN_CONTAINER_ENDPOINT = 'http://127.0.0.1:9000';
const MINIO_ROOT_USER = 'valuebooks';
const MINIO_ROOT_PASSWORD = 'valuebooks-local';
const MINIO_HOST_ENDPOINT = 'http://127.0.0.1:59300';

const DRILL_DB = 'valuebooks_drill';
const DRILL_BUCKET = 'valuebooks-local';
const DEFAULT_RESTORE_DB = 'valuebooks_drill_restore';
const DEFAULT_RESTORE_BUCKET = 'valuebooks-drill-restore';

const RLS_TABLES = Object.freeze(['ai_runs', 'ai_evidence', 'ai_suggestions', 'ai_feedback']);

const ROW_COUNT_TABLES = Object.freeze([
  'journals',
  'journal_lines',
  'invoices',
  'payments_received',
  'payments_made',
  'contacts',
  'attachments',
]);

const DEMO_USER_EMAIL = 'demo.owner@valuebooks.local';
const DEMO_USER_PASSWORD = 'DemoValueBooks1!';

function assertNotProtectedDatabase(name, label) {
  if (PROTECTED_DATABASES.includes(name)) {
    throw new Error(
      `Refusing to ${label} protected database "${name}". Protected: ${PROTECTED_DATABASES.join(', ')}`,
    );
  }
}

function assertNotProtectedBucket(name, label) {
  if (PROTECTED_BUCKETS.includes(name)) {
    throw new Error(
      `Refusing to ${label} protected bucket "${name}". Protected: ${PROTECTED_BUCKETS.join(', ')}`,
    );
  }
}

module.exports = {
  PROTECTED_DATABASES,
  PROTECTED_BUCKETS,
  POSTGRES_CONTAINER,
  POSTGRES_OWNER_USER,
  POSTGRES_APP_USER,
  POSTGRES_APP_PASSWORD,
  POSTGRES_HOST_PORT,
  DOCKER_NETWORK,
  MINIO_CONTAINER,
  MINIO_IN_CONTAINER_ENDPOINT,
  MINIO_ROOT_USER,
  MINIO_ROOT_PASSWORD,
  MINIO_HOST_ENDPOINT,
  DRILL_DB,
  DRILL_BUCKET,
  DEFAULT_RESTORE_DB,
  DEFAULT_RESTORE_BUCKET,
  RLS_TABLES,
  ROW_COUNT_TABLES,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  assertNotProtectedDatabase,
  assertNotProtectedBucket,
};
