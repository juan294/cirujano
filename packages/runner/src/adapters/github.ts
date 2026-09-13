import type { OwnershipStatus, QueueSnapshot } from '../contracts.js';

const API_VERSION = '2026-03-10';
const ACTIVE_RUN_STATUS_LIST = ['queued', 'in_progress', 'waiting', 'requested', 'pending'] as const;
const ACTIVE_RUN_STATUSES = new Set<string>(ACTIVE_RUN_STATUS_LIST);
const RUN_STATUSES = new Set([...ACTIVE_RUN_STATUSES, 'completed']);
const JOB_STATUSES = new Set([...ACTIVE_RUN_STATUSES, 'completed']);
const CONCLUSIONS = new Set([
  'action_required', 'cancelled', 'failure', 'neutral', 'skipped',
  'stale', 'startup_failure', 'success', 'timed_out', null,
]);

export class GitHubResponseError extends Error {
  override name = 'GitHubResponseError';
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExternalProcess {
  run(command: string, args: readonly string[], options: { timeoutMs: number; stdin?: string }): Promise<ProcessResult>;
}

export interface IncludedResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface GitHubRepository {
  id: number;
  nameWithOwner: string;
  visibility: 'private';
  fork: false;
}

export interface WorkflowRun {
  id: number;
  workflowId: number;
  runAttempt: number;
  status: string;
  conclusion: string | null;
  event: string;
  headBranch: string;
  headSha: string;
  repositoryId: number;
  headRepositoryId: number;
  pullRequestCount: number;
}

export interface WorkflowJob {
  key: string;
  id: number;
  runId: number;
  runAttempt: number;
  headSha: string;
  status: string;
  conclusion: string | null;
  name: string;
  labels: readonly string[];
  runnerId: number | null;
  runnerName: string | null;
  runnerGroupId: number | null;
  runnerGroupName: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RepositoryRunner {
  id: number;
  name: string;
  os: string;
  status: 'online' | 'offline';
  busy: boolean;
  labels: readonly string[];
}

export interface Collection<T> {
  complete: boolean;
  items: readonly T[];
  reason?: string;
  retryAfterMs?: number;
}

export interface QueueCollectionInput {
  repository: GitHubRepository;
  expectedRepository: { id: number; nameWithOwner: string };
  runs: Collection<WorkflowRun>;
  jobs: Collection<WorkflowJob>;
  runners: Collection<RepositoryRunner>;
  workflowIds: readonly number[];
  allowedBranch: string;
  eligibleJobNames: readonly string[];
  runnerLabel: string;
  expectedRunnerName: string;
  journaledRunnerId?: number;
  observedAtMs: number;
}

export interface GitHubQueueSnapshot extends QueueSnapshot {
  retryAfterMs?: number;
  reason?: string;
}

export interface RunnerOwnership {
  ownership: OwnershipStatus;
  matches: readonly RepositoryRunner[];
  runner: RepositoryRunner | null;
}

export class RegistrationToken {
  readonly expiresAt: string;
  readonly #token: string;

  constructor(token: string, expiresAt: string) {
    this.#token = token;
    this.expiresAt = expiresAt;
  }

  consume(): string {
    return this.#token;
  }

  toJSON(): { expiresAt: string; token: '[REDACTED]' } {
    return { expiresAt: this.expiresAt, token: '[REDACTED]' };
  }

