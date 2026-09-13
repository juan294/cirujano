import { execFile, spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { verifySshPublicKeyFingerprint } from '@cirujano/runner';

import { runCli, type CliIo } from './cli.js';
import { advanceObservedLifecycle, createRunnerCommandService } from './runner-service.js';

const executeFile = promisify(execFile);
const packageDirectory = resolve(import.meta.dirname, '..');

beforeAll(async () => {
  await executeFile(process.execPath, ['scripts/bundle.mjs'], { cwd: packageDirectory });
});

describe('production runner command composition (R11/R12)', () => {
  it('derives generation-bound idle evidence and monotonic full-rate accounting from readbacks', () => {
    const nowMs = 10_000;
    const observation = {
      nowMs,
      lifecycle: { state: 'draining', startCount: 2, cumulativeRuntimeMs: 500, cumulativeCostUsd: 0.01, outstandingIntent: null, idleObservations: [] },
      providerPresent: true,
      queueComplete: true,
      ownedBusy: false,
      guest: { complete: true, status: 'drained', generation: 2, startedAtMs: 8_000, networkEgressBytes: 1_073_741_824 },
      accounting: { diskStartedAtMs: 1_000, diskRetainedMs: 0, runtimeBaselineMs: 500, generation: 2, networkEgressBytes: 0 },
      rates: validRunnerConfig.rates,
      diskSizeGiB: 80,
    } as const;
    const result = advanceObservedLifecycle(observation);
    expect(result.lifecycle.idleObservations).toEqual([{ observedAtMs: nowMs, complete: true, generation: 2 }]);
    expect(result.lifecycle.cumulativeRuntimeMs).toBe(2_500);
    expect(result.lifecycle.cumulativeCostUsd).toBeGreaterThan(0.05);
    const repeated = advanceObservedLifecycle({
      ...observation,
      nowMs: nowMs + 1_000,
      lifecycle: result.lifecycle,
      accounting: result.accounting,
    });
    expect(repeated.lifecycle.cumulativeRuntimeMs).toBeGreaterThanOrEqual(result.lifecycle.cumulativeRuntimeMs);
    expect(repeated.lifecycle.cumulativeCostUsd).toBeGreaterThanOrEqual(result.lifecycle.cumulativeCostUsd);
  });
  it('inspects live repository and provider identity through injected process endpoints', async () => {
    const fixture = await createFixture();
    const io = captureIo();
    const service = createRunnerCommandService(fixture.env);
    expect(await service.run({ command: 'runner', action: 'inspect', configPath: fixture.configPath, format: 'json' }, io)).toBe(0);
    expect(JSON.parse(io.out.join(''))).toMatchObject({
      schemaVersion: 1,
      command: 'runner inspect',
      repository: { id: 123, nameWithOwner: 'trusted/private', visibility: 'private' },
      provider: { ownedMatches: 0, state: 'absent' },
      rates: { quotedAt: '2026-09-13' },
    });
  });

  it('runs one lock-scoped dry-run tick and performs zero provider writes without a permit', async () => {
    const fixture = await createFixture();
    const io = captureIo();
    const service = createRunnerCommandService({ ...fixture.env, CIRUJANO_RUNNER_ONCE: '1' });
    expect(await service.run({ command: 'runner', action: 'watch', configPath: fixture.configPath, dryRun: true }, io)).toBe(0);
    const log = await readFile(fixture.logPath, 'utf8');
    expect(log).not.toMatch(/--method (?:POST|DELETE)| instance (?:create|start|stop|delete)/u);
    expect(io.out.join('')).toContain('"type":"tick"');
  });

  it('blocks an authorized start when the conservative network envelope is unbounded', async () => {
    const fixture = await createLifecycleFixture();
    await builtTick(fixture);
    await updateScenario(fixture, (state) => { state.jobs[0]!.status = 'queued'; });
    const environment: NodeJS.ProcessEnv = { ...fixture.env, CIRUJANO_RUNNER_ONCE: '1' };
    delete environment.CIRUJANO_NETWORK_EGRESS_LIMIT_GIB;
    const io = captureIo();
    expect(await runCli(['runner', 'watch', '--config', fixture.configPath, '--permit', fixture.permitPath], io, createRunnerCommandService(environment))).toBe(1);
    expect(io.out.join('')).toContain('"status":"blocked"');
    expect(await readFile(join(fixture.directory, 'commands.log'), 'utf8')).not.toContain('instance create');
  });

  it('spawns the built CLI against local fixtures for inspect and no-permit dry-run', async () => {
    const fixture = await createFixture();
    const executable = join(packageDirectory, 'dist/bin.js');
    const inspect = await executeFile(process.execPath, [executable, 'runner', 'inspect', '--config', fixture.configPath, '--format', 'json'], {
      env: fixture.env,
    });
    expect(JSON.parse(inspect.stdout)).toMatchObject({ command: 'runner inspect', provider: { state: 'absent' } });
    const dryRun = await executeFile(process.execPath, [executable, 'runner', 'watch', '--config', fixture.configPath, '--dry-run'], {
      env: { ...fixture.env, CIRUJANO_RUNNER_ONCE: '1' },
    });
    expect(dryRun.stdout).toContain('"type":"tick"');
    expect(await readFile(fixture.logPath, 'utf8')).not.toMatch(/--method (?:POST|DELETE)| instance (?:create|start|stop|delete)/u);
  });

  it('preserves built CLI estimate exit 0, runtime exit 1 and usage exit 2', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-built-exits-'));
    const jobsPath = join(directory, 'jobs.json');
    const badPath = join(directory, 'bad.json');
    await writeFile(jobsPath, JSON.stringify({ jobs: [{ name: 'e2e', started_at: '2026-09-13T10:00:00Z', completed_at: '2026-09-13T10:01:01Z' }] }));
    await writeFile(badPath, JSON.stringify({ jobs: [{ id: 1 }] }));
    const executable = join(packageDirectory, 'dist/bin.js');
    const success = await executeFile(process.execPath, [executable, 'estimate', '--jobs', jobsPath, '--format', 'json']);
    expect(JSON.parse(success.stdout)).toEqual({ billableMinutes: 2, measuredJobs: 1, skippedJobs: 0 });
    const runtime = await executeFile(process.execPath, [executable, 'estimate', '--jobs', badPath])
      .then((value) => ({ code: 0, ...value })).catch((error: { code?: number; stderr?: string }) => ({ code: error.code ?? 1, stderr: error.stderr ?? '' }));
    expect(runtime.code).toBe(1);
    expect(runtime.stderr).toContain('bad.json');
    const usage = await executeFile(process.execPath, [executable, 'estimate'])
      .then((value) => ({ code: 0, ...value })).catch((error: { code?: number; stderr?: string }) => ({ code: error.code ?? 1, stderr: error.stderr ?? '' }));
    expect(usage.code).toBe(2);
    expect(usage.stderr).toContain('estimate requires --jobs');
  });

  it('observes a running guest through the exact status helper and a private known-hosts file', async () => {
    const fixture = await createFixture(true);
    const io = captureIo();
    const service = createRunnerCommandService({ ...fixture.env, CIRUJANO_RUNNER_ONCE: '1' });
    await expect(service.run({ command: 'runner', action: 'watch', configPath: fixture.configPath, dryRun: true }, io)).rejects.toThrow(/accounting baseline/);
    const log = await readFile(fixture.logPath, 'utf8');
    expect(log).toContain('/opt/cirujano/status');
    expect(log).toContain('StrictHostKeyChecking=yes');
  });

  it('runs a registration lifecycle effect using token-on-stdin and exact SSH helper argv', async () => {
    const fixture = await createFixture(true, true);
    const io = captureIo();
    const service = createRunnerCommandService({ ...fixture.env, CIRUJANO_RUNNER_ONCE: '1' });
    expect(await service.run({ command: 'runner', action: 'watch', configPath: fixture.configPath, permitPath: fixture.permitPath!, dryRun: false }, io)).toBe(0);
    expect(io.out.join('')).toContain('"status":"mutated"');
    const log = await readFile(fixture.logPath, 'utf8');
    expect(log).toContain('/opt/cirujano/register-runner');
    expect(log).toContain('stdin=trusted/private|cirujano-a-g1|cirujano-pilot-a|1');
    expect(log).not.toContain('fixture-registration-token');
  });

  it('journals direct stop and cleanup before provider writes and verifies terminal readback', async () => {
    const fixture = await createFixture(true, true, true);
    const service = createRunnerCommandService({ ...fixture.env, CIRUJANO_RUNNER_ONCE: '1' });
    expect(await service.run({ command: 'runner', action: 'stop', configPath: fixture.configPath, permitPath: fixture.permitPath! }, captureIo())).toBe(0);
    expect(JSON.parse(await readFile(join(resolve(fixture.configPath, '..'), 'direct-action-state.json'), 'utf8'))).toMatchObject({ action: 'stop', stage: 'resolved', providerState: 'stopped' });
    expect(await service.run({ command: 'runner', action: 'cleanup', configPath: fixture.configPath, permitPath: fixture.permitPath! }, captureIo())).toBe(0);
    expect(JSON.parse(await readFile(join(resolve(fixture.configPath, '..'), 'direct-action-state.json'), 'utf8'))).toMatchObject({ action: 'cleanup', stage: 'resolved', providerState: 'absent' });
  });

  it('returns runtime exit 1 for an expired permit without emitting provider mutations', async () => {
    const fixture = await createFixture(true, true, true);
    const permit = JSON.parse(await readFile(fixture.permitPath!, 'utf8')) as Record<string, unknown>;
    permit.expiresAtMs = Date.now() - 1;
    await writeFile(fixture.permitPath!, JSON.stringify(permit));
    const io = captureIo();
    const service = createRunnerCommandService(fixture.env);
    expect(await runCli(['runner', 'stop', '--config', fixture.configPath, '--permit', fixture.permitPath!], io, service)).toBe(1);
    expect(io.err.join('')).toMatch(/permit is expired/);
    expect(await readFile(fixture.logPath, 'utf8').catch(() => '')).not.toContain('instance stop');
  });

  it.each([
    ['GitHub authentication failure', { CIRUJANO_FIXTURE_AUTH_FAIL: '1' }],
    ['GitHub rate limit', { CIRUJANO_FIXTURE_RATE_LIMIT: '1' }],
    ['guest status loss', { CIRUJANO_FIXTURE_GUEST_LOSS: '1' }],
  ])('fails closed for %s without a provider mutation', async (_name, environment) => {
    const fixture = await createFixture(true, true, true);
    const io = captureIo();
    const service = createRunnerCommandService({ ...fixture.env, ...environment, CIRUJANO_RUNNER_ONCE: '1' });
    expect(await runCli(['runner', 'watch', '--config', fixture.configPath, '--permit', fixture.permitPath!], io, service)).toBe(1);
    expect(await readFile(fixture.logPath, 'utf8')).not.toMatch(/instance (?:create|start|stop|delete)/u);
  });

  it.each([
    ['direct-prepared', 'intent', 0, 1],
    ['direct-emitting', 'emitting', 0, 1],
    ['direct-provider-io', 'emitting', 0, 1],
    ['direct-terminal', 'resolved', 0, 1],
  ] as const)('recovers an externally killed built direct action at %s without unsafe replay', async (boundary, expectedStage, restartExit, expectedStops) => {
    const fixture = await createFixture(true, true, true);
    const markerPath = join(resolve(fixture.configPath, '..'), 'boundaries.log');
    const executable = join(packageDirectory, 'dist/bin.js');
    const child = spawn(process.execPath, [executable, 'runner', 'stop', '--config', fixture.configPath, '--permit', fixture.permitPath!], {
      env: { ...fixture.env, CIRUJANO_FIXTURE_BOUNDARY_PATH: markerPath, CIRUJANO_FIXTURE_PAUSE_BOUNDARY: boundary }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForText(markerPath, boundary);
    child.kill('SIGKILL');
    await new Promise<void>((resolveClose) => child.once('close', () => resolveClose()));
    expect(JSON.parse(await readFile(join(resolve(fixture.configPath, '..'), 'direct-action-state.json'), 'utf8'))).toMatchObject({ stage: expectedStage });
    const permit = JSON.parse(await readFile(fixture.permitPath!, 'utf8')) as Record<string, unknown>;
    permit.expiresAtMs = Date.now() - 1;
    await writeFile(fixture.permitPath!, JSON.stringify(permit));
    const restart = await executeFile(process.execPath, [executable, 'runner', 'stop', '--config', fixture.configPath, '--permit', fixture.permitPath!], {
      env: { ...fixture.env, CIRUJANO_RUNNER_ONCE: '1' },
    }).then((value) => ({ code: 0, ...value })).catch((error: { code?: number; stdout?: string; stderr?: string }) => ({ code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }));
    expect(restart.code).toBe(restartExit);
    const commandLog = await readFile(fixture.logPath, 'utf8');
    const stopCount = commandLog.split('\n').filter((line) => line.includes('instance stop')).length;
    expect(stopCount).toBe(expectedStops);
    if (boundary === 'direct-emitting') {
      expect(commandLog.indexOf('/opt/cirujano/drain')).toBeLessThan(commandLog.indexOf('--method DELETE'));
      expect(commandLog.indexOf('--method DELETE')).toBeLessThan(commandLog.indexOf('instance stop'));
    }
  }, 15_000);

  it('persists structured blocked evidence when an ambiguous emission has a related provider operation', async () => {
    const fixture = await createFixture(true, true, true);
    const markerPath = join(resolve(fixture.configPath, '..'), 'boundaries.log');
    const executable = join(packageDirectory, 'dist/bin.js');
    const child = spawn(process.execPath, [executable, 'runner', 'stop', '--config', fixture.configPath, '--permit', fixture.permitPath!], {
      env: { ...fixture.env, CIRUJANO_FIXTURE_BOUNDARY_PATH: markerPath, CIRUJANO_FIXTURE_PAUSE_BOUNDARY: 'direct-emitting' }, stdio: 'ignore',
    });
    await waitForText(markerPath, 'direct-emitting');
    child.kill('SIGKILL');
    await new Promise<void>((resolveClose) => child.once('close', () => resolveClose()));
    const permit = JSON.parse(await readFile(fixture.permitPath!, 'utf8')) as Record<string, unknown>;
    permit.expiresAtMs = Date.now() - 1;
    await writeFile(fixture.permitPath!, JSON.stringify(permit));
    const retry = await executeFile(process.execPath, [executable, 'runner', 'stop', '--config', fixture.configPath, '--permit', fixture.permitPath!], {
      env: { ...fixture.env, CIRUJANO_FIXTURE_OPERATION_PRESENT: '1', CIRUJANO_RUNNER_ONCE: '1' },
    }).then((value) => ({ code: 0, ...value })).catch((error: { code?: number; stdout?: string }) => ({ code: error.code ?? 1, stdout: error.stdout ?? '' }));
    expect(retry.code).toBe(1);
    expect(retry.stdout).toContain('"status":"blocked"');
    expect(JSON.parse(await readFile(join(resolve(fixture.configPath, '..'), 'direct-action-state.json'), 'utf8'))).toMatchObject({
      stage: 'emitting', providerState: 'running', blockedReason: expect.stringContaining('has not produced terminal resource state'),
    });
    expect((await readFile(fixture.logPath, 'utf8')).split('\n').filter((line) => line.includes('instance stop'))).toHaveLength(0);
  }, 15_000);

  it('drains and emits structured resolved recovery when the built watcher receives SIGINT', async () => {
    const fixture = await createFixture(true, true, true);
    const executable = join(packageDirectory, 'dist/bin.js');
    const child = spawn(process.execPath, [executable, 'runner', 'watch', '--config', fixture.configPath, '--permit', fixture.permitPath!], {
      env: fixture.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    await waitForText(fixture.logPath, '/opt/cirujano/register-runner');
    child.kill('SIGINT');
    const code = await Promise.race([
      new Promise<number | null>((resolveClose) => child.once('close', resolveClose)),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('SIGINT recovery timed out')), 10_000)),
    ]);
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('"type":"interrupt-recovery"');
    expect(stdout).toContain('"completed":true');
    const log = await readFile(fixture.logPath, 'utf8');
    expect(log.indexOf('/opt/cirujano/drain')).toBeLessThan(log.indexOf('instance stop'));
  }, 15_000);

  it('drives the built CLI through the complete stateful R11 lifecycle and exact report', async () => {
    const fixture = await createLifecycleFixture();
    await builtTick(fixture); // idle
    await updateScenario(fixture, (state) => { state.jobs[0]!.status = 'queued'; });
    await builtTick(fixture); // create
    await builtTick(fixture); // reconcile create
    await builtTick(fixture); // start
    await builtTick(fixture); // reconcile start and arm grant
    await builtTick(fixture); // register
    await builtTick(fixture); // reconcile registration
    const busy = await builtTick(fixture);
    expect(busy).toContain('"state":"busy"');
    await updateScenario(fixture, (state) => { state.jobs[0]!.status = 'completed'; state.jobs[0]!.conclusion = 'success'; state.runnerBusy = false; state.guest = 'ready'; });
    await builtTick(fixture); // begin drain
    expect(JSON.parse(await readFile(join(fixture.directory, 'controller-state.json'), 'utf8'))).toMatchObject({ lifecycle: { state: 'draining' } });
    await updateScenario(fixture, (state) => { state.jobs[1]!.status = 'queued'; });
    expect((JSON.parse(await readFile(fixture.scenarioPath, 'utf8')) as LifecycleScenario).jobs[1]?.status).toBe('queued');
    await builtTick(fixture); // reconcile drain
    expect((JSON.parse(await readFile(fixture.scenarioPath, 'utf8')) as LifecycleScenario).jobs[1]?.status).toBe('queued');
    await builtTick(fixture); // first complete idle observation
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    await builtTick(fixture); // stop after generation-bound idle grace
    await builtTick(fixture); // reconcile stop while second job remains queued
    await builtTick(fixture); // next authorized start
    await builtTick(fixture); // reconcile and arm
    await builtTick(fixture); // register second exact assignment
    await builtTick(fixture); // reconcile registration
    await updateScenario(fixture, (state) => { state.jobs[1]!.status = 'completed'; state.jobs[1]!.conclusion = 'success'; state.runnerBusy = false; state.guest = 'ready'; });
    await builtTick(fixture); // drain second generation
    await builtTick(fixture); // reconcile drain
    await builtTick(fixture); // idle observation one
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    await builtTick(fixture); // stop
    await builtTick(fixture); // terminal stopped readback
    const executable = join(packageDirectory, 'dist/bin.js');
    await executeFile(process.execPath, [executable, 'runner', 'cleanup', '--config', fixture.configPath, '--permit', fixture.permitPath], { env: fixture.env });
    const assignmentState = JSON.parse(await readFile(join(fixture.directory, 'assignments.json'), 'utf8')) as { assignments: KnownFixtureAssignment[] };
    expect(assignmentState.assignments).toEqual([
      { runId: 1001, runAttempt: 1, jobId: 2001, runnerId: 301, runnerName: 'cirujano-a-g2', conclusion: 'success' },
      { runId: 1002, runAttempt: 1, jobId: 2002, runnerId: 302, runnerName: 'cirujano-a-g3', conclusion: 'success' },
    ]);
    const reportPath = join(fixture.directory, 'report-input.json');
    await writeFile(reportPath, JSON.stringify({
      candidateDigest: 'fixture-candidate', expectedCandidateDigest: 'fixture-candidate', requiredScenarios: ['R10', 'R11', 'R12', 'R13'],
      checks: [
        { scenario: 'R10', status: 'passed', candidateDigest: 'fixture-candidate', evidence: ['built CLI inspect and dry-run tests'] },
        { scenario: 'R11', status: 'passed', candidateDigest: 'fixture-candidate', evidence: ['stateful built CLI lifecycle'] },
        { scenario: 'R12', status: 'passed', candidateDigest: 'fixture-candidate', evidence: ['built CLI SIGINT recovery test'] },
        { scenario: 'R13', status: 'passed', candidateDigest: 'fixture-candidate', evidence: ['exact assignment and terminal readback assertions'] },
      ],
      assignments: assignmentState.assignments,
      cleanup: { complete: true, vmState: 'absent', ownedRunnersRemaining: 0, diskPresent: false, unresolvedResources: [] },
      finalProviderState: 'absent',
      cost: { complete: true, currency: 'USD', computeUsd: 0.01, diskUsd: 0.001, networkUsd: 0.001, runnerTotalUsd: 0.012, hostedBaselineUsd: 1 }, diagnostics: [], sensitiveValues: [],
    }));
    const report = await executeFile(process.execPath, [executable, 'runner', 'report', '--state', reportPath, '--format', 'json'], { env: fixture.env });
    expect(JSON.parse(report.stdout)).toMatchObject({ complete: true, assignments: assignmentState.assignments, cleanup: { vmState: 'absent' }, finalProviderState: 'absent' });
  }, 60_000);
});

function captureIo(): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (text) => { out.push(text); }, stderr: (text) => { err.push(text); } };
}

