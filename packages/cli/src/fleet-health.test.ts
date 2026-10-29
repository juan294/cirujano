import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Collection, WorkflowJob, WorkflowRun } from '@cirujano/runner';

import { runCli } from './cli.js';
import type { RoutingGitHub } from './fleet-health.js';
import { parseFleetRegistry, writeFleetRegistry, type FleetEnrollment, type FleetRegistry } from './fleet-registry.js';
import { createFleetCommandService } from './fleet-service.js';

const LABEL = 'cirujano-baseline-actions_linux';
const LABELS = ['self-hosted', 'linux', 'x64', LABEL];
const SHA = 'a'.repeat(40);
const EXPIRY = Date.parse('2026-10-28T23:59:59Z');
const FAR = '2026-10-10T00:00:00Z';

function permit(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, permitId: 'P1-operating', configHash: 'c', candidateDigest: 'd', repositoryId: 777, projectId: 'project', controllerId: 'cirujano-p1',
    resourcePrefix: 'cirujano-p1', operations: ['create', 'start', 'register', 'stop', 'delete'], issuedAtMs: Date.parse('2026-09-29T00:00:00Z'),
    expiresAtMs: EXPIRY, maxStarts: 600, maxRuntimeMs: 540_000_000, maxTotalCostUsd: 40, recoveryAllowed: true, ...overrides,
  };
}

function enrollment(stateDirectory: string | null, overrides: Partial<FleetEnrollment> = {}): FleetEnrollment {
  return {
    id: 'P1', repository: 'juan294/app', repositoryId: 777, workflowPath: '.github/workflows/ci.yml', workflowId: 41, workflowName: 'CI',
    jobKey: 'check', jobNames: ['Check'], sku: 'actions_linux', runnerLabel: LABEL, status: 'cut-over', routingSwitch: 'CIRUJANO_RUNNER_P1',
    before: { commit: SHA, workflowBlobSha: '1'.repeat(40), runsOn: ['ubuntu-latest'], recordedAt: '2026-09-16T08:00:00.000Z' },
    after: { commit: SHA, workflowBlobSha: '2'.repeat(40), runsOn: LABELS, recordedAt: '2026-09-17T08:00:00.000Z' },
    controller: stateDirectory === null ? null : { stateDirectory, controllerId: 'cirujano-p1', resourcePrefix: 'cirujano-p1', permitId: 'P1-operating' },
    notes: [], ...overrides,
  };
}

interface Fixture {
  registryPath: string;
  stateDirectory: string;
  github: FakeRouting;
  visibility: string;
}

class FakeRouting implements RoutingGitHub {
  variable: 'on' | 'other' | 'absent' = 'on';
  deleteSticks = true;
  runs: WorkflowRun[] = [];
  jobs: WorkflowJob[] = [];
  incomplete: string | null = null;
  runsIncomplete: string | null = null;
  cancelFails = new Set<number>();
  cancelLags = false;
  readonly writes: string[] = [];

  async getVariable(_owner: string, _repository: string, name: string) {
    if (this.incomplete !== null) throw new Error(this.incomplete);
    expect(name).toBe('CIRUJANO_RUNNER_P1');
    return this.variable;
  }
  async deleteVariable(_owner: string, _repository: string, name: string) {
    this.writes.push(`delete ${name}`);
    const prior = this.variable;
    if (this.deleteSticks) this.variable = 'absent';
    return prior === 'absent' ? 'absent' as const : 'deleted' as const;
  }
  async forceCancelRun(_owner: string, _repository: string, runId: number) {
    this.writes.push(`force-cancel ${runId}`);
    if (this.cancelFails.has(runId)) throw new Error(`GitHub returned HTTP 500 force-cancelling run ${runId}: boom`);
    if (!this.cancelLags) this.runs = this.runs.filter(({ id }) => id !== runId);
    return 'accepted' as const;
  }
  async listActiveRuns(): Promise<Collection<WorkflowRun>> {
    const reason = this.incomplete ?? this.runsIncomplete;
    return reason === null ? { complete: true, items: this.runs } : { complete: false, items: [], reason };
  }
  async listJobs(_owner: string, _repository: string, runId: number, runAttempt: number): Promise<Collection<WorkflowJob>> {
    return { complete: true, items: this.jobs.filter((job) => job.runId === runId && job.runAttempt === runAttempt) };
  }
}

