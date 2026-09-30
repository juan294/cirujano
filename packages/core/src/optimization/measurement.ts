import { billableMinutesForJob } from '../billing.js';
import { canonicalJson, jsonDigest, OptimizationInputError } from './canonical.js';
import { decodeArtifact, decodeProvenance } from './contracts.js';
import type { InputArtifact, MeasurementArtifact, MeasurementSample, ProposalArtifact, Provenance, QualityEvidence, SandboxArtifact } from './contracts.js';

export interface CohortManifest {
  schemaVersion: 1; kind: 'measurement-cohort'; provenance: Provenance;
  proposalDigest: string; sandboxDigest: string; candidateSha: string; recordedAt: string;
  entries: { role: 'base' | 'candidate'; runId: number; attempt: number }[];
  runner: { os: string; architecture: string; image: string };
}
export interface GitHubPricing { usdPerMinute: number; priceBasis: string; allowanceKnown: boolean }
export interface ComparisonInputs { input: InputArtifact; proposal: ProposalArtifact; sandbox: SandboxArtifact; cohort: CohortManifest; samples: MeasurementSample[]; visibility: 'public' | 'private'; pricing: GitHubPricing | null }

function invalid(field: string): never { throw new OptimizationInputError(`Invalid measurement field: ${field}`); }
function exactObject(value: unknown, keys: string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid(field);
  return value as Record<string, unknown>;
}
function boundedText(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 8192 && !/[\u0000-\u001f\u007f]/.test(value); }
function identifier(value: unknown): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }

export function decodeCohortManifest(value: unknown): CohortManifest {
  canonicalJson(value);
  const cohort = exactObject(value, ['schemaVersion', 'kind', 'provenance', 'proposalDigest', 'sandboxDigest', 'candidateSha', 'recordedAt', 'entries', 'runner'], 'cohort');
  if (cohort.schemaVersion !== 1 || cohort.kind !== 'measurement-cohort') invalid('cohort.version');
  decodeProvenance(cohort.provenance);
  for (const field of ['proposalDigest', 'sandboxDigest']) if (typeof cohort[field] !== 'string' || !/^[a-f0-9]{64}$/.test(cohort[field])) invalid(`cohort.${field}`);
  if (typeof cohort.candidateSha !== 'string' || !/^[a-f0-9]{40}$/.test(cohort.candidateSha)) invalid('cohort.candidateSha');
  if (typeof cohort.recordedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(cohort.recordedAt) || !Number.isFinite(Date.parse(cohort.recordedAt)) || new Date(cohort.recordedAt).toISOString().replace('.000Z', 'Z') !== cohort.recordedAt.replace('.000Z', 'Z')) invalid('cohort.recordedAt');
  if (!Array.isArray(cohort.entries) || cohort.entries.length !== 6) invalid('cohort.entries');
  const seen = new Set<string>();
  cohort.entries.forEach((value, index) => {
    const entry = exactObject(value, ['role', 'runId', 'attempt'], 'cohort.entry');
    if (entry.role !== (index < 3 ? 'base' : 'candidate') || !identifier(entry.runId) || !identifier(entry.attempt)) invalid('cohort.entry.identity');
    const identity = `${entry.runId}:${entry.attempt}`;
    if (seen.has(identity)) invalid('cohort.entry.duplicate');
    seen.add(identity);
  });
  const runner = exactObject(cohort.runner, ['os', 'architecture', 'image'], 'cohort.runner');
  if (!Object.values(runner).every(boundedText)) invalid('cohort.runner.identity');
  return value as CohortManifest;
}

