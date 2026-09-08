import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli, type CliIo } from './cli.js';

function captureIo(): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => { out.push(text); },
    stderr: (text) => { err.push(text); },
  };
}

describe('runCli', () => {
  it('prints usage with exit code 2 on a usage error', async () => {
    const io = captureIo();
    expect(await runCli(['estimate'], io)).toBe(2);
    expect(io.err.join('')).toMatch(/requires --jobs/);
    expect(io.err.join('')).toMatch(/^estimate requires/);
  });

  it('estimates billable minutes from a GitHub jobs payload file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cirujano-cli-'));
    const jobsPath = join(dir, 'jobs.json');
    await writeFile(jobsPath, JSON.stringify({
      jobs: [
        { name: 'checks', started_at: '2026-09-08T12:02:15Z', completed_at: '2026-09-08T12:03:06Z' },
        { name: 'e2e', started_at: '2026-09-08T12:00:00Z', completed_at: '2026-09-08T12:16:01Z' },
        { name: 'skipped', started_at: null, completed_at: null },
      ],
    }));

    const io = captureIo();
    expect(await runCli(['estimate', '--jobs', jobsPath, '--format', 'json'], io)).toBe(0);
    expect(JSON.parse(io.out.join(''))).toEqual({ billableMinutes: 18, measuredJobs: 2, skippedJobs: 1 });
  });

  it('fails with exit code 1 and names the file when the payload is malformed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cirujano-cli-'));
    const jobsPath = join(dir, 'bad.json');
    await writeFile(jobsPath, JSON.stringify({ jobs: [{ id: 1 }] }));

    const io = captureIo();
    expect(await runCli(['estimate', '--jobs', jobsPath], io)).toBe(1);
    expect(io.err.join('')).toContain('bad.json');
    expect(io.err.join('')).toMatch(/no string `name`/);
  });
});
