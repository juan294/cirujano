import { canonicalJson, gitBlobSha, OptimizationInputError, sha256 } from './canonical.js';
import { array, bool, candidate, checkInference, checkPublication, checkReport, decodeArtifact, digest, fail, id, imageValidator, inferenceFields, integer, literal, nullable, number, object, path, publicationFields, record, repo, reportFields, sandboxOperation, sha, sourceBytes, structuralFacts, text, timestamp, uniqueStrings, usageValidator, validateTiming } from './contracts.js';
import type { ArtifactKind, ArtifactMap, Validator, InferenceArtifact, PublicationArtifact, ReportArtifact, SandboxOperation } from './contracts.js';
import { CLASSIFIER_JOB_ID, isGuardedJobSet } from './push-guard.js';

/**
 * Contracts for the skip-validated-push family. Cache artifacts carry no `family` field and decode
 * through `decodeArtifact` unchanged; push artifacts carry `family: 'skip-validated-push'`.
 */
export type OptimizationFamily = 'pnpm-cache' | 'skip-validated-push';
export const PUSH_FAMILY = 'skip-validated-push';
export const MAX_PUSH_HISTORY = 30;

export interface PushProvenance {
  repositoryId: number; repository: string; baseSha: string; workflowBlobSha: string; workflowPath: string; workflowHash: string;
  integrationBranch: string; guardedJobIds: string[]; classifierDigest: string; verificationProfileHash: string; toolSourceSha: string; bundleDigest: string;
}
export interface PushOperation { type: 'skip-validated-push'; integrationBranch: string; guardedJobIds: string[]; classifierJobId: typeof CLASSIFIER_JOB_ID }
export interface PushHistoryEntry { pushRunId: number; attempt: number; headSha: string; billedMinutes: number; jobsBilled: number; prNumber: number | null; validated: boolean; reasonCode: string }
export interface PushMeasurementSample {
  role: 'baseline' | 'candidate' | 'control'; pushRunId: number; attempt: number; headSha: string; prNumber: number | null; prRunId: number | null;
  billedMinutes: number; classifierMinutes: number; validated: boolean;
  guardedJobs: { jobId: string; conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' }[]; prJobs: { name: string; conclusion: string }[];
}
interface PushBase<K extends ArtifactKind> { schemaVersion: 1; kind: K; family: typeof PUSH_FAMILY; provenance: PushProvenance }
interface PushCandidate { candidateSha: string; patchHash: string }
export interface PushInputArtifact extends PushBase<'input'> { status: 'collected' | 'no-change' | 'unsupported'; history: PushHistoryEntry[]; structuralFacts: Record<string, string | number | boolean | null>; evidence: Record<string, string>; operations: PushOperation[] }
export interface PushDiagnosisArtifact extends PushBase<'diagnosis'> { status: 'proposal' | 'abstain'; reason: string; uncertainty: string; evidenceIds: string[]; operation: PushOperation | null; promptVersion: string; schemaVersionId: string; inferenceReceiptDigest: string }
export type PushInferenceArtifact = Omit<InferenceArtifact, 'provenance'> & PushBase<'inference'>;
export interface PushProposalArtifact extends PushBase<'proposal'> { status: 'proposed' | 'no-change' | 'rejected'; operation: PushOperation; candidateSha: string | null; candidateWorkflowHash: string; patchHash: string; beforeStructuralDigest: string; afterStructuralDigest: string; permittedDiff: { classifierJobId: typeof CLASSIFIER_JOB_ID; guardedJobIds: string[] }; preconditions: string[]; diagnosisDigest: string }
export interface PushSandboxArtifact extends PushBase<'sandbox'>, PushCandidate {
  proposalDigest: string; status: 'sandbox-verified' | 'failed' | 'outcome-unknown'; image: { uuid: string; digest: string; recipeHash: string; manifestHash: string };
  operations: (Omit<SandboxOperation, 'role'> & { role: 'verifier' })[]; networkEnabled: false; matrixCells: number; mismatches: number; firstMismatch: string | null;
  classifierCases: number; classifierDigest: string; fixtureDigest: string; startedAt: string; completedAt: string | null; elapsedMs: number | null;
  usage: { value: number; unit: string; currency: string | null } | null; truncated: boolean; cleanupState: 'disposable-confirmed' | 'pending' | 'unknown'; retainedImage: true;
}
export interface PushMeasurementArtifact extends PushBase<'measurement'>, PushCandidate {
  proposalDigest: string; sandboxDigest: string; cohortDigest: string; status: 'measured-improvement' | 'no-improvement' | 'rejected'; pushes: PushMeasurementSample[];
  baselineMedianMinutes: number; classifierOverheadMinutes: number; modeled: { pushes: number; validatedPushes: number; projectedSavedMinutes: number; projectedOverheadMinutes: number };
  limits: string[]; claimLevel: 'sample-execution-only' | 'none'; githubListSavingUsd: number;
}
export type PushReportArtifact = Omit<ReportArtifact, 'provenance'> & PushBase<'report'>;
export type PushPublicationArtifact = Omit<PublicationArtifact, 'provenance'> & PushBase<'publication'>;
export interface PushArtifactMap { input: PushInputArtifact; diagnosis: PushDiagnosisArtifact; inference: PushInferenceArtifact; proposal: PushProposalArtifact; sandbox: PushSandboxArtifact; measurement: PushMeasurementArtifact; report: PushReportArtifact; publication: PushPublicationArtifact }

/** Sorted, unique and never the classifier; may be empty only in the provenance of a refused input. */
const jobId: Validator = (v, p) => { if (!isGuardedJobSet([v])) fail(p); };
const jobIdSet: Validator = (v, p) => { array(jobId)(v, p); if (!isGuardedJobSet(v as string[])) fail(p); };
/** One literal branch name: no glob, negation, empty segment, `..` or `@{`, as `git check-ref-format` requires. */
export function isLiteralBranch(value: unknown): value is string { return typeof value === 'string' && value.length <= 255 && /^[A-Za-z0-9._/-]+$/.test(value) && !/^[-/.]|[/.]$|\/\/|\.\.|\/\.|\.lock(?:\/|$)/.test(value); }
const branch: Validator = (v, p) => { if (!isLiteralBranch(v)) fail(p); };
const reasonCode: Validator = (v, p) => { if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v)) fail(p); };
const guardedJobIds: Validator = (v, p) => { jobIdSet(v, p); if (!(v as string[]).length) fail(p); };
const provenanceValidator = object({ repositoryId: id, repository: repo, baseSha: sha, workflowBlobSha: sha, workflowPath: path, workflowHash: digest, integrationBranch: branch, guardedJobIds: jobIdSet, classifierDigest: digest, verificationProfileHash: digest, toolSourceSha: sha, bundleDigest: digest });
const operationValidator = object({ type: literal(PUSH_FAMILY), integrationBranch: branch, guardedJobIds, classifierJobId: literal(CLASSIFIER_JOB_ID) });
const historyValidator = object({ pushRunId: id, attempt: id, headSha: sha, billedMinutes: integer, jobsBilled: integer, prNumber: nullable(id), validated: bool, reasonCode });
const conclusion = literal('success', 'failure', 'cancelled', 'skipped');
const sampleValidator = object({ role: literal('baseline', 'candidate', 'control'), pushRunId: id, attempt: id, headSha: sha, prNumber: nullable(id), prRunId: nullable(id), billedMinutes: integer, classifierMinutes: integer, validated: bool, guardedJobs: array(object({ jobId, conclusion }), 'jobId'), prJobs: array(object({ name: text, conclusion: text }), 'name') });
const base = (kind: ArtifactKind) => ({ schemaVersion: literal(1), kind: literal(kind), family: literal(PUSH_FAMILY), provenance: provenanceValidator });
const validators: Record<ArtifactKind, Validator> = {
  input: object({ ...base('input'), status: literal('collected', 'no-change', 'unsupported'), history: array(historyValidator), structuralFacts, evidence: record(text), operations: array(operationValidator) }),
  diagnosis: object({ ...base('diagnosis'), status: literal('proposal', 'abstain'), reason: text, uncertainty: text, evidenceIds: uniqueStrings, operation: nullable(operationValidator), promptVersion: text, schemaVersionId: text, inferenceReceiptDigest: digest }),
  inference: object({ ...base('inference'), ...inferenceFields }),
  proposal: object({ ...base('proposal'), ...candidate, candidateSha: nullable(sha), candidateWorkflowHash: digest, status: literal('proposed', 'no-change', 'rejected'), operation: operationValidator, beforeStructuralDigest: digest, afterStructuralDigest: digest, permittedDiff: object({ classifierJobId: literal(CLASSIFIER_JOB_ID), guardedJobIds }), preconditions: uniqueStrings, diagnosisDigest: digest }),
  sandbox: object({ ...base('sandbox'), ...candidate, proposalDigest: digest, status: literal('sandbox-verified', 'failed', 'outcome-unknown'), image: imageValidator, operations: array(sandboxOperation(literal('verifier')), 'id'), networkEnabled: literal(false), matrixCells: integer, mismatches: integer, firstMismatch: nullable(text), classifierCases: integer, classifierDigest: digest, fixtureDigest: digest, startedAt: timestamp, completedAt: nullable(timestamp), elapsedMs: nullable(number), usage: usageValidator, truncated: bool, cleanupState: literal('disposable-confirmed', 'pending', 'unknown'), retainedImage: literal(true) }),
  measurement: object({ ...base('measurement'), ...candidate, proposalDigest: digest, sandboxDigest: digest, cohortDigest: digest, status: literal('measured-improvement', 'no-improvement', 'rejected'), pushes: array(sampleValidator), baselineMedianMinutes: number, classifierOverheadMinutes: integer, modeled: object({ pushes: integer, validatedPushes: integer, projectedSavedMinutes: number, projectedOverheadMinutes: number }), limits: uniqueStrings, claimLevel: literal('sample-execution-only', 'none'), githubListSavingUsd: number }),
  report: object({ ...base('report'), ...reportFields }),
  publication: object({ ...base('publication'), ...publicationFields }),
};

