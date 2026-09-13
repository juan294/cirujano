import type { LifecycleDecision, LifecycleEffect, LifecycleInput } from './contracts.js';
import { decideLifecycle } from './lifecycle.js';
import { appendRedactedEvent, readJournal, writeJournalAtomic } from './journal.js';

export interface PendingEffect {
  id: string;
  effect: Exclude<LifecycleEffect, { type: 'none' }>;
  createdAtMs: number;
  status: 'pending' | 'ambiguous';
  operationId?: string;
}

export interface ControllerState {
  schemaVersion: 1;
  pendingEffect: PendingEffect | null;
  lastDecision?: LifecycleDecision;
  lastReadback?: unknown;
}

export interface TickOptions {
  journalPath: string;
  eventPath: string;
  input: LifecycleInput;
  dryRun?: boolean;
  secrets?: readonly string[];
  executeEffect(effect: Exclude<LifecycleEffect, { type: 'none' }>): Promise<{ operationId?: string }>;
  reconcileEffect(effect: PendingEffect): Promise<{ resolved: boolean; readback?: unknown }>;
}

export interface TickResult {
  status: 'blocked' | 'idle' | 'dry-run' | 'mutated' | 'reconciled' | 'pending';
  decision?: LifecycleDecision;
}

export async function tickController(options: TickOptions): Promise<TickResult> {
  const prior = await readOptionalState(options.journalPath);
  if (prior?.pendingEffect !== null && prior?.pendingEffect !== undefined) {
    const reconciliation = await options.reconcileEffect(prior.pendingEffect);
    if (!reconciliation.resolved) return { status: 'pending' };
    await writeJournalAtomic(options.journalPath, {
      ...prior, pendingEffect: null, lastReadback: reconciliation.readback,
    });
    await appendRedactedEvent(options.eventPath, { schemaVersion: 1, type: 'effect-reconciled', effect: prior.pendingEffect.effect.type }, { secrets: options.secrets ?? [] });
    return { status: 'reconciled' };
  }

  const decision = decideLifecycle(options.input);
  if (decision.effect.type === 'none') {
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
  };
  const state: ControllerState = { schemaVersion: 1, pendingEffect: pending, lastDecision: decision };
  await writeJournalAtomic(options.journalPath, state);
  await appendRedactedEvent(options.eventPath, { schemaVersion: 1, type: 'effect-intent', effect: decision.effect.type, id: pending.id }, { secrets: options.secrets ?? [] });
  try {
    const result = await options.executeEffect(decision.effect);
    const completed: ControllerState = {
      ...state,
      pendingEffect: result.operationId === undefined ? pending : { ...pending, operationId: result.operationId },
    };
    await writeJournalAtomic(options.journalPath, completed);
    return { status: 'mutated', decision };
  } catch (error) {
    await writeJournalAtomic(options.journalPath, { ...state, pendingEffect: { ...pending, status: 'ambiguous' } });
    await appendRedactedEvent(options.eventPath, { schemaVersion: 1, type: 'effect-failed', effect: decision.effect.type, error: error instanceof Error ? error.message : String(error) }, { secrets: options.secrets ?? [] });
    throw error;
  }
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

async function readOptionalState(path: string): Promise<ControllerState | null> {
  try {
    return await readJournal<ControllerState>(path);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}
