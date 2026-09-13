import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  GitHubAdapter,
  GUEST_FILE_NAMES,
  NebiusCli,
  RUNNER_SCHEMA_VERSION,
  acquireControllerLock,
  buildQueueSnapshot,
  buildRunnerReport,
  buildSshInvocation,
  classifyOwnedRunners,
  decideDelete,
  decideStop,
  parseControllerState,
  parseInstancePage,
  parseOperationPage,
  parsePermit,
  parseRunnerReportInput,
  parseRunnerConfig,
  readJournal,
  renderCloudInit,
  renderCreateRequest,
  knownHostLine,
  runInterruptRecovery,
  runProcess,
  tickController,
  validatePermit,
  verifySshPublicKeyFingerprint,
  writeJournalAtomic,
  type ControllerState,
  type ExpectedNebiusResource,
  type LifecycleEffect,
  type LifecycleInput,
  type NebiusInstance,
  type NebiusOperation,
  type PendingEffect,
  type Permit,
  type PermitIdentity,
  type RunnerConfig,
  type WorkflowJob,
  type GuestFileName,
  type LifecycleJournal,
  type CostRates,
} from '@cirujano/runner';

import type { CliIo, RunnerCommandService } from './cli.js';

const DEFAULT_GH_PATH = '/opt/homebrew/bin/gh';
const DEFAULT_POLL_LIMIT = 10_000;
const THIRTY_DAY_MONTH_MS = 30 * 24 * 3_600_000;

export interface ObservedAccounting {
  diskStartedAtMs: number | null;
  diskRetainedMs: number;
  runtimeBaselineMs: number;
  generation: number | null;
  networkEgressBytes: number;
  networkBaselineBytes?: number;
  networkGenerationStartBytes?: number;
}

interface ObservedLifecycleInput {
  nowMs: number;
  lifecycle: LifecycleJournal;
  providerPresent: boolean;
  queueComplete: boolean;
  ownedBusy: boolean | null;
  guest: { complete: boolean; status: string; generation: number | null; startedAtMs: number | null; networkEgressBytes: number | null };
  accounting: ObservedAccounting;
  rates: CostRates;
  diskSizeGiB: number;
}

export function advanceObservedLifecycle(input: ObservedLifecycleInput): { lifecycle: LifecycleJournal; accounting: ObservedAccounting } {
  const accounting = { ...input.accounting };
  if (input.providerPresent && accounting.diskStartedAtMs === null) accounting.diskStartedAtMs = input.nowMs;
  if (accounting.diskStartedAtMs !== null) {
    accounting.diskRetainedMs += Math.max(0, input.nowMs - accounting.diskStartedAtMs);
    accounting.diskStartedAtMs = input.providerPresent ? input.nowMs : null;
  }
  if (input.guest.generation !== null && input.guest.startedAtMs !== null) {
    if (accounting.generation !== input.guest.generation) {
      const firstObservedGeneration = accounting.generation === null && accounting.networkEgressBytes === 0;
      accounting.generation = input.guest.generation;
      accounting.runtimeBaselineMs = input.lifecycle.cumulativeRuntimeMs;
      accounting.networkBaselineBytes = accounting.networkEgressBytes;
      accounting.networkGenerationStartBytes = firstObservedGeneration ? 0 : input.guest.networkEgressBytes ?? 0;
    }
  }
  const runtimeMs = accounting.generation === input.guest.generation && input.guest.startedAtMs !== null
    ? Math.max(input.lifecycle.cumulativeRuntimeMs, accounting.runtimeBaselineMs + Math.max(0, input.nowMs - input.guest.startedAtMs))
    : input.lifecycle.cumulativeRuntimeMs;
  if (input.guest.networkEgressBytes !== null) {
    const generationBytes = Math.max(0, input.guest.networkEgressBytes - (accounting.networkGenerationStartBytes ?? 0));
    accounting.networkEgressBytes = Math.max(accounting.networkEgressBytes, (accounting.networkBaselineBytes ?? 0) + generationBytes);
  }
  const computeUsd = (runtimeMs / 3_600_000) * input.rates.computeUsdPerHour;
  const diskUsd = (accounting.diskRetainedMs / THIRTY_DAY_MONTH_MS) * input.diskSizeGiB * input.rates.diskUsdPerGibMonth;
  const networkUsd = (accounting.networkEgressBytes / 1_073_741_824) * input.rates.networkEgressUsdPerGib;
  const cumulativeCostUsd = Math.max(input.lifecycle.cumulativeCostUsd, roundMoney(computeUsd + diskUsd + networkUsd));
  const idle = input.queueComplete && input.ownedBusy === false && input.guest.complete && input.guest.status === 'drained'
    && input.guest.generation !== null && input.guest.generation === input.lifecycle.startCount;
  const idleObservations = idle && input.lifecycle.idleObservations.length < 100
    && input.lifecycle.idleObservations.at(-1)?.observedAtMs !== input.nowMs
    ? [...input.lifecycle.idleObservations, { observedAtMs: input.nowMs, complete: true, generation: input.guest.generation! }]
    : input.lifecycle.idleObservations;
  const lifecycle = { ...input.lifecycle, cumulativeRuntimeMs: runtimeMs, cumulativeCostUsd, idleObservations };
  return { lifecycle, accounting };
}

interface RuntimeContext {
  config: RunnerConfig;
  permit: Permit | null;
  identity: PermitIdentity;
  github: GitHubAdapter;
  nebius: NebiusCli;
  owner: string;
  repository: string;
  stateDirectory: string;
  journalPath: string;
  eventPath: string;
  accountingPath: string;
  directActionPath: string;
  activeJobPath: string;
  assignmentPath: string;
  environment: NodeJS.ProcessEnv;
}

export function createRunnerCommandService(environment: NodeJS.ProcessEnv = process.env): RunnerCommandService {
  return {
    async run(args, io) {
      if (args.action === 'report') return report(args.statePath, io);
      const context = await createContext(args.configPath, 'permitPath' in args ? args.permitPath : undefined, environment);
      if (args.action === 'inspect') return inspect(context, args.format, io);
      if (args.action === 'watch') return watch(context, args.dryRun, io);
      return mutateOwned(context, args.action, io);
    },
  };
}

