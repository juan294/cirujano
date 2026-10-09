import { canonicalJson, jsonDigest, OptimizationInputError, sha256 } from './canonical.js';
import { assertSameProvenance, decodeArtifact, validateDiagnosisEvidence, type DiagnosisArtifact, type InferenceArtifact, type MeasurementArtifact, type ReportArtifact } from './contracts.js';
import { assertMeasuredEvidence, type ComparisonInputs } from './measurement.js';

export interface ReportRenderInputs extends ComparisonInputs { diagnosis: DiagnosisArtifact; inference: InferenceArtifact; measurement: MeasurementArtifact; patch: string; baseRef: string; headRef: string }
function fail(message: string): never { throw new OptimizationInputError(`Invalid optimization report: ${message}`); }
export function ref(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value) || value.includes('..') || value.includes('//') || value.endsWith('/') || value.endsWith('.lock')) fail('unsafe ref'); return value; }
// Only fixed text and typed identities may enter public Markdown. Free-form model,
// provider, report-path and pricing strings remain in private immutable artifacts.
export function safeModel(value: string | null): string { if (value === null) return 'unavailable'; if (!/^nvidia\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) fail('unsafe model identity'); return value; }
export function currency(value: string): string { if (!/^[A-Z]{3}$/.test(value)) return 'currency unavailable'; return value; }
export function finish(value: string | null): string { return value === 'stop' ? 'stop' : 'unavailable'; }
const knownEvidenceIds = new Set(['install', 'install-timing', 'setup-node-receipt', 'workflow-eligibility']);