  toString(): string {
    return '[REDACTED GitHub registration token]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GitHubResponseError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, context: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < (allowZero ? 0 : 1)) {
    throw new GitHubResponseError(`${context} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`);
  }
  return value as number;
}

function string(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new GitHubResponseError(`${context} must be a non-empty string`);
  return value;
}

function nullableString(value: unknown, context: string): string | null {
  if (value === null) return null;
  return string(value, context);
}

function nullableInteger(value: unknown, context: string): number | null {
  if (value === null) return null;
  return integer(value, context);
}

function parseConclusion(value: unknown, context: string): string | null {
  if (!CONCLUSIONS.has(value as string | null)) throw new GitHubResponseError(`${context} has an unknown conclusion`);
  return value as string | null;
}

export function parseIncludedResponse(stdout: string): IncludedResponse {
  const normalized = stdout.replaceAll('\r\n', '\n');
  const boundary = normalized.indexOf('\n\n');
  if (boundary < 0) throw new GitHubResponseError('GitHub response is missing its header boundary');
  const headerLines = normalized.slice(0, boundary).split('\n');
  const statusMatch = /^HTTP\/\S+\s+(\d{3})(?:\s|$)/u.exec(headerLines.shift() ?? '');
  if (statusMatch === null) throw new GitHubResponseError('GitHub response is missing its HTTP status');
  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new GitHubResponseError('GitHub response contains a malformed header');
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name.length === 0) throw new GitHubResponseError('GitHub response contains an empty header name');
    headers[name] = headers[name] === undefined ? value : `${headers[name]}, ${value}`;
  }
  const rawBody = normalized.slice(boundary + 2);
  let body: unknown;
  if (rawBody.length === 0 && statusMatch[1] === '204') {
    body = null;
    return { status: 204, headers, body };
  }
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new GitHubResponseError('GitHub response body is not valid JSON');
  }
  return { status: Number(statusMatch[1]), headers, body };
}

export function parseRepositoryResponse(value: unknown): GitHubRepository {
  const repository = record(value, 'repository');
  if (repository.private !== true || repository.visibility !== 'private' || repository.fork !== false) {
    throw new GitHubResponseError('repository must be private, have private visibility, and not be a fork');
  }
  return {
    id: integer(repository.id, 'repository.id'),
    nameWithOwner: string(repository.full_name, 'repository.full_name'),
    visibility: 'private',
    fork: false,
  };
}

export function parseRunPage(value: unknown): WorkflowRun[] {
  const page = record(value, 'workflow runs page');
  integer(page.total_count, 'workflow runs page.total_count', true);
  if (!Array.isArray(page.workflow_runs)) throw new GitHubResponseError('workflow_runs must be an array');
  return page.workflow_runs.map((value, index) => {
    const item = record(value, `workflow_runs[${index}]`);
    const status = string(item.status, `workflow_runs[${index}].status`);
    if (!RUN_STATUSES.has(status)) throw new GitHubResponseError(`workflow_runs[${index}].status is unknown`);
    const pullRequests = item.pull_requests;
    if (!Array.isArray(pullRequests)) throw new GitHubResponseError(`workflow_runs[${index}].pull_requests must be an array`);
    return {
      id: integer(item.id, `workflow_runs[${index}].id`),
      workflowId: integer(item.workflow_id, `workflow_runs[${index}].workflow_id`),
      runAttempt: integer(item.run_attempt, `workflow_runs[${index}].run_attempt`),
      status,
      conclusion: parseConclusion(item.conclusion, `workflow_runs[${index}].conclusion`),
      event: string(item.event, `workflow_runs[${index}].event`),
      headBranch: string(item.head_branch, `workflow_runs[${index}].head_branch`),
      headSha: string(item.head_sha, `workflow_runs[${index}].head_sha`),
      repositoryId: integer(record(item.repository, `workflow_runs[${index}].repository`).id, `workflow_runs[${index}].repository.id`),
      headRepositoryId: integer(record(item.head_repository, `workflow_runs[${index}].head_repository`).id, `workflow_runs[${index}].head_repository.id`),
      pullRequestCount: pullRequests.length,
    };
  });
}

