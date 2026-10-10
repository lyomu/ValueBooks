#!/usr/bin/env node
'use strict';

// Compares the drill source database/bucket against the restored one: row counts for the
// key accounting tables, trial balance totals, a login, and an attachment download. Writes
// raw evidence into the backup run's output folder and prints a sanitized summary meant to
// be pasted into docs/BACKUP_RESTORE_RUNBOOK.md.

const fs = require('node:fs');
const { dockerExec } = require('./lib/docker');
const { resolveOutputDir } = require('./lib/paths');
const { buildEnv } = require('./lib/env');
const { startApi } = require('./lib/api-process');
const { login, getTrialBalance, downloadAttachment } = require('./lib/http');
const {
  POSTGRES_CONTAINER,
  POSTGRES_OWNER_USER,
  DRILL_DB,
  DRILL_BUCKET,
  DEFAULT_RESTORE_DB,
  DEFAULT_RESTORE_BUCKET,
  ROW_COUNT_TABLES,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
} = require('./lib/constants');

const SOURCE_API_PORT = 3090;
const RESTORED_API_PORT = 3091;

function parseArgs(argv) {
  const args = {
    sourceDb: DRILL_DB,
    sourceBucket: DRILL_BUCKET,
    restoredDb: DEFAULT_RESTORE_DB,
    restoredBucket: DEFAULT_RESTORE_BUCKET,
    out: 'latest',
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source-db') args.sourceDb = argv[++i];
    else if (argv[i] === '--source-bucket') args.sourceBucket = argv[++i];
    else if (argv[i] === '--restored-db') args.restoredDb = argv[++i];
    else if (argv[i] === '--restored-bucket') args.restoredBucket = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

function rowCount(db, table) {
  const { stdout } = dockerExec(POSTGRES_CONTAINER, [
    'psql',
    '-U',
    POSTGRES_OWNER_USER,
    '-d',
    db,
    '-t',
    '-A',
    '-c',
    `select count(*) from ${table};`,
  ]);
  return Number(stdout.trim());
}

function rowCounts(db) {
  const counts = {};
  for (const table of ROW_COUNT_TABLES) {
    counts[table] = rowCount(db, table);
  }
  return counts;
}

function firstOrganizationId(db) {
  const { stdout } = dockerExec(POSTGRES_CONTAINER, [
    'psql',
    '-U',
    POSTGRES_OWNER_USER,
    '-d',
    db,
    '-t',
    '-A',
    '-c',
    'select id from organizations order by created_at limit 1;',
  ]);
  return stdout.trim();
}

function firstAttachment(db) {
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
    'select id, entity_type, entity_id from attachments order by created_at limit 1;',
  ]);
  const [id, entityType, entityId] = stdout.trim().split('|');
  return { id, entityType, entityId };
}

