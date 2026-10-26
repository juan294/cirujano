import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CREDENTIAL_SHAPE_PATTERN, acquireControllerLock, appendRedactedEvent, readJournal, redactCredentialShapes, writeJournalAtomic } from './journal.js';

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => children.splice(0).forEach((child) => child.kill('SIGKILL')));

describe('durable journal', () => {
  it('atomically writes mode-0600 JSON and leaves no replacement file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-journal-'));
    const path = join(directory, 'state.json');
    await writeJournalAtomic(path, { schemaVersion: 1, generation: 4 });
    expect(await readJournal(path)).toEqual({ schemaVersion: 1, generation: 4 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readdir(directory)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('appends bounded JSONL while redacting secret values and sensitive fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-events-'));
    const path = join(directory, 'events.jsonl');
    await appendRedactedEvent(path, { type: 'register', token: 'hidden', note: 'value hidden', large: 'x'.repeat(500) }, { secrets: ['hidden'], maxBytes: 180 });
    const line = await readFile(path, 'utf8');
    expect(line).not.toContain('hidden');
    expect(line).toContain('[REDACTED]');
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(181);
  });

  it('scrubs credential shapes it was never told about, in events and on their own', async () => {
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nbody-line\n-----END OPENSSH PRIVATE KEY-----';
    const text = `token ghp_${'a'.repeat(36)} pat github_pat_abc key AKIAABCDEFGHIJKLMNOP env GITHUB_TOKEN=plain\n${pem}\nafter`;
    const scrubbed = redactCredentialShapes(text);
    expect(scrubbed).toBe(`token [REDACTED] pat [REDACTED] key [REDACTED] env [REDACTED]\n[REDACTED]\nafter`);
    // The non-global pattern stays stateless across repeated tests.
    expect(CREDENTIAL_SHAPE_PATTERN.test(text)).toBe(true);
    expect(CREDENTIAL_SHAPE_PATTERN.test(text)).toBe(true);
    expect(CREDENTIAL_SHAPE_PATTERN.test('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-shapes-'));
    const path = join(directory, 'events.jsonl');
    await appendRedactedEvent(path, { type: 'helper-failure', stderrTail: text });
    const line = await readFile(path, 'utf8');
    expect(line).not.toContain('body-line');
    expect(line).not.toContain('github_pat_abc');
    expect(line).toContain('after');
  });
});

describe('exclusive controller lock (R10)', () => {
  it('uses a real process-held lock, rejects a contender, and recovers after SIGKILL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-lock-'));
    const holder = startLockProcess(directory, 0);
    children.push(holder);
    await waitForText(holder, 'locked');

    const contender = startLockProcess(directory, 23);
    children.push(contender);
    expect(await waitForExit(contender)).toBe(23);

    holder.kill('SIGKILL');
    await waitForExit(holder);
    const restarted = startLockProcess(directory, 0);
    children.push(restarted);
    await waitForText(restarted, 'locked');
    restarted.kill('SIGTERM');
    await waitForExit(restarted);
  });

  it('admits exactly one simultaneous crash-recovery contender and preserves exclusion through release', async () => {
    const directory = join(await mkdtemp(join(tmpdir(), 'cirujano-lock-race-')), 'long-state-path-'.repeat(8));
    for (let round = 0; round < 12; round += 1) {
      const crashed = startLockProcess(directory, 23);
      children.push(crashed);
      await waitForText(crashed, 'locked');
      crashed.kill('SIGKILL');
      await waitForExit(crashed);

      const contenders = Array.from({ length: 4 }, () => startLockProcess(directory, 23, true));
      children.push(...contenders);
      await Promise.all(contenders.map((child) => waitForText(child, 'ready')));
      const outcomes = contenders.map((child) => waitForAcquisition(child));
      for (const child of contenders) child.stdin.write('acquire\n');
      const acquired = await Promise.all(outcomes);
      expect(acquired.filter(Boolean), `crash-recovery round ${round}`).toHaveLength(1);

      const holder = contenders[acquired.indexOf(true)]!;
      const rejected = startLockProcess(directory, 23);
      children.push(rejected);
      expect(await waitForExit(rejected)).toBe(23);
      holder.kill('SIGTERM');
      expect(await waitForExit(holder)).toBe(0);
      const next = startLockProcess(directory, 23);
      children.push(next);
      await waitForText(next, 'locked');
      const stillRejected = startLockProcess(directory, 23);
      children.push(stillRejected);
      expect(await waitForExit(stillRejected)).toBe(23);
      next.kill('SIGTERM');
      expect(await waitForExit(next)).toBe(0);
    }
  }, 30_000);

  it('keeps a live legacy socket holder exclusive and releases a failed acquisition', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-legacy-lock-'));
    const legacy = createServer();
    await new Promise<void>((resolve) => legacy.listen(join(directory, '.controller.sock'), resolve));
    try {
      await expect(acquireControllerLock(directory)).rejects.toThrow('another controller');
    } finally {
      await new Promise<void>((resolve, reject) => legacy.close((error) => error ? reject(error) : resolve()));
    }
    const lock = await acquireControllerLock(directory);
    await lock.release();
  });

  it('does not release a process-held lock when a same-process acquisition fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-local-lock-'));
    const lock = await acquireControllerLock(directory);
    try {
      await expect(acquireControllerLock(directory)).rejects.toThrow('another controller');
      const contender = startLockProcess(directory, 23);
      children.push(contender);
      expect(await waitForExit(contender)).toBe(23);
    } finally {
      await lock.release();
    }
    await lock.release();
    const next = startLockProcess(directory, 23);
    children.push(next);
    await waitForText(next, 'locked');
    next.kill('SIGTERM');
    expect(await waitForExit(next)).toBe(0);
  });
});

function waitForAcquisition(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child acquisition timeout')), 3_000);
    child.stdout.on('data', (chunk: Buffer) => {
      const output = chunk.toString();
      if (output.includes('locked') || output.includes('conflict')) {
        clearTimeout(timer);
        resolve(output.includes('locked'));
      }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function startLockProcess(directory: string, conflictExit: number, barrier = false): ChildProcessWithoutNullStreams {
  const source = `
    import { acquireControllerLock } from './src/journal.ts';
    async function acquire() {
      try {
        const lock = await acquireControllerLock(${JSON.stringify(directory)});
        process.on('SIGTERM', async () => { await lock.release(); process.exit(0); });
        process.stdout.write('locked\\n');
        setInterval(() => {}, 1000);
      } catch {
        process.stdout.write('conflict\\n');
        process.exit(${conflictExit});
      }
    }
    if (${String(barrier)}) {
      process.stdin.once('data', acquire);
      process.stdout.write('ready\\n');
    } else await acquire();
  `;
  return spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', source], {
    cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function waitForText(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child output timeout')), 3_000);
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(expected)) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`child exited ${String(code)}`)); });
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('exit', resolve));
}
