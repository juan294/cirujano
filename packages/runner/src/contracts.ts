export const RUNNER_SCHEMA_VERSION = 1 as const;

export type LifecycleState =
  | 'absent'
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'busy'
  | 'draining'
  | 'stopping'
  | 'blocked';

export type PermitOperation = 'create' | 'start' | 'register' | 'stop' | 'delete';

export interface RepositoryConfig {
  id: number;
  nameWithOwner: string;
  visibility: 'private';
}

export interface NebiusConfig {
  profile: string;
  projectId: string;
  subnetId: string;
  imageId: string;
  platform: string;
  preset: string;
  diskType: string;
  diskSizeGiB: number;
}

export interface SshConfig {
  publicKey: string;
  fingerprint: string;
}

export interface OwnershipConfig {
  controllerId: string;
  resourcePrefix: string;
}

export interface TimingConfig {
  pollIntervalMs: number;
  idleGraceMs: number;
  bootTimeoutMs: number;
  maxJobMs: number;
  lifetimeMs: number;
  shutdownMarginMs: number;
}

export interface RunnerConfig {
  schemaVersion: typeof RUNNER_SCHEMA_VERSION;
  repository: RepositoryConfig;
  workflowIds: readonly number[];
  allowedBranch: string;
  eligibleJobNames: readonly string[];
  runnerLabel: string;
  slots: 1;
  nebius: NebiusConfig;
  ssh: SshConfig;
  ownership: OwnershipConfig;
  timing: TimingConfig;
  rates: CostRates;
}

/** Values discovered from provider reads, deliberately absent from RunnerConfig. */
export interface ResolvedVmNetwork {
  vmId: string;
  ipAddress: string;
}

export interface PermitIdentity {
  configHash: string;
  candidateDigest: string;
  repositoryId: number;
  projectId: string;
  controllerId: string;
  resourcePrefix: string;
}

export interface Permit extends PermitIdentity {
  schemaVersion: typeof RUNNER_SCHEMA_VERSION;
  permitId: string;
  operations: readonly PermitOperation[];
  issuedAtMs: number;
  expiresAtMs: number;
  maxStarts: number;
  maxRuntimeMs: number;
  maxTotalCostUsd: number;
  recoveryAllowed: boolean;
}

export type VmStatus = 'absent' | 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'unknown';
export type OwnershipStatus = 'absent' | 'owned' | 'foreign' | 'ambiguous' | 'unknown';
export type GuestStatus = 'offline' | 'booting' | 'ready' | 'busy' | 'draining' | 'drained' | 'failed' | 'unknown';

export interface ProviderSnapshot {
  complete: boolean;
  vmStatus: VmStatus;
  ownership: OwnershipStatus;
  ownedMatches: number;
  outstandingOperation: string | null;
  network?: ResolvedVmNetwork;
}

export interface QueueSnapshot {
  complete: boolean;
  eligibleQueuedJobs: number;
  ownedBusy: boolean | null;
  observedAtMs: number;
}

export interface StartGrant {
  generation: number;
  startedAtMs: number;
  deadlineMs: number;
}

export interface GuestSnapshot {
  complete: boolean;
  status: GuestStatus;
  admissionEnabled: boolean | null;
  runnerActive: boolean | null;
  workerActive: boolean | null;
  grant: StartGrant | null;
  watchdogReady?: boolean;
  sshIdentityVerified?: boolean;
  registrationReady?: boolean;
}

export interface MutationIntent {
  type: 'create-vm' | 'start-vm';
  generation: number;
  status: 'pending' | 'ambiguous';
  deadlineMs: number;
}

export interface IdleObservation {
  observedAtMs: number;
  complete: boolean;
  generation: number;
}

export interface LifecycleJournal {
  state: LifecycleState;
  startCount: number;
  cumulativeRuntimeMs: number;
  cumulativeCostUsd: number;
  outstandingIntent: MutationIntent | null;
  idleObservations: readonly IdleObservation[];
}

export interface LifecycleInput {
  nowMs: number;
  config: RunnerConfig;
  identity: PermitIdentity;
  permit: Permit | null;
  provider: ProviderSnapshot;
  queue: QueueSnapshot;
  guest: GuestSnapshot;
  journal: LifecycleJournal;
  projectedStartCostUsd: number;
}

export type LifecycleEffect =
  | { type: 'none' }
  | { type: 'create-vm'; generation: number; reservedStartCount: number; deadlineMs: number }
  | { type: 'adopt-vm'; generation: number; deadlineMs: number }
  | { type: 'start-vm'; generation: number; deadlineMs: number }
  | { type: 'register-runner'; assignmentCutoffMs: number }
  | { type: 'begin-drain'; fallbackDeadlineMs: number }
  | { type: 'resume-admission' }
  | { type: 'stop-vm'; emergency: boolean };

export interface LifecycleDecision {
  state: LifecycleState;
  effect: LifecycleEffect;
  reason: string;
}

export interface CostRates {
  currency: string;
  quotedAt: string;
  source: string;
  computeUsdPerHour: number;
  diskUsdPerGibMonth: number;
  networkEgressUsdPerGib: number;
  hostedUsdPerMinute: number | null;
}

export interface TimeInterval {
  startMs: number;
  endMs: number | null;
}

export interface RunnerCostInput {
  rates: CostRates | null;
  computeIntervals: readonly TimeInterval[];
  disk: { sizeGiB: number; retainedMs: number };
  networkEgressGiB: number;
  hostedBillableMinutes: number | null;
}

export type RunnerCostEstimate =
  | {
      complete: true;
      currency: string;
      computeUsd: number;
      diskUsd: number;
      networkUsd: number;
      runnerTotalUsd: number;
      hostedBaselineUsd: number;
    }
  | { complete: false; reason: string };
