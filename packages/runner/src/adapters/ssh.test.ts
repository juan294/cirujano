import { describe, expect, it } from 'vitest';

import { buildSshInvocation, knownHostLine, verifySshPublicKeyFingerprint } from './ssh.js';

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
});
