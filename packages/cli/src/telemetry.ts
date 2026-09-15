import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { billableMinutesForJob } from '@cirujano/core';
import { estimateRunnerCost, type CostRates } from '@cirujano/runner';

import type { EnrollmentStatus, FleetEnrollment, FleetRegistry } from './fleet-registry.js';

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

export interface TelemetryRunEvidence extends TelemetryRun {
  key: string;
  repository: string;
  jobsObserved: number;
  reusable: boolean;
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
  repositoryInventory: Array<Pick<TelemetryRepository, 'fullName' | 'visibility'>>;
  repositoriesScanned: number;
  runsScanned: number;
  runs: TelemetryRunEvidence[];
  jobs: TelemetryJob[];
}

export interface TelemetryRepositoryReport {
  repository: string;
  jobs: number;
  githubHostedMinutes: number;
  githubHostedListCostUsd: number;
  cirujanoJobs: number;
  cirujanoMinutes: number;
  grossHostedCostAvoidedUsd: number;
  unpricedJobs: number;
}

export interface EnrollmentWindowReport {
  jobs: number;
  hostedJobs: number;
  hostedMinutes: number;
  hostedListCostUsd: number;
}

export interface EnrollmentAfterReport extends EnrollmentWindowReport {
  cirujanoJobs: number;
  cirujanoMinutes: number;
  grossHostedCostAvoidedUsd: number;
  queueLatencySamples: number;
  queueLatencyP50Ms: number | null;
  queueLatencyP95Ms: number | null;
}

/** Controller journals for one enrollment, read from its state directory (fleet-service). */
export interface ControllerEvidence {
  controllerId: string;
  resourcePrefix: string;
  startCount: number;
  cumulativeRuntimeMs: number;
  cumulativeCostUsd: number;
  diskRetainedMs: number;
  diskSizeGiB: number;
  networkEgressBytes: number;
  rates: CostRates;
  assignments: ReadonlyArray<{ runId: number; runAttempt: number; jobId: number; runnerId: number; runnerName: string; conclusion: string | null }>;
}

export interface EnrollmentAssignment {
  runId: number;
  jobId: number;
  runnerId: number;
  runnerName: string;
}

export interface TelemetryEnrollmentReport {
  id: string;
  repository: string;
  visibility: RepositoryVisibility | null;
  workflowName: string;
  jobNames: string[];
  status: EnrollmentStatus;
  cutoverAt: string | null;
  before: EnrollmentWindowReport;
  after: EnrollmentAfterReport;
  vmStarts: number | null;
  controllerJournaledCostUsd: number | null;
  nebiusComputeUsd: number | null;
  nebiusDiskUsd: number | null;
  nebiusNetworkUsd: number | null;
  nebiusTotalUsd: number | null;
  netSavingsUsd: number | null;
  assignments: EnrollmentAssignment[];
  unmatchedCirujanoJobs: string[];
  complete: boolean;
  incompleteReason: string | null;
}

