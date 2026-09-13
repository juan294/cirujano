import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

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

  it('timestamps a live snapshot after collection finishes', async () => {
    const clock = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW + 300_000);
    const source: GitHubTelemetrySource = {
      listRepositories: async () => [],
      listRuns: async () => [],
      listJobs: async () => [],
    };

    try {
      const result = await collectTelemetry({ owner: 'juan294', lookbackHours: 48, source });
      expect(result.windowStart).toBe('2026-09-11T12:00:00.000Z');
      expect(result.collectedAt).toBe('2026-09-13T12:05:00.000Z');
    } finally {
      clock.mockRestore();
    }
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

  it('preserves a completed job with provider-inconsistent timestamps as incomplete', async () => {
    const source: GitHubTelemetrySource = {
      listRepositories: async () => [{ fullName: 'juan294/app', visibility: 'private', archived: false }],
      listRuns: async () => [{ id: 1, attempt: 1, workflowName: 'CI', event: 'push', createdAt: '2026-09-13T10:00:00Z', conclusion: 'failure' }],
      listJobs: async () => [job(1, ['ubuntu-24.04'], 'GitHub Actions 1', {
        startedAt: '2026-09-13T10:02:00Z', completedAt: '2026-09-13T10:01:00Z',
      })],
    };
    const result = await collectTelemetry({ owner: 'juan294', lookbackHours: 48, nowMs: NOW, source });

    expect(result.jobs[0]).toMatchObject({
      measurementStatus: 'incomplete', durationMs: null, billableMinutes: null,
      actualGithubListCostUsd: null, counterfactualHostedCostUsd: null,
    });
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

  it('reuses a conclusively empty completed run', async () => {
    let jobRequests = 0;
    const source: GitHubTelemetrySource = {
      listRepositories: async () => [{ fullName: 'juan294/app', visibility: 'private', archived: false }],
      listRuns: async () => [{ id: 1, attempt: 1, workflowName: 'CI', event: 'push', createdAt: '2026-09-13T10:00:00Z', conclusion: 'skipped' }],
      listJobs: async () => { jobRequests += 1; return []; },
    };
    const first = await collectTelemetry({ owner: 'juan294', lookbackHours: 48, nowMs: NOW, source });
    const second = await collectTelemetry({ owner: 'juan294', lookbackHours: 48, nowMs: NOW + 60_000, source, priorSnapshot: first });

    expect(jobRequests).toBe(1);
    expect(first.runs).toEqual([{
      key: 'juan294/app:1:1', repository: 'juan294/app', id: 1, attempt: 1,
      workflowName: 'CI', event: 'push', createdAt: '2026-09-13T10:00:00Z', conclusion: 'skipped',
      jobsObserved: 0, reusable: true,
    }]);
    expect(second.runs).toEqual(first.runs);
  });

  it('refetches a prior run until incomplete timing becomes conclusive', async () => {
    let jobRequests = 0;
    const source: GitHubTelemetrySource = {
      listRepositories: async () => [{ fullName: 'juan294/app', visibility: 'private', archived: false }],
      listRuns: async () => [{ id: 1, attempt: 1, workflowName: 'CI', event: 'push', createdAt: '2026-09-13T10:00:00Z', conclusion: 'success' }],
      listJobs: async () => {
        jobRequests += 1;
        return [job(1, ['ubuntu-24.04'], 'GitHub Actions 1', jobRequests === 1
          ? { completedAt: null }
          : {})];
      },
    };
    const first = await collectTelemetry({ owner: 'juan294', lookbackHours: 48, nowMs: NOW, source });
    const second = await collectTelemetry({ owner: 'juan294', lookbackHours: 48, nowMs: NOW + 60_000, source, priorSnapshot: first });

    expect(jobRequests).toBe(2);
    expect(first.runs[0]).toMatchObject({ key: 'juan294/app:1:1', jobsObserved: 1, reusable: false });
    expect(second.runs[0]).toMatchObject({ key: 'juan294/app:1:1', jobsObserved: 1, reusable: true });
    expect(second.jobs[0]).toMatchObject({ measurementStatus: 'measured', billableMinutes: 2 });
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

  it('reports deterministic usage and savings by repository', () => {
    const value = snapshot([
      telemetryJob({ key: 'b:1:1:1', repository: 'juan294/zeta', billableMinutes: 3, actualGithubListCostUsd: 0.018, counterfactualHostedCostUsd: 0.018 }),
      telemetryJob({ key: 'a:1:1:1', repository: 'juan294/alpha', runnerKind: 'cirujano', billableMinutes: 2, actualGithubListCostUsd: 0, counterfactualHostedCostUsd: 0.012 }),
    ]);
    value.repositoryInventory.push({ fullName: 'juan294/empty', visibility: 'private' });

    const report = aggregateTelemetry([value], 0);

    expect(report.byRepository).toEqual([
      { repository: 'juan294/alpha', jobs: 1, githubHostedMinutes: 0, githubHostedListCostUsd: 0, cirujanoJobs: 1, cirujanoMinutes: 2, grossHostedCostAvoidedUsd: 0.012, unpricedJobs: 0 },
      { repository: 'juan294/empty', jobs: 0, githubHostedMinutes: 0, githubHostedListCostUsd: 0, cirujanoJobs: 0, cirujanoMinutes: 0, grossHostedCostAvoidedUsd: 0, unpricedJobs: 0 },
      { repository: 'juan294/zeta', jobs: 1, githubHostedMinutes: 3, githubHostedListCostUsd: 0.018, cirujanoJobs: 0, cirujanoMinutes: 0, grossHostedCostAvoidedUsd: 0, unpricedJobs: 0 },
    ]);
    expect(renderTelemetryMarkdown(report)).toContain('| `juan294/alpha` | 1 | 0 | $0.00 | 1 | 2 | $0.01 | 0 |');
  });

  it('uses the latest inventory while retaining repositories with jobs in the window', () => {
    const old = snapshot([telemetryJob({
      key: 'legacy:1:1:1', repository: 'juan294/legacy', createdAt: '2026-09-01T09:59:00Z',
      startedAt: '2026-09-01T10:00:00Z', completedAt: '2026-09-01T10:01:01Z',
    })]);
    old.collectedAt = '2026-09-02T12:00:00.000Z';
    old.repositoryInventory[0]!.visibility = 'private';
    const latest = snapshot([telemetryJob({ key: 'active:1:1:1', repository: 'juan294/active', visibility: 'public', actualGithubListCostUsd: 0, counterfactualHostedCostUsd: 0 })]);
    latest.collectedAt = '2026-09-14T12:00:00.000Z';
    latest.repositoryInventory.push({ fullName: 'juan294/empty', visibility: 'private' });
    latest.repositoriesScanned = 2;

    const report = aggregateTelemetry([latest, old], Date.parse('2026-09-13T00:00:00Z'));

    expect(report.byRepository.map(({ repository }) => repository)).toEqual(['juan294/active', 'juan294/empty']);
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
  const repositoryInventory = [...new Map(jobs.map(({ repository, visibility }) => [repository, { fullName: repository, visibility }])).values()];
  const runKeys = [...new Set(jobs.map(({ repository, runId, runAttempt }) => `${repository}:${runId}:${runAttempt}`))];
  const runs = runKeys.map((key) => {
    const grouped = jobs.filter(({ repository, runId, runAttempt }) => `${repository}:${runId}:${runAttempt}` === key);
    const first = grouped[0]!;
    return {
      key, repository: first.repository, id: first.runId, attempt: first.runAttempt,
      workflowName: first.workflowName, event: first.event, createdAt: first.createdAt, conclusion: first.conclusion,
      jobsObserved: grouped.length,
      reusable: grouped.every(({ measurementStatus }) => measurementStatus !== 'incomplete'),
    };
  });
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
    repositoryInventory,
    repositoriesScanned: repositoryInventory.length,
    runsScanned: runs.length,
    runs,
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
