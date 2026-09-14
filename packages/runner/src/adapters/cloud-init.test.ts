import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { CloudInitError, renderCloudInit, type GuestFileName } from './cloud-init.js';

const guestDir = resolve(import.meta.dirname, '../../guest');
const guestFileNames = [
  'bootstrap.sh',
  'diagnose-ssh.sh',
  'watchdog.sh',
  'arm-grant.sh',
  'register-runner.sh',
  'job-start-hook.sh',
  'drain.sh',
  'status.sh',
  'resume-admission.sh',
  'cirujano-watchdog.service',
] as const satisfies readonly GuestFileName[];

const guestFiles = Object.fromEntries(
  guestFileNames.map((name) => [name, readFileSync(resolve(guestDir, name), 'utf8')]),
) as Record<GuestFileName, string>;

function sshString(value: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  return Buffer.concat([length, value]);
}

function testHostKeyPair(comment = 'cirujano-test-host'): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync('ed25519');
  const privateJwk = pair.privateKey.export({ format: 'jwk' });
  const publicJwk = pair.publicKey.export({ format: 'jwk' });
  const publicBytes = Buffer.from(publicJwk.x!, 'base64url');
  const privateSeed = Buffer.from(privateJwk.d!, 'base64url');
  const keyType = Buffer.from('ssh-ed25519');
  const publicBlob = Buffer.concat([sshString(keyType), sshString(publicBytes)]);
  const check = Buffer.alloc(8, 7);
  const privateFields = Buffer.concat([
    check,
    sshString(keyType),
    sshString(publicBytes),
    sshString(Buffer.concat([privateSeed, publicBytes])),
    sshString(Buffer.from(comment)),
  ]);
  const paddingLength = (8 - (privateFields.length % 8)) % 8;
  const privateBlock = Buffer.concat([
    privateFields,
    Buffer.from(Array.from({ length: paddingLength }, (_unused, index) => index + 1)),
  ]);
  const envelope = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    sshString(Buffer.from('none')),
    sshString(Buffer.from('none')),
    sshString(Buffer.alloc(0)),
    Buffer.from([0, 0, 0, 1]),
    sshString(publicBlob),
    sshString(privateBlock),
  ]).toString('base64');
  return {
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${envelope.match(/.{1,70}/gu)!.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`,
    publicKey: `ssh-ed25519 ${publicBlob.toString('base64')} host`,
  };
}

const hostKeyPair = testHostKeyPair();

const validInput = {
  runnerVersion: '2.328.0',
  runnerSha256: 'a'.repeat(64),
  sshHostPrivateKey: hostKeyPair.privateKey,
  sshHostPublicKey: hostKeyPair.publicKey,
  sshLoginPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOoooooooooooooooooooooooooooooooooooooooooo controller',
  guestFiles,
  sensitiveValues: ['github_pat_live_secret', 'nebius-live-secret'],
} as const;

describe('renderCloudInit (R08)', () => {
  it('deterministically provisions the runner user and pinned workload prerequisites before bootstrap', () => {
    const first = renderCloudInit(validInput);
    const second = renderCloudInit({ ...validInput, guestFiles: { ...guestFiles } });
    expect(first).toBe(second);
    expect(first).toContain('#cloud-config');
    expect(first).toContain('name: runner');
    expect(first).toContain('docker.io');
    expect(first).toContain('node_22.x');
    expect(first).toContain('pnpm@11.22.0');
    expect(first).toContain('RUNNER_VERSION=2.328.0');
    expect(first).toContain(`RUNNER_SHA256=${'a'.repeat(64)}`);
    expect(first).toContain('/tmp/cirujano/bootstrap.sh');
  });

  it('opens the verified SSH path and starts the watchdog before slow package provisioning', () => {
    const rendered = renderCloudInit(validInput);
    const safetyBootstrap = rendered.indexOf('CIRUJANO_SAFETY_ONLY=1');
    const sshRestart = rendered.indexOf('/opt/cirujano/diagnose-ssh');
    const secureAptSources = rendered.indexOf('https://archive.ubuntu.com');
    const packageInstall = rendered.indexOf('apt-get, install, --yes');
    const fullBootstrap = rendered.indexOf('[env, "RUNNER_VERSION=');

    expect(rendered).toContain('package_update: false');
    expect(rendered).not.toContain('package_update: true');
    expect(rendered).toContain('groups:\n  - docker\nusers:');
    expect(rendered).not.toContain('\npackages:\n');
    expect(safetyBootstrap).toBeGreaterThan(-1);
    expect(safetyBootstrap).toBeLessThan(sshRestart);
    expect(sshRestart).toBeLessThan(packageInstall);
    expect(sshRestart).toBeLessThan(secureAptSources);
    expect(secureAptSources).toBeLessThan(rendered.indexOf('[apt-get, update]'));
    expect(packageInstall).toBeLessThan(fullBootstrap);
  });

  it('uses one native host-key owner and suppresses serial key disclosure', () => {
    const rendered = renderCloudInit(validInput);
    for (const name of guestFileNames) {
      expect(rendered).toContain(`/tmp/cirujano/${name}`);
      expect(rendered).toContain(Buffer.from(guestFiles[name], 'utf8').toString('base64'));
    }
    expect(rendered).toContain('ssh_keys:');
    expect(rendered).toContain('  ed25519_private: |');
    for (const line of validInput.sshHostPrivateKey.trimEnd().split('\n')) {
      expect(rendered).toContain(`    ${line}`);
    }
    expect(rendered).toContain(`  ed25519_public: ${JSON.stringify(validInput.sshHostPublicKey)}`);
    expect(rendered).toContain('ssh:');
    expect(rendered).toContain('  emit_keys_to_console: false');
    expect(rendered).toContain('no_ssh_fingerprints: true');
    expect(rendered).not.toContain('path: /etc/ssh/ssh_host_ed25519_key');
    expect(rendered).toContain('/etc/sudoers.d/cirujano-runner');
    expect(rendered).toContain(validInput.sshHostPublicKey);
    expect(rendered).toContain(validInput.sshLoginPublicKey);
    expect(rendered.indexOf('/opt/cirujano/diagnose-ssh')).toBeLessThan(rendered.indexOf('[env, "RUNNER_VERSION='));
  });

  it('accepts an ssh-keygen-compatible private block with exact block alignment', () => {
    const alignedHostKeyPair = testHostKeyPair('cirujano-host');
    expect(() => renderCloudInit({
      ...validInput,
      sshHostPrivateKey: alignedHostKeyPair.privateKey,
      sshHostPublicKey: alignedHostKeyPair.publicKey,
    })).not.toThrow();
  });

  it('contains no supplied registration, GitHub, or cloud credential', () => {
    const rendered = renderCloudInit(validInput);
    for (const secret of validInput.sensitiveValues) expect(rendered).not.toContain(secret);
  });

  it.each([
    ['relative helper name', { guestFiles: { ...guestFiles, '../escape.sh': 'oops' } }],
    ['missing helper', { guestFiles: Object.fromEntries(Object.entries(guestFiles).slice(1)) }],
    ['invalid runner version', { runnerVersion: 'latest; reboot' }],
    ['invalid checksum', { runnerSha256: 'abc' }],
    ['private host key', { sshHostPublicKey: '-----BEGIN OPENSSH PRIVATE KEY-----' }],
    ['missing host private key', { sshHostPrivateKey: '' }],
    ['mismatched host key pair', { sshHostPublicKey: validInput.sshLoginPublicKey }],
    ['multiline login key', { sshLoginPublicKey: `${validInput.sshLoginPublicKey}\ncommand` }],
    ['embedded GitHub credential', { guestFiles: { ...guestFiles, 'drain.sh': 'GITHUB_TOKEN=github_pat_live_secret' } }],
    ['embedded cloud credential', { guestFiles: { ...guestFiles, 'drain.sh': 'NEBIUS_API_KEY=nebius-live-secret' } }],
  ])('fails closed for %s', (_name, patch) => {
    expect(() => renderCloudInit({ ...validInput, ...patch } as typeof validInput)).toThrow(CloudInitError);
  });
});

describe('cloud-init harness disclosure boundaries', () => {
  it('does not include injected private host-key material in renderer errors', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'cirujano-render-error-'));
    try {
      const output = resolve(directory, 'cloud-config.yaml');
      const hostPrivate = resolve(directory, 'host-key');
      const hostPublic = resolve(directory, 'host-key.pub');
      const loginPublic = resolve(directory, 'login-key.pub');
      writeFileSync(hostPrivate, hostKeyPair.privateKey, { mode: 0o600 });
      writeFileSync(hostPublic, validInput.sshLoginPublicKey);
      writeFileSync(loginPublic, validInput.sshLoginPublicKey);
      const result = spawnSync(process.execPath, [resolve(guestDir, '../../../scripts/render-runner-cloud-init.mjs'), output], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CIRUJANO_HOST_PRIVATE_KEY_PATH: hostPrivate,
          CIRUJANO_HOST_PUBLIC_KEY_PATH: hostPublic,
          CIRUJANO_LOGIN_PUBLIC_KEY_PATH: loginPublic,
        },
      });
      const captured = `${result.stdout}${result.stderr}`;
      expect(result.status).not.toBe(0);
      expect(captured).not.toContain(hostKeyPair.privateKey);
      expect(captured).not.toContain(Buffer.from(hostKeyPair.privateKey, 'utf8').toString('base64'));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('withholds schema annotations that contain injected private host-key material', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'cirujano-schema-error-'));
    try {
      const dockerStub = resolve(directory, 'docker-stub');
      const statStub = resolve(directory, 'stat');
      const hostPrivate = resolve(directory, 'host-key');
      const hostPublic = resolve(directory, 'host-key.pub');
      const loginPublic = resolve(directory, 'login-key.pub');
      writeFileSync(hostPrivate, hostKeyPair.privateKey, { mode: 0o600 });
      writeFileSync(hostPublic, hostKeyPair.publicKey);
      writeFileSync(loginPublic, validInput.sshLoginPublicKey);
      writeFileSync(dockerStub, `#!/usr/bin/env bash\nif [[ "$1" == build ]]; then exit 0; fi\nprintf '%s\\n' "$CIRUJANO_TEST_PRIVATE_KEY"\nprintf '%s' "$CIRUJANO_TEST_PRIVATE_KEY" | base64\nexit 1\n`);
      writeFileSync(statStub, `#!/usr/bin/env bash\nif [[ "$1" == -c ]]; then printf '600\\n'; exit 0; fi\nprintf 'GNU stat filesystem report\\n'\n`);
      chmodSync(dockerStub, 0o755);
      chmodSync(statStub, 0o755);
      const result = spawnSync('/bin/bash', [resolve(guestDir, '../../../scripts/verify-runner-cloud-init-schema.sh')], {
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          ...process.env,
          CIRUJANO_DOCKER_PATH: dockerStub,
          CIRUJANO_HOST_PRIVATE_KEY_PATH: hostPrivate,
          CIRUJANO_HOST_PUBLIC_KEY_PATH: hostPublic,
          CIRUJANO_LOGIN_PUBLIC_KEY_PATH: loginPublic,
          CIRUJANO_TEST_PRIVATE_KEY: hostKeyPair.privateKey,
          PATH: `${directory}:${process.env.PATH ?? ''}`,
        },
      });
      const captured = `${result.stdout}${result.stderr}`;
      expect(result.status).not.toBe(0);
      expect(captured).not.toContain(hostKeyPair.privateKey);
      expect(captured).not.toContain(Buffer.from(hostKeyPair.privateKey, 'utf8').toString('base64'));
      expect(captured).toContain('captured annotated output withheld');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 70_000);
});