export interface FleetSavingsReport {
  enrollments: number;
  grossHostedCostAvoidedUsd: number;
  nebiusTotalUsd: number | null;
  netSavingsUsd: number | null;
  complete: boolean;
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
  byRepository: TelemetryRepositoryReport[];
  enrollments?: TelemetryEnrollmentReport[];
  fleet?: FleetSavingsReport;
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
  const windowStart = new Date(nowMs - input.lookbackHours * 3_600_000).toISOString();
  const repositories = (await input.source.listRepositories())
    .filter(({ fullName, archived }) => !archived && fullName.startsWith(`${input.owner}/`))
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
  if (input.priorSnapshot !== undefined && input.priorSnapshot.owner !== input.owner) throw new Error('prior snapshot owner does not match');
  const priorRuns = groupJobsByRun(input.priorSnapshot?.jobs ?? []);
  const priorRunEvidence = new Map((input.priorSnapshot?.runs ?? [])
    .filter(({ reusable }) => reusable)
    .map((run) => [run.key, run]));
  const results = await mapLimit(repositories, 4, async (repository) => {
    const runs = await input.source.listRuns(repository.fullName, windowStart);
    const jobs: TelemetryJob[] = [];
    const evidence: TelemetryRunEvidence[] = [];
    for (const run of runs) {
      const key = runKey(repository.fullName, run.id, run.attempt);
      if (run.conclusion.length === 0) {
        evidence.push(runEvidence(repository.fullName, run, 0, false));
        continue;
      }
      const priorEvidence = priorRunEvidence.get(key);
      if (priorEvidence !== undefined && sameRunEvidence(priorEvidence, repository.fullName, run)) {
        const priorJobs = priorRuns.get(key) ?? [];
        jobs.push(...priorJobs);
        evidence.push(runEvidence(repository.fullName, run, priorJobs.length, true));
        continue;
      }
      const normalized = (await input.source.listJobs(repository.fullName, run.id, run.attempt))
        .map((job) => normalizeTelemetryJob(repository, run, job));
      jobs.push(...normalized);
      evidence.push(runEvidence(
        repository.fullName,
        run,
        normalized.length,
        normalized.every(({ measurementStatus }) => measurementStatus !== 'incomplete'),
      ));
    }
    input.onRepository?.(repository.fullName);
    return { jobs, evidence };
  });
  const jobs = results.flatMap(({ jobs: repositoryJobs }) => repositoryJobs);
  const runs = results.flatMap(({ evidence }) => evidence).sort((left, right) => left.key.localeCompare(right.key));
  const runsScanned = runs.length;
  const collectedAt = new Date(input.nowMs ?? Date.now()).toISOString();
  jobs.sort((left, right) => left.key.localeCompare(right.key));
  return {
    schemaVersion: 1,
    owner: input.owner,
    collectedAt,
    windowStart,
    rates: TELEMETRY_RATES,
    repositoryInventory: repositories.map(({ fullName, visibility }) => ({ fullName, visibility })),
    repositoriesScanned: repositories.length,
    runsScanned,
    runs,
    jobs,
  };
}

function runEvidence(repository: string, run: TelemetryRun, jobsObserved: number, reusable: boolean): TelemetryRunEvidence {
  return { key: runKey(repository, run.id, run.attempt), repository, ...run, jobsObserved, reusable };
}