async function createContext(configPath: string, permitPath: string | undefined, environment: NodeJS.ProcessEnv): Promise<RuntimeContext> {
  const rawConfig = await readFile(configPath, 'utf8');
  const config = parseRunnerConfig(JSON.parse(rawConfig) as unknown);
  const permit = permitPath === undefined ? null : parsePermit(JSON.parse(await readFile(permitPath, 'utf8')) as unknown);
  const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  const candidateDigest = environment['CIRUJANO_CANDIDATE_DIGEST'] ?? await executableDigest();
  const identity: PermitIdentity = {
    configHash,
    candidateDigest,
    repositoryId: config.repository.id,
    projectId: config.nebius.projectId,
    controllerId: config.ownership.controllerId,
    resourcePrefix: config.ownership.resourcePrefix,
  };
  const ghPath = absolutePath(environment['CIRUJANO_GH_PATH'] ?? DEFAULT_GH_PATH, 'GitHub CLI');
  const nebiusPath = absolutePath(environment['CIRUJANO_NEBIUS_PATH'] ?? join(homedir(), '.nebius/bin/nebius'), 'Nebius CLI');
  const github = new GitHubAdapter({
    async run(command, args, options) {
      const result = await runProcess({ command, args, timeoutMs: options.timeoutMs, env: environment });
      return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
  }, { ghPath, timeoutMs: config.timing.pollIntervalMs });
  const nebius = new NebiusCli({
    binaryPath: nebiusPath,
    profile: config.nebius.profile,
    projectId: config.nebius.projectId,
    execute: async (command) => {
      const result = await runProcess({
        command: command.file, args: command.args, timeoutMs: command.timeoutMs,
        ...(command.stdin === undefined ? {} : { stdin: command.stdin }), env: environment,
      });
      return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut };
    },
  });
  const [owner, repository] = config.repository.nameWithOwner.split('/');
  if (owner === undefined || repository === undefined) throw new Error('configured repository identity is invalid');
  const stateDirectory = resolve(dirname(configPath));
  return {
    config, permit, identity, github, nebius, owner, repository, stateDirectory,
    journalPath: join(stateDirectory, 'controller-state.json'),
    eventPath: join(stateDirectory, 'events.jsonl'),
    accountingPath: join(stateDirectory, 'accounting-state.json'), environment,
    directActionPath: join(stateDirectory, 'direct-action-state.json'),
    activeJobPath: join(stateDirectory, 'active-job-state.json'),
    assignmentPath: join(stateDirectory, 'assignments.json'),
  };
}

async function inspect(context: RuntimeContext, format: 'json' | 'text', io: CliIo): Promise<0 | 1> {
  const [repository, provider] = await Promise.all([readRepository(context), observeProvider(context)]);
  const result = {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    command: 'runner inspect',
    repository,
    provider: { complete: provider.complete, ownedMatches: provider.ownedMatches, state: provider.vmStatus },
    intendedResource: {
      name: `${context.config.ownership.resourcePrefix}-vm`, projectId: context.config.nebius.projectId,
      platform: context.config.nebius.platform, preset: context.config.nebius.preset,
      diskType: context.config.nebius.diskType, diskSizeGiB: context.config.nebius.diskSizeGiB,
    },
    rates: context.config.rates,
    identity: context.identity,
  };
  if (format === 'json') io.stdout(`${JSON.stringify(result)}\n`);
  else io.stdout(`${repository.nameWithOwner}: ${provider.vmStatus} (${provider.ownedMatches} owned VM)\n`);
  return provider.complete ? 0 : 1;
}

async function watch(context: RuntimeContext, dryRun: boolean, io: CliIo): Promise<0 | 1> {
  const lock = await acquireControllerLock(context.stateDirectory);
  let interrupted = false;
  let wake: (() => void) | null = null;
  const onInterrupt = () => { interrupted = true; wake?.(); };
  process.once('SIGINT', onInterrupt);
  try {
    for (let count = 0; count < DEFAULT_POLL_LIMIT; count += 1) {
      const input = await observe(context);
      const result = await tickController({
        lock, journalPath: context.journalPath, eventPath: context.eventPath, input, dryRun,
        executeEffect: (effect) => executeEffect(context, effect),
        reconcileEffect: (effect) => reconcileEffect(context, effect),
      });
      io.stdout(`${JSON.stringify({ schemaVersion: 1, type: 'tick', status: result.status, decision: result.decision })}\n`);
      if (interrupted) {
        const recovery = await interruptRecovery(context);
        io.stdout(`${JSON.stringify({ schemaVersion: 1, type: 'interrupt-recovery', ...recovery })}\n`);
        return recovery.completed ? 0 : 1;
      }
      if (context.environment['CIRUJANO_RUNNER_ONCE'] === '1') return result.status === 'blocked' ? 1 : 0;
      await new Promise<void>((resolveDelay) => {
        const timer = setTimeout(resolveDelay, context.config.timing.pollIntervalMs);
        wake = () => { clearTimeout(timer); resolveDelay(); };
      });
      wake = null;
    }
    throw new Error('runner watch exceeded its bounded poll limit');
  } finally {
    process.off('SIGINT', onInterrupt);
    await lock.release();
  }
}

async function mutateOwned(context: RuntimeContext, action: 'stop' | 'cleanup', io: CliIo): Promise<0 | 1> {
  const lock = await acquireControllerLock(context.stateDirectory);
  try {
    const priorDirect = await readDirectAction(context);
    if (priorDirect !== null && priorDirect.action === action && priorDirect.stage === 'resolved') {
      requireRecoveryPermit(context, action === 'stop' ? 'stop' : 'delete');
      io.stdout(`${JSON.stringify({ schemaVersion: 1, command: `runner ${action}`, status: 'done', providerState: priorDirect.providerState })}\n`);
      return 0;
    }
    if (priorDirect !== null && priorDirect.action === action && priorDirect.stage === 'emitting') {
      requireRecoveryPermit(context, action === 'stop' ? 'stop' : 'delete');
      return recoverDirectEmission(context, action, priorDirect, io);
    }
    if (priorDirect !== null && priorDirect.action === action && priorDirect.stage === 'intent') requireRecoveryPermit(context, action === 'stop' ? 'stop' : 'delete');
    else requirePermit(context, action === 'stop' ? 'stop' : 'delete');
    const observed = await observe(context);
    if (!observed.provider.complete || !observed.queue.complete || observed.queue.ownedBusy === null) throw new Error('direct action requires complete provider and queue observations');
    if (observed.queue.ownedBusy || observed.guest.workerActive === true || observed.guest.status === 'busy') throw new Error('owned job is active; direct action cannot interrupt work');
    const instances = await listInstances(context);
    const expected = expectedResource(context);
    const instance = exactOwnedInstance(instances, expected);
    const runners = await context.github.listRunners(context.owner, context.repository);
    if (!runners.complete) throw new Error(runners.reason ?? 'GitHub runner observation is incomplete');
    const ownership = classifyOwnedRunners(runners.items, {
      expectedName: expectedRunnerName(context, await priorState(context)), ownershipLabel: context.config.runnerLabel,
    });
    if (ownership.runner?.busy === true) throw new Error('owned runner is busy; drain cannot interrupt active work');
    if (instance === null) {
      await writeJournalAtomic(context.directActionPath, { schemaVersion: 1, identity: context.identity, action, stage: 'resolved', observedAtMs: Date.now(), providerState: 'absent' });
      io.stdout(`${JSON.stringify({ schemaVersion: 1, command: `runner ${action}`, status: 'done' })}\n`);
      return 0;
    }
    const decision = action === 'stop' ? decideStop(instance, expected) : decideDelete(instance, expected);
    if (decision.action === 'block') throw new Error(decision.reason);
    if (decision.action === 'wait') {
      io.stdout(`${JSON.stringify({ schemaVersion: 1, command: `runner ${action}`, status: 'pending' })}\n`);
      return 1;
    }
    await writeJournalAtomic(context.directActionPath, { schemaVersion: 1, identity: context.identity, action, stage: 'intent', observedAtMs: Date.now(), instanceId: instance.id });
    await directBoundary(context, 'direct-prepared');
    await writeJournalAtomic(context.directActionPath, { schemaVersion: 1, identity: context.identity, action, stage: 'emitting', observedAtMs: Date.now(), instanceId: instance.id });
    await directBoundary(context, 'direct-emitting');
    if (action === 'stop' && instance !== null && instance.state === 'running') {
      const state = await priorState(context);
      await runGuest(context, instance, '/opt/cirujano/drain', `${Math.max(1, state?.lifecycle.startCount ?? 1)}\n`);
    }
    if (ownership.ownership === 'owned') await context.github.removeOwnedRunner(context.owner, context.repository, ownership);
    else if (ownership.ownership !== 'absent') throw new Error(`runner ownership is ${ownership.ownership}`);

    let operationId: string | undefined;
    if (decision.action === 'stop') operationId = (await operation(await context.nebius.stop(decision.instanceId), 'Nebius stop')).operationId;
    if (decision.action === 'delete') operationId = (await operation(await context.nebius.delete(decision.instanceId), 'Nebius delete')).operationId;
    await directBoundary(context, 'direct-provider-io');
    await writeJournalAtomic(context.directActionPath, { schemaVersion: 1, identity: context.identity, action, stage: 'emitting', observedAtMs: Date.now(), instanceId: instance.id, ...(operationId === undefined ? {} : { operationId }) });
    const terminal = await waitForTerminalProvider(context, action, instance.id);
    await writeJournalAtomic(context.directActionPath, { schemaVersion: 1, identity: context.identity, action, stage: terminal.complete ? 'resolved' : 'emitting', observedAtMs: Date.now(), instanceId: instance.id, providerState: terminal.state, ...(operationId === undefined ? {} : { operationId }) });
    await directBoundary(context, 'direct-terminal');
    io.stdout(`${JSON.stringify({ schemaVersion: 1, command: `runner ${action}`, status: terminal.complete ? 'done' : 'pending', providerState: terminal.state })}\n`);
    return terminal.complete ? 0 : 1;
  } finally {
    await lock.release();
  }
}

