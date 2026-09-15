import { RUNNER_SCHEMA_VERSION, type Permit, type PermitOperation } from './contracts.js';
import { finitePositive, validRecentQuoteDate, type PilotQuote } from './pilot.js';

/** Plan D3: per-enrollment operating permit bounds and the fleet ceiling across enrollments. */
export const OPERATING_PERMIT_BOUNDS = {
  expiresAtMs: Date.parse('2026-10-28T23:59:59Z'),
  maxStarts: 600,
  maxRuntimeMs: 540_000_000,
  maxTotalCostUsd: 40,
  fleetCeilingUsd: 120,
} as const;

const OPERATIONS: readonly PermitOperation[] = ['create', 'start', 'register', 'stop', 'delete'];
const DISK_SIZE_GIB = 80;
const HOURS_PER_MONTH = 730;

export interface OperatingPermitProposalInput {
  enrollmentId: string;
  nowMs: number;
  expiresAtMs: number;
  candidateDigest: string;
  configHash: string;
  repositoryId: number;
  projectId: string;
  controllerId: string;
  resourcePrefix: string;
  maxStarts: number;
  maxRuntimeMs: number;
  maxTotalCostUsd: number;
  /** Operating permits already issued to other enrollments; their ceilings count toward the fleet ceiling. */
  otherPermits: ReadonlyArray<Pick<Permit, 'permitId' | 'maxTotalCostUsd'>>;
  quote: PilotQuote;
}

export interface OperatingPermitProposal {
  schemaVersion: typeof RUNNER_SCHEMA_VERSION;
  kind: 'operating';
  enrollmentId: string;
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
  fleetCeilingUsd: number;
  fleetCommittedUsd: number;
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
  quote: Extract<PilotQuote, { complete: true }>;
}

export type OperatingPermitProposalResult =
  | { accepted: true; proposal: OperatingPermitProposal }
  | { accepted: false; reasons: string[] };

/**
 * Conservative maximum for one operating permit: every permitted compute hour at the compute
 * rate, the boot disk retained for the whole permit lifetime, and the egress allowance.
 */
export function calculateOperatingQuoteMaximum(
  quote: Extract<PilotQuote, { complete: true }>,
  maxRuntimeMs: number,
  permitLifetimeMs: number,
): number {
  const computeHours = maxRuntimeMs / 3_600_000;
  const retainedHours = permitLifetimeMs / 3_600_000;
  return computeHours * quote.computeUsdPerHour
    + retainedHours * DISK_SIZE_GIB * quote.diskUsdPerGibMonth / HOURS_PER_MONTH
    + retainedHours * quote.publicIpUsdPerHour
    + quote.maxNetworkEgressGiB * quote.networkUsdPerGib;
}