function validatePricing(pricing: GitHubPricing | null): void {
  if (pricing === null) return;
  const value = exactObject(pricing, ['usdPerMinute', 'priceBasis', 'allowanceKnown'], 'pricing');
  if (typeof value.usdPerMinute !== 'number' || !Number.isFinite(value.usdPerMinute) || value.usdPerMinute < 0 || !boundedText(value.priceBasis) || typeof value.allowanceKnown !== 'boolean') invalid('pricing');
}
function normalizedQuality(quality: QualityEvidence): string {
  return canonicalJson({ commandDigest: quality.commandDigest, tests: [...quality.tests].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), coverage: [...quality.coverage].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
}
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Compare the complete authorized cohort. Timing is whole-job wall time, never Sandbox or step time. */
export function compareMeasurement(inputs: ComparisonInputs): MeasurementArtifact {
  canonicalJson(inputs);
  exactObject(inputs, ['input', 'proposal', 'sandbox', 'cohort', 'samples', 'visibility', 'pricing'], 'inputs');
  const input = decodeArtifact('input', inputs.input), proposal = decodeArtifact('proposal', inputs.proposal), sandbox = decodeArtifact('sandbox', inputs.sandbox), cohort = decodeCohortManifest(inputs.cohort);
  if (!['public', 'private'].includes(inputs.visibility)) invalid('visibility');
  validatePricing(inputs.pricing);
  const candidateSha = proposal.candidateSha ?? sandbox.candidateSha;
  const result: MeasurementArtifact = { schemaVersion: 1, kind: 'measurement', provenance: structuredClone(input.provenance), candidateSha, patchHash: proposal.patchHash, proposalDigest: jsonDigest(proposal), sandboxDigest: jsonDigest(sandbox), cohortDigest: jsonDigest(cohort), status: 'rejected', samples: structuredClone(inputs.samples), baselineMinutes: 0, candidateMinutes: 0, baselineMedianMs: 0, candidateMedianMs: 0, maximumQueueMs: 0, maximumEndToEndMs: 0, limits: [], claimLevel: 'none', githubListSavingUsd: 0 };
  // The artifact decoder checks each sample's full schema, quality counters and exact timestamp arithmetic.
  decodeArtifact('measurement', result);
  const errors = new Set<string>(); const reject = (condition: boolean, reason: string) => { if (condition) errors.add(reason); };
  const provenanceDigest = jsonDigest(input.provenance);
  reject([proposal.provenance, sandbox.provenance, cohort.provenance].some(provenance => jsonDigest(provenance) !== provenanceDigest), 'provenance-drift');
  reject(input.status !== 'collected' || proposal.status !== 'proposed' || sandbox.status !== 'sandbox-verified', 'stage-not-supported');
  reject(sandbox.proposalDigest !== result.proposalDigest || cohort.proposalDigest !== result.proposalDigest || cohort.sandboxDigest !== result.sandboxDigest || sandbox.candidateSha !== candidateSha || cohort.candidateSha !== candidateSha || sandbox.patchHash !== proposal.patchHash, 'artifact-binding-drift');
  reject(proposal.beforeStructuralDigest !== proposal.afterStructuralDigest, 'workflow-contract-drift');
  reject(!input.operations.some(operation => canonicalJson(operation) === canonicalJson(proposal.operation)), 'operation-not-collected');
  reject(result.samples.length !== 6 || result.samples.some((sample, index) => { const entry = cohort.entries[index]; return !entry || sample.role !== entry.role || sample.runId !== entry.runId || sample.attempt !== entry.attempt; }), 'cohort-membership-drift');
  const profile = proposal.verificationProfile;
  const commandDigest = jsonDigest([['pnpm', 'install', '--frozen-lockfile'], ...profile.commands]);
  const coveragePaths = canonicalJson([...profile.sourcePaths].sort());
  const qualities = [sandbox.baseQuality, sandbox.candidateQuality, ...result.samples.map(sample => sample.quality)];
  const expectedQuality = sandbox.baseQuality ? normalizedQuality(sandbox.baseQuality) : null;
  reject(qualities.some(quality => !quality || !quality.tests.length || !quality.coverage.length || quality.tests.some(test => test.outcome === 'failed') || quality.commandDigest !== commandDigest || canonicalJson(quality.coverage.map(file => file.path).sort()) !== coveragePaths || normalizedQuality(quality) !== expectedQuality), 'quality-drift');
  const requiredChecks = canonicalJson([...input.requiredChecks].sort());
  for (const sample of result.samples) {
    reject(sample.headSha !== (sample.role === 'base' ? input.provenance.baseSha : candidateSha) || sample.sourceTreeDigest !== input.provenance.sourceTreeDigest || sample.lockfileHash !== input.provenance.lockfileHash || sample.workflowContractDigest !== proposal.beforeStructuralDigest, 'sample-source-drift');
    reject(sample.nodeVersion !== profile.nodeVersion || sample.pnpmVersion !== profile.pnpmVersion || sample.runnerOs !== cohort.runner.os || sample.runnerArchitecture !== cohort.runner.architecture || sample.runnerImage !== cohort.runner.image, 'sample-runtime-drift');
    reject(sample.conclusion !== 'success', 'sample-failed');
    reject(!input.requiredChecks.length || sample.requiredChecks.some(check => check.conclusion !== 'success') || canonicalJson(sample.requiredChecks.map(check => check.name).sort()) !== requiredChecks, 'required-checks-incomplete');
    const minutes = billableMinutesForJob({ name: input.provenance.jobId, startedAt: sample.startedAt, completedAt: sample.completedAt });
    reject(minutes === null || minutes !== sample.roundedMinutes || sample.elapsedMs === 0 || sample.endToEndMs < sample.elapsedMs + sample.queueMs, 'sample-timing-incomplete');
    if (sample.role === 'base') result.baselineMinutes += minutes ?? 0; else result.candidateMinutes += minutes ?? 0;
    reject(sample.cacheObservation === 'unknown' || (sample.role === 'candidate' && sample.cacheObservation === 'not-applicable'), 'cache-observation-incomplete');
    result.maximumQueueMs = Math.max(result.maximumQueueMs, sample.queueMs); result.maximumEndToEndMs = Math.max(result.maximumEndToEndMs, sample.endToEndMs);
  }
  const candidates = result.samples.filter(sample => sample.role === 'candidate');
  reject(candidates.some((sample, index) => index > 0 && Date.parse(sample.startedAt) <= Date.parse(candidates[index - 1]!.startedAt)), 'candidate-chronology-invalid');
  reject(result.samples.find(sample => sample.role === 'candidate')?.cacheObservation !== 'cold', 'cold-candidate-missing');
  result.baselineMedianMs = median(result.samples.filter(sample => sample.role === 'base').map(sample => sample.elapsedMs));
  result.candidateMedianMs = median(result.samples.filter(sample => sample.role === 'candidate').map(sample => sample.elapsedMs));
  if (!Number.isSafeInteger(result.baselineMinutes) || !Number.isSafeInteger(result.candidateMinutes)) invalid('minute-total');
  const improved = result.baselineMinutes - result.candidateMinutes >= 1 && result.candidateMedianMs <= result.baselineMedianMs * 0.9;
  result.status = errors.size ? 'rejected' : improved ? 'measured-improvement' : 'no-improvement';
  result.claimLevel = result.status === 'measured-improvement' ? 'sample-execution-only' : 'none';
  result.limits = ['sample-execution-only', 'cold-candidate-required', 'list-price-estimate-not-invoice', 'provider-inference-costs-not-netted'];
  if (result.samples.find(sample => sample.role === 'candidate')?.cacheObservation === 'cold') result.limits.push('cold-candidate-included');
  if (inputs.visibility === 'public') result.limits.push('public-github-list-saving-zero');
  else if (inputs.pricing === null) result.limits.push('github-pricing-unavailable');
  else if (!inputs.pricing.allowanceKnown) result.limits.push('github-allowance-unknown');
  else if (result.status === 'measured-improvement') { result.githubListSavingUsd = (result.baselineMinutes - result.candidateMinutes) * inputs.pricing.usdPerMinute; if (!Number.isFinite(result.githubListSavingUsd)) invalid('list-estimate'); }
  result.limits.push(...errors);
  return decodeArtifact('measurement', result);
}

/** Every downstream claim recomputes the comparison; serialized lifecycle labels confer no authority. */
export function assertMeasuredEvidence(inputs: ComparisonInputs, artifact: MeasurementArtifact): void {
  decodeArtifact('measurement', artifact);
  if (canonicalJson(compareMeasurement(inputs)) !== canonicalJson(artifact)) throw new OptimizationInputError('Measurement evidence does not match the complete authorized comparison');
}