async function recoverDirectEmission(
  context: RuntimeContext,
  action: 'stop' | 'cleanup',
  prior: { instanceId: string; operationId?: unknown; recoveryRetryEmitted?: unknown; [key: string]: unknown },
  io: CliIo,
): Promise<0 | 1> {
  let current = prior;
  const block = async (reason: string, providerState: string): Promise<1> => {
    await writeJournalAtomic(context.directActionPath, { ...current, stage: 'emitting', observedAtMs: Date.now(), providerState, blockedReason: reason });
    io.stdout(`${JSON.stringify({ schemaVersion: 1, command: `runner ${action}`, status: 'blocked', providerState, reason })}\n`);
    return 1;
  };
  try {
    const instances = await listInstances(context);
    const instance = exactOwnedInstance(instances, expectedResource(context));
    const terminalState = action === 'cleanup' && instance === null ? 'absent'
      : action === 'stop' && (instance === null || instance.state === 'stopped') ? instance?.state ?? 'absent'
        : null;
    if (terminalState !== null) {
      await writeJournalAtomic(context.directActionPath, { ...prior, stage: 'resolved', observedAtMs: Date.now(), providerState: terminalState });
      io.stdout(`${JSON.stringify({ schemaVersion: 1, command: `runner ${action}`, status: 'done', providerState: terminalState })}\n`);
      return 0;
    }
    if (instance === null) return block('exact owned instance readback is inconclusive', 'unknown');
    const operations = await listOperations(context);
    const operationId = typeof prior.operationId === 'string' ? prior.operationId : null;
    const related = operationId === null
      ? operations.filter((item) => item.resourceId === prior.instanceId)
      : operations.filter((item) => item.id === operationId && (item.resourceId === null || item.resourceId === prior.instanceId));
    if (related.length > 0) {
      return block(`provider operation ${related.map((item) => `${item.id}:${item.state}`).join(',')} has not produced terminal resource state`, instance.state);
    }
    if (operationId !== null) return block(`journaled provider operation ${operationId} is absent from the complete operation snapshot`, instance.state);
    if (prior.recoveryRetryEmitted === true) return block('recovery retry was already emitted and cannot be repeated', instance.state);
    const observed = await observe(context);
    if (!observed.provider.complete || !observed.queue.complete || observed.queue.ownedBusy !== false
      || observed.guest.workerActive === true || observed.guest.status === 'busy') {
      return block('recovery retry requires complete idle provider, queue, runner and guest readbacks', instance.state);
    }
    const state = await priorState(context);
    if (action === 'stop' && instance.state === 'running') {
      await runGuest(context, instance, '/opt/cirujano/drain', `${Math.max(1, state?.lifecycle.startCount ?? 1)}\n`);
      const verified = await observe(context);
      if (!verified.queue.complete || verified.queue.ownedBusy !== false || !verified.guest.complete
        || verified.guest.status !== 'drained' || verified.guest.admissionEnabled !== false || verified.guest.workerActive !== false) {
        return block('guest and assignment readbacks did not prove drained idle recovery', instance.state);
      }
    }
    const runners = await context.github.listRunners(context.owner, context.repository);
    if (!runners.complete) return block(runners.reason ?? 'GitHub runner recovery readback is incomplete', instance.state);
    const ownership = classifyOwnedRunners(runners.items, {
      expectedName: expectedRunnerName(context, state), ownershipLabel: context.config.runnerLabel,
    });
    if (ownership.runner?.busy === true) return block('owned runner is busy during recovery', instance.state);
    if (ownership.ownership === 'owned') await context.github.removeOwnedRunner(context.owner, context.repository, ownership);
    else if (ownership.ownership !== 'absent') return block(`runner ownership is ${ownership.ownership} during recovery`, instance.state);
    const remaining = await context.github.listRunners(context.owner, context.repository);
    if (!remaining.complete) return block(remaining.reason ?? 'final GitHub runner recovery readback is incomplete', instance.state);
    const finalOwnership = classifyOwnedRunners(remaining.items, {
      expectedName: expectedRunnerName(context, state), ownershipLabel: context.config.runnerLabel,
    });
    if (finalOwnership.ownership !== 'absent') return block(`owned runner remains ${finalOwnership.ownership} before provider recovery`, instance.state);
    const retrying = { ...prior, stage: 'emitting', observedAtMs: Date.now(), providerState: instance.state, recoveryRetryEmitted: true };
    current = retrying;
    await writeJournalAtomic(context.directActionPath, retrying);
    const result = action === 'stop'
      ? await operation(await context.nebius.stop(prior.instanceId), 'Nebius recovery stop')
      : await operation(await context.nebius.delete(prior.instanceId), 'Nebius recovery delete');
    await writeJournalAtomic(context.directActionPath, { ...retrying, observedAtMs: Date.now(), ...result });
    const terminal = await waitForTerminalProvider(context, action, prior.instanceId);
    if (!terminal.complete) return block('recovery retry did not reach terminal provider state', terminal.state);
    await writeJournalAtomic(context.directActionPath, { ...retrying, ...result, stage: 'resolved', observedAtMs: Date.now(), providerState: terminal.state });
    io.stdout(`${JSON.stringify({ schemaVersion: 1, command: `runner ${action}`, status: 'done', providerState: terminal.state })}\n`);
    return 0;
  } catch (error) {
    return block(error instanceof Error ? error.message : String(error), 'unknown');
  }
}

