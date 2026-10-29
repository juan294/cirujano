import { join } from 'node:path';

import {
  assessService,
  parseControllerState,
  parsePermit,
  parseRunnerConfig,
  projectedStartCostUsd,
  runnerConfigHash,
  selectStrandedRuns,
  type PermitIdentity,
  type RunnerConfig,
  type Collection,
  type Permit,
  type TimingConfig,
  type WorkflowJob,
  type WorkflowRun,
} from '@cirujano/runner';

import type { CliIo } from './cli.js';
import { writeFleetRegistry, type FleetEnrollment, type FleetRegistry } from './fleet-registry.js';
import type { GitHubFleetSource } from './fleet-service.js';
import { readOptionalJson } from './github-api.js';

/**
 * Fleet health and owner release for the routing switch (docs/plans/2026-10-29-runner-routing-switch.md,
 * phase 2). Health is read-only; release is the owner's command to turn one runner's routing off.
 */

/** The GitHub calls health and release need; GitHubAdapter from @cirujano/runner implements them. */
export interface RoutingGitHub {
  getVariable(owner: string, repository: string, name: string): Promise<'on' | 'other' | 'absent'>;
  deleteVariable(owner: string, repository: string, name: string): Promise<'deleted' | 'absent'>;
  forceCancelRun(owner: string, repository: string, runId: number): Promise<'accepted' | 'completed'>;
  listActiveRuns(owner: string, repository: string): Promise<Collection<WorkflowRun>>;
  listJobs(owner: string, repository: string, runId: number, runAttempt: number): Promise<Collection<WorkflowJob>>;
}

type HealthStatus = 'serving' | 'expiring' | 'no-auto-release' | 'unserviceable' | 'released' | 'stranded' | 'ungated' | 'unknown';
type Colour = 'green' | 'amber' | 'red';

export interface HealthRow {
  id: string;
  repository: string;
  status: HealthStatus;
  colour: Colour;
  reason: string | null;
  switch: 'on' | 'other' | 'absent' | null;
  serviceEnd: string | null;
  strandedRuns: { cancellable: number[]; waiting: number[] } | null;
  recovery: string | null;
}

export interface HealthReport {
  status: Colour;
  now: string;
  nowOverridden: boolean;
  rows: HealthRow[];
}

const WARNING_MS = 7 * 24 * 60 * 60 * 1000;
const RELEASE_OPERATION = 'release-routing';

export async function fleetHealth(input: {
  registry: FleetRegistry;
  registryPath: string;
  source: GitHubFleetSource;
  /** A fresh client per enrollment, so one repository's 403 backoff never turns the next row unknown. */
  githubFor: () => RoutingGitHub;
  nowMs: number;
  nowOverridden: boolean;
  defaultTiming: Pick<TimingConfig, 'maxJobMs' | 'shutdownMarginMs'>;
  /** The controller wrapper's egress limit (run-cirujano-controller.sh defaults it to 10 GiB). */
  networkEgressLimitGiB: number;
}): Promise<HealthReport> {
  const rows: HealthRow[] = [];
  for (const enrollment of input.registry.enrollments.filter(({ status }) => status === 'cut-over')) {
    rows.push(await healthRow(enrollment, input));
  }
  const status: Colour = rows.some(({ colour }) => colour === 'red') ? 'red' : rows.some(({ colour }) => colour === 'amber') ? 'amber' : 'green';
  return { status, now: new Date(input.nowMs).toISOString(), nowOverridden: input.nowOverridden, rows };
}

