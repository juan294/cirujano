import { execFileSync } from 'node:child_process';
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
    const identity = key.split(' ').slice(0, 2).join(' ');
    expect(knownHostLine('192.0.2.10', 22, key)).toBe(`192.0.2.10 ${identity}`);
    expect(knownHostLine('192.0.2.10', 2222, key)).toBe(`[192.0.2.10]:2222 ${identity}`);
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

  it.each([
    ['Warning: IDENTITY FILE /private/key NOT ACCESSIBLE', 'identity-file'],
    ['Identity file first\nWarning: Identity file second not accessible', 'identity-file'],
    ['Identity file first\n not accessible', 'unknown'],
    ['Identity file first\r not accessible', 'unknown'],
    ['Identity file first\u2028 not accessible', 'unknown'],
    ['Identity file first\u2029 not accessible', 'unknown'],
    ['not accessible before Identity file /private/key', 'unknown'],
  ])('keeps identity-file matching case-insensitive, ordered and on one line: %s', (stderr, reason) => {
    expect(classifySshReadinessFailure({ exitCode: 255, timedOut: false, stderr }))
      .toEqual({ transient: false, reason });
  });

  it('classifies repeated prefixes within the SSH output limit without losing a valid suffix', () => {
    const stderr = 'Identity file '.repeat(4_096);
    expect(Buffer.byteLength(stderr)).toBeLessThan(64 * 1024);
    expect(classifySshReadinessFailure({ exitCode: 255, timedOut: false, stderr }))
      .toEqual({ transient: false, reason: 'unknown' });
    expect(classifySshReadinessFailure({ exitCode: 255, timedOut: false, stderr: `${stderr}key not accessible` }))
      .toEqual({ transient: false, reason: 'identity-file' });
  });

  it('handles repeated identity-file prefixes within a bounded subprocess deadline', () => {
    const source = new URL('./ssh.ts', import.meta.url).href;
    const script = `import { classifySshReadinessFailure } from ${JSON.stringify(source)};
      const stderr = 'Identity file '.repeat(120_000);
      process.stdout.write(JSON.stringify(classifySshReadinessFailure({ exitCode: 255, timedOut: false, stderr })));`;
    const stdout = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
      encoding: 'utf8', timeout: 3_000,
    });
    expect(JSON.parse(stdout)).toEqual({ transient: false, reason: 'unknown' });
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