function run(id: number, workflowId = 41): WorkflowRun {
  return { id, workflowId, runAttempt: 1, status: 'queued', conclusion: null, event: 'push', headBranch: 'develop', headSha: SHA, repositoryId: 777, headRepositoryId: 777, pullRequestCount: 0 };
}

function job(id: number, runId: number, status: string, labels: readonly string[] = LABELS): WorkflowJob {
  return {
    key: `${runId}:1:${id}`, id, runId, runAttempt: 1, headSha: SHA, status, conclusion: status === 'completed' ? 'success' : null, name: `job ${id}`,
    labels, runnerId: null, runnerName: null, runnerGroupId: null, runnerGroupName: null, startedAt: null, completedAt: null,
  };
}

async function fixture(options: { permit?: Record<string, unknown> | 'absent' | 'invalid'; enrollment?: Partial<FleetEnrollment>; noController?: boolean; visibility?: string } = {}): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'cirujano-health-'));
  const stateDirectory = join(directory, 'P1');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(stateDirectory, { recursive: true });
  if (options.permit === 'invalid') await writeFile(join(stateDirectory, 'permit.json'), '{"schemaVersion":1}');
  else if (options.permit !== 'absent') await writeFile(join(stateDirectory, 'permit.json'), JSON.stringify(permit(options.permit ?? {})));
  const registry: FleetRegistry = parseFleetRegistry({
    schemaVersion: 1, owner: 'juan294', measurementWindow: { since: '2026-09-13', through: '2026-10-28' },
    exclusions: ['frivas/contribution-dashboard', 'behboud/opencode-rpi', 'juan294/home-network'].map((repository) => ({ repository, reason: 'named exclusion', lockedBy: 'fleet-telemetry plan 2026-09-13' })),
    enrollments: [enrollment(options.noController === true ? null : stateDirectory, options.enrollment ?? {})],
  });
  const registryPath = join(directory, 'fleet-registry.json');
  await writeFleetRegistry(registryPath, registry);
  return { registryPath, stateDirectory, github: new FakeRouting(), visibility: options.visibility ?? 'private' };
}

const CONFIG = {
  schemaVersion: 1,
  repository: { id: 777, nameWithOwner: 'juan294/app', visibility: 'private' },
  workflowIds: [41], allowedBranch: 'develop', eligibleJobNames: ['Check'], runnerLabel: LABEL, slots: 1, admission: 'same-repository',
  nebius: { profile: 'TCT', projectId: 'project', subnetId: 'subnet-1', imageId: 'image-1', platform: 'cpu-d3', preset: '4vcpu-16gb', diskType: 'network-ssd', diskSizeGiB: 80 },
  ssh: { publicKey: 'ssh-ed25519 AAAA fixture', fingerprint: 'SHA256:fixture' },
  ownership: { controllerId: 'cirujano-p1', resourcePrefix: 'cirujano-p1' },
  timing: { pollIntervalMs: 30_000, idleGraceMs: 300_000, bootTimeoutMs: 600_000, maxJobMs: 3_600_000, lifetimeMs: 14_400_000, shutdownMarginMs: 300_000 },
  rates: { currency: 'USD', quotedAt: '2026-09-15', source: 'fixture', computeUsdPerHour: 0.1, diskUsdPerGibMonth: 0.071, networkEgressUsdPerGib: 0, hostedUsdPerMinute: 0.008 },
  routingSwitch: { variable: 'CIRUJANO_RUNNER_P1' },
};

