import { describe, expect, it } from 'vitest';

import type { WorkflowJob, WorkflowRun } from './adapters/github.js';
import type { Permit } from './contracts.js';
import { assessService, claimReleaseCheck, ownedRunnerMayTakeJobs, releaseCheckDue, selectStrandedRuns, serviceEnd } from './routing.js';

const LABEL = 'cirujano-baseline-actions_linux';
const LABELS = ['self-hosted', 'linux', 'x64', LABEL];
const TIMING = { maxJobMs: 3_600_000, shutdownMarginMs: 300_000 };
const EXPIRY = Date.parse('2026-10-28T23:59:59Z');
const FAR = '2026-10-10T00:00:00Z';
const identity = { configHash: 'c', candidateDigest: 'd', repositoryId: 1, projectId: 'project', controllerId: 'controller', resourcePrefix: 'prefix' };

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
      .toEqual({ cancellable: [], waiting: [10], strandedJobs: [1], strandedJobsByRun: { 10: [1] } });
    expect(selectStrandedRuns(runs, [job(1, 10, 'queued'), job(2, 10, 'completed', ['ubuntu-latest'])], LABEL))
      .toEqual({ cancellable: [10], waiting: [], strandedJobs: [1], strandedJobsByRun: { 10: [1] } });
  });

  it('ignores runs without a stranded job, jobs on another label, and jobs of a stale attempt', () => {
    const runs = [run(10), run(11, 2), run(12)];
    const jobs = [
      job(1, 10, 'queued', ['ubuntu-latest']),
      job(2, 11, 'queued', LABELS, 1),
      job(3, 11, 'completed', ['ubuntu-latest'], 2),
      job(4, 12, 'in_progress', LABELS),
    ];
    expect(selectStrandedRuns(runs, jobs, LABEL)).toEqual({ cancellable: [], waiting: [], strandedJobs: [], strandedJobsByRun: {} });
  });

  it('treats every queued job on the label as stranded, including several in one run', () => {
    expect(selectStrandedRuns([run(10), run(20)], [job(1, 10, 'queued'), job(2, 10, 'queued'), job(3, 20, 'waiting'), job(4, 20, 'queued')], LABEL))
      .toEqual({ cancellable: [10, 20], waiting: [], strandedJobs: [1, 2, 3, 4], strandedJobsByRun: { 10: [1, 2], 20: [3, 4] } });
  });
});

describe('serviceEnd and assessService', () => {
  it('ends service one maximum job and shutdown margin before expiry, the lifecycle start cutoff', () => {
    expect(new Date(serviceEnd(permit(), TIMING)).toISOString()).toBe('2026-10-28T22:54:59.000Z');
  });

  const base = { permit: permit(), timing: TIMING, startCount: 0, cumulativeRuntimeMs: 0, cumulativeCostUsd: 0, projectedStartCostUsd: 0.5, repositoryPrivate: true };

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
    ['cost-exhausted', { cumulativeCostUsd: 39.5, projectedStartCostUsd: 0.51 }],
    ['starts-exhausted', { startCount: 600 }],
    ['repository-not-private', { repositoryPrivate: false }],
    ['permit-identity-mismatch', { identity: { configHash: 'other' } }],
    ['permit-identity-mismatch', { identity: { controllerId: 'other' } }],
    ['permit-operations-missing', { permit: permit({ operations: ['stop', 'delete', 'release-routing'] }) }],
  ])('reports %s', (reason, overrides) => {
    expect(assessService({ ...base, nowMs: Date.parse('2026-10-10T00:00:00Z'), ...overrides })).toMatchObject({ serviceable: false, reason });
  });

  it('serves with a matching identity, the last start and the exact remaining cost', () => {
    expect(assessService({ ...base, nowMs: Date.parse('2026-10-10T00:00:00Z'), identity, startCount: 599, cumulativeCostUsd: 39.5, projectedStartCostUsd: 0.5 }).serviceable).toBe(true);
    expect(assessService({ ...base, nowMs: Date.parse('2026-10-10T00:00:00Z'), identity: { configHash: 'c' } }).serviceable).toBe(true);
  });

  it('serves when exactly one job and margin of runtime remain', () => {
    expect(assessService({ ...base, nowMs: Date.parse('2026-10-10T00:00:00Z'), cumulativeRuntimeMs: 540_000_000 - 3_900_000 }).serviceable).toBe(true);
  });
});

describe('releaseCheckDue', () => {
  const start = Date.parse('2026-10-28T22:55:00Z');
  it('checks at once, then at most every 10 minutes, and at once again when the reason changes', () => {
    expect(releaseCheckDue(null, 'past-service-end', start)).toBe(true);
    const last = { atMs: start, reason: 'past-service-end' };
    expect(releaseCheckDue(last, 'past-service-end', start + 599_999)).toBe(false);
    expect(releaseCheckDue(last, 'past-service-end', start + 600_000)).toBe(true);
    expect(releaseCheckDue(last, 'permit-expired', start + 1)).toBe(true);
  });

  it('records a claimed check so the next one within 10 minutes is not due', () => {
    const check = { last: null };
    expect(claimReleaseCheck(check, 'permit-expired', start)).toBe(true);
    expect(check).toEqual({ last: { atMs: start, reason: 'permit-expired' } });
    expect(claimReleaseCheck(check, 'permit-expired', start + 1)).toBe(false);
    expect(check.last).toEqual({ atMs: start, reason: 'permit-expired' });
  });
});

