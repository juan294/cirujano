import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey } from 'node:crypto';

export const GUEST_FILE_NAMES = [
  'bootstrap.sh',
  'watchdog.sh',
  'arm-grant.sh',
  'register-runner.sh',
  'job-start-hook.sh',
  'drain.sh',
  'status.sh',
  'resume-admission.sh',
  'cirujano-watchdog.service',
] as const;

export type GuestFileName = typeof GUEST_FILE_NAMES[number];

export interface CloudInitInput {
  runnerVersion: string;
  runnerSha256: string;
  sshHostPrivateKey: string;
  sshHostPublicKey: string;
  sshLoginPublicKey: string;
  guestFiles: Record<GuestFileName, string>;
  sensitiveValues?: readonly string[];
}

export class CloudInitError extends Error {
  override readonly name = 'CloudInitError';
}

const SECRET_PATTERN = /(?:\b(?:GITHUB_TOKEN|NEBIUS_API_KEY|AWS_SECRET_ACCESS_KEY)\s*=\s*[^\s]+|\bgithub_pat_[A-Za-z0-9_]+|\bgh[pousr]_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----)/u;
const SSH_PUBLIC_KEY_PATTERN = /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: [^\r\n]+)?$/u;

export function renderCloudInit(input: CloudInitInput): string {
  validateInput(input);
  const lines = [
    '#cloud-config',
    'package_update: true',
    'package_upgrade: false',
    'ssh_pwauth: false',
    'disable_root: true',
    'ssh_keys:',
    `  ed25519_public: ${yamlString(input.sshHostPublicKey)}`,
    'users:',
    '  - name: runner',
    '    gecos: Cirujano runner',
    '    groups: [docker]',
    '    shell: /bin/bash',
    '    lock_passwd: true',
    '    sudo: []',
    '    ssh_authorized_keys:',
    `      - ${yamlString(input.sshLoginPublicKey)}`,
    'packages:',
    '  - build-essential',
    '  - ca-certificates',
    '  - curl',
    '  - docker.io',
    '  - git',
    '  - jq',
    '  - libicu-dev',
    '  - unzip',
    '  - xz-utils',
    'write_files:',
    '  - path: /etc/ssh/ssh_host_ed25519_key',
    '    owner: root:root',
    "    permissions: '0600'",
    '    encoding: b64',
    `    content: ${Buffer.from(input.sshHostPrivateKey, 'utf8').toString('base64')}`,
    '  - path: /etc/ssh/ssh_host_ed25519_key.pub',
    '    owner: root:root',
    "    permissions: '0644'",
    `    content: ${yamlString(input.sshHostPublicKey)}`,
    '  - path: /etc/sudoers.d/cirujano-runner',
    '    owner: root:root',
    "    permissions: '0440'",
    `    content: ${yamlString('runner ALL=(root) NOPASSWD: /opt/cirujano/arm-grant, /opt/cirujano/register-runner, /opt/cirujano/drain, /opt/cirujano/status, /opt/cirujano/resume-admission')}`,
  ];

  for (const name of GUEST_FILE_NAMES) {
    lines.push(
      `  - path: /tmp/cirujano/${name}`,
      '    owner: root:root',
      `    permissions: '${name.endsWith('.sh') ? '0755' : '0644'}'`,
      '    encoding: b64',
      `    content: ${Buffer.from(input.guestFiles[name], 'utf8').toString('base64')}`,
    );
  }

  lines.push(
    'runcmd:',
    '  - [install, -d, -m, "0755", /etc/apt/keyrings]',
    '  - [bash, -c, "curl --fail --silent --show-error --location https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes --output /etc/apt/keyrings/nodesource.gpg"]',
    '  - [bash, -c, "echo deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main > /etc/apt/sources.list.d/nodesource.list"]',
    '  - [apt-get, update]',
    '  - [apt-get, install, --yes, nodejs]',
    '  - [corepack, enable]',
    '  - [corepack, prepare, "pnpm@11.22.0", --activate]',
    '  - [systemctl, enable, --now, docker]',
    '  - [systemctl, restart, ssh]',
    `  - [env, "RUNNER_VERSION=${input.runnerVersion}", "RUNNER_SHA256=${input.runnerSha256}", bash, /tmp/cirujano/bootstrap.sh]`,
    '',
  );
  return lines.join('\n');
}

function validateInput(input: CloudInitInput): void {
  if (!/^\d+\.\d+\.\d+$/u.test(input.runnerVersion)) {
    throw new CloudInitError('runnerVersion must be an exact semantic version');
  }
  if (!/^[a-f0-9]{64}$/u.test(input.runnerSha256)) {
    throw new CloudInitError('runnerSha256 must be a lowercase SHA-256 digest');
  }
  validatePublicKey(input.sshHostPublicKey, 'sshHostPublicKey');
  validatePublicKey(input.sshLoginPublicKey, 'sshLoginPublicKey');
  validateHostKeyPair(input.sshHostPrivateKey, input.sshHostPublicKey);

  const suppliedNames = Object.keys(input.guestFiles).sort();
  const requiredNames = [...GUEST_FILE_NAMES].sort();
  if (suppliedNames.length !== requiredNames.length || suppliedNames.some((name, index) => name !== requiredNames[index])) {
    throw new CloudInitError('guestFiles must contain exactly the required helpers and unit');
  }
  for (const name of GUEST_FILE_NAMES) {
    const content = input.guestFiles[name];
    if (typeof content !== 'string' || content.length === 0 || content.includes('\0')) {
      throw new CloudInitError(`${name} must contain non-empty text without NUL bytes`);
    }
    rejectSecrets(content, input.sensitiveValues ?? [], name);
  }
}