/** Writes config.json, a matching permit and controller-state.json with the given lifetime totals. */
async function withController(fx: Fixture, lifecycle: { startCount?: number; cumulativeRuntimeMs?: number; cumulativeCostUsd?: number } = {}, permitChanges: Record<string, unknown> = {}) {
  const { parseRunnerConfig, runnerConfigHash } = await import('@cirujano/runner');
  const configHash = runnerConfigHash(parseRunnerConfig(CONFIG));
  await writeFile(join(fx.stateDirectory, 'config.json'), JSON.stringify(CONFIG));
  await writeFile(join(fx.stateDirectory, 'permit.json'), JSON.stringify(permit({ configHash, operations: ['create', 'start', 'register', 'stop', 'delete', 'release-routing'], ...permitChanges })));
  await writeFile(join(fx.stateDirectory, 'controller-state.json'), JSON.stringify({
    schemaVersion: 1,
    identity: { configHash, candidateDigest: 'd', repositoryId: 777, projectId: 'project', controllerId: 'cirujano-p1', resourcePrefix: 'cirujano-p1' },
    lifecycle: { state: 'absent', startCount: 0, cumulativeRuntimeMs: 0, cumulativeCostUsd: 0, outstandingIntent: null, idleObservations: [], ...lifecycle },
    pendingEffect: null, readbacks: [],
  }));
}

function serviceFor(fx: Fixture) {
  const pageRunner = async (_command: string, args: readonly string[]) => {
    const endpoint = args.at(-1)!;
    if (endpoint === '/repos/juan294/app') return { stdout: JSON.stringify([{ id: 777, full_name: 'juan294/app', default_branch: 'main', visibility: fx.visibility }]) };
    throw new Error(`unexpected GitHub read ${endpoint}`);
  };
  return createFleetCommandService({}, pageRunner, () => fx.github);
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (text: string) => { out.push(text); }, stderr: (text: string) => { err.push(text); } }, out, err };
}

async function health(fx: Fixture, now: string, format: 'json' | 'markdown' = 'json') {
  const { io, out } = capture();
  const exitCode = await serviceFor(fx).run({ command: 'fleet', action: 'health', registryPath: fx.registryPath, format, now }, io);
  return { exitCode, text: out.join(''), report: format === 'json' ? JSON.parse(out.join('')) as { status: string; now: string; nowOverridden: boolean; rows: Array<Record<string, unknown>> } : null };
}

