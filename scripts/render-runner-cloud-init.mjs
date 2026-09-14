#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { chmodSync, closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUEST_FILE_NAMES, renderCloudInit } from '../packages/runner/dist/adapters/cloud-init.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = process.argv[2] === undefined ? undefined : resolve(process.argv[2]);
if (outputPath === undefined || process.argv.length !== 3) {
  process.stderr.write('usage: render-runner-cloud-init.mjs OUTPUT\n');
  process.exit(2);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'cirujano-cloud-init-'));
try {
  const suppliedKeyPaths = [
    process.env.CIRUJANO_HOST_PRIVATE_KEY_PATH,
    process.env.CIRUJANO_HOST_PUBLIC_KEY_PATH,
    process.env.CIRUJANO_LOGIN_PUBLIC_KEY_PATH,
  ];
  if (suppliedKeyPaths.some((path) => path !== undefined) && suppliedKeyPaths.some((path) => path === undefined)) {
    throw new Error('all injected SSH key paths must be supplied together');
  }
  const hostPrivateKeyPath = suppliedKeyPaths[0] ?? join(temporaryDirectory, 'host-key');
  const hostPublicKeyPath = suppliedKeyPaths[1] ?? `${hostPrivateKeyPath}.pub`;
  const loginPublicKeyPath = suppliedKeyPaths[2] ?? join(temporaryDirectory, 'login-key.pub');
  if (suppliedKeyPaths[0] === undefined) {
    execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostPrivateKeyPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', loginPublicKeyPath.slice(0, -4)], { stdio: ['ignore', 'ignore', 'pipe'] });
  }
  const guestDirectory = resolve(process.env.CIRUJANO_GUEST_DIR ?? join(repositoryRoot, 'packages/runner/guest'));
  const guestFiles = Object.fromEntries(GUEST_FILE_NAMES.map((name) => [
    name,
    readFileSync(join(guestDirectory, name), 'utf8'),
  ]));
  const rendered = renderCloudInit({
    runnerVersion: process.env.CIRUJANO_ACTIONS_RUNNER_VERSION ?? '2.328.0',
    runnerSha256: process.env.CIRUJANO_ACTIONS_RUNNER_SHA256 ?? 'a'.repeat(64),
    sshHostPrivateKey: readFileSync(hostPrivateKeyPath, 'utf8'),
    sshHostPublicKey: readFileSync(hostPublicKeyPath, 'utf8').trim(),
    sshLoginPublicKey: readFileSync(loginPublicKeyPath, 'utf8').trim(),
    guestFiles,
  });
  const descriptor = openSync(outputPath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, rendered, 'utf8');
  } finally {
    closeSync(descriptor);
    chmodSync(outputPath, 0o600);
  }
} catch (error) {
  process.stderr.write(`cloud-init rendering failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
