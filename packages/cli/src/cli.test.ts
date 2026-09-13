import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli, type CliIo, type RunnerCommandService } from './cli.js';

function captureIo(): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => { out.push(text); },
    stderr: (text) => { err.push(text); },
  };
}

describe('runCli', () => {
  it('prints usage with exit code 2 on a usage error', async () => {
    const io = captureIo();
    expect(await runCli(['estimate'], io)).toBe(2);
    expect(io.err.join('')).toMatch(/requires --jobs/);
    expect(io.err.join('')).toMatch(/^estimate requires/);
  });

  it('estimates billable minutes from a GitHub jobs payload file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cirujano-cli-'));
    const jobsPath = join(dir, 'jobs.json');
    await writeFile(jobsPath, JSON.stringify({
      jobs: [
        { name: 'checks', started_at: '2026-09-08T12:02:15Z', completed_at: '2026-09-08T12:03:06Z' },
        { name: 'e2e', started_at: '2026-09-08T12:00:00Z', completed_at: '2026-09-08T12:16:01Z' },
        { name: 'skipped', started_at: null, completed_at: null },
      ],
    }));

    const io = captureIo();
    expect(await runCli(['estimate', '--jobs', jobsPath, '--format', 'json'], io)).toBe(0);
    expect(JSON.parse(io.out.join(''))).toEqual({ billableMinutes: 18, measuredJobs: 2, skippedJobs: 1 });
  });

  it('fails with exit code 1 and names the file when the payload is malformed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cirujano-cli-'));
    const jobsPath = join(dir, 'bad.json');
    await writeFile(jobsPath, JSON.stringify({ jobs: [{ id: 1 }] }));

    const io = captureIo();
    expect(await runCli(['estimate', '--jobs', jobsPath], io)).toBe(1);
    expect(io.err.join('')).toContain('bad.json');
    expect(io.err.join('')).toMatch(/no string `name`/);
  });

  it('dispatches every runner action through the injected command service and preserves its exit code', async () => {
    const received: unknown[] = [];
    const service: RunnerCommandService = {
      run: async (args, io) => {
        received.push(args);
        io.stdout(`${args.action}\n`);
        return args.action === 'cleanup' ? 1 : 0;
      },
    };
    const invocations = [
      ['runner', 'inspect', '--config', 'config.json'],
      ['runner', 'watch', '--config', 'config.json', '--dry-run'],
      ['runner', 'stop', '--config', 'config.json', '--permit', 'permit.json'],
      ['runner', 'cleanup', '--config', 'config.json', '--permit', 'permit.json'],
      ['runner', 'report', '--state', 'state.json', '--format', 'json'],
    ] as const;
    const exits: number[] = [];
    for (const invocation of invocations) exits.push(await runCli(invocation, captureIo(), service));
    expect(exits).toEqual([0, 0, 0, 1, 0]);
    expect(received).toHaveLength(5);
  });

  it('turns runner service failures into runtime exit code 1 without exposing a stack', async () => {
    const io = captureIo();
    const service: RunnerCommandService = { run: async () => { throw new Error('provider unavailable'); } };
    expect(await runCli(['runner', 'inspect', '--config', 'config.json'], io, service)).toBe(1);
    expect(io.err.join('')).toBe('runner inspect failed: provider unavailable\n');
  });

  it('passes parsed inspection arguments to the command service', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cirujano-cli-runner-'));
    const configPath = join(dir, 'runner.json');
    await writeFile(configPath, JSON.stringify(validRunnerConfig));
    const io = captureIo();
    const service: RunnerCommandService = { run: async (args) => args.action === 'inspect' && args.configPath === configPath ? 0 : 1 };
    expect(await runCli(['runner', 'inspect', '--config', configPath, '--format', 'json'], io, service)).toBe(0);
  });

  it('uses the runner report validator and returns 1 for incomplete evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cirujano-cli-report-'));
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, JSON.stringify({
      candidateDigest: 'candidate', expectedCandidateDigest: 'candidate', requiredScenarios: ['R13'],
      checks: [], assignments: [{ runId: 1, runAttempt: 1, jobId: 1, runnerId: 1, runnerName: 'runner', conclusion: 'success' }], cleanup: null, finalProviderState: 'unknown',
      cost: { complete: false, reason: 'missing quote' },
      diagnostics: [], sensitiveValues: [],
    }));
    const io = captureIo();
    expect(await runCli(['runner', 'report', '--state', statePath, '--format', 'json'], io)).toBe(1);
    expect(JSON.parse(io.out.join(''))).toMatchObject({ complete: false, schemaVersion: 1 });
  });
});

const validRunnerConfig = {
  schemaVersion: 1,
  repository: { id: 123, nameWithOwner: 'trusted/private', visibility: 'private' },
  workflowIds: [41], allowedBranch: 'develop', eligibleJobNames: ['e2e'], runnerLabel: 'cirujano-pilot-a', slots: 1,
  nebius: {
    profile: 'pilot', projectId: 'project-1', subnetId: 'subnet-1', imageId: 'image-1',
    platform: 'cpu-d3', preset: '4vcpu-16gb', diskType: 'network-ssd', diskSizeGiB: 80,
  },
  ssh: { publicKey: 'ssh-ed25519 AAAA pilot', fingerprint: 'SHA256:pilot' },
  ownership: { controllerId: 'controller-a', resourcePrefix: 'cirujano-a' },
  timing: {
    pollIntervalMs: 30_000, idleGraceMs: 300_000, bootTimeoutMs: 600_000,
    maxJobMs: 3_600_000, lifetimeMs: 5_400_000, shutdownMarginMs: 300_000,
  },
  rates: {
    currency: 'USD', quotedAt: '2026-09-13', source: 'provider quote', computeUsdPerHour: 0.24,
    diskUsdPerGibMonth: 0.10, networkEgressUsdPerGib: 0.05, hostedUsdPerMinute: 0.008,
  },
};
