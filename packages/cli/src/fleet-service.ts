import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import type { FleetArguments } from './args.js';
import type { CliIo, FleetCommandService } from './cli.js';
import {
  enrollmentLabelFor,
  isExcludedRepository,
  lockedExclusionRepositories,
  LOCKED_EXCLUSIONS,
  parseFleetRegistry,
  writeFleetRegistry,
  type FleetEnrollment,
  type FleetRegistry,
  type WorkflowIdentity,
} from './fleet-registry.js';
import {
  array,
  defaultGitHubPageRunner,
  githubCliPath,
  githubPages,
  positiveInteger,
  record,
  text,
  type GitHubPageRunner,
} from './github-api.js';
import { hostedSkuForLabels } from './telemetry.js';

/** Read-only GitHub reads the fleet commands need; every call is a GET through `gh api`. */
export interface GitHubFleetSource {
  repository(repository: string): Promise<{ id: number; defaultBranch: string; visibility: string }>;
  branchHead(repository: string, branch: string): Promise<string>;
  workflows(repository: string): Promise<Array<{ id: number; name: string; path: string }>>;
  workflowFile(repository: string, path: string, ref: string): Promise<{ sha: string; content: string }>;
  isOnBranch(repository: string, commit: string, branch: string): Promise<boolean>;
}

export function createFleetCommandService(
  environment: NodeJS.ProcessEnv = process.env,
  pageRunner: GitHubPageRunner = defaultGitHubPageRunner,
): FleetCommandService {
  const source = githubFleetSource(githubCliPath(environment), pageRunner);
  return {
    async run(args, io) {
      const registryPath = absoluteRegistry(args.registryPath);
      if (args.action === 'init') return init(args, registryPath, io);
      const registry = await readRegistry(registryPath);
      if (args.action === 'show') {
        io.stdout(`${JSON.stringify(registry, null, 2)}\n`);
        return 0;
      }
      if (args.action === 'enroll') return enroll(args, registry, registryPath, source, io);
      if (args.action === 'cutover') return cutover(args, registry, registryPath, source, io);
      return verify(registry, registryPath, source, io);
    },
  };
}

async function init(args: Extract<FleetArguments, { action: 'init' }>, registryPath: string, io: CliIo): Promise<0> {
  if (await exists(registryPath)) throw new Error(`registry ${registryPath} already exists; edit it or choose another path`);
  const registry: FleetRegistry = {
    schemaVersion: 1,
    owner: args.owner,
    measurementWindow: { since: args.since, through: args.through },
    exclusions: lockedExclusionRepositories(args.owner).map((repository) => ({
      repository,
      reason: LOCKED_EXCLUSIONS.frozenProducts.some((product) => repository === `${args.owner}/${product}`)
        ? `code freeze; covers the ${LOCKED_EXCLUSIONS.companionSuffixes.join(', ')} companions`
        : 'named exclusion',
      lockedBy: LOCKED_EXCLUSIONS.lockedBy,
    })),
    enrollments: [],
  };
  await writeFleetRegistry(registryPath, registry);
  io.stdout(`${JSON.stringify({ status: 'initialised', path: registryPath, exclusions: registry.exclusions.length })}\n`);
  return 0;
}

