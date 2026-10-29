import { describe, expect, it } from 'vitest';

import type { WorkflowJob, WorkflowRun } from './adapters/github.js';
import type { Permit } from './contracts.js';
import { assessService, selectStrandedRuns, serviceEnd } from './routing.js';

const LABEL = 'cirujano-baseline-actions_linux';
const LABELS = ['self-hosted', 'linux', 'x64', LABEL];
const TIMING = { maxJobMs: 3_600_000, shutdownMarginMs: 300_000 };
const EXPIRY = Date.parse('2026-10-28T23:59:59Z');

function run(id: number, runAttempt = 1): WorkflowRun {
  return { id, workflowId: 41, runAttempt, status: 'queued', conclusion: null, event: 'push', headBranch: 'develop', headSha: 'a', repositoryId: 1, headRepositoryId: 1, pullRequestCount: 0 };
}

function job(id: number, runId: number, status: string, labels: readonly string[] = LABELS, runAttempt = 1): WorkflowJob {
  return {
    key: `${runId}:${runAttempt}:${id}`, id, runId, runAttempt, headSha: 'a', status, conclusion: status === 'completed' ? 'success' : null, name: `job ${id}`,
    labels, runnerId: null, runnerName: null, runnerGroupId: null, runnerGroupName: null, startedAt: null, completedAt: null,
  };
}

function permit(overrides: Partial<Permit> = {}): Permit {
  return {
    schemaVersion: 1, permitId: 'P3-operating', configHash: 'c', candidateDigest: 'd', repositoryId: 1, projectId: 'project', controllerId: 'controller',
    resourcePrefix: 'prefix', operations: ['create', 'start', 'register', 'stop', 'delete'], issuedAtMs: Date.parse('2026-09-29T00:00:00Z'),
    expiresAtMs: EXPIRY, maxStarts: 600, maxRuntimeMs: 540_000_000, maxTotalCostUsd: 40, recoveryAllowed: true, ...overrides,
  };
}

describe('selectStrandedRuns', () => {
  it('waits while another job runs, then selects the run', () => {
    const runs = [run(10)];
    expect(selectStrandedRuns(runs, [job(1, 10, 'queued'), job(2, 10, 'in_progress', ['ubuntu-latest'])], LABEL))
      .toEqual({ cancellable: [], waiting: [10], strandedJobs: [1] });
    expect(selectStrandedRuns(runs, [job(1, 10, 'queued'), job(2, 10, 'completed', ['ubuntu-latest'])], LABEL))
      .toEqual({ cancellable: [10], waiting: [], strandedJobs: [1] });
  });

  it('ignores runs without a stranded job, jobs on another label, and jobs of a stale attempt', () => {
    const runs = [run(10), run(11, 2), run(12)];
    const jobs = [
      job(1, 10, 'queued', ['ubuntu-latest']),
      job(2, 11, 'queued', LABELS, 1),
      job(3, 11, 'completed', ['ubuntu-latest'], 2),
      job(4, 12, 'in_progress', LABELS),
    ];
    expect(selectStrandedRuns(runs, jobs, LABEL)).toEqual({ cancellable: [], waiting: [], strandedJobs: [] });
  });

  it('treats every queued job on the label as stranded, including several in one run', () => {
    expect(selectStrandedRuns([run(10), run(20)], [job(1, 10, 'queued'), job(2, 10, 'queued'), job(3, 20, 'waiting'), job(4, 20, 'queued')], LABEL))
      .toEqual({ cancellable: [10, 20], waiting: [], strandedJobs: [1, 2, 3, 4] });
  });
});

describe('serviceEnd and assessService', () => {
  it('ends service one maximum job and shutdown margin before expiry, the lifecycle start cutoff', () => {
    expect(new Date(serviceEnd(permit(), TIMING)).toISOString()).toBe('2026-10-28T22:54:59.000Z');
  });

  const base = { permit: permit(), timing: TIMING, cumulativeRuntimeMs: 0, cumulativeCostUsd: 0, repositoryPrivate: true };

  it('serves up to and including the service end, matching the strict start-budget comparison', () => {
    expect(assessService({ ...base, nowMs: Date.parse('2026-10-28T22:54:59.000Z') })).toEqual({ serviceable: true, serviceEndMs: Date.parse('2026-10-28T22:54:59.000Z') });
    expect(assessService({ ...base, nowMs: Date.parse('2026-10-28T22:54:59.001Z') })).toMatchObject({ serviceable: false, reason: 'past-service-end' });
  });

  it.each([
    ['permit-absent', { permit: null }],
    ['permit-not-active', { permit: permit({ issuedAtMs: Date.parse('2026-10-20T00:00:00Z') }) }],
    ['permit-expired', { nowMs: EXPIRY }],
    ['runtime-exhausted', { cumulativeRuntimeMs: 540_000_000 }],
    ['runtime-exhausted', { cumulativeRuntimeMs: 540_000_000 - 3_899_999 }],
    ['cost-exhausted', { cumulativeCostUsd: 40 }],
    ['repository-not-private', { repositoryPrivate: false }],
  ])('reports %s', (reason, overrides) => {
    expect(assessService({ ...base, nowMs: Date.parse('2026-10-10T00:00:00Z'), ...overrides })).toMatchObject({ serviceable: false, reason });
  });

  it('serves when exactly one job and margin of runtime remain', () => {
    expect(assessService({ ...base, nowMs: Date.parse('2026-10-10T00:00:00Z'), cumulativeRuntimeMs: 540_000_000 - 3_900_000 }).serviceable).toBe(true);
  });
});