async function healthRow(enrollment: FleetEnrollment, input: Parameters<typeof fleetHealth>[0]): Promise<HealthRow> {
  const row = (status: HealthStatus, colour: Colour, fields: Partial<HealthRow> = {}): HealthRow => ({
    id: enrollment.id, repository: enrollment.repository, status, colour, reason: null, switch: null, serviceEnd: null, strandedRuns: null, recovery: null, ...fields,
  });
  const releaseCommand = `cirujano fleet release --registry ${input.registryPath} --id ${enrollment.id}`;
  if (enrollment.routingSwitch === undefined) {
    return row('ungated', 'red', { recovery: `generate the selection with cirujano fleet runs-on --registry ${input.registryPath} --id ${enrollment.id}` });
  }
  const [owner, name] = splitRepository(enrollment.repository);
  let controller: ControllerEvidence;
  try {
    controller = await readController(enrollment, input.defaultTiming, input.networkEgressLimitGiB);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return row('unserviceable', 'red', {
      reason: `controller-state-unreadable: ${message}`,
      recovery: `repair or archive the controller files in ${enrollment.controller?.stateDirectory ?? 'the controller directory'}, or run ${releaseCommand}`,
    });
  }
  const github = input.githubFor();
  try {
    const repositoryPrivate = (await input.source.repository(enrollment.repository)).visibility === 'private';
    const switchState = await github.getVariable(owner, name, enrollment.routingSwitch);
    const { permitError, ...evidence } = controller;
    const assessment = assessService({ ...evidence, nowMs: input.nowMs, repositoryPrivate });
    const serviceEnd = assessment.serviceEndMs === null ? null : new Date(assessment.serviceEndMs).toISOString();
    const fields = { switch: switchState, serviceEnd };
    const routedHere = switchState === 'on' && assessment.serviceable && permitError === null;
    const stranded = routedHere ? null : await strandedRuns(github, owner, name, { workflowIds: [enrollment.workflowId], runnerLabel: enrollment.runnerLabel });
    const strandedFields = { ...fields, strandedRuns: stranded === null ? null : { cancellable: stranded.cancellable, waiting: stranded.waiting } };
    const anyStranded = stranded !== null && stranded.strandedJobs.length > 0;
    const cancelCommand = `${releaseCommand} --cancel-stranded`;
    if (switchState !== 'on') {
      return anyStranded ? row('stranded', 'red', { ...strandedFields, recovery: cancelCommand }) : row('released', 'green', strandedFields);
    }
    if (permitError !== null || !assessment.serviceable) {
      const reason = permitError === null ? (assessment as { reason: string }).reason : `permit-invalid: ${permitError}`;
      return row('unserviceable', 'red', { ...strandedFields, reason, recovery: anyStranded ? cancelCommand : releaseCommand });
    }
    if (assessment.serviceEndMs - input.nowMs <= WARNING_MS) {
      return row('expiring', 'amber', { ...fields, recovery: `service ends ${serviceEnd}; renew the permit or run ${releaseCommand}` });
    }
    if (!(controller.permit!.operations as readonly string[]).includes(RELEASE_OPERATION)) {
      return row('no-auto-release', 'amber', { ...fields, recovery: `the controller cannot release this runner; reissue the permit with ${RELEASE_OPERATION}, or release by hand before ${serviceEnd}` });
    }
    return row('serving', 'green', fields);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return row('unknown', 'red', { reason: message, recovery: `retry; GitHub read incomplete: ${message}` });
  }
}

interface ControllerEvidence {
  permit: Permit | null;
  permitError: string | null;
  timing: Pick<TimingConfig, 'maxJobMs' | 'shutdownMarginMs'>;
  identity?: Partial<PermitIdentity>;
  startCount: number;
  cumulativeRuntimeMs: number;
  cumulativeCostUsd: number;
  projectedStartCostUsd: number;
}

/**
 * Local controller evidence: permit, config identity and timing, lifetime totals. A missing file means
 * none yet. An unreadable permit is reported as invalid; any other unreadable file throws, because
 * retrying GitHub cannot fix it.
 */