function validatePublicKey(value: string, field: string): void {
  if (!SSH_PUBLIC_KEY_PATTERN.test(value)) throw new CloudInitError(`${field} must be one single-line Ed25519 public key`);
}

function validateHostKeyPair(privateKey: string, publicKey: string): void {
  const match = /^-----BEGIN OPENSSH PRIVATE KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END OPENSSH PRIVATE KEY-----\r?\n?$/u.exec(privateKey);
  if (match === null) throw new CloudInitError('sshHostPrivateKey must use an unencrypted OpenSSH private-key envelope');
  let envelope: Buffer;
  try {
    envelope = Buffer.from(match[1]!.replaceAll(/\s/gu, ''), 'base64');
  } catch {
    throw new CloudInitError('sshHostPrivateKey has invalid base64');
  }
  const cursor = new BinaryCursor(envelope);
  if (!cursor.readBytes(15).equals(Buffer.from('openssh-key-v1\0'))) throw new CloudInitError('sshHostPrivateKey has an invalid OpenSSH envelope');
  if (cursor.readString().toString() !== 'none' || cursor.readString().toString() !== 'none' || cursor.readString().length !== 0) {
    throw new CloudInitError('sshHostPrivateKey must be unencrypted');
  }
  if (cursor.readUint32() !== 1) throw new CloudInitError('sshHostPrivateKey must contain one key');
  const outerPublic = cursor.readString();
  const privateBlock = cursor.readString();
  cursor.assertFinished('sshHostPrivateKey envelope');

  const inner = new BinaryCursor(privateBlock);
  const check = inner.readUint32();
  if (inner.readUint32() !== check) throw new CloudInitError('sshHostPrivateKey check integers do not match');
  if (inner.readString().toString() !== 'ssh-ed25519') throw new CloudInitError('sshHostPrivateKey must contain an Ed25519 key');
  const embeddedPublic = inner.readString();
  const privateBytes = inner.readString();
  inner.readString();
  if (embeddedPublic.length !== 32 || privateBytes.length !== 64 || !privateBytes.subarray(32).equals(embeddedPublic)) {
    throw new CloudInitError('sshHostPrivateKey has invalid Ed25519 key material');
  }
  inner.assertPadding();

  const expectedPublic = parseSshPublicBlob(publicKey);
  if (!outerPublic.equals(expectedPublic) || !embeddedPublic.equals(expectedPublic.subarray(expectedPublic.length - 32))) {
    throw new CloudInitError('SSH host private and public keys do not match');
  }
  try {
    const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
    const derived = createPublicKey(createPrivateKey({ key: Buffer.concat([pkcs8Prefix, privateBytes.subarray(0, 32)]), format: 'der', type: 'pkcs8' }))
      .export({ format: 'der', type: 'spki' });
    if (!derived.subarray(derived.length - 32).equals(embeddedPublic)) throw new CloudInitError('SSH host private and public keys do not match');
  } catch (error) {
    if (error instanceof CloudInitError) throw error;
    throw new CloudInitError('sshHostPrivateKey contains invalid Ed25519 private material');
  }
}

function parseSshPublicBlob(publicKey: string): Buffer {
  const encoded = publicKey.split(' ')[1];
  if (encoded === undefined) throw new CloudInitError('sshHostPublicKey is missing key material');
  const blob = Buffer.from(encoded, 'base64');
  const cursor = new BinaryCursor(blob);
  if (cursor.readString().toString() !== 'ssh-ed25519' || cursor.readString().length !== 32) {
    throw new CloudInitError('sshHostPublicKey has invalid Ed25519 key material');
  }
  cursor.assertFinished('sshHostPublicKey');
  return blob;
}

class BinaryCursor {
  #offset = 0;
  readonly #value: Buffer;

  constructor(value: Buffer) {
    this.#value = value;
  }

  readUint32(): number {
    if (this.#offset + 4 > this.#value.length) throw new CloudInitError('OpenSSH key is truncated');
    const value = this.#value.readUInt32BE(this.#offset);
    this.#offset += 4;
    return value;
  }

  readBytes(length: number): Buffer {
    if (this.#offset + length > this.#value.length) throw new CloudInitError('OpenSSH key is truncated');
    const value = this.#value.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  readString(): Buffer {
    return this.readBytes(this.readUint32());
  }

  assertFinished(context: string): void {
    if (this.#offset !== this.#value.length) throw new CloudInitError(`${context} contains trailing data`);
  }

  assertPadding(): void {
    let expected = 1;
    while (this.#offset < this.#value.length) {
      if (this.#value[this.#offset] !== expected) throw new CloudInitError('sshHostPrivateKey has invalid padding');
      this.#offset += 1;
      expected += 1;
    }
    if (expected === 1) throw new CloudInitError('sshHostPrivateKey is missing padding');
  }
}

function rejectSecrets(content: string, sensitiveValues: readonly string[], context: string): void {
  if (SECRET_PATTERN.test(content)) throw new CloudInitError(`${context} appears to contain credential material`);
  for (const secret of sensitiveValues) {
    if (typeof secret !== 'string' || secret.length === 0) throw new CloudInitError('sensitiveValues must contain non-empty strings');
    if (content.includes(secret)) throw new CloudInitError(`${context} contains a supplied sensitive value`);
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