describe('fleet health', () => {
  it('reports a valid permit without release-routing as amber no-auto-release, with the service end', async () => {
    const fx = await fixture();
    const { exitCode, report } = await health(fx, FAR);
    expect(exitCode).toBe(0);
    expect(report!.rows).toEqual([expect.objectContaining({
      id: 'P1', status: 'no-auto-release', colour: 'amber', switch: 'on', serviceEnd: '2026-10-28T22:54:59.000Z',
      recovery: 'the controller cannot release this runner; reissue the permit with release-routing, or release by hand before 2026-10-28T22:54:59.000Z',
    })]);
    expect(report).toMatchObject({ status: 'amber', now: '2026-10-10T00:00:00.000Z', nowOverridden: true });
  });

  it('replays the 2026-10-28 incident: amber a week ahead, red after the service end', async () => {
    const fx = await fixture();
    expect((await health(fx, '2026-10-21T23:00:00Z')).report!.rows[0]).toMatchObject({
      status: 'expiring', colour: 'amber',
      recovery: `service ends 2026-10-28T22:54:59.000Z; renew the permit or run cirujano fleet release --registry ${fx.registryPath} --id P1`,
    });
    const late = await health(fx, '2026-10-28T23:00:00Z');
    expect(late.exitCode).toBe(1);
    expect(late.report!.rows[0]).toMatchObject({ status: 'unserviceable', colour: 'red', reason: 'past-service-end', recovery: `cirujano fleet release --registry ${fx.registryPath} --id P1` });
  });

  it.each([
    ['permit-absent', { permit: 'absent' as const }],
    ['permit-absent', { noController: true }],
    ['permit-expired', { permit: { expiresAtMs: Date.parse('2026-10-01T00:00:00Z') } }],
    ['permit-not-active', { permit: { issuedAtMs: Date.parse('2026-10-20T00:00:00Z') } }],
    ['repository-not-private', { visibility: 'public' }],
  ])('prints the release command for unserviceable reason %s', async (reason, options) => {
    const fx = await fixture(options);
    const { exitCode, report } = await health(fx, FAR);
    expect(exitCode).toBe(1);
    expect(report!.rows[0]).toMatchObject({ status: 'unserviceable', reason, recovery: `cirujano fleet release --registry ${fx.registryPath} --id P1` });
  });

  it('reports an unreadable permit as unserviceable with its parse error', async () => {
    const fx = await fixture({ permit: 'invalid' });
    const { report } = await health(fx, FAR);
    expect(report!.rows[0]).toMatchObject({ status: 'unserviceable', reason: expect.stringMatching(/^permit-invalid: permit contains|^permit-invalid: permit is missing/u) });
  });

  it('shows a released switch as green and a job stranded on its label as red with the cancel command', async () => {
    const fx = await fixture();
    fx.github.variable = 'absent';
    const released = await health(fx, FAR);
    expect(released.exitCode).toBe(0);
    expect(released.report!.rows[0]).toMatchObject({ status: 'released', colour: 'green', switch: 'absent', recovery: null, strandedRuns: { cancellable: [], waiting: [] } });

    fx.github.runs = [run(10), run(11), run(12, 99)];
    fx.github.jobs = [job(1, 10, 'queued'), job(2, 11, 'queued'), job(3, 11, 'in_progress', ['ubuntu-latest']), job(4, 12, 'queued')];
    const stranded = await health(fx, FAR);
    expect(stranded.exitCode).toBe(1);
    expect(stranded.report!.rows[0]).toMatchObject({
      status: 'stranded', colour: 'red', strandedRuns: { cancellable: [10], waiting: [11] },
      recovery: `cirujano fleet release --registry ${fx.registryPath} --id P1 --cancel-stranded`,
    });
  });

  it('treats a switch value other than on as released', async () => {
    const fx = await fixture();
    fx.github.variable = 'other';
    expect((await health(fx, FAR)).report!.rows[0]).toMatchObject({ status: 'released', switch: 'other' });
  });

  it('reports an ungated enrollment and an incomplete GitHub read as red', async () => {
    const ungated = await fixture();
    const legacy = parseFleetRegistry(JSON.parse(await readFile(ungated.registryPath, 'utf8')));
    delete legacy.enrollments[0]!.routingSwitch;
    await writeFleetRegistry(ungated.registryPath, legacy);
    expect((await health(ungated, FAR)).report!.rows[0]).toMatchObject({
      status: 'ungated', colour: 'red', recovery: `generate the selection with cirujano fleet runs-on --registry ${ungated.registryPath} --id P1`,
    });

    const unknown = await fixture();
    unknown.github.incomplete = 'GitHub HTTP 502';
    const result = await health(unknown, FAR);
    expect(result.exitCode).toBe(1);
    expect(result.report!.rows[0]).toMatchObject({ status: 'unknown', colour: 'red', recovery: 'retry; GitHub read incomplete: GitHub HTTP 502' });
  });

  it('reports serving with a permit that can release routing and a matching controller identity', async () => {
    const fx = await fixture();
    await withController(fx);
    const { exitCode, report } = await health(fx, FAR);
    expect(exitCode).toBe(0);
    expect(report).toMatchObject({ status: 'green', rows: [{ status: 'serving', colour: 'green', switch: 'on', recovery: null, serviceEnd: '2026-10-28T22:54:59.000Z' }] });
  });

  it.each([
    ['starts-exhausted', { startCount: 600 }, {}],
    ['runtime-exhausted', { cumulativeRuntimeMs: 540_000_000 - 3_899_999 }, {}],
    ['cost-exhausted', { cumulativeCostUsd: 39.9 }, {}],
    ['permit-identity-mismatch', {}, { configHash: 'stale' }],
  ])('reads controller files for unserviceable reason %s', async (reason, lifecycle, permitChanges) => {
    const fx = await fixture();
    await withController(fx, lifecycle, permitChanges);
    expect((await health(fx, FAR)).report!.rows[0]).toMatchObject({ status: 'unserviceable', reason });
  });

  it('reports local controller files that cannot be read as such, not as a GitHub failure', async () => {
    const truncated = await fixture();
    await writeFile(join(truncated.stateDirectory, 'permit.json'), '{"schemaVersion":');
    expect((await health(truncated, FAR)).report!.rows[0]).toMatchObject({ status: 'unserviceable', reason: expect.stringMatching(/^permit-invalid: /u) });

    const broken = await fixture();
    await writeFile(join(broken.stateDirectory, 'config.json'), '{"schemaVersion":1}');
    const row = (await health(broken, FAR)).report!.rows[0]!;
    expect(row).toMatchObject({ status: 'unserviceable', reason: expect.stringMatching(/^controller-state-unreadable: /u) });
    expect(String(row['recovery'])).toContain(`repair or archive the controller files in ${broken.stateDirectory}`);
  });

  it('reports an incomplete run listing as unknown', async () => {
    const fx = await fixture();
    fx.github.variable = 'absent';
    fx.github.runsIncomplete = 'GitHub HTTP 502 read backoff';
    expect((await health(fx, FAR)).report!.rows[0]).toMatchObject({ status: 'unknown', recovery: 'retry; GitHub read incomplete: GitHub HTTP 502 read backoff' });
  });

  it('never writes to GitHub or the registry and skips enrollments that are not cut over', async () => {
    const fx = await fixture();
    fx.github.variable = 'absent';
    fx.github.runs = [run(10)];
    fx.github.jobs = [job(1, 10, 'queued')];
    const before = await readFile(fx.registryPath, 'utf8');
    await health(fx, FAR);
    expect(fx.github.writes).toEqual([]);
    expect(await readFile(fx.registryPath, 'utf8')).toBe(before);

    const reverted = await fixture({ enrollment: { status: 'reverted' } });
    const { exitCode, report } = await health(reverted, FAR);
    expect(exitCode).toBe(0);
    expect(report).toMatchObject({ status: 'green', rows: [] });
  });

  it('renders markdown with the check time and one row per enrollment', async () => {
    const fx = await fixture();
    const { text } = await health(fx, '2026-10-28T23:00:00Z', 'markdown');
    expect(text).toContain('# Cirujano fleet health');
    expect(text).toContain('Checked 2026-10-28T23:00:00.000Z (simulated with --now). Status: red.');
    expect(text).toMatch(/\| P1 \| juan294\/app \| unserviceable \(past-service-end\) \| on \| 2026-10-28T22:54:59\.000Z \| none \| `cirujano fleet release --registry .* --id P1` \|/u);
    const empty = await fixture({ enrollment: { status: 'reverted' } });
    expect((await health(empty, FAR, 'markdown')).text).toContain('No cut-over enrollments.');
  });

  it('is reachable through the CLI with --format and --now', async () => {
    const fx = await fixture();
    const { io, out } = capture();
    expect(await runCli(['fleet', 'health', '--registry', fx.registryPath, '--now', FAR], io, undefined, undefined, serviceFor(fx))).toBe(0);
    expect(JSON.parse(out.join(''))).toMatchObject({ status: 'amber' });
  });
});