export function decodePushProvenance(value: unknown): PushProvenance { canonicalJson(value); provenanceValidator(value, 'provenance'); return value as PushProvenance; }
function targetsProvenance(operation: PushOperation | { guardedJobIds: string[] }, provenance: PushProvenance): boolean {
  return ('integrationBranch' in operation ? operation.integrationBranch === provenance.integrationBranch : true) && canonicalJson(operation.guardedJobIds) === canonicalJson(provenance.guardedJobIds);
}
function uniqueAttempts(rows: { pushRunId: number; attempt: number }[], field: string): void {
  const seen = new Set<string>();
  for (const row of rows) { const key = `${row.pushRunId}:${row.attempt}`; if (seen.has(key)) fail(field); seen.add(key); }
}
function checkSandbox(artifact: PushSandboxArtifact): void {
  if ((artifact.mismatches === 0) !== (artifact.firstMismatch === null)) fail('sandbox.firstMismatch');
  if (artifact.status !== 'sandbox-verified') return;
  const [operation] = artifact.operations;
  if (artifact.operations.length !== 1 || !operation || operation.status !== 'SUCCESS' || operation.exitCode !== 0 || operation.signal || operation.timedOut || operation.truncated || artifact.mismatches !== 0 || artifact.matrixCells === 0 || artifact.classifierCases === 0 || artifact.classifierDigest !== artifact.provenance.classifierDigest || artifact.truncated || artifact.cleanupState !== 'disposable-confirmed' || !artifact.completedAt || artifact.elapsedMs === null) fail('sandbox.verified');
  validateTiming(artifact.startedAt, artifact.completedAt, artifact.elapsedMs);
}
function checkMeasurement(artifact: PushMeasurementArtifact): void {
  uniqueAttempts(artifact.pushes, 'measurement.duplicate');
  if (artifact.modeled.validatedPushes > artifact.modeled.pushes) fail('measurement.modeled');
  for (const sample of artifact.pushes) if ((sample.role === 'control') !== (sample.prNumber === null) || (sample.prNumber === null) !== (sample.prRunId === null)) fail('measurement.pushes.pullRequest');
  // `prJobs` lists the PR run's jobs without the classifier, which a pull_request run reports as skipped.
  if (artifact.pushes.some(sample => sample.prJobs.some(job => job.name === CLASSIFIER_JOB_ID))) fail('measurement.pushes.prJobs');
  if (artifact.status !== 'measured-improvement') return;
  const role = (name: PushMeasurementSample['role']) => artifact.pushes.filter(sample => sample.role === name);
  const guarded = (sample: PushMeasurementSample, expected: string) => canonicalJson(sample.guardedJobs.map(job => job.jobId).sort()) === canonicalJson(artifact.provenance.guardedJobIds) && sample.guardedJobs.every(job => job.conclusion === expected);
  const baselines = role('baseline'), candidates = role('candidate'), controls = role('control');
  if (artifact.claimLevel !== 'sample-execution-only' || baselines.length !== 3 || candidates.length !== 3 || controls.length !== 1) fail('measurement.cohort');
  if (baselines.some(sample => !guarded(sample, 'success')) || candidates.some(sample => !sample.validated || !guarded(sample, 'skipped')) || controls.some(sample => sample.validated || !guarded(sample, 'success'))) fail('measurement.gate');
  const median = baselines.map(sample => sample.billedMinutes).sort((a, b) => a - b)[1]!;
  if (artifact.baselineMedianMinutes !== median || candidates.some(sample => sample.billedMinutes > median - 1)) fail('measurement.saving');
  if (artifact.classifierOverheadMinutes !== controls[0]!.classifierMinutes) fail('measurement.overhead');
  const prJobs = (sample: PushMeasurementSample) => canonicalJson([...sample.prJobs].sort((a, b) => a.name < b.name ? -1 : 1));
  if ([...baselines, ...candidates].some(sample => prJobs(sample) !== prJobs(baselines[0]!)) || baselines[0]!.prJobs.length === 0 || baselines[0]!.prJobs.some(job => job.conclusion !== 'success')) fail('measurement.coverage');
}