export function parseJobPage(value: unknown, runId: number, runAttempt: number): WorkflowJob[] {
  const page = record(value, 'jobs page');
  integer(page.total_count, 'jobs page.total_count', true);
  if (!Array.isArray(page.jobs)) throw new GitHubResponseError('jobs must be an array');
  return page.jobs.map((value, index) => {
    const item = record(value, `jobs[${index}]`);
    const parsedRunId = integer(item.run_id, `jobs[${index}].run_id`);
    if (parsedRunId !== runId) throw new GitHubResponseError(`jobs[${index}].run_id does not match its requested run`);
    const status = string(item.status, `jobs[${index}].status`);
    if (!JOB_STATUSES.has(status)) throw new GitHubResponseError(`jobs[${index}].status is unknown`);
    if (!Array.isArray(item.labels) || item.labels.some((label) => typeof label !== 'string' || label.length === 0)) {
      throw new GitHubResponseError(`jobs[${index}].labels must contain non-empty strings`);
    }
    const id = integer(item.id, `jobs[${index}].id`);
    return {
      key: `${runId}:${runAttempt}:${id}`,
      id,
      runId,
      runAttempt: integer(runAttempt, 'runAttempt'),
      headSha: string(item.head_sha, `jobs[${index}].head_sha`),
      status,
      conclusion: parseConclusion(item.conclusion, `jobs[${index}].conclusion`),
      name: string(item.name, `jobs[${index}].name`),
      labels: [...item.labels] as string[],
      runnerId: nullableInteger(item.runner_id, `jobs[${index}].runner_id`),
      runnerName: nullableString(item.runner_name, `jobs[${index}].runner_name`),
      runnerGroupId: nullableInteger(item.runner_group_id, `jobs[${index}].runner_group_id`),
      runnerGroupName: nullableString(item.runner_group_name, `jobs[${index}].runner_group_name`),
      startedAt: nullableString(item.started_at, `jobs[${index}].started_at`),
      completedAt: nullableString(item.completed_at, `jobs[${index}].completed_at`),
    };
  });
}

export function parseRunnerPage(value: unknown): RepositoryRunner[] {
  const page = record(value, 'runners page');
  integer(page.total_count, 'runners page.total_count', true);
  if (!Array.isArray(page.runners)) throw new GitHubResponseError('runners must be an array');
  return page.runners.map((value, index) => {
    const item = record(value, `runners[${index}]`);
    if (item.status !== 'online' && item.status !== 'offline') throw new GitHubResponseError(`runners[${index}].status is unknown`);
    if (typeof item.busy !== 'boolean') throw new GitHubResponseError(`runners[${index}].busy must be boolean`);
    if (!Array.isArray(item.labels)) throw new GitHubResponseError(`runners[${index}].labels must be an array`);
    const labels = item.labels.map((label, labelIndex) => string(record(label, `runners[${index}].labels[${labelIndex}]`).name, `runners[${index}].labels[${labelIndex}].name`));
    return {
      id: integer(item.id, `runners[${index}].id`), name: string(item.name, `runners[${index}].name`),
      os: string(item.os, `runners[${index}].os`), status: item.status as 'online' | 'offline', busy: item.busy, labels,
    };
  });
}

export function parseRegistrationTokenResponse(value: unknown): RegistrationToken {
  const response = record(value, 'registration token response');
  const expiresAt = string(response.expires_at, 'registration token response.expires_at');
  if (Number.isNaN(Date.parse(expiresAt))) throw new GitHubResponseError('registration token expiry must be a timestamp');
  return new RegistrationToken(string(response.token, 'registration token response.token'), expiresAt);
}

export function rateLimitBackoffMs(status: number, headers: Readonly<Record<string, string>>, nowMs: number): number | null {
  if (status !== 403 && status !== 429) return null;
  const retryAfter = headers['retry-after'];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  }
  const resetSeconds = Number(headers['x-ratelimit-reset']);
  return Number.isFinite(resetSeconds) ? Math.max(0, Math.ceil(resetSeconds * 1_000 - nowMs)) : null;
}

interface Page<TResponse extends IncludedResponse = IncludedResponse> {
  page: number;
  response: TResponse;
}

