import { execFile as execFileCallback } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import type { TelemetryArguments } from './args.js';
import type { CliIo, TelemetryCommandService } from './cli.js';
import {
  aggregateTelemetry,
  collectTelemetry,
  normalizeTelemetryJob,
  renderTelemetryMarkdown,
  TELEMETRY_RATES,
  writeTelemetrySnapshot,
  type GitHubTelemetrySource,
  type TelemetryJobInput,
  type TelemetryRepository,
  type TelemetryRun,
  type TelemetrySnapshot,
} from './telemetry.js';

const execFile = promisify(execFileCallback);

export function createTelemetryCommandService(environment: NodeJS.ProcessEnv = process.env): TelemetryCommandService {
  return {
    async run(args, io) {
      if (args.action === 'collect') return collect(args, io, environment);
      return report(args, io);
    },
  };
}

async function collect(
  args: Extract<TelemetryArguments, { action: 'collect' }>,
  io: CliIo,
  environment: NodeJS.ProcessEnv,
): Promise<0> {
  const storePath = absoluteStore(args.storePath);
  const source = githubSource(environment['CIRUJANO_GH_PATH'] ?? '/opt/homebrew/bin/gh');
  const priorSnapshot = await readDailySnapshot(storePath, new Date().toISOString().slice(0, 10));
  const snapshot = await collectTelemetry({
    owner: args.owner,
    lookbackHours: args.lookbackHours,
    source,
    ...(priorSnapshot === undefined ? {} : { priorSnapshot }),
  });
  const path = await writeTelemetrySnapshot(storePath, snapshot);
  io.stdout(`${JSON.stringify({ status: 'collected', path, repositories: snapshot.repositoriesScanned, runs: snapshot.runsScanned, jobs: snapshot.jobs.length })}\n`);
  return 0;
}

async function readDailySnapshot(directory: string, date: string): Promise<TelemetrySnapshot | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(directory, `${date}.json`), 'utf8'));
    return validateSnapshot(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`existing daily snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function report(
  args: Extract<TelemetryArguments, { action: 'report' }>,
  io: CliIo,
): Promise<0> {
  const snapshots = await readSnapshots(absoluteStore(args.storePath));
  const sinceMs = Date.parse(`${args.since}T00:00:00Z`);
  if (!snapshots.some((snapshot) => Date.parse(snapshot.windowStart) <= sinceMs && Date.parse(snapshot.collectedAt) >= sinceMs)) {
    throw new Error(`telemetry snapshots do not cover ${args.since}`);
  }
  const value = aggregateTelemetry(snapshots, sinceMs);
  io.stdout(args.format === 'json' ? `${JSON.stringify(value)}\n` : renderTelemetryMarkdown(value));
  return 0;
}

function githubSource(ghPath: string): GitHubTelemetrySource {
  return {
    async listRepositories(): Promise<TelemetryRepository[]> {
      const pages = await githubPages(ghPath, '/user/repos?per_page=100&affiliation=owner');
      return pages.flatMap((page) => array(page, 'repository page').map((entry) => {
        const value = record(entry, 'repository');
        const visibility = value['visibility'];
        if (visibility !== 'private' && visibility !== 'public') throw new Error('repository visibility is invalid');
        return {
          fullName: text(value['full_name'], 'repository.full_name'),
          visibility,
          archived: boolean(value['archived'], 'repository.archived'),
        };
      }));
    },
    async listRuns(repository, windowStart): Promise<TelemetryRun[]> {
      const pages = await githubPages(ghPath, `/repos/${repository}/actions/runs?per_page=100&status=completed&created=>=${windowStart}`);
      return pages.flatMap((page) => array(record(page, 'runs page')['workflow_runs'], 'workflow_runs').map((entry) => {
        const value = record(entry, 'workflow run');
        return {
          id: positiveInteger(value['id'], 'run.id'),
          attempt: positiveInteger(value['run_attempt'], 'run.run_attempt'),
          workflowName: text(value['name'], 'run.name'),
          event: text(value['event'], 'run.event'),
          createdAt: timestamp(value['created_at'], 'run.created_at'),
          conclusion: nullableText(value['conclusion'], 'run.conclusion'),
        };
      }));
    },
    async listJobs(repository, runId, attempt): Promise<TelemetryJobInput[]> {
      const pages = await githubPages(ghPath, `/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`);
      return pages.flatMap((page) => array(record(page, 'jobs page')['jobs'], 'jobs').map((entry) => {
        const value = record(entry, 'job');
        return {
          id: positiveInteger(value['id'], 'job.id'),
          name: text(value['name'], 'job.name'),
          startedAt: nullableTimestamp(value['started_at'], 'job.started_at'),
          completedAt: nullableTimestamp(value['completed_at'], 'job.completed_at'),
          conclusion: text(value['conclusion'], 'job.conclusion'),
          labels: array(value['labels'], 'job.labels').map((label) => text(label, 'job label')),
          runnerName: nullableText(value['runner_name'], 'job.runner_name'),
          runnerGroupName: nullableText(value['runner_group_name'], 'job.runner_group_name'),
        };
      }));
    },
  };
}

async function githubPages(ghPath: string, endpoint: string): Promise<unknown[]> {
  const { stdout } = await execFile(ghPath, ['api', '--paginate', '--slurp', endpoint], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  const parsed: unknown = JSON.parse(stdout);
  return array(parsed, 'GitHub paginated response');
}

async function readSnapshots(directory: string): Promise<TelemetrySnapshot[]> {
  const names = (await readdir(directory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(name)).sort();
  const snapshots: TelemetrySnapshot[] = [];
  for (const name of names) {
    try {
      const value: unknown = JSON.parse(await readFile(join(directory, name), 'utf8'));
      snapshots.push(validateSnapshot(value));
    } catch (error) {
      throw new Error(`snapshot ${name} is malformed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (snapshots.length === 0) throw new Error('telemetry store has no snapshots');
  const owners = new Set(snapshots.map(({ owner }) => owner));
  if (owners.size !== 1) throw new Error('telemetry snapshots contain mixed owners');
  return snapshots;
}

