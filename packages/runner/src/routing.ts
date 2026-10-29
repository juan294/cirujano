import type { WorkflowJob, WorkflowRun } from './adapters/github.js';
import { THIRTY_DAY_MONTH_MS } from './cost.js';
import type { LifecycleDecision, LifecycleInput, Permit, PermitIdentity, PermitOperation, RunnerConfig, TimingConfig } from './contracts.js';

/**
 * Routing-switch decisions shared by the fleet commands and the controller
 * (docs/plans/2026-10-29-runner-routing-switch.md). Pure: no IO.
 */

export type ServiceRefusal =
  | 'repository-not-private' | 'permit-absent' | 'permit-identity-mismatch' | 'permit-operations-missing'
  | 'permit-not-active' | 'permit-expired' | 'starts-exhausted' | 'past-service-end' | 'runtime-exhausted' | 'cost-exhausted';

const SERVING_OPERATIONS: readonly PermitOperation[] = ['create', 'start', 'register'];

/**
 * The cost one start may add: a full lifetime of compute and disk plus the egress limit. Without an
 * egress limit the cost is unbounded, so no start fits (the lifecycle refuses the same way).
 */
export function projectedStartCostUsd(config: Pick<RunnerConfig, 'timing' | 'rates' | 'nebius'>, networkEgressLimitGiB: number | undefined): number {
  if (networkEgressLimitGiB === undefined || !Number.isFinite(networkEgressLimitGiB) || networkEgressLimitGiB < 0) return Number.POSITIVE_INFINITY;
  const compute = (config.timing.lifetimeMs / 3_600_000) * config.rates.computeUsdPerHour;
  const disk = (config.timing.lifetimeMs / THIRTY_DAY_MONTH_MS) * config.nebius.diskSizeGiB * config.rates.diskUsdPerGibMonth;
  return compute + disk + networkEgressLimitGiB * config.rates.networkEgressUsdPerGib;
}

export type ServiceAssessment =
  | { serviceable: true; serviceEndMs: number }
  | { serviceable: false; reason: ServiceRefusal; serviceEndMs: number | null };

/** The last moment a start can still fit one complete job and its shutdown margin (lifecycle start cutoff). */
export function serviceEnd(permit: Pick<Permit, 'expiresAtMs'>, timing: Pick<TimingConfig, 'maxJobMs' | 'shutdownMarginMs'>): number {
  return permit.expiresAtMs - timing.maxJobMs - timing.shutdownMarginMs;
}

/**
 * Whether the controller could still start a runner for a queued job, independent of demand. Uses the
 * same limits as the lifecycle start budget (identity, operations, starts, runtime, projected cost and
 * the start cutoff), so routing is released no later than starts stop. `identity` holds the fields the
 * caller can know; the fleet cannot know the installed bundle digest, the controller can.
 */
export function assessService(input: {
  permit: Permit | null;
  nowMs: number;
  timing: Pick<TimingConfig, 'maxJobMs' | 'shutdownMarginMs'>;
  identity?: Partial<PermitIdentity>;
  startCount: number;
  cumulativeRuntimeMs: number;
  cumulativeCostUsd: number;
  projectedStartCostUsd: number;
  repositoryPrivate: boolean;
}): ServiceAssessment {
  const { permit } = input;
  const end = permit === null ? null : serviceEnd(permit, input.timing);
  const refuse = (reason: ServiceRefusal): ServiceAssessment => ({ serviceable: false, reason, serviceEndMs: end });
  if (!input.repositoryPrivate) return refuse('repository-not-private');
  if (permit === null || end === null) return refuse('permit-absent');
  const identity = Object.entries(input.identity ?? {}) as Array<[keyof PermitIdentity, unknown]>;
  if (identity.some(([key, value]) => permit[key] !== value)) return refuse('permit-identity-mismatch');
  if (SERVING_OPERATIONS.some((operation) => !permit.operations.includes(operation))) return refuse('permit-operations-missing');
  if (permit.issuedAtMs > input.nowMs) return refuse('permit-not-active');
  if (permit.expiresAtMs <= input.nowMs) return refuse('permit-expired');
  if (input.startCount >= permit.maxStarts) return refuse('starts-exhausted');
  const oneJobMs = input.timing.maxJobMs + input.timing.shutdownMarginMs;
  if (permit.maxRuntimeMs - input.cumulativeRuntimeMs < oneJobMs) return refuse('runtime-exhausted');
  if (input.cumulativeCostUsd + input.projectedStartCostUsd > permit.maxTotalCostUsd) return refuse('cost-exhausted');
  if (input.nowMs > end) return refuse('past-service-end');
  return { serviceable: true, serviceEndMs: end };
}

/**
 * Jobs queued on the runner label in each run's current attempt are stranded once nothing will serve
 * that label. A run is cancellable only when its stranded jobs are all that is left unfinished, so
 * cancelling never interrupts a job that is running elsewhere.
 */
export function selectStrandedRuns(runs: readonly WorkflowRun[], jobs: readonly WorkflowJob[], runnerLabel: string): {
  cancellable: number[];
  waiting: number[];
  strandedJobs: number[];
  /** The stranded job ids of each run, for re-running them once the run is cancelled. */
  strandedJobsByRun: Record<number, number[]>;
} {
  const cancellable: number[] = [];
  const waiting: number[] = [];
  const strandedJobs: number[] = [];
  const strandedJobsByRun: Record<number, number[]> = {};
  for (const run of runs) {
    const current = jobs.filter((job) => job.runId === run.id && job.runAttempt === run.runAttempt && job.status !== 'completed');
    const stranded = current.filter((job) => job.status !== 'in_progress' && job.labels.includes(runnerLabel));
    if (stranded.length === 0) continue;
    strandedJobs.push(...stranded.map(({ id }) => id));
    strandedJobsByRun[run.id] = stranded.map(({ id }) => id);
    (stranded.length === current.length ? cancellable : waiting).push(run.id);
  }
  return { cancellable, waiting, strandedJobs, strandedJobsByRun };
}

const RELEASE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** Release checks run at once, then at most every 10 minutes, and at once when the refusal reason changes. */
export function releaseCheckDue(last: { atMs: number; reason: string } | null, reason: string, nowMs: number): boolean {
  return last === null || last.reason !== reason || nowMs - last.atMs >= RELEASE_CHECK_INTERVAL_MS;
}

/** Per-process release-check state of one controller. */
export interface ReleaseCheck {
  last: { atMs: number; reason: string } | null;
}

/** Returns whether a check for this reason is due, and records it when it is. */
export function claimReleaseCheck(check: ReleaseCheck, reason: string, nowMs: number): boolean {
  if (!releaseCheckDue(check.last, reason, nowMs)) return false;
  check.last = { atMs: nowMs, reason };
  return true;
}

/**
 * A live or starting VM of this controller may still take a queued job (lifecycle canBeginAssignedJob
 * checks only its grant and the permit deadline), so stranded runs are cancelled only when no owned VM
 * exists, none is being created or started, and the tick that just ran decided no lifecycle effect
 * (a stopped VM can be started by a permit without `create`, which serviceability does not count).
 */
export function ownedRunnerMayTakeJobs(
  input: { provider: Pick<LifecycleInput['provider'], 'vmStatus'>; journal: Pick<LifecycleInput['journal'], 'outstandingIntent'> },
  tickDecision?: Pick<LifecycleDecision, 'effect'>,
): boolean {
  return !['absent', 'stopped'].includes(input.provider.vmStatus) || input.journal.outstandingIntent !== null
    || (tickDecision !== undefined && tickDecision.effect.type !== 'none');
}
