import { billableMinutesForJob } from '../billing.js';
import { canonicalJson, jsonDigest, OptimizationInputError } from './canonical.js';
import { array, digest, fail, id, literal, nullable, object, sha, text, timestamp } from './contracts.js';
import type { Validator } from './contracts.js';
import type { GitHubPricing } from './measurement.js';
import { median } from './measurement.js';
import { decodePushArtifact, decodePushProvenance, PUSH_FAMILY } from './push-contracts.js';
import type { PushInputArtifact, PushMeasurementArtifact, PushMeasurementSample, PushProposalArtifact, PushProvenance, PushSandboxArtifact } from './push-contracts.js';
import { CLASSIFIER_JOB_ID } from './push-guard.js';

type Role = PushMeasurementSample['role'];
type Conclusion = PushMeasurementSample['guardedJobs'][number]['conclusion'];
export interface PushCohortEntry { role: Role; pushRunId: number; attempt: number; headSha: string; prNumber: number | null; prRunId: number | null }
/** The seven runs fixed before any result is read: 3 merged-PR pushes on the base workflow, 3 on the candidate, 1 direct push on the candidate. */
export interface PushCohortManifest {
  schemaVersion: 1; kind: 'push-measurement-cohort'; family: typeof PUSH_FAMILY; provenance: PushProvenance;
  proposalDigest: string; sandboxDigest: string; candidateSha: string; recordedAt: string; entries: PushCohortEntry[];
}
/** One job of a push run, mapped to its workflow job id; a matrix job appears once per leg. */
export interface PushRunJob { jobId: string; name: string; conclusion: string | null; startedAt: string | null; completedAt: string | null }
/** What the CLI read for one cohort entry: the run's jobs, the classifier log verdict, the workflow at the head and the PR run's jobs. */
export interface PushRunEvidence extends PushCohortEntry {
  workflowHash: string; classifier: { validated: boolean; reasonCode: string } | null; jobs: PushRunJob[]; prJobs: { name: string; conclusion: string }[];
}
export interface PushComparisonInputs { input: PushInputArtifact; proposal: PushProposalArtifact; sandbox: PushSandboxArtifact; cohort: PushCohortManifest; runs: PushRunEvidence[]; visibility: 'public' | 'private'; pricing: GitHubPricing | null }

export const PUSH_COHORT_ROLES: readonly Role[] = ['baseline', 'baseline', 'baseline', 'candidate', 'candidate', 'candidate', 'control'];
const entryFields = { role: literal('baseline', 'candidate', 'control'), pushRunId: id, attempt: id, headSha: sha, prNumber: nullable(id), prRunId: nullable(id) };
const cohortValidator = object({ schemaVersion: literal(1), kind: literal('push-measurement-cohort'), family: literal(PUSH_FAMILY), provenance: (v: unknown) => decodePushProvenance(v), proposalDigest: digest, sandboxDigest: digest, candidateSha: sha, recordedAt: timestamp, entries: array(object(entryFields)) });
const conclusion = (v: unknown, p: string) => { if (v !== null) text(v, p); };
const evidenceValidator: Validator = object({
  ...entryFields, workflowHash: digest, classifier: nullable(object({ validated: literal(true, false), reasonCode: text })),
  jobs: array(object({ jobId: text, name: text, conclusion, startedAt: nullable(timestamp), completedAt: nullable(timestamp) })),
  prJobs: array(object({ name: text, conclusion: text }), 'name'),
});

export function decodePushCohortManifest(value: unknown): PushCohortManifest {
  canonicalJson(value); cohortValidator(value, 'cohort');
  const cohort = value as PushCohortManifest;
  if (cohort.entries.length !== PUSH_COHORT_ROLES.length) fail('cohort.entries');
  cohort.entries.forEach((entry, index) => { if (entry.role !== PUSH_COHORT_ROLES[index] || (entry.role === 'control') !== (entry.prNumber === null) || (entry.prNumber === null) !== (entry.prRunId === null)) fail(`cohort.entries[${index}]`); });
  for (const key of ['run', 'head', 'pr'] as const) {
    const values = cohort.entries.map(entry => key === 'run' ? `${entry.pushRunId}:${entry.attempt}` : key === 'head' ? entry.headSha : entry.prNumber).filter(value => value !== null);
    if (new Set(values).size !== values.length) fail(`cohort.entries.${key}.duplicate`);
  }
  return cohort;
}