function validateSnapshot(value: unknown): TelemetrySnapshot {
  const root = record(value, 'snapshot');
  if (root['schemaVersion'] !== 1) throw new Error('schemaVersion must be 1');
  text(root['owner'], 'owner');
  timestamp(root['collectedAt'], 'collectedAt');
  timestamp(root['windowStart'], 'windowStart');
  if (Date.parse(root['windowStart'] as string) > Date.parse(root['collectedAt'] as string)) throw new Error('windowStart is after collectedAt');
  nonnegativeInteger(root['repositoriesScanned'], 'repositoriesScanned');
  nonnegativeInteger(root['runsScanned'], 'runsScanned');
  if (JSON.stringify(root['rates']) !== JSON.stringify(TELEMETRY_RATES)) throw new Error('rates do not match the dated collector rate table');
  const keys = new Set<string>();
  for (const [index, entry] of array(root['jobs'], 'jobs').entries()) {
    const job = validateJob(entry, `jobs[${index}]`);
    if (!job.repository.startsWith(`${root['owner'] as string}/`)) throw new Error(`jobs[${index}].repository is outside snapshot owner`);
    if (Date.parse(job.createdAt) < Date.parse(root['windowStart'] as string)) throw new Error(`jobs[${index}].createdAt precedes windowStart`);
    if (Date.parse(job.createdAt) > Date.parse(root['collectedAt'] as string)) throw new Error(`jobs[${index}].createdAt follows collectedAt`);
    if (job.startedAt !== null && Date.parse(job.startedAt) < Date.parse(job.createdAt)) throw new Error(`jobs[${index}].startedAt precedes createdAt`);
    if (job.completedAt !== null && Date.parse(job.completedAt) > Date.parse(root['collectedAt'] as string)) throw new Error(`jobs[${index}].completedAt follows collectedAt`);
    if (keys.has(job.key)) throw new Error(`duplicate job key ${job.key}`);
    keys.add(job.key);
  }
  return value as TelemetrySnapshot;
}

function validateJob(value: unknown, name: string): TelemetrySnapshot['jobs'][number] {
  const job = record(value, name);
  for (const key of ['key', 'repository', 'workflowName', 'jobName', 'event', 'conclusion', 'createdAt'] as const) {
    text(job[key], `${name}.${key}`);
  }
  timestamp(job['createdAt'], `${name}.createdAt`);
  const startedAt = nullableTimestamp(job['startedAt'], `${name}.startedAt`);
  const completedAt = nullableTimestamp(job['completedAt'], `${name}.completedAt`);
  if (job['visibility'] !== 'private' && job['visibility'] !== 'public') throw new Error(`${name}.visibility is invalid`);
  for (const key of ['runId', 'runAttempt', 'jobId'] as const) positiveInteger(job[key], `${name}.${key}`);
  for (const key of ['runnerName', 'runnerGroupName'] as const) {
    if (typeof job[key] !== 'string') throw new Error(`${name}.${key} must be a string`);
  }
  const labels = array(job['labels'], `${name}.labels`).map((label) => text(label, `${name}.label`));
  const expected = normalizeTelemetryJob(
    { fullName: job['repository'] as string, visibility: job['visibility'], archived: false },
    {
      id: job['runId'] as number, attempt: job['runAttempt'] as number,
      workflowName: job['workflowName'] as string, event: job['event'] as string,
      createdAt: job['createdAt'] as string, conclusion: job['conclusion'] as string,
    },
    {
      id: job['jobId'] as number, name: job['jobName'] as string,
      startedAt, completedAt, conclusion: job['conclusion'] as string, labels,
      runnerName: job['runnerName'] as string, runnerGroupName: job['runnerGroupName'] as string,
    },
  );
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (JSON.stringify(job[key]) !== JSON.stringify(expected[key])) throw new Error(`${name}.${key} is inconsistent with source evidence`);
  }
  return expected;
}

function absoluteStore(value: string): string {
  const expanded = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  if (!isAbsolute(expanded)) throw new Error('telemetry store must be an absolute path');
  return expanded;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a nonempty string`);
  return value;
}

function nullableText(value: unknown, name: string): string {
  if (value === null || value === '') return '';
  return text(value, name);
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonnegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function timestamp(value: unknown, name: string): string {
  const result = text(value, name);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${name} must be a timestamp`);
  return result;
}

function nullableTimestamp(value: unknown, name: string): string | null {
  return value === null ? null : timestamp(value, name);
}