export function buildOperatingPermitProposal(input: OperatingPermitProposalInput): OperatingPermitProposalResult {
  const reasons: string[] = [];
  const bounds = OPERATING_PERMIT_BOUNDS;
  if (!/^P[1-9]\d{0,3}$/u.test(input.enrollmentId)) reasons.push('enrollmentId must be a registry handle such as P1');
  if (!finitePositive(input.nowMs) || !finitePositive(input.expiresAtMs) || input.expiresAtMs <= input.nowMs) reasons.push('expiry must follow now');
  if (input.expiresAtMs > bounds.expiresAtMs) reasons.push(`expiry must not follow the measurement window end ${new Date(bounds.expiresAtMs).toISOString()}`);
  if (!Number.isInteger(input.maxStarts) || input.maxStarts < 1 || input.maxStarts > bounds.maxStarts) reasons.push(`operating permits allow at most ${bounds.maxStarts} starts`);
  if (!finitePositive(input.maxRuntimeMs) || input.maxRuntimeMs > bounds.maxRuntimeMs) reasons.push(`operating runtime must not exceed ${bounds.maxRuntimeMs / 3_600_000} hours`);
  if (!finitePositive(input.maxTotalCostUsd) || input.maxTotalCostUsd > bounds.maxTotalCostUsd) reasons.push(`operating cost ceiling must not exceed USD ${bounds.maxTotalCostUsd}`);
  for (const [name, value] of Object.entries({
    candidateDigest: input.candidateDigest,
    configHash: input.configHash,
    projectId: input.projectId,
    controllerId: input.controllerId,
    resourcePrefix: input.resourcePrefix,
  })) {
    if (typeof value !== 'string' || value.trim().length === 0) reasons.push(`${name} is required`);
  }
  if (!Number.isInteger(input.repositoryId) || input.repositoryId <= 0) reasons.push('repositoryId must be a positive integer');
  const otherCommitted = input.otherPermits.reduce((total, permit) => total + permit.maxTotalCostUsd, 0);
  if (!Number.isFinite(otherCommitted) || otherCommitted < 0) reasons.push('other permits carry invalid cost ceilings');
  const fleetCommittedUsd = otherCommitted + input.maxTotalCostUsd;
  if (fleetCommittedUsd > bounds.fleetCeilingUsd) {
    reasons.push(`fleet ceiling USD ${bounds.fleetCeilingUsd} would be exceeded: USD ${otherCommitted} already committed plus USD ${input.maxTotalCostUsd}`);
  }
  if (!input.quote.complete) {
    reasons.push(`quote is incomplete: ${input.quote.reason}`);
    return { accepted: false, reasons };
  }
  const quote = input.quote;
  if (quote.currency !== 'USD') reasons.push('quote currency must be USD');
  if (!validRecentQuoteDate(quote.quotedAt, input.nowMs) || quote.source.trim().length === 0) reasons.push('quote must have a valid source dated within seven days');
  if (![quote.computeUsdPerHour, quote.diskUsdPerGibMonth, quote.publicIpUsdPerHour, quote.networkUsdPerGib,
    quote.maxRetainedDiskHours, quote.maxPublicIpHours, quote.maxNetworkEgressGiB]
    .every((value) => Number.isFinite(value) && value >= 0)) reasons.push('quote rates are incomplete');
  const permitLifetimeMs = input.expiresAtMs - input.nowMs;
  const permitHours = permitLifetimeMs / 3_600_000;
  if (quote.maxRetainedDiskHours < permitHours) reasons.push('quote disk retention does not cover the permit lifetime');
  if (quote.maxPublicIpHours < permitHours) reasons.push('quote IP retention does not cover the permit lifetime');
  const calculated = calculateOperatingQuoteMaximum(quote, input.maxRuntimeMs, permitLifetimeMs);
  if (!Number.isFinite(calculated) || calculated <= 0) reasons.push('quote calculated total must be positive and finite');
  else if (Math.abs(quote.estimatedMaximumUsd - calculated) > 1e-9) reasons.push('quote supplied total does not match its rates and bounds');
  if (calculated > input.maxTotalCostUsd) reasons.push(`quote maximum USD ${calculated.toFixed(2)} exceeds the cost ceiling USD ${input.maxTotalCostUsd}`);
  if (!quote.includesRetainedDiskAndIp) reasons.push('quote must include retained disk and IP costs');
  if (reasons.length > 0) return { accepted: false, reasons };
  return {
    accepted: true,
    proposal: {
      schemaVersion: RUNNER_SCHEMA_VERSION,
      kind: 'operating',
      enrollmentId: input.enrollmentId,
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
      fleetCeilingUsd: bounds.fleetCeilingUsd,
      fleetCommittedUsd,
      operations: OPERATIONS,
      recoveryAllowed: true,
      resources: {
        platform: 'cpu-d3', preset: '4vcpu-16gb', vmCount: 1,
        diskCount: 1, diskType: 'network_ssd', diskSizeGiB: 80,
      },
      quote,
    },
  };
}

/** The permit the owner writes as `permit.json` after confirming the proposal; parses through `parsePermit`. */
export function renderOperatingPermit(proposal: OperatingPermitProposal, permitId: string): Permit {
  if (permitId.trim().length === 0) throw new Error('permitId is required');
  return {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    permitId,
    configHash: proposal.configHash,
    candidateDigest: proposal.candidateDigest,
    repositoryId: proposal.repositoryId,
    projectId: proposal.projectId,
    controllerId: proposal.controllerId,
    resourcePrefix: proposal.resourcePrefix,
    operations: [...proposal.operations],
    issuedAtMs: proposal.issuedAtMs,
    expiresAtMs: proposal.expiresAtMs,
    maxStarts: proposal.maxStarts,
    maxRuntimeMs: proposal.maxRuntimeMs,
    maxTotalCostUsd: proposal.maxTotalCostUsd,
    recoveryAllowed: proposal.recoveryAllowed,
  };
}