function sameRunEvidence(evidence: TelemetryRunEvidence, repository: string, run: TelemetryRun): boolean {
  return evidence.repository === repository
    && evidence.id === run.id
    && evidence.attempt === run.attempt
    && evidence.workflowName === run.workflowName
    && evidence.event === run.event
    && evidence.createdAt === run.createdAt
    && evidence.conclusion === run.conclusion;
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

export function aggregateTelemetry(
  snapshots: readonly TelemetrySnapshot[],
  sinceMs: number,
  registry?: FleetRegistry,
  evidenceById: ReadonlyMap<string, ControllerEvidence> = new Map(),
): TelemetryReport {
  if (!Number.isFinite(sinceMs) || sinceMs < 0) throw new Error('since must be a non-negative timestamp');
  const byKey = new Map<string, TelemetryJob>();
  let latestSnapshot: TelemetrySnapshot | undefined;
  let throughMs = sinceMs;
  for (const snapshot of snapshots) {
    throughMs = Math.max(throughMs, Date.parse(snapshot.collectedAt));
    if (latestSnapshot === undefined || Date.parse(snapshot.collectedAt) > Date.parse(latestSnapshot.collectedAt)) latestSnapshot = snapshot;
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
  const repositoryNames = new Set(latestSnapshot?.repositoryInventory.map(({ fullName }) => fullName) ?? []);
  for (const job of jobs) repositoryNames.add(job.repository);
  const byRepository = [...repositoryNames].sort().map((repository) => {
    const repositoryJobs = jobs.filter((job) => job.repository === repository);
    const repositoryHosted = repositoryJobs.filter(({ runnerKind }) => runnerKind === 'github-hosted');
    const repositoryCirujano = repositoryJobs.filter(({ runnerKind }) => runnerKind === 'cirujano');
    return {
      repository,
      jobs: repositoryJobs.length,
      githubHostedMinutes: sumKnown(repositoryHosted, 'billableMinutes'),
      githubHostedListCostUsd: money(sumKnown(repositoryHosted, 'actualGithubListCostUsd')),
      cirujanoJobs: repositoryCirujano.length,
      cirujanoMinutes: sumKnown(repositoryCirujano, 'billableMinutes'),
      grossHostedCostAvoidedUsd: money(sumKnown(repositoryCirujano, 'counterfactualHostedCostUsd')),
      unpricedJobs: repositoryJobs.filter(({ actualGithubListCostUsd, counterfactualHostedCostUsd }) => actualGithubListCostUsd === null || counterfactualHostedCostUsd === null).length,
    };
  });
  const visibilityByRepository = new Map(latestSnapshot?.repositoryInventory.map(({ fullName, visibility }) => [fullName, visibility]) ?? []);
  const enrollments = registry?.enrollments.map((enrollment) => enrollmentReport(enrollment, jobs, evidenceById.get(enrollment.id), visibilityByRepository));
  return {
    schemaVersion: 1,
    since: new Date(sinceMs).toISOString(),
    through: new Date(throughMs).toISOString(),
    repositories: repositoryNames.size,
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
    byRepository,
    ...(enrollments === undefined ? {} : { enrollments, fleet: fleetSavings(enrollments) }),
  };
}

function enrollmentReport(
  enrollment: FleetEnrollment,
  jobs: readonly TelemetryJob[],
  evidence: ControllerEvidence | undefined,
  visibilityByRepository: ReadonlyMap<string, RepositoryVisibility>,
): TelemetryEnrollmentReport {
  const cutoverAt = enrollment.after?.recordedAt ?? null;
  const cutoverMs = cutoverAt === null ? Number.POSITIVE_INFINITY : Date.parse(cutoverAt);
  const enrolled = jobs.filter((job) => job.repository === enrollment.repository
    && job.workflowName === enrollment.workflowName && enrollment.jobNames.includes(job.jobName));
  const before = enrolled.filter((job) => Date.parse(job.createdAt) < cutoverMs);
  const after = enrolled.filter((job) => Date.parse(job.createdAt) >= cutoverMs);
  const cirujano = after.filter(({ runnerKind }) => runnerKind === 'cirujano');
  const latencies = cirujano
    .filter((job) => job.startedAt !== null)
    .map((job) => Math.max(0, Date.parse(job.startedAt!) - Date.parse(job.createdAt)))
    .sort((left, right) => left - right);
  const grossHostedCostAvoidedUsd = money(sumKnown(cirujano, 'counterfactualHostedCostUsd'));
  const base = {
    id: enrollment.id,
    repository: enrollment.repository,
    visibility: visibilityByRepository.get(enrollment.repository) ?? enrolled[0]?.visibility ?? null,
    workflowName: enrollment.workflowName,
    jobNames: [...enrollment.jobNames],
    status: enrollment.status,
    cutoverAt,
    before: windowReport(before),
    after: {
      ...windowReport(after),
      cirujanoJobs: cirujano.length,
      cirujanoMinutes: sumKnown(cirujano, 'billableMinutes'),
      grossHostedCostAvoidedUsd,
      queueLatencySamples: latencies.length,
      queueLatencyP50Ms: percentile(latencies, 0.5),
      queueLatencyP95Ms: percentile(latencies, 0.95),
    },
  };
  const noCost = {
    vmStarts: null, controllerJournaledCostUsd: null,
    nebiusComputeUsd: null, nebiusDiskUsd: null, nebiusNetworkUsd: null, nebiusTotalUsd: null, netSavingsUsd: null,
    assignments: [], unmatchedCirujanoJobs: [],
  };
  if (enrollment.status === 'proposed') return { ...base, ...noCost, complete: false, incompleteReason: 'not cut over' };
  if (evidence === undefined) return { ...base, ...noCost, complete: false, incompleteReason: 'controller evidence is absent' };
  const cost = estimateRunnerCost({
    rates: evidence.rates,
    computeIntervals: [{ startMs: 0, endMs: evidence.cumulativeRuntimeMs }],
    disk: { sizeGiB: evidence.diskSizeGiB, retainedMs: evidence.diskRetainedMs },
    networkEgressGiB: evidence.networkEgressBytes / 1_073_741_824,
    hostedBillableMinutes: base.after.cirujanoMinutes,
  });
  if (!cost.complete) return { ...base, ...noCost, complete: false, incompleteReason: `controller cost is incomplete: ${cost.reason}` };
  const assignmentByKey = new Map(evidence.assignments.map((entry) => [`${entry.runId}:${entry.runAttempt}:${entry.jobId}`, entry]));
  const assignments: EnrollmentAssignment[] = [];
  const unmatchedCirujanoJobs: string[] = [];
  for (const job of cirujano) {
    const assignment = assignmentByKey.get(`${job.runId}:${job.runAttempt}:${job.jobId}`);
    if (assignment === undefined) unmatchedCirujanoJobs.push(job.key);
    else assignments.push({ runId: assignment.runId, jobId: assignment.jobId, runnerId: assignment.runnerId, runnerName: assignment.runnerName });
  }
  const incompleteReason = unmatchedCirujanoJobs.length === 0
    ? null
    : `${unmatchedCirujanoJobs.length} Cirujano job${unmatchedCirujanoJobs.length === 1 ? '' : 's'} credited by telemetry ${unmatchedCirujanoJobs.length === 1 ? 'has' : 'have'} no controller assignment`;
  return {
    ...base,
    vmStarts: evidence.startCount,
    controllerJournaledCostUsd: evidence.cumulativeCostUsd,
    nebiusComputeUsd: cost.computeUsd,
    nebiusDiskUsd: cost.diskUsd,
    nebiusNetworkUsd: cost.networkUsd,
    nebiusTotalUsd: cost.runnerTotalUsd,
    netSavingsUsd: money(grossHostedCostAvoidedUsd - cost.runnerTotalUsd),
    assignments,
    unmatchedCirujanoJobs,
    complete: incompleteReason === null,
    incompleteReason,
  };
}

function fleetSavings(enrollments: readonly TelemetryEnrollmentReport[]): FleetSavingsReport {
  const cutOver = enrollments.filter(({ status }) => status !== 'proposed');
  const grossHostedCostAvoidedUsd = money(cutOver.reduce((total, row) => total + row.after.grossHostedCostAvoidedUsd, 0));
  const costed = cutOver.every((row) => row.nebiusTotalUsd !== null);
  const nebiusTotalUsd = costed ? money(cutOver.reduce((total, row) => total + (row.nebiusTotalUsd ?? 0), 0)) : null;
  return {
    enrollments: cutOver.length,
    grossHostedCostAvoidedUsd,
    nebiusTotalUsd,
    netSavingsUsd: nebiusTotalUsd === null ? null : money(grossHostedCostAvoidedUsd - nebiusTotalUsd),
    complete: cutOver.every((row) => row.complete),
  };
}

function windowReport(jobs: readonly TelemetryJob[]): EnrollmentWindowReport {
  const hosted = jobs.filter(({ runnerKind }) => runnerKind === 'github-hosted');
  return {
    jobs: jobs.length,
    hostedJobs: hosted.length,
    hostedMinutes: sumKnown(hosted, 'billableMinutes'),
    hostedListCostUsd: money(sumKnown(hosted, 'actualGithubListCostUsd')),
  };
}

/** Nearest-rank percentile over ascending samples; null without samples. */
function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil(fraction * sorted.length))) - 1]!;
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
    '## By repository',
    '',
    '| Repository | Jobs | Hosted minutes | Hosted list cost | Cirujano jobs | Cirujano minutes | Gross cost avoided | Unknown price |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.byRepository.map((repository) =>
      `| \`${repository.repository}\` | ${repository.jobs} | ${repository.githubHostedMinutes} | $${repository.githubHostedListCostUsd.toFixed(2)} | ${repository.cirujanoJobs} | ${repository.cirujanoMinutes} | $${repository.grossHostedCostAvoidedUsd.toFixed(2)} | ${repository.unpricedJobs} |`),
    '',
    ...(report.enrollments === undefined ? [] : renderEnrollmentsMarkdown(report.enrollments, report.fleet)),
    'Gross avoided cost excludes Nebius cost. Net savings require provider accounting.',
    '',
  ].join('\n');
}

