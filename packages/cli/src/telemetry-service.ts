import type { TelemetryArguments } from './args.js';
import type { CliIo, TelemetryCommandService } from './cli.js';
import { absoluteRegistry, loadControllerEvidence, readRegistry } from './fleet-service.js';
import {
  array,
  boolean,
  defaultGitHubPageRunner,
  githubCliPath,
  githubPages,
  nullableText,
  nullableTimestamp,
  positiveInteger,
  record,
  text,
  timestamp,
  type GitHubPageRunner,
} from './github-api.js';
import { absoluteStore, buildStoreReport, readLatestSnapshot } from './telemetry-store.js';
import {
  collectTelemetry,
  renderTelemetryMarkdown,
  writeTelemetrySnapshot,
  type GitHubTelemetrySource,
  type TelemetryJobInput,
  type TelemetryRepository,
  type TelemetryRun,
} from './telemetry.js';

export function createTelemetryCommandService(
  environment: NodeJS.ProcessEnv = process.env,
  pageRunner: GitHubPageRunner = defaultGitHubPageRunner,
): TelemetryCommandService {
  return {
    async run(args, io) {
      if (args.action === 'collect') return collect(args, io, environment, pageRunner);
      return report(args, io);
    },
  };
}

async function collect(
  args: Extract<TelemetryArguments, { action: 'collect' }>,
  io: CliIo,
  environment: NodeJS.ProcessEnv,
  pageRunner: GitHubPageRunner,
): Promise<0> {
  const storePath = absoluteStore(args.storePath);
  const source = githubSource(githubCliPath(environment), pageRunner);
  const priorSnapshot = await readLatestSnapshot(storePath, new Date().toISOString().slice(0, 10));
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

async function report(
  args: Extract<TelemetryArguments, { action: 'report' }>,
  io: CliIo,
): Promise<0> {
  const registry = args.registryPath === undefined ? undefined : await readRegistry(absoluteRegistry(args.registryPath));
  const evidenceById = registry === undefined ? undefined : await loadControllerEvidence(registry);
  const value = await buildStoreReport({
    storePath: args.storePath, since: args.since,
    ...(registry === undefined ? {} : { registry }),
    ...(evidenceById === undefined ? {} : { evidenceById }),
  });
  io.stdout(args.format === 'json' ? `${JSON.stringify(value)}\n` : renderTelemetryMarkdown(value));
  return 0;
}

function githubSource(ghPath: string, pageRunner: GitHubPageRunner): GitHubTelemetrySource {
  return {
    async listRepositories(): Promise<TelemetryRepository[]> {
      const pages = await githubPages(ghPath, '/user/repos?per_page=100&affiliation=owner', pageRunner);
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
      const pages = await githubPages(ghPath, `/repos/${repository}/actions/runs?per_page=100&status=completed&created=>=${windowStart}`, pageRunner);
      const runs = pages.flatMap((page) => array(record(page, 'runs page')['workflow_runs'], 'workflow_runs').map((entry) => {
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
      return deduplicateRuns(runs);
    },
    async listJobs(repository, runId, attempt): Promise<TelemetryJobInput[]> {
      const pages = await githubPages(ghPath, `/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`, pageRunner);
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

function deduplicateRuns(runs: readonly TelemetryRun[]): TelemetryRun[] {
  const byKey = new Map<string, TelemetryRun>();
  for (const run of runs) {
    const key = `${run.id}:${run.attempt}`;
    const existing = byKey.get(key);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(run)) {
      throw new Error(`conflicting duplicate GitHub run ${key}`);
    }
    byKey.set(key, run);
  }
  return [...byKey.values()];
}
