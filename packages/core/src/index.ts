export const VERSION = '0.0.1';

export {
  BillingInputError,
  GITHUB_HOSTED_LINUX_USD_PER_MINUTE,
  billableMinutesForJob,
  estimateCostUsd,
  parseGithubJobs,
  rankWorkflowUsage,
  summarizeBillableMinutes,
} from './billing.js';
export type {
  BillableSummary,
  JobTiming,
  WorkflowUsage,
  WorkflowUsageInput,
} from './billing.js';

export {
  canonicalJson,
  gitBlobSha,
  jsonDigest,
  OptimizationInputError,
  parseStrictJson,
  safeRelativePath,
  sha256,
} from './optimization/canonical.js';
export {
  assertSameProvenance,
  decodeActionReceipt,
  decodeArtifact,
  decodeProvenance,
  decodeQualityEvidence,
  decodeSourceManifest,
  decodeVerificationProfile,
  validateDiagnosisEvidence,
} from './optimization/contracts.js';
export type {
  ActionReceipt,
  ArtifactKind,
  ArtifactMap,
  BaselineJob,
  CacheOperation,
  CoverageCounters,
  DiagnosisArtifact,
  InferenceArtifact,
  InputArtifact,
  LifecycleStatus,
  MeasurementArtifact,
  MeasurementSample,
  ProposalArtifact,
  Provenance,
  PublicationArtifact,
  QualityEvidence,
  ReportArtifact,
  SandboxArtifact,
  SandboxOperation,
  SourceManifest,
  TestOutcome,
  VerificationProfile,
} from './optimization/contracts.js';
export {
  artifactFamily,
  assertSamePushProvenance,
  decodeFamilyArtifact,
  decodePushArtifact,
  decodePushProvenance,
  decodePushSourceManifest,
  isLiteralBranch,
  isLiteralWorkflowPath,
  isTopLevelWorkflowPath,
  pushSourceText,
  PUSH_FAMILY,
  validatePushDiagnosisEvidence,
} from './optimization/push-contracts.js';
export type {
  OptimizationFamily,
  PushArtifactMap,
  PushDiagnosisArtifact,
  PushHistoryEntry,
  PushInferenceArtifact,
  PushInputArtifact,
  PushMeasurementArtifact,
  PushMeasurementSample,
  PushOperation,
  PushProposalArtifact,
  PushProvenance,
  PushSandboxArtifact,
  PushSourceManifest,
} from './optimization/push-contracts.js';
export { createPushInput, summarizePushHistory } from './optimization/push-input.js';
export type { PushHistorySummary, PushInputOptions } from './optimization/push-input.js';
export { CLASSIFIER_JOB_ID } from './optimization/push-guard.js';
export { MAX_PUSH_HISTORY } from './optimization/push-contracts.js';
export { CLASSIFIER_DIGEST, CLASSIFIER_SOURCE, classifyPush, runClassifierStep } from './optimization/push-classifier.js';
export type { ClassifierGet, ClassifierResponse, PushClassification, PushClassifierContext } from './optimization/push-classifier.js';
export { inspectPushWorkflow } from './optimization/push-workflow.js';
export type { PushWorkflowEligibility, PushWorkflowEvidence } from './optimization/push-workflow.js';
export { inspectWorkflow, parseWorkflowSource, protectedWorkflowDigest } from './optimization/workflow.js';
export type { WorkflowEligibility, WorkflowEvidence } from './optimization/workflow.js';
export { createPnpmCachePatch, validateCacheOnlyChange } from './optimization/patch.js';
export type { PnpmCachePatch, WorkflowInspectionOptions } from './optimization/patch.js';
export { compareMeasurement, assertMeasuredEvidence, decodeCohortManifest } from './optimization/measurement.js';
export type { ComparisonInputs, CohortManifest, GitHubPricing } from './optimization/measurement.js';
export { renderOptimizationReport } from './optimization/report.js';
export type { ReportRenderInputs } from './optimization/report.js';
export { normalizeQualityReports } from './optimization/quality-reporter.js';
