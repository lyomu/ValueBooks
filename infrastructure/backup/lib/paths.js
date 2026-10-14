'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUTPUT_ROOT = path.join(__dirname, '..', '.output');

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function createOutputDir(date = new Date()) {
  const slug = timestampSlug(date);
  const root = path.join(OUTPUT_ROOT, slug);
  const objectsDir = path.join(root, 'objects');
  fs.mkdirSync(objectsDir, { recursive: true });
  return {
    slug,
    root,
    objectsDir,
    dumpPath: path.join(root, 'dump.pgdump'),
    manifestPath: path.join(root, 'manifest.json'),
    restoreManifestPath: path.join(root, 'restore-manifest.json'),
    evidenceJsonPath: path.join(root, 'evidence.json'),
    evidenceMdPath: path.join(root, 'evidence.md'),
  };
}

function resolveOutputDir(slugOrLatest) {
  if (!fs.existsSync(OUTPUT_ROOT)) {
    throw new Error(`No backups found: ${OUTPUT_ROOT} does not exist. Run backup.js first.`);
  }
  let slug = slugOrLatest;
  if (slug === 'latest' || !slug) {
    const entries = fs
      .readdirSync(OUTPUT_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    if (entries.length === 0) {
      throw new Error(`No backup runs found under ${OUTPUT_ROOT}.`);
    }
    slug = entries[entries.length - 1];
  }
  const root = path.join(OUTPUT_ROOT, slug);
  if (!fs.existsSync(root)) {
    throw new Error(`Backup run "${slug}" not found at ${root}.`);
  }
  const objectsDir = path.join(root, 'objects');
  return {
    slug,
    root,
    objectsDir,
    dumpPath: path.join(root, 'dump.pgdump'),
    manifestPath: path.join(root, 'manifest.json'),
    restoreManifestPath: path.join(root, 'restore-manifest.json'),
    evidenceJsonPath: path.join(root, 'evidence.json'),
    evidenceMdPath: path.join(root, 'evidence.md'),
  };
}

module.exports = { OUTPUT_ROOT, createOutputDir, resolveOutputDir, timestampSlug };