async function verifyInstance(db, bucket, port, label) {
  const env = buildEnv({ db, bucket, port });
  const api = await startApi(env, { port, label });
  try {
    const organizationId = firstOrganizationId(db);
    const { cookie, user } = await login(api.baseUrl, DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const trialBalance = await getTrialBalance(api.baseUrl, cookie, organizationId);
    const attachment = firstAttachment(db);
    let attachmentDownload = null;
    if (attachment.id) {
      attachmentDownload = await downloadAttachment(
        api.baseUrl,
        cookie,
        organizationId,
        attachment.entityType,
        attachment.entityId,
        attachment.id,
      );
    }
    return {
      organizationId,
      loginUser: user.email,
      trialBalanceTotals: trialBalance.totals,
      attachmentDownload,
    };
  } finally {
    await api.stop();
  }
}

async function main() {
  const { sourceDb, sourceBucket, restoredDb, restoredBucket, out } = parseArgs(
    process.argv.slice(2),
  );
  const output = resolveOutputDir(out);

  console.log('[1/3] Row counts (source vs restored)...');
  const sourceCounts = rowCounts(sourceDb);
  const restoredCounts = rowCounts(restoredDb);
  const rowCountDiffs = {};
  let rowCountsMatch = true;
  for (const table of ROW_COUNT_TABLES) {
    const match = sourceCounts[table] === restoredCounts[table];
    rowCountDiffs[table] = { source: sourceCounts[table], restored: restoredCounts[table], match };
    if (!match) rowCountsMatch = false;
  }

  console.log('[2/3] Booting source and restored API instances for live verification...');
  const sourceVerification = await verifyInstance(
    sourceDb,
    sourceBucket,
    SOURCE_API_PORT,
    'source api',
  );
  const restoredVerification = await verifyInstance(
    restoredDb,
    restoredBucket,
    RESTORED_API_PORT,
    'restored api',
  );

  const trialBalanceMatch =
    sourceVerification.trialBalanceTotals.debitMinor ===
      restoredVerification.trialBalanceTotals.debitMinor &&
    sourceVerification.trialBalanceTotals.creditMinor ===
      restoredVerification.trialBalanceTotals.creditMinor &&
    sourceVerification.trialBalanceTotals.balanced ===
      restoredVerification.trialBalanceTotals.balanced;

  console.log('[3/3] Writing evidence...');
  const evidence = {
    generatedAt: new Date().toISOString(),
    sourceDb,
    sourceBucket,
    restoredDb,
    restoredBucket,
    rowCounts: rowCountDiffs,
    rowCountsMatch,
    trialBalance: {
      source: sourceVerification.trialBalanceTotals,
      restored: restoredVerification.trialBalanceTotals,
      match: trialBalanceMatch,
    },
    login: {
      source: sourceVerification.loginUser,
      restored: restoredVerification.loginUser,
      pass: Boolean(sourceVerification.loginUser && restoredVerification.loginUser),
    },
    attachmentDownload: {
      source: sourceVerification.attachmentDownload,
      restored: restoredVerification.attachmentDownload,
      pass: Boolean(
        restoredVerification.attachmentDownload &&
        restoredVerification.attachmentDownload.status === 200 &&
        restoredVerification.attachmentDownload.bytes > 0,
      ),
    },
  };
  fs.writeFileSync(output.evidenceJsonPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');

  const evidenceMd = `# Backup/restore drill evidence

Generated: ${evidence.generatedAt}
Source: db \`${sourceDb}\`, bucket \`${sourceBucket}\`
Restored: db \`${restoredDb}\`, bucket \`${restoredBucket}\`

## Row counts

| Table | Source | Restored | Match |
| --- | ---: | ---: | :---: |
${ROW_COUNT_TABLES.map(
  (t) =>
    `| ${t} | ${rowCountDiffs[t].source} | ${rowCountDiffs[t].restored} | ${rowCountDiffs[t].match ? 'yes' : 'NO'} |`,
).join('\n')}

All row counts match: **${rowCountsMatch ? 'yes' : 'NO'}**

## Trial balance

| | Source | Restored |
| --- | ---: | ---: |
| Debit (minor units) | ${evidence.trialBalance.source.debitMinor} | ${evidence.trialBalance.restored.debitMinor} |
| Credit (minor units) | ${evidence.trialBalance.source.creditMinor} | ${evidence.trialBalance.restored.creditMinor} |
| Balanced | ${evidence.trialBalance.source.balanced} | ${evidence.trialBalance.restored.balanced} |

Trial balance totals match: **${trialBalanceMatch ? 'yes' : 'NO'}**

## Login

Source login: ${evidence.login.source || 'FAILED'}
Restored login: ${evidence.login.restored || 'FAILED'}

## Attachment download (restored instance)

Status: ${restoredVerification.attachmentDownload ? restoredVerification.attachmentDownload.status : 'N/A'}
Bytes: ${restoredVerification.attachmentDownload ? restoredVerification.attachmentDownload.bytes : 'N/A'}
Pass: **${evidence.attachmentDownload.pass ? 'yes' : 'NO'}**
`;
  fs.writeFileSync(output.evidenceMdPath, evidenceMd, 'utf8');

  const allPass =
    rowCountsMatch && trialBalanceMatch && evidence.login.pass && evidence.attachmentDownload.pass;

  console.log(`\nEvidence written to ${output.evidenceJsonPath} and ${output.evidenceMdPath}`);
  console.log(`\nOverall drill result: ${allPass ? 'PASS' : 'FAIL'}`);
  console.log('\n--- Sanitized summary for docs/BACKUP_RESTORE_RUNBOOK.md ---\n');
  console.log(evidenceMd);

  if (!allPass) {
    throw new Error('One or more comparison checks failed. See evidence above.');
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
