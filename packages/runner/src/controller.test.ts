import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { LifecycleInput } from './contracts.js';
import { runInterruptRecovery, tickController } from './controller.js';
import { readJournal } from './journal.js';

const NOW = 1_800_000_000_000;

describe('tickController intent recovery (R10/R12)', () => {
  it('persists intent before provider IO and reconciles it on restart without duplicate mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-'));
    const journalPath = join(directory, 'state.json');
    const eventPath = join(directory, 'events.jsonl');
    let writes = 0;
    await expect(tickController({
      journalPath, eventPath, input: startInput(),
      executeEffect: async () => {
        writes += 1;
        const state = await readJournal<{ pendingEffect: unknown }>(journalPath);
        expect(state.pendingEffect).not.toBeNull();
        throw new Error('simulated process loss after intent');
      },
      reconcileEffect: async () => ({ resolved: true, readback: { vmStatus: 'starting' } }),
    })).rejects.toThrow('simulated process loss');
    expect(writes).toBe(1);

    const recovered = await tickController({
      journalPath, eventPath, input: startInput(),
      executeEffect: async () => { writes += 1; return { operationId: 'duplicate' }; },
      reconcileEffect: async () => ({ resolved: true, readback: { vmStatus: 'starting' } }),
    });
    expect(recovered.status).toBe('reconciled');
    expect(writes).toBe(1);
  });

  it.each([
    ['missing permit', { permit: null }, false],
    ['dry run', {}, true],
  ])('%s performs zero provider writes', async (_name, patch, dryRun) => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-'));
    let writes = 0;
    const result = await tickController({
      journalPath: join(directory, 'state.json'), eventPath: join(directory, 'events.jsonl'),
      input: { ...startInput(), ...patch }, dryRun,
      executeEffect: async () => { writes += 1; return {}; },
      reconcileEffect: async () => ({ resolved: false }),
    });
    expect(writes).toBe(0);
    expect(['blocked', 'dry-run']).toContain(result.status);
  });

  it('writes redacted bounded evidence for a failed mutation while retaining the intent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-'));
    const journalPath = join(directory, 'state.json');
    const eventPath = join(directory, 'events.jsonl');
    await expect(tickController({
      journalPath, eventPath, input: startInput(), secrets: ['provider-secret'],
      executeEffect: async () => { throw new Error('provider-secret failure'); },
      reconcileEffect: async () => ({ resolved: false }),
    })).rejects.toThrow();
    expect((await readFile(eventPath, 'utf8'))).not.toContain('provider-secret');
    expect((await readJournal<{ pendingEffect: { status: string } }>(journalPath)).pendingEffect.status).toBe('ambiguous');
  });
});

describe('bounded interrupt recovery (R12)', () => {
  it('returns unresolved-resource evidence when recovery exceeds its deadline', async () => {
    const result = await runInterruptRecovery({
      timeoutMs: 20,
      recover: async () => new Promise(() => undefined),
      unresolvedResources: ['vm-owned-1'],
    });
    expect(result).toEqual({ completed: false, unresolvedResources: ['vm-owned-1'], reason: 'interrupt recovery timed out' });
  });
});

function startInput(): LifecycleInput {
  return {
    nowMs: NOW,
    config: {
      schemaVersion: 1, repository: { id: 1, nameWithOwner: 'trusted/private', visibility: 'private' },
      workflowIds: [1], allowedBranch: 'develop', eligibleJobNames: ['e2e'], runnerLabel: 'pilot', slots: 1,
      nebius: { profile: 'p', projectId: 'project', subnetId: 'subnet', imageId: 'image', platform: 'cpu-d3', preset: '4vcpu-16gb', diskType: 'network-ssd', diskSizeGiB: 80 },
      ssh: { publicKey: 'ssh-ed25519 key', fingerprint: 'SHA256:key' },
      ownership: { controllerId: 'controller', resourcePrefix: 'runner' },
      timing: { pollIntervalMs: 30_000, idleGraceMs: 300_000, bootTimeoutMs: 600_000, maxJobMs: 3_600_000, lifetimeMs: 5_400_000, shutdownMarginMs: 300_000 },
      rates: { currency: 'USD', quotedAt: '2026-09-13', source: 'quote', computeUsdPerHour: 1, diskUsdPerGibMonth: 1, networkEgressUsdPerGib: 1, hostedUsdPerMinute: 1 },
    },
    identity: { configHash: 'config', candidateDigest: 'candidate', repositoryId: 1, projectId: 'project', controllerId: 'controller', resourcePrefix: 'runner' },
    permit: { schemaVersion: 1, permitId: 'permit', configHash: 'config', candidateDigest: 'candidate', repositoryId: 1, projectId: 'project', controllerId: 'controller', resourcePrefix: 'runner', operations: ['start', 'stop'], issuedAtMs: NOW - 1, expiresAtMs: NOW + 7_200_000, maxStarts: 1, maxRuntimeMs: 5_400_000, maxTotalCostUsd: 10, recoveryAllowed: true },
    provider: { complete: true, vmStatus: 'stopped', ownership: 'owned', ownedMatches: 1, outstandingOperation: null },
    queue: { complete: true, eligibleQueuedJobs: 1, ownedBusy: false, observedAtMs: NOW },
    guest: { complete: true, status: 'offline', admissionEnabled: false, runnerActive: false, workerActive: false, grant: null },
    journal: { state: 'stopped', startCount: 0, cumulativeRuntimeMs: 0, cumulativeCostUsd: 0, outstandingIntent: null, idleObservations: [] },
    projectedStartCostUsd: 1,
  };
}
