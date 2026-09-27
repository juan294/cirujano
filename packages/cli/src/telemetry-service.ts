import type { TelemetryArguments } from './args.js';
import type { CliIo, TelemetryCommandService } from './cli.js';
import { loadControllerEvidence, readRegistry } from './fleet-service.js';
import {
  absolutePath,
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
import { buildStoreReport, readLatestSnapshot } from './telemetry-store.js';
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
  const storePath = absolutePath(args.storePath, 'telemetry store');
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
  const registry = args.registryPath === undefined ? undefined : await readRegistry(absolutePath(args.registryPath, 'fleet registry'));
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
      const latest = deduplicateRuns(pages.flatMap((page) => array(record(page, 'runs page')['workflow_runs'], 'workflow_runs')
        .map((entry) => parseTelemetryRun(entry))));
      const runs: TelemetryRun[] = [];
      for (const run of latest) {
        if (run.attempt === 1) {
          runs.push(run);
          continue;
        }
        // The listing can carry the original run time; attempt details carry
        // each retry's own creation time and conclusion.
        for (let attempt = 1; attempt <= run.attempt; attempt += 1) {
          const details = await githubPages(ghPath, `/repos/${repository}/actions/runs/${run.id}/attempts/${attempt}`, pageRunner);
          if (details.length !== 1) throw new Error(`run ${run.id} attempt ${attempt} returned ${details.length} records`);
          const prior = parseTelemetryRun(details[0]);
          if (prior.id !== run.id || prior.attempt !== attempt
            || prior.workflowName !== run.workflowName || prior.event !== run.event) {
            throw new Error(`run ${run.id} attempt ${attempt} metadata differs from the listed run`);
          }
          runs.push(prior);
        }
      }
      return runs;
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
          conclusion: nullableText(value['conclusion'], 'job.conclusion'),
          labels: array(value['labels'], 'job.labels').map((label) => text(label, 'job label')),
          runnerName: nullableText(value['runner_name'], 'job.runner_name'),
          runnerGroupName: nullableText(value['runner_group_name'], 'job.runner_group_name'),
        };
      }));
    },
  };
}

function parseTelemetryRun(entry: unknown): TelemetryRun {
  const value = record(entry, 'workflow run');
  return {
    id: positiveInteger(value['id'], 'run.id'),
    attempt: positiveInteger(value['run_attempt'], 'run.run_attempt'),
    workflowName: text(value['name'], 'run.name'),
    event: text(value['event'], 'run.event'),
    createdAt: timestamp(value['created_at'], 'run.created_at'),
    conclusion: nullableText(value['conclusion'], 'run.conclusion'),
  };
}

function deduplicateRuns(runs: readonly TelemetryRun[]): TelemetryRun[] {
  const byId = new Map<number, TelemetryRun>();
  for (const run of runs) {
    const existing = byId.get(run.id);
    if (existing !== undefined && existing.attempt === run.attempt && JSON.stringify(existing) !== JSON.stringify(run)) {
      throw new Error(`conflicting duplicate GitHub run ${run.id}:${run.attempt}`);
    }
    if (existing !== undefined && (existing.workflowName !== run.workflowName || existing.event !== run.event)) {
      throw new Error(`conflicting GitHub run metadata ${run.id}`);
    }
    if (existing === undefined || run.attempt > existing.attempt) byId.set(run.id, run);
  }
  return [...byId.values()];
}
