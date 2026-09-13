import { describe, expect, it } from 'vitest';

import type { LifecycleInput, Permit } from './contracts.js';
import { canBeginAssignedJob, decideLifecycle, drainDeadlineMs, parsePermit, validatePermit } from './lifecycle.js';
import { validConfig as rawConfig } from './config.test.js';
import { parseRunnerConfig } from './config.js';

const config = parseRunnerConfig(rawConfig);
const NOW = Date.parse('2026-09-13T12:00:00Z');

const permit: Permit = {
  schemaVersion: 1,
  permitId: 'permit-1',
  configHash: 'config-sha256',
  candidateDigest: 'candidate-sha256',
  repositoryId: 123,
  projectId: 'project-1',
  controllerId: 'controller-a',
  resourcePrefix: 'cirujano-a',
  operations: ['create', 'start', 'register', 'stop', 'delete'],
  issuedAtMs: NOW - 60_000,
  expiresAtMs: NOW + 7_200_000,
  maxStarts: 1,
  maxRuntimeMs: 5_400_000,
  maxTotalCostUsd: 2,
  recoveryAllowed: true,
};

function input(overrides: Partial<LifecycleInput> = {}): LifecycleInput {
  return {
    nowMs: NOW,
    config,
    identity: {
      configHash: 'config-sha256', candidateDigest: 'candidate-sha256',
      repositoryId: 123, projectId: 'project-1', controllerId: 'controller-a',
      resourcePrefix: 'cirujano-a',
    },
    permit,
    provider: { complete: true, vmStatus: 'stopped', ownership: 'owned', ownedMatches: 1, outstandingOperation: null },
    queue: { complete: true, eligibleQueuedJobs: 1, ownedBusy: false, observedAtMs: NOW },
    guest: {
      complete: true, status: 'offline', admissionEnabled: false,
      runnerActive: false, workerActive: false, grant: null,
    },
    journal: { state: 'stopped', startCount: 0, cumulativeRuntimeMs: 0, cumulativeCostUsd: 0, outstandingIntent: null, idleObservations: [] },
    projectedStartCostUsd: 1,
    ...overrides,
  };
}

