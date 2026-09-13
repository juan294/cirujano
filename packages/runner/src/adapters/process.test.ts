import { describe, expect, it } from 'vitest';

import { redactSecrets, runProcess } from './process.js';

describe('runProcess (R08)', () => {
  it('passes sensitive input through stdin and redacts bounded output', async () => {
    const token = 'registration-secret';
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.stdin.on("data",d=>{process.stdout.write(d);process.stderr.write(d)})'],
      stdin: token,
      secrets: [token],
      timeoutMs: 2_000,
      maxOutputBytes: 64,
    });
    expect(result.argv.join(' ')).not.toContain(token);
    expect(result.stdout).toBe('[REDACTED]');
    expect(result.stderr).toBe('[REDACTED]');
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
  });

  it('terminates a timed-out child and marks truncated output', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'require("fs").writeSync(1,"x".repeat(100));setTimeout(()=>{},10_000)'],
      timeoutMs: 200,
      maxOutputBytes: 16,
    });
    expect(result.timedOut).toBe(true);
    expect(result.stdout).toContain('[truncated]');
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(64);
  });
});

describe('redactSecrets', () => {
  it('ignores empty values and redacts every occurrence', () => {
    expect(redactSecrets('a secret secret', ['', 'secret'])).toBe('a [REDACTED] [REDACTED]');
  });
});
