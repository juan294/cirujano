import { RUNNER_SCHEMA_VERSION, type RunnerCostEstimate, type VmStatus } from './contracts.js';

export type ScenarioStatus = 'passed' | 'failed' | 'skipped';

export const PHASE_3_REQUIRED_SCENARIOS = ['R10', 'R11', 'R12', 'R13'] as const;

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

const VM_STATUSES: readonly VmStatus[] = ['absent', 'stopped', 'starting', 'running', 'stopping', 'error', 'unknown'];

export function parseRunnerReportInput(input: unknown): RunnerReportInput {
  const value = strictRecord(input, [
    'candidateDigest', 'expectedCandidateDigest', 'requiredScenarios', 'checks', 'assignments',
    'cleanup', 'finalProviderState', 'cost', 'diagnostics', 'sensitiveValues',
  ], 'runner report input');
  const candidateDigest = nonemptyText(value.candidateDigest, 'candidateDigest');
  const expectedCandidateDigest = nonemptyText(value.expectedCandidateDigest, 'expectedCandidateDigest');
  stringList(value.requiredScenarios, 'requiredScenarios', true);
  if (!Array.isArray(value.checks)) throw new Error('checks must be an array');
  const checks = value.checks.map((entry, index): ScenarioCheck => {
    const check = strictRecord(entry, ['scenario', 'status', 'candidateDigest', 'evidence'], `checks[${index}]`);
    if (check.status !== 'passed' && check.status !== 'failed' && check.status !== 'skipped') {
      throw new Error(`checks[${index}].status is invalid`);
    }
    return {
      scenario: nonemptyText(check.scenario, `checks[${index}].scenario`),
      status: check.status,
      candidateDigest: nonemptyText(check.candidateDigest, `checks[${index}].candidateDigest`),
      evidence: stringList(check.evidence, `checks[${index}].evidence`, true),
    };
  });
  if (!Array.isArray(value.assignments)) throw new Error('assignments must be an array');
  const assignments = value.assignments.map((entry, index): AssignmentEvidence => {
    const assignment = strictRecord(
      entry,
      ['runId', 'runAttempt', 'jobId', 'runnerId', 'runnerName', 'conclusion'],
      `assignments[${index}]`,
    );
    return {
      runId: positiveInteger(assignment.runId, `assignments[${index}].runId`),
      runAttempt: positiveInteger(assignment.runAttempt, `assignments[${index}].runAttempt`),
      jobId: positiveInteger(assignment.jobId, `assignments[${index}].jobId`),
      runnerId: positiveInteger(assignment.runnerId, `assignments[${index}].runnerId`),
      runnerName: nonemptyText(assignment.runnerName, `assignments[${index}].runnerName`),
      conclusion: nonemptyText(assignment.conclusion, `assignments[${index}].conclusion`),
    };
  });
  if (assignments.length === 0) throw new Error('assignments must contain at least one result');
  if (hasDuplicateAssignments(assignments)) throw new Error('assignments contain duplicate evidence');

  let cleanup: CleanupReadback | null;
  if (value.cleanup === null) cleanup = null;
  else {
    const item = strictRecord(
      value.cleanup,
      ['complete', 'vmState', 'ownedRunnersRemaining', 'diskPresent', 'unresolvedResources'],
      'cleanup',
    );
    cleanup = {
      complete: booleanValue(item.complete, 'cleanup.complete'),
      vmState: vmStatus(item.vmState, 'cleanup.vmState'),
      ownedRunnersRemaining: item.ownedRunnersRemaining === null
        ? null
        : nonnegativeInteger(item.ownedRunnersRemaining, 'cleanup.ownedRunnersRemaining'),
      diskPresent: item.diskPresent === null ? null : booleanValue(item.diskPresent, 'cleanup.diskPresent'),
      unresolvedResources: stringList(item.unresolvedResources, 'cleanup.unresolvedResources', true),
    };
  }
  const cost = parseCost(value.cost);
  const parsed: RunnerReportInput = {
    candidateDigest,
    expectedCandidateDigest,
    requiredScenarios: [...PHASE_3_REQUIRED_SCENARIOS],
    checks,
    assignments,
    cleanup,
    finalProviderState: vmStatus(value.finalProviderState, 'finalProviderState'),
    cost,
  };
  if (value.diagnostics !== undefined) parsed.diagnostics = stringList(value.diagnostics, 'diagnostics', true);
  if (value.sensitiveValues !== undefined) parsed.sensitiveValues = stringList(value.sensitiveValues, 'sensitiveValues', true);
  return parsed;
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
  const reasons = completenessReasons(input, checks, assignments, cleanup, cost);

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
  assignments: readonly AssignmentEvidence[],
  cleanup: CleanupReadback | null,
  cost: RunnerCostEstimate,
): string[] {
  const reasons: string[] = [];
  if (input.candidateDigest !== input.expectedCandidateDigest) {
    reasons.push('candidate digest does not match the expected candidate');
  }
  if (!checks.some((check) => check.status === 'passed')) reasons.push('report has zero passing checks');
  if (assignments.length === 0) reasons.push('report has zero assignment evidence');
  if (assignments.some((assignment) => !validAssignment(assignment))) {
    reasons.push('assignment evidence contains invalid values');
  }
  if (hasDuplicateAssignments(assignments)) reasons.push('report has duplicate assignment evidence');

  for (const scenario of PHASE_3_REQUIRED_SCENARIOS) {
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

function validAssignment(assignment: AssignmentEvidence): boolean {
  return [assignment.runId, assignment.runAttempt, assignment.jobId, assignment.runnerId]
    .every((value) => Number.isInteger(value) && value > 0)
    && assignment.runnerName.trim().length > 0
    && assignment.conclusion.trim().length > 0;
}

function hasDuplicateAssignments(assignments: readonly AssignmentEvidence[]): boolean {
  const identities = assignments.map((assignment) => [
    assignment.runId, assignment.runAttempt, assignment.jobId,
  ].join(':'));
  return new Set(identities).size !== identities.length;
}

function parseCost(value: unknown): RunnerCostEstimate {
  const discriminator = strictRecord(value, undefined, 'cost');
  if (discriminator.complete === false) {
    const item = strictRecord(value, ['complete', 'reason'], 'cost');
    return { complete: false, reason: nonemptyText(item.reason, 'cost.reason') };
  }
  if (discriminator.complete !== true) throw new Error('cost.complete must be a boolean');
  const item = strictRecord(value, [
    'complete', 'currency', 'computeUsd', 'diskUsd', 'networkUsd', 'runnerTotalUsd', 'hostedBaselineUsd',
  ], 'cost');
  return {
    complete: true,
    currency: nonemptyText(item.currency, 'cost.currency'),
    computeUsd: nonnegativeNumber(item.computeUsd, 'cost.computeUsd'),
    diskUsd: nonnegativeNumber(item.diskUsd, 'cost.diskUsd'),
    networkUsd: nonnegativeNumber(item.networkUsd, 'cost.networkUsd'),
    runnerTotalUsd: nonnegativeNumber(item.runnerTotalUsd, 'cost.runnerTotalUsd'),
    hostedBaselineUsd: nonnegativeNumber(item.hostedBaselineUsd, 'cost.hostedBaselineUsd'),
  };
}

function strictRecord(value: unknown, allowed: readonly string[] | undefined, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const record = value as Record<string, unknown>;
  if (allowed !== undefined) {
    const unknown = Object.keys(record).find((key) => !allowed.includes(key));
    if (unknown !== undefined) throw new Error(`${name} contains unknown field ${unknown}`);
  }
  return record;
}

function nonemptyText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a nonempty string`);
  return value;
}

function stringList(value: unknown, name: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
    || !value.every((item) => typeof item === 'string' && item.trim().length > 0)) {
    throw new Error(`${name} must be an array of nonempty strings`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonnegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative integer`);
  return value;
}

function nonnegativeNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be a nonnegative number`);
  return value;
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

function vmStatus(value: unknown, name: string): VmStatus {
  if (!VM_STATUSES.includes(value as VmStatus)) throw new Error(`${name} is invalid`);
  return value as VmStatus;
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