describe('permit and ownership failures (R01)', () => {
  it.each([
    ['absent approval', null],
    ['expired permit', { ...permit, expiresAtMs: NOW }],
    ['candidate mismatch', { ...permit, candidateDigest: 'other' }],
    ['operation missing', { ...permit, operations: ['stop'] as const }],
  ])('%s produces an explanatory block and zero mutation effects', (_name, candidatePermit) => {
    const result = decideLifecycle(input({ permit: candidatePermit }));
    expect(result.effect).toEqual({ type: 'none' });
    expect(result.state).toBe('blocked');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('wrong resource ownership cannot emit a remote effect', () => {
    const result = decideLifecycle(input({
      provider: { complete: true, vmStatus: 'stopped', ownership: 'foreign', ownedMatches: 0, outstandingOperation: null },
    }));
    expect(result.effect.type).toBe('none');
    expect(result.state).toBe('blocked');
  });

  it('unknown provider status fails closed even when an untyped adapter leaks it through', () => {
    const result = decideLifecycle(input({
      provider: { complete: true, vmStatus: 'mystery' as never, ownership: 'owned', ownedMatches: 1, outstandingOperation: null },
    }));
    expect(result.effect.type).toBe('none');
    expect(result.state).toBe('blocked');
  });

  it('validates exact identity and finite approval bounds', () => {
    expect(validatePermit(permit, input().identity, NOW)).toEqual({ valid: true });
    expect(validatePermit({ ...permit, maxRuntimeMs: Number.NaN }, input().identity, NOW)).toEqual({
      valid: false, reason: 'permit maxRuntimeMs must be a positive finite number',
    });
  });

  it.each([
    ['unknown key', { ...permit, extra: true }],
    ['wrong operation type', { ...permit, operations: ['start', 7] }],
    ['wrong recovery type', { ...permit, recoveryAllowed: 'yes' }],
  ])('strictly rejects runtime permit input with %s', (_name, candidate) => {
    expect(() => parsePermit(candidate)).toThrow();
  });
});

describe('replay-safe transitions (R02)', () => {
  it('emits one start intent for an eligible queue and stopped owned VM', () => {
    expect(decideLifecycle(input())).toMatchObject({
      state: 'starting', effect: { type: 'start-vm', generation: 1, deadlineMs: NOW + 5_400_000 },
    });
  });

  it.each([
    ['fractional queue count', { eligibleQueuedJobs: 0.5 }],
    ['negative queue count', { eligibleQueuedJobs: -1 }],
    ['nonfinite observation time', { observedAtMs: Number.NaN }],
    ['future observation', { observedAtMs: NOW + 1 }],
    ['stale observation', { observedAtMs: NOW - 30_001 }],
  ])('blocks ordinary mutations for %s', (_name, queuePatch) => {
    const result = decideLifecycle(input({ queue: { ...input().queue, ...queuePatch } }));
    expect(result.effect.type).toBe('none');
    expect(result.state).toBe('blocked');
  });

  it('does not duplicate a start while an operation or intent is outstanding', () => {
    for (const changed of [
      input({ provider: { complete: true, vmStatus: 'starting', ownership: 'owned', ownedMatches: 1, outstandingOperation: 'op-1' } }),
      input({ journal: { ...input().journal, state: 'starting', startCount: 1, outstandingIntent: { type: 'start-vm', generation: 1, status: 'pending', deadlineMs: NOW + 5_400_000 } } }),
    ]) {
      expect(decideLifecycle(changed).effect.type).toBe('none');
    }
  });

  it('never ordinarily stops a busy job', () => {
    const result = decideLifecycle(input({
      provider: { complete: true, vmStatus: 'running', ownership: 'owned', ownedMatches: 1, outstandingOperation: null },
      queue: { complete: true, eligibleQueuedJobs: 0, ownedBusy: true, observedAtMs: NOW },
      guest: { complete: true, status: 'busy', admissionEnabled: false, runnerActive: true, workerActive: true, grant: { generation: 1, startedAtMs: NOW - 60_000, deadlineMs: NOW + 5_000_000 } },
      journal: { ...input().journal, state: 'draining', startCount: 1 },
    }));
    expect(result.effect.type).toBe('none');
    expect(result.state).toBe('busy');
  });
});

describe('drain safety (R03)', () => {
  const grant = { generation: 1, startedAtMs: NOW - 600_000, deadlineMs: NOW + 4_800_000 };
  const idleInput = input({
    provider: { complete: true, vmStatus: 'running', ownership: 'owned', ownedMatches: 1, outstandingOperation: null },
    queue: { complete: true, eligibleQueuedJobs: 0, ownedBusy: false, observedAtMs: NOW },
    guest: { complete: true, status: 'drained', admissionEnabled: false, runnerActive: false, workerActive: false, grant },
    journal: {
      ...input().journal, state: 'draining', startCount: 1,
      idleObservations: [
        { observedAtMs: NOW - 300_000, complete: true, generation: 1 },
        { observedAtMs: NOW, complete: true, generation: 1 },
      ],
    },
  });

  it('stops only after two complete observations span idle grace and the guest is drained', () => {
    expect(decideLifecycle(idleInput).effect).toEqual({ type: 'stop-vm', emergency: false });
    expect(decideLifecycle(input({ ...idleInput, journal: { ...idleInput.journal, idleObservations: [idleInput.journal.idleObservations[1]!] } })).effect.type).toBe('none');
  });

  it('returns to work when a queue arrives during drain', () => {
    const result = decideLifecycle({ ...idleInput, queue: { ...idleInput.queue, eligibleQueuedJobs: 1 } });
    expect(result).toMatchObject({ state: 'ready', effect: { type: 'resume-admission' } });
  });

  it('blocks ordinary stop on unknown busy state or incomplete observations', () => {
    for (const changed of [
      { ...idleInput, queue: { ...idleInput.queue, ownedBusy: null } },
      { ...idleInput, queue: { ...idleInput.queue, complete: false } },
      { ...idleInput, guest: { ...idleInput.guest, complete: false } },
    ]) {
      const result = decideLifecycle(changed);
      expect(result.effect.type).toBe('none');
      expect(result.state).toBe('blocked');
    }
  });

  it('caps drain fallback at the original immutable deadline', () => {
    expect(drainDeadlineMs(NOW + 60_000, NOW, 600_000)).toBe(NOW + 60_000);
    expect(drainDeadlineMs(NOW + 4_800_000, NOW, 600_000)).toBe(NOW + 600_000);
  });

  it('rejects stale observations from a previous generation', () => {
    const stale = {
      ...idleInput,
      guest: { ...idleInput.guest, grant: { ...grant, generation: 2 } },
    };
    expect(decideLifecycle(stale).effect.type).toBe('none');
  });
});

describe('deadline and admission budget (R04)', () => {
  it('emits an emergency stop at the immutable lifetime deadline', () => {
    const result = decideLifecycle(input({
      nowMs: NOW + 5_400_000,
      provider: { complete: false, vmStatus: 'unknown', ownership: 'owned', ownedMatches: 1, outstandingOperation: null },
      permit: { ...permit, expiresAtMs: NOW + 1 },
      guest: { complete: false, status: 'unknown', admissionEnabled: null, runnerActive: null, workerActive: null, grant: { generation: 1, startedAtMs: NOW, deadlineMs: NOW + 5_400_000 } },
      journal: { ...input().journal, state: 'busy', startCount: 1 },
    }));
    expect(result).toMatchObject({ state: 'stopping', effect: { type: 'stop-vm', emergency: true } });
  });

  it('does not use an invalid permit schema for emergency recovery', () => {
    const result = decideLifecycle(input({
      nowMs: NOW + 5_400_000,
      permit: { ...permit, schemaVersion: 2 as never },
      provider: { complete: false, vmStatus: 'unknown', ownership: 'owned', ownedMatches: 1, outstandingOperation: null },
      guest: { complete: false, status: 'unknown', admissionEnabled: null, runnerActive: null, workerActive: null, grant: { generation: 1, startedAtMs: NOW, deadlineMs: NOW + 5_400_000 } },
      journal: { ...input().journal, state: 'busy', startCount: 1 },
    }));
    expect(result.effect.type).toBe('none');
    expect(result.state).toBe('blocked');
  });

  it('uses actual now for recovery: future-issued blocks while expired recovery may stop', () => {
    const emergency = {
      nowMs: NOW + 5_400_000,
      provider: { complete: false, vmStatus: 'unknown' as const, ownership: 'owned' as const, ownedMatches: 1, outstandingOperation: null },
      guest: { complete: false, status: 'unknown' as const, admissionEnabled: null, runnerActive: null, workerActive: null, grant: { generation: 1, startedAtMs: NOW, deadlineMs: NOW + 5_400_000 } },
      journal: { ...input().journal, state: 'busy' as const, startCount: 1 },
    };
    expect(decideLifecycle(input({ ...emergency, permit: { ...permit, issuedAtMs: NOW + 5_400_001, expiresAtMs: NOW + 9_000_000 } })).effect.type).toBe('none');
    expect(decideLifecycle(input({ ...emergency, permit: { ...permit, expiresAtMs: NOW + 1 } })).effect).toEqual({ type: 'stop-vm', emergency: true });
  });

  it('forbids registration unless the full job and shutdown margin fit both deadlines', () => {
    const ready = input({
      provider: { complete: true, vmStatus: 'running', ownership: 'owned', ownedMatches: 1, outstandingOperation: null },
      guest: { complete: true, status: 'ready', admissionEnabled: false, runnerActive: false, workerActive: false, grant: { generation: 1, startedAtMs: NOW - 1_000, deadlineMs: NOW + 3_899_999 } },
      journal: { ...input().journal, state: 'ready', startCount: 1 },
    });
    expect(decideLifecycle(ready).effect.type).toBe('none');
    expect(decideLifecycle({ ...ready, guest: { ...ready.guest, grant: { ...ready.guest.grant!, deadlineMs: NOW + 3_900_000 } } }).effect.type).toBe('register-runner');
  });

  it('fails a delayed assignment before user steps after the safe cutoff', () => {
    expect(canBeginAssignedJob(NOW + 1, NOW + 3_900_000, NOW + 3_900_000, 3_600_000, 300_000)).toEqual({
      allowed: false, reason: 'assignment arrived after the safe job-start cutoff',
    });
  });

  it('blocks starts that exceed cumulative runtime or projected cost and caps the granted deadline', () => {
    expect(decideLifecycle(input({ journal: { ...input().journal, cumulativeRuntimeMs: 1_500_001 } })).effect.type).toBe('none');
    expect(decideLifecycle(input({ projectedStartCostUsd: 2.01 })).effect.type).toBe('none');
    const capped = decideLifecycle(input({ permit: { ...permit, maxRuntimeMs: 6_000_000 }, journal: { ...input().journal, cumulativeRuntimeMs: 1_000_000 } }));
    expect(capped.effect).toMatchObject({ type: 'start-vm', deadlineMs: NOW + 5_000_000 });
  });

  it('generated replay and restart sequences never produce a second start for one generation', () => {
    let seed = 0x5eed;
    for (let sequence = 0; sequence < 64; sequence += 1) {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      const hasIntent = (seed & 1) === 1;
      const hasOperation = (seed & 2) === 2;
      const result = decideLifecycle(input({
        provider: { complete: true, vmStatus: hasOperation ? 'starting' : 'stopped', ownership: 'owned', ownedMatches: 1, outstandingOperation: hasOperation ? `op-${sequence}` : null },
        journal: { ...input().journal, state: hasIntent ? 'starting' : 'stopped', startCount: hasIntent ? 1 : 0, outstandingIntent: hasIntent ? { type: 'start-vm', generation: 1, status: 'pending', deadlineMs: NOW + 5_400_000 } : null },
      }));
      if (hasIntent || hasOperation) expect(result.effect.type).toBe('none');
      else expect(result.effect.type).toBe('start-vm');
    }
  });


  it('evolves through ambiguous create timeout, adoption, restart and a second generation without duplication', () => {
    const absent = input({
      provider: { complete: true, vmStatus: 'absent', ownership: 'absent', ownedMatches: 0, outstandingOperation: null },
      journal: { ...input().journal, state: 'absent' },
      permit: { ...permit, maxStarts: 2, maxRuntimeMs: 10_800_000, maxTotalCostUsd: 3 },
    });
    expect(decideLifecycle(absent).effect).toEqual({
      type: 'create-vm', generation: 1, reservedStartCount: 1, deadlineMs: NOW + 5_400_000,
    });

    const timedOut = input({
      ...absent,
      journal: { ...absent.journal, startCount: 1, outstandingIntent: { type: 'create-vm', generation: 1, status: 'ambiguous', deadlineMs: NOW + 5_400_000 } },
    });
    expect(decideLifecycle(timedOut).effect.type).toBe('none');

    const adopted = decideLifecycle(input({
      ...timedOut,
      provider: { complete: true, vmStatus: 'stopped', ownership: 'owned', ownedMatches: 1, outstandingOperation: null },
    }));
    expect(adopted.effect).toEqual({ type: 'adopt-vm', generation: 1, deadlineMs: NOW + 5_400_000 });

    const restarted = decideLifecycle(input({
      permit: absent.permit,
      journal: { ...input().journal, state: 'stopped', startCount: 1, cumulativeRuntimeMs: 5_400_000, cumulativeCostUsd: 1 },
    }));
    expect(restarted.effect).toMatchObject({ type: 'start-vm', generation: 2 });
  });

  it.each([
    ['incomplete', { complete: false, vmStatus: 'running' as const }, {}, 'blocked', 'none'],
    ['unknown', { complete: true, vmStatus: 'unknown' as const }, {}, 'blocked', 'none'],
    ['error', { complete: true, vmStatus: 'error' as const }, {}, 'blocked', 'none'],
    ['starting', { complete: true, vmStatus: 'starting' as const }, {}, 'starting', 'adopt-vm'],
    ['stopped', { complete: true, vmStatus: 'stopped' as const }, {}, 'stopped', 'adopt-vm'],
    ['running without readiness', { complete: true, vmStatus: 'running' as const }, {}, 'starting', 'adopt-vm'],
    ['fully ready running', { complete: true, vmStatus: 'running' as const }, { watchdogReady: true, sshIdentityVerified: true, registrationReady: true }, 'ready', 'adopt-vm'],
  ])('adopts a create result conservatively for %s provider state', (_name, providerPatch, guestPatch, expectedState, expectedEffect) => {
    const result = decideLifecycle(input({
      provider: { ...input().provider, ...providerPatch },
      guest: { ...input().guest, status: 'ready', ...guestPatch },
      journal: {
        ...input().journal,
        state: 'starting',
        startCount: 1,
        outstandingIntent: { type: 'create-vm', generation: 1, status: 'ambiguous', deadlineMs: NOW + 5_400_000 },
      },
    }));
    expect(result.state).toBe(expectedState);
    expect(result.effect.type).toBe(expectedEffect);
  });

  it('blocks absent discovery with multiple matches', () => {
    const result = decideLifecycle(input({
      provider: { complete: true, vmStatus: 'absent', ownership: 'ambiguous', ownedMatches: 2, outstandingOperation: null },
      journal: { ...input().journal, state: 'absent' },
    }));
    expect(result.effect.type).toBe('none');
    expect(result.state).toBe('blocked');
  });
});
