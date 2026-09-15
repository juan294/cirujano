import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import {
  OPERATING_PERMIT_BOUNDS,
  buildOperatingPermitProposal,
  calculateOperatingQuoteMaximum,
  parseControllerState,
  parsePermit,
  parseRunnerConfig,
  renderOperatingPermit,
  verifySshPublicKeyFingerprint,
  type Permit,
  type PilotQuote,
  type RunnerConfig,
} from '@cirujano/runner';

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
import { buildStoreReport } from './telemetry-store.js';
import { TELEMETRY_RATES, hostedSkuForLabels, renderFleetSavingsMarkdown, type ControllerEvidence } from './telemetry.js';

const execFile = promisify(execFileCallback);

/** Plan D6: generation lifetime and timing for operating controllers. */
export const OPERATING_TIMING = {
  pollIntervalMs: 30_000,
  idleGraceMs: 300_000,
  bootTimeoutMs: 600_000,
  maxJobMs: 3_600_000,
  lifetimeMs: 14_400_000,
  shutdownMarginMs: 300_000,
} as const;

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
      if (args.action === 'controller-config') return controllerConfig(args, registry, registryPath, source, environment, io);
      if (args.action === 'permit-proposal') return permitProposal(args, registry, io);
      if (args.action === 'publish') return publish(args, registry, io);
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

