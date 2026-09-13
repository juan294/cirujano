import { RUNNER_SCHEMA_VERSION, type PermitOperation } from './contracts.js';

export const R14_SCENARIOS = [
  'provider-contract',
  'first-boot-failure',
  'watchdog-first',
  'queue-and-execute',
  'sequential-isolation',
  'normal-idle',
  'restart-and-failure',
  'comparison',
  'cleanup',
] as const;

export type PilotTarget = 'hosted' | 'self-hosted';
export type R14Scenario = typeof R14_SCENARIOS[number];

export interface PilotDispatch {
  id: string;
  target: PilotTarget;
  sequence: 1 | 2;
}

export interface PilotStep {
  id: string;
  run: string;
  whenSequence?: 1 | 2;
}

export interface PilotManifest {
  schemaVersion: 1;
  fixtureId: string;
  workflowFile: string;
  timeoutMinutes: 60;
  runnerLabel: string;
  hostedRunsOn: readonly string[];
  selfHostedRunsOn: readonly string[];
  dispatches: readonly PilotDispatch[];
  steps: readonly PilotStep[];
}

export interface PilotJob {
  dispatchId: string;
  target: PilotTarget;
  sequence: 1 | 2;
  candidateDigest: string;
  workflowFile: string;
  timeoutMinutes: 60;
  steps: readonly PilotStep[];
  runsOn: readonly string[];
}

export interface PilotAssertions {
  node22: boolean;
  pnpm11220: boolean;
  deterministicTests: boolean;
  dockerFixedPort: boolean;
  sentinelAbsent: boolean;
}

export interface PilotResult {
  dispatchId: string;
  target: PilotTarget;
  sequence: 1 | 2;
  candidateDigest: string;
  workflowFile: string;
  conclusion: string;
  assertions: PilotAssertions;
  runnerRegistrationId: number;
  workspaceIdentity: string;
}

export interface PilotAnalysis {
  complete: boolean;
  reasons: string[];
  dispatchCount: number;
  passedDispatches: number;
}

export type PilotQuote =
  | {
      complete: true;
      currency: string;
      quotedAt: string;
      source: string;
      computeUsdPerHour: number;
      diskUsdPerGibMonth: number;
      publicIpUsdPerHour: number;
      networkUsdPerGib: number;
      maxRetainedDiskHours: number;
      maxPublicIpHours: number;
      maxNetworkEgressGiB: number;
      estimatedMaximumUsd: number;
      includesRetainedDiskAndIp: boolean;
    }
  | { complete: false; reason: string };

export interface PilotPermitProposalInput {
  nowMs: number;
  expiresAtMs: number;
  candidateDigest: string;
  configHash: string;
  repositoryId: number;
  projectId: string;
  controllerId: string;
  resourcePrefix: string;
  maxConcurrentVms?: number;
  maxStarts: number;
  maxRuntimeMs: number;
  maxTotalCostUsd: number;
  quote: PilotQuote;
}

export interface PilotPermitProposal {
  schemaVersion: typeof RUNNER_SCHEMA_VERSION;
  approved: false;
  candidateDigest: string;
  configHash: string;
  repositoryId: number;
  projectId: string;
  controllerId: string;
  resourcePrefix: string;
  issuedAtMs: number;
  expiresAtMs: number;
  maxConcurrentVms: 1;
  maxStarts: number;
  maxRuntimeMs: number;
  maxTotalCostUsd: number;
  operations: readonly PermitOperation[];
  recoveryAllowed: true;
  resources: {
    platform: 'cpu-d3';
    preset: '4vcpu-16gb';
    vmCount: 1;
    diskCount: 1;
    diskType: 'network_ssd';
    diskSizeGiB: 80;
  };
  resourceGenerations: string[];
  quote: Extract<PilotQuote, { complete: true }>;
}

export type PilotPermitProposalResult =
  | { accepted: true; proposal: PilotPermitProposal }
  | { accepted: false; reasons: string[] };

export interface R14Row {
  scenario: R14Scenario;
  status: 'passed' | 'failed' | 'skipped' | 'not-run';
  candidateDigest: string;
  evidence: readonly string[];
}

export interface R14MatrixInput {
  candidateDigest: string;
  liveAuthorized: boolean;
  prerequisitesComplete: boolean;
  rows: readonly R14Row[];
}