async function readController(
  enrollment: FleetEnrollment, defaultTiming: Pick<TimingConfig, 'maxJobMs' | 'shutdownMarginMs'>, networkEgressLimitGiB: number,
): Promise<ControllerEvidence> {
  const stateDirectory = enrollment.controller?.stateDirectory;
  const none = { permit: null, permitError: null, timing: defaultTiming, startCount: 0, cumulativeRuntimeMs: 0, cumulativeCostUsd: 0, projectedStartCostUsd: 0 };
  if (stateDirectory === undefined) return none;
  let permit: Permit | null = null;
  let permitError: string | null = null;
  try {
    const rawPermit = await readOptionalJson(join(stateDirectory, 'permit.json'));
    permit = rawPermit === null ? null : parsePermit(rawPermit);
  } catch (error) {
    permitError = error instanceof Error ? error.message : String(error);
  }
  const rawConfig = await readOptionalJson(join(stateDirectory, 'config.json'));
  const config: RunnerConfig | null = rawConfig === null ? null : parseRunnerConfig(rawConfig);
  const rawState = await readOptionalJson(join(stateDirectory, 'controller-state.json'));
  const lifecycle = rawState === null ? null : parseControllerState(rawState).lifecycle;
  return {
    permit, permitError,
    timing: config?.timing ?? defaultTiming,
    // The installed bundle digest is the controller's to check; the fleet checks everything else.
    ...(config === null ? {} : { identity: {
      configHash: runnerConfigHash(config), repositoryId: config.repository.id, projectId: config.nebius.projectId,
      controllerId: config.ownership.controllerId, resourcePrefix: config.ownership.resourcePrefix,
    } }),
    startCount: lifecycle?.startCount ?? 0,
    cumulativeRuntimeMs: lifecycle?.cumulativeRuntimeMs ?? 0,
    cumulativeCostUsd: lifecycle?.cumulativeCostUsd ?? 0,
    projectedStartCostUsd: config === null ? 0 : projectedStartCostUsd(config, networkEgressLimitGiB),
  };
}

/** Runs of the enrolled workflows with jobs queued on the runner label, read from GitHub's active runs. */
export async function strandedRuns(github: RoutingGitHub, owner: string, name: string, scope: { workflowIds: readonly number[]; runnerLabel: string }) {
  const runs = complete(await github.listActiveRuns(owner, name)).filter(({ workflowId }) => scope.workflowIds.includes(workflowId));
  const jobs: WorkflowJob[] = [];
  for (const run of runs) jobs.push(...complete(await github.listJobs(owner, name, run.id, run.runAttempt)));
  return selectStrandedRuns(runs, jobs, scope.runnerLabel);
}

function complete<T>(collection: Collection<T>): readonly T[] {
  if (!collection.complete) throw new Error(collection.reason ?? 'GitHub collection is incomplete');
  return collection.items;
}

function splitRepository(repository: string): [string, string] {
  const [owner, name] = repository.split('/');
  return [owner!, name!];
}

export function renderHealthMarkdown(report: HealthReport): string {
  const lines = [
    '# Cirujano fleet health',
    '',
    `Checked ${report.now}${report.nowOverridden ? ' (simulated with --now)' : ''}. Status: ${report.status}.`,
    '',
  ];
  if (report.rows.length === 0) return `${[...lines, 'No cut-over enrollments.'].join('\n')}\n`;
  lines.push('| Enrollment | Repository | Status | Switch | Service end | Stranded runs | Recovery |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of report.rows) {
    const status = row.reason === null ? row.status : `${row.status} (${row.reason})`;
    const stranded = row.strandedRuns === null || row.strandedRuns.cancellable.length + row.strandedRuns.waiting.length === 0
      ? 'none'
      : [row.strandedRuns.cancellable.length > 0 ? `cancellable ${row.strandedRuns.cancellable.join(', ')}` : '', row.strandedRuns.waiting.length > 0 ? `waiting ${row.strandedRuns.waiting.join(', ')}` : ''].filter(Boolean).join('; ');
    const recovery = row.recovery === null ? 'none' : `\`${row.recovery}\``;
    lines.push(`| ${row.id} | ${row.repository} | ${status} | ${row.switch ?? 'n/a'} | ${row.serviceEnd ?? 'n/a'} | ${stranded} | ${recovery} |`);
  }
  return `${lines.join('\n')}\n`;
}

