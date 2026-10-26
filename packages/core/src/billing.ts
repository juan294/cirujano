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

/** GitHub list price for a standard 2-core Linux runner, verified 2026-09-13. */
export const GITHUB_HOSTED_LINUX_USD_PER_MINUTE = 0.006;

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
 * Parse a complete GitHub Actions jobs inventory. Reject malformed jobs and
 * any declared `total_count` that differs from the `jobs` array length.
 * Already-aggregated inputs may omit `total_count`; their completeness must
 * be established by the caller.
 */
export function parseGithubJobs(payload: unknown): JobTiming[] {
  if (typeof payload !== 'object' || payload === null || !('jobs' in payload)) {
    throw new BillingInputError('GitHub jobs payload must be an object with a `jobs` array.');
  }
  const { jobs } = payload as { jobs: unknown };
  if (!Array.isArray(jobs)) {
    throw new BillingInputError('GitHub jobs payload field `jobs` must be an array.');
  }
  // Paginated consumers may supply an aggregate without total_count. A raw
  // API page that declares it must contain the complete declared inventory.
  if ('total_count' in payload) {
    const total = payload.total_count;
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || total !== jobs.length) {
      throw new BillingInputError('GitHub jobs payload `total_count` must equal the complete jobs array length; collect all pages before estimating.');
    }
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