export function parsePilotManifest(input: unknown): PilotManifest {
  const value = record(input, 'pilot manifest');
  if (value.schemaVersion !== 1) throw new Error('pilot manifest schemaVersion must be 1');
  const fixtureId = text(value.fixtureId, 'fixtureId');
  const workflowFile = text(value.workflowFile, 'workflowFile');
  const runnerLabel = text(value.runnerLabel, 'runnerLabel');
  if (value.timeoutMinutes !== 60) throw new Error('pilot timeout must be exactly 60 minutes');
  const hostedRunsOn = stringArray(value.hostedRunsOn, 'hostedRunsOn');
  const selfHostedRunsOn = stringArray(value.selfHostedRunsOn, 'selfHostedRunsOn');
  if (hostedRunsOn.length !== 1 || hostedRunsOn[0] !== 'ubuntu-24.04') {
    throw new Error('hosted runner selection must be ubuntu-24.04');
  }
  if (!selfHostedRunsOn.includes('self-hosted') || !selfHostedRunsOn.includes(runnerLabel)) {
    throw new Error('self-hosted runner selection must include self-hosted and the pilot label');
  }
  if (!Array.isArray(value.dispatches)) throw new Error('dispatches must be an array');
  const dispatches = value.dispatches.map((entry, index): PilotDispatch => {
    const item = record(entry, `dispatches[${index}]`);
    const target = item.target;
    const sequence = item.sequence;
    if (target !== 'hosted' && target !== 'self-hosted') throw new Error(`dispatches[${index}].target is invalid`);
    if (sequence !== 1 && sequence !== 2) throw new Error(`dispatches[${index}].sequence is invalid`);
    return { id: text(item.id, `dispatches[${index}].id`), target, sequence };
  });
  const expectedDispatches = ['hosted-1', 'hosted-2', 'self-hosted-1', 'self-hosted-2'];
  if (dispatches.length !== expectedDispatches.length
    || new Set(dispatches.map(({ id }) => id)).size !== dispatches.length
    || expectedDispatches.some((id) => !dispatches.some((dispatch) => dispatch.id === id))) {
    throw new Error('pilot manifest must contain the exact four hosted and self-hosted dispatches');
  }
  for (const target of ['hosted', 'self-hosted'] as const) {
    for (const sequence of [1, 2] as const) {
      const id = `${target}-${sequence}`;
      const dispatch = dispatches.find((entry) => entry.id === id)!;
      if (dispatch.target !== target || dispatch.sequence !== sequence) {
        throw new Error(`dispatch ${id} must select ${target} sequence ${sequence}`);
      }
    }
  }
  if (!Array.isArray(value.steps)) throw new Error('steps must be an array');
  const steps = value.steps.map((entry, index): PilotStep => {
    const item = record(entry, `steps[${index}]`);
    const whenSequence = item.whenSequence;
    if (whenSequence !== undefined && whenSequence !== 1 && whenSequence !== 2) {
      throw new Error(`steps[${index}].whenSequence is invalid`);
    }
    const step: PilotStep = { id: text(item.id, `steps[${index}].id`), run: text(item.run, `steps[${index}].run`) };
    if (whenSequence !== undefined) step.whenSequence = whenSequence;
    return step;
  });
  const requiredSteps = ['node', 'pnpm', 'deterministic-tests', 'sentinel-absent', 'docker-fixed-port', 'first-run-sentinel'];
  if (steps.length !== requiredSteps.length
    || new Set(steps.map(({ id }) => id)).size !== steps.length
    || requiredSteps.some((id) => !steps.some((step) => step.id === id))) {
    throw new Error('pilot manifest must contain every deterministic workload step exactly once');
  }
  const dockerStep = steps.find(({ id }) => id === 'docker-fixed-port')!;
  if (!dockerStep.run.includes('-p 43119:43119') || !dockerStep.run.includes('@sha256:')) {
    throw new Error('Docker fixture must use fixed port 43119 and a digest-pinned image');
  }
  const sentinelStep = steps.find(({ id }) => id === 'first-run-sentinel')!;
  if (sentinelStep.whenSequence !== 1) throw new Error('sentinel creation must run only on the first sequence');

  return {
    schemaVersion: 1,
    fixtureId,
    workflowFile,
    timeoutMinutes: 60,
    runnerLabel,
    hostedRunsOn,
    selfHostedRunsOn,
    dispatches,
    steps,
  };
}

export function exactDispatchCount(manifest: PilotManifest): number {
  return manifest.dispatches.length;
}