function renderEnrollmentsMarkdown(enrollments: readonly TelemetryEnrollmentReport[], fleet: FleetSavingsReport | undefined): string[] {
  return [
    '## Enrollments',
    '',
    '| Enrollment | Repository | Workflow / job | Status | Before jobs | Before hosted min | Before hosted cost | After jobs | After hosted jobs | After Cirujano jobs | After Cirujano min | Gross avoided | Queue p50 | Queue p95 | Nebius cost | Net savings |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...enrollments.map((row) => [
      row.id, `\`${row.repository}\``, `${row.workflowName} / ${row.jobNames.join(', ')}`, row.status,
      row.before.jobs, row.before.hostedMinutes, usd(row.before.hostedListCostUsd),
      row.after.jobs, row.after.hostedJobs, row.after.cirujanoJobs, row.after.cirujanoMinutes, usd(row.after.grossHostedCostAvoidedUsd),
      minutes(row.after.queueLatencyP50Ms), minutes(row.after.queueLatencyP95Ms),
      row.nebiusTotalUsd === null ? 'n/a' : usd(row.nebiusTotalUsd), row.netSavingsUsd === null ? 'n/a' : usd(row.netSavingsUsd),
    ].map(String).join(' | ')).map((cells) => `| ${cells} |`),
    '',
    ...enrollments.filter((row) => row.visibility === 'public').map((row) => `- ${row.id} is a public repository: hosted minutes are free, so migration only adds provider cost.`),
    ...enrollments.filter((row) => !row.complete && row.status !== 'proposed').map((row) => `- ${row.id} is incomplete: ${row.incompleteReason ?? 'unknown reason'}.`),
    ...(enrollments.some((row) => row.visibility === 'public' || (!row.complete && row.status !== 'proposed')) ? [''] : []),
    ...(fleet === undefined ? [] : [fleetLine(fleet), '']),
    'Queue latency is job start minus run creation for Cirujano jobs after the cutover; it includes controller poll, VM start and boot time.',
    '',
    ...LIMITS_PARAGRAPH,
    '',
  ];
}

