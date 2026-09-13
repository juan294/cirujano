import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  aggregateTelemetry,
  collectTelemetry,
  renderTelemetryMarkdown,
  writeTelemetrySnapshot,
  type GitHubTelemetrySource,
  type TelemetryJobInput,
  type TelemetrySnapshot,
} from './telemetry.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');

describe('fleet telemetry', () => {
  it('collects owned repositories and classifies hosted, Cirujano and other self-hosted jobs', async () => {
    const source: GitHubTelemetrySource = {
      listRepositories: async () => [
        { fullName: 'juan294/private-app', visibility: 'private', archived: false },
        { fullName: 'juan294/public-app', visibility: 'public', archived: false },
        { fullName: 'other/shared', visibility: 'private', archived: false },
      ],
      listRuns: async (repository) => [{
        id: repository.endsWith('private-app') ? 10 : 20,
        attempt: 1,
        workflowName: 'CI',
        event: 'push',
        createdAt: '2026-09-13T10:00:00Z',
        conclusion: 'success',
      }],
      listJobs: async (_repository, runId) => runId === 10 ? [
        job(101, ['ubuntu-24.04'], 'GitHub Actions 1'),
        job(102, ['self-hosted', 'linux', 'x64', 'cirujano-pilot-fixture'], 'cirujano-private-app-g1'),
        job(103, ['self-hosted', 'linux'], 'office-runner'),
        job(104, [], 'GitHub Actions 3'),
        job(105, ['ubuntu-24.04-8core'], 'GitHub Actions 4'),
        job(106, ['ubuntu-24.04'], '', { startedAt: null, completedAt: null, conclusion: 'skipped' }),
        job(107, ['ubuntu-24.04'], 'GitHub Actions 5', { completedAt: null, conclusion: 'cancelled' }),
      ] : [job(201, ['ubuntu-24.04'], 'GitHub Actions 2')],
    };

    const progress: string[] = [];
    const snapshot = await collectTelemetry({
      owner: 'juan294', lookbackHours: 48, nowMs: NOW, source,
      onRepository: (repository) => { progress.push(repository); },
    });
    expect(snapshot.repositoriesScanned).toBe(2);
    expect(progress.sort()).toEqual(['juan294/private-app', 'juan294/public-app']);
    expect(snapshot.jobs.map(({ runnerKind }) => runnerKind)).toEqual([
      'github-hosted', 'cirujano', 'self-hosted', 'github-hosted', 'github-hosted', 'github-hosted', 'github-hosted', 'github-hosted',
    ]);
    expect(snapshot.jobs[0]).toMatchObject({ billableMinutes: 2, actualGithubListCostUsd: 0.012, counterfactualHostedCostUsd: 0.012 });
    expect(snapshot.jobs[1]).toMatchObject({ actualGithubListCostUsd: 0, counterfactualHostedCostUsd: 0.012 });
    expect(snapshot.jobs[2]).toMatchObject({ actualGithubListCostUsd: 0, counterfactualHostedCostUsd: 0 });
    expect(snapshot.jobs[3]).toMatchObject({ actualGithubListCostUsd: null, counterfactualHostedCostUsd: null });
    expect(snapshot.jobs[4]).toMatchObject({ hostedSku: null, hostedUsdPerMinute: null, actualGithubListCostUsd: null, counterfactualHostedCostUsd: null });
    expect(snapshot.jobs[5]).toMatchObject({ measurementStatus: 'not-run', billableMinutes: 0, actualGithubListCostUsd: 0 });
    expect(snapshot.jobs[6]).toMatchObject({ measurementStatus: 'incomplete', billableMinutes: null, actualGithubListCostUsd: null });
    expect(snapshot.jobs[7]).toMatchObject({ visibility: 'public', actualGithubListCostUsd: 0, counterfactualHostedCostUsd: 0 });
  });

  it('skips an active run whose conclusion is not available yet', async () => {
    const source: GitHubTelemetrySource = {
      listRepositories: async () => [{ fullName: 'juan294/app', visibility: 'private', archived: false }],
      listRuns: async () => [{ id: 1, attempt: 1, workflowName: 'CI', event: 'push', createdAt: '2026-09-13T10:00:00Z', conclusion: '' }],
      listJobs: async () => { throw new Error('active run jobs must not be fetched'); },
    };
    await expect(collectTelemetry({ owner: 'juan294', lookbackHours: 48, nowMs: NOW, source }))
      .resolves.toMatchObject({ runsScanned: 1, jobs: [] });
  });

  it('does not credit a Cirujano-labelled job that never acquired a runner', async () => {
    const source: GitHubTelemetrySource = {
      listRepositories: async () => [{ fullName: 'juan294/app', visibility: 'private', archived: false }],
      listRuns: async () => [{ id: 1, attempt: 1, workflowName: 'CI', event: 'push', createdAt: '2026-09-13T10:00:00Z', conclusion: 'cancelled' }],
      listJobs: async () => [job(1, ['self-hosted', 'linux', 'cirujano-pilot-fixture'], '')],
    };
    const result = await collectTelemetry({ owner: 'juan294', lookbackHours: 48, nowMs: NOW, source });

    expect(result.jobs[0]).toMatchObject({ runnerKind: 'self-hosted', counterfactualHostedCostUsd: 0 });
  });

  it('rejects a completed job whose timestamps run backwards', async () => {
    const source: GitHubTelemetrySource = {
      listRepositories: async () => [{ fullName: 'juan294/app', visibility: 'private', archived: false }],
      listRuns: async () => [{ id: 1, attempt: 1, workflowName: 'CI', event: 'push', createdAt: '2026-09-13T10:00:00Z', conclusion: 'failure' }],
      listJobs: async () => [job(1, ['ubuntu-24.04'], 'GitHub Actions 1', {
        startedAt: '2026-09-13T10:02:00Z', completedAt: '2026-09-13T10:01:00Z',
      })],
    };
    await expect(collectTelemetry({ owner: 'juan294', lookbackHours: 48, nowMs: NOW, source }))
      .rejects.toThrow(/inconsistent timestamps/u);
  });

  it('reuses completed runs from a prior same-day snapshot', async () => {
    let jobRequests = 0;
    const source: GitHubTelemetrySource = {
      listRepositories: async () => [{ fullName: 'juan294/app', visibility: 'private', archived: false }],
      listRuns: async () => [{ id: 1, attempt: 1, workflowName: 'CI', event: 'push', createdAt: '2026-09-13T10:00:00Z', conclusion: 'success' }],
      listJobs: async () => { jobRequests += 1; return [job(1, ['ubuntu-24.04'], 'GitHub Actions 1')]; },
    };
    const first = await collectTelemetry({ owner: 'juan294', lookbackHours: 48, nowMs: NOW, source });
    const second = await collectTelemetry({ owner: 'juan294', lookbackHours: 48, nowMs: NOW + 60_000, source, priorSnapshot: first });

    expect(jobRequests).toBe(1);
    expect(second.jobs).toEqual(first.jobs);
  });

  it('deduplicates overlapping snapshots and rejects conflicting evidence', () => {
    const first = snapshot([telemetryJob({ key: 'repo:1:1:1', conclusion: 'success' })]);
    const duplicate = snapshot([telemetryJob({ key: 'repo:1:1:1', conclusion: 'success' })]);
    expect(aggregateTelemetry([first, duplicate], Date.parse('2026-09-01T00:00:00Z'))).toMatchObject({
      jobs: 1,
      successfulJobs: 1,
      githubHostedMinutes: 2,
      githubHostedListCostUsd: 0.012,
      unpricedJobs: 0,
    });
    const conflict = snapshot([telemetryJob({ key: 'repo:1:1:1', conclusion: 'failure' })]);
    expect(() => aggregateTelemetry([first, conflict], 0)).toThrow(/conflicting duplicate telemetry job/u);
  });

  it('writes snapshots atomically and renders a cumulative Markdown report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-telemetry-'));
    const value = snapshot([
      telemetryJob({ key: 'repo:1:1:1', runnerKind: 'cirujano', actualGithubListCostUsd: 0, counterfactualHostedCostUsd: 0.012 }),
    ]);
    const path = await writeTelemetrySnapshot(directory, value);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(value);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const report = aggregateTelemetry([value], 0);
    expect(renderTelemetryMarkdown(report)).toContain('| Gross hosted cost avoided | $0.01 |');
  });
});