async function report(statePath: string, io: CliIo): Promise<0 | 1> {
  const input = parseRunnerReportInput(await readJournal<unknown>(statePath));
  const value = buildRunnerReport(input);
  io.stdout(`${JSON.stringify(value)}\n`);
  return value.complete ? 0 : 1;
}

async function observe(context: RuntimeContext): Promise<LifecycleInput> {
  const nowMs = Date.now();
  const [repository, provider, runs, runners, state] = await Promise.all([
    readRepository(context), observeProvider(context), context.github.listActiveRuns(context.owner, context.repository),
    context.github.listRunners(context.owner, context.repository), priorState(context),
  ]);
  const jobs: WorkflowJob[] = [];
  let jobsComplete = runs.complete;
  let jobsReason = runs.reason;
  let retryAfterMs = runs.retryAfterMs;
  if (runs.complete) {
    for (const run of runs.items) {
      const page = await context.github.listJobs(context.owner, context.repository, run.id, run.runAttempt);
      if (!page.complete) {
        jobsComplete = false;
        jobsReason = page.reason;
        retryAfterMs = page.retryAfterMs;
        break;
      }
      jobs.push(...page.items);
    }
  }
  const knownAssignments = await readAssignments(context);
  for (const known of knownAssignments.filter((entry) => entry.conclusion === null)) {
    if (jobs.some((job) => job.key === `${known.runId}:${known.runAttempt}:${known.jobId}`)) continue;
    const page = await context.github.listJobs(context.owner, context.repository, known.runId, known.runAttempt);
    if (!page.complete) {
      jobsComplete = false;
      jobsReason = page.reason ?? 'known assignment lookup is incomplete';
      retryAfterMs = page.retryAfterMs;
      break;
    }
    const exact = page.items.find((job) => job.id === known.jobId);
    if (exact === undefined) {
      jobsComplete = false;
      jobsReason = `known assignment ${known.runId}:${known.runAttempt}:${known.jobId} disappeared`;
      break;
    }
    jobs.push(exact);
  }
  const deduplicatedJobs = [...new Map(jobs.map((job) => [job.key, job])).values()];
  const assignments = mergeAssignments(knownAssignments, deduplicatedJobs, expectedRunnerName(context, state));
  if (JSON.stringify(assignments) !== JSON.stringify(knownAssignments)) {
    await writeJournalAtomic(context.assignmentPath, { schemaVersion: 1, identity: context.identity, assignments });
  }
  let queue = buildQueueSnapshot({
    repository, expectedRepository: context.config.repository, runs,
    jobs: collection(jobsComplete, deduplicatedJobs, jobsReason, retryAfterMs), runners,
    workflowIds: context.config.workflowIds, allowedBranch: context.config.allowedBranch,
    eligibleJobNames: context.config.eligibleJobNames, runnerLabel: context.config.runnerLabel,
    expectedRunnerName: expectedRunnerName(context, state), observedAtMs: nowMs,
  });
  let journal = state?.lifecycle ?? {
    state: provider.vmStatus === 'absent' ? 'absent' as const : provider.vmStatus === 'stopped' ? 'stopped' as const : 'blocked' as const,
    startCount: 0, cumulativeRuntimeMs: 0, cumulativeCostUsd: 0, outstandingIntent: null, idleObservations: [],
  };
  const guest = await observeGuest(context, provider);
  const preservedBusy = await readActiveJobMarker(context) || assignments.some((entry) => entry.conclusion === null);
  const runnerOwnership = classifyOwnedRunners(runners.items, { expectedName: expectedRunnerName(context, state), ownershipLabel: context.config.runnerLabel });
  const conclusivelyIdle = queue.complete && queue.ownedBusy === false && guest.complete && guest.workerActive === false
    && runnerOwnership.ownership !== 'ambiguous' && runnerOwnership.ownership !== 'foreign'
    && runnerOwnership.runner?.busy !== true;
  const activeJobKnown = queue.ownedBusy === true || (preservedBusy && !conclusivelyIdle);
  if (activeJobKnown !== preservedBusy) await writeJournalAtomic(context.activeJobPath, { schemaVersion: 1, identity: context.identity, activeJobKnown, observedAtMs: nowMs });
  if (activeJobKnown) queue = { ...queue, ownedBusy: true };
  const accounting = await readAccounting(context, state, provider, nowMs);
  const advanced = advanceObservedLifecycle({
    nowMs, lifecycle: journal, providerPresent: provider.ownership === 'owned',
    queueComplete: queue.complete, ownedBusy: queue.ownedBusy,
    guest: {
      complete: guest.complete, status: guest.status, generation: guest.grant?.generation ?? null,
      startedAtMs: guest.grant?.startedAtMs ?? null, networkEgressBytes: guest.networkEgressBytes ?? null,
    },
    accounting, rates: context.config.rates, diskSizeGiB: context.config.nebius.diskSizeGiB,
  });
  journal = advanced.lifecycle;
  await writeJournalAtomic(context.accountingPath, { schemaVersion: 1, identity: context.identity, ...advanced.accounting });
  const decisionQueue = journal.state === 'draining' && queue.ownedBusy === false
    ? { ...queue, eligibleQueuedJobs: 0 }
    : queue;
  return {
    nowMs, config: context.config, identity: context.identity, permit: context.permit,
    provider, queue: decisionQueue, guest, journal,
    projectedStartCostUsd: projectedStartCost(context),
  };
}

async function observeProvider(context: RuntimeContext): Promise<LifecycleInput['provider']> {
  try {
    const instances = await listInstances(context);
    const expected = expectedResource(context);
    const exact = instances.filter((instance) => instanceMatches(instance, expected));
    const related = instances.filter((instance) => instance.name === expected.name
      || instance.labels['cirujano-controller'] === expected.labels['cirujano-controller']
      || instance.labels['cirujano-config'] === expected.labels['cirujano-config']);
    if (exact.length > 1) return { complete: true, vmStatus: 'unknown', ownership: 'ambiguous', ownedMatches: exact.length, outstandingOperation: null };
    if (exact.length === 0 && related.length > 0) return { complete: true, vmStatus: 'unknown', ownership: 'foreign', ownedMatches: 0, outstandingOperation: null };
    if (exact.length === 0) return { complete: true, vmStatus: 'absent', ownership: 'absent', ownedMatches: 0, outstandingOperation: null };
    const instance = exact[0]!;
    return {
      complete: true, vmStatus: instance.state, ownership: 'owned', ownedMatches: 1, outstandingOperation: null,
      ...(instance.publicIp === null ? {} : { network: { vmId: instance.id, ipAddress: instance.publicIp } }),
    };
  } catch {
    return { complete: false, vmStatus: 'unknown', ownership: 'unknown', ownedMatches: 0, outstandingOperation: null };
  }
}

