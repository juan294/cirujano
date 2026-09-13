import type { LifecycleDecision, LifecycleEffect, LifecycleInput, LifecycleJournal, LifecycleState, PermitIdentity, PermitOperation } from './contracts.js';
import { decideLifecycle } from './lifecycle.js';
import { acquireControllerLock, appendRedactedEvent, assertControllerLock, type ControllerLock, readJournal, writeJournalAtomic } from './journal.js';

export interface PendingEffect {
  id: string;
  effect: Exclude<LifecycleEffect, { type: 'none' }>;
  createdAtMs: number;
  status: 'pending' | 'ambiguous' | 'blocked';
  stage: 'intent' | 'emitting';
  authorization: PendingAuthorization;
  operationId?: string;
}

export interface PendingAuthorization extends PermitIdentity {
  permitId: string;
  permitExpiresAtMs: number;
  operation: PermitOperation;
  recoveryAllowed: boolean;
  effectDeadlineMs: number | null;
}

export interface ControllerState {
  schemaVersion: 1;
  identity: PermitIdentity;
  lifecycle: LifecycleJournal;
  pendingEffect: PendingEffect | null;
  readbacks: unknown[];
}

export interface TickOptions {
  lock: ControllerLock;
  journalPath: string;
  eventPath: string;
  input: LifecycleInput;
  dryRun?: boolean;
  secrets?: readonly string[];
  executeEffect(effect: Exclude<LifecycleEffect, { type: 'none' }>): Promise<{ operationId?: string; resolved?: boolean; readback?: unknown }>;
  reconcileEffect(effect: PendingEffect): Promise<{ resolved: boolean; retry?: boolean; readback?: unknown }>;
  boundary?(name: ControllerBoundary): Promise<void>;
}

export type ControllerBoundary =
  | 'after-intent-journal'
  | 'after-intent-event'
  | 'before-provider-io'
  | 'after-emitting-journal'
  | 'after-provider-io'
  | 'after-readback-journal'
  | 'after-final-event';

export interface TickResult {
  status: 'blocked' | 'idle' | 'dry-run' | 'mutated' | 'reconciled' | 'pending';
  decision?: LifecycleDecision;
}