async function waitForText(path: string, expected: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = await readFile(path, 'utf8').catch(() => '');
    if (value.includes(expected)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`timed out waiting for ${expected}`);
}

interface LifecycleScenario {
  provider: 'ABSENT' | 'STOPPED' | 'RUNNING';
  guest: 'booting' | 'ready' | 'busy' | 'drained';
  grant: { generation: number; startedAtMs: number; deadlineMs: number } | null;
  runnerName: string | null;
  runnerId: number | null;
  runnerBusy: boolean;
  jobs: Array<{ runId: number; jobId: number; status: 'none' | 'queued' | 'in_progress' | 'completed'; conclusion: string | null; runnerId: number | null; runnerName: string | null }>;
}

interface KnownFixtureAssignment { runId: number; runAttempt: number; jobId: number; runnerId: number; runnerName: string; conclusion: string }

interface LifecycleFixture { directory: string; scenarioPath: string; configPath: string; permitPath: string; env: NodeJS.ProcessEnv }

async function builtTick(fixture: LifecycleFixture): Promise<string> {
  const executable = join(packageDirectory, 'dist/bin.js');
  const result = await executeFile(process.execPath, [executable, 'runner', 'watch', '--config', fixture.configPath, '--permit', fixture.permitPath], {
    env: { ...fixture.env, CIRUJANO_RUNNER_ONCE: '1' }, maxBuffer: 1024 * 1024,
  }).catch((error: { stderr?: string; stdout?: string }) => { throw new Error(`${error.stderr ?? ''}${error.stdout ?? ''}` || 'built tick failed'); });
  return result.stdout;
}

