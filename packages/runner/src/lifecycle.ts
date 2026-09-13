import type {
  LifecycleDecision,
  LifecycleInput,
  Permit,
  PermitIdentity,
  PermitOperation,
} from './contracts.js';

const DRAIN_FALLBACK_MS = 600_000;
const PERMIT_OPERATIONS: readonly PermitOperation[] = ['create', 'start', 'register', 'stop', 'delete'];
const PERMIT_KEYS = [
  'schemaVersion', 'permitId', 'configHash', 'candidateDigest', 'repositoryId',
  'projectId', 'controllerId', 'resourcePrefix', 'operations', 'issuedAtMs',
  'expiresAtMs', 'maxStarts', 'maxRuntimeMs', 'maxTotalCostUsd', 'recoveryAllowed',
] as const;

export type PermitValidation = { valid: true } | { valid: false; reason: string };

export class PermitError extends Error {
  override readonly name = 'PermitError';
}

export function parsePermit(input: unknown): Permit {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new PermitError('permit must be an object');
  const value = input as Record<string, unknown>;
  const unknown = Object.keys(value).find((key) => !PERMIT_KEYS.includes(key as typeof PERMIT_KEYS[number]));
  if (unknown !== undefined) throw new PermitError(`permit contains unknown key ${unknown}`);
  const missing = PERMIT_KEYS.find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) throw new PermitError(`permit is missing ${missing}`);
  if (value['schemaVersion'] !== 1) throw new PermitError('permit schemaVersion must be 1');
  if (!Array.isArray(value['operations']) || value['operations'].length === 0
    || value['operations'].some((operation) => typeof operation !== 'string' || !PERMIT_OPERATIONS.includes(operation as PermitOperation))) {
    throw new PermitError('permit operations are invalid');
  }
  if (typeof value['recoveryAllowed'] !== 'boolean') throw new PermitError('permit recoveryAllowed must be boolean');
  const stringKeys = ['permitId', 'configHash', 'candidateDigest', 'projectId', 'controllerId', 'resourcePrefix'] as const;
  for (const key of stringKeys) {
    if (typeof value[key] !== 'string' || value[key].trim().length === 0) throw new PermitError(`permit ${key} must be a nonempty string`);
  }
  const numberKeys = ['repositoryId', 'issuedAtMs', 'expiresAtMs', 'maxStarts', 'maxRuntimeMs', 'maxTotalCostUsd'] as const;
  for (const key of numberKeys) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throw new PermitError(`permit ${key} must be finite`);
  }
  const permit = value as unknown as Permit;
  const shape = validatePermit(permit, permit, permit.issuedAtMs);
  if (!shape.valid) throw new PermitError(shape.reason);
  return permit;
}

export function validatePermit(permit: Permit | null, identity: PermitIdentity, nowMs: number): PermitValidation {
  if (permit === null) return invalid('approval permit is absent');
  if (permit.schemaVersion !== 1) return invalid('permit schemaVersion must be 1');
  for (const [name, value] of [
    ['issuedAtMs', permit.issuedAtMs], ['expiresAtMs', permit.expiresAtMs],
    ['maxRuntimeMs', permit.maxRuntimeMs], ['maxTotalCostUsd', permit.maxTotalCostUsd],
  ] as const) {
    if (!Number.isFinite(value) || (name !== 'maxTotalCostUsd' && value <= 0) || (name === 'maxTotalCostUsd' && value < 0)) {
      return invalid(`permit ${name} must be a ${name === 'maxTotalCostUsd' ? 'non-negative' : 'positive'} finite number`);
    }
  }
  if (!Number.isInteger(permit.maxStarts) || permit.maxStarts <= 0) return invalid('permit maxStarts must be a positive integer');
  if (permit.issuedAtMs > nowMs) return invalid('permit is not active yet');
  if (permit.expiresAtMs <= nowMs) return invalid('permit is expired');
  if (permit.expiresAtMs <= permit.issuedAtMs) return invalid('permit expiry must follow issue time');
  for (const operation of permit.operations) {
    if (!PERMIT_OPERATIONS.includes(operation)) return invalid(`permit contains unknown operation ${String(operation)}`);
  }
  if (permit.operations.length === 0) return invalid('permit operations must not be empty');
  const mismatch = identityMismatch(permit, identity);
  return mismatch === null ? { valid: true } : invalid(mismatch);
}

