import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { appendRedactedEvent, readJournal, writeJournalAtomic } from './journal.js';

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
});

function startLockProcess(directory: string, conflictExit: number): ChildProcessWithoutNullStreams {
  const source = `
    import { acquireControllerLock } from './src/journal.ts';
    try {
      const lock = await acquireControllerLock(${JSON.stringify(directory)});
      process.stdout.write('locked\\n');
      process.on('SIGTERM', async () => { await lock.release(); process.exit(0); });
      setInterval(() => {}, 1000);
    } catch { process.exit(${conflictExit}); }
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