async function updateScenario(fixture: LifecycleFixture, update: (state: LifecycleScenario) => void): Promise<void> {
  const state = JSON.parse(await readFile(fixture.scenarioPath, 'utf8')) as LifecycleScenario;
  update(state);
  await writeFile(fixture.scenarioPath, JSON.stringify(state));
}

async function createLifecycleFixture(): Promise<LifecycleFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'cirujano-r11-lifecycle-'));
  const scenarioPath = join(directory, 'scenario.json');
  const logPath = join(directory, 'commands.log');
  const ghPath = join(directory, 'gh-fixture');
  const nebiusPath = join(directory, 'nebius-fixture');
  const sshPath = join(directory, 'ssh-fixture');
  const controllerKeyPath = join(directory, 'controller_ed25519');
  const hostKeyPath = join(directory, 'host_ed25519');
  await executeFile('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', controllerKeyPath]);
  const hostPair = testHostKeyPair();
  await writeFile(hostKeyPath, hostPair.privateKey, { mode: 0o600 });
  await writeFile(`${hostKeyPath}.pub`, `${hostPair.publicKey}\n`);
  const hostPublicKey = hostPair.publicKey;
  const scenario: LifecycleScenario = {
    provider: 'ABSENT', guest: 'booting', grant: null, runnerName: null, runnerId: null, runnerBusy: false,
    jobs: [
      { runId: 1001, jobId: 2001, status: 'none', conclusion: null, runnerId: null, runnerName: null },
      { runId: 1002, jobId: 2002, status: 'none', conclusion: null, runnerId: null, runnerName: null },
    ],
  };
  await writeFile(scenarioPath, JSON.stringify(scenario));
  const sharedPrelude = `const fs=require('node:fs');const p=process.env.CIRUJANO_SCENARIO_PATH;const s=JSON.parse(fs.readFileSync(p,'utf8'));const save=()=>fs.writeFileSync(p,JSON.stringify(s));fs.appendFileSync(process.env.CIRUJANO_FIXTURE_LOG,process.argv.slice(2).join(' ')+'\\n');`;
  await writeFile(ghPath, `#!/usr/bin/env node
${sharedPrelude}
const a=process.argv.slice(2);const endpoint=a.find(v=>v.startsWith('/repos/'))||'';const method=a[a.indexOf('--method')+1];let status=200;let body={};
if(/^\\/repos\\/trusted\\/private$/.test(endpoint))body={id:123,full_name:'trusted/private',private:true,visibility:'private',fork:false};
else if(endpoint.endsWith('/actions/runs')){const active=s.jobs.filter(j=>j.status==='queued'||j.status==='in_progress');body={total_count:active.length,workflow_runs:active.map(j=>({id:j.runId,workflow_id:41,run_attempt:1,status:j.status==='queued'?'queued':'in_progress',conclusion:null,event:'push',head_branch:'develop',head_sha:'sha-'+j.runId,repository:{id:123},head_repository:{id:123},pull_requests:[]}))};}
else if(endpoint.includes('/attempts/1/jobs')){const runId=Number(endpoint.match(/runs\\/(\\d+)/)[1]);const jobs=s.jobs.filter(j=>j.runId===runId&&j.status!=='none');body={total_count:jobs.length,jobs:jobs.map(j=>({id:j.jobId,run_id:j.runId,head_sha:'sha-'+j.runId,status:j.status,conclusion:j.conclusion,name:'e2e',labels:['self-hosted','cirujano-pilot-a'],runner_id:j.runnerId,runner_name:j.runnerName,runner_group_id:null,runner_group_name:null,started_at:j.status==='queued'?null:'2026-09-13T10:00:00Z',completed_at:j.status==='completed'?'2026-09-13T10:01:00Z':null}))};}
else if(endpoint.endsWith('/actions/runners'))body={total_count:s.runnerName===null?0:1,runners:s.runnerName===null?[]:[{id:s.runnerId,name:s.runnerName,os:'linux',status:'online',busy:s.runnerBusy,labels:[{name:'self-hosted'},{name:'cirujano-pilot-a'}]}]};
else if(endpoint.endsWith('/registration-token')){status=201;body={token:'fixture-registration-token',expires_at:'2099-01-01T00:00:00Z'};}
else if(method==='DELETE'&&endpoint.includes('/actions/runners/')){status=204;s.runnerName=null;s.runnerId=null;s.runnerBusy=false;save();body=null;}
process.stdout.write('HTTP/2 '+status+'\\n\\n'+(body===null?'':JSON.stringify(body)));
`);
  await writeFile(nebiusPath, `#!/usr/bin/env node
${sharedPrelude}
const a=process.argv.slice(2);let body={};
if(a.includes('list-operations-by-parent'))body={};
else if(a.includes('create')){s.provider='STOPPED';s.guest='booting';save();body={metadata:{id:'op-create'}};}
else if(a.includes('start')){s.provider='RUNNING';s.guest='booting';save();body={metadata:{id:'op-start'}};}
else if(a.includes('stop')){s.provider='STOPPED';s.guest='booting';s.runnerName=null;s.runnerId=null;s.runnerBusy=false;save();body={metadata:{id:'op-stop'}};}
else if(a.includes('delete')){s.provider='ABSENT';save();body={metadata:{id:'op-delete'}};}
else if(s.provider!=='ABSENT')body={items:[{metadata:{id:'instance-1',parent_id:'project-1',name:'cirujano-a-vm',labels:{'cirujano-controller':'controller-a','cirujano-config':process.env.CIRUJANO_CONFIG_HASH}},spec:{stopped:s.provider==='STOPPED',recovery_policy:'FAIL',resources:{platform:'cpu-d3',preset:'4vcpu-16gb'},network_interfaces:[{name:'primary',subnet_id:'subnet-1',ip_address:{},public_ip_address:{}}],boot_disk:{attach_mode:'READ_WRITE',managed_disk:{name:'cirujano-a-boot',spec:{type:'NETWORK_SSD',size_gibibytes:80,source_image_id:'image-1'}}}},status:{state:s.provider,network_interfaces:[{name:'primary',ip_address:{address:'10.0.0.4'},public_ip_address:{address:'203.0.113.4'}}],disk_attachments:[{name:'cirujano-a-boot',id:'disk-1'}]}}]};
process.stdout.write(JSON.stringify(body));
`);
  await writeFile(sshPath, `#!/usr/bin/env node
${sharedPrelude}
const helper=process.argv.at(-1);const lines=fs.readFileSync(0,'utf8').trim().split('\\n');
if(helper==='/opt/cirujano/arm-grant'){s.grant={generation:Number(lines[0]),startedAtMs:Number(lines[1]),deadlineMs:Number(lines[2])};s.guest='ready';save();process.stdout.write('armed\\n');}
else if(helper==='/opt/cirujano/register-runner'){const job=s.jobs.find(j=>j.status==='queued');s.runnerName=lines[1];s.runnerId=job.jobId===2001?301:302;s.runnerBusy=true;job.status='in_progress';job.runnerId=s.runnerId;job.runnerName=s.runnerName;s.guest='busy';save();process.stdout.write('registered\\n');}
else if(helper==='/opt/cirujano/drain'){s.guest='drained';s.runnerName=null;s.runnerId=null;s.runnerBusy=false;save();process.stdout.write('drained\\n');}
else if(helper==='/opt/cirujano/resume-admission'){s.guest='ready';save();process.stdout.write('resumed\\n');}
else{const ready=s.guest!=='booting';process.stdout.write(JSON.stringify({complete:true,status:s.guest,admissionEnabled:s.guest!=='drained',runnerActive:s.runnerName!==null,workerActive:s.runnerBusy,grant:s.grant,watchdogReady:ready,sshIdentityVerified:true,registrationReady:ready,networkEgressBytes:1048576}));}
`);
  for (const path of [ghPath, nebiusPath, sshPath]) await chmod(path, 0o755);
  const config = {
    ...validRunnerConfig,
    ssh: { publicKey: hostPublicKey, fingerprint: verifySshPublicKeyFingerprint(hostPublicKey) },
    timing: { ...validRunnerConfig.timing, pollIntervalMs: 1_000, idleGraceMs: 1 },
  };
  const configPath = join(directory, 'config.json');
  const configText = JSON.stringify(config);
  await writeFile(configPath, configText);
  const configHash = createHash('sha256').update(configText).digest('hex');
  const permitPath = join(directory, 'permit.json');
  const now = Date.now();
  await writeFile(permitPath, JSON.stringify({ schemaVersion: 1, permitId: 'r11-permit', operations: ['create', 'start', 'register', 'stop', 'delete'], issuedAtMs: now - 1_000, expiresAtMs: now + 10_800_000, maxStarts: 3, maxRuntimeMs: 20_000_000, maxTotalCostUsd: 10, recoveryAllowed: true, configHash, candidateDigest: 'fixture-candidate', repositoryId: 123, projectId: 'project-1', controllerId: 'controller-a', resourcePrefix: 'cirujano-a' }));
  return { directory, scenarioPath, configPath, permitPath, env: { ...process.env, CIRUJANO_GH_PATH: ghPath, CIRUJANO_NEBIUS_PATH: nebiusPath, CIRUJANO_SSH_PATH: sshPath, CIRUJANO_SSH_KEY_PATH: controllerKeyPath, CIRUJANO_GUEST_DIR: resolve(packageDirectory, '../runner/guest'), CIRUJANO_HOST_PRIVATE_KEY_PATH: hostKeyPath, CIRUJANO_LOGIN_PUBLIC_KEY_PATH: `${controllerKeyPath}.pub`, CIRUJANO_ACTIONS_RUNNER_VERSION: '2.328.0', CIRUJANO_ACTIONS_RUNNER_SHA256: 'a'.repeat(64), CIRUJANO_NETWORK_EGRESS_LIMIT_GIB: '1', CIRUJANO_CANDIDATE_DIGEST: 'fixture-candidate', CIRUJANO_CONFIG_HASH: configHash, CIRUJANO_SCENARIO_PATH: scenarioPath, CIRUJANO_FIXTURE_LOG: logPath } };
}

