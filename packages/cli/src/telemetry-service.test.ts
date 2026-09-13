import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTelemetryCommandService } from './telemetry-service.js';
import { collectTelemetry, type GitHubTelemetrySource, type TelemetrySnapshot } from './telemetry.js';

const io = { stdout: () => undefined, stderr: () => undefined };

describe('telemetry command service', () => {
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