export function decideLifecycle(input: LifecycleInput): LifecycleDecision {
  if (!Number.isFinite(input.nowMs)) return blocked('current time is invalid');
  if (!validSnapshotEnums(input)) return blocked('provider or guest snapshot contains an unknown value');
  if (!Number.isInteger(input.provider.ownedMatches) || input.provider.ownedMatches < 0) return blocked('owned resource match count is invalid');

  const grant = input.guest.grant;
  if (grant !== null && input.nowMs >= grant.deadlineMs) {
    const recovery = validateRecoveryPermit(input.permit, input.identity, input.nowMs);
    return recovery.valid && permits(input.permit, 'stop')
      ? { state: 'stopping', effect: { type: 'stop-vm', emergency: true }, reason: 'immutable start lifetime reached' }
      : blocked(recovery.valid ? 'permit does not authorize emergency stop' : recovery.reason);
  }

  const queueProblem = validateQueueObservation(input);
  if (queueProblem !== null) return blocked(queueProblem);

  if (input.journal.outstandingIntent?.type === 'create-vm') {
    if (input.provider.ownership === 'owned' && input.provider.ownedMatches === 1) {
      if (!input.provider.complete) return blocked('create adoption requires a complete provider observation');
      if (input.provider.vmStatus === 'unknown' || input.provider.vmStatus === 'error') {
        return blocked(`create adoption rejects provider state ${input.provider.vmStatus}`);
      }
      if (!['stopped', 'starting', 'running'].includes(input.provider.vmStatus)) {
        return blocked(`create adoption cannot reconcile provider state ${input.provider.vmStatus}`);
      }
      const fullyReady = input.provider.vmStatus === 'running'
        && input.guest.complete
        && input.guest.status === 'ready'
        && input.guest.watchdogReady === true
        && input.guest.sshIdentityVerified === true
        && input.guest.registrationReady === true;
      const adoptedState = input.provider.vmStatus === 'stopped'
        ? 'stopped'
        : fullyReady ? 'ready' : 'starting';
      return {
        state: adoptedState,
        effect: {
          type: 'adopt-vm',
          generation: input.journal.outstandingIntent.generation,
          deadlineMs: input.journal.outstandingIntent.deadlineMs,
        },
        reason: 'adopted the single proven owned resource after create uncertainty',
      };
    }
    return blocked('create intent is unresolved and cannot be repeated');
  }

  if (input.provider.vmStatus === 'absent' && input.provider.ownership === 'absent' && input.provider.ownedMatches === 0) {
    if (!input.provider.complete || !input.queue.complete || input.queue.eligibleQueuedJobs === 0) {
      return { state: 'absent', effect: { type: 'none' }, reason: 'no complete eligible demand requires creation' };
    }
    const budget = startBudget(input);
    if (!budget.valid) return blocked(budget.reason);
    if (input.journal.startCount >= (input.permit?.maxStarts ?? 0)) return blocked('permit start count is exhausted');
    const generation = input.journal.startCount + 1;
    return authorized(input, 'create', {
      state: 'starting',
      effect: {
        type: 'create-vm', generation, reservedStartCount: generation,
        deadlineMs: input.nowMs + budget.availableRuntimeMs,
      },
      reason: 'eligible queued job requires creating the owned VM',
    });
  }

  if (input.provider.ownership !== 'owned' || input.provider.ownedMatches !== 1) return blocked(`resource ownership is ${input.provider.ownership}`);

  if (!input.provider.complete || !input.queue.complete || !input.guest.complete || input.queue.ownedBusy === null) {
    return blocked('complete provider, queue and guest observations are required');
  }
  if (input.provider.vmStatus === 'error' || input.provider.vmStatus === 'unknown' || input.guest.status === 'failed' || input.guest.status === 'unknown') {
    return blocked('provider or guest state is uncertain');
  }

  if (input.provider.outstandingOperation !== null || input.journal.outstandingIntent !== null) {
    return { state: input.journal.state, effect: { type: 'none' }, reason: 'reconcile outstanding operation or intent before another mutation' };
  }

  if (input.queue.ownedBusy || input.guest.workerActive === true || input.guest.status === 'busy') {
    return { state: 'busy', effect: { type: 'none' }, reason: 'owned job is busy' };
  }

  if (input.journal.state === 'draining' && input.queue.eligibleQueuedJobs > 0) {
    return authorized(input, 'register', {
      state: 'ready', effect: { type: 'resume-admission' }, reason: 'eligible work arrived during drain',
    });
  }

  if (input.provider.vmStatus === 'stopped' && input.queue.eligibleQueuedJobs > 0) {
    if (input.journal.startCount >= (input.permit?.maxStarts ?? 0)) return blocked('permit start count is exhausted');
    const budget = startBudget(input);
    if (!budget.valid) return blocked(budget.reason);
    const generation = input.journal.startCount + 1;
    return authorized(input, 'start', {
      state: 'starting',
      effect: { type: 'start-vm', generation, deadlineMs: input.nowMs + budget.availableRuntimeMs },
      reason: 'eligible queued job requires the owned stopped VM',
    });
  }

  if (input.provider.vmStatus === 'running' && input.queue.eligibleQueuedJobs > 0 && input.guest.status === 'ready') {
    if (grant === null) return blocked('ready guest has no immutable start grant');
    const cutoffMs = safeCutoffMs(grant.deadlineMs, input.permit?.expiresAtMs ?? 0, input.config.timing.maxJobMs, input.config.timing.shutdownMarginMs);
    if (input.nowMs > cutoffMs) return blocked('insufficient remaining lifetime for a complete job and shutdown margin');
    return authorized(input, 'register', {
      state: 'ready', effect: { type: 'register-runner', assignmentCutoffMs: cutoffMs }, reason: 'eligible job fits both immutable deadlines',
    });
  }

  if (input.journal.state === 'draining' && input.provider.vmStatus === 'running') {
    if (!guestIsDrained(input)) return blocked('guest is not conclusively drained');
    if (!idleGraceSatisfied(input)) return { state: 'draining', effect: { type: 'none' }, reason: 'idle grace requires two complete observations' };
    return authorized(input, 'stop', { state: 'stopping', effect: { type: 'stop-vm', emergency: false }, reason: 'idle grace passed and guest is drained' });
  }

  if (input.provider.vmStatus === 'running' && input.queue.eligibleQueuedJobs === 0 && input.guest.status === 'ready' && grant !== null) {
    return authorized(input, 'register', {
      state: 'draining', effect: { type: 'begin-drain', fallbackDeadlineMs: drainDeadlineMs(grant.deadlineMs, input.nowMs) }, reason: 'no eligible work remains',
    });
  }

  return { state: input.journal.state, effect: { type: 'none' }, reason: 'no lifecycle transition is required' };
}