export async function tickController(options: TickOptions): Promise<TickResult> {
  assertControllerLock(options.lock);
  const prior = await readOptionalState(options.journalPath);
  if (prior !== null && !sameIdentity(prior.identity, options.input.identity)) {
    throw new Error('controller state identity does not match the active configuration and candidate');
  }
  if (options.dryRun === true && prior?.pendingEffect !== null && prior?.pendingEffect !== undefined) {
    assertStateInvariants(prior);
    const authorizationProblem = pendingAuthorizationProblem(prior.pendingEffect, options.input);
    await appendRedactedEvent(options.eventPath, {
      schemaVersion: 1,
      type: 'dry-run-pending',
      effect: prior.pendingEffect.effect.type,
      stage: prior.pendingEffect.stage,
      authorization: authorizationProblem ?? 'valid',
    }, { secrets: options.secrets ?? [] });
    return { status: 'dry-run' };
  }
  if (prior?.pendingEffect !== null && prior?.pendingEffect !== undefined) {
    assertStateInvariants(prior);
    const authorizationProblem = pendingAuthorizationProblem(prior.pendingEffect, options.input);
    if (authorizationProblem !== null) return blockPendingAuthorization(options, prior, authorizationProblem);
    if (prior.pendingEffect.stage === 'intent') {
      return executePendingEffect(options, prior);
    }
    const reconciliation = await options.reconcileEffect(prior.pendingEffect);
    if (!reconciliation.resolved && reconciliation.retry === true) {
      const retryState: ControllerState = {
        ...prior,
        pendingEffect: { ...prior.pendingEffect, stage: 'intent', status: 'pending' },
        lifecycle: restoreIntentPending(prior.lifecycle),
      };
      await writeJournalAtomic(options.journalPath, retryState);
      return executePendingEffect(options, retryState);
    }
    if (!reconciliation.resolved) return { status: 'pending' };
    const reconciled: ControllerState = {
      ...prior,
      lifecycle: { ...prior.lifecycle, outstandingIntent: null },
      pendingEffect: null,
      readbacks: [...prior.readbacks, reconciliation.readback].slice(-100),
    };
    await writeJournalAtomic(options.journalPath, reconciled);
    await atBoundary(options, 'after-readback-journal');
    await appendRedactedEvent(options.eventPath, { schemaVersion: 1, type: 'effect-reconciled', effect: prior.pendingEffect.effect.type }, { secrets: options.secrets ?? [] });
    await atBoundary(options, 'after-final-event');
    return { status: 'reconciled' };
  }

  if (prior !== null) assertStateInvariants(prior);
  const currentLifecycle = prior === null ? options.input.journal : mergeLifecycle(prior.lifecycle, options.input.journal);
  const authoritativeInput = { ...options.input, journal: currentLifecycle };
  const decision = decideLifecycle(authoritativeInput);
  if (decision.effect.type === 'none') {
    const observedState = {
      schemaVersion: 1, identity: options.input.identity, lifecycle: currentLifecycle,
      pendingEffect: null, readbacks: prior?.readbacks ?? [],
    } satisfies ControllerState;
    parseControllerState(observedState);
    await writeJournalAtomic(options.journalPath, observedState);
    await appendRedactedEvent(options.eventPath, { schemaVersion: 1, type: 'decision', state: decision.state, reason: decision.reason }, { secrets: options.secrets ?? [] });
    return { status: decision.state === 'blocked' ? 'blocked' : 'idle', decision };
  }
  if (options.dryRun === true) {
    await appendRedactedEvent(options.eventPath, { schemaVersion: 1, type: 'dry-run', effect: decision.effect.type }, { secrets: options.secrets ?? [] });
    return { status: 'dry-run', decision };
  }

  const pending: PendingEffect = {
    id: `${options.input.identity.controllerId}:${options.input.nowMs}:${decision.effect.type}`,
    effect: decision.effect,
    createdAtMs: options.input.nowMs,
    status: 'pending',
    stage: 'intent',
    authorization: authorizationFor(decision.effect, options.input),
  };
  const state: ControllerState = {
    schemaVersion: 1,
    identity: options.input.identity,
    lifecycle: applyDecision(authoritativeInput.journal, decision.effect, decision.state),
    pendingEffect: pending,
    readbacks: prior?.readbacks ?? [],
  };
  assertStateInvariants(state);
  await writeJournalAtomic(options.journalPath, state);
  await atBoundary(options, 'after-intent-journal');
  await appendRedactedEvent(options.eventPath, { schemaVersion: 1, type: 'effect-intent', effect: decision.effect.type, id: pending.id }, { secrets: options.secrets ?? [] });
  await atBoundary(options, 'after-intent-event');
  return executePendingEffect(options, state, decision);
}

