import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

export interface SshRequest {
  sshPath?: string;
  host: string;
  port: number;
  user: string;
  identityFile: string;
  knownHostsFile: string;
  helper: string;
  stdin?: string;
  timeoutSeconds: number;
}

export interface SshInvocation {
  command: string;
  args: string[];
  stdin?: string;
  shell: false;
}

export type SshReadinessReason =
  | 'connection-refused'
  | 'connection-reset'
  | 'connection-timeout'
  | 'no-route'
  | 'pre-banner-reset'
  | 'attempt-timeout'
  | 'host-key'
  | 'authentication'
  | 'identity-file'
  | 'configuration'
  | 'helper'
  | 'unknown';

export interface SshProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stderr: string;
}

export type SshReadinessClassification =
  | { transient: true; reason: Extract<SshReadinessReason, 'connection-refused' | 'connection-reset' | 'connection-timeout' | 'no-route' | 'pre-banner-reset'> }
  | { transient: false; reason: Exclude<SshReadinessReason, 'connection-refused' | 'connection-reset' | 'connection-timeout' | 'no-route' | 'pre-banner-reset'> };

export function buildSshInvocation(request: SshRequest): SshInvocation {
  const sshPath = request.sshPath ?? '/usr/bin/ssh';
  if (!isAbsolute(sshPath)) throw new TypeError('SSH executable path must be absolute');
  if (!validHost(request.host)) throw new TypeError('SSH host must be a validated IP address or DNS name');
  if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65_535) throw new RangeError('SSH port is invalid');
  if (!/^[a-z_][a-z0-9_-]*$/u.test(request.user)) throw new TypeError('SSH user is invalid');
  if (!isAbsolute(request.identityFile) || !isAbsolute(request.knownHostsFile)) throw new TypeError('SSH private paths must be absolute');
  if (!/^\/opt\/cirujano\/[a-z0-9-]+$/u.test(request.helper)) throw new TypeError('SSH helper must be an allowlisted constant path');
  if (!Number.isInteger(request.timeoutSeconds) || request.timeoutSeconds < 1 || request.timeoutSeconds > 60) throw new RangeError('SSH timeout is invalid');
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${request.knownHostsFile}`,
    '-o', 'IdentitiesOnly=yes',
    '-o', `ConnectTimeout=${request.timeoutSeconds}`,
    '-o', 'ConnectionAttempts=1',
    '-i', request.identityFile,
    '-p', String(request.port),
    `${request.user}@${request.host}`,
    request.helper,
  ];
  return request.stdin === undefined
    ? { command: sshPath, args, shell: false }
    : { command: sshPath, args, stdin: request.stdin, shell: false };
}

export function verifySshPublicKeyFingerprint(publicKey: string, expected?: string): string {
  const parts = publicKey.trim().split(/\s+/u);
  if (parts.length < 2 || !/^ssh-(?:ed25519|rsa)$/u.test(parts[0] ?? '')) throw new TypeError('unsupported SSH public key');
  let bytes: Buffer;
  try {
    bytes = Buffer.from(parts[1] ?? '', 'base64');
  } catch {
    throw new TypeError('invalid SSH public key');
  }
  if (bytes.length === 0) throw new TypeError('invalid SSH public key');
  const fingerprint = `SHA256:${createHash('sha256').update(bytes).digest('base64').replace(/=+$/u, '')}`;
  if (expected !== undefined && fingerprint !== expected) throw new Error('SSH public key fingerprint mismatch');
  return fingerprint;
}

export function knownHostLine(host: string, port: number, publicKey: string): string {
  if (!validHost(host)) throw new TypeError('known host is invalid');
  const [type, encoded] = publicKey.trim().split(/\s+/u);
  verifySshPublicKeyFingerprint(publicKey);
  const destination = port === 22 ? host : `[${host}]:${port}`;
  return `${destination} ${type} ${encoded}`;
}

export function classifySshReadinessFailure(result: SshProcessResult): SshReadinessClassification {
  if (result.timedOut) return { transient: false, reason: 'attempt-timeout' };
  if (result.exitCode !== 255) return { transient: false, reason: 'helper' };
  const message = result.stderr;
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/iu.test(message)) return { transient: false, reason: 'host-key' };
  if (/Permission denied/iu.test(message)) return { transient: false, reason: 'authentication' };
  if (/Identity file .* not accessible/iu.test(message)) return { transient: false, reason: 'identity-file' };
  if (/Bad configuration option|command-line line \d+:/iu.test(message)) return { transient: false, reason: 'configuration' };
  if (/^(?:kex_exchange_identification: read: Connection reset by peer|banner exchange: Connection to \S+ port \d+: Connection reset by peer)$/imu.test(message)) return { transient: true, reason: 'pre-banner-reset' };
  if (/^ssh: connect to host \S+ port \d+: Connection refused\.?$/imu.test(message)) return { transient: true, reason: 'connection-refused' };
  if (/^ssh: connect to host \S+ port \d+: Connection reset by peer\.?$/imu.test(message)) return { transient: true, reason: 'connection-reset' };
  if (/^ssh: connect to host \S+ port \d+: (?:Connection|Operation) timed out\.?$/imu.test(message)) return { transient: true, reason: 'connection-timeout' };
  if (/^ssh: connect to host \S+ port \d+: No route to host\.?$/imu.test(message)) return { transient: true, reason: 'no-route' };
  return { transient: false, reason: 'unknown' };
}

export function sshAttemptTiming(pollIntervalMs: number): { connectTimeoutSeconds: number; processTimeoutMs: number } {
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 2_000) throw new RangeError('pollIntervalMs must be at least 2000');
  const processTimeoutMs = Math.min(60_000, pollIntervalMs);
  return {
    connectTimeoutSeconds: Math.floor((processTimeoutMs - 1_000) / 1_000),
    processTimeoutMs,
  };
}

function validHost(host: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|(?:\d{1,3}\.){3}\d{1,3})$/iu.test(host)
    && !host.includes('..');
}
