import { sha256 } from './canonical.js';
import { artifacts as cacheArtifacts, candidate, timestamp } from './contracts.test-helper.js';
import { CLASSIFIER_JOB_ID } from './push-guard.js';
import type { PushArtifactMap, PushHistoryEntry, PushMeasurementSample, PushOperation, PushProvenance } from './push-contracts.js';

/** Complete skip-validated-push artifacts; later phases build on these. */
export const pushProvenance: PushProvenance = { repositoryId: 7, repository: 'public-example/benchmark', baseSha: 'a'.repeat(40), workflowBlobSha: 'b'.repeat(40), workflowPath: '.github/workflows/ci.yml', workflowHash: 'c'.repeat(64), integrationBranch: 'main', guardedJobIds: ['lint', 'test'], classifierDigest: 'd'.repeat(64), verificationProfileHash: 'e'.repeat(64), toolSourceSha: 'f'.repeat(40), bundleDigest: '1'.repeat(64) };
export const pushOperation: PushOperation = { type: 'skip-validated-push', integrationBranch: 'main', guardedJobIds: ['lint', 'test'], classifierJobId: CLASSIFIER_JOB_ID };
export const historyEntry: PushHistoryEntry = { pushRunId: 11, attempt: 1, headSha: '2'.repeat(40), billedMinutes: 6, jobsBilled: 2, prNumber: 4, validated: true, reasonCode: 'validated' };
const family = 'skip-validated-push' as const;
const base = <K extends string>(kind: K) => ({ schemaVersion: 1 as const, kind, family, provenance: pushProvenance });
export function pushSample(role: PushMeasurementSample['role'], index: number): PushMeasurementSample {
  const control = role === 'control', skipped = role === 'candidate';
  return { role, pushRunId: 100 + index, attempt: 1, headSha: String(index % 10).repeat(40), prNumber: control ? null : 10 + index, prRunId: control ? null : 200 + index, billedMinutes: skipped ? 1 : 6, classifierMinutes: role === 'baseline' ? 0 : 1, validated: skipped, guardedJobs: pushProvenance.guardedJobIds.map(jobId => ({ jobId, conclusion: skipped ? 'skipped' : 'success' })), prJobs: control ? [] : [{ name: 'lint', conclusion: 'success' }, { name: 'test', conclusion: 'success' }] };
}
export const pushArtifacts: PushArtifactMap = {
  input: { ...base('input'), status: 'collected', history: [historyEntry], structuralFacts: { integrationBranch: 'main', guardedJobCount: 2 }, evidence: { 'push:11': 'validated push billed 6 minutes' }, operations: [pushOperation] },
  diagnosis: { ...base('diagnosis'), status: 'proposal', reason: 'Validated pushes rerun the full suite', uncertainty: 'Share measured on collected history only', evidenceIds: ['push:11'], operation: pushOperation, promptVersion: 'skip-validated-push-v1', schemaVersionId: 'skip-validated-push-decision-v1', inferenceReceiptDigest: '3'.repeat(64) },
  inference: { ...cacheArtifacts.inference, ...base('inference') },
  proposal: { ...base('proposal'), ...candidate, candidateWorkflowHash: '6'.repeat(64), status: 'proposed', operation: pushOperation, beforeStructuralDigest: '1'.repeat(64), afterStructuralDigest: '2'.repeat(64), permittedDiff: { classifierJobId: CLASSIFIER_JOB_ID, guardedJobIds: ['lint', 'test'] }, preconditions: ['one literal integration branch'], diagnosisDigest: '2'.repeat(64) },
  sandbox: { ...base('sandbox'), ...candidate, proposalDigest: '1'.repeat(64), status: 'sandbox-verified', image: { uuid: '01234567-89ab-cdef-0123-456789abcdef', digest: '1'.repeat(64), recipeHash: '2'.repeat(64), manifestHash: '3'.repeat(64) }, operations: [{ id: 'verifier-1', status: 'SUCCESS', role: 'verifier', exitCode: 0, signal: null, timedOut: false, truncated: false }], networkEnabled: false, matrixCells: 640, mismatches: 0, firstMismatch: null, classifierCases: 18, classifierDigest: pushProvenance.classifierDigest, fixtureDigest: '7'.repeat(64), startedAt: timestamp, completedAt: timestamp, elapsedMs: 0, usage: null, truncated: false, cleanupState: 'disposable-confirmed', retainedImage: true },
  measurement: { ...base('measurement'), ...candidate, proposalDigest: '1'.repeat(64), sandboxDigest: '2'.repeat(64), cohortDigest: '3'.repeat(64), status: 'measured-improvement', pushes: [pushSample('baseline', 1), pushSample('baseline', 2), pushSample('baseline', 3), pushSample('candidate', 4), pushSample('candidate', 5), pushSample('candidate', 6), pushSample('control', 7)], baselineMedianMinutes: 6, classifierOverheadMinutes: 1, modeled: { pushes: 30, validatedPushes: 24, projectedSavedMinutes: 120, projectedOverheadMinutes: 6 }, limits: ['sample-execution-only'], claimLevel: 'sample-execution-only', githubListSavingUsd: 0 },
  report: { ...base('report'), ...candidate, proposalDigest: '1'.repeat(64), sandboxDigest: '2'.repeat(64), measurementDigest: '3'.repeat(64), status: 'ready-to-publish', markdown: 'Skip validated pushes', markdownHash: sha256('Skip validated pushes'), marker: 'cirujano-1', baseRef: 'main', headRef: 'candidate' },
  publication: { ...cacheArtifacts.publication, ...base('publication') },
};