async function listInstances(context: RuntimeContext): Promise<NebiusInstance[]> {
  const instances: NebiusInstance[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10_000; page += 1) {
    const result = await context.nebius.listInstances(pageToken);
    await requireSuccessful(result, 'Nebius instance list');
    const parsed = parseInstancePage(result.stdout);
    instances.push(...parsed.items);
    if (parsed.nextPageToken === null) return instances;
    pageToken = parsed.nextPageToken;
  }
  throw new Error('Nebius instance pagination exceeded its bound');
}

async function listOperations(context: RuntimeContext): Promise<NebiusOperation[]> {
  const operations: NebiusOperation[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10_000; page += 1) {
    const result = await context.nebius.listOperationsByParent(pageToken);
    await requireSuccessful(result, 'Nebius operation list');
    const parsed = parseOperationPage(result.stdout);
    operations.push(...parsed.items);
    if (parsed.nextPageToken === null) return operations;
    pageToken = parsed.nextPageToken;
  }
  throw new Error('Nebius operation pagination exceeded its bound');
}

async function readRepository(context: RuntimeContext) {
  const repository = await context.github.repository(context.owner, context.repository);
  if (repository.id !== context.config.repository.id || repository.nameWithOwner !== context.config.repository.nameWithOwner) {
    throw new Error('live repository identity does not match configuration');
  }
  return repository;
}

async function executeEffect(context: RuntimeContext, effect: Exclude<LifecycleEffect, { type: 'none' }>): Promise<{ operationId?: string }> {
  if (effect.type === 'adopt-vm') return {};
  const instances = await listInstances(context);
  const instance = exactOwnedInstance(instances, expectedResource(context));
  if (effect.type === 'create-vm') {
    requirePermit(context, 'create');
    const request = renderCreateRequest(
      context.config,
      context.identity.configHash,
      await cloudInit(context),
    );
    return operation(await context.nebius.create(request), 'Nebius create');
  }
  if (instance === null) throw new Error(`${effect.type} requires one owned VM`);
  if (effect.type === 'start-vm') return operation(await context.nebius.start(instance.id), 'Nebius start');
  if (effect.type === 'stop-vm') return operation(await context.nebius.stop(instance.id), 'Nebius stop');
  const state = await priorState(context);
  const generation = Math.max(1, state?.lifecycle.startCount ?? 1);
  if (effect.type === 'register-runner') {
    requirePermit(context, 'register');
    const token = await context.github.createRegistrationToken(context.owner, context.repository);
    const secret = token.consume();
    if (secret.includes('\n') || secret.includes('\r')) throw new Error('registration token contains a line break');
    await runGuest(context, instance, '/opt/cirujano/register-runner', [
      context.config.repository.nameWithOwner, expectedRunnerName(context, state), context.config.runnerLabel,
      String(generation), secret,
    ].join('\n') + '\n', [secret]);
    return {};
  }
  if (effect.type === 'begin-drain') {
    await runGuest(context, instance, '/opt/cirujano/drain', `${generation}\n`);
    const runners = await context.github.listRunners(context.owner, context.repository);
    if (!runners.complete) throw new Error(runners.reason ?? 'GitHub runner observation is incomplete after drain');
    const ownership = classifyOwnedRunners(runners.items, { expectedName: expectedRunnerName(context, state), ownershipLabel: context.config.runnerLabel });
    if (ownership.ownership === 'owned') await context.github.removeOwnedRunner(context.owner, context.repository, ownership);
    else if (ownership.ownership !== 'absent') throw new Error(`runner ownership is ${ownership.ownership} after drain`);
    return {};
  }
  if (effect.type === 'resume-admission') {
    await runGuest(context, instance, '/opt/cirujano/resume-admission', '');
    return {};
  }
  return {};
}

async function reconcileEffect(context: RuntimeContext, pending: PendingEffect): Promise<{ resolved: boolean; readback?: unknown }> {
  const provider = await observeProvider(context);
  if (pending.effect.type === 'start-vm' && provider.vmStatus === 'running') {
    const instance = exactOwnedInstance(await listInstances(context), expectedResource(context));
    if (instance === null) return { resolved: false, readback: provider };
    const startedAtMs = Date.now();
    await runGuest(context, instance, '/opt/cirujano/arm-grant', [
      String(pending.effect.generation), String(startedAtMs), String(pending.effect.deadlineMs),
      String(context.config.timing.maxJobMs), String(context.config.timing.shutdownMarginMs),
      String(Math.max(0, pending.effect.generation - 1)),
    ].join('\n') + '\n');
    return { resolved: true, readback: provider };
  }
  if (pending.effect.type === 'register-runner' || pending.effect.type === 'begin-drain' || pending.effect.type === 'resume-admission') {
    const guest = await observeGuest(context, provider);
    if (pending.effect.type === 'register-runner') {
      const runners = await context.github.listRunners(context.owner, context.repository);
      if (!runners.complete) return { resolved: false, readback: { provider, guest } };
      const state = await priorState(context);
      const ownership = classifyOwnedRunners(runners.items, { expectedName: expectedRunnerName(context, state), ownershipLabel: context.config.runnerLabel });
      return { resolved: ownership.ownership === 'owned' && guest.runnerActive === true, readback: { provider, guest, runnerOwnership: ownership.ownership } };
    }
    if (pending.effect.type === 'begin-drain') return { resolved: guest.status === 'drained' && guest.runnerActive === false && guest.workerActive === false, readback: { provider, guest } };
    return { resolved: guest.admissionEnabled === true, readback: { provider, guest } };
  }
  const resolved = pending.effect.type === 'start-vm' ? false
    : pending.effect.type === 'stop-vm' ? provider.vmStatus === 'stopped'
      : pending.effect.type === 'create-vm' ? provider.ownership === 'owned'
        : true;
  return { resolved, readback: provider };
}