function nextPage(headers: Readonly<Record<string, string>>): number | null {
  const link = headers.link;
  if (link === undefined) return null;
  for (const part of link.split(',')) {
    if (!/;\s*rel="next"\s*$/u.test(part.trim())) continue;
    const match = /[?&]page=(\d+)(?:[&#>]|$)/u.exec(part);
    if (match === null) throw new GitHubResponseError('next Link is missing a page number');
    return integer(Number(match[1]), 'next page');
  }
  return null;
}

function incomplete<T>(reason: string, retryAfterMs?: number): Collection<T> {
  return retryAfterMs === undefined ? { complete: false, items: [], reason } : { complete: false, items: [], reason, retryAfterMs };
}

function collectPages<T>(pages: readonly Page[], arrayKey: string, parse: (body: unknown) => readonly T[], key: (item: T) => string, nowMs = Date.now()): Collection<T> {
  if (pages.length === 0) return incomplete('no response pages were received');
  const items = new Map<string, T>();
  let expectedPage = 1;
  let expectedTotal: number | null = null;
  try {
    for (const entry of pages) {
      if (entry.page !== expectedPage) return incomplete('pagination page sequence is incomplete');
      const backoff = rateLimitBackoffMs(entry.response.status, entry.response.headers, nowMs);
      if (entry.response.status !== 200) return incomplete(`GitHub returned HTTP ${entry.response.status}`, backoff ?? undefined);
      const body = record(entry.response.body, `page ${entry.page}`);
      const total = integer(body.total_count, `page ${entry.page}.total_count`, true);
      if (expectedTotal !== null && total !== expectedTotal) return incomplete('pagination total_count changed between pages');
      expectedTotal = total;
      if (!Array.isArray(body[arrayKey])) return incomplete(`page ${entry.page}.${arrayKey} must be an array`);
      for (const item of parse(body)) items.set(key(item), item);
      const next = nextPage(entry.response.headers);
      if (next !== null && next !== entry.page + 1) return incomplete('pagination Link skips a page');
      expectedPage = next ?? entry.page + 1;
      if (next === null && entry !== pages.at(-1)) return incomplete('responses continue after the final pagination page');
      if (next !== null && entry === pages.at(-1)) return incomplete('pagination ended before the advertised next page');
    }
    if (expectedTotal !== items.size) return incomplete('pagination item count does not match total_count');
    return { complete: true, items: [...items.values()] };
  } catch (error) {
    return incomplete(error instanceof Error ? error.message : 'GitHub response parsing failed');
  }
}

export function collectRunPages(pages: readonly Page[], nowMs = Date.now()): Collection<WorkflowRun> {
  return collectPages(pages, 'workflow_runs', parseRunPage, (item) => `${item.id}:${item.runAttempt}`, nowMs);
}

export interface JobPage extends Page {
  runId: number;
  runAttempt: number;
}

export function collectJobPages(pages: readonly JobPage[], nowMs = Date.now()): Collection<WorkflowJob> {
  if (pages.length === 0) return { complete: true, items: [] };
  const groups = new Map<string, JobPage[]>();
  for (const page of pages) {
    const groupKey = `${page.runId}:${page.runAttempt}`;
    const group = groups.get(groupKey) ?? [];
    group.push(page);
    groups.set(groupKey, group);
  }
  const items = new Map<string, WorkflowJob>();
  for (const group of groups.values()) {
    const first = group[0]!;
    const result = collectPages(group, 'jobs', (body) => parseJobPage(body, first.runId, first.runAttempt), (item) => item.key, nowMs);
    if (!result.complete) return result;
    for (const item of result.items) items.set(item.key, item);
  }
  return { complete: true, items: [...items.values()] };
}

export function classifyOwnedRunners(runners: readonly RepositoryRunner[], expected: { expectedName: string; ownershipLabel: string; journaledRunnerId?: number }): RunnerOwnership {
  const matches = runners.filter((runner) => runner.name === expected.expectedName && runner.labels.includes(expected.ownershipLabel));
  if (expected.journaledRunnerId !== undefined) {
    const journaled = runners.find((runner) => runner.id === expected.journaledRunnerId);
    if (journaled === undefined && matches.length === 0) return { ownership: 'absent', matches, runner: null };
    if (journaled === undefined || !matches.includes(journaled) || matches.length !== 1) return { ownership: matches.length > 1 ? 'ambiguous' : 'foreign', matches, runner: null };
    return { ownership: 'owned', matches, runner: journaled };
  }
  if (matches.length === 0) return { ownership: 'absent', matches, runner: null };
  if (matches.length > 1) return { ownership: 'ambiguous', matches, runner: null };
  return { ownership: 'owned', matches, runner: matches[0]! };
}

export function buildQueueSnapshot(input: QueueCollectionInput): GitHubQueueSnapshot {
  const incompleteSource = [input.runs, input.jobs, input.runners].find((source) => !source.complete);
  const identityMatches = input.repository.id === input.expectedRepository.id
    && input.repository.nameWithOwner === input.expectedRepository.nameWithOwner;
  if (!identityMatches || incompleteSource !== undefined || !Number.isFinite(input.observedAtMs)) {
    const reason = !identityMatches ? 'repository identity does not match configuration' : (incompleteSource?.reason ?? 'snapshot input is incomplete');
    return incompleteSource?.retryAfterMs === undefined
      ? { complete: false, eligibleQueuedJobs: 0, ownedBusy: null, observedAtMs: input.observedAtMs, reason }
      : { complete: false, eligibleQueuedJobs: 0, ownedBusy: null, observedAtMs: input.observedAtMs, reason, retryAfterMs: incompleteSource.retryAfterMs };
  }
  const latestAttemptByRun = new Map<number, number>();
  for (const run of input.runs.items) {
    latestAttemptByRun.set(run.id, Math.max(latestAttemptByRun.get(run.id) ?? 0, run.runAttempt));
  }
  const runByAttempt = new Map(input.runs.items
    .filter((run) => latestAttemptByRun.get(run.id) === run.runAttempt)
    .map((run) => [`${run.id}:${run.runAttempt}`, run]));
  const eligible = input.jobs.items.filter((job) => {
    const run = runByAttempt.get(`${job.runId}:${job.runAttempt}`);
    return run !== undefined
      && run.repositoryId === input.repository.id && run.headRepositoryId === input.repository.id
      && run.pullRequestCount === 0 && (run.event === 'push' || run.event === 'workflow_dispatch')
      && input.workflowIds.includes(run.workflowId) && run.headBranch === input.allowedBranch
      && run.headSha === job.headSha && input.eligibleJobNames.includes(job.name)
      && input.runnerLabel.length > 0 && job.labels.includes(input.runnerLabel);
  });
  const eligibleQueuedJobs = eligible.filter((job) => job.status !== 'in_progress' && job.status !== 'completed').length;
  const ownership = classifyOwnedRunners(input.runners.items, {
    expectedName: input.expectedRunnerName,
    ownershipLabel: input.runnerLabel,
    ...(input.journaledRunnerId === undefined ? {} : { journaledRunnerId: input.journaledRunnerId }),
  });
  if (ownership.ownership === 'foreign' || ownership.ownership === 'ambiguous') {
    return { complete: false, eligibleQueuedJobs: 0, ownedBusy: null, observedAtMs: input.observedAtMs, reason: `runner ownership is ${ownership.ownership}` };
  }
  const ownedRunnerId = ownership.runner?.id;
  const ownedBusy = ownership.runner?.busy === true
    || eligible.some((job) => job.status === 'in_progress' && job.runnerId === ownedRunnerId);
  return { complete: true, eligibleQueuedJobs, ownedBusy, observedAtMs: input.observedAtMs };
}

export class GitHubAdapter {
  readonly #process: ExternalProcess;
  readonly #ghPath: string;
  readonly #timeoutMs: number;
  readonly #now: () => number;

  constructor(process: ExternalProcess, options: { ghPath: string; timeoutMs: number; now?: () => number }) {
    if (!options.ghPath.startsWith('/')) throw new GitHubResponseError('ghPath must be absolute');
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new GitHubResponseError('timeoutMs must be positive and finite');
    this.#process = process;
    this.#ghPath = options.ghPath;
    this.#timeoutMs = options.timeoutMs;
    this.#now = options.now ?? Date.now;
  }

  async listRuns(owner: string, repository: string, status: string): Promise<Collection<WorkflowRun>> {
    if (!ACTIVE_RUN_STATUSES.has(status)) return incomplete('unsupported active run status');
    const endpoint = `/repos/${segment(owner)}/${segment(repository)}/actions/runs`;
    const pages = await this.#readPages(endpoint, { status });
    return collectRunPages(pages, this.#now());
  }

  async listActiveRuns(owner: string, repository: string): Promise<Collection<WorkflowRun>> {
    const runs = new Map<string, WorkflowRun>();
    for (const status of ACTIVE_RUN_STATUS_LIST) {
      const result = await this.listRuns(owner, repository, status);
      if (!result.complete) return result;
      for (const item of result.items) runs.set(`${item.id}:${item.runAttempt}`, item);
    }
    return { complete: true, items: [...runs.values()] };
  }

  async repository(owner: string, repository: string): Promise<GitHubRepository> {
    const response = await this.#call('GET', `/repos/${segment(owner)}/${segment(repository)}`);
    if (response.status !== 200) throw new GitHubResponseError(`GitHub returned HTTP ${response.status}`);
    return parseRepositoryResponse(response.body);
  }

  async listJobs(owner: string, repository: string, runId: number, runAttempt: number): Promise<Collection<WorkflowJob>> {
    integer(runId, 'runId');
    integer(runAttempt, 'runAttempt');
    const endpoint = `/repos/${segment(owner)}/${segment(repository)}/actions/runs/${runId}/attempts/${runAttempt}/jobs`;
    const pages = await this.#readPages(endpoint);
    return collectJobPages(pages.map((page) => ({ ...page, runId, runAttempt })), this.#now());
  }

  async listRunners(owner: string, repository: string): Promise<Collection<RepositoryRunner>> {
    const endpoint = `/repos/${segment(owner)}/${segment(repository)}/actions/runners`;
    const pages = await this.#readPages(endpoint);
    return collectPages(pages, 'runners', parseRunnerPage, (runner) => String(runner.id), this.#now());
  }

  async createRegistrationToken(owner: string, repository: string): Promise<RegistrationToken> {
    const response = await this.#call('POST', `/repos/${segment(owner)}/${segment(repository)}/actions/runners/registration-token`);
    if (response.status !== 201) throw new GitHubResponseError(`GitHub returned HTTP ${response.status} while creating registration token`);
    return parseRegistrationTokenResponse(response.body);
  }

  async removeOwnedRunner(owner: string, repository: string, ownership: RunnerOwnership): Promise<void> {
    if (ownership.ownership !== 'owned' || ownership.runner === null || ownership.matches.length !== 1) {
      throw new GitHubResponseError('runner removal requires one proven owned runner');
    }
    const response = await this.#call('DELETE', `/repos/${segment(owner)}/${segment(repository)}/actions/runners/${ownership.runner.id}`);
    if (response.status !== 204 && response.status !== 404) throw new GitHubResponseError(`GitHub returned HTTP ${response.status} while removing runner`);
  }

  async #readPages(endpoint: string, fields: Readonly<Record<string, string>> = {}): Promise<Page[]> {
    const pages: Page[] = [];
    for (let page = 1; page <= 10_000; page += 1) {
      let response: IncludedResponse;
      try {
        response = await this.#call('GET', endpoint, { ...fields, per_page: '100', page: String(page) });
      } catch (error) {
        return [{ page, response: { status: 0, headers: {}, body: { error: error instanceof Error ? error.name : 'unknown' } } }];
      }
      pages.push({ page, response });
      if (response.status !== 200 || nextPage(response.headers) === null) return pages;
    }
    return pages;
  }

  async #call(method: 'GET' | 'POST' | 'DELETE', endpoint: string, fields: Readonly<Record<string, string>> = {}): Promise<IncludedResponse> {
    const args = ['api', '--include', '--method', method, '-H', `X-GitHub-Api-Version: ${API_VERSION}`, endpoint];
    for (const [name, value] of Object.entries(fields)) args.push('-f', `${name}=${value}`);
    const result = await this.#process.run(this.#ghPath, args, { timeoutMs: this.#timeoutMs });
    if (result.stdout.length === 0) throw new GitHubResponseError(`gh exited ${result.exitCode} without a parseable response`);
    return parseIncludedResponse(result.stdout);
  }
}

function segment(value: string): string {
  if (!/^[A-Za-z0-9_.-]+$/u.test(value)) throw new GitHubResponseError('GitHub owner and repository must be URL-safe path segments');
  return value;
}