export function decodePushArtifact<K extends ArtifactKind>(kind: K, value: unknown): PushArtifactMap[K] {
  canonicalJson(value); validators[kind](value, kind);
  const artifact = value as PushArtifactMap[ArtifactKind];
  if (!artifact.provenance.guardedJobIds.length && !(artifact.kind === 'input' && artifact.status !== 'collected')) fail(`${kind}.provenance.guardedJobIds`);
  if ('operation' in artifact && artifact.operation !== null && !targetsProvenance(artifact.operation, artifact.provenance)) fail(`${kind}.operation.target`);
  switch (artifact.kind) {
    case 'input':
      if (artifact.operations.some(operation => !targetsProvenance(operation, artifact.provenance))) fail('input.operation.target');
      if (artifact.history.length > MAX_PUSH_HISTORY || artifact.history.some(entry => entry.validated && entry.prNumber === null)) fail('input.history');
      uniqueAttempts(artifact.history, 'input.history.duplicate');
      if (artifact.status === 'collected' ? !artifact.history.length || !Object.keys(artifact.evidence).length || artifact.operations.length !== 1 : artifact.operations.length !== 0) fail('input.collected.prerequisites');
      break;
    case 'diagnosis': if ((artifact.status === 'proposal') !== (artifact.operation !== null) || (artifact.status === 'proposal' && !artifact.evidenceIds.length)) fail('diagnosis.operation/status'); break;
    case 'inference': checkInference(artifact); break;
    case 'proposal': if (!targetsProvenance(artifact.permittedDiff, artifact.provenance)) fail('proposal.permittedDiff'); break;
    case 'sandbox': checkSandbox(artifact); break;
    case 'measurement': checkMeasurement(artifact); break;
    case 'report': checkReport(artifact); break;
    case 'publication': checkPublication(artifact); break;
  }
  return artifact as PushArtifactMap[K];
}