async function interruptRecovery(context: RuntimeContext) {
  const instances = await listInstances(context);
  const instance = exactOwnedInstance(instances, expectedResource(context));
  const unresolvedResources = instance === null ? [] : [instance.id];
  try {
    return await runInterruptRecovery({
      timeoutMs: context.config.timing.bootTimeoutMs,
      unresolvedResources,
      recover: async (signal) => {
        if (instance === null || instance.state === 'stopped') return;
        if (signal.aborted) throw new Error('interrupt recovery aborted');
        requireRecoveryPermit(context, 'stop');
        const state = await priorState(context);
        await runGuest(context, instance, '/opt/cirujano/drain', `${Math.max(1, state?.lifecycle.startCount ?? 1)}\n`);
        const observed = await observe(context);
        const runners = await context.github.listRunners(context.owner, context.repository);
        if (!runners.complete) throw new Error(runners.reason ?? 'interrupt runner readback is incomplete');
        const ownership = classifyOwnedRunners(runners.items, { expectedName: expectedRunnerName(context, state), ownershipLabel: context.config.runnerLabel });
        if (!observed.queue.complete || observed.queue.ownedBusy !== false || observed.guest.complete !== true
          || observed.guest.status !== 'drained' || observed.guest.admissionEnabled !== false
          || observed.guest.workerActive !== false || observed.guest.runnerActive !== false || ownership.runner?.busy === true) {
          throw new Error('interrupt recovery cannot stop while exact assignment or guest evidence is incomplete or active');
        }
        if (ownership.ownership === 'owned') await context.github.removeOwnedRunner(context.owner, context.repository, ownership);
        else if (ownership.ownership !== 'absent') throw new Error(`interrupt runner ownership is ${ownership.ownership}`);
        await writeJournalAtomic(context.directActionPath, { schemaVersion: 1, identity: context.identity, action: 'stop', stage: 'intent', observedAtMs: Date.now(), instanceId: instance.id, source: 'SIGINT' });
        await writeJournalAtomic(context.directActionPath, { schemaVersion: 1, identity: context.identity, action: 'stop', stage: 'emitting', observedAtMs: Date.now(), instanceId: instance.id, source: 'SIGINT' });
        const result = await operation(await context.nebius.stop(instance.id), 'Nebius interrupt stop');
        await writeJournalAtomic(context.directActionPath, { schemaVersion: 1, identity: context.identity, action: 'stop', stage: 'emitting', observedAtMs: Date.now(), instanceId: instance.id, source: 'SIGINT', ...result });
        const terminal = await waitForTerminalProvider(context, 'stop', instance.id, signal);
        if (!terminal.complete) throw new Error(`interrupt recovery has unresolved VM ${instance.id} in ${terminal.state}`);
        await writeJournalAtomic(context.directActionPath, { schemaVersion: 1, identity: context.identity, action: 'stop', stage: 'resolved', observedAtMs: Date.now(), instanceId: instance.id, source: 'SIGINT', providerState: terminal.state, ...result });
      },
    });
  } catch (error) {
    return { completed: false as const, unresolvedResources, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForTerminalProvider(context: RuntimeContext, action: 'stop' | 'cleanup', instanceId: string, signal?: AbortSignal): Promise<{ complete: boolean; state: string }> {
  const deadline = Date.now() + context.config.timing.bootTimeoutMs;
  do {
    if (signal?.aborted === true) return { complete: false, state: 'aborted' };
    const instances = await listInstances(context);
    const current = instances.find((item) => item.id === instanceId);
    if (action === 'cleanup' && current === undefined) return { complete: true, state: 'absent' };
    if (action === 'stop' && current?.state === 'stopped') return { complete: true, state: 'stopped' };
    if (context.environment['CIRUJANO_RUNNER_ONCE'] === '1') return { complete: false, state: current?.state ?? 'absent' };
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, Math.min(context.config.timing.pollIntervalMs, 1_000)));
  } while (Date.now() < deadline);
  return { complete: false, state: 'timeout' };
}

async function directBoundary(context: RuntimeContext, name: string): Promise<void> {
  const markerPath = context.environment['CIRUJANO_FIXTURE_BOUNDARY_PATH'];
  if (markerPath === undefined) return;
  if (context.environment['CIRUJANO_GH_PATH'] === undefined || context.environment['CIRUJANO_NEBIUS_PATH'] === undefined) throw new Error('fixture boundary requires injected process endpoints');
  const absoluteMarker = absolutePath(markerPath, 'fixture boundary marker');
  await writeFile(absoluteMarker, `${name}\n`, { flag: 'a', mode: 0o600 });
  if (context.environment['CIRUJANO_FIXTURE_PAUSE_BOUNDARY'] === name) await new Promise<void>(() => undefined);
}

function requirePermit(context: RuntimeContext, operation: Permit['operations'][number]): Permit {
  const validation = validatePermit(context.permit, context.identity, Date.now());
  if (!validation.valid) throw new Error(validation.reason);
  if (!context.permit!.operations.includes(operation)) throw new Error(`permit does not authorize ${operation}`);
  return context.permit!;
}

function requireRecoveryPermit(context: RuntimeContext, operation: Permit['operations'][number]): Permit {
  if (context.permit === null) throw new Error('approval permit is absent');
  const validation = validatePermit(context.permit, context.identity, context.permit.issuedAtMs);
  if (!validation.valid) throw new Error(validation.reason);
  if (!context.permit.recoveryAllowed) throw new Error('permit does not authorize recovery');
  if (!context.permit.operations.includes(operation)) throw new Error(`permit does not authorize ${operation} recovery`);
  return context.permit;
}

function expectedResource(context: RuntimeContext): ExpectedNebiusResource {
  return {
    parentId: context.config.nebius.projectId,
    name: `${context.config.ownership.resourcePrefix}-vm`,
    labels: { 'cirujano-controller': context.config.ownership.controllerId, 'cirujano-config': context.identity.configHash },
    nebius: context.config.nebius,
  };
}

function exactOwnedInstance(instances: readonly NebiusInstance[], expected: ExpectedNebiusResource): NebiusInstance | null {
  const matches = instances.filter((instance) => instanceMatches(instance, expected));
  if (matches.length > 1) throw new Error(`found ${matches.length} matching owned VMs`);
  if (matches.length === 0 && instances.some((instance) => instance.name === expected.name
    || instance.labels['cirujano-controller'] === expected.labels['cirujano-controller']
    || instance.labels['cirujano-config'] === expected.labels['cirujano-config'])) {
    throw new Error('found a related VM whose immutable identity does not match');
  }
  return matches[0] ?? null;
}

async function cloudInit(context: RuntimeContext): Promise<string> {
  const guestDirectory = requiredAbsoluteEnvironment(context.environment, 'CIRUJANO_GUEST_DIR');
  const hostPrivateKeyPath = requiredAbsoluteEnvironment(context.environment, 'CIRUJANO_HOST_PRIVATE_KEY_PATH');
  const loginPublicKeyPath = requiredAbsoluteEnvironment(context.environment, 'CIRUJANO_LOGIN_PUBLIC_KEY_PATH');
  const runnerVersion = requiredEnvironment(context.environment, 'CIRUJANO_ACTIONS_RUNNER_VERSION');
  const runnerSha256 = requiredEnvironment(context.environment, 'CIRUJANO_ACTIONS_RUNNER_SHA256');
  const entries = await Promise.all(GUEST_FILE_NAMES.map(async (name) => [name, await readFile(join(guestDirectory, name), 'utf8')] as const));
  return renderCloudInit({
    runnerVersion,
    runnerSha256,
    sshHostPrivateKey: await readFile(hostPrivateKeyPath, 'utf8'),
    sshHostPublicKey: context.config.ssh.publicKey,
    sshLoginPublicKey: (await readFile(loginPublicKeyPath, 'utf8')).trim(),
    guestFiles: Object.fromEntries(entries) as Record<GuestFileName, string>,
  });
}

function instanceMatches(instance: NebiusInstance, expected: ExpectedNebiusResource): boolean {
  return instance.parentId === expected.parentId && instance.name === expected.name
    && Object.entries(expected.labels).every(([key, value]) => instance.labels[key] === value)
    && Object.keys(instance.labels).length === Object.keys(expected.labels).length
    && instance.recoveryPolicy === 'FAIL' && instance.platform === expected.nebius.platform
    && instance.preset === expected.nebius.preset && instance.subnetId === expected.nebius.subnetId
    && instance.diskType === expected.nebius.diskType.replaceAll('-', '_').toUpperCase()
    && instance.diskSizeGiB === expected.nebius.diskSizeGiB && instance.imageId === expected.nebius.imageId;
}

type ExtendedGuestSnapshot = LifecycleInput['guest'] & { networkEgressBytes?: number };

async function observeGuest(context: RuntimeContext, provider: LifecycleInput['provider']): Promise<ExtendedGuestSnapshot> {
  const status = provider.vmStatus;
  if (status === 'absent' || status === 'stopped') {
    return { complete: true, status: 'offline', admissionEnabled: false, runnerActive: false, workerActive: false, grant: null };
  }
  if (provider.ownership !== 'owned' || provider.network === undefined) {
    return { complete: false, status: status === 'starting' ? 'booting' : 'unknown', admissionEnabled: null, runnerActive: null, workerActive: null, grant: null };
  }
  try {
    const output = await runGuest(context, {
      id: provider.network.vmId, publicIp: provider.network.ipAddress,
    }, '/opt/cirujano/status', '');
    return parseGuestSnapshot(output);
  } catch {
    return { complete: false, status: status === 'starting' ? 'booting' : 'unknown', admissionEnabled: null, runnerActive: null, workerActive: null, grant: null };
  }
}

async function runGuest(
  context: RuntimeContext,
  instance: Pick<NebiusInstance, 'id' | 'publicIp'>,
  helper: string,
  stdin: string,
  secrets: readonly string[] = [],
): Promise<string> {
  if (instance.publicIp === null) throw new Error(`VM ${instance.id} has no public IP`);
  const identityFile = requiredAbsoluteEnvironment(context.environment, 'CIRUJANO_SSH_KEY_PATH');
  const sshPath = absolutePath(context.environment['CIRUJANO_SSH_PATH'] ?? '/usr/bin/ssh', 'SSH executable');
  const knownHostsFile = join(context.stateDirectory, 'known_hosts');
  verifySshPublicKeyFingerprint(context.config.ssh.publicKey, context.config.ssh.fingerprint);
  await mkdir(context.stateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(knownHostsFile, `${knownHostLine(instance.publicIp, 22, context.config.ssh.publicKey)}\n`, { mode: 0o600 });
  await chmod(knownHostsFile, 0o600);
  const invocation = buildSshInvocation({
    sshPath, host: instance.publicIp, port: 22, user: 'runner', identityFile, knownHostsFile,
    helper, stdin, timeoutSeconds: Math.min(60, Math.max(1, Math.ceil(context.config.timing.pollIntervalMs / 1_000))),
  });
  const result = await runProcess({
    command: invocation.command, args: invocation.args,
    ...(invocation.stdin === undefined ? {} : { stdin: invocation.stdin }),
    timeoutMs: context.config.timing.bootTimeoutMs, env: context.environment, secrets,
  });
  if (result.timedOut) throw new Error(`${helper} timed out`);
  if (result.exitCode !== 0) throw new Error(`${helper} failed: ${result.stderr}`);
  return result.stdout;
}

function parseGuestSnapshot(value: string): ExtendedGuestSnapshot {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('guest status must be an object');
  const item = parsed as Record<string, unknown>;
  const allowed = new Set(['complete', 'status', 'admissionEnabled', 'runnerActive', 'workerActive', 'grant', 'watchdogReady', 'sshIdentityVerified', 'registrationReady', 'networkEgressBytes']);
  if (Object.keys(item).some((key) => !allowed.has(key))) throw new Error('guest status contains an unknown field');
  const statuses = ['offline', 'booting', 'ready', 'busy', 'draining', 'drained', 'failed', 'unknown'] as const;
  if (typeof item.complete !== 'boolean' || typeof item.status !== 'string' || !statuses.includes(item.status as typeof statuses[number])) throw new Error('guest status fields are invalid');
  for (const key of ['admissionEnabled', 'runnerActive', 'workerActive'] as const) if (typeof item[key] !== 'boolean' && item[key] !== null) throw new Error(`guest ${key} is invalid`);
  let grant = null;
  if (item.grant !== null) {
    if (typeof item.grant !== 'object' || Array.isArray(item.grant)) throw new Error('guest grant is invalid');
    const source = item.grant as Record<string, unknown>;
    if (!Number.isInteger(source.generation) || !Number.isFinite(source.startedAtMs) || !Number.isFinite(source.deadlineMs)) throw new Error('guest grant fields are invalid');
    grant = { generation: source.generation as number, startedAtMs: source.startedAtMs as number, deadlineMs: source.deadlineMs as number };
  }
  return {
    complete: item.complete, status: item.status as typeof statuses[number],
    admissionEnabled: item.admissionEnabled as boolean | null, runnerActive: item.runnerActive as boolean | null,
    workerActive: item.workerActive as boolean | null, grant,
    ...(typeof item.watchdogReady === 'boolean' ? { watchdogReady: item.watchdogReady } : {}),
    ...(typeof item.sshIdentityVerified === 'boolean' ? { sshIdentityVerified: item.sshIdentityVerified } : {}),
    ...(typeof item.registrationReady === 'boolean' ? { registrationReady: item.registrationReady } : {}),
    ...(typeof item.networkEgressBytes === 'number' && Number.isFinite(item.networkEgressBytes) && item.networkEgressBytes >= 0 ? { networkEgressBytes: item.networkEgressBytes } : {}),
  };
}

async function readAccounting(context: RuntimeContext, state: ControllerState | null, provider: LifecycleInput['provider'], nowMs: number): Promise<ObservedAccounting> {
  try {
    const value = await readJournal<Record<string, unknown>>(context.accountingPath);
    if (value.schemaVersion !== 1 || JSON.stringify(value.identity) !== JSON.stringify(context.identity)) throw new Error('accounting identity does not match');
    const diskStartedAtMs = value.diskStartedAtMs;
    const generation = value.generation;
    for (const key of ['diskRetainedMs', 'runtimeBaselineMs', 'networkEgressBytes'] as const) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) throw new Error(`accounting ${key} is invalid`);
    }
    if (diskStartedAtMs !== null && (typeof diskStartedAtMs !== 'number' || !Number.isFinite(diskStartedAtMs))) throw new Error('accounting disk timestamp is invalid');
    if (generation !== null && (!Number.isInteger(generation) || (generation as number) < 1)) throw new Error('accounting generation is invalid');
    for (const key of ['networkBaselineBytes', 'networkGenerationStartBytes'] as const) if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)) throw new Error(`accounting ${key} is invalid`);
    return { diskStartedAtMs: diskStartedAtMs as number | null, diskRetainedMs: value.diskRetainedMs as number, runtimeBaselineMs: value.runtimeBaselineMs as number, generation: generation as number | null, networkEgressBytes: value.networkEgressBytes as number, ...(value.networkBaselineBytes === undefined ? {} : { networkBaselineBytes: value.networkBaselineBytes as number }), ...(value.networkGenerationStartBytes === undefined ? {} : { networkGenerationStartBytes: value.networkGenerationStartBytes as number }) };
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
    if (provider.ownership === 'owned' && state === null) throw new Error('owned VM has no durable accounting baseline');
    const createdAtMs = state?.pendingEffect?.effect.type === 'create-vm' ? state.pendingEffect.createdAtMs : nowMs;
    return { diskStartedAtMs: provider.ownership === 'owned' ? createdAtMs : null, diskRetainedMs: 0, runtimeBaselineMs: state?.lifecycle.cumulativeRuntimeMs ?? 0, generation: null, networkEgressBytes: 0 };
  }
}

