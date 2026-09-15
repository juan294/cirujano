import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import type { FleetRegistry } from './fleet-registry.js';
import {
  array,
  boolean,
  nonnegativeInteger,
  nullableText,
  nullableTimestamp,
  positiveInteger,
  record,
  text,
  timestamp,
} from './github-api.js';
import {
  aggregateTelemetry,
  normalizeTelemetryJob,
  TELEMETRY_RATES,
  type ControllerEvidence,
  type TelemetryReport,
  type TelemetryRepository,
  type TelemetrySnapshot,
} from './telemetry.js';

/** Aggregates every validated snapshot in the store from `since`, refusing a store that does not cover it. */
export async function buildStoreReport(input: {
  storePath: string;
  since: string;
  registry?: FleetRegistry;
  evidenceById?: ReadonlyMap<string, ControllerEvidence>;
}): Promise<TelemetryReport> {
  const snapshots = await readSnapshots(absoluteStore(input.storePath));
  const sinceMs = Date.parse(`${input.since}T00:00:00Z`);
  if (!snapshots.some((snapshot) => Date.parse(snapshot.windowStart) <= sinceMs && Date.parse(snapshot.collectedAt) >= sinceMs)) {
    throw new Error(`telemetry snapshots do not cover ${input.since}`);
  }
  if (input.registry !== undefined && input.registry.owner !== snapshots[0]!.owner) {
    throw new Error(`registry owner ${input.registry.owner} does not match telemetry owner ${snapshots[0]!.owner}`);
  }
  return aggregateTelemetry(snapshots, sinceMs, input.registry, input.evidenceById);
}

export async function readLatestSnapshot(directory: string, date: string): Promise<TelemetrySnapshot | undefined> {
  try {
    const name = (await readdir(directory))
      .filter((entry) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(entry) && entry <= `${date}.json`)
      .sort()
      .at(-1);
    if (name === undefined) return undefined;
    const value: unknown = JSON.parse(await readFile(join(directory, name), 'utf8'));
    return validateSnapshot(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`latest prior snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readSnapshots(directory: string): Promise<TelemetrySnapshot[]> {
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
  const repositoriesScanned = nonnegativeInteger(root['repositoriesScanned'], 'repositoriesScanned');
  const runsScanned = nonnegativeInteger(root['runsScanned'], 'runsScanned');
  if (JSON.stringify(root['rates']) !== JSON.stringify(TELEMETRY_RATES)) throw new Error('rates do not match the dated collector rate table');
  const repositoryInventory = new Map<string, TelemetryRepository['visibility']>();
  for (const [index, entry] of array(root['repositoryInventory'], 'repositoryInventory').entries()) {
    const repository = record(entry, `repositoryInventory[${index}]`);
    const fullName = text(repository['fullName'], `repositoryInventory[${index}].fullName`);
    if (!fullName.startsWith(`${root['owner'] as string}/`)) throw new Error(`repositoryInventory[${index}] is outside snapshot owner`);
    const visibility = repository['visibility'];
    if (visibility !== 'private' && visibility !== 'public') throw new Error(`repositoryInventory[${index}].visibility is invalid`);
    if (repositoryInventory.has(fullName)) throw new Error(`duplicate repository inventory entry ${fullName}`);
    repositoryInventory.set(fullName, visibility);
  }
  if (repositoryInventory.size !== repositoriesScanned) throw new Error('repositoryInventory does not match repositoriesScanned');
  const runs = new Map<string, TelemetrySnapshot['runs'][number]>();
  for (const [index, entry] of array(root['runs'], 'runs').entries()) {
    const run = record(entry, `runs[${index}]`);
    const repository = text(run['repository'], `runs[${index}].repository`);
    const id = positiveInteger(run['id'], `runs[${index}].id`);
    const attempt = positiveInteger(run['attempt'], `runs[${index}].attempt`);
    const key = text(run['key'], `runs[${index}].key`);
    if (key !== `${repository}:${id}:${attempt}`) throw new Error(`runs[${index}].key is inconsistent`);
    if (!repositoryInventory.has(repository)) throw new Error(`runs[${index}].repository is absent from inventory`);
    const createdAt = timestamp(run['createdAt'], `runs[${index}].createdAt`);
    if (Date.parse(createdAt) < Date.parse(root['windowStart'] as string)) throw new Error(`runs[${index}].createdAt precedes windowStart`);
    if (Date.parse(createdAt) > Date.parse(root['collectedAt'] as string)) throw new Error(`runs[${index}].createdAt follows collectedAt`);
    const value = {
      key, repository, id, attempt,
      workflowName: text(run['workflowName'], `runs[${index}].workflowName`),
      event: text(run['event'], `runs[${index}].event`),
      createdAt,
      conclusion: nullableText(run['conclusion'], `runs[${index}].conclusion`),
      jobsObserved: nonnegativeInteger(run['jobsObserved'], `runs[${index}].jobsObserved`),
      reusable: boolean(run['reusable'], `runs[${index}].reusable`),
    };
    if (runs.has(key)) throw new Error(`duplicate run evidence ${key}`);
    runs.set(key, value);
  }
  if (runs.size !== runsScanned) throw new Error('runs do not match runsScanned');
  const keys = new Set<string>();
  const runJobs = new Map<string, TelemetrySnapshot['jobs']>();
  for (const [index, entry] of array(root['jobs'], 'jobs').entries()) {
    const job = validateJob(entry, `jobs[${index}]`);
    if (!job.repository.startsWith(`${root['owner'] as string}/`)) throw new Error(`jobs[${index}].repository is outside snapshot owner`);
    if (!repositoryInventory.has(job.repository)) throw new Error(`jobs[${index}].repository is absent from inventory`);
    if (Date.parse(job.createdAt) < Date.parse(root['windowStart'] as string)) throw new Error(`jobs[${index}].createdAt precedes windowStart`);
    if (Date.parse(job.createdAt) > Date.parse(root['collectedAt'] as string)) throw new Error(`jobs[${index}].createdAt follows collectedAt`);
    if (job.startedAt !== null && Date.parse(job.startedAt) < Date.parse(job.createdAt)) throw new Error(`jobs[${index}].startedAt precedes createdAt`);
    if (job.completedAt !== null && Date.parse(job.completedAt) > Date.parse(root['collectedAt'] as string)) throw new Error(`jobs[${index}].completedAt follows collectedAt`);
    if (keys.has(job.key)) throw new Error(`duplicate job key ${job.key}`);
    keys.add(job.key);
    const key = `${job.repository}:${job.runId}:${job.runAttempt}`;
    const jobs = runJobs.get(key) ?? [];
    jobs.push(job);
    runJobs.set(key, jobs);
  }
  for (const [key, run] of runs) {
    const jobs = runJobs.get(key) ?? [];
    if (jobs.length !== run.jobsObserved) throw new Error(`run job count is inconsistent for ${key}`);
    if (jobs.some((job) => job.workflowName !== run.workflowName || job.event !== run.event
      || job.createdAt !== run.createdAt)) {
      throw new Error(`run metadata is inconsistent for ${key}`);
    }
    const conclusive = run.conclusion.length > 0
      && jobs.every(({ measurementStatus }) => measurementStatus !== 'incomplete');
    if (run.reusable !== conclusive) throw new Error(`reusable run state is inconsistent for ${key}`);
    runJobs.delete(key);
  }
  if (runJobs.size !== 0) throw new Error(`job run ${runJobs.keys().next().value as string} is absent from run evidence`);
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

export function absoluteStore(value: string): string {
  const expanded = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  if (!isAbsolute(expanded)) throw new Error('telemetry store must be an absolute path');
  return expanded;
}