async function enroll(
  args: Extract<FleetArguments, { action: 'enroll' }>,
  registry: FleetRegistry,
  registryPath: string,
  source: GitHubFleetSource,
  io: CliIo,
): Promise<0> {
  if (!args.repository.startsWith(`${registry.owner}/`)) throw new Error(`repository ${args.repository} must belong to ${registry.owner}`);
  if (isExcludedRepository(registry, args.repository)) throw new Error(`repository ${args.repository} is excluded from migration`);
  const existing = registry.enrollments.find((entry) => entry.repository === args.repository && entry.workflowPath === args.workflowPath && entry.jobKey === args.jobKey);
  if (existing !== undefined) throw new Error(`${args.repository} ${args.workflowPath} job ${args.jobKey} is already enrolled as ${existing.id}`);
  const runnerLabel = enrollmentLabelFor(args.sku);
  const repository = await source.repository(args.repository);
  if (repository.visibility !== 'private') throw new Error(`repository ${args.repository} is ${repository.visibility}; hosted minutes are free there, so migration only adds provider cost`);
  const workflow = (await source.workflows(args.repository)).find(({ path }) => path === args.workflowPath);
  if (workflow === undefined) throw new Error(`workflow ${args.workflowPath} is not registered in ${args.repository}`);
  const commit = await source.branchHead(args.repository, repository.defaultBranch);
  const file = await source.workflowFile(args.repository, args.workflowPath, commit);
  const job = extractJobRunsOn(file.content, args.jobKey);
  if (job.runsOn.some((label) => label === 'self-hosted' || label.startsWith('cirujano-'))) {
    throw new Error(`job ${args.jobKey} already runs on self-hosted labels ${JSON.stringify(job.runsOn)}`);
  }
  const hostedSku = hostedSkuForLabels(job.runsOn);
  if (hostedSku !== args.sku) {
    throw new Error(`job ${args.jobKey} runs-on ${JSON.stringify(job.runsOn)} is priced as ${hostedSku ?? 'an unknown SKU'}, not ${args.sku}`);
  }
  const jobNames = args.jobNames.length > 0 ? args.jobNames : [job.name ?? args.jobKey];
  const enrollment: FleetEnrollment = {
    id: nextEnrollmentId(registry),
    repository: args.repository,
    repositoryId: repository.id,
    workflowPath: args.workflowPath,
    workflowId: workflow.id,
    workflowName: workflow.name,
    jobKey: args.jobKey,
    jobNames,
    sku: args.sku,
    runnerLabel,
    status: 'proposed',
    before: { commit, workflowBlobSha: file.sha, runsOn: job.runsOn, recordedAt: new Date().toISOString() },
    after: null,
    controller: null,
    notes: [],
  };
  await writeFleetRegistry(registryPath, { ...registry, enrollments: [...registry.enrollments, enrollment] });
  io.stdout(`${JSON.stringify({ status: 'enrolled', id: enrollment.id, repository: enrollment.repository, workflowId: enrollment.workflowId, jobNames, before: enrollment.before })}\n`);
  return 0;
}

async function cutover(
  args: Extract<FleetArguments, { action: 'cutover' }>,
  registry: FleetRegistry,
  registryPath: string,
  source: GitHubFleetSource,
  io: CliIo,
): Promise<0> {
  const enrollment = requireEnrollment(registry, args.id);
  if (enrollment.status !== 'proposed') throw new Error(`enrollment ${args.id} is ${enrollment.status}, not proposed`);
  const repository = await source.repository(enrollment.repository);
  if (!(await source.isOnBranch(enrollment.repository, args.commit, repository.defaultBranch))) {
    throw new Error(`commit ${args.commit} is not on the default branch ${repository.defaultBranch} of ${enrollment.repository}`);
  }
  const live = await readLiveIdentity(source, enrollment, args.commit);
  if (!live.runsOn.includes('self-hosted') || !live.runsOn.includes(enrollment.runnerLabel)) {
    throw new Error(`job ${enrollment.jobKey} at ${args.commit} runs-on lacks ${enrollment.runnerLabel}: ${JSON.stringify(live.runsOn)}; cutover not recorded`);
  }
  const updated: FleetEnrollment = { ...enrollment, status: 'cut-over', after: live };
  await writeFleetRegistry(registryPath, replaceEnrollment(registry, updated));
  io.stdout(`${JSON.stringify({ status: 'cut-over', id: updated.id, repository: updated.repository, after: live })}\n`);
  return 0;
}

