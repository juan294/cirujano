import { readFileSync } from 'node:fs';
import { gitBlobSha, jsonDigest, sha256 } from './canonical.js';
import { CLASSIFIER_DIGEST } from './push-classifier.js';
import { classifierCases } from './push-classifier-cases.js';
import { decodePushArtifact, PUSH_FAMILY, type PushHistoryEntry } from './push-contracts.js';
import { CLASSIFIER_JOB_ID } from './push-guard.js';
import { createPushInput } from './push-input.js';
import type { PushCohortManifest, PushComparisonInputs, PushRunEvidence, PushRunJob } from './push-measurement.js';
import { createSkipValidatedPushPatch } from './push-patch.js';
import { inspectPushWorkflow } from './push-workflow.js';

const workflowPath = '.github/workflows/ci.yml';
export const pushBase = readFileSync(new URL('../../fixtures/optimization/push/eligible-multi-job.yml', import.meta.url), 'utf8');
export const candidateSha = 'c'.repeat(40);
const sha = (seed: number) => seed.toString(16).padStart(40, '0');
/** A job that ran `minutes` whole minutes (ending 30 s into the last one), or was skipped. */
export function job(jobId: string, conclusion: PushRunJob['conclusion'], minutes: number, name = jobId): PushRunJob {
  if (conclusion === 'skipped') return { jobId, name, conclusion, startedAt: '2026-10-10T10:00:00Z', completedAt: '2026-10-10T10:00:00Z' };
  return { jobId, name, conclusion, startedAt: '2026-10-10T10:00:00Z', completedAt: new Date(Date.parse('2026-10-10T10:00:00Z') + (minutes - 1) * 60_000 + 30_000).toISOString().replace('.000Z', 'Z') };
}
const prJobs = () => [{ name: 'build', conclusion: 'success' }, { name: 'lint', conclusion: 'success' }, { name: 'test', conclusion: 'success' }];

/** Three baseline and three candidate merged-PR pushes and one direct control push on the public proof repository. */
export function pushComparisonFixture(): PushComparisonInputs {
  const history: PushHistoryEntry[] = Array.from({ length: 10 }, (_, index) => ({ pushRunId: 900 + index, attempt: 1, headSha: sha(900 + index), billedMinutes: 12, jobsBilled: 3, prNumber: index < 8 ? 80 + index : null, validated: index < 8, reasonCode: index < 8 ? 'validated' : 'no-merged-pr' }));
  const eligibility = inspectPushWorkflow(pushBase, { workflowHash: sha256(pushBase), workflowPath, integrationBranch: 'main', inventory: [{ path: workflowPath, source: pushBase }] });
  const input = createPushInput({ provenance: { repositoryId: 123, repository: 'public-example/benchmark', baseSha: 'a'.repeat(40), workflowBlobSha: gitBlobSha(pushBase), workflowPath, workflowHash: sha256(pushBase), integrationBranch: 'main', classifierDigest: CLASSIFIER_DIGEST, verificationProfileHash: 'f'.repeat(64), toolSourceSha: '1'.repeat(40), bundleDigest: '2'.repeat(64) }, eligibility, history, treeSha: 'e'.repeat(40) });
  const patch = createSkipValidatedPushPatch(pushBase, { workflowHash: sha256(pushBase), workflowPath, integrationBranch: 'main', inventory: [{ path: workflowPath, source: pushBase }] });
  const proposal = decodePushArtifact('proposal', { schemaVersion: 1, kind: 'proposal', family: PUSH_FAMILY, provenance: input.provenance, status: 'proposed', operation: input.operations[0], candidateSha: null, candidateWorkflowHash: patch.afterHash, patchHash: sha256(patch.patch), beforeStructuralDigest: patch.beforeStructuralDigest, afterStructuralDigest: patch.afterStructuralDigest, permittedDiff: { classifierJobId: CLASSIFIER_JOB_ID, guardedJobIds: input.provenance.guardedJobIds }, preconditions: ['guard-only-change'], diagnosisDigest: '3'.repeat(64) });
  const sandbox = decodePushArtifact('sandbox', { schemaVersion: 1, kind: 'sandbox', family: PUSH_FAMILY, provenance: input.provenance, candidateSha, patchHash: proposal.patchHash, proposalDigest: jsonDigest(proposal), status: 'sandbox-verified', image: { uuid: '12345678-9abc-baba-deda-0123456789ab', digest: '4'.repeat(64), recipeHash: '5'.repeat(64), manifestHash: '6'.repeat(64) }, operations: [{ id: '12345678-9abc-baba-deda-0123456789ad', status: 'SUCCESS', role: 'verifier', exitCode: 0, signal: null, timedOut: false, truncated: false }], networkEnabled: false, matrixCells: 509, mismatches: 0, firstMismatch: null, classifierCases: classifierCases().length, classifierDigest: CLASSIFIER_DIGEST, fixtureDigest: jsonDigest(classifierCases()), startedAt: '2026-10-10T09:00:00Z', completedAt: '2026-10-10T09:01:00Z', elapsedMs: 60_000, usage: null, truncated: false, cleanupState: 'disposable-confirmed', retainedImage: true });
  const entries = [
    ...[0, 1, 2].map(index => ({ role: 'baseline' as const, pushRunId: 1000 + index, attempt: 1, headSha: sha(1000 + index), prNumber: 100 + index, prRunId: 2000 + index })),
    ...[0, 1, 2].map(index => ({ role: 'candidate' as const, pushRunId: 1100 + index, attempt: 1, headSha: sha(1100 + index), prNumber: 110 + index, prRunId: 2100 + index })),
    { role: 'control' as const, pushRunId: 1200, attempt: 1, headSha: sha(1200), prNumber: null, prRunId: null },
  ];
  const cohort: PushCohortManifest = { schemaVersion: 1, kind: 'push-measurement-cohort', family: PUSH_FAMILY, provenance: input.provenance, proposalDigest: jsonDigest(proposal), sandboxDigest: jsonDigest(sandbox), candidateSha, recordedAt: '2026-10-10T08:00:00Z', entries };
  const runs: PushRunEvidence[] = entries.map((entry, index) => {
    if (entry.role === 'baseline') return { ...entry, workflowHash: sha256(pushBase), classifier: null, jobs: [job('lint', 'success', 3), job('test', 'success', 5 + index), job('build', 'success', 3)], prJobs: prJobs() };
    if (entry.role === 'candidate') return { ...entry, workflowHash: patch.afterHash, classifier: { validated: true, reasonCode: 'validated' }, jobs: [job(CLASSIFIER_JOB_ID, 'success', 1), job('lint', 'skipped', 0), job('test', 'skipped', 0), job('build', 'skipped', 0)], prJobs: prJobs() };
    return { ...entry, workflowHash: patch.afterHash, classifier: { validated: false, reasonCode: 'no-merged-pr' }, jobs: [job(CLASSIFIER_JOB_ID, 'success', 1), job('lint', 'success', 3), job('test', 'success', 6), job('build', 'success', 3)], prJobs: [] };
  });
  return { input, proposal, sandbox, cohort, runs, visibility: 'public', pricing: null };
}