/** One conclusion per guarded job: uniform legs keep theirs, mixed legs report the least favourable one. */
function guardedConclusion(jobs: PushRunJob[]): Conclusion {
  const values = jobs.map(job => (['success', 'skipped', 'cancelled'].includes(job.conclusion ?? '') ? job.conclusion : 'failure') as Conclusion);
  return (['failure', 'cancelled', 'skipped', 'success'] as const).find(value => values.includes(value))!;
}

/**
 * The per-push gate. Each candidate must be validated by the classifier with every guarded job skipped
 * and bill at least one minute below the baseline median; the control, a push with no merged PR, must run every guarded job; every
 * PR run must be green with the baseline's job set. Unsafe evidence rejects; a missed saving is no improvement.
 */
export function comparePushMeasurement(inputs: PushComparisonInputs): PushMeasurementArtifact {
  canonicalJson(inputs);
  object({ input: () => {}, proposal: () => {}, sandbox: () => {}, cohort: () => {}, runs: array(evidenceValidator), visibility: literal('public', 'private'), pricing: nullable(object({ usdPerMinute: (v, p) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(p); }, priceBasis: text, allowanceKnown: literal(true, false) })) })(inputs, 'inputs');
  const input = decodePushArtifact('input', inputs.input), proposal = decodePushArtifact('proposal', inputs.proposal), sandbox = decodePushArtifact('sandbox', inputs.sandbox), cohort = decodePushCohortManifest(inputs.cohort);
  const errors = new Set<string>(), shortfalls = new Set<string>();
  const reject = (condition: boolean, reason: string) => { if (condition) errors.add(reason); };
  const guardedIds = input.provenance.guardedJobIds, candidateSha = proposal.candidateSha ?? sandbox.candidateSha;
  const result: PushMeasurementArtifact = { schemaVersion: 1, kind: 'measurement', family: PUSH_FAMILY, provenance: structuredClone(input.provenance), candidateSha, patchHash: proposal.patchHash, proposalDigest: jsonDigest(proposal), sandboxDigest: jsonDigest(sandbox), cohortDigest: jsonDigest(cohort), status: 'rejected', pushes: [], baselineMedianMinutes: 0, classifierOverheadMinutes: 0, modeled: { pushes: 0, validatedPushes: 0, projectedSavedMinutes: 0, projectedOverheadMinutes: 0 }, limits: [], claimLevel: 'none', githubListSavingUsd: 0 };
  const provenanceDigest = jsonDigest(input.provenance);
  reject([proposal.provenance, sandbox.provenance, cohort.provenance].some(provenance => jsonDigest(provenance) !== provenanceDigest), 'provenance-drift');
  reject(input.status !== 'collected' || proposal.status !== 'proposed' || sandbox.status !== 'sandbox-verified', 'stage-not-supported');
  reject(sandbox.proposalDigest !== result.proposalDigest || cohort.proposalDigest !== result.proposalDigest || cohort.sandboxDigest !== result.sandboxDigest || sandbox.candidateSha !== candidateSha || cohort.candidateSha !== candidateSha || sandbox.patchHash !== proposal.patchHash, 'artifact-binding-drift');
  reject(!input.operations.some(operation => canonicalJson(operation) === canonicalJson(proposal.operation)), 'operation-not-collected');
  const identity = (entry: PushCohortEntry) => canonicalJson([entry.role, entry.pushRunId, entry.attempt, entry.headSha, entry.prNumber, entry.prRunId]);
  reject(inputs.runs.length !== cohort.entries.length || inputs.runs.some((run, index) => identity(run) !== identity(cohort.entries[index]!)), 'cohort-membership-drift');

  for (const run of inputs.runs) {
    const unvalidated = run.role === 'control' || run.classifier?.validated === false;
    const classifierJobs = run.jobs.filter(job => job.jobId === CLASSIFIER_JOB_ID);
    const legs = (jobId: string) => run.jobs.filter(job => job.jobId === jobId);
    const minutes = run.jobs.map(job => job.conclusion === 'skipped' ? 0 : billableMinutesForJob(job));
    reject(run.jobs.some(job => job.jobId !== CLASSIFIER_JOB_ID && !guardedIds.includes(job.jobId)) || guardedIds.some(jobId => !legs(jobId).length) || minutes.includes(null)
      || (run.role === 'baseline' ? run.classifier !== null || classifierJobs.length !== 0 : run.classifier === null || classifierJobs.length !== 1)
      || (run.role === 'control' ? run.prJobs.length !== 0 : !run.prJobs.length), 'run-evidence-invalid');
    reject(run.workflowHash !== (run.role === 'baseline' ? input.provenance.workflowHash : proposal.candidateWorkflowHash), 'workflow-drift');
    reject(run.role !== 'baseline' && classifierJobs.some(job => job.conclusion !== 'success'), 'classifier-not-green');
    const guardedJobs = guardedIds.filter(jobId => legs(jobId).length).map(jobId => ({ jobId, conclusion: guardedConclusion(legs(jobId)) }));
    const ran = guardedIds.every(jobId => legs(jobId).every(job => job.conclusion === 'success'));
    reject(run.role === 'baseline' && !ran, 'baseline-not-green');
    reject(run.role === 'control' && (run.classifier?.validated !== false || !ran), 'control-not-full');
    // Only a push with no merged PR shows the full-run path; a merged-PR push that failed open is not a control.
    reject(run.role === 'control' && run.classifier?.reasonCode !== 'no-merged-pr', 'control-not-direct');
    reject(run.role === 'candidate' && run.classifier?.validated === true && guardedIds.some(jobId => legs(jobId).some(job => job.conclusion !== 'skipped')), 'guard-not-honored');
    reject(run.role === 'candidate' && run.classifier?.validated === false && !ran, 'unvalidated-push-not-full');
    if (run.role === 'candidate' && unvalidated) shortfalls.add('candidate-not-validated');
    reject(run.prJobs.some(job => job.conclusion !== 'success'), 'pr-run-not-green');
    const billed = minutes.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const classifierMinutes = classifierJobs.reduce<number>((sum, job) => sum + (billableMinutesForJob(job) ?? 0), 0);
    result.pushes.push({ role: run.role, pushRunId: run.pushRunId, attempt: run.attempt, headSha: run.headSha, prNumber: run.prNumber, prRunId: run.prRunId, billedMinutes: billed, classifierMinutes, validated: run.classifier?.validated === true, guardedJobs, prJobs: [...run.prJobs].sort((a, b) => a.name < b.name ? -1 : 1) });
  }
  const role = (name: Role) => result.pushes.filter(push => push.role === name);
  const prJobNames = (push: PushMeasurementSample) => canonicalJson(push.prJobs.map(job => job.name));
  const reference = role('baseline')[0];
  reject(!reference || [...role('baseline'), ...role('candidate')].some(push => prJobNames(push) !== prJobNames(reference)), 'pr-coverage-drift');
  result.baselineMedianMinutes = median(role('baseline').map(push => push.billedMinutes));
  result.classifierOverheadMinutes = role('control')[0]?.classifierMinutes ?? 0;
  if (role('candidate').some(push => push.billedMinutes > result.baselineMedianMinutes - 1)) shortfalls.add('saving-below-one-minute');
  // Labeled projection over the collected history: validated pushes save their minutes net of the classifier; the rest pay it on top.
  const history = input.history, validated = history.filter(entry => entry.validated);
  result.modeled = { pushes: history.length, validatedPushes: validated.length, projectedSavedMinutes: Math.max(0, validated.reduce((sum, entry) => sum + entry.billedMinutes, 0) - validated.length * result.classifierOverheadMinutes), projectedOverheadMinutes: (history.length - validated.length) * result.classifierOverheadMinutes };

  result.status = errors.size ? 'rejected' : shortfalls.size ? 'no-improvement' : 'measured-improvement';
  result.claimLevel = result.status === 'measured-improvement' ? 'sample-execution-only' : 'none';
  result.limits = ['sample-execution-only', 'per-push-gate', 'classifier-overhead-disclosed', 'modeled-history-projection', 'list-price-estimate-not-invoice', 'provider-inference-costs-not-netted'];
  if (inputs.visibility === 'public') result.limits.push('public-github-list-saving-zero');
  else if (inputs.pricing === null) result.limits.push('github-pricing-unavailable');
  else if (!inputs.pricing.allowanceKnown) result.limits.push('github-allowance-unknown');
  else if (result.status === 'measured-improvement') result.githubListSavingUsd = role('candidate').reduce((sum, push) => sum + result.baselineMedianMinutes - push.billedMinutes, 0) * inputs.pricing.usdPerMinute;
  result.limits.push(...shortfalls, ...errors);
  return decodePushArtifact('measurement', result);
}

/** Every downstream claim recomputes the comparison; serialized lifecycle labels confer no authority. */
export function assertPushMeasuredEvidence(inputs: PushComparisonInputs, artifact: PushMeasurementArtifact): void {
  decodePushArtifact('measurement', artifact);
  if (canonicalJson(comparePushMeasurement(inputs)) !== canonicalJson(artifact)) throw new OptimizationInputError('Measurement evidence does not match the complete authorized comparison');
}
