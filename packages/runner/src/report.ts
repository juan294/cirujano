import { RUNNER_SCHEMA_VERSION, type RunnerCostEstimate, type VmStatus } from './contracts.js';

export type ScenarioStatus = 'passed' | 'failed' | 'skipped';

export interface ScenarioCheck {
  scenario: string;
  status: ScenarioStatus;
  candidateDigest: string;
  evidence: readonly string[];
}

export interface AssignmentEvidence {
  runId: number;
  runAttempt: number;
  jobId: number;
  runnerId: number;
  runnerName: string;
  conclusion: string;
}

export interface CleanupReadback {
  complete: boolean;
  vmState: VmStatus;
  ownedRunnersRemaining: number | null;
  diskPresent: boolean | null;
  unresolvedResources: readonly string[];
}

export interface RunnerReportInput {
  candidateDigest: string;
  expectedCandidateDigest: string;
  requiredScenarios: readonly string[];
  checks: readonly ScenarioCheck[];
  assignments: readonly AssignmentEvidence[];
  cleanup: CleanupReadback | null;
  finalProviderState: VmStatus;
  cost: RunnerCostEstimate;
  diagnostics?: readonly string[];
  sensitiveValues?: readonly string[];
}

export interface RunnerReport {
  schemaVersion: typeof RUNNER_SCHEMA_VERSION;
  complete: boolean;
  reasons: string[];
  candidateDigest: string;
  checks: ScenarioCheck[];
  assignments: AssignmentEvidence[];
  cleanup: CleanupReadback | null;
  finalProviderState: VmStatus;
  cost: RunnerCostEstimate;
  diagnostics: string[];
}

export function buildRunnerReport(input: RunnerReportInput): RunnerReport {
  const sanitize = createSanitizer(input.sensitiveValues ?? []);
  const checks = input.checks.map((check) => ({
    ...check,
    evidence: check.evidence.map(sanitize),
  }));
  const assignments = input.assignments.map((assignment) => ({
    ...assignment,
    runnerName: sanitize(assignment.runnerName),
    conclusion: sanitize(assignment.conclusion),
  }));
  const cleanup = input.cleanup === null ? null : {
    ...input.cleanup,
    unresolvedResources: input.cleanup.unresolvedResources.map(sanitize),
  };
  const cost = sanitizeCost(input.cost, sanitize);
  const reasons = completenessReasons(input, checks, cleanup, cost);

  return {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    complete: reasons.length === 0,
    reasons,
    candidateDigest: input.candidateDigest,
    checks,
    assignments,
    cleanup,
    finalProviderState: input.finalProviderState,
    cost,
    diagnostics: (input.diagnostics ?? []).map(sanitize),
  };
}

function completenessReasons(
  input: RunnerReportInput,
  checks: readonly ScenarioCheck[],
  cleanup: CleanupReadback | null,
  cost: RunnerCostEstimate,
): string[] {
  const reasons: string[] = [];
  if (input.candidateDigest !== input.expectedCandidateDigest) {
    reasons.push('candidate digest does not match the expected candidate');
  }
  if (!checks.some((check) => check.status === 'passed')) reasons.push('report has zero passing checks');

  for (const scenario of new Set(input.requiredScenarios)) {
    const results = checks.filter((check) => check.scenario === scenario);
    if (results.length === 0) {
      reasons.push(`required scenario ${scenario} is missing`);
      continue;
    }
    if (results.length > 1) reasons.push(`required scenario ${scenario} has duplicate results`);
    if (results.some((result) => result.candidateDigest !== input.candidateDigest)) {
      reasons.push(`required scenario ${scenario} has a mismatched candidate`);
    }
    const selected = results.find((result) => result.candidateDigest === input.candidateDigest) ?? results[0]!;
    if (selected.status !== 'passed') reasons.push(`required scenario ${scenario} is ${selected.status}`);
    if (selected.evidence.length === 0) reasons.push(`required scenario ${scenario} has no evidence`);
  }

  if (cleanup === null) {
    reasons.push('cleanup readback is missing');
  } else {
    if (!cleanup.complete) reasons.push('cleanup readback is incomplete');
    if (cleanup.ownedRunnersRemaining === null) reasons.push('owned runner cleanup is unknown');
    else if (cleanup.ownedRunnersRemaining !== 0) reasons.push('cleanup left owned runners');
    if (cleanup.diskPresent === null) reasons.push('owned disk cleanup is unknown');
    else if (cleanup.diskPresent) reasons.push('cleanup left an owned disk');
    if (cleanup.unresolvedResources.length > 0) reasons.push('cleanup has unresolved resources');
    if (cleanup.vmState !== input.finalProviderState) reasons.push('cleanup readback does not match final provider state');
  }

  if (input.finalProviderState === 'unknown') reasons.push('final provider state is unknown');
  else if (input.finalProviderState !== 'absent' && input.finalProviderState !== 'stopped') {
    reasons.push(`final provider state ${input.finalProviderState} is not terminal`);
  }

  if (!cost.complete) reasons.push(`cost evidence is incomplete: ${cost.reason}`);
  else if (!validCompleteCost(cost)) reasons.push('cost estimate contains invalid values');
  else if (cost.runnerTotalUsd === 0) reasons.push('cost estimate must not silently report a zero total');
  return reasons;
}

function validCompleteCost(cost: Extract<RunnerCostEstimate, { complete: true }>): boolean {
  return [cost.computeUsd, cost.diskUsd, cost.networkUsd, cost.runnerTotalUsd, cost.hostedBaselineUsd]
    .every((value) => Number.isFinite(value) && value >= 0)
    && cost.currency.trim().length > 0;
}

function sanitizeCost(cost: RunnerCostEstimate, sanitize: (value: string) => string): RunnerCostEstimate {
  return cost.complete ? { ...cost, currency: sanitize(cost.currency) } : { complete: false, reason: sanitize(cost.reason) };
}

function createSanitizer(sensitiveValues: readonly string[]): (value: string) => string {
  const secrets = [...new Set(sensitiveValues.filter((value) => value.length > 0))]
    .sort((left, right) => right.length - left.length);
  return (input: string): string => {
    let output = input;
    for (const secret of secrets) output = output.replaceAll(secret, '[REDACTED]');
    output = output.replace(/\b(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]');
    output = output.replace(/\b(token|secret|password|credential|private[_-]?key)(\s*[=:]\s*)[^\s]+/gi, '$1$2[REDACTED]');
    return output;
  };
}