async function controllerConfig(
  args: Extract<FleetArguments, { action: 'controller-config' }>,
  registry: FleetRegistry,
  registryPath: string,
  source: GitHubFleetSource,
  environment: NodeJS.ProcessEnv,
  io: CliIo,
): Promise<0> {
  const enrollment = requireEnrollment(registry, args.id);
  if (enrollment.status === 'reverted') throw new Error(`enrollment ${args.id} is reverted; enroll it afresh before configuring a controller`);
  const template = parseRunnerConfig(JSON.parse(await readFile(absoluteRegistry(args.templatePath), 'utf8')));
  const stateRoot = absoluteRegistry(args.stateRoot);
  const stateDirectory = join(stateRoot, enrollment.id);
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await chmod(stateDirectory, 0o700);
  const hostKey = await ensureHostKey(stateDirectory, enrollment.id, environment);
  const allowedBranch = args.allowedBranch ?? (await source.repository(enrollment.repository)).defaultBranch;
  const handle = enrollment.id.toLowerCase();
  const controllerId = enrollment.controller?.controllerId ?? `cirujano-${handle}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
  const resourcePrefix = enrollment.controller?.resourcePrefix ?? `cirujano-${handle}`;
  const config: RunnerConfig = parseRunnerConfig({
    schemaVersion: 1,
    repository: { id: enrollment.repositoryId, nameWithOwner: enrollment.repository, visibility: 'private' },
    workflowIds: [enrollment.workflowId],
    allowedBranch,
    eligibleJobNames: enrollment.jobNames,
    runnerLabel: enrollment.runnerLabel,
    slots: 1,
    nebius: template.nebius,
    ssh: { publicKey: hostKey.publicKey, fingerprint: hostKey.fingerprint },
    ownership: { controllerId, resourcePrefix },
    timing: OPERATING_TIMING,
    rates: { ...template.rates, hostedUsdPerMinute: TELEMETRY_RATES.skus[enrollment.sku] },
  });
  const configPath = join(stateDirectory, 'config.json');
  await writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);
  const controller = { stateDirectory, controllerId, resourcePrefix, permitId: enrollment.controller?.permitId ?? null };
  await writeFleetRegistry(registryPath, replaceEnrollment(registry, { ...enrollment, controller }));
  io.stdout(`${JSON.stringify({
    status: 'configured', id: enrollment.id, configPath, hostKeyPath: hostKey.privateKeyPath,
    identity: { configHash: configHash(config), repositoryId: config.repository.id, projectId: config.nebius.projectId, controllerId, resourcePrefix },
    note: 'candidateDigest is the SHA-256 of the installed CLI bundle; runner inspect prints the full permit identity',
  })}\n`);
  return 0;
}

async function permitProposal(
  args: Extract<FleetArguments, { action: 'permit-proposal' }>,
  registry: FleetRegistry,
  io: CliIo,
): Promise<0 | 1> {
  const enrollment = requireEnrollment(registry, args.id);
  if (enrollment.controller === null) throw new Error(`enrollment ${args.id} has no controller; run fleet controller-config first`);
  const config = parseRunnerConfig(JSON.parse(await readFile(join(enrollment.controller.stateDirectory, 'config.json'), 'utf8')));
  const rawQuote = JSON.parse(await readFile(absoluteRegistry(args.quotePath), 'utf8')) as Record<string, unknown>;
  const nowMs = Date.now();
  const bounds = OPERATING_PERMIT_BOUNDS;
  const lifetimeMs = bounds.expiresAtMs - nowMs;
  const quote = completeQuote(rawQuote, bounds.maxRuntimeMs, lifetimeMs);
  const otherPermits: Array<Pick<Permit, 'permitId' | 'maxTotalCostUsd'>> = [];
  for (const other of registry.enrollments) {
    if (other.id === enrollment.id || other.controller === null) continue;
    const permit = await readOptionalPermit(join(other.controller.stateDirectory, 'permit.json'));
    if (permit !== null) otherPermits.push({ permitId: permit.permitId, maxTotalCostUsd: permit.maxTotalCostUsd });
  }
  const result = buildOperatingPermitProposal({
    enrollmentId: enrollment.id,
    nowMs,
    expiresAtMs: bounds.expiresAtMs,
    candidateDigest: args.candidateDigest,
    configHash: configHash(config),
    repositoryId: config.repository.id,
    projectId: config.nebius.projectId,
    controllerId: config.ownership.controllerId,
    resourcePrefix: config.ownership.resourcePrefix,
    maxStarts: bounds.maxStarts,
    maxRuntimeMs: bounds.maxRuntimeMs,
    maxTotalCostUsd: bounds.maxTotalCostUsd,
    otherPermits,
    quote,
  });
  if (!result.accepted) {
    for (const reason of result.reasons) io.stderr(`${reason}\n`);
    return 1;
  }
  const proposalPath = join(enrollment.controller.stateDirectory, 'permit-proposal.json');
  const draftPath = join(enrollment.controller.stateDirectory, 'permit.draft.json');
  const permitId = `${enrollment.id}-operating-${new Date(nowMs).toISOString().slice(0, 10).replaceAll('-', '')}`;
  await writeFile(proposalPath, `${JSON.stringify(result.proposal, null, 2)}\n`, { mode: 0o600 });
  await writeFile(draftPath, `${JSON.stringify(renderOperatingPermit(result.proposal, permitId), null, 2)}\n`, { mode: 0o600 });
  await chmod(proposalPath, 0o600);
  await chmod(draftPath, 0o600);
  io.stdout(`${JSON.stringify({
    status: 'proposed', id: enrollment.id, proposalPath, draftPath, permitId,
    estimatedMaximumUsd: result.proposal.quote.estimatedMaximumUsd, fleetCommittedUsd: result.proposal.fleetCommittedUsd,
    note: 'unapproved; the owner confirms the proposal and copies permit.draft.json to permit.json (mode 0600)',
  })}\n`);
  return 0;
}

function completeQuote(raw: Record<string, unknown>, maxRuntimeMs: number, lifetimeMs: number): PilotQuote {
  const quote = raw as unknown as Extract<PilotQuote, { complete: true }>;
  if (quote.complete !== true) return { complete: false, reason: 'quote file must declare complete: true' };
  const estimatedMaximumUsd = calculateOperatingQuoteMaximum(quote, maxRuntimeMs, lifetimeMs);
  return { ...quote, estimatedMaximumUsd };
}

async function readOptionalPermit(path: string): Promise<Permit | null> {
  try {
    return parsePermit(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureHostKey(stateDirectory: string, id: string, environment: NodeJS.ProcessEnv): Promise<{ privateKeyPath: string; publicKey: string; fingerprint: string }> {
  const privateKeyPath = join(stateDirectory, 'ssh_host_ed25519_key');
  const publicKeyPath = `${privateKeyPath}.pub`;
  if (!(await exists(privateKeyPath))) {
    const keygen = environment['CIRUJANO_SSH_KEYGEN_PATH'] ?? '/usr/bin/ssh-keygen';
    if (!isAbsolute(keygen)) throw new Error('CIRUJANO_SSH_KEYGEN_PATH must be absolute');
    await execFile(keygen, ['-q', '-t', 'ed25519', '-N', '', '-C', `cirujano-host-${id}`, '-f', privateKeyPath]);
  }
  await chmod(privateKeyPath, 0o600);
  const publicKey = (await readFile(publicKeyPath, 'utf8')).trim();
  return { privateKeyPath, publicKey, fingerprint: verifySshPublicKeyFingerprint(publicKey) };
}

/** Identical to the runner service's permit identity hash: sha256 of the parsed config's JSON. */
function configHash(config: RunnerConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

/**
 * Reads one enrollment's controller journals. Every file must carry the same identity and that
 * identity must name the enrollment's controller; a missing journal throws with its path.
 */
export async function readControllerEvidence(
  stateDirectory: string,
  controller: { controllerId: string; resourcePrefix: string },
): Promise<ControllerEvidence> {
  const config = parseRunnerConfig(JSON.parse(await readFile(join(stateDirectory, 'config.json'), 'utf8')));
  const state = parseControllerState(JSON.parse(await readJournalFile(join(stateDirectory, 'controller-state.json'))));
  if (state.identity.controllerId !== controller.controllerId) throw new Error(`controller-state.json controllerId ${state.identity.controllerId} does not match enrollment controller ${controller.controllerId}`);
  if (state.identity.resourcePrefix !== controller.resourcePrefix) throw new Error(`controller-state.json resourcePrefix ${state.identity.resourcePrefix} does not match enrollment controller ${controller.resourcePrefix}`);
  if (config.ownership.controllerId !== controller.controllerId || config.ownership.resourcePrefix !== controller.resourcePrefix) throw new Error('config.json ownership does not match the enrollment controller');
  const identity = JSON.stringify(state.identity);
  const accounting = record(JSON.parse(await readJournalFile(join(stateDirectory, 'accounting-state.json'))), 'accounting-state.json');
  if (accounting['schemaVersion'] !== 1 || JSON.stringify(accounting['identity']) !== identity) throw new Error('accounting-state.json identity does not match controller-state.json');
  const assignmentsFile = record(JSON.parse(await readJournalFile(join(stateDirectory, 'assignments.json'))), 'assignments.json');
  if (assignmentsFile['schemaVersion'] !== 1 || JSON.stringify(assignmentsFile['identity']) !== identity) throw new Error('assignments.json identity does not match controller-state.json');
  const assignments = array(assignmentsFile['assignments'], 'assignments').map((entry, index) => {
    const item = record(entry, `assignments[${index}]`);
    const conclusion = item['conclusion'];
    if (conclusion !== null && typeof conclusion !== 'string') throw new Error(`assignments[${index}].conclusion is invalid`);
    return {
      runId: positiveInteger(item['runId'], `assignments[${index}].runId`),
      runAttempt: positiveInteger(item['runAttempt'], `assignments[${index}].runAttempt`),
      jobId: positiveInteger(item['jobId'], `assignments[${index}].jobId`),
      runnerId: positiveInteger(item['runnerId'], `assignments[${index}].runnerId`),
      runnerName: text(item['runnerName'], `assignments[${index}].runnerName`),
      conclusion: conclusion as string | null,
    };
  });
  return {
    controllerId: state.identity.controllerId,
    resourcePrefix: state.identity.resourcePrefix,
    startCount: state.lifecycle.startCount,
    cumulativeRuntimeMs: state.lifecycle.cumulativeRuntimeMs,
    cumulativeCostUsd: state.lifecycle.cumulativeCostUsd,
    diskRetainedMs: nonnegativeNumber(accounting['diskRetainedMs'], 'accounting diskRetainedMs'),
    diskSizeGiB: config.nebius.diskSizeGiB,
    networkEgressBytes: nonnegativeNumber(accounting['networkEgressBytes'], 'accounting networkEgressBytes'),
    rates: config.rates,
    assignments,
  };
}

/** Evidence for every enrollment with a controller; an enrollment whose journals do not exist yet is simply absent. */
export async function loadControllerEvidence(registry: FleetRegistry): Promise<Map<string, ControllerEvidence>> {
  const evidence = new Map<string, ControllerEvidence>();
  for (const enrollment of registry.enrollments) {
    if (enrollment.controller === null) continue;
    try {
      evidence.set(enrollment.id, await readControllerEvidence(enrollment.controller.stateDirectory, enrollment.controller));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error(`${enrollment.id} controller evidence is unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return evidence;
}