function sshField(value: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  return Buffer.concat([length, value]);
}

function testHostKeyPair(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync('ed25519');
  const privateJwk = pair.privateKey.export({ format: 'jwk' });
  const publicJwk = pair.publicKey.export({ format: 'jwk' });
  const publicBytes = Buffer.from(publicJwk.x!, 'base64url');
  const privateSeed = Buffer.from(privateJwk.d!, 'base64url');
  const keyType = Buffer.from('ssh-ed25519');
  const publicBlob = Buffer.concat([sshField(keyType), sshField(publicBytes)]);
  const fields = Buffer.concat([Buffer.alloc(8, 7), sshField(keyType), sshField(publicBytes), sshField(Buffer.concat([privateSeed, publicBytes])), sshField(Buffer.from('fixture'))]);
  const padding = Buffer.from(Array.from({ length: 8 - (fields.length % 8) }, (_unused, index) => index + 1));
  const envelope = Buffer.concat([Buffer.from('openssh-key-v1\0'), sshField(Buffer.from('none')), sshField(Buffer.from('none')), sshField(Buffer.alloc(0)), Buffer.from([0, 0, 0, 1]), sshField(publicBlob), sshField(Buffer.concat([fields, padding]))]).toString('base64');
  return { privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${envelope.match(/.{1,70}/gu)!.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`, publicKey: `ssh-ed25519 ${publicBlob.toString('base64')} fixture` };
}

async function createFixture(running = false, demand = false, stateful = false): Promise<{ configPath: string; permitPath?: string; logPath: string; env: NodeJS.ProcessEnv }> {
  const directory = await mkdtemp(join(tmpdir(), 'cirujano-runner-service-'));
  const logPath = join(directory, 'commands.log');
  const ghPath = join(directory, 'gh-fixture');
  const nebiusPath = join(directory, 'nebius-fixture');
  const sshPath = join(directory, 'ssh-fixture');
  const sshKeyPath = join(directory, 'controller-key');
  const providerStatePath = join(directory, 'provider-state');
  const guestStatePath = join(directory, 'guest-state');
  const runnerStatePath = join(directory, 'runner-state');
  await writeFile(ghPath, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.CIRUJANO_FIXTURE_LOG, process.argv.slice(2).join(' ') + '\\n');
const endpoint = process.argv.find((value) => value.startsWith('/repos/')) || '';
let body = {};
let status = 200;
if (process.env.CIRUJANO_FIXTURE_AUTH_FAIL === '1') { process.stdout.write('HTTP/2 401\\n\\n{}'); process.exit(0); }
if (process.env.CIRUJANO_FIXTURE_RATE_LIMIT === '1' && endpoint.endsWith('/actions/runs')) { process.stdout.write('HTTP/2 429\\nretry-after: 1\\n\\n{}'); process.exit(0); }
if (/^\\/repos\\/trusted\\/private$/.test(endpoint)) body = { id: 123, full_name: 'trusted/private', private: true, visibility: 'private', fork: false };
else if (process.argv.includes('DELETE') && endpoint.includes('/actions/runners/')) { status=204; if(process.env.CIRUJANO_RUNNER_STATE_PATH)fs.writeFileSync(process.env.CIRUJANO_RUNNER_STATE_PATH,'absent'); body=null; }
else if (endpoint.endsWith('/actions/runners')) { const owned=process.env.CIRUJANO_RUNNER_STATE_PATH&&fs.existsSync(process.env.CIRUJANO_RUNNER_STATE_PATH)&&fs.readFileSync(process.env.CIRUJANO_RUNNER_STATE_PATH,'utf8')==='owned'; body={total_count:owned?1:0,runners:owned?[{id:301,name:'cirujano-a-g1',os:'linux',status:'online',busy:false,labels:[{name:'self-hosted'},{name:'cirujano-pilot-a'}]}]:[]}; }
else if (endpoint.endsWith('/actions/runs')) body = process.env.CIRUJANO_FIXTURE_DEMAND === '1' ? { total_count: 1, workflow_runs: [{id:1001,workflow_id:41,run_attempt:1,status:'queued',conclusion:null,event:'push',head_branch:'develop',head_sha:'abc',repository:{id:123},head_repository:{id:123},pull_requests:[]}] } : { total_count: 0, workflow_runs: [] };
else if (endpoint.includes('/attempts/1/jobs')) body = { total_count: 1, jobs: [{id:2001,run_id:1001,head_sha:'abc',status:'queued',conclusion:null,name:'e2e',labels:['self-hosted','cirujano-pilot-a'],runner_id:null,runner_name:null,runner_group_id:null,runner_group_name:null,started_at:null,completed_at:null}] };
else if (endpoint.endsWith('/registration-token')) { status = 201; body = { token: 'fixture-registration-token', expires_at: '2099-01-01T00:00:00Z' }; }
process.stdout.write('HTTP/2 ' + status + '\\n\\n' + JSON.stringify(body));
`);
  await writeFile(nebiusPath, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.CIRUJANO_FIXTURE_LOG, process.argv.slice(2).join(' ') + '\\n');
const args = process.argv.slice(2);
let state = process.env.CIRUJANO_FIXTURE_RUNNING === '1' ? 'RUNNING' : 'ABSENT';
if (process.env.CIRUJANO_PROVIDER_STATE_PATH && fs.existsSync(process.env.CIRUJANO_PROVIDER_STATE_PATH)) state = fs.readFileSync(process.env.CIRUJANO_PROVIDER_STATE_PATH, 'utf8');
if (args.includes('list-operations-by-parent')) process.stdout.write(process.env.CIRUJANO_FIXTURE_OPERATION_PRESENT === '1' ? JSON.stringify({items:[{metadata:{id:'ambiguous-stop'},spec:{resource_id:'instance-1'},status:{state:'RUNNING'}}]}) : '{}');
else if (args.includes('stop')) { state = 'STOPPED'; fs.writeFileSync(process.env.CIRUJANO_PROVIDER_STATE_PATH, state); process.stdout.write(JSON.stringify({metadata:{id:'operation-stop'}})); }
else if (args.includes('delete')) { state = 'ABSENT'; fs.writeFileSync(process.env.CIRUJANO_PROVIDER_STATE_PATH, state); process.stdout.write(JSON.stringify({metadata:{id:'operation-delete'}})); }
else if (state !== 'ABSENT') process.stdout.write(JSON.stringify({items:[{metadata:{id:'instance-1',parent_id:'project-1',name:'cirujano-a-vm',labels:{'cirujano-controller':'controller-a','cirujano-config':process.env.CIRUJANO_CONFIG_HASH}},spec:{stopped:state==='STOPPED',recovery_policy:'FAIL',resources:{platform:'cpu-d3',preset:'4vcpu-16gb'},network_interfaces:[{name:'primary',subnet_id:'subnet-1',ip_address:{},public_ip_address:{}}],boot_disk:{attach_mode:'READ_WRITE',managed_disk:{name:'cirujano-a-boot',spec:{type:'NETWORK_SSD',size_gibibytes:80,source_image_id:'image-1'}}}},status:{state,network_interfaces:[{name:'primary',ip_address:{address:'10.0.0.4'},public_ip_address:{address:'203.0.113.4'}}],disk_attachments:[{name:'cirujano-a-boot',id:'disk-1'}]}}]}));
else process.stdout.write('{}');
`);
  await writeFile(sshPath, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.CIRUJANO_FIXTURE_LOG, process.argv.slice(2).join(' ') + '\\n');
if (process.env.CIRUJANO_FIXTURE_GUEST_LOSS === '1') process.exit(255);
const input = fs.readFileSync(0, 'utf8').trim().split('\\n');
if (input.length > 1) fs.appendFileSync(process.env.CIRUJANO_FIXTURE_LOG, 'stdin=' + input.slice(0, -1).join('|') + '\\n');
const helper = process.argv.at(-1);
if (process.env.CIRUJANO_GUEST_STATE_PATH && helper === '/opt/cirujano/drain') { fs.writeFileSync(process.env.CIRUJANO_GUEST_STATE_PATH, 'drained'); process.stdout.write('drained\\n'); process.exit(0); }
if (process.env.CIRUJANO_GUEST_STATE_PATH && helper === '/opt/cirujano/resume-admission') { fs.writeFileSync(process.env.CIRUJANO_GUEST_STATE_PATH, 'ready'); process.stdout.write('resumed\\n'); process.exit(0); }
const now = Date.now();
const state = process.env.CIRUJANO_GUEST_STATE_PATH && fs.existsSync(process.env.CIRUJANO_GUEST_STATE_PATH) ? fs.readFileSync(process.env.CIRUJANO_GUEST_STATE_PATH, 'utf8') : 'ready';
process.stdout.write(JSON.stringify({complete:true,status:state,admissionEnabled:state!=='drained',runnerActive:false,workerActive:false,grant:{generation:1,startedAtMs:now-1000,deadlineMs:now+5400000},watchdogReady:true,sshIdentityVerified:true,registrationReady:true}));
`);
  await chmod(ghPath, 0o755);
  await chmod(nebiusPath, 0o755);
  await chmod(sshPath, 0o755);
  await writeFile(sshKeyPath, 'fixture key', { mode: 0o600 });
  if (stateful) { await writeFile(providerStatePath, running ? 'RUNNING' : 'ABSENT'); await writeFile(guestStatePath, 'ready'); await writeFile(runnerStatePath, 'owned'); }
  const configPath = join(directory, 'config.json');
  const config = running ? { ...validRunnerConfig, ssh: { publicKey: testSshPublicKey, fingerprint: verifySshPublicKeyFingerprint(testSshPublicKey) } } : validRunnerConfig;
  const configText = JSON.stringify(config);
  await writeFile(configPath, configText);
  const configHash = createHash('sha256').update(configText).digest('hex');
  const permitPath = join(directory, 'permit.json');
  if (demand) {
    const now = Date.now();
    await writeFile(permitPath, JSON.stringify({ schemaVersion: 1, permitId: 'fixture-permit', operations: ['create', 'start', 'register', 'stop', 'delete'], issuedAtMs: now - 1000, expiresAtMs: now + 7_200_000, maxStarts: 2, maxRuntimeMs: 7_200_000, maxTotalCostUsd: 10, recoveryAllowed: true, configHash, candidateDigest: 'fixture-candidate', repositoryId: 123, projectId: 'project-1', controllerId: 'controller-a', resourcePrefix: 'cirujano-a' }));
    await writeFile(join(directory, 'controller-state.json'), JSON.stringify({ schemaVersion: 1, identity: { configHash, candidateDigest: 'fixture-candidate', repositoryId: 123, projectId: 'project-1', controllerId: 'controller-a', resourcePrefix: 'cirujano-a' }, lifecycle: { state: 'ready', startCount: 1, cumulativeRuntimeMs: 0, cumulativeCostUsd: 0, outstandingIntent: null, idleObservations: [] }, pendingEffect: null, readbacks: [] }));
  }
  return {
    configPath,
    ...(demand ? { permitPath } : {}),
    logPath,
    env: {
      ...process.env,
      CIRUJANO_GH_PATH: ghPath,
      CIRUJANO_NEBIUS_PATH: nebiusPath,
      CIRUJANO_FIXTURE_LOG: logPath,
      CIRUJANO_SSH_PATH: sshPath,
      CIRUJANO_SSH_KEY_PATH: sshKeyPath,
      CIRUJANO_CONFIG_HASH: configHash,
      CIRUJANO_CANDIDATE_DIGEST: 'fixture-candidate',
      ...(running ? { CIRUJANO_FIXTURE_RUNNING: '1' } : {}),
      ...(demand ? { CIRUJANO_FIXTURE_DEMAND: '1' } : {}),
      ...(stateful ? { CIRUJANO_PROVIDER_STATE_PATH: providerStatePath } : {}),
      ...(stateful ? { CIRUJANO_GUEST_STATE_PATH: guestStatePath } : {}),
      ...(stateful ? { CIRUJANO_RUNNER_STATE_PATH: runnerStatePath } : {}),
    },
  };
}