export async function runInterruptRecovery(options: {
  timeoutMs: number;
  recover(signal: AbortSignal): Promise<void>;
  unresolvedResources: readonly string[];
}): Promise<{ completed: true; unresolvedResources: readonly string[] } | { completed: false; unresolvedResources: readonly string[]; reason: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const completed = await Promise.race([
      options.recover(controller.signal).then(() => true),
      new Promise<false>((resolveTimeout) => controller.signal.addEventListener('abort', () => resolveTimeout(false), { once: true })),
    ]);
    return completed
      ? { completed: true, unresolvedResources: [] }
      : { completed: false, unresolvedResources: options.unresolvedResources, reason: 'interrupt recovery timed out' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runLockedControllerTick(
  options: Omit<TickOptions, 'input' | 'lock'> & { stateDirectory: string; observe(): Promise<LifecycleInput> },
): Promise<TickResult> {
  const lock = await acquireControllerLock(options.stateDirectory);
  try {
    const input = await options.observe();
    return await tickController({ ...options, input, lock });
  } finally {
    await lock.release();
  }
}

async function readOptionalState(path: string): Promise<ControllerState | null> {
  try {
    return parseControllerState(await readJournal<unknown>(path));
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export function parseControllerState(input: unknown): ControllerState {
  const root = strictObject(input, ['schemaVersion', 'identity', 'lifecycle', 'pendingEffect', 'readbacks'], 'controller state');
  if (root['schemaVersion'] !== 1) throw new Error('controller state schemaVersion must be 1');
  const identity = parseIdentity(root['identity']);
  const lifecycle = parseLifecycleJournal(root['lifecycle']);
  const pendingEffect = root['pendingEffect'] === null ? null : parsePendingEffect(root['pendingEffect']);
  if (!Array.isArray(root['readbacks'])) throw new Error('controller state readbacks must be an array');
  const state = { schemaVersion: 1 as const, identity, lifecycle, pendingEffect, readbacks: root['readbacks'].slice(-100) };
  assertStateInvariants(state);
  return state;
}

function parseIdentity(input: unknown): PermitIdentity {
  const root = strictObject(input, ['configHash', 'candidateDigest', 'repositoryId', 'projectId', 'controllerId', 'resourcePrefix'], 'controller state identity');
  for (const key of ['configHash', 'candidateDigest', 'projectId', 'controllerId', 'resourcePrefix'] as const) {
    if (typeof root[key] !== 'string' || root[key].length === 0) throw new Error(`controller state identity ${key} is invalid`);
  }
  if (!Number.isInteger(root['repositoryId']) || (root['repositoryId'] as number) <= 0) throw new Error('controller state identity repositoryId is invalid');
  return root as unknown as PermitIdentity;
}

function parseLifecycleJournal(input: unknown): LifecycleJournal {
  const root = strictObject(input, ['state', 'startCount', 'cumulativeRuntimeMs', 'cumulativeCostUsd', 'outstandingIntent', 'idleObservations'], 'controller state lifecycle');
  const states: readonly LifecycleState[] = ['absent', 'stopped', 'starting', 'ready', 'busy', 'draining', 'stopping', 'blocked'];
  if (typeof root['state'] !== 'string' || !states.includes(root['state'] as LifecycleState)) throw new Error('controller state lifecycle state is invalid');
  if (!Number.isInteger(root['startCount']) || (root['startCount'] as number) < 0) throw new Error('controller state startCount is invalid');
  for (const key of ['cumulativeRuntimeMs', 'cumulativeCostUsd'] as const) {
    if (typeof root[key] !== 'number' || !Number.isFinite(root[key]) || root[key] < 0) throw new Error(`controller state ${key} is invalid`);
  }
  if (!Array.isArray(root['idleObservations'])) throw new Error('controller state idleObservations must be an array');
  const idleObservations = root['idleObservations'].map((entry) => {
    const observation = strictObject(entry, ['observedAtMs', 'complete', 'generation'], 'idle observation');
    if (typeof observation['observedAtMs'] !== 'number' || !Number.isFinite(observation['observedAtMs'])) throw new Error('idle observation time is invalid');
    if (typeof observation['complete'] !== 'boolean' || !Number.isInteger(observation['generation']) || (observation['generation'] as number) < 1) throw new Error('idle observation fields are invalid');
    return observation as unknown as LifecycleJournal['idleObservations'][number];
  });
  let outstandingIntent: LifecycleJournal['outstandingIntent'] = null;
  if (root['outstandingIntent'] !== null) {
    const intent = strictObject(root['outstandingIntent'], ['type', 'generation', 'status', 'deadlineMs'], 'lifecycle intent');
    if (!['create-vm', 'start-vm'].includes(String(intent['type'])) || !Number.isInteger(intent['generation']) || !['pending', 'ambiguous', 'blocked'].includes(String(intent['status'])) || typeof intent['deadlineMs'] !== 'number' || !Number.isFinite(intent['deadlineMs'])) throw new Error('controller state lifecycle intent is invalid');
    outstandingIntent = intent as unknown as NonNullable<LifecycleJournal['outstandingIntent']>;
  }
  return {
    state: root['state'] as LifecycleState,
    startCount: root['startCount'] as number,
    cumulativeRuntimeMs: root['cumulativeRuntimeMs'] as number,
    cumulativeCostUsd: root['cumulativeCostUsd'] as number,
    outstandingIntent,
    idleObservations: idleObservations.slice(-100),
  };
}

function parsePendingEffect(input: unknown): PendingEffect {
  const root = strictObject(input, ['id', 'effect', 'createdAtMs', 'status', 'stage', 'authorization'], 'pending effect', ['operationId']);
  if (typeof root['id'] !== 'string' || root['id'].length === 0 || typeof root['createdAtMs'] !== 'number' || !Number.isFinite(root['createdAtMs'])) throw new Error('pending effect metadata is invalid');
  if (!['pending', 'ambiguous', 'blocked'].includes(String(root['status']))) throw new Error('pending effect status is invalid');
  if (!['intent', 'emitting'].includes(String(root['stage']))) throw new Error('pending effect stage is invalid');
  if (root['operationId'] !== undefined && typeof root['operationId'] !== 'string') throw new Error('pending effect operationId is invalid');
  const effect = parseEffect(root['effect']);
  const authorization = parsePendingAuthorization(root['authorization']);
  return root['operationId'] === undefined
    ? { id: root['id'], effect, createdAtMs: root['createdAtMs'], status: root['status'] as PendingEffect['status'], stage: root['stage'] as PendingEffect['stage'], authorization }
    : { id: root['id'], effect, createdAtMs: root['createdAtMs'], status: root['status'] as PendingEffect['status'], stage: root['stage'] as PendingEffect['stage'], authorization, operationId: root['operationId'] };
}

function parsePendingAuthorization(input: unknown): PendingAuthorization {
  const root = strictObject(input, [
    'permitId', 'configHash', 'candidateDigest', 'repositoryId', 'projectId',
    'controllerId', 'resourcePrefix', 'permitExpiresAtMs', 'operation',
    'recoveryAllowed', 'effectDeadlineMs',
  ], 'pending authorization');
  const identity = parseIdentity({
    configHash: root['configHash'], candidateDigest: root['candidateDigest'],
    repositoryId: root['repositoryId'], projectId: root['projectId'],
    controllerId: root['controllerId'], resourcePrefix: root['resourcePrefix'],
  });
  if (typeof root['permitId'] !== 'string' || root['permitId'].length === 0) throw new Error('pending authorization permitId is invalid');
  if (typeof root['permitExpiresAtMs'] !== 'number' || !Number.isFinite(root['permitExpiresAtMs'])) throw new Error('pending authorization expiry is invalid');
  if (!['create', 'start', 'register', 'stop', 'delete'].includes(String(root['operation']))) throw new Error('pending authorization operation is invalid');
  if (typeof root['recoveryAllowed'] !== 'boolean') throw new Error('pending authorization recoveryAllowed is invalid');
  if (root['effectDeadlineMs'] !== null && (typeof root['effectDeadlineMs'] !== 'number' || !Number.isFinite(root['effectDeadlineMs']))) throw new Error('pending authorization effectDeadlineMs is invalid');
  return {
    ...identity,
    permitId: root['permitId'],
    permitExpiresAtMs: root['permitExpiresAtMs'],
    operation: root['operation'] as PermitOperation,
    recoveryAllowed: root['recoveryAllowed'],
    effectDeadlineMs: root['effectDeadlineMs'] as number | null,
  };
}

function parseEffect(input: unknown): Exclude<LifecycleEffect, { type: 'none' }> {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || !('type' in input)) throw new Error('pending effect value is invalid');
  const type = (input as { type: unknown }).type;
  let root: Record<string, unknown>;
  switch (type) {
    case 'create-vm':
      root = strictObject(input, ['type', 'generation', 'reservedStartCount', 'deadlineMs'], 'create effect');
      positiveInteger(root['reservedStartCount'], 'create reservedStartCount');
      break;
    case 'adopt-vm':
    case 'start-vm':
      root = strictObject(input, ['type', 'generation', 'deadlineMs'], `${type} effect`);
      break;
    case 'register-runner':
      root = strictObject(input, ['type', 'assignmentCutoffMs'], 'register effect');
      finiteNumber(root['assignmentCutoffMs'], 'register assignmentCutoffMs');
      return root as unknown as Exclude<LifecycleEffect, { type: 'none' }>;
    case 'begin-drain':
      root = strictObject(input, ['type', 'fallbackDeadlineMs'], 'drain effect');
      finiteNumber(root['fallbackDeadlineMs'], 'drain fallbackDeadlineMs');
      return root as unknown as Exclude<LifecycleEffect, { type: 'none' }>;
    case 'resume-admission':
      return strictObject(input, ['type'], 'resume effect') as unknown as Exclude<LifecycleEffect, { type: 'none' }>;
    case 'stop-vm':
      root = strictObject(input, ['type', 'emergency'], 'stop effect');
      if (typeof root['emergency'] !== 'boolean') throw new Error('stop effect emergency is invalid');
      return root as unknown as Exclude<LifecycleEffect, { type: 'none' }>;
    default:
      throw new Error('pending effect type is invalid');
  }
  positiveInteger(root['generation'], `${String(type)} generation`);
  finiteNumber(root['deadlineMs'], `${String(type)} deadlineMs`);
  return root as unknown as Exclude<LifecycleEffect, { type: 'none' }>;
}

function strictObject(input: unknown, required: readonly string[], name: string, optional: readonly string[] = []): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error(`${name} must be an object`);
  const root = input as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(root).find((key) => !allowed.has(key));
  if (unknown !== undefined) throw new Error(`${name} contains unknown key ${unknown}`);
  const missing = required.find((key) => !Object.hasOwn(root, key));
  if (missing !== undefined) throw new Error(`${name} is missing ${missing}`);
  return root;
}

function positiveInteger(value: unknown, name: string): void {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${name} is invalid`);
}

function finiteNumber(value: unknown, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} is invalid`);
}

function applyDecision(journal: LifecycleJournal, effect: LifecycleEffect, state: LifecycleState): LifecycleJournal {
  if (effect.type === 'create-vm' || effect.type === 'start-vm') {
    return {
      ...journal,
      state,
      startCount: effect.type === 'create-vm' ? effect.reservedStartCount : effect.generation,
      outstandingIntent: { type: effect.type, generation: effect.generation, status: 'pending', deadlineMs: effect.deadlineMs },
    };
  }
  return { ...journal, state };
}

function sameIdentity(left: PermitIdentity, right: PermitIdentity): boolean {
  return left.configHash === right.configHash && left.candidateDigest === right.candidateDigest
    && left.repositoryId === right.repositoryId && left.projectId === right.projectId
    && left.controllerId === right.controllerId && left.resourcePrefix === right.resourcePrefix;
}

async function executePendingEffect(options: TickOptions, state: ControllerState, decision?: LifecycleDecision): Promise<TickResult> {
  const pending = state.pendingEffect;
  if (pending === null) throw new Error('controller state invariant: pending execution has no effect');
  const authorizationProblem = pendingAuthorizationProblem(pending, options.input);
  if (authorizationProblem !== null) return blockPendingAuthorization(options, state, authorizationProblem);
  await atBoundary(options, 'before-provider-io');
  const emitting: PendingEffect = { ...pending, stage: 'emitting' };
  await writeJournalAtomic(options.journalPath, { ...state, pendingEffect: emitting });
  await atBoundary(options, 'after-emitting-journal');
  try {
    const result = await options.executeEffect(pending.effect);
    await atBoundary(options, 'after-provider-io');
    const resolved = result.resolved === true;
    const completed: ControllerState = {
      ...state,
      lifecycle: resolved ? { ...state.lifecycle, outstandingIntent: null } : state.lifecycle,
      pendingEffect: resolved ? null : (result.operationId === undefined ? emitting : { ...emitting, operationId: result.operationId }),
      readbacks: result.readback === undefined ? state.readbacks : [...state.readbacks, result.readback].slice(-100),
    };
    assertStateInvariants(completed);
    await writeJournalAtomic(options.journalPath, completed);
    await atBoundary(options, 'after-readback-journal');
    await appendRedactedEvent(options.eventPath, { schemaVersion: 1, type: 'effect-result', effect: pending.effect.type, resolved }, { secrets: options.secrets ?? [] });
    await atBoundary(options, 'after-final-event');
    return { status: 'mutated', ...(decision === undefined ? {} : { decision }) };
  } catch (error) {
    await writeJournalAtomic(options.journalPath, {
      ...state,
      lifecycle: markIntentAmbiguous(state.lifecycle),
      pendingEffect: { ...emitting, status: 'ambiguous' },
    });
    await appendRedactedEvent(options.eventPath, { schemaVersion: 1, type: 'effect-failed', effect: pending.effect.type, error: error instanceof Error ? error.message : String(error) }, { secrets: options.secrets ?? [] });
    throw error;
  }
}

function mergeLifecycle(saved: LifecycleJournal, observed: LifecycleJournal): LifecycleJournal {
  if (observed.startCount < saved.startCount) throw new Error('controller state regression: startCount decreased');
  if (observed.cumulativeRuntimeMs < saved.cumulativeRuntimeMs) throw new Error('controller state regression: cumulative runtime decreased');
  if (observed.cumulativeCostUsd < saved.cumulativeCostUsd) throw new Error('controller state regression: cumulative cost decreased');
  const savedIdle = JSON.stringify(saved.idleObservations);
  const observedPrefix = JSON.stringify(observed.idleObservations.slice(0, saved.idleObservations.length));
  if (savedIdle !== observedPrefix) throw new Error('controller state regression: idle observations were removed or changed');
  if (observed.outstandingIntent !== null && JSON.stringify(observed.outstandingIntent) !== JSON.stringify(saved.outstandingIntent)) {
    throw new Error('controller state regression: outstanding intent changed outside reconciliation');
  }
  return { ...observed, idleObservations: observed.idleObservations.slice(-100) };
}

function assertStateInvariants(state: ControllerState): void {
  const pending = state.pendingEffect;
  const intent = state.lifecycle.outstandingIntent;
  if (pending === null && intent !== null) throw new Error('controller state invariant: lifecycle intent exists without pending effect');
  if (pending !== null && (pending.effect.type === 'create-vm' || pending.effect.type === 'start-vm')) {
    if (intent === null || intent.type !== pending.effect.type || intent.generation !== pending.effect.generation
      || intent.deadlineMs !== pending.effect.deadlineMs || intent.status !== pending.status) {
      throw new Error('controller state invariant: pending effect and lifecycle intent disagree');
    }
    if (state.lifecycle.startCount < pending.effect.generation) throw new Error('controller state invariant: pending generation exceeds startCount');
  } else if (pending !== null && intent !== null) {
    throw new Error('controller state invariant: non-start pending effect has a lifecycle start intent');
  }
  if (pending !== null) {
    if (!sameIdentity(pending.authorization, state.identity)) throw new Error('controller state invariant: pending authorization identity differs from state identity');
    if (pending.authorization.operation !== requiredPermitOperation(pending.effect)) throw new Error('controller state invariant: pending authorization operation differs from effect');
    const effectDeadline = explicitEffectDeadline(pending.effect);
    if (effectDeadline !== null && pending.authorization.effectDeadlineMs !== effectDeadline) {
      throw new Error('controller state invariant: pending authorization deadline differs from effect');
    }
  }
  if (state.lifecycle.idleObservations.some((observation) => observation.generation > state.lifecycle.startCount)) {
    throw new Error('controller state invariant: idle observation generation exceeds startCount');
  }
}

function markIntentAmbiguous(journal: LifecycleJournal): LifecycleJournal {
  return journal.outstandingIntent === null
    ? journal
    : { ...journal, outstandingIntent: { ...journal.outstandingIntent, status: 'ambiguous' } };
}

function restoreIntentPending(journal: LifecycleJournal): LifecycleJournal {
  return journal.outstandingIntent === null
    ? journal
    : { ...journal, outstandingIntent: { ...journal.outstandingIntent, status: 'pending' } };
}

export function requiredPermitOperation(effect: Exclude<LifecycleEffect, { type: 'none' }>): PermitOperation {
  switch (effect.type) {
    case 'create-vm':
    case 'adopt-vm':
      return 'create';
    case 'start-vm':
      return 'start';
    case 'register-runner':
    case 'begin-drain':
    case 'resume-admission':
      return 'register';
    case 'stop-vm':
      return 'stop';
  }
}

function authorizationFor(effect: Exclude<LifecycleEffect, { type: 'none' }>, input: LifecycleInput): PendingAuthorization {
  const permit = input.permit;
  if (permit === null) throw new Error('mutation decision has no authorizing permit');
  const operation = requiredPermitOperation(effect);
  if (!permit.operations.includes(operation)) throw new Error(`permit does not authorize ${operation}`);
  const effectDeadlineMs = explicitEffectDeadline(effect) ?? input.guest.grant?.deadlineMs ?? null;
  return {
    permitId: permit.permitId,
    configHash: permit.configHash,
    candidateDigest: permit.candidateDigest,
    repositoryId: permit.repositoryId,
    projectId: permit.projectId,
    controllerId: permit.controllerId,
    resourcePrefix: permit.resourcePrefix,
    permitExpiresAtMs: permit.expiresAtMs,
    operation,
    recoveryAllowed: permit.recoveryAllowed,
    effectDeadlineMs,
  };
}

function explicitEffectDeadline(effect: Exclude<LifecycleEffect, { type: 'none' }>): number | null {
  if (effect.type === 'create-vm' || effect.type === 'adopt-vm' || effect.type === 'start-vm') return effect.deadlineMs;
  if (effect.type === 'register-runner') return effect.assignmentCutoffMs;
  if (effect.type === 'begin-drain') return effect.fallbackDeadlineMs;
  return null;
}

function pendingAuthorizationProblem(pending: PendingEffect, input: LifecycleInput): string | null {
  const saved = pending.authorization;
  const permit = input.permit;
  if (!sameIdentity(saved, input.identity)) return 'pending authorization identity no longer matches current identity';
  if (permit === null) return 'pending authorization was revoked or removed';
  if (!sameIdentity(saved, permit) || permit.permitId !== saved.permitId || permit.expiresAtMs !== saved.permitExpiresAtMs) {
    return 'current permit does not match pending authorization';
  }
  if (!permit.operations.includes(saved.operation)) return `current permit no longer authorizes ${saved.operation}`;
  const recoveryOperation = saved.operation === 'stop' || saved.operation === 'delete';
  if (input.nowMs >= saved.permitExpiresAtMs && !(recoveryOperation && saved.recoveryAllowed && permit.recoveryAllowed)) {
    return 'pending authorization is expired';
  }
  if (!recoveryOperation && saved.effectDeadlineMs !== null && input.nowMs > saved.effectDeadlineMs) {
    return 'pending effect deadline has expired';
  }
  return null;
}

async function blockPendingAuthorization(options: TickOptions, state: ControllerState, reason: string): Promise<TickResult> {
  const pending = state.pendingEffect;
  if (pending === null) throw new Error('controller state invariant: authorization block has no pending effect');
  const blockedState: ControllerState = {
    ...state,
    lifecycle: markIntentBlocked(state.lifecycle),
    pendingEffect: { ...pending, status: 'blocked' },
  };
  await writeJournalAtomic(options.journalPath, blockedState);
  await appendRedactedEvent(options.eventPath, {
    schemaVersion: 1, type: 'effect-authorization-blocked', effect: pending.effect.type,
    operation: pending.authorization.operation, reason,
  }, { secrets: options.secrets ?? [] });
  return { status: 'blocked' };
}

function markIntentBlocked(journal: LifecycleJournal): LifecycleJournal {
  return journal.outstandingIntent === null
    ? journal
    : { ...journal, outstandingIntent: { ...journal.outstandingIntent, status: 'blocked' } };
}

async function atBoundary(options: TickOptions, name: ControllerBoundary): Promise<void> {
  await options.boundary?.(name);
}