const LIMITS_PARAGRAPH = [
  'Limits: gross avoided cost uses GitHub list prices and per-job rounded minutes; the',
  'private-account allowance is not subtracted. Nebius cost is the controller journal at the',
  'dated config rates (compute runtime, retained boot disk over a 30-day month, observed egress).',
  'One VM per enrollment runs jobs one at a time (single-slot), so parallel matrices serialize,',
  'and the controller runs on a Mac that sleeps: queued jobs wait until it wakes. Net savings',
  'are gross avoided cost minus Nebius cost and are negative until enough hosted minutes move.',
];

function fleetLine(fleet: FleetSavingsReport): string {
  const nebius = fleet.nebiusTotalUsd === null ? 'n/a' : usd(fleet.nebiusTotalUsd);
  const net = fleet.netSavingsUsd === null ? 'n/a' : usd(fleet.netSavingsUsd);
  const noun = fleet.enrollments === 1 ? 'enrollment' : 'enrollments';
  return `Fleet: gross avoided ${usd(fleet.grossHostedCostAvoidedUsd)} / Nebius cost ${nebius} / net savings ${net} (${fleet.enrollments} cut-over ${noun}, ${fleet.complete ? 'complete' : 'incomplete'})`;
}

/**
 * The publishable 45-day report: P-handles only, no repository names, no resource identities,
 * fleet-wide usage, per-enrollment savings and the limits paragraph.
 */