describe('ownedRunnerMayTakeJobs', () => {
  const intent = { type: 'create-vm' as const, generation: 1, deadlineMs: 1, status: 'pending' as const };
  it.each([
    ['absent', null, false], ['stopped', null, false], ['running', null, true], ['starting', null, true],
    ['stopping', null, true], ['unknown', null, true], ['error', null, true], ['absent', intent, true], ['stopped', intent, true],
  ] as const)('VM %s with intent %j may take jobs: %s', (vmStatus, outstandingIntent, expected) => {
    expect(ownedRunnerMayTakeJobs({ provider: { vmStatus }, journal: { outstandingIntent } })).toBe(expected);
  });

  it('counts the effect the tick just decided, such as starting a stopped VM', () => {
    const stopped = { provider: { vmStatus: 'stopped' as const }, journal: { outstandingIntent: null } };
    expect(ownedRunnerMayTakeJobs(stopped, { effect: { type: 'start-vm', generation: 2, deadlineMs: 1 } })).toBe(true);
    expect(ownedRunnerMayTakeJobs(stopped, { effect: { type: 'none' } })).toBe(false);
    expect(ownedRunnerMayTakeJobs(stopped)).toBe(false);
  });
});

describe('assessService parity with the lifecycle start decision', () => {
  it('serves exactly when the lifecycle would create a runner for queued demand', async () => {
    const { decideLifecycle } = await import('./lifecycle.js');
    const { parseRunnerConfig } = await import('./config.js');
    const config = parseRunnerConfig({
      schemaVersion: 1, repository: { id: 1, nameWithOwner: 'trusted/private', visibility: 'private' }, workflowIds: [41], allowedBranch: 'develop',
      eligibleJobNames: ['e2e'], runnerLabel: LABEL, slots: 1,
      nebius: { profile: 'pilot', projectId: 'project', subnetId: 'subnet-1', imageId: 'image-1', platform: 'cpu-d3', preset: '4vcpu-16gb', diskType: 'network-ssd', diskSizeGiB: 80 },
      ssh: { publicKey: 'ssh-ed25519 AAAA pilot', fingerprint: 'SHA256:pilot' }, ownership: { controllerId: 'controller', resourcePrefix: 'prefix' },
      timing: { pollIntervalMs: 30_000, idleGraceMs: 300_000, bootTimeoutMs: 600_000, maxJobMs: 3_600_000, lifetimeMs: 14_400_000, shutdownMarginMs: 300_000 },
      rates: { currency: 'USD', quotedAt: '2026-09-13', source: 'quote', computeUsdPerHour: 0.24, diskUsdPerGibMonth: 0.1, networkEgressUsdPerGib: 0.05, hostedUsdPerMinute: 0.008 },
    });
    const base = permit({ operations: ['create', 'start', 'register', 'stop', 'delete', 'release-routing'] });
    const end = serviceEnd(base, config.timing);
    const cases: Array<[string, Partial<Permit>, { startCount?: number; cumulativeRuntimeMs?: number; cumulativeCostUsd?: number }, number, Partial<typeof identity>]> = [
      ['valid', {}, {}, Date.parse(FAR), {}],
      ['at the service end', {}, {}, end, {}],
      ['one ms after the service end', {}, {}, end + 1, {}],
      ['expired', {}, {}, EXPIRY, {}],
      ['not yet active', { issuedAtMs: Date.parse(FAR) + 1 }, {}, Date.parse(FAR), {}],
      ['last start', { maxStarts: 3 }, { startCount: 2 }, Date.parse(FAR), {}],
      ['starts used up', { maxStarts: 3 }, { startCount: 3 }, Date.parse(FAR), {}],
      ['one job of runtime left', {}, { cumulativeRuntimeMs: 540_000_000 - 3_900_000 }, Date.parse(FAR), {}],
      ['less than one job of runtime left', {}, { cumulativeRuntimeMs: 540_000_000 - 3_899_999 }, Date.parse(FAR), {}],
      ['exact cost left', {}, { cumulativeCostUsd: 39 }, Date.parse(FAR), {}],
      ['cost left short by a cent', {}, { cumulativeCostUsd: 39.01 }, Date.parse(FAR), {}],
      ['identity mismatch', {}, {}, Date.parse(FAR), { configHash: 'other' }],
    ];
    for (const [name, permitChanges, journal, nowMs, identityChanges] of cases) {
      const current = { ...base, ...permitChanges };
      const projectedStartCostUsd = 1;
      const lifecycle = decideLifecycle({
        nowMs, config, identity: { ...identity, ...identityChanges }, permit: current, projectedStartCostUsd,
        provider: { complete: true, vmStatus: 'absent', ownership: 'absent', ownedMatches: 0, outstandingOperation: null },
        queue: { complete: true, eligibleQueuedJobs: 1, ownedBusy: false, observedAtMs: nowMs },
        guest: { complete: true, status: 'offline', admissionEnabled: false, runnerActive: false, workerActive: false, grant: null },
        journal: { state: 'absent', startCount: 0, cumulativeRuntimeMs: 0, cumulativeCostUsd: 0, outstandingIntent: null, idleObservations: [], grantDeadlineMs: null, ...journal },
      });
      const assessment = assessService({
        permit: current, nowMs, timing: config.timing, identity: { ...identity, ...identityChanges }, projectedStartCostUsd, repositoryPrivate: true,
        startCount: journal.startCount ?? 0, cumulativeRuntimeMs: journal.cumulativeRuntimeMs ?? 0, cumulativeCostUsd: journal.cumulativeCostUsd ?? 0,
      });
      expect([name, assessment.serviceable]).toEqual([name, lifecycle.effect.type === 'create-vm']);
    }
  });
});
