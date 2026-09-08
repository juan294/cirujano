/**
 * Billable-minute arithmetic for GitHub Actions.
 *
 * GitHub bills every job on a hosted runner by rounding its wall-clock
 * duration up to the next whole minute, then multiplying by the runner's
 * per-minute price. The `/actions/runs/{id}/timing` endpoint reports
 * `total_ms: 0` for every job on current GitHub, so the only reliable
 * source is each job's `started_at` and `completed_at` timestamp.
 */

const MS_PER_MINUTE = 60_000;

/** List price for a 2-core Linux hosted runner in a private repository. */
export const GITHUB_HOSTED_LINUX_USD_PER_MINUTE = 0.008;

export interface JobTiming {
  name: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface BillableSummary {
  /** Sum of every measured job's minutes, each rounded up like GitHub does. */
  billableMinutes: number;
  /** Jobs with a valid start and completion timestamp. */
  measuredJobs: number;
  /** Jobs that never started, never completed, or carry unparsable timestamps. */
  skippedJobs: number;
}

export class BillingInputError extends Error {
  override readonly name = 'BillingInputError';
}

/**
 * Minutes GitHub bills for one job, or `null` when the job cannot be measured.
 * A job that finished before it started is treated as unmeasurable rather
 * than silently clamped to zero.
 */
export function billableMinutesForJob(job: JobTiming): number | null {
  if (job.startedAt === null || job.completedAt === null) {
    return null;
  }
  const started = Date.parse(job.startedAt);
  const completed = Date.parse(job.completedAt);
  if (Number.isNaN(started) || Number.isNaN(completed) || completed < started) {
    return null;
  }
  return Math.ceil((completed - started) / MS_PER_MINUTE);
}

export function summarizeBillableMinutes(jobs: readonly JobTiming[]): BillableSummary {
  let billableMinutes = 0;
  let measuredJobs = 0;
  let skippedJobs = 0;
  for (const job of jobs) {
    const minutes = billableMinutesForJob(job);
    if (minutes === null) {
      skippedJobs += 1;
      continue;
    }
    billableMinutes += minutes;
    measuredJobs += 1;
  }
  return { billableMinutes, measuredJobs, skippedJobs };
}

/**
 * Parse the payload of `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`.
 * Fails closed: any job entry that is not an object with a string `name`
 * rejects the whole payload, so a truncated or unexpected response can never
 * be reported as a low bill.
 */
export function parseGithubJobs(payload: unknown): JobTiming[] {
  if (typeof payload !== 'object' || payload === null || !('jobs' in payload)) {
    throw new BillingInputError('GitHub jobs payload must be an object with a `jobs` array.');
  }
  const { jobs } = payload as { jobs: unknown };
  if (!Array.isArray(jobs)) {
    throw new BillingInputError('GitHub jobs payload field `jobs` must be an array.');
  }
  return jobs.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new BillingInputError(`GitHub job at index ${index} is not an object.`);
    }
    const job = entry as Record<string, unknown>;
    if (typeof job['name'] !== 'string') {
      throw new BillingInputError(`GitHub job at index ${index} has no string \`name\`.`);
    }
    return {
      name: job['name'],
      startedAt: timestampOrNull(job['started_at']),
      completedAt: timestampOrNull(job['completed_at']),
    };
  });
}

function timestampOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface WorkflowUsageInput {
  repository: string;
  workflow: string;
  /** Runs observed in the audit window. */
  runs: number;
  /** Billable minutes of each sampled completed run. */
  sampledMinutes: readonly number[];
}

export interface WorkflowUsage extends WorkflowUsageInput {
  averageMinutesPerRun: number;
  /** `runs * averageMinutesPerRun`, the audit-window estimate. */
  estimatedMinutes: number;
}

/**
 * Rank workflows by estimated billable minutes, highest first. A workflow with
 * no sampled runs cannot be estimated and is ranked last with zero minutes.
 */
export function rankWorkflowUsage(inputs: readonly WorkflowUsageInput[]): WorkflowUsage[] {
  return inputs
    .map((input) => {
      const sample = input.sampledMinutes;
      const averageMinutesPerRun = sample.length === 0
        ? 0
        : sample.reduce((sum, minutes) => sum + minutes, 0) / sample.length;
      return {
        ...input,
        averageMinutesPerRun,
        estimatedMinutes: Math.round(averageMinutesPerRun * input.runs),
      };
    })
    .sort((a, b) => b.estimatedMinutes - a.estimatedMinutes);
}

export function estimateCostUsd(
  minutes: number,
  usdPerMinute: number = GITHUB_HOSTED_LINUX_USD_PER_MINUTE,
): number {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new BillingInputError('minutes must be a non-negative finite number.');
  }
  if (!Number.isFinite(usdPerMinute) || usdPerMinute < 0) {
    throw new BillingInputError('usdPerMinute must be a non-negative finite number.');
  }
  return Math.round(minutes * usdPerMinute * 100) / 100;
}
