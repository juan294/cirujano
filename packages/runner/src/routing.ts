import type { WorkflowJob, WorkflowRun } from './adapters/github.js';
import type { Permit, TimingConfig } from './contracts.js';

/**
 * Routing-switch decisions shared by the fleet commands and the controller
 * (docs/plans/2026-10-29-runner-routing-switch.md). Pure: no IO.
 */

export type ServiceRefusal =
  | 'repository-not-private' | 'permit-absent' | 'permit-not-active' | 'permit-expired'
  | 'past-service-end' | 'runtime-exhausted' | 'cost-exhausted';

export type ServiceAssessment =
  | { serviceable: true; serviceEndMs: number }
  | { serviceable: false; reason: ServiceRefusal; serviceEndMs: number | null };

/** The last moment a start can still fit one complete job and its shutdown margin (lifecycle start cutoff). */
export function serviceEnd(permit: Pick<Permit, 'expiresAtMs'>, timing: Pick<TimingConfig, 'maxJobMs' | 'shutdownMarginMs'>): number {
  return permit.expiresAtMs - timing.maxJobMs - timing.shutdownMarginMs;
}

/**
 * Whether the controller could still start a runner for a queued job, independent of demand. Uses the
 * same limits as the lifecycle start budget, so routing is released no later than starts stop.
 */
export function assessService(input: {
  permit: Permit | null;
  nowMs: number;
  timing: Pick<TimingConfig, 'maxJobMs' | 'shutdownMarginMs'>;
  cumulativeRuntimeMs: number;
  cumulativeCostUsd: number;
  repositoryPrivate: boolean;
}): ServiceAssessment {
  const { permit } = input;
  const end = permit === null ? null : serviceEnd(permit, input.timing);
  const refuse = (reason: ServiceRefusal): ServiceAssessment => ({ serviceable: false, reason, serviceEndMs: end });
  if (!input.repositoryPrivate) return refuse('repository-not-private');
  if (permit === null || end === null) return refuse('permit-absent');
  if (permit.issuedAtMs > input.nowMs) return refuse('permit-not-active');
  if (permit.expiresAtMs <= input.nowMs) return refuse('permit-expired');
  const oneJobMs = input.timing.maxJobMs + input.timing.shutdownMarginMs;
  if (permit.maxRuntimeMs - input.cumulativeRuntimeMs < oneJobMs) return refuse('runtime-exhausted');
  if (input.cumulativeCostUsd >= permit.maxTotalCostUsd) return refuse('cost-exhausted');
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
} {
  const cancellable: number[] = [];
  const waiting: number[] = [];
  const strandedJobs: number[] = [];
  for (const run of runs) {
    const current = jobs.filter((job) => job.runId === run.id && job.runAttempt === run.runAttempt && job.status !== 'completed');
    const stranded = current.filter((job) => job.status !== 'in_progress' && job.labels.includes(runnerLabel));
    if (stranded.length === 0) continue;
    strandedJobs.push(...stranded.map(({ id }) => id));
    (stranded.length === current.length ? cancellable : waiting).push(run.id);
  }
  return { cancellable, waiting, strandedJobs };
}
