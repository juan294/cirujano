import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { billableMinutesForJob } from '@cirujano/core';

export type HostedSku = 'actions_linux' | 'actions_linux_arm' | 'actions_windows' | 'actions_macos';

export const TELEMETRY_RATES = {
  currency: 'USD' as const,
  quotedAt: '2026-09-13',
  source: 'https://docs.github.com/en/billing/reference/actions-runner-pricing',
  skus: {
    actions_linux: 0.006,
    actions_linux_arm: 0.005,
    actions_windows: 0.010,
    actions_macos: 0.062,
  },
  cirujanoLabels: {
    'cirujano-pilot-fixture': 'actions_linux',
    'cirujano-baseline-actions_linux': 'actions_linux',
  } satisfies Record<string, HostedSku>,
};

export type RepositoryVisibility = 'private' | 'public';
export type RunnerKind = 'github-hosted' | 'cirujano' | 'self-hosted';
export type MeasurementStatus = 'measured' | 'not-run' | 'incomplete';

export interface TelemetryRepository {
  fullName: string;
  visibility: RepositoryVisibility;
  archived: boolean;
}

export interface TelemetryRun {
  id: number;
  attempt: number;
  workflowName: string;
  event: string;
  createdAt: string;
  conclusion: string;
}

export interface TelemetryJobInput {
  id: number;
  name: string;
  startedAt: string | null;
  completedAt: string | null;
  conclusion: string;
  labels: string[];
  runnerName: string;
  runnerGroupName: string;
}

export interface GitHubTelemetrySource {
  listRepositories(): Promise<TelemetryRepository[]>;
  listRuns(repository: string, windowStart: string): Promise<TelemetryRun[]>;
  listJobs(repository: string, runId: number, attempt: number): Promise<TelemetryJobInput[]>;
}

export interface TelemetryJob {
  key: string;
  repository: string;
  visibility: RepositoryVisibility;
  workflowName: string;
  runId: number;
  runAttempt: number;
  jobId: number;
  jobName: string;
  event: string;
  conclusion: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  runnerKind: RunnerKind;
  runnerName: string;
  runnerGroupName: string;
  labels: string[];
  measurementStatus: MeasurementStatus;
  durationMs: number | null;
  billableMinutes: number | null;
  hostedSku: HostedSku | null;
  hostedUsdPerMinute: number | null;
  pricingSource: string;
  actualGithubListCostUsd: number | null;
  counterfactualHostedCostUsd: number | null;
}

export interface TelemetrySnapshot {
  schemaVersion: 1;
  owner: string;
  collectedAt: string;
  windowStart: string;
  rates: typeof TELEMETRY_RATES;
  repositoriesScanned: number;
  runsScanned: number;
  jobs: TelemetryJob[];
}

export interface TelemetryReport {
  schemaVersion: 1;
  since: string;
  through: string;
  repositories: number;
  workflows: number;
  jobs: number;
  successfulJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  notRunJobs: number;
  incompleteJobs: number;
  successRate: number | null;
  githubHostedMinutes: number;
  githubHostedListCostUsd: number;
  cirujanoJobs: number;
  cirujanoMinutes: number;
  grossHostedCostAvoidedUsd: number;
  otherSelfHostedJobs: number;
  unpricedJobs: number;
}

export async function collectTelemetry(input: {
  owner: string;
  lookbackHours: number;
  nowMs?: number;
  source: GitHubTelemetrySource;
  priorSnapshot?: TelemetrySnapshot;
  onRepository?: (repository: string) => void;
}): Promise<TelemetrySnapshot> {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(input.owner)) throw new Error('owner is invalid');
  if (!Number.isInteger(input.lookbackHours) || input.lookbackHours < 1 || input.lookbackHours > 24 * 45) {
    throw new Error('lookbackHours must be an integer from 1 through 1080');
  }
  const nowMs = input.nowMs ?? Date.now();
  const collectedAt = new Date(nowMs).toISOString();
  const windowStart = new Date(nowMs - input.lookbackHours * 3_600_000).toISOString();
  const repositories = (await input.source.listRepositories())
    .filter(({ fullName, archived }) => !archived && fullName.startsWith(`${input.owner}/`))
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
  if (input.priorSnapshot !== undefined && input.priorSnapshot.owner !== input.owner) throw new Error('prior snapshot owner does not match');
  const priorRuns = groupJobsByRun(input.priorSnapshot?.jobs ?? []);
  const results = await mapLimit(repositories, 4, async (repository) => {
    const runs = await input.source.listRuns(repository.fullName, windowStart);
    const jobs: TelemetryJob[] = [];
    for (const run of runs) {
      if (run.conclusion.length === 0) continue;
      const prior = priorRuns.get(runKey(repository.fullName, run.id, run.attempt));
      if (prior !== undefined) {
        jobs.push(...prior);
        continue;
      }
      for (const job of await input.source.listJobs(repository.fullName, run.id, run.attempt)) {
        jobs.push(normalizeTelemetryJob(repository, run, job));
      }
    }
    input.onRepository?.(repository.fullName);
    return { jobs, runs: runs.length };
  });
  const jobs = results.flatMap(({ jobs: repositoryJobs }) => repositoryJobs);
  const runsScanned = results.reduce((total, result) => total + result.runs, 0);
  jobs.sort((left, right) => left.key.localeCompare(right.key));
  return {
    schemaVersion: 1,
    owner: input.owner,
    collectedAt,
    windowStart,
    rates: TELEMETRY_RATES,
    repositoriesScanned: repositories.length,
    runsScanned,
    jobs,
  };
}