export async function fleetRelease(input: {
  registry: FleetRegistry;
  registryPath: string;
  id: string;
  cancelStranded: boolean;
  github: RoutingGitHub;
  io: CliIo;
}): Promise<0 | 1> {
  const enrollment = input.registry.enrollments.find(({ id }) => id === input.id);
  if (enrollment === undefined) throw new Error(`enrollment ${input.id} does not exist`);
  if (enrollment.status !== 'cut-over') throw new Error(`enrollment ${input.id} is ${enrollment.status}, not cut-over`);
  const switchVariable = enrollment.routingSwitch;
  if (switchVariable === undefined) throw new Error(`enrollment ${input.id} has no routing switch; its runner can only be released by a workflow push`);
  const [owner, name] = splitRepository(enrollment.repository);

  let variable = await input.github.deleteVariable(owner, name, switchVariable);
  if (await input.github.getVariable(owner, name, switchVariable) === 'on') {
    variable = await input.github.deleteVariable(owner, name, switchVariable);
    if (await input.github.getVariable(owner, name, switchVariable) === 'on') {
      input.io.stderr(`${switchVariable} is still on after two deletes; check the token's variable permission and delete it with gh variable delete ${switchVariable} --repo ${enrollment.repository}\n`);
      return 1;
    }
  }
  const releasedAt = new Date().toISOString();
  await writeFleetRegistry(input.registryPath, {
    ...input.registry,
    enrollments: input.registry.enrollments.map((entry) => entry.id === enrollment.id
      ? { ...entry, notes: [...entry.notes, `routing released at ${releasedAt} by fleet release (${switchVariable} ${variable})`] }
      : entry),
  });

  // The switch is off from here on; every later failure is reported with what already happened.
  const report: Record<string, unknown> = { status: 'released', id: enrollment.id, repository: enrollment.repository, switchVariable, variable, releasedAt };
  const scope = { workflowIds: [enrollment.workflowId], runnerLabel: enrollment.runnerLabel };
  let failed = false;
  try {
    const stranded = await strandedRuns(input.github, owner, name, scope);
    const cancelled: number[] = [];
    const failures: Array<{ runId: number; error: string }> = [];
    if (input.cancelStranded) {
      for (const runId of stranded.cancellable) {
        try {
          await input.github.forceCancelRun(owner, name, runId);
          cancelled.push(runId);
        } catch (error) {
          failures.push({ runId, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    // Force-cancel is asynchronous on GitHub; a run still active here is reported, not retried.
    const stillActive = cancelled.length === 0 ? [] : complete(await input.github.listActiveRuns(owner, name)).map(({ id }) => id).filter((id) => cancelled.includes(id));
    const notCancelled = input.cancelStranded ? [] : stranded.cancellable;
    failed = failures.length > 0;
    Object.assign(report, { cancelled, stillActive, failedCancels: failures, waiting: stranded.waiting, notCancelled, nextStep: nextStep(cancelled, stranded.waiting, notCancelled) });
  } catch (error) {
    failed = true;
    Object.assign(report, { strandedScan: `failed: ${error instanceof Error ? error.message : String(error)}`, nextStep: `re-run cirujano fleet release --registry ${input.registryPath} --id ${enrollment.id} --cancel-stranded` });
  }
  input.io.stdout(`${JSON.stringify(report)}\n`);
  return failed ? 1 : 0;
}

function nextStep(cancelled: readonly number[], waiting: readonly number[], notCancelled: readonly number[]): string {
  const hosted = 'with the switch off it runs on ubuntu-latest';
  if (notCancelled.length > 0) return `run cirujano fleet release with --cancel-stranded to cancel the stranded runs, then push or dispatch a new run; ${hosted}`;
  if (cancelled.length > 0) return `push or dispatch a new run for each cancelled run; ${hosted}${waiting.length > 0 ? '. Re-run release for runs still waiting on other jobs' : ''}`;
  if (waiting.length > 0) return 're-run release with --cancel-stranded once the runs still waiting on other jobs finish';
  return `nothing is stranded; new runs use ubuntu-latest while the switch is off`;
}