/** Render only independently recomputed, bound evidence; prose never grants authority. */
export function renderOptimizationReport(inputs: ReportRenderInputs): ReportArtifact {
  canonicalJson(inputs);
  const comparison: ComparisonInputs = { input: inputs.input, proposal: inputs.proposal, sandbox: inputs.sandbox, cohort: inputs.cohort, samples: inputs.samples, visibility: inputs.visibility, pricing: inputs.pricing };
  assertMeasuredEvidence(comparison, inputs.measurement);
  const input = decodeArtifact('input', inputs.input), proposal = decodeArtifact('proposal', inputs.proposal), sandbox = decodeArtifact('sandbox', inputs.sandbox), measurement = decodeArtifact('measurement', inputs.measurement);
  const diagnosis = decodeArtifact('diagnosis', inputs.diagnosis), inference = decodeArtifact('inference', inputs.inference);
  for (const artifact of [proposal, sandbox, measurement, diagnosis, inference]) assertSameProvenance(input.provenance, artifact.provenance);
  validateDiagnosisEvidence(diagnosis, input);
  if (diagnosis.inferenceReceiptDigest !== jsonDigest(inference) || proposal.diagnosisDigest !== jsonDigest(diagnosis) || canonicalJson(diagnosis.operation) !== canonicalJson(proposal.operation)) fail('diagnosis/inference/proposal binding');
  if (typeof inputs.patch !== 'string' || Buffer.byteLength(inputs.patch) > 4 * 1024 * 1024 || sha256(inputs.patch) !== proposal.patchHash) fail('patch bytes/hash');
  const workflow = input.provenance.workflowPath;
  if (!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(workflow)) fail('unsupported workflow path');
  const baseRef = ref(inputs.baseRef), headRef = ref(inputs.headRef);
  const proposalDigest = jsonDigest(proposal), sandboxDigest = jsonDigest(sandbox), measurementDigest = jsonDigest(measurement);
  const marker = `<!-- cirujano-optimization:${proposalDigest}:${measurementDigest} -->`;
  const ready = measurement.status === 'measured-improvement' && inference.status === 'completed' && sandbox.status === 'sandbox-verified' && diagnosis.status === 'proposal';
  const status: ReportArtifact['status'] = ready ? 'ready-to-publish' : measurement.status === 'no-improvement' ? 'no-improvement' : 'rejected';
  const publicRepository = inputs.visibility === 'public';
  const lines = [
    `# pnpm cache verification: ${status}`,
    '',
    `Repository: ${publicRepository ? input.provenance.repository : 'private repository (identity withheld)'}`,
    `Workflow: ${workflow}`,
    `Diagnosis: ${diagnosis.status}; operation: enable-pnpm-cache; setup-node step ${proposal.operation.stepIndex}.`,
    'Observed change: enable the pnpm cache for the selected uncached frozen install. Model explanation and uncertainty remain in private evidence.',
    `Evidence IDs: ${diagnosis.evidenceIds.filter(id => knownEvidenceIds.has(id)).join(', ') || 'identities withheld'}.`,
    '',
    'Only these two setup-node inputs change:',
    '```diff',
    '+ cache: pnpm',
    '+ cache-dependency-path: pnpm-lock.yaml',
    '```',
    `Patch SHA-256: ${proposal.patchHash}`,
    '',
    `Model requested: ${safeModel(inference.requestedModel)}; returned: ${safeModel(inference.returnedModel)}; status: ${inference.status}; finish: ${finish(inference.finishReason)}.`,
    `Tokens (prompt / completion / total): ${inference.usage ? `${inference.usage.promptTokens} / ${inference.usage.completionTokens} / ${inference.usage.totalTokens}` : 'unavailable'}.`,
    `Inference cost: ${inference.costStatus}${inference.cost ? `; ${inference.cost.amount} ${currency(inference.cost.currency)}` : ''}.`,
    `Sandbox: ${sandbox.status}; network disabled; cleanup: ${sandbox.cleanupState}.`,
    ...sandbox.operations.map(operation => `Sandbox ${operation.role}: ${operation.status}; exit ${operation.exitCode === null ? 'unavailable' : operation.exitCode}; timed out ${operation.timedOut}; truncated ${operation.truncated}.`),
    `Sandbox paired quality: base ${sandbox.baseQuality?.tests.length ?? 0} tests / ${sandbox.baseQuality?.coverage.length ?? 0} files; candidate ${sandbox.candidateQuality?.tests.length ?? 0} tests / ${sandbox.candidateQuality?.coverage.length ?? 0} files.`,
    `Sandbox usage: ${sandbox.usage ? `${sandbox.usage.value}; ${sandbox.usage.unit === 'undocumented-provider-unit' ? 'undocumented-provider-unit' : 'provider unit retained in private evidence'}; ${sandbox.usage.currency === null ? 'currency unavailable' : currency(sandbox.usage.currency)}` : 'unavailable'}.`,
    'Sandbox elapsed time is separate verification overhead; it is not a GitHub saving.',
    '',
    '| Role | Run / attempt | Result | Job ms | Rounded min | Queue ms | End-to-end ms | Cache |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...measurement.samples.map(sample => `| ${sample.role} | ${publicRepository ? `[${sample.runId} / ${sample.attempt}](https://github.com/${input.provenance.repository}/actions/runs/${sample.runId}/attempts/${sample.attempt})` : `${sample.runId} / ${sample.attempt}`} | ${sample.conclusion} | ${sample.elapsedMs} | ${sample.roundedMinutes} | ${sample.queueMs} | ${sample.endToEndMs} | ${sample.cacheObservation} |`),
    '',
    `Whole-job rounded minutes: base ${measurement.baselineMinutes}; candidate ${measurement.candidateMinutes}.`,
    `Median whole-job elapsed ms: base ${measurement.baselineMedianMs}; candidate ${measurement.candidateMedianMs}.`,
    `Maximum queue ms: ${measurement.maximumQueueMs}; maximum end-to-end ms: ${measurement.maximumEndToEndMs}.`,
    `GitHub list estimate: ${measurement.githubListSavingUsd} USD; ${publicRepository ? 'public repository list saving is zero' : inputs.pricing === null ? 'price unavailable' : inputs.pricing.allowanceKnown ? 'explicit owner-supplied price basis' : 'allowance unknown; no positive list estimate'}.`,
    'Claims apply only to these six sample executions, including the cold candidate. List estimates are not invoice savings. Provider and inference costs are not netted; no fleet, annual or net saving is established.',
    `Comparison limitations: ${measurement.limits.map(limit => /^[a-z0-9-]{1,100}$/.test(limit) ? limit : 'unsupported limit retained privately').join(', ')}.`,
    '',
    'Manual rollback of the reviewed two-input patch:',
    '```sh',
    'git apply --reverse workflow.patch',
    '```',
    'Re-run the original verification commands after rollback. No rollback or merge is automatic.',
    '',
    marker,
  ];
  const markdown = lines.join('\n');
  if (Buffer.byteLength(markdown) > 8192) fail('Markdown exceeds 8192 bytes');
  return decodeArtifact('report', { schemaVersion: 1, kind: 'report', provenance: structuredClone(input.provenance), candidateSha: measurement.candidateSha, patchHash: proposal.patchHash, proposalDigest, sandboxDigest, measurementDigest, status, markdown, markdownHash: sha256(markdown), marker, baseRef, headRef });
}
