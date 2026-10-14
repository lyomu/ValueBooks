'use strict';

const { spawnSync } = require('node:child_process');

/**
 * Runs `docker <args>` and throws (with captured stderr/stdout) on a non-zero exit.
 * Returns {stdout, stderr} on success. stdio is piped, never inherited, so callers can
 * assert on output without leaking container noise into the drill script's own logs.
 */
function docker(args, opts = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 256,
    ...opts,
  });
  if (result.error) {
    throw new Error(`docker ${args.join(' ')} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `docker ${args.join(' ')} exited with code ${result.status}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function dockerExec(container, command, opts = {}) {
  return docker(['exec', container, ...command], opts);
}

function dockerCpToHost(container, containerPath, hostPath) {
  return docker(['cp', `${container}:${containerPath}`, hostPath]);
}

function dockerCpToContainer(hostPath, container, containerPath) {
  return docker(['cp', hostPath, `${container}:${containerPath}`]);
}

function dockerRun(image, args, { network, volumes = [], entrypoint } = {}) {
  const dockerArgs = ['run', '--rm'];
  if (network) dockerArgs.push('--network', network);
  for (const [hostPath, containerPath] of volumes) {
    dockerArgs.push('-v', `${hostPath}:${containerPath}`);
  }
  if (entrypoint) dockerArgs.push('--entrypoint', entrypoint);
  dockerArgs.push(image, ...args);
  return docker(dockerArgs);
}

module.exports = { docker, dockerExec, dockerCpToHost, dockerCpToContainer, dockerRun };
