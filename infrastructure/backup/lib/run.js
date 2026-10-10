'use strict';

const { spawnSync } = require('node:child_process');

// npm/npx are .cmd shims on Windows; spawnSync needs the exact executable name since it
// does not go through a shell here.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/**
 * Runs a long-lived command (build/migrate/seed) with inherited stdio so progress is
 * visible, throwing on a non-zero exit. Used for steps where piping output and buffering
 * it would hide useful progress from whoever is running the drill.
 */
function run(command, args, opts = {}) {
  const needsShell = process.platform === 'win32' && /\.cmd$/i.test(command);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: needsShell, ...opts });
  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

module.exports = { run, NPM, NPX };
