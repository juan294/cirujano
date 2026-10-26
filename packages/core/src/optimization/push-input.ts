import { canonicalJson } from './canonical.js';
import { median } from './measurement.js';
import { decodePushArtifact, PUSH_FAMILY, type PushHistoryEntry, type PushInputArtifact, type PushProvenance } from './push-contracts.js';
import type { PushWorkflowEligibility } from './push-workflow.js';

export interface PushHistorySummary { pushCount: number; validatedCount: number; validatedShare: number; validatedMinutes: number; unvalidatedCount: number; medianPushMinutes: number }
export interface PushInputOptions { provenance: Omit<PushProvenance, 'guardedJobIds'>; eligibility: PushWorkflowEligibility; history: PushHistoryEntry[]; treeSha: string }

/** Facts the model weighs: how many recent pushes the classifier would have validated and what a push bills. */
export function summarizePushHistory(history: readonly PushHistoryEntry[]): PushHistorySummary {
  const validated = history.filter(entry => entry.validated);
  return {
    pushCount: history.length,
    validatedCount: validated.length,
    validatedShare: history.length ? Math.round(validated.length / history.length * 10_000) / 10_000 : 0,
    validatedMinutes: validated.reduce((sum, entry) => sum + entry.billedMinutes, 0),
    unvalidatedCount: history.length - validated.length,
    medianPushMinutes: median(history.map(entry => entry.billedMinutes)),
  };
}

/**
 * The one policy that turns eligibility and collected push history into an input. Collection
 * and the retained-input check both call it, so a retained input is re-derivable byte for byte.
 */
export function createPushInput({ provenance, eligibility, history, treeSha }: PushInputOptions): PushInputArtifact {
  const status = eligibility.status === 'eligible' ? history.length ? 'collected' : 'unsupported' : eligibility.status;
  const reasonCode = eligibility.status === 'eligible' && !history.length ? 'no-push-history' : eligibility.reason;
  const reasons: Record<string, number> = {};
  for (const entry of history) reasons[entry.reasonCode] = (reasons[entry.reasonCode] ?? 0) + 1;
  return decodePushArtifact('input', {
    schemaVersion: 1, kind: 'input', family: PUSH_FAMILY, status, history,
    provenance: { ...provenance, guardedJobIds: eligibility.operations[0]?.guardedJobIds ?? [] },
    structuralFacts: { ...eligibility.structuralFacts, ...summarizePushHistory(history), reasonCode, treeSha },
    evidence: {
      'workflow-eligibility': reasonCode,
      'push-history': canonicalJson(history.map(({ pushRunId, attempt, billedMinutes, jobsBilled, validated, reasonCode: reason }) => ({ pushRunId, attempt, billedMinutes, jobsBilled, validated, reasonCode: reason }))),
      'classifier-reasons': canonicalJson(reasons),
    },
    operations: status === 'collected' ? eligibility.operations : [],
  });
}