/** Artifacts without a `family` field are cache artifacts; cache artifacts never carry `family`, so an explicit `'pnpm-cache'` value is rejected. */
export function artifactFamily(value: unknown): OptimizationFamily {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'family')) return 'pnpm-cache';
  if ((value as { family: unknown }).family !== PUSH_FAMILY) throw new OptimizationInputError('Unknown optimization family');
  return PUSH_FAMILY;
}
export function decodeFamilyArtifact<K extends ArtifactKind>(kind: K, value: unknown): ArtifactMap[K] | PushArtifactMap[K] {
  return artifactFamily(value) === PUSH_FAMILY ? decodePushArtifact(kind, value) : decodeArtifact(kind, value);
}
export function assertSamePushProvenance(left: PushProvenance, right: PushProvenance): void { if (canonicalJson(decodePushProvenance(left)) !== canonicalJson(decodePushProvenance(right))) throw new OptimizationInputError('Immutable provenance drift; recollect input'); }
export function validatePushDiagnosisEvidence(diagnosis: PushDiagnosisArtifact, input: PushInputArtifact): void {
  assertSamePushProvenance(diagnosis.provenance, input.provenance);
  if (diagnosis.evidenceIds.some(evidenceId => !Object.hasOwn(input.evidence, evidenceId))) fail('diagnosis.evidenceIds.unknown');
  if (diagnosis.operation && !input.operations.some(operation => canonicalJson(operation) === canonicalJson(diagnosis.operation))) fail('diagnosis.operation.unsupported');
}