function groupJobsByRun(jobs: readonly TelemetryJob[]): ReadonlyMap<string, TelemetryJob[]> {
  const groups = new Map<string, TelemetryJob[]>();
  for (const job of jobs) {
    const key = runKey(job.repository, job.runId, job.runAttempt);
    const group = groups.get(key) ?? [];
    group.push(job);
    groups.set(key, group);
  }
  return groups;
}

function runKey(repository: string, runId: number, attempt: number): string {
  return `${repository}:${runId}:${attempt}`;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]!);
    }
  }));
  return results;
}

export async function writeTelemetrySnapshot(directory: string, snapshot: TelemetrySnapshot): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const date = snapshot.collectedAt.slice(0, 10);
  const path = join(directory, `${date}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return path;
}

export function aggregateTelemetry(snapshots: readonly TelemetrySnapshot[], sinceMs: number): TelemetryReport {
  if (!Number.isFinite(sinceMs) || sinceMs < 0) throw new Error('since must be a non-negative timestamp');
  const byKey = new Map<string, TelemetryJob>();
  let throughMs = sinceMs;
  for (const snapshot of snapshots) {
    throughMs = Math.max(throughMs, Date.parse(snapshot.collectedAt));
    for (const job of snapshot.jobs) {
      if (Date.parse(job.completedAt ?? job.startedAt ?? job.createdAt) < sinceMs) continue;
      const existing = byKey.get(job.key);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(job)) {
        throw new Error(`conflicting duplicate telemetry job ${job.key}`);
      }
      byKey.set(job.key, job);
    }
  }
  const jobs = [...byKey.values()];
  const hosted = jobs.filter(({ runnerKind }) => runnerKind === 'github-hosted');
  const cirujano = jobs.filter(({ runnerKind }) => runnerKind === 'cirujano');
  const executed = jobs.filter(({ measurementStatus }) => measurementStatus !== 'not-run');
  const successfulJobs = executed.filter(({ conclusion }) => conclusion === 'success').length;
  const failedJobs = executed.filter(({ conclusion }) => conclusion === 'failure').length;
  return {
    schemaVersion: 1,
    since: new Date(sinceMs).toISOString(),
    through: new Date(throughMs).toISOString(),
    repositories: new Set(jobs.map(({ repository }) => repository)).size,
    workflows: new Set(jobs.map(({ repository, workflowName }) => `${repository}\0${workflowName}`)).size,
    jobs: jobs.length,
    successfulJobs,
    failedJobs,
    successRate: executed.length === 0 ? null : round(successfulJobs / executed.length),
    githubHostedMinutes: sumKnown(hosted, 'billableMinutes'),
    githubHostedListCostUsd: money(sumKnown(hosted, 'actualGithubListCostUsd')),
    cirujanoJobs: cirujano.length,
    cirujanoMinutes: sumKnown(cirujano, 'billableMinutes'),
    grossHostedCostAvoidedUsd: money(sumKnown(cirujano, 'counterfactualHostedCostUsd')),
    otherSelfHostedJobs: jobs.filter(({ runnerKind }) => runnerKind === 'self-hosted').length,
    unpricedJobs: jobs.filter(({ actualGithubListCostUsd, counterfactualHostedCostUsd }) => actualGithubListCostUsd === null || counterfactualHostedCostUsd === null).length,
    cancelledJobs: jobs.filter(({ conclusion }) => conclusion === 'cancelled').length,
    notRunJobs: jobs.filter(({ measurementStatus }) => measurementStatus === 'not-run').length,
    incompleteJobs: jobs.filter(({ measurementStatus }) => measurementStatus === 'incomplete').length,
  };
}

export function renderTelemetryMarkdown(report: TelemetryReport): string {
  const success = report.successRate === null ? 'n/a' : `${(report.successRate * 100).toFixed(1)}%`;
  return [
    '# Cirujano fleet telemetry',
    '',
    `Window: ${report.since} through ${report.through}`,
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Repositories | ${report.repositories} |`,
    `| Workflows | ${report.workflows} |`,
    `| Jobs | ${report.jobs} |`,
    `| Successful jobs | ${report.successfulJobs} |`,
    `| Failed jobs | ${report.failedJobs} |`,
    `| Cancelled jobs | ${report.cancelledJobs} |`,
    `| Jobs not run | ${report.notRunJobs} |`,
    `| Jobs with incomplete timing | ${report.incompleteJobs} |`,
    `| Success rate | ${success} |`,
    `| GitHub-hosted minutes | ${report.githubHostedMinutes} |`,
    `| GitHub-hosted list cost | $${report.githubHostedListCostUsd.toFixed(2)} |`,
    `| Cirujano jobs | ${report.cirujanoJobs} |`,
    `| Cirujano job minutes | ${report.cirujanoMinutes} |`,
    `| Gross hosted cost avoided | $${report.grossHostedCostAvoidedUsd.toFixed(2)} |`,
    `| Other self-hosted jobs | ${report.otherSelfHostedJobs} |`,
    `| Jobs with unknown price | ${report.unpricedJobs} |`,
    '',
    'Gross avoided cost excludes Nebius cost. Net savings require provider accounting.',
    '',
  ].join('\n');
}