export function materializePilotJobs(manifest: PilotManifest, candidateDigest: string): PilotJob[] {
  if (candidateDigest.trim().length === 0) throw new Error('candidate digest is required');
  return manifest.dispatches.map((dispatch) => ({
    dispatchId: dispatch.id,
    target: dispatch.target,
    sequence: dispatch.sequence,
    candidateDigest,
    workflowFile: manifest.workflowFile,
    timeoutMinutes: manifest.timeoutMinutes,
    steps: manifest.steps,
    runsOn: dispatch.target === 'hosted' ? manifest.hostedRunsOn : manifest.selfHostedRunsOn,
  }));
}

export function renderPilotWorkflow(manifest: PilotManifest): string {
  const runnerSelection = `\${{ fromJSON(inputs.target == 'hosted' && '${JSON.stringify(manifest.hostedRunsOn)}' || '${JSON.stringify(manifest.selfHostedRunsOn)}') }}`;
  const lines = [
    'name: Nebius runner pilot fixture',
    '',
    'on:',
    '  workflow_dispatch:',
    '    inputs:',
    '      fixture_commit:',
    '        description: Exact 40-character fixture commit',
    '        required: true',
    '        type: string',
    '      target:',
    '        description: Runner target',
    '        required: true',
    '        type: choice',
    '        options:',
    '          - hosted',
    '          - self-hosted',
    '      sequence:',
    '        description: Sequential isolation run',
    '        required: true',
    '        type: choice',
    '        options:',
    "          - '1'",
    "          - '2'",
    '',
    'permissions:',
    '  contents: read',
    '',
    'concurrency:',
    '  group: runner-pilot-${{ inputs.target }}',
    '  cancel-in-progress: false',
    '',
    'jobs:',
    '  workload:',
    `    runs-on: ${runnerSelection}`,
    `    timeout-minutes: ${manifest.timeoutMinutes}`,
    '    steps:',
    '      - name: Validate exact fixture commit',
    '        env:',
    '          FIXTURE_COMMIT: ${{ inputs.fixture_commit }}',
    '        run: test "${#FIXTURE_COMMIT}" = 40 && test -z "${FIXTURE_COMMIT//[0-9a-f]/}"',
    '      - name: Checkout exact fixture commit',
    '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
    '        with:',
    '          ref: ${{ inputs.fixture_commit }}',
    '          persist-credentials: false',
    '      - name: Install pnpm',
    '        uses: pnpm/action-setup@f520eceda224fe1a4aed5a2a27a194379a409996 # v6',
    '        with:',
    '          version: 11.22.0',
    '      - name: Install Node',
    '        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7',
    '        with:',
    '          node-version: 22',
  ];
  for (const step of manifest.steps) {
    lines.push(`      - name: ${step.id}`);
    if (step.whenSequence !== undefined) lines.push(`        if: inputs.sequence == '${step.whenSequence}'`);
    lines.push(`        run: ${yamlLiteral(step.run, 10)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function analyzePilotResults(
  manifest: PilotManifest,
  candidateDigest: string,
  results: readonly PilotResult[],
): PilotAnalysis {
  const reasons: string[] = [];
  let passedDispatches = 0;
  const expectedIds = new Set(manifest.dispatches.map(({ id }) => id));
  for (const result of results) {
    if (!expectedIds.has(result.dispatchId)) reasons.push(`unexpected dispatch ${result.dispatchId}`);
  }
  for (const dispatch of manifest.dispatches) {
    const matches = results.filter(({ dispatchId }) => dispatchId === dispatch.id);
    if (matches.length === 0) {
      reasons.push(`dispatch ${dispatch.id} is missing`);
      continue;
    }
    if (matches.length > 1) reasons.push(`dispatch ${dispatch.id} has duplicate results`);
    const result = matches[0]!;
    if (result.target !== dispatch.target || result.sequence !== dispatch.sequence) reasons.push(`dispatch ${dispatch.id} identity is mismatched`);
    if (result.candidateDigest !== candidateDigest) reasons.push(`dispatch ${dispatch.id} has a mismatched candidate`);
    if (result.workflowFile !== manifest.workflowFile) reasons.push(`dispatch ${dispatch.id} used a mismatched workflow`);
    if (result.conclusion !== 'success') reasons.push(`dispatch ${dispatch.id} concluded ${result.conclusion}`);
    const failures: Array<[keyof PilotAssertions, string]> = [
      ['node22', 'Node 22'],
      ['pnpm11220', 'pnpm 11.22.0'],
      ['deterministicTests', 'deterministic tests'],
      ['dockerFixedPort', 'fixed-port Docker service'],
      ['sentinelAbsent', 'sentinel absence'],
    ];
    for (const [assertion, label] of failures) {
      if (!result.assertions[assertion]) reasons.push(`dispatch ${dispatch.id} failed ${label}`);
    }
    if (matches.length === 1 && result.target === dispatch.target && result.sequence === dispatch.sequence
      && result.candidateDigest === candidateDigest && result.workflowFile === manifest.workflowFile
      && result.conclusion === 'success' && failures.every(([assertion]) => result.assertions[assertion])) {
      passedDispatches += 1;
    }
  }
  for (const target of ['hosted', 'self-hosted'] as const) {
    const targetResults = results.filter((result) => result.target === target && expectedIds.has(result.dispatchId));
    if (new Set(targetResults.map(({ runnerRegistrationId }) => runnerRegistrationId)).size !== targetResults.length) {
      reasons.push(`${target} sequential runs reused a runner registration`);
    }
    if (new Set(targetResults.map(({ workspaceIdentity }) => workspaceIdentity)).size !== targetResults.length) {
      reasons.push(`${target} sequential runs reused a workspace`);
    }
  }
  if (passedDispatches === 0) reasons.push('pilot has zero passing dispatches');
  return { complete: reasons.length === 0, reasons: [...new Set(reasons)], dispatchCount: results.length, passedDispatches };
}

export function buildPermitProposal(input: PilotPermitProposalInput): PilotPermitProposalResult {
  const reasons: string[] = [];
  const maxConcurrentVms = input.maxConcurrentVms ?? 1;
  if (maxConcurrentVms !== 1) reasons.push('pilot permits exactly one concurrent VM');
  if (!Number.isInteger(input.maxStarts) || input.maxStarts < 1 || input.maxStarts > 4) reasons.push('pilot permits at most four starts');
  if (!finitePositive(input.maxRuntimeMs) || input.maxRuntimeMs > 6 * 60 * 60 * 1000) reasons.push('pilot runtime must not exceed six hours');
  if (!finitePositive(input.nowMs) || !finitePositive(input.expiresAtMs)
    || input.expiresAtMs <= input.nowMs || input.expiresAtMs - input.nowMs > 24 * 60 * 60 * 1000) {
    reasons.push('pilot proposal expiry must be within 24 hours');
  }
  if (!finitePositive(input.maxTotalCostUsd) || input.maxTotalCostUsd > 5) reasons.push('pilot cost ceiling must not exceed USD 5');
  for (const [name, value] of Object.entries({
    candidateDigest: input.candidateDigest,
    configHash: input.configHash,
    projectId: input.projectId,
    controllerId: input.controllerId,
    resourcePrefix: input.resourcePrefix,
  })) {
    if (value.trim().length === 0) reasons.push(`${name} is required`);
  }
  if (!Number.isInteger(input.repositoryId) || input.repositoryId <= 0) reasons.push('repositoryId must be a positive integer');
  if (!input.quote.complete) {
    reasons.push(`pilot quote is incomplete: ${input.quote.reason}`);
  } else {
    const quote = input.quote;
    if (quote.currency !== 'USD') reasons.push('pilot quote currency must be USD');
    if (!validRecentQuoteDate(quote.quotedAt, input.nowMs) || quote.source.trim().length === 0) reasons.push('pilot quote must have a valid source dated within seven days');
    if (![quote.computeUsdPerHour, quote.diskUsdPerGibMonth, quote.publicIpUsdPerHour, quote.networkUsdPerGib,
      quote.maxRetainedDiskHours, quote.maxPublicIpHours, quote.maxNetworkEgressGiB]
      .every((value) => Number.isFinite(value) && value >= 0)) reasons.push('pilot quote rates are incomplete');
    if (!finitePositive(quote.estimatedMaximumUsd)) reasons.push('pilot quote maximum must be positive');
    const permitHours = (input.expiresAtMs - input.nowMs) / 3_600_000;
    if (quote.maxRetainedDiskHours < permitHours) reasons.push('pilot quote disk retention does not cover the permit lifetime');
    if (quote.maxPublicIpHours < permitHours) reasons.push('pilot quote IP retention does not cover the permit lifetime');
    const calculated = calculatePilotQuoteMaximum(quote, input.maxRuntimeMs);
    if (!Number.isFinite(calculated)) {
      reasons.push('pilot quote calculated total must be finite');
    } else if (Math.abs(quote.estimatedMaximumUsd - calculated) > 1e-9) {
      reasons.push('pilot quote supplied total does not match its rates and bounds');
    }
    if (quote.estimatedMaximumUsd > 5 || quote.estimatedMaximumUsd > input.maxTotalCostUsd) reasons.push('pilot quote exceeds the cost ceiling');
    if (!quote.includesRetainedDiskAndIp) reasons.push('pilot quote must include retained disk and IP costs');
  }
  if (reasons.length > 0 || !input.quote.complete) return { accepted: false, reasons };

  return {
    accepted: true,
    proposal: {
      schemaVersion: RUNNER_SCHEMA_VERSION,
      approved: false,
      candidateDigest: input.candidateDigest,
      configHash: input.configHash,
      repositoryId: input.repositoryId,
      projectId: input.projectId,
      controllerId: input.controllerId,
      resourcePrefix: input.resourcePrefix,
      issuedAtMs: input.nowMs,
      expiresAtMs: input.expiresAtMs,
      maxConcurrentVms: 1,
      maxStarts: input.maxStarts,
      maxRuntimeMs: input.maxRuntimeMs,
      maxTotalCostUsd: input.maxTotalCostUsd,
      operations: ['create', 'start', 'register', 'stop', 'delete'],
      recoveryAllowed: true,
      resources: {
        platform: 'cpu-d3', preset: '4vcpu-16gb', vmCount: 1,
        diskCount: 1, diskType: 'network_ssd', diskSizeGiB: 80,
      },
      resourceGenerations: Array.from({ length: input.maxStarts }, (_, index) => `${input.resourcePrefix}-g${index + 1}`),
      quote: input.quote,
    },
  };
}

export function calculatePilotQuoteMaximum(
  quote: Extract<PilotQuote, { complete: true }>,
  maxRuntimeMs: number,
): number {
  const computeHours = maxRuntimeMs / 3_600_000;
  return computeHours * quote.computeUsdPerHour
    + quote.maxRetainedDiskHours * 80 * quote.diskUsdPerGibMonth / 730
    + quote.maxPublicIpHours * quote.publicIpUsdPerHour
    + quote.maxNetworkEgressGiB * quote.networkUsdPerGib;
}

export function validateR14Matrix(input: R14MatrixInput): { complete: boolean; passCount: number; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.liveAuthorized) reasons.push('live pilot authorization is absent');
  if (!input.prerequisitesComplete) reasons.push('live pilot prerequisites are incomplete');
  const passCount = input.rows.filter(({ status }) => status === 'passed').length;
  if (passCount === 0) reasons.push('R14 matrix has zero passing rows');
  for (const row of input.rows) {
    if (!(R14_SCENARIOS as readonly string[]).includes(row.scenario)) reasons.push(`unexpected R14 scenario ${row.scenario}`);
  }
  for (const scenario of R14_SCENARIOS) {
    const rows = input.rows.filter((row) => row.scenario === scenario);
    if (rows.length === 0) {
      reasons.push(`required R14 scenario ${scenario} is missing`);
      continue;
    }
    if (rows.length > 1) reasons.push(`required R14 scenario ${scenario} has duplicate results`);
    if (rows.some(({ candidateDigest }) => candidateDigest !== input.candidateDigest)) {
      reasons.push(`required R14 scenario ${scenario} has a mismatched candidate`);
    }
    const selected = rows.find(({ candidateDigest }) => candidateDigest === input.candidateDigest) ?? rows[0]!;
    if (selected.status !== 'passed') reasons.push(`required R14 scenario ${scenario} is ${selected.status}`);
    if (selected.evidence.length === 0 || selected.evidence.some((item) => item.trim().length === 0)) {
      reasons.push(`required R14 scenario ${scenario} has no evidence`);
    }
  }
  return { complete: reasons.length === 0, passCount, reasons: [...new Set(reasons)] };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a nonempty string`);
  return value;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new Error(`${name} must be a nonempty string array`);
  }
  return value;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validRecentQuoteDate(value: string, nowMs: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return false;
  const ageMs = nowMs - parsed;
  return ageMs >= 0 && ageMs <= 7 * 24 * 60 * 60 * 1000;
}

function yamlLiteral(value: string, indentation: number): string {
  const prefix = ' '.repeat(indentation);
  return `|\n${value.split('\n').map((line) => `${prefix}${line}`).join('\n')}`;
}