async function verify(registry: FleetRegistry, registryPath: string, source: GitHubFleetSource, io: CliIo): Promise<0 | 1> {
  const problems: string[] = [];
  let next = registry;
  for (const enrollment of registry.enrollments) {
    const repository = await source.repository(enrollment.repository);
    const head = await source.branchHead(enrollment.repository, repository.defaultBranch);
    const live = await readLiveIdentity(source, enrollment, head);
    const labelled = live.runsOn.includes('self-hosted') && live.runsOn.includes(enrollment.runnerLabel);
    if (enrollment.status === 'proposed') {
      if (live.workflowBlobSha === enrollment.before.workflowBlobSha) continue;
      if (labelled) {
        problems.push(`${enrollment.id}: live workflow already carries ${enrollment.runnerLabel} at ${head}; record it with fleet cutover`);
        continue;
      }
      next = replaceEnrollment(next, {
        ...enrollment,
        before: live,
        notes: [...enrollment.notes, `before refreshed at ${live.recordedAt}: commit ${head} blob ${live.workflowBlobSha} (was ${enrollment.before.workflowBlobSha})`],
      });
      continue;
    }
    if (enrollment.status === 'reverted') {
      if (labelled) problems.push(`${enrollment.id}: reverted enrollment carries ${enrollment.runnerLabel} again at ${head}; enroll it afresh`);
      continue;
    }
    const after = enrollment.after!;
    if (live.workflowBlobSha === after.workflowBlobSha) continue;
    if (labelled) {
      problems.push(`${enrollment.id}: live workflow blob ${live.workflowBlobSha} differs from the recorded after blob ${after.workflowBlobSha} at ${head}; review the edit and re-run fleet cutover --commit ${head} if it is intended`);
      continue;
    }
    problems.push(`${enrollment.id}: enrolled label ${enrollment.runnerLabel} is gone from the live workflow at ${head}; recorded as reverted`);
    next = replaceEnrollment(next, {
      ...enrollment,
      status: 'reverted',
      notes: [...enrollment.notes, `reverted at ${live.recordedAt}: commit ${head} blob ${live.workflowBlobSha} runs-on ${JSON.stringify(live.runsOn)}`],
    });
  }
  if (next !== registry) await writeFleetRegistry(registryPath, next);
  const summary = next.enrollments.map(({ id, status, before, after }) => ({ id, status, beforeBlob: before.workflowBlobSha, afterBlob: after?.workflowBlobSha ?? null }));
  io.stdout(`${JSON.stringify({ status: problems.length === 0 ? 'verified' : 'mismatch', enrollments: summary })}\n`);
  for (const problem of problems) io.stderr(`${problem}\n`);
  return problems.length === 0 ? 0 : 1;
}

async function readLiveIdentity(source: GitHubFleetSource, enrollment: FleetEnrollment, commit: string): Promise<WorkflowIdentity> {
  const file = await source.workflowFile(enrollment.repository, enrollment.workflowPath, commit);
  const job = extractJobRunsOn(file.content, enrollment.jobKey);
  return { commit, workflowBlobSha: file.sha, runsOn: job.runsOn, recordedAt: new Date().toISOString() };
}

function requireEnrollment(registry: FleetRegistry, id: string): FleetEnrollment {
  const enrollment = registry.enrollments.find((entry) => entry.id === id);
  if (enrollment === undefined) throw new Error(`enrollment ${id} does not exist`);
  return enrollment;
}

export function replaceEnrollment(registry: FleetRegistry, updated: FleetEnrollment): FleetRegistry {
  return { ...registry, enrollments: registry.enrollments.map((entry) => entry.id === updated.id ? updated : entry) };
}

function nextEnrollmentId(registry: FleetRegistry): string {
  const highest = registry.enrollments.reduce((maximum, { id }) => Math.max(maximum, Number(id.slice(1))), 0);
  return `P${highest + 1}`;
}

export async function readRegistry(path: string): Promise<FleetRegistry> {
  return parseFleetRegistry(JSON.parse(await readFile(path, 'utf8')));
}

export function absoluteRegistry(value: string): string {
  const expanded = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  if (!isAbsolute(expanded)) throw new Error('fleet registry must be an absolute path');
  return expanded;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads `jobs.<key>.runs-on` (scalar, flow list or block list) and `jobs.<key>.name` from a
 * workflow file without a YAML dependency. Expressions and matrices are refused: the registry
 * records exact runner selections, never guesses.
 */
export function extractJobRunsOn(workflow: string, jobKey: string): { runsOn: string[]; name: string | null } {
  const lines = workflow.split(/\r?\n/u);
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/u.test(line));
  if (jobsIndex === -1) throw new Error('workflow has no jobs block');
  const jobIndent = indentOf(lines, jobsIndex + 1, 0);
  if (jobIndent === null) throw new Error('workflow jobs block is empty');
  const jobStart = lines.findIndex((line, index) => index > jobsIndex && indentation(line) === jobIndent && stripComment(line).trim() === `${yamlKey(jobKey)}:`);
  if (jobStart === -1) throw new Error(`job ${jobKey} is not defined in the workflow`);
  const bodyIndent = indentOf(lines, jobStart + 1, jobIndent);
  if (bodyIndent === null) throw new Error(`job ${jobKey} has no body`);
  let runsOn: string[] | null = null;
  let name: string | null = null;
  for (let index = jobStart + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (stripComment(line).trim().length === 0) continue;
    const indent = indentation(line);
    if (indent <= jobIndent) break;
    if (indent !== bodyIndent) continue;
    const content = stripComment(line).trim();
    const nameMatch = /^name:\s*(.*)$/u.exec(content);
    if (nameMatch !== null) name = unquote(nameMatch[1]!);
    const runsOnMatch = /^runs-on:\s*(.*)$/u.exec(content);
    if (runsOnMatch === null) continue;
    const value = runsOnMatch[1]!;
    if (value.length === 0) {
      const items: string[] = [];
      for (let itemIndex = index + 1; itemIndex < lines.length; itemIndex += 1) {
        const item = stripComment(lines[itemIndex]!);
        if (item.trim().length === 0) continue;
        if (indentation(item) <= bodyIndent) break;
        const entry = /^\s*-\s*(.+)$/u.exec(item);
        if (entry === null) throw new Error(`job ${jobKey} runs-on block has an unsupported entry`);
        items.push(unquote(entry[1]!.trim()));
      }
      runsOn = items;
    } else if (value.startsWith('[')) {
      if (!value.endsWith(']')) throw new Error(`job ${jobKey} runs-on flow list is not closed on one line`);
      runsOn = value.slice(1, -1).split(',').map((item) => unquote(item.trim())).filter((item) => item.length > 0);
    } else {
      runsOn = [unquote(value)];
    }
  }
  if (runsOn === null) throw new Error(`job ${jobKey} has no runs-on`);
  if (runsOn.length === 0) throw new Error(`job ${jobKey} runs-on is empty`);
  if (runsOn.some((label) => label.includes('${{') || label.startsWith('{'))) throw new Error(`job ${jobKey} runs-on uses an expression or matrix; enroll a job with a literal runner selection`);
  if (name !== null && name.includes('${{')) name = null;
  return { runsOn, name };
}

function yamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(key) ? key : JSON.stringify(key);
}

function indentOf(lines: readonly string[], from: number, parentIndent: number): number | null {
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (stripComment(line).trim().length === 0) continue;
    const indent = indentation(line);
    return indent > parentIndent ? indent : null;
  }
  return null;
}

function indentation(line: string): number {
  return line.length - line.trimStart().length;
}

function stripComment(line: string): string {
  return line.replace(/\s+#.*$/u, '').replace(/^\s*#.*$/u, '');
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function githubFleetSource(ghPath: string, pageRunner: GitHubPageRunner): GitHubFleetSource {
  const single = async (endpoint: string, name: string): Promise<Record<string, unknown>> => {
    const pages = await githubPages(ghPath, endpoint, pageRunner);
    if (pages.length !== 1) throw new Error(`${name} returned ${pages.length} pages`);
    return record(pages[0], name);
  };
  return {
    async repository(repository) {
      const value = await single(`/repos/${repository}`, 'repository');
      if (text(value['full_name'], 'repository.full_name') !== repository) throw new Error(`repository ${repository} resolved to ${String(value['full_name'])}`);
      return {
        id: positiveInteger(value['id'], 'repository.id'),
        defaultBranch: text(value['default_branch'], 'repository.default_branch'),
        visibility: text(value['visibility'], 'repository.visibility'),
      };
    },
    async branchHead(repository, branch) {
      const value = await single(`/repos/${repository}/branches/${encodeURIComponent(branch)}`, 'branch');
      return sha(record(value['commit'], 'branch.commit')['sha'], 'branch.commit.sha');
    },
    async workflows(repository) {
      const pages = await githubPages(ghPath, `/repos/${repository}/actions/workflows?per_page=100`, pageRunner);
      return pages.flatMap((page) => array(record(page, 'workflows page')['workflows'], 'workflows').map((entry) => {
        const value = record(entry, 'workflow');
        return { id: positiveInteger(value['id'], 'workflow.id'), name: text(value['name'], 'workflow.name'), path: text(value['path'], 'workflow.path') };
      }));
    },
    async workflowFile(repository, path, ref) {
      const value = await single(`/repos/${repository}/contents/${path}?ref=${ref}`, 'workflow file');
      if (value['encoding'] !== 'base64') throw new Error('workflow file encoding is not base64');
      return { sha: sha(value['sha'], 'workflow file sha'), content: Buffer.from(text(value['content'], 'workflow file content'), 'base64').toString('utf8') };
    },
    async isOnBranch(repository, commit, branch) {
      const value = await single(`/repos/${repository}/compare/${commit}...${encodeURIComponent(branch)}`, 'compare');
      const status = text(value['status'], 'compare.status');
      return status === 'ahead' || status === 'identical';
    },
  };
}

function sha(value: unknown, name: string): string {
  const result = text(value, name);
  if (!/^[0-9a-f]{40}$/u.test(result)) throw new Error(`${name} must be a 40-character SHA`);
  return result;
}