export function drainDeadlineMs(originalDeadlineMs: number, nowMs: number, fallbackMs = DRAIN_FALLBACK_MS): number {
  if (![originalDeadlineMs, nowMs, fallbackMs].every(Number.isFinite) || fallbackMs < 0) throw new RangeError('deadline inputs must be finite and fallback non-negative');
  return Math.min(originalDeadlineMs, nowMs + fallbackMs);
}

export function canBeginAssignedJob(
  nowMs: number,
  grantDeadlineMs: number,
  permitDeadlineMs: number,
  maxJobMs: number,
  shutdownMarginMs: number,
): { allowed: true } | { allowed: false; reason: string } {
  const cutoffMs = safeCutoffMs(grantDeadlineMs, permitDeadlineMs, maxJobMs, shutdownMarginMs);
  return nowMs <= cutoffMs ? { allowed: true } : { allowed: false, reason: 'assignment arrived after the safe job-start cutoff' };
}

function safeCutoffMs(grantDeadlineMs: number, permitDeadlineMs: number, maxJobMs: number, shutdownMarginMs: number): number {
  return Math.min(grantDeadlineMs, permitDeadlineMs) - maxJobMs - shutdownMarginMs;
}

function authorized(input: LifecycleInput, operation: PermitOperation, decision: LifecycleDecision): LifecycleDecision {
  const validation = validatePermit(input.permit, input.identity, input.nowMs);
  if (!validation.valid) return blocked(validation.reason);
  if (!permits(input.permit, operation)) return blocked(`permit does not authorize ${operation}`);
  return decision;
}

function permits(permit: Permit | null, operation: PermitOperation): boolean {
  return permit !== null && permit.operations.includes(operation);
}

function validateRecoveryPermit(permit: Permit | null, identity: PermitIdentity, nowMs: number): PermitValidation {
  if (permit === null) return invalid('approval permit is absent');
  const structural = validatePermit(permit, identity, permit.issuedAtMs);
  if (!structural.valid) return structural;
  if (permit.issuedAtMs > nowMs) return invalid('permit is not active yet');
  if (!permit.recoveryAllowed) return invalid('permit does not authorize recovery');
  return { valid: true };
}

