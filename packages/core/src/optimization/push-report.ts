import { canonicalJson, jsonDigest, sha256 } from './canonical.js';
import { assertSamePushProvenance, decodePushArtifact, isLiteralWorkflowPath, PUSH_FAMILY, validatePushDiagnosisEvidence } from './push-contracts.js';
import type { PushDiagnosisArtifact, PushInferenceArtifact, PushMeasurementArtifact, PushReportArtifact } from './push-contracts.js';
import { CLASSIFIER_JOB_ID } from './push-guard.js';
import { assertPushMeasuredEvidence, type PushComparisonInputs } from './push-measurement.js';
import { currency, fail, finish, ref, safeModel } from './report.js';

export interface PushReportRenderInputs extends PushComparisonInputs { diagnosis: PushDiagnosisArtifact; inference: PushInferenceArtifact; measurement: PushMeasurementArtifact; patch: string; baseRef: string; headRef: string }
const knownEvidenceIds = new Set(['classifier-reasons', 'push-history', 'workflow-eligibility']);

/** The skip-validated-push report: fixed text and typed identities only, rendered from recomputed, bound evidence. */
export function renderPushReport(inputs: PushReportRenderInputs): PushReportArtifact {
  canonicalJson(inputs);
  const comparison: PushComparisonInputs = { input: inputs.input, proposal: inputs.proposal, sandbox: inputs.sandbox, cohort: inputs.cohort, runs: inputs.runs, visibility: inputs.visibility, pricing: inputs.pricing };
  assertPushMeasuredEvidence(comparison, inputs.measurement);
  const input = decodePushArtifact('input', inputs.input), proposal = decodePushArtifact('proposal', inputs.proposal), sandbox = decodePushArtifact('sandbox', inputs.sandbox), measurement = decodePushArtifact('measurement', inputs.measurement);
  const diagnosis = decodePushArtifact('diagnosis', inputs.diagnosis), inference = decodePushArtifact('inference', inputs.inference);
  for (const artifact of [proposal, sandbox, measurement, diagnosis, inference]) assertSamePushProvenance(input.provenance, artifact.provenance);
  validatePushDiagnosisEvidence(diagnosis, input);
  if (diagnosis.inferenceReceiptDigest !== jsonDigest(inference) || proposal.diagnosisDigest !== jsonDigest(diagnosis) || canonicalJson(diagnosis.operation) !== canonicalJson(proposal.operation)) fail('diagnosis/inference/proposal binding');
  if (typeof inputs.patch !== 'string' || Buffer.byteLength(inputs.patch) > 4 * 1024 * 1024 || sha256(inputs.patch) !== proposal.patchHash) fail('patch bytes/hash');
  const workflow = input.provenance.workflowPath;
  if (!isLiteralWorkflowPath(workflow)) fail('unsupported workflow path');
  const baseRef = ref(inputs.baseRef), headRef = ref(inputs.headRef);
  const proposalDigest = jsonDigest(proposal), sandboxDigest = jsonDigest(sandbox), measurementDigest = jsonDigest(measurement);
  const marker = `<!-- cirujano-optimization:${proposalDigest}:${measurementDigest} -->`;
  // Control and coverage sentences are claims only the passed gate supports; a passed gate implies a verified Sandbox.
  const passed = measurement.status === 'measured-improvement', ready = passed && inference.status === 'completed' && diagnosis.status === 'proposal';
  const status: PushReportArtifact['status'] = ready ? 'ready-to-publish' : measurement.status === 'no-improvement' ? 'no-improvement' : 'rejected';
  const publicRepository = inputs.visibility === 'public', repository = input.provenance.repository, branch = publicRepository ? input.provenance.integrationBranch : 'the integration branch';
  const run = (id: number, attempt: number) => publicRepository ? `[${id} / ${attempt}](https://github.com/${repository}/actions/runs/${id}/attempts/${attempt})` : `${id} / ${attempt}`;
  const prRun = (id: number | null) => id === null ? 'none' : publicRepository ? `[${id}](https://github.com/${repository}/actions/runs/${id})` : String(id);
  const guarded = input.provenance.guardedJobIds;
  const candidates = measurement.pushes.filter(push => push.role === 'candidate');
  const lines = [
    `# Skip validated pushes: ${status}`,
    '',
    `Repository: ${publicRepository ? repository : 'private repository (identity withheld)'}`,
    `Workflow: ${workflow}${publicRepository ? `; integration branch: ${branch}` : ''}.`,
    `Diagnosis: ${diagnosis.status}; operation: skip-validated-push; guarded jobs: ${publicRepository ? guarded.join(', ') : `${guarded.length} (identities withheld)`}.`,
    `Evidence IDs: ${diagnosis.evidenceIds.filter(id => knownEvidenceIds.has(id)).join(', ') || 'identities withheld'}.`,
    '',
    `The rule: a push to ${branch} skips the guarded jobs only when it lands one merged pull request whose own run of this workflow already passed on the exact same tree. Every other push runs every job.`,
    `Why it is safe: the added ${CLASSIFIER_JOB_ID} job proves the push was not forced, the pushed tree equals the tree of the PR head that passed, and the branch tip before the merge is an ancestor of that head. Any missing proof, error or timeout leaves validated false, so the jobs run.`,
    'Each guarded job keeps its original needs and condition; only the final operand reads the classifier output.',
    `Classifier SHA-256: ${input.provenance.classifierDigest}`,
    `Patch SHA-256: ${proposal.patchHash}`,
    '',
    `Model requested: ${safeModel(inference.requestedModel)}; returned: ${safeModel(inference.returnedModel)}; status: ${inference.status}; finish: ${finish(inference.finishReason)}.`,
    `Tokens (prompt / completion / total): ${inference.usage ? `${inference.usage.promptTokens} / ${inference.usage.completionTokens} / ${inference.usage.totalTokens}` : 'unavailable'}.`,
    `Inference cost: ${inference.costStatus}${inference.cost ? `; ${inference.cost.amount} ${currency(inference.cost.currency)}` : ''}.`,
    `Sandbox: ${sandbox.status}; network disabled; cleanup: ${sandbox.cleanupState}.`,
    `Sandbox guard matrix: ${sandbox.matrixCells} cells, ${sandbox.mismatches} mismatches; classifier cases: ${sandbox.classifierCases}.`,
    `Sandbox usage: ${sandbox.usage ? `${sandbox.usage.value}; ${sandbox.usage.unit === 'undocumented-provider-unit' ? 'undocumented-provider-unit' : 'provider unit retained in private evidence'}; ${sandbox.usage.currency === null ? 'currency unavailable' : currency(sandbox.usage.currency)}` : 'unavailable'}.`,
    'Sandbox elapsed time is separate verification overhead; it is not a GitHub saving.',
    '',
    '| Role | Push run / attempt | PR run | Validated | Guarded jobs | Billed min | Classifier min |',
    '| --- | --- | --- | --- | --- | ---: | ---: |',
    ...measurement.pushes.map(push => `| ${push.role} | ${run(push.pushRunId, push.attempt)} | ${prRun(push.prRunId)} | ${push.validated} | ${[...new Set(push.guardedJobs.map(job => job.conclusion))].join(' / ')} | ${push.billedMinutes} | ${push.classifierMinutes} |`),
    '',
    `Baseline median billed minutes per push: ${measurement.baselineMedianMinutes}; candidate pushes: ${candidates.map(push => push.billedMinutes).join(', ')}.`,
    `Classifier overhead: ${measurement.classifierOverheadMinutes} billed minute(s) on every push to ${branch}, ${passed ? 'measured on the direct control push, which ran every guarded job' : 'read from the control push; the gate did not pass'}.`,
    `PR coverage: ${passed ? `every sampled PR run passed the same ${measurement.pushes[0]?.prJobs.length ?? 0} jobs` : 'not established; see the comparison limitations'}.`,
    `Modeled, not measured: across the last ${measurement.modeled.pushes} collected pushes, ${measurement.modeled.validatedPushes} would have validated, projecting ${measurement.modeled.projectedSavedMinutes} minutes saved and ${measurement.modeled.projectedOverheadMinutes} minutes of classifier overhead on the rest.`,
    `GitHub list estimate: ${measurement.githubListSavingUsd} USD; ${publicRepository ? 'public repository list saving is zero' : inputs.pricing === null ? 'price unavailable' : inputs.pricing.allowanceKnown ? 'explicit owner-supplied price basis' : 'allowance unknown; no positive list estimate'}.`,
    'Measured claims apply only to these seven sampled pushes. List estimates are not invoice savings. Provider and inference costs are not netted; no fleet, annual or net saving is established.',
    `Comparison limitations: ${measurement.limits.map(limit => /^[a-z0-9-]{1,100}$/.test(limit) ? limit : 'unsupported limit retained privately').join(', ')}.`,
    '',
    'Manual rollback of the reviewed guard-only patch:',
    '```sh',
    'git apply --reverse workflow.patch',
    '```',
    'After rollback every push runs every job again. No rollback or merge is automatic.',
    '',
    marker,
  ];
  const markdown = lines.join('\n');
  if (Buffer.byteLength(markdown) > 8192) fail('Markdown exceeds 8192 bytes');
  return decodePushArtifact('report', { schemaVersion: 1, kind: 'report', family: PUSH_FAMILY, provenance: structuredClone(input.provenance), candidateSha: measurement.candidateSha, patchHash: proposal.patchHash, proposalDigest, sandboxDigest, measurementDigest, status, markdown, markdownHash: sha256(markdown), marker, baseRef, headRef });
}
