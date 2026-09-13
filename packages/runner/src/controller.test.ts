import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { LifecycleInput } from './contracts.js';
import { requiredPermitOperation, runInterruptRecovery, runLockedControllerTick, tickController } from './controller.js';
import { acquireControllerLock, readJournal, writeJournalAtomic } from './journal.js';

const NOW = 1_800_000_000_000;

describe('tickController intent recovery (R10/R12)', () => {
  it('persists intent before provider IO and reconciles it on restart without duplicate mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-'));
    const journalPath = join(directory, 'state.json');
    const eventPath = join(directory, 'events.jsonl');
    let writes = 0;
    const firstLock = await acquireControllerLock(directory);
    await expect(tickController({
      lock: firstLock,
      journalPath, eventPath, input: startInput(),
      executeEffect: async () => {
        writes += 1;
        const state = await readJournal<{ pendingEffect: unknown }>(journalPath);
        expect(state.pendingEffect).not.toBeNull();
        throw new Error('simulated process loss after intent');
      },
      reconcileEffect: async () => ({ resolved: true, readback: { vmStatus: 'starting' } }),
    })).rejects.toThrow('simulated process loss');
    await firstLock.release();
    expect(writes).toBe(1);

    const secondLock = await acquireControllerLock(directory);
    const recovered = await tickController({
      lock: secondLock,
      journalPath, eventPath, input: startInput(),
      executeEffect: async () => { writes += 1; return { operationId: 'duplicate' }; },
      reconcileEffect: async () => ({ resolved: true, readback: { vmStatus: 'starting' } }),
    });
    await secondLock.release();
    expect(recovered.status).toBe('reconciled');
    expect(writes).toBe(1);
    const state = await readJournal<{ identity: unknown; lifecycle: { startCount: number }; readbacks: unknown[] }>(journalPath);
    expect(state.identity).toEqual(startInput().identity);
    expect(state.lifecycle.startCount).toBe(1);
    expect(state.readbacks).toEqual([{ vmStatus: 'starting' }]);
  });

  it.each([
    ['missing permit', { permit: null }, false],
    ['dry run', {}, true],
  ])('%s performs zero provider writes', async (_name, patch, dryRun) => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-'));
    let writes = 0;
    const lock = await acquireControllerLock(directory);
    const result = await tickController({
      lock,
      journalPath: join(directory, 'state.json'), eventPath: join(directory, 'events.jsonl'),
      input: { ...startInput(), ...patch }, dryRun,
      executeEffect: async () => { writes += 1; return {}; },
      reconcileEffect: async () => ({ resolved: false }),
    });
    await lock.release();
    expect(writes).toBe(0);
    expect(['blocked', 'dry-run']).toContain(result.status);
  });

  it('writes redacted bounded evidence for a failed mutation while retaining the intent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-'));
    const journalPath = join(directory, 'state.json');
    const eventPath = join(directory, 'events.jsonl');
    const lock = await acquireControllerLock(directory);
    await expect(tickController({
      lock,
      journalPath, eventPath, input: startInput(), secrets: ['provider-secret'],
      executeEffect: async () => { throw new Error('provider-secret failure'); },
      reconcileEffect: async () => ({ resolved: false }),
    })).rejects.toThrow();
    await lock.release();
    expect((await readFile(eventPath, 'utf8'))).not.toContain('provider-secret');
    expect((await readJournal<{ pendingEffect: { status: string } }>(journalPath)).pendingEffect.status).toBe('ambiguous');
  });

  it('rejects a forged lock capability and malformed persisted state before provider IO', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-'));
    const journalPath = join(directory, 'state.json');
    const eventPath = join(directory, 'events.jsonl');
    let writes = 0;
    await expect(tickController({
      lock: {} as never, journalPath, eventPath, input: startInput(),
      executeEffect: async () => { writes += 1; return {}; },
      reconcileEffect: async () => ({ resolved: false }),
    })).rejects.toThrow(/lock/i);
    await writeJournalAtomic(journalPath, { schemaVersion: 1, surprise: true });
    const lock = await acquireControllerLock(directory);
    await expect(tickController({
      lock, journalPath, eventPath, input: startInput(),
      executeEffect: async () => { writes += 1; return {}; },
      reconcileEffect: async () => ({ resolved: false }),
    })).rejects.toThrow(/state/i);
    await lock.release();
    expect(writes).toBe(0);
  });

  it('observes, decides and mutates inside one lock-scoped entry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-'));
    let writes = 0;
    const result = await runLockedControllerTick({
      stateDirectory: directory,
      journalPath: join(directory, 'state.json'), eventPath: join(directory, 'events.jsonl'),
      observe: async () => {
        await expect(acquireControllerLock(directory)).rejects.toThrow(/another controller/);
        return startInput();
      },
      executeEffect: async () => { writes += 1; return { operationId: 'op-1' }; },
      reconcileEffect: async () => ({ resolved: false }),
    });
    expect(result.status).toBe('mutated');
    expect(writes).toBe(1);
  });

  it('recovers a real controller process killed after intent without repeating provider IO', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-crash-'));
    const journalPath = join(directory, 'state.json');
    const eventPath = join(directory, 'events.jsonl');
    const source = `
      import { tickController } from './dist/controller.js';
      import { acquireControllerLock } from './dist/journal.js';
      const lock = await acquireControllerLock(${JSON.stringify(directory)});
      await tickController({
        lock, journalPath: ${JSON.stringify(journalPath)}, eventPath: ${JSON.stringify(eventPath)},
        input: ${JSON.stringify(startInput())},
        executeEffect: async () => process.exit(17),
        reconcileEffect: async () => ({ resolved: false }),
      });
    `;
    const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', source], {
      cwd: process.cwd(), stdio: 'ignore',
    });
    expect(await new Promise<number | null>((resolve) => child.once('exit', resolve))).toBe(17);
    expect((await readJournal<{ pendingEffect: unknown }>(journalPath)).pendingEffect).not.toBeNull();

    let writes = 0;
    const lock = await acquireControllerLock(directory);
    const result = await tickController({
      lock, journalPath, eventPath, input: startInput(),
      executeEffect: async () => { writes += 1; return {}; },
      reconcileEffect: async () => ({ resolved: true, readback: { vmStatus: 'starting' } }),
    });
    await lock.release();
    expect(result.status).toBe('reconciled');
    expect(writes).toBe(0);
  });

  it('persists current no-effect observations and rejects monotonic counter regressions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-state-'));
    const paths = { journalPath: join(directory, 'state.json'), eventPath: join(directory, 'events.jsonl') };
    const current = startInput();
    current.queue.eligibleQueuedJobs = 0;
    current.journal = {
      ...current.journal,
      startCount: 1,
      cumulativeRuntimeMs: 120_000,
      cumulativeCostUsd: 1.25,
      idleObservations: [{ observedAtMs: NOW, complete: true, generation: 1 }],
    };
    const first = await acquireControllerLock(directory);
    await tickController({ lock: first, ...paths, input: current, executeEffect: async () => ({}), reconcileEffect: async () => ({ resolved: false }) });
    await first.release();
    const saved = await readJournal<{ lifecycle: LifecycleInput['journal'] }>(paths.journalPath);
    expect(saved.lifecycle.cumulativeRuntimeMs).toBe(120_000);
    expect(saved.lifecycle.cumulativeCostUsd).toBe(1.25);
    expect(saved.lifecycle.idleObservations).toEqual(current.journal.idleObservations);

    const regressed = startInput();
    regressed.queue.eligibleQueuedJobs = 0;
    const second = await acquireControllerLock(directory);
    await expect(tickController({ lock: second, ...paths, input: regressed, executeEffect: async () => ({}), reconcileEffect: async () => ({ resolved: false }) })).rejects.toThrow(/regress/i);
    await second.release();
  });

  it('rejects pending-effect and lifecycle-intent disagreement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-invariant-'));
    const journalPath = join(directory, 'state.json');
    const input = startInput();
    await writeJournalAtomic(journalPath, {
      schemaVersion: 1,
      identity: input.identity,
      lifecycle: { ...input.journal, outstandingIntent: { type: 'start-vm', generation: 1, status: 'pending', deadlineMs: NOW + 5_400_000 } },
      pendingEffect: null,
      readbacks: [],
    });
    const lock = await acquireControllerLock(directory);
    await expect(tickController({
      lock, journalPath, eventPath: join(directory, 'events.jsonl'), input,
      executeEffect: async () => ({}), reconcileEffect: async () => ({ resolved: false }),
    })).rejects.toThrow(/invariant/i);
    await lock.release();
  });

  it('persists exact operation authority and blocks retry after expiry with durable evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-controller-auth-'));
    const journalPath = join(directory, 'state.json');
    const eventPath = join(directory, 'events.jsonl');
    let writes = 0;
    const first = await acquireControllerLock(directory);
    await expect(tickController({
      lock: first, journalPath, eventPath, input: startInput(),
      executeEffect: async () => { writes += 1; throw new Error('ambiguous'); },
      reconcileEffect: async () => ({ resolved: false }),
    })).rejects.toThrow('ambiguous');
    await first.release();
    const pending = await readJournal<{ pendingEffect: { authorization: { permitId: string; operation: string; permitExpiresAtMs: number } } }>(journalPath);
    expect(pending.pendingEffect.authorization).toEqual(expect.objectContaining({
      permitId: 'permit', operation: 'start', permitExpiresAtMs: NOW + 7_200_000,
    }));

    const expired = startInput();
    expired.nowMs = NOW + 7_200_001;
    expired.queue.observedAtMs = expired.nowMs;
    const second = await acquireControllerLock(directory);
    const result = await tickController({
      lock: second, journalPath, eventPath, input: expired,
      executeEffect: async () => { writes += 1; return {}; },
      reconcileEffect: async () => ({ resolved: false, retry: true }),
    });
    await second.release();
    expect(result.status).toBe('blocked');
    expect(writes).toBe(1);
    expect((await readJournal<{ pendingEffect: { status: string } }>(journalPath)).pendingEffect.status).toBe('blocked');
    expect(await readFile(eventPath, 'utf8')).toContain('effect-authorization-blocked');
  });

  it.each(['intent', 'emitting'] as const)('dry-run suppresses pending %s execution and reconciliation without changing journal state', async (stage) => {
    const directory = await mkdtemp(join(tmpdir(), `cirujano-dry-pending-${stage}-`));
    const journalPath = join(directory, 'state.json');
    const eventPath = join(directory, 'events.jsonl');
    const seedLock = await acquireControllerLock(directory);
    if (stage === 'intent') {
      await expect(tickController({
        lock: seedLock, journalPath, eventPath, input: startInput(),
        boundary: async (name) => { if (name === 'after-intent-journal') throw new Error('crash at intent'); },
        executeEffect: async () => ({}), reconcileEffect: async () => ({ resolved: false }),
      })).rejects.toThrow('crash at intent');
    } else {
      await expect(tickController({
        lock: seedLock, journalPath, eventPath, input: startInput(),
        executeEffect: async () => { throw new Error('ambiguous provider'); },
        reconcileEffect: async () => ({ resolved: false }),
      })).rejects.toThrow('ambiguous provider');
    }
    await seedLock.release();
    const before = await readFile(journalPath, 'utf8');
    let executes = 0;
    let reconciles = 0;
    const dryLock = await acquireControllerLock(directory);
    const result = await tickController({
      lock: dryLock, journalPath, eventPath, input: startInput(), dryRun: true,
      executeEffect: async () => { executes += 1; return {}; },
      reconcileEffect: async () => { reconciles += 1; return { resolved: false, retry: true }; },
    });
    await dryLock.release();
    expect(result.status).toBe('dry-run');
    expect(executes).toBe(0);
    expect(reconciles).toBe(0);
    expect(await readFile(journalPath, 'utf8')).toBe(before);
    expect(await readFile(eventPath, 'utf8')).toContain('dry-run-pending');
  });

  it('maps lifecycle mutations to the exact permit operation', () => {
    expect([
      requiredPermitOperation({ type: 'create-vm', generation: 1, reservedStartCount: 1, deadlineMs: NOW + 1 }),
      requiredPermitOperation({ type: 'adopt-vm', generation: 1, deadlineMs: NOW + 1 }),
      requiredPermitOperation({ type: 'start-vm', generation: 1, deadlineMs: NOW + 1 }),
      requiredPermitOperation({ type: 'register-runner', assignmentCutoffMs: NOW + 1 }),
      requiredPermitOperation({ type: 'begin-drain', fallbackDeadlineMs: NOW + 1 }),
      requiredPermitOperation({ type: 'resume-admission' }),
      requiredPermitOperation({ type: 'stop-vm', emergency: true }),
    ]).toEqual(['create', 'create', 'start', 'register', 'register', 'register', 'stop']);
  });

  const crashCases = [
    'after-intent-journal', 'after-intent-event', 'before-provider-io',
    'after-emitting-journal', 'after-provider-io', 'after-readback-journal',
    'after-final-event',
  ].flatMap((boundary) => [['vm', boundary], ['registration', boundary]] as const);

  it.each(crashCases)('survives external SIGKILL for %s at %s with exactly one provider resource', async (kind, boundary) => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-boundary-'));
    const ledgerPath = join(directory, 'provider-ledger.jsonl');
    await writeFile(ledgerPath, '');
    const child = startBoundaryProcess(directory, ledgerPath, boundary, kind);
    await waitForChildText(child, `boundary:${boundary}`);
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    const recovered = startBoundaryProcess(directory, ledgerPath, null, kind);
    expect(await new Promise<number | null>((resolve) => recovered.once('exit', resolve))).toBe(0);
    const resources = (await readFile(ledgerPath, 'utf8')).trim().split('\n').filter(Boolean);
    expect(new Set(resources).size).toBe(1);
    expect(resources).toHaveLength(1);
  });

  it('does not emit provider IO when a killed controller restarts after authorization expiry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-expired-boundary-'));
    const ledgerPath = join(directory, 'provider-ledger.jsonl');
    await writeFile(ledgerPath, '');
    const child = startBoundaryProcess(directory, ledgerPath, 'after-intent-journal', 'vm');
    await waitForChildText(child, 'boundary:after-intent-journal');
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const recovered = startBoundaryProcess(directory, ledgerPath, null, 'vm', NOW + 7_200_001);
    expect(await new Promise<number | null>((resolve) => recovered.once('exit', resolve))).toBe(0);
    expect(await readFile(ledgerPath, 'utf8')).toBe('');
    expect(await readFile(join(directory, 'events.jsonl'), 'utf8')).toContain('effect-authorization-blocked');
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