function job(id: number, labels: string[], runnerName: string, overrides: Partial<TelemetryJobInput> = {}): TelemetryJobInput {
  return { ...baseJob(id, labels, runnerName), ...overrides };
}

function baseJob(id: number, labels: string[], runnerName: string): TelemetryJobInput {
  return {
    id,
    name: `job-${id}`,
    startedAt: '2026-09-13T10:00:00Z',
    completedAt: '2026-09-13T10:01:01Z',
    conclusion: 'success',
    labels,
    runnerName,
    runnerGroupName: '',
  };
}

function snapshot(jobs: TelemetrySnapshot['jobs']): TelemetrySnapshot {
  return {
    schemaVersion: 1,
    owner: 'juan294',
    collectedAt: '2026-09-13T12:00:00.000Z',
    windowStart: '2026-09-11T12:00:00.000Z',
    rates: {
      currency: 'USD', quotedAt: '2026-09-13',
      source: 'https://docs.github.com/en/billing/reference/actions-runner-pricing',
      skus: { actions_linux: 0.006, actions_linux_arm: 0.005, actions_windows: 0.01, actions_macos: 0.062 },
      cirujanoLabels: { 'cirujano-pilot-fixture': 'actions_linux', 'cirujano-baseline-actions_linux': 'actions_linux' },
    },
    repositoriesScanned: 1,
    runsScanned: 1,
    jobs,
  };
}

function telemetryJob(overrides: Partial<TelemetrySnapshot['jobs'][number]>): TelemetrySnapshot['jobs'][number] {
  return {
    key: 'repo:1:1:1', repository: 'juan294/repo', visibility: 'private', workflowName: 'CI',
    runId: 1, runAttempt: 1, jobId: 1, jobName: 'test', event: 'push', conclusion: 'success',
    createdAt: '2026-09-13T09:59:00Z', startedAt: '2026-09-13T10:00:00Z', completedAt: '2026-09-13T10:01:01Z',
    runnerKind: 'github-hosted', runnerName: 'GitHub Actions 1', runnerGroupName: '', labels: ['ubuntu-24.04'],
    measurementStatus: 'measured', durationMs: 61_000, billableMinutes: 2,
    hostedSku: 'actions_linux', hostedUsdPerMinute: 0.006,
    pricingSource: 'https://docs.github.com/en/billing/reference/actions-runner-pricing',
    actualGithubListCostUsd: 0.012, counterfactualHostedCostUsd: 0.012,
    ...overrides,
  };
}