/** The retained bytes a push input was derived from: every top-level workflow file and the verification profile. */
export interface PushSourceManifest { schemaVersion: 1; kind: 'push-source'; family: typeof PUSH_FAMILY; provenance: PushProvenance; profilePath: string; files: { path: string; mode: '100644' | '100755'; hash: string; bytesBase64: string }[] }
/** A workflow GitHub would run: a `.yml` or `.yaml` file directly under `.github/workflows/`. */
export function isTopLevelWorkflowPath(path: string): boolean { return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path); }
/** A workflow path an operator may name: top level, with a plain file name. */
export function isLiteralWorkflowPath(path: string): boolean { return /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(path); }
/** The retained file's text, decoded strictly as UTF-8. */
export function pushSourceText(file: PushSourceManifest['files'][number]): string { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(file.bytesBase64, 'base64')); }
export function decodePushSourceManifest(value: unknown): PushSourceManifest {
  canonicalJson(value);
  object({ schemaVersion: literal(1), kind: literal('push-source'), family: literal(PUSH_FAMILY), provenance: provenanceValidator, profilePath: path, files: array(object({ path, mode: literal('100644', '100755'), hash: digest, bytesBase64: sourceBytes }), 'path') })(value, 'pushSource');
  const manifest = value as PushSourceManifest;
  if (manifest.files.length > 500 || manifest.files.some((file, index) => index > 0 && manifest.files[index - 1]!.path >= file.path)) fail('pushSource.files.order');
  let totalBytes = 0;
  for (const file of manifest.files) {
    const bytes = Buffer.from(file.bytesBase64, 'base64'); totalBytes += bytes.length;
    if (file.path !== manifest.profilePath && !isTopLevelWorkflowPath(file.path)) fail('pushSource.file.scope');
    if (bytes.length > 4 * 1024 * 1024 || totalBytes > 16 * 1024 * 1024 || bytes.toString('base64') !== file.bytesBase64 || sha256(bytes) !== file.hash) fail('pushSource.file.hash');
  }
  const workflow = manifest.files.find(file => file.path === manifest.provenance.workflowPath), profile = manifest.files.find(file => file.path === manifest.profilePath);
  if (!workflow || workflow.hash !== manifest.provenance.workflowHash || gitBlobSha(Buffer.from(workflow.bytesBase64, 'base64')) !== manifest.provenance.workflowBlobSha || !profile || profile.hash !== manifest.provenance.verificationProfileHash) fail('pushSource.provenance');
  return manifest;
}