function startBoundaryProcess(directory: string, ledgerPath: string, boundary: string | null, kind: 'vm' | 'registration', nowMs?: number) {
  const journalPath = join(directory, 'state.json');
  const eventPath = join(directory, 'events.jsonl');
  const observedInput = kind === 'vm' ? createInput() : registrationInput();
  if (nowMs !== undefined) {
    observedInput.nowMs = nowMs;
    observedInput.queue.observedAtMs = nowMs;
  }
  const source = `
      import { readFile, appendFile } from 'node:fs/promises';
      import { runLockedControllerTick } from './dist/controller.js';
      import { readJournal } from './dist/journal.js';
    const ledger = ${JSON.stringify(ledgerPath)};
    const effectKey = ${JSON.stringify(`${kind}-1`)};
    const readLedger = async () => (await readFile(ledger, 'utf8')).split('\\n').filter(Boolean);
    await runLockedControllerTick({
      stateDirectory: ${JSON.stringify(directory)},
      journalPath: ${JSON.stringify(journalPath)}, eventPath: ${JSON.stringify(eventPath)},
      observe: async () => {
        const base = ${JSON.stringify(observedInput)};
        const entries = await readLedger();
        if (entries.includes(effectKey)) {
          if (${JSON.stringify(kind)} === 'vm') {
            base.provider = { complete: true, vmStatus: 'stopped', ownership: 'owned', ownedMatches: 1, outstandingOperation: null };
          } else {
            base.queue = { ...base.queue, eligibleQueuedJobs: 0, ownedBusy: true };
            base.guest = { ...base.guest, status: 'busy', runnerActive: true, workerActive: true };
          }
        }
        try {
          const saved = await readJournal(${JSON.stringify(journalPath)});
          return { ...base, journal: saved.lifecycle };
        } catch { return base; }
      },
      boundary: async (name) => {
        if (name === ${JSON.stringify(boundary)}) {
          process.stdout.write('boundary:' + name + '\\n');
          await new Promise(() => {});
        }
      },
      executeEffect: async () => {
        await appendFile(ledger, effectKey + '\\n');
        return { operationId: 'op-1', resolved: true, readback: { resourceId: effectKey } };
      },
      reconcileEffect: async () => {
        const entries = await readLedger();
        return entries.includes(effectKey)
          ? { resolved: true, readback: { resourceId: effectKey } }
          : { resolved: false, retry: true };
      },
    });
  `;
  return spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
}

function registrationInput(): LifecycleInput {
  const input = startInput();
  input.permit = { ...input.permit!, operations: ['register', 'stop'] };
  input.provider = { ...input.provider, vmStatus: 'running' };
  input.guest = {
    complete: true, status: 'ready', admissionEnabled: false, runnerActive: false,
    workerActive: false, grant: { generation: 1, startedAtMs: NOW - 1_000, deadlineMs: NOW + 5_400_000 },
    watchdogReady: true, sshIdentityVerified: true, registrationReady: true,
  };
  input.journal = { ...input.journal, state: 'ready', startCount: 1 };
  return input;
}

function createInput(): LifecycleInput {
  const input = startInput();
  input.permit = { ...input.permit!, operations: ['create', 'stop'] };
  input.provider = { complete: true, vmStatus: 'absent', ownership: 'absent', ownedMatches: 0, outstandingOperation: null };
  input.journal = { ...input.journal, state: 'absent' };
  return input;
}

function waitForChildText(child: ReturnType<typeof spawn>, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child did not reach ${expected}`)), 5_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(expected)) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`child exited ${String(code)} before ${expected}`)); });
  });
}