export function renderFleetSavingsMarkdown(report: TelemetryReport): string {
  if (report.enrollments === undefined || report.fleet === undefined) throw new Error('fleet savings report requires a registry');
  const success = report.successRate === null ? 'n/a' : `${(report.successRate * 100).toFixed(1)}%`;
  return [
    '# Cirujano fleet migration: net savings',
    '',
    `Window: ${report.since} through ${report.through}`,
    '',
    '| Fleet metric | Value |',
    '| --- | ---: |',
    `| Repositories | ${report.repositories} |`,
    `| Jobs | ${report.jobs} |`,
    `| Success rate | ${success} |`,
    `| GitHub-hosted minutes | ${report.githubHostedMinutes} |`,
    `| GitHub-hosted list cost | ${usd(report.githubHostedListCostUsd)} |`,
    `| Cirujano jobs | ${report.cirujanoJobs} |`,
    `| Cirujano job minutes | ${report.cirujanoMinutes} |`,
    `| Gross hosted cost avoided | ${usd(report.grossHostedCostAvoidedUsd)} |`,
    '',
    '## Enrollments',
    '',
    '| Enrollment | Status | Before jobs | Before hosted min | Before hosted cost | After jobs | After hosted jobs | After Cirujano jobs | After Cirujano min | Gross avoided | Queue p50 | Queue p95 | VM starts | Nebius cost | Net savings | Complete |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.enrollments.map((row) => [
      row.id, row.status,
      row.before.jobs, row.before.hostedMinutes, usd(row.before.hostedListCostUsd),
      row.after.jobs, row.after.hostedJobs, row.after.cirujanoJobs, row.after.cirujanoMinutes, usd(row.after.grossHostedCostAvoidedUsd),
      minutes(row.after.queueLatencyP50Ms), minutes(row.after.queueLatencyP95Ms),
      row.vmStarts === null ? 'n/a' : row.vmStarts,
      row.nebiusTotalUsd === null ? 'n/a' : usd(row.nebiusTotalUsd), row.netSavingsUsd === null ? 'n/a' : usd(row.netSavingsUsd),
      row.complete ? 'yes' : 'no',
    ].map(String).join(' | ')).map((cells) => `| ${cells} |`),
    '',
    ...report.enrollments.filter((row) => row.visibility === 'public').map((row) => `- ${row.id} is a public repository: hosted minutes are free, so migration only adds provider cost.`),
    ...report.enrollments.filter((row) => !row.complete && row.status !== 'proposed').map((row) => `- ${row.id} is incomplete: ${row.incompleteReason ?? 'unknown reason'}.`),
    ...(report.enrollments.some((row) => row.visibility === 'public' || (!row.complete && row.status !== 'proposed')) ? [''] : []),
    fleetLine(report.fleet),
    '',
    'Queue latency is job start minus run creation for Cirujano jobs after the cutover; it includes controller poll, VM start and boot time.',
    '',
    ...LIMITS_PARAGRAPH,
    '',
  ].join('\n');
}

function usd(value: number): string {
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(3)}`;
}

function minutes(valueMs: number | null): string {
  return valueMs === null ? 'n/a' : `${(valueMs / 60_000).toFixed(1)} min`;
}

export function normalizeTelemetryJob(repository: TelemetryRepository, run: TelemetryRun, job: TelemetryJobInput): TelemetryJob {
  const hasStart = job.startedAt !== null;
  const hasEnd = job.completedAt !== null;
  const startMs = hasStart ? Date.parse(job.startedAt!) : Number.NaN;
  const endMs = hasEnd ? Date.parse(job.completedAt!) : Number.NaN;
  const hasValidTiming = hasStart && hasEnd && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs;
  const measurementStatus: MeasurementStatus = hasValidTiming ? 'measured' : !hasStart && !hasEnd ? 'not-run' : 'incomplete';
  const minutes = measurementStatus === 'measured'
    ? billableMinutesForJob({ name: job.name, startedAt: job.startedAt, completedAt: job.completedAt })
    : measurementStatus === 'not-run' ? 0 : null;
  const durationMs = measurementStatus === 'measured'
    ? endMs - startMs
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

/** The hosted SKU GitHub bills for a hosted runner selection, or null when the labels are unpriced. */
export function hostedSkuForLabels(labels: readonly string[]): HostedSku | null {
  return hostedSku(labels, 'github-hosted');
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