const RESOURCE_ID_PATTERN = /\b(?:computeinstance|computedisk|computeimage|vpcsubnet|vpcnetwork|project|serviceaccount)-e0[0-9a-z]+/u;

/** Renders the sanitized 45-day report and refuses to write it if any private name or resource id survives. */
async function publish(args: Extract<FleetArguments, { action: 'publish' }>, registry: FleetRegistry, io: CliIo): Promise<0> {
  const evidenceById = await loadControllerEvidence(registry);
  const report = await buildStoreReport({ storePath: args.storePath, since: args.since, registry, evidenceById });
  const markdown = renderFleetSavingsMarkdown(report);
  assertPublishable(markdown, registry);
  const outputPath = absoluteRegistry(args.outputPath);
  await writeFile(outputPath, markdown, { mode: 0o644 });
  io.stdout(`${JSON.stringify({ status: 'published', outputPath, enrollments: report.fleet?.enrollments ?? 0, complete: report.fleet?.complete ?? false, netSavingsUsd: report.fleet?.netSavingsUsd ?? null })}\n`);
  return 0;
}

/** The publication guard: no private repository, owner prefix, controller identity or provider resource id may survive. */
export function assertPublishable(markdown: string, registry: FleetRegistry): void {
  const privateNames = [
    ...registry.enrollments.map(({ repository }) => repository),
    ...registry.exclusions.map(({ repository }) => repository),
  ];
  for (const name of privateNames) {
    if (markdown.includes(name)) throw new Error(`refusing to publish: output contains private repository ${name}`);
  }
  for (const enrollment of registry.enrollments) {
    if (enrollment.controller === null) continue;
    for (const value of [enrollment.controller.controllerId, enrollment.controller.resourcePrefix, enrollment.controller.stateDirectory]) {
      if (markdown.includes(value)) throw new Error(`refusing to publish: output contains controller identity ${value}`);
    }
  }
  if (markdown.includes(`${registry.owner}/`)) throw new Error(`refusing to publish: output contains the owner prefix ${registry.owner}/`);
  const resourceId = RESOURCE_ID_PATTERN.exec(markdown);
  if (resourceId !== null) throw new Error(`refusing to publish: output contains resource identity ${resourceId[0]}`);
}

async function readJournalFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Object.assign(new Error(`${path} does not exist`), { code: 'ENOENT' });
    throw error;
  }
}

function nonnegativeNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number`);
  return value;
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