export function normalizeTelemetryJob(repository: TelemetryRepository, run: TelemetryRun, job: TelemetryJobInput): TelemetryJob {
  const hasStart = job.startedAt !== null;
  const hasEnd = job.completedAt !== null;
  const measurementStatus: MeasurementStatus = hasStart && hasEnd ? 'measured' : !hasStart && !hasEnd ? 'not-run' : 'incomplete';
  const minutes = measurementStatus === 'measured'
    ? billableMinutesForJob({ name: job.name, startedAt: job.startedAt, completedAt: job.completedAt })
    : measurementStatus === 'not-run' ? 0 : null;
  if (measurementStatus === 'measured' && minutes === null) throw new Error(`job ${job.id} has inconsistent timestamps`);
  const durationMs = measurementStatus === 'measured'
    ? Date.parse(job.completedAt!) - Date.parse(job.startedAt!)
    : measurementStatus === 'not-run' ? 0 : null;
  const runnerKind = classifyRunner(job);
  const sku = hostedSku(job.labels, runnerKind);
  const rate = sku === null ? null : TELEMETRY_RATES.skus[sku];
  const noRun = measurementStatus === 'not-run';
  const actualGithubListCostUsd = runnerKind !== 'github-hosted' || noRun || repository.visibility === 'public'
    ? 0 : minutes === null || rate === null ? null : money(minutes * rate);
  const counterfactualHostedCostUsd = runnerKind === 'self-hosted' || noRun || repository.visibility === 'public'
    ? 0 : minutes === null || rate === null ? null : money(minutes * rate);
  return {
    key: `${repository.fullName}:${run.id}:${run.attempt}:${job.id}`,
    repository: repository.fullName,
    visibility: repository.visibility,
    workflowName: run.workflowName,
    runId: run.id,
    runAttempt: run.attempt,
    jobId: job.id,
    jobName: job.name,
    event: run.event,
    conclusion: job.conclusion,
    createdAt: run.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    runnerKind,
    runnerName: job.runnerName,
    runnerGroupName: job.runnerGroupName,
    labels: [...job.labels].sort(),
    measurementStatus,
    durationMs,
    billableMinutes: minutes,
    hostedSku: sku,
    hostedUsdPerMinute: rate,
    pricingSource: TELEMETRY_RATES.source,
    actualGithubListCostUsd,
    counterfactualHostedCostUsd,
  };
}

function classifyRunner(job: TelemetryJobInput): RunnerKind {
  if (!job.labels.includes('self-hosted')) return 'github-hosted';
  if (job.runnerName.startsWith('cirujano-')) return 'cirujano';
  return 'self-hosted';
}

function hostedSku(labels: readonly string[], runnerKind: RunnerKind): HostedSku | null {
  const values = new Set(labels.map((label) => label.toLowerCase()));
  if (runnerKind === 'cirujano') {
    for (const [label, sku] of Object.entries(TELEMETRY_RATES.cirujanoLabels)) {
      if (values.has(label)) return sku;
    }
    return null;
  }
  if (['ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04', 'ubuntu-20.04'].some((label) => values.has(label))) return 'actions_linux';
  if (['ubuntu-24.04-arm', 'ubuntu-22.04-arm'].some((label) => values.has(label))) return 'actions_linux_arm';
  if (['windows-latest', 'windows-2025', 'windows-2022', 'windows-2019', 'windows-11-arm'].some((label) => values.has(label))) return 'actions_windows';
  if (['macos-latest', 'macos-15', 'macos-14', 'macos-13', 'macos-15-intel'].some((label) => values.has(label))) return 'actions_macos';
  return null;
}

function sumKnown<T>(items: readonly T[], key: keyof T): number {
  return items.reduce((total, item) => {
    const value = item[key];
    return total + (typeof value === 'number' ? value : 0);
  }, 0);
}

function money(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
