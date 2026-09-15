import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createTelemetryCommandService } from './telemetry-service.js';
import { collectTelemetry, type GitHubTelemetrySource, type TelemetrySnapshot } from './telemetry.js';

const io = { stdout: () => undefined, stderr: () => undefined };

describe('telemetry command service', () => {
  it('retries one transient GitHub CLI timeout without accepting partial evidence', async () => {
    const storePath = await mkdtemp(join(tmpdir(), 'cirujano-retry-telemetry-'));
    let jobAttempts = 0;
    const pageRunner = async (_command: string, args: readonly string[]) => {
      const endpoint = args.at(-1)!;
      if (endpoint.startsWith('/user/repos')) return { stdout: JSON.stringify([[
        { full_name: 'juan294/app', visibility: 'private', archived: false },
      ]]) };
      if (endpoint.includes('/actions/runs?')) return { stdout: JSON.stringify([{
        workflow_runs: [{ id: 1, run_attempt: 1, name: 'CI', event: 'push', created_at: '2026-09-13T10:00:00Z', conclusion: 'success' }],
      }]) };
      jobAttempts += 1;
      if (jobAttempts === 1) throw Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' });
      return { stdout: JSON.stringify([{ jobs: [{
        id: 2, name: 'test', started_at: '2026-09-13T10:01:00Z', completed_at: '2026-09-13T10:02:00Z',
        conclusion: 'success', labels: ['ubuntu-24.04'], runner_name: 'GitHub Actions 1', runner_group_name: 'GitHub Actions',
      }] }]) };
    };

    await expect(createTelemetryCommandService({}, pageRunner).run(
      { command: 'telemetry', action: 'collect', owner: 'juan294', storePath, lookbackHours: 48 }, io,
    )).resolves.toBe(0);
    expect(jobAttempts).toBe(2);
  });

  it('deduplicates an identical run repeated across changing GitHub pages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T12:00:00Z'));
    try {
      const storePath = await mkdtemp(join(tmpdir(), 'cirujano-run-page-telemetry-'));
      let jobAttempts = 0;
      const run = { id: 1, run_attempt: 1, name: 'CI', event: 'push', created_at: '2026-09-13T10:00:00Z', conclusion: 'success' };
      const pageRunner = async (_command: string, args: readonly string[]) => {
        const endpoint = args.at(-1)!;
        if (endpoint.startsWith('/user/repos')) return { stdout: JSON.stringify([[
          { full_name: 'juan294/app', visibility: 'private', archived: false },
        ]]) };
        if (endpoint.includes('/actions/runs?')) return { stdout: JSON.stringify([
          { workflow_runs: [run] }, { workflow_runs: [run] },
        ]) };
        jobAttempts += 1;
        return { stdout: JSON.stringify([{ jobs: [{
          id: 2, name: 'test', started_at: '2026-09-13T10:01:00Z', completed_at: '2026-09-13T10:02:00Z',
          conclusion: 'success', labels: ['ubuntu-24.04'], runner_name: 'GitHub Actions 1', runner_group_name: 'GitHub Actions',
        }] }]) };
      };

      await expect(createTelemetryCommandService({}, pageRunner).run(
        { command: 'telemetry', action: 'collect', owner: 'juan294', storePath, lookbackHours: 48 }, io,
      )).resolves.toBe(0);
      await expect(createTelemetryCommandService().run(
        { command: 'telemetry', action: 'report', storePath, since: '2026-09-13', format: 'json' }, io,
      )).resolves.toBe(0);
      expect(jobAttempts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses the latest prior-day snapshot across the overlap window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T09:00:00Z'));
    try {
      const storePath = await mkdtemp(join(tmpdir(), 'cirujano-prior-day-telemetry-'));
      await writeFile(join(storePath, '2026-09-12.json'), JSON.stringify(
        await validSnapshot('juan294', Date.parse('2026-09-12T12:00:00Z')),
      ));
      const pageRunner = async (_command: string, args: readonly string[]) => {
        const endpoint = args.at(-1)!;
        if (endpoint.startsWith('/user/repos')) return { stdout: JSON.stringify([[
          { full_name: 'juan294/app', visibility: 'public', archived: false },
        ]]) };
        if (endpoint.includes('/actions/runs?')) return { stdout: JSON.stringify([{
          workflow_runs: [{ id: 1, run_attempt: 1, name: 'CI', event: 'push', created_at: '2026-09-12T10:00:00.000Z', conclusion: 'success' }],
        }]) };
        throw new Error('prior-day run jobs must be reused');
      };

      await expect(createTelemetryCommandService({}, pageRunner).run(
        { command: 'telemetry', action: 'collect', owner: 'juan294', storePath, lookbackHours: 48 }, io,
      )).resolves.toBe(0);
      await expect(createTelemetryCommandService().run(
        { command: 'telemetry', action: 'report', storePath, since: '2026-09-12', format: 'json' }, io,
      )).resolves.toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a malformed persisted job instead of silently undercounting it', async () => {
    const storePath = await mkdtemp(join(tmpdir(), 'cirujano-bad-telemetry-'));
    await mkdir(storePath, { recursive: true });
    await writeFile(join(storePath, '2026-09-13.json'), JSON.stringify({
      schemaVersion: 1,
      owner: 'juan294',
      collectedAt: '2026-09-13T12:00:00.000Z',
      jobs: [{}],
    }));
    const service = createTelemetryCommandService();

    await expect(service.run(
      { command: 'telemetry', action: 'report', storePath, since: '2026-09-13', format: 'json' },
      io,
    )).rejects.toThrow(/snapshot 2026-09-13\.json is malformed/u);
  });

  it.each([
    ['stable key', (snapshot: TelemetrySnapshot) => { snapshot.jobs[0]!.key = 'forged'; }],
    ['derived cost', (snapshot: TelemetrySnapshot) => { snapshot.jobs[0]!.actualGithubListCostUsd = 99; }],
    ['duration', (snapshot: TelemetrySnapshot) => { snapshot.jobs[0]!.durationMs = 1; }],
    ['jobless run index', (snapshot: TelemetrySnapshot) => {
      snapshot.runs.push({
        ...snapshot.runs[0]!, key: 'juan294/missing:2:1', repository: 'juan294/missing', id: 2,
        jobsObserved: 0, reusable: true,
      });
      snapshot.runsScanned += 1;
    }],
  ])('rejects tampered %s evidence', async (_name, tamper) => {
    const storePath = await mkdtemp(join(tmpdir(), 'cirujano-tampered-telemetry-'));
    const snapshot = await validSnapshot('juan294', Date.parse('2026-09-13T12:00:00Z'));
    tamper(snapshot);
    await writeFile(join(storePath, '2026-09-13.json'), JSON.stringify(snapshot));

    await expect(createTelemetryCommandService().run(
      { command: 'telemetry', action: 'report', storePath, since: '2026-09-13', format: 'json' }, io,
    )).rejects.toThrow(/is malformed/u);
  });

  it('rejects empty, uncovered and mixed-owner stores', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'cirujano-empty-telemetry-'));
    const service = createTelemetryCommandService();
    await expect(service.run(
      { command: 'telemetry', action: 'report', storePath: empty, since: '2026-09-13', format: 'json' }, io,
    )).rejects.toThrow(/no snapshots/u);

    const storePath = await mkdtemp(join(tmpdir(), 'cirujano-mixed-telemetry-'));
    await writeFile(join(storePath, '2026-09-13.json'), JSON.stringify(await validSnapshot('juan294', Date.parse('2026-09-13T12:00:00Z'))));
    await expect(service.run(
      { command: 'telemetry', action: 'report', storePath, since: '2026-09-01', format: 'json' }, io,
    )).rejects.toThrow(/do not cover/u);
    await writeFile(join(storePath, '2026-09-14.json'), JSON.stringify(await validSnapshot('other', Date.parse('2026-09-14T12:00:00Z'))));
    await expect(service.run(
      { command: 'telemetry', action: 'report', storePath, since: '2026-09-13', format: 'json' }, io,
    )).rejects.toThrow(/mixed owners/u);
  });

  it('joins a fleet registry into the report and rejects a registry for another owner', async () => {
    const storePath = await mkdtemp(join(tmpdir(), 'cirujano-registry-telemetry-'));
    await writeFile(join(storePath, '2026-09-13.json'), JSON.stringify(await validSnapshot('juan294', Date.parse('2026-09-13T12:00:00Z'))));
    const registryPath = join(storePath, 'fleet-registry.json');
    const example = JSON.parse(await readFile(join(import.meta.dirname, '../fixtures/fleet-registry.example.json'), 'utf8')) as Record<string, unknown>;
    await writeFile(registryPath, JSON.stringify(example).replaceAll('example-owner', 'juan294').replaceAll('private-one', 'app'));
    const out: string[] = [];
    expect(await createTelemetryCommandService().run(
      { command: 'telemetry', action: 'report', storePath, since: '2026-09-13', format: 'json', registryPath }, { stdout: (text) => { out.push(text); }, stderr: () => undefined },
    )).toBe(0);
    const report = JSON.parse(out.join('')) as { enrollments: Array<{ id: string; before: { jobs: number }; incompleteReason: string | null }>; fleet: { complete: boolean } };
    expect(report.enrollments.map(({ id, before, incompleteReason }) => [id, before.jobs, incompleteReason])).toEqual([
      ['P1', 0, 'controller evidence is absent'], ['P2', 0, 'not cut over'],
    ]);
    expect(report.fleet).toMatchObject({ enrollments: 1, complete: false });

    await writeFile(registryPath, JSON.stringify(example));
    await expect(createTelemetryCommandService().run(
      { command: 'telemetry', action: 'report', storePath, since: '2026-09-13', format: 'markdown', registryPath }, io,
    )).rejects.toThrow(/registry owner example-owner does not match telemetry owner juan294/u);
  });

  it('accepts a run conclusion that differs from an individual job conclusion', async () => {
    const storePath = await mkdtemp(join(tmpdir(), 'cirujano-run-conclusion-telemetry-'));
    const snapshot = await validSnapshot('juan294', Date.parse('2026-09-13T12:00:00Z'));
    snapshot.runs[0]!.conclusion = 'failure';
    await writeFile(join(storePath, '2026-09-13.json'), JSON.stringify(snapshot));

    await expect(createTelemetryCommandService().run(
      { command: 'telemetry', action: 'report', storePath, since: '2026-09-13', format: 'json' }, io,
    )).resolves.toBe(0);
  });
});

async function validSnapshot(owner: string, nowMs: number): Promise<TelemetrySnapshot> {
  const source: GitHubTelemetrySource = {
    listRepositories: async () => [{ fullName: `${owner}/app`, visibility: 'private', archived: false }],
    listRuns: async () => [{ id: 1, attempt: 1, workflowName: 'CI', event: 'push', createdAt: new Date(nowMs - 7_200_000).toISOString(), conclusion: 'success' }],
    listJobs: async () => [{
      id: 2, name: 'test', startedAt: new Date(nowMs - 3_600_000).toISOString(),
      completedAt: new Date(nowMs - 3_539_000).toISOString(), conclusion: 'success',
      labels: ['ubuntu-24.04'], runnerName: 'GitHub Actions 1', runnerGroupName: '',
    }],
  };
  return collectTelemetry({ owner, lookbackHours: 48, nowMs, source });
}