describe('fleet release', () => {
  async function release(fx: Fixture, cancelStranded: boolean) {
    const { io, out, err } = capture();
    const exitCode = await serviceFor(fx).run({ command: 'fleet', action: 'release', registryPath: fx.registryPath, id: 'P1', cancelStranded }, io);
    return { exitCode, report: out.length === 0 ? null : JSON.parse(out.join('')) as Record<string, unknown>, err: err.join('') };
  }

  it('deletes the switch, confirms by readback, records a note and prints the push-or-dispatch step', async () => {
    const fx = await fixture();
    fx.github.runs = [run(10)];
    fx.github.jobs = [job(1, 10, 'queued')];
    const { exitCode, report } = await release(fx, false);
    expect(exitCode).toBe(0);
    expect(fx.github.writes).toEqual(['delete CIRUJANO_RUNNER_P1']);
    expect(report).toMatchObject({
      status: 'released', id: 'P1', switchVariable: 'CIRUJANO_RUNNER_P1', variable: 'deleted', cancelled: [], waiting: [], notCancelled: [10],
      nextStep: 'run cirujano fleet release with --cancel-stranded to cancel the stranded runs, then push or dispatch a new run; with the switch off it runs on ubuntu-latest',
    });
    const registry = parseFleetRegistry(JSON.parse(await readFile(fx.registryPath, 'utf8')));
    expect(registry.enrollments[0]).toMatchObject({ status: 'cut-over', notes: [expect.stringMatching(/^routing released at .* by fleet release/u)] });
  });

  it('cancels only runs whose other jobs are finished and names the next step', async () => {
    const fx = await fixture();
    fx.github.runs = [run(10), run(11)];
    fx.github.jobs = [job(1, 10, 'queued'), job(2, 11, 'queued'), job(3, 11, 'in_progress', ['ubuntu-latest'])];
    const { exitCode, report } = await release(fx, true);
    expect(exitCode).toBe(0);
    expect(fx.github.writes).toEqual(['delete CIRUJANO_RUNNER_P1', 'force-cancel 10']);
    expect(report).toMatchObject({
      cancelled: [10], waiting: [11], notCancelled: [],
      nextStep: 'push or dispatch a new run for each cancelled run; with the switch off it runs on ubuntu-latest. Re-run release for runs still waiting on other jobs',
    });
  });

  it('always prints the report: a failed cancel, a run still active, and a failed stranded scan', async () => {
    const fx = await fixture();
    fx.github.runs = [run(10), run(11)];
    fx.github.jobs = [job(1, 10, 'queued'), job(2, 11, 'queued')];
    fx.github.cancelFails.add(11);
    fx.github.cancelLags = true;
    const partial = await release(fx, true);
    expect(partial.exitCode).toBe(1);
    expect(partial.report).toMatchObject({
      status: 'released', cancelled: [10], stillActive: [10],
      failedCancels: [{ runId: 11, error: 'GitHub returned HTTP 500 force-cancelling run 11: boom' }],
    });

    const scan = await fixture();
    scan.github.runsIncomplete = 'GitHub HTTP 502';
    const failed = await release(scan, true);
    expect(failed.exitCode).toBe(1);
    expect(failed.report).toMatchObject({
      status: 'released', variable: 'deleted', strandedScan: 'failed: GitHub HTTP 502',
      nextStep: `re-run cirujano fleet release --registry ${scan.registryPath} --id P1 --cancel-stranded`,
    });
  });

  it('exits 1 when the switch is still on after a retried delete', async () => {
    const fx = await fixture();
    fx.github.deleteSticks = false;
    const { exitCode, err } = await release(fx, true);
    expect(exitCode).toBe(1);
    expect(fx.github.writes).toEqual(['delete CIRUJANO_RUNNER_P1', 'delete CIRUJANO_RUNNER_P1']);
    expect(err).toMatch(/CIRUJANO_RUNNER_P1 is still on after two deletes; check the token's variable permission and delete it with gh variable delete CIRUJANO_RUNNER_P1 --repo juan294\/app/u);
  });

  it('refuses an enrollment that is not cut over or has no switch', async () => {
    const proposed = await fixture({ enrollment: { status: 'reverted' } });
    await expect(serviceFor(proposed).run({ command: 'fleet', action: 'release', registryPath: proposed.registryPath, id: 'P1', cancelStranded: false }, capture().io))
      .rejects.toThrow(/enrollment P1 is reverted, not cut-over/u);
    const ungated = await fixture();
    const legacy = parseFleetRegistry(JSON.parse(await readFile(ungated.registryPath, 'utf8')));
    delete legacy.enrollments[0]!.routingSwitch;
    await writeFleetRegistry(ungated.registryPath, legacy);
    await expect(serviceFor(ungated).run({ command: 'fleet', action: 'release', registryPath: ungated.registryPath, id: 'P1', cancelStranded: false }, capture().io))
      .rejects.toThrow(/enrollment P1 has no routing switch; its runner can only be released by a workflow push/u);
    expect(ungated.github.writes).toEqual([]);
  });
});
