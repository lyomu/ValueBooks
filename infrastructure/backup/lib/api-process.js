'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const API_ROOT = path.join(__dirname, '..', '..', '..', 'apps', 'api');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawns the built API (`node dist/src/main.js`) with the given env and polls GET /health
 * until it answers 200 or the timeout elapses. Callers must have already run `npm run
 * build` in apps/api at least once. Returns {baseUrl, stop()}.
 */
async function startApi(env, { port, timeoutMs = 30000, label = 'api' } = {}) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = spawn('node', ['dist/src/main.js'], {
    cwd: API_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  let exited = false;
  let exitInfo = null;
  proc.on('exit', (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
  });

  const deadline = Date.now() + timeoutMs;
  let ready = false;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `${label} process exited early (code=${exitInfo.code}, signal=${exitInfo.signal}) before becoming ready.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Not up yet; keep polling.
    }
    await sleep(500);
  }

  if (!ready) {
    proc.kill('SIGTERM');
    throw new Error(
      `${label} did not become ready within ${timeoutMs}ms.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    );
  }

  async function stop() {
    if (exited) return;
    proc.kill('SIGTERM');
    const stopDeadline = Date.now() + 5000;
    while (!exited && Date.now() < stopDeadline) {
      await sleep(100);
    }
    if (!exited) proc.kill('SIGKILL');
  }

  return { baseUrl, stop, getLogs: () => ({ stdout, stderr }) };
}

module.exports = { startApi, API_ROOT };