function validateQueueObservation(input: LifecycleInput): string | null {
  if (!Number.isInteger(input.queue.eligibleQueuedJobs) || input.queue.eligibleQueuedJobs < 0) {
    return 'eligible queued job count must be a non-negative integer';
  }
  if (!Number.isFinite(input.queue.observedAtMs)) return 'queue observation time must be finite';
  if (input.queue.observedAtMs > input.nowMs) return 'queue observation cannot be from the future';
  if (input.nowMs - input.queue.observedAtMs > input.config.timing.pollIntervalMs) return 'queue observation is stale';
  return null;
}

function startBudget(input: LifecycleInput): { valid: true; availableRuntimeMs: number } | { valid: false; reason: string } {
  const permitCheck = validatePermit(input.permit, input.identity, input.nowMs);
  if (!permitCheck.valid) return permitCheck;
  const permit = input.permit!;
  if (!Number.isFinite(input.journal.cumulativeRuntimeMs) || input.journal.cumulativeRuntimeMs < 0) return { valid: false, reason: 'journal cumulative runtime is invalid' };
  if (!Number.isFinite(input.journal.cumulativeCostUsd) || input.journal.cumulativeCostUsd < 0) return { valid: false, reason: 'journal cumulative cost is invalid' };
  if (!Number.isFinite(input.projectedStartCostUsd) || input.projectedStartCostUsd < 0) return { valid: false, reason: 'projected start cost is invalid' };
  const remainingRuntimeMs = permit.maxRuntimeMs - input.journal.cumulativeRuntimeMs;
  if (remainingRuntimeMs <= 0) return { valid: false, reason: 'permit cumulative runtime is exhausted' };
  if (input.journal.cumulativeCostUsd + input.projectedStartCostUsd > permit.maxTotalCostUsd) return { valid: false, reason: 'permit cost envelope would be exceeded' };
  const availableRuntimeMs = Math.min(input.config.timing.lifetimeMs, remainingRuntimeMs, permit.expiresAtMs - input.nowMs);
  if (availableRuntimeMs < input.config.timing.maxJobMs + input.config.timing.shutdownMarginMs) return { valid: false, reason: 'remaining permit runtime cannot fit one complete job and shutdown margin' };
  return { valid: true, availableRuntimeMs };
}

function identityMismatch(permit: Permit, identity: PermitIdentity): string | null {
  for (const key of ['configHash', 'candidateDigest', 'repositoryId', 'projectId', 'controllerId', 'resourcePrefix'] as const) {
    if (permit[key] !== identity[key]) return `permit ${key} does not match current identity`;
  }
  return null;
}

function guestIsDrained(input: LifecycleInput): boolean {
  return input.guest.status === 'drained'
    && input.guest.admissionEnabled === false
    && input.guest.runnerActive === false
    && input.guest.workerActive === false
    && input.queue.ownedBusy === false;
}

function idleGraceSatisfied(input: LifecycleInput): boolean {
  const generation = input.guest.grant?.generation;
  if (generation === undefined) return false;
  const complete = input.journal.idleObservations
    .filter((entry) => entry.complete && entry.generation === generation && entry.observedAtMs <= input.nowMs)
    .sort((a, b) => a.observedAtMs - b.observedAtMs);
  const first = complete[0];
  const last = complete.at(-1);
  return first !== undefined && last !== undefined && complete.length >= 2
    && last.observedAtMs === input.queue.observedAtMs
    && input.nowMs - last.observedAtMs <= input.config.timing.pollIntervalMs
    && last.observedAtMs - first.observedAtMs >= input.config.timing.idleGraceMs;
}

function validSnapshotEnums(input: LifecycleInput): boolean {
  return ['absent', 'stopped', 'starting', 'running', 'stopping', 'error', 'unknown'].includes(input.provider.vmStatus)
    && ['absent', 'owned', 'foreign', 'ambiguous', 'unknown'].includes(input.provider.ownership)
    && ['offline', 'booting', 'ready', 'busy', 'draining', 'drained', 'failed', 'unknown'].includes(input.guest.status);
}

function blocked(reason: string): LifecycleDecision {
  return { state: 'blocked', effect: { type: 'none' }, reason };
}

function invalid(reason: string): PermitValidation {
  return { valid: false, reason };
}