const validRunnerConfig = {
  schemaVersion: 1,
  repository: { id: 123, nameWithOwner: 'trusted/private', visibility: 'private' },
  workflowIds: [41], allowedBranch: 'develop', eligibleJobNames: ['e2e'], runnerLabel: 'cirujano-pilot-a', slots: 1,
  nebius: { profile: 'pilot', projectId: 'project-1', subnetId: 'subnet-1', imageId: 'image-1', platform: 'cpu-d3', preset: '4vcpu-16gb', diskType: 'network-ssd', diskSizeGiB: 80 },
  ssh: { publicKey: 'ssh-ed25519 AAAA pilot', fingerprint: 'SHA256:pilot' },
  ownership: { controllerId: 'controller-a', resourcePrefix: 'cirujano-a' },
  timing: { pollIntervalMs: 30_000, idleGraceMs: 300_000, bootTimeoutMs: 600_000, maxJobMs: 3_600_000, lifetimeMs: 5_400_000, shutdownMarginMs: 300_000 },
  rates: { currency: 'USD', quotedAt: '2026-09-13', source: 'provider quote', computeUsdPerHour: 0.24, diskUsdPerGibMonth: 0.10, networkEgressUsdPerGib: 0.05, hostedUsdPerMinute: 0.008 },
};

const testSshPublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA pilot';
