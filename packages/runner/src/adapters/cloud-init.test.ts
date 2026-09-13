import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { CloudInitError, renderCloudInit, type GuestFileName } from './cloud-init.js';

const guestDir = resolve(import.meta.dirname, '../../guest');
const guestFileNames = [
  'bootstrap.sh',
  'watchdog.sh',
  'arm-grant.sh',
  'register-runner.sh',
  'job-start-hook.sh',
  'drain.sh',
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

function testHostKeyPair(): { privateKey: string; publicKey: string } {
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
    sshString(Buffer.from('cirujano-test-host')),
  ]);
  const paddingLength = 8 - (privateFields.length % 8);
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

  it('embeds every supplied guest helper and unit plus controller-generated SSH public keys', () => {
    const rendered = renderCloudInit(validInput);
    for (const name of guestFileNames) {
      expect(rendered).toContain(`/tmp/cirujano/${name}`);
      expect(rendered).toContain(Buffer.from(guestFiles[name], 'utf8').toString('base64'));
    }
    expect(rendered).toContain('/etc/ssh/ssh_host_ed25519_key.pub');
    expect(rendered).toContain('/etc/ssh/ssh_host_ed25519_key');
    expect(rendered).toContain("permissions: '0600'");
    expect(rendered).toContain(Buffer.from(validInput.sshHostPrivateKey, 'utf8').toString('base64'));
    expect(rendered).not.toContain(validInput.sshHostPrivateKey);
    expect(rendered).toContain(validInput.sshHostPublicKey);
    expect(rendered).toContain(validInput.sshLoginPublicKey);
    expect(rendered.indexOf('restart, ssh')).toBeLessThan(rendered.indexOf('[env, "RUNNER_VERSION='));
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