async function readActiveJobMarker(context: RuntimeContext): Promise<boolean> {
  try {
    const value = await readJournal<Record<string, unknown>>(context.activeJobPath);
    if (value.schemaVersion !== 1 || JSON.stringify(value.identity) !== JSON.stringify(context.identity) || typeof value.activeJobKnown !== 'boolean') {
      throw new Error('active-job state is invalid or belongs to another identity');
    }
    return value.activeJobKnown;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

interface KnownAssignment {
  runId: number;
  runAttempt: number;
  jobId: number;
  runnerId: number;
  runnerName: string;
  conclusion: string | null;
}

async function readAssignments(context: RuntimeContext): Promise<KnownAssignment[]> {
  try {
    const value = await readJournal<Record<string, unknown>>(context.assignmentPath);
    if (value.schemaVersion !== 1 || JSON.stringify(value.identity) !== JSON.stringify(context.identity) || !Array.isArray(value.assignments)) throw new Error('assignment state is invalid or belongs to another identity');
    return value.assignments.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`assignment ${index} is invalid`);
      const item = entry as Record<string, unknown>;
      for (const key of ['runId', 'runAttempt', 'jobId', 'runnerId'] as const) if (!Number.isInteger(item[key]) || (item[key] as number) < 1) throw new Error(`assignment ${index} ${key} is invalid`);
      if (typeof item.runnerName !== 'string' || item.runnerName.length === 0 || (item.conclusion !== null && typeof item.conclusion !== 'string')) throw new Error(`assignment ${index} identity is invalid`);
      return item as unknown as KnownAssignment;
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function mergeAssignments(prior: readonly KnownAssignment[], jobs: readonly WorkflowJob[], runnerName: string): KnownAssignment[] {
  const merged = new Map(prior.map((entry) => [`${entry.runId}:${entry.runAttempt}:${entry.jobId}`, entry]));
  for (const job of jobs) {
    const previous = merged.get(job.key);
    const belongs = job.runnerId !== null && job.runnerName === runnerName;
    if (!belongs && previous === undefined) continue;
    const runnerId = job.runnerId ?? previous?.runnerId;
    const resolvedRunnerName = job.runnerName ?? previous?.runnerName;
    if (runnerId === undefined || resolvedRunnerName === undefined) continue;
    merged.set(job.key, { runId: job.runId, runAttempt: job.runAttempt, jobId: job.id, runnerId, runnerName: resolvedRunnerName, conclusion: job.status === 'completed' ? job.conclusion ?? 'unknown' : null });
  }
  return [...merged.values()];
}

async function readDirectAction(context: RuntimeContext): Promise<{ action: 'stop' | 'cleanup'; stage: 'intent' | 'emitting' | 'resolved'; instanceId: string; [key: string]: unknown } | null> {
  try {
    const value = await readJournal<Record<string, unknown>>(context.directActionPath);
    if (value.schemaVersion !== 1 || JSON.stringify(value.identity) !== JSON.stringify(context.identity)) throw new Error('direct action identity does not match');
    if ((value.action !== 'stop' && value.action !== 'cleanup') || !['intent', 'emitting', 'resolved'].includes(String(value.stage))) throw new Error('direct action state is invalid');
    if (typeof value.instanceId !== 'string' || value.instanceId.length === 0) {
      if (value.stage === 'resolved' && value.providerState === 'absent') return null;
      throw new Error('direct action instance identity is invalid');
    }
    return value as { action: 'stop' | 'cleanup'; stage: 'intent' | 'emitting' | 'resolved'; instanceId: string; [key: string]: unknown };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function priorState(context: RuntimeContext): Promise<ControllerState | null> {
  try { return parseControllerState(await readJournal<unknown>(context.journalPath)); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function expectedRunnerName(context: RuntimeContext, state: ControllerState | null): string {
  return `${context.config.ownership.resourcePrefix}-g${Math.max(1, state?.lifecycle.startCount ?? 1)}`;
}

function projectedStartCost(context: RuntimeContext): number {
  const rawNetworkLimit = context.environment['CIRUJANO_NETWORK_EGRESS_LIMIT_GIB'];
  if (rawNetworkLimit === undefined) return Number.POSITIVE_INFINITY;
  const networkLimitGiB = Number(rawNetworkLimit);
  if (!Number.isFinite(networkLimitGiB) || networkLimitGiB < 0) return Number.POSITIVE_INFINITY;
  const config = context.config;
  const compute = (config.timing.lifetimeMs / 3_600_000) * config.rates.computeUsdPerHour;
  const disk = (config.timing.lifetimeMs / THIRTY_DAY_MONTH_MS) * config.nebius.diskSizeGiB * config.rates.diskUsdPerGibMonth;
  return compute + disk + networkLimitGiB * config.rates.networkEgressUsdPerGib;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function collection<T>(complete: boolean, items: readonly T[], reason?: string, retryAfterMs?: number) {
  return {
    complete, items,
    ...(reason === undefined ? {} : { reason }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

async function requireSuccessful<T extends { exitCode: number; timedOut: boolean; stderr: string }>(result: T, operationName: string): Promise<T> {
  if (result.timedOut) throw new Error(`${operationName} timed out`);
  if (result.exitCode !== 0) throw new Error(`${operationName} failed: ${result.stderr}`);
  return result;
}

async function operation(resultValue: { exitCode: number; timedOut: boolean; stderr: string; stdout: string }, name: string): Promise<{ operationId?: string }> {
  const result = await requireSuccessful(resultValue, name);
  const body = JSON.parse(result.stdout) as unknown;
  if (typeof body !== 'object' || body === null || !('metadata' in body)) return {};
  const metadata = (body as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null || !('id' in metadata) || typeof metadata.id !== 'string') return {};
  return { operationId: metadata.id };
}

async function executableDigest(): Promise<string> {
  try { return createHash('sha256').update(await readFile(process.argv[1] ?? '')).digest('hex'); }
  catch { return createHash('sha256').update('cirujano-runner-development').digest('hex'); }
}

function absolutePath(value: string, name: string): string {
  if (!value.startsWith('/')) throw new Error(`${name} path must be absolute`);
  return value;
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function requiredAbsoluteEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  return absolutePath(requiredEnvironment(environment, name), name);
}
