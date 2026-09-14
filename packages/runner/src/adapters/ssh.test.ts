import { describe, expect, it } from 'vitest';

import { buildSshInvocation, classifySshReadinessFailure, knownHostLine, sshAttemptTiming, verifySshPublicKeyFingerprint } from './ssh.js';

const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA pilot';

describe('SSH identity and invocation (R08)', () => {
  it('verifies an OpenSSH public-key fingerprint and rejects mismatch', () => {
    const expected = verifySshPublicKeyFingerprint(key);
    expect(expected.startsWith('SHA256:')).toBe(true);
    expect(() => verifySshPublicKeyFingerprint(key, 'SHA256:wrong')).toThrow(/fingerprint/);
  });

  it('builds strict, noninteractive SSH argv without sensitive stdin', () => {
    const invocation = buildSshInvocation({
      sshPath: '/fixtures/ssh',
      host: '192.0.2.10', port: 22, user: 'runner', identityFile: '/private/key',
      knownHostsFile: '/private/known_hosts', helper: '/opt/cirujano/register-runner',
      stdin: 'registration-secret', timeoutSeconds: 10,
    });
    expect(invocation.command).toBe('/fixtures/ssh');
    expect(invocation.args).toContain('StrictHostKeyChecking=yes');
    expect(invocation.args.join(' ')).not.toContain('registration-secret');
    expect(invocation.shell).toBe(false);
  });

  it('rejects invalid hosts, helper commands and relative private paths', () => {
    const base = {
      host: '192.0.2.10', port: 22, user: 'runner', identityFile: '/private/key',
      knownHostsFile: '/private/known_hosts', helper: '/opt/cirujano/status',
      timeoutSeconds: 10,
    };
    expect(() => buildSshInvocation({ ...base, host: 'host;touch /tmp/x' })).toThrow();
    expect(() => buildSshInvocation({ ...base, helper: '/opt/cirujano/status --debug' })).toThrow();
    expect(() => buildSshInvocation({ ...base, identityFile: 'key' })).toThrow();
    expect(() => buildSshInvocation({ ...base, sshPath: 'ssh' })).toThrow();
  });

  it('renders the exact pinned host-key entry', () => {
    expect(knownHostLine('192.0.2.10', 22, key)).toBe(`[192.0.2.10]:22 ${key.split(' ').slice(0, 2).join(' ')}`);
  });

  it.each([
    ['connection-refused', 'ssh: connect to host 192.0.2.10 port 22: Connection refused'],
    ['connection-reset', 'ssh: connect to host 192.0.2.10 port 22: Connection reset by peer'],
    ['connection-timeout', 'ssh: connect to host 192.0.2.10 port 22: Operation timed out'],
    ['connection-timeout', 'ssh: connect to host 192.0.2.10 port 22: Connection timed out'],
    ['no-route', 'ssh: connect to host 192.0.2.10 port 22: No route to host'],
    ['pre-banner-reset', 'kex_exchange_identification: read: Connection reset by peer'],
    ['pre-banner-reset', 'banner exchange: Connection to 192.0.2.10 port 22: Connection reset by peer'],
  ] as const)('classifies %s SSH readiness output as transient', (reason, stderr) => {
    expect(classifySshReadinessFailure({ exitCode: 255, timedOut: false, stderr })).toEqual({ transient: true, reason });
  });

  it.each([
    ['host-key', 255, 'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!'],
    ['host-key', 255, 'Host key verification failed.'],
    ['authentication', 255, 'runner@192.0.2.10: Permission denied (publickey).'],
    ['identity-file', 255, 'Warning: Identity file /private/key not accessible: No such file or directory.'],
    ['configuration', 255, 'command-line line 0: Bad configuration option: madeup'],
    ['helper', 42, 'remote helper failed'],
    ['unknown', 255, 'ssh failed for an unknown reason'],
  ] as const)('classifies %s SSH output as fatal', (reason, exitCode, stderr) => {
    expect(classifySshReadinessFailure({ exitCode, timedOut: false, stderr })).toEqual({ transient: false, reason });
  });

  it('does not classify a process timeout as a transient SSH result', () => {
    expect(classifySshReadinessFailure({ exitCode: null, timedOut: true, stderr: 'Connection timed out' }))
      .toEqual({ transient: false, reason: 'attempt-timeout' });
  });

  it.each([
    'remote helper: Connection refused',
    'remote helper: Connection reset by peer',
    'remote helper: Operation timed out',
    'remote helper: No route to host',
  ])('does not retry exit-255 helper output that contains a transient phrase: %s', (stderr) => {
    expect(classifySshReadinessFailure({ exitCode: 255, timedOut: false, stderr }))
      .toEqual({ transient: false, reason: 'unknown' });
  });

  it('keeps the OpenSSH timeout below the poll-sized process timeout', () => {
    expect(sshAttemptTiming(30_000)).toEqual({ connectTimeoutSeconds: 29, processTimeoutMs: 30_000 });
    expect(sshAttemptTiming(120_000)).toEqual({ connectTimeoutSeconds: 59, processTimeoutMs: 60_000 });
    expect(() => sshAttemptTiming(1_999)).toThrow(/at least 2000/iu);
  });
});
