import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { parseRunnerConfig, parsePermit, verifySshPublicKeyFingerprint } from '@cirujano/runner';

import { runCli } from './cli.js';
import { parseFleetRegistry, type FleetRegistry } from './fleet-registry.js';
import { assertPublishable, createFleetCommandService, extractJobRunsOn, readControllerEvidence } from './fleet-service.js';

const OWNER = 'juan294';
const HEAD = 'a'.repeat(40);
const MERGED = 'b'.repeat(40);
const HOSTED_BLOB = '1'.repeat(40);
const MIGRATED_BLOB = '2'.repeat(40);
const LABEL = 'cirujano-baseline-actions_linux';

const HOSTED_WORKFLOW = [
  'name: CI',
  'on: [push]',
  'jobs:',
  '  check:',
  '    name: Check',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo hi',
  '  lint:',
  '    runs-on: [ubuntu-24.04]',
  '  mac:',
  '    runs-on: macos-latest',
  '',
].join('\n');

const MIGRATED_WORKFLOW = HOSTED_WORKFLOW.replace('    runs-on: ubuntu-latest', `    runs-on: [self-hosted, linux, x64, ${LABEL}]`);
const UNLABELLED_WORKFLOW = HOSTED_WORKFLOW.replace('    runs-on: ubuntu-latest', '    runs-on: [self-hosted, linux, x64]');

interface FakeGitHub {
  headCommit: string;
  files: Record<string, { sha: string; content: string }>;
  ancestors: string[];
  requests: string[];
}

function fakeGitHub(): FakeGitHub {
  return {
    headCommit: HEAD,
    files: { [HEAD]: { sha: HOSTED_BLOB, content: HOSTED_WORKFLOW } },
    ancestors: [HEAD],
    requests: [],
  };
}

function pageRunnerFor(fake: FakeGitHub) {
  return async (_command: string, args: readonly string[]) => {
    const endpoint = args.at(-1)!;
    fake.requests.push(endpoint);
    if (args[0] !== 'api' || args.includes('--method')) throw new Error(`fleet reads must stay read-only: ${args.join(' ')}`);
    const contents = /^\/repos\/juan294\/app\/contents\/\.github\/workflows\/ci\.yml\?ref=([0-9a-f]{40})$/u.exec(endpoint);
    if (endpoint === '/repos/juan294/app') return { stdout: JSON.stringify([{ id: 777, full_name: 'juan294/app', default_branch: 'main', visibility: 'private' }]) };
    if (endpoint === '/repos/juan294/app/branches/main') return { stdout: JSON.stringify([{ name: 'main', commit: { sha: fake.headCommit } }]) };
    if (endpoint === '/repos/juan294/app/actions/workflows?per_page=100') {
      return { stdout: JSON.stringify([{ total_count: 2, workflows: [
        { id: 41, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' },
        { id: 42, name: 'Release', path: '.github/workflows/release.yml', state: 'active' },
      ] }]) };
    }
    if (contents !== null) {
      const file = fake.files[contents[1]!];
      if (file === undefined) throw new Error('HTTP 404: Not Found');
      return { stdout: JSON.stringify([{ sha: file.sha, encoding: 'base64', content: Buffer.from(file.content).toString('base64') }]) };
    }
    const compare = /^\/repos\/juan294\/app\/compare\/([0-9a-f]{40})\.\.\.main$/u.exec(endpoint);
    if (compare !== null) return { stdout: JSON.stringify([{ status: fake.ancestors.includes(compare[1]!) ? 'ahead' : 'diverged' }]) };
    throw new Error(`unexpected GitHub read ${endpoint}`);
  };
}

async function freshRegistry(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'cirujano-fleet-'));
  const registryPath = join(directory, 'fleet-registry.json');
  const service = createFleetCommandService({}, pageRunnerFor(fakeGitHub()));
  expect(await service.run({ command: 'fleet', action: 'init', registryPath, owner: OWNER, since: '2026-09-13', through: '2026-10-28' }, silent())).toBe(0);
  return registryPath;
}

async function readRegistry(path: string): Promise<FleetRegistry> {
  return parseFleetRegistry(JSON.parse(await readFile(path, 'utf8')));
}

function silent() {
  return { stdout: () => undefined, stderr: () => undefined };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (text: string) => { out.push(text); }, stderr: (text: string) => { err.push(text); } }, out, err };
}

const enrollArguments = (registryPath: string) => ({
  command: 'fleet' as const, action: 'enroll' as const, registryPath,
  repository: 'juan294/app', workflowPath: '.github/workflows/ci.yml', jobKey: 'check', jobNames: [], sku: 'actions_linux' as const,
});

describe('fleet command service (phase 1 U2)', () => {
  it('initialises a private registry with the locked exclusions and refuses to overwrite it', async () => {
    const registryPath = await freshRegistry();
    const registry = await readRegistry(registryPath);
    expect(registry.exclusions.map(({ repository }) => repository)).toEqual([
      'juan294/chapa', 'juan294/spoken-letter', 'frivas/contribution-dashboard', 'behboud/opencode-rpi', 'juan294/home-network',
    ]);
    expect(registry.enrollments).toEqual([]);
    expect((await stat(registryPath)).mode & 0o777).toBe(0o600);
    const service = createFleetCommandService({}, pageRunnerFor(fakeGitHub()));
    await expect(service.run({ command: 'fleet', action: 'init', registryPath, owner: OWNER, since: '2026-09-13', through: '2026-10-28' }, silent()))
      .rejects.toThrow(/already exists/u);
  });

  it('enrolls a hosted job with the exact blob SHA and runs-on read from GitHub', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T08:00:00Z'));
    try {
      const registryPath = await freshRegistry();
      const fake = fakeGitHub();
      const { io, out } = capture();
      expect(await createFleetCommandService({}, pageRunnerFor(fake)).run(enrollArguments(registryPath), io)).toBe(0);
      const registry = await readRegistry(registryPath);
      expect(registry.enrollments).toEqual([{
        id: 'P1', repository: 'juan294/app', repositoryId: 777, workflowPath: '.github/workflows/ci.yml', workflowId: 41, workflowName: 'CI',
        jobKey: 'check', jobNames: ['Check'], sku: 'actions_linux', runnerLabel: LABEL, status: 'proposed',
        before: { commit: HEAD, workflowBlobSha: HOSTED_BLOB, runsOn: ['ubuntu-latest'], recordedAt: '2026-09-16T08:00:00.000Z' },
        after: null, controller: null, notes: [],
      }]);
      expect(JSON.parse(out.join(''))).toMatchObject({ status: 'enrolled', id: 'P1', before: { workflowBlobSha: HOSTED_BLOB } });
      expect(fake.requests.every((endpoint) => endpoint.startsWith('/repos/juan294/app'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['an excluded repository', { repository: 'juan294/chapa-cli' }, /excluded from migration/u],
    ['a repository outside the owner', { repository: 'other/app' }, /must belong to juan294/u],
    ['an unknown workflow path', { workflowPath: '.github/workflows/missing.yml' }, /workflow .* is not registered/u],
    ['an unknown job key', { jobKey: 'deploy' }, /job deploy is not defined/u],
    ['a job priced under another SKU', { jobKey: 'mac' }, /priced as actions_macos, not actions_linux/u],
    ['a SKU without an enrolled label', { jobKey: 'mac', sku: 'actions_macos' as const }, /has no enrolled Cirujano label/u],
  ])('refuses to enroll %s', async (_name, changes, message) => {
    const registryPath = await freshRegistry();
    const service = createFleetCommandService({}, pageRunnerFor(fakeGitHub()));
    await expect(service.run({ ...enrollArguments(registryPath), ...changes }, silent())).rejects.toThrow(message);
    expect((await readRegistry(registryPath)).enrollments).toEqual([]);
  });

  it('refuses to enroll a job that already targets a self-hosted or Cirujano runner, and a duplicate', async () => {
    const registryPath = await freshRegistry();
    const fake = fakeGitHub();
    fake.files[HEAD] = { sha: MIGRATED_BLOB, content: MIGRATED_WORKFLOW };
    await expect(createFleetCommandService({}, pageRunnerFor(fake)).run(enrollArguments(registryPath), silent()))
      .rejects.toThrow(/already runs on self-hosted/u);
    const hosted = fakeGitHub();
    const service = createFleetCommandService({}, pageRunnerFor(hosted));
    expect(await service.run(enrollArguments(registryPath), silent())).toBe(0);
    await expect(service.run(enrollArguments(registryPath), silent())).rejects.toThrow(/already enrolled as P1/u);
    expect(await service.run({ ...enrollArguments(registryPath), jobKey: 'lint', jobNames: ['Lint one', 'Lint two'] }, silent())).toBe(0);
    const registry = await readRegistry(registryPath);
    expect(registry.enrollments.map(({ id, jobKey, jobNames }) => [id, jobKey, jobNames])).toEqual([['P1', 'check', ['Check']], ['P2', 'lint', ['Lint one', 'Lint two']]]);
  });

  it('records a cutover only when the merged commit is on the default branch and carries the label', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));
    try {
      const registryPath = await freshRegistry();
      const fake = fakeGitHub();
      const service = createFleetCommandService({}, pageRunnerFor(fake));
      expect(await service.run(enrollArguments(registryPath), silent())).toBe(0);
      const cutover = { command: 'fleet' as const, action: 'cutover' as const, registryPath, id: 'P1', commit: MERGED };

      fake.files[MERGED] = { sha: '3'.repeat(40), content: UNLABELLED_WORKFLOW };
      await expect(service.run(cutover, silent())).rejects.toThrow(/is not on the default branch main/u);
      fake.ancestors.push(MERGED);
      await expect(service.run(cutover, silent())).rejects.toThrow(new RegExp(`runs-on lacks ${LABEL}`, 'u'));
      expect((await readRegistry(registryPath)).enrollments[0]).toMatchObject({ status: 'proposed', after: null });

      fake.files[MERGED] = { sha: MIGRATED_BLOB, content: MIGRATED_WORKFLOW };
      const { io, out } = capture();
      expect(await service.run(cutover, io)).toBe(0);
      expect((await readRegistry(registryPath)).enrollments[0]).toMatchObject({
        status: 'cut-over',
        after: { commit: MERGED, workflowBlobSha: MIGRATED_BLOB, runsOn: ['self-hosted', 'linux', 'x64', LABEL], recordedAt: '2026-09-17T12:00:00.000Z' },
      });
      expect(JSON.parse(out.join(''))).toMatchObject({ status: 'cut-over', id: 'P1' });
      await expect(service.run(cutover, silent())).rejects.toThrow(/P1 is cut-over, not proposed/u);
      await expect(service.run({ ...cutover, id: 'P9' }, silent())).rejects.toThrow(/enrollment P9 does not exist/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it('verifies live state, refreshes a stale proposed record, and records a revert instead of hiding it', async () => {
    const registryPath = await freshRegistry();
    const fake = fakeGitHub();
    const service = createFleetCommandService({}, pageRunnerFor(fake));
    expect(await service.run(enrollArguments(registryPath), silent())).toBe(0);
    const verify = { command: 'fleet' as const, action: 'verify' as const, registryPath };
    expect(await service.run(verify, silent())).toBe(0);

    // A pre-cutover workflow edit refreshes the before record and stays proposed.
    fake.headCommit = MERGED;
    fake.ancestors.push(MERGED);
    fake.files[MERGED] = { sha: '4'.repeat(40), content: HOSTED_WORKFLOW.replace('echo hi', 'echo there') };
    expect(await service.run(verify, silent())).toBe(0);
    expect((await readRegistry(registryPath)).enrollments[0]).toMatchObject({
      status: 'proposed', before: { commit: MERGED, workflowBlobSha: '4'.repeat(40) }, notes: [expect.stringMatching(/before refreshed/u)],
    });

    fake.files[MERGED] = { sha: MIGRATED_BLOB, content: MIGRATED_WORKFLOW };
    expect(await service.run({ command: 'fleet', action: 'cutover', registryPath, id: 'P1', commit: MERGED }, silent())).toBe(0);
    expect(await service.run(verify, silent())).toBe(0);

    // An unrelated post-cutover edit with the label intact fails verification without rewriting the record.
    const edited = 'c'.repeat(40);
    fake.headCommit = edited;
    fake.ancestors.push(edited);
    fake.files[edited] = { sha: '5'.repeat(40), content: MIGRATED_WORKFLOW.replace('echo hi', 'echo edited') };
    const stale = capture();
    expect(await service.run(verify, stale.io)).toBe(1);
    expect(stale.err.join('')).toMatch(/P1: live workflow blob 5{40} differs from the recorded after blob 2{40}/u);
    expect((await readRegistry(registryPath)).enrollments[0]).toMatchObject({ status: 'cut-over', after: { workflowBlobSha: MIGRATED_BLOB } });

    // Losing the label is a revert: recorded as such and reported, never silent.
    fake.files[edited] = { sha: '6'.repeat(40), content: HOSTED_WORKFLOW };
    const reverted = capture();
    expect(await service.run(verify, reverted.io)).toBe(1);
    expect(reverted.err.join('')).toMatch(/P1: enrolled label .* is gone from the live workflow at c{40}; recorded as reverted/u);
    expect((await readRegistry(registryPath)).enrollments[0]).toMatchObject({
      status: 'reverted', notes: [expect.stringMatching(/before refreshed/u), expect.stringMatching(/reverted at .* commit c{40} blob 6{40}/u)],
    });
  });

  it('shows the registry as JSON through the CLI and maps runtime failures to exit 1', async () => {
    const registryPath = await freshRegistry();
    const service = createFleetCommandService({}, pageRunnerFor(fakeGitHub()));
    const { io, out } = capture();
    expect(await runCli(['fleet', 'show', '--registry', registryPath], io, undefined, undefined, service)).toBe(0);
    expect(JSON.parse(out.join(''))).toMatchObject({ owner: OWNER, enrollments: [] });
    const failing = capture();
    expect(await runCli(['fleet', 'show', '--registry', join(registryPath, 'missing.json')], failing.io, undefined, undefined, service)).toBe(1);
    expect(failing.err.join('')).toMatch(/fleet show failed/u);
    expect(await runCli(['fleet', 'show'], failing.io, undefined, undefined, service)).toBe(2);
  });

  it('rejects a registry file that fails validation before any GitHub read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-fleet-bad-'));
    const registryPath = join(directory, 'fleet-registry.json');
    await writeFile(registryPath, JSON.stringify({ schemaVersion: 1, owner: OWNER, measurementWindow: { since: '2026-09-13', through: '2026-10-28' }, exclusions: [], enrollments: [] }));
    const fake = fakeGitHub();
    await expect(createFleetCommandService({}, pageRunnerFor(fake)).run(enrollArguments(registryPath), silent())).rejects.toThrow(/locked exclusion/u);
    expect(fake.requests).toEqual([]);
  });
});

describe('fleet controller-config and permit-proposal (phase 2 U1)', () => {
  const template = {
    schemaVersion: 1,
    repository: { id: 1, nameWithOwner: 'template/pilot', visibility: 'private' },
    workflowIds: [1], allowedBranch: 'develop', eligibleJobNames: ['workload'], runnerLabel: 'cirujano-pilot-fixture', slots: 1,
    nebius: { profile: 'TCT', projectId: 'project-1', subnetId: 'subnet-1', imageId: 'image-1', platform: 'cpu-d3', preset: '4vcpu-16gb', diskType: 'network-ssd', diskSizeGiB: 80 },
    ssh: { publicKey: 'ssh-ed25519 AAAA template', fingerprint: 'SHA256:template' },
    ownership: { controllerId: 'template', resourcePrefix: 'template' },
    timing: { pollIntervalMs: 30_000, idleGraceMs: 300_000, bootTimeoutMs: 600_000, maxJobMs: 3_600_000, lifetimeMs: 5_400_000, shutdownMarginMs: 300_000 },
    rates: { currency: 'USD', quotedAt: '2026-09-15', source: 'https://docs.nebius.com/compute/resources/pricing', computeUsdPerHour: 0.0992, diskUsdPerGibMonth: 0.071, networkEgressUsdPerGib: 0, hostedUsdPerMinute: 0.006 },
  };

  async function enrolledFixture() {
    const registryPath = await freshRegistry();
    const directory = join(registryPath, '..');
    const fake = fakeGitHub();
    const service = createFleetCommandService({}, pageRunnerFor(fake));
    expect(await service.run(enrollArguments(registryPath), silent())).toBe(0);
    const templatePath = join(directory, 'template-config.json');
    await writeFile(templatePath, JSON.stringify(template));
    return { registryPath, directory, service, templatePath, stateRoot: join(directory, 'runner') };
  }

  it('writes a D5/D6 controller config and host key for an enrollment and records the controller in the registry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T08:00:00Z'));
    try {
      const { registryPath, service, templatePath, stateRoot } = await enrolledFixture();
      const { io, out } = capture();
      expect(await service.run({ command: 'fleet', action: 'controller-config', registryPath, id: 'P1', stateRoot, templatePath }, io)).toBe(0);
      const stateDirectory = join(stateRoot, 'P1');
      expect((await stat(stateDirectory)).mode & 0o777).toBe(0o700);
      const rawConfig = await readFile(join(stateDirectory, 'config.json'), 'utf8');
      expect((await stat(join(stateDirectory, 'config.json'))).mode & 0o777).toBe(0o600);
      expect((await stat(join(stateDirectory, 'ssh_host_ed25519_key'))).mode & 0o777).toBe(0o600);
      const config = parseRunnerConfig(JSON.parse(rawConfig));
      expect(config).toMatchObject({
        repository: { id: 777, nameWithOwner: 'juan294/app', visibility: 'private' },
        workflowIds: [41], allowedBranch: 'main', eligibleJobNames: ['Check'], runnerLabel: LABEL, slots: 1,
        nebius: template.nebius,
        ownership: { controllerId: 'cirujano-p1-20260916', resourcePrefix: 'cirujano-p1' },
        timing: { pollIntervalMs: 30_000, idleGraceMs: 300_000, bootTimeoutMs: 600_000, maxJobMs: 3_600_000, lifetimeMs: 14_400_000, shutdownMarginMs: 300_000 },
        rates: { ...template.rates, hostedUsdPerMinute: 0.006 },
      });
      expect(config.ssh.publicKey).toMatch(/^ssh-ed25519 /u);
      expect(config.ssh.fingerprint).toBe(verifySshPublicKeyFingerprint(config.ssh.publicKey));
      expect((await readFile(join(stateDirectory, 'ssh_host_ed25519_key.pub'), 'utf8')).trim()).toBe(config.ssh.publicKey);
      const printed = JSON.parse(out.join('')) as { identity: Record<string, unknown>; configPath: string };
      expect(printed.identity).toEqual({
        configHash: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
        repositoryId: 777, projectId: 'project-1', controllerId: 'cirujano-p1-20260916', resourcePrefix: 'cirujano-p1',
      });
      expect((await readRegistry(registryPath)).enrollments[0]!.controller).toEqual({
        stateDirectory, controllerId: 'cirujano-p1-20260916', resourcePrefix: 'cirujano-p1', permitId: null,
      });
      // Re-running keeps the host key and identity stable.
      const again = capture();
      expect(await service.run({ command: 'fleet', action: 'controller-config', registryPath, id: 'P1', stateRoot, templatePath, allowedBranch: 'main' }, again.io)).toBe(0);
      expect((JSON.parse(again.out.join('')) as { identity: unknown }).identity).toEqual(printed.identity);
      expect(rawConfig).not.toContain('PRIVATE KEY');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a controller config for an unknown, reverted or public-template enrollment', async () => {
    const { registryPath, service, templatePath, stateRoot, directory } = await enrolledFixture();
    await expect(service.run({ command: 'fleet', action: 'controller-config', registryPath, id: 'P7', stateRoot, templatePath }, silent())).rejects.toThrow(/P7 does not exist/u);
    const badTemplate = join(directory, 'bad-template.json');
    await writeFile(badTemplate, JSON.stringify({ ...template, nebius: { ...template.nebius, preset: '8vcpu-32gb' } }));
    await expect(service.run({ command: 'fleet', action: 'controller-config', registryPath, id: 'P1', stateRoot, templatePath: badTemplate }, silent())).rejects.toThrow(/preset must be 4vcpu-16gb/u);
  });

  it('writes an operating permit proposal bound to the controller identity and refuses one without a controller', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T08:00:00Z'));
    try {
      const { registryPath, service, templatePath, stateRoot, directory } = await enrolledFixture();
      const quotePath = join(directory, 'quote.json');
      await writeFile(quotePath, JSON.stringify({
        complete: true, currency: 'USD', quotedAt: '2026-09-15', source: 'https://docs.nebius.com/compute/resources/pricing',
        computeUsdPerHour: 0.0992, diskUsdPerGibMonth: 0.071, publicIpUsdPerHour: 0, networkUsdPerGib: 0,
        maxRetainedDiskHours: 1100, maxPublicIpHours: 1100, maxNetworkEgressGiB: 10, includesRetainedDiskAndIp: true,
      }));
      const proposalArguments = { command: 'fleet' as const, action: 'permit-proposal' as const, registryPath, id: 'P1', candidateDigest: 'c'.repeat(64), quotePath };
      await expect(service.run(proposalArguments, silent())).rejects.toThrow(/has no controller; run fleet controller-config first/u);
      expect(await service.run({ command: 'fleet', action: 'controller-config', registryPath, id: 'P1', stateRoot, templatePath }, silent())).toBe(0);
      const { io, out } = capture();
      expect(await service.run(proposalArguments, io)).toBe(0);
      const proposalPath = join(stateRoot, 'P1', 'permit-proposal.json');
      const proposal = JSON.parse(await readFile(proposalPath, 'utf8')) as Record<string, unknown>;
      const config = parseRunnerConfig(JSON.parse(await readFile(join(stateRoot, 'P1', 'config.json'), 'utf8')));
      expect(proposal).toMatchObject({
        kind: 'operating', enrollmentId: 'P1', approved: false, candidateDigest: 'c'.repeat(64),
        configHash: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
        repositoryId: 777, projectId: 'project-1', controllerId: 'cirujano-p1-20260916', resourcePrefix: 'cirujano-p1',
        issuedAtMs: Date.parse('2026-09-16T08:00:00Z'), expiresAtMs: Date.parse('2026-10-28T23:59:59Z'),
        maxStarts: 600, maxRuntimeMs: 540_000_000, maxTotalCostUsd: 40, fleetCommittedUsd: 40,
      });
      expect(JSON.parse(out.join(''))).toMatchObject({ status: 'proposed', proposalPath, estimatedMaximumUsd: expect.any(Number) });
      // The proposal renders a permit that parses; the owner writes it as permit.json after confirming.
      const permit = JSON.parse(await readFile(join(stateRoot, 'P1', 'permit.draft.json'), 'utf8')) as Record<string, unknown>;
      expect(parsePermit(permit)).toMatchObject({ permitId: 'P1-operating-20260916', maxTotalCostUsd: 40 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('controller evidence and the sanitized publication (phase 4)', () => {
  const identity = { configHash: 'h'.repeat(64), candidateDigest: 'c'.repeat(64), repositoryId: 777, projectId: 'project-1', controllerId: 'cirujano-p1-20260916', resourcePrefix: 'cirujano-p1' };
  const rates = { currency: 'USD', quotedAt: '2026-09-15', source: 'quote', computeUsdPerHour: 0.0992, diskUsdPerGibMonth: 0.071, networkEgressUsdPerGib: 0, hostedUsdPerMinute: 0.006 };

  async function journals(overrides: { assignmentsIdentity?: typeof identity; omitState?: boolean } = {}) {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'cirujano-evidence-'));
    const config = {
      schemaVersion: 1, repository: { id: 777, nameWithOwner: 'juan294/app', visibility: 'private' }, workflowIds: [41], allowedBranch: 'main',
      eligibleJobNames: ['Check'], runnerLabel: LABEL, slots: 1,
      nebius: { profile: 'TCT', projectId: 'project-1', subnetId: 'subnet-1', imageId: 'image-1', platform: 'cpu-d3', preset: '4vcpu-16gb', diskType: 'network-ssd', diskSizeGiB: 80 },
      ssh: { publicKey: 'ssh-ed25519 AAAA x', fingerprint: 'SHA256:x' }, ownership: { controllerId: identity.controllerId, resourcePrefix: identity.resourcePrefix },
      timing: { pollIntervalMs: 30_000, idleGraceMs: 300_000, bootTimeoutMs: 600_000, maxJobMs: 3_600_000, lifetimeMs: 14_400_000, shutdownMarginMs: 300_000 }, rates,
    };
    await writeFile(join(stateDirectory, 'config.json'), JSON.stringify(config));
    if (overrides.omitState !== true) {
      await writeFile(join(stateDirectory, 'controller-state.json'), JSON.stringify({
        schemaVersion: 1, identity, pendingEffect: null, readbacks: [],
        lifecycle: { state: 'absent', startCount: 3, cumulativeRuntimeMs: 7_200_000, cumulativeCostUsd: 0.25, outstandingIntent: null, idleObservations: [], grantDeadlineMs: null },
      }));
    }
    await writeFile(join(stateDirectory, 'accounting-state.json'), JSON.stringify({
      schemaVersion: 1, identity, diskStartedAtMs: null, diskRetainedMs: 43_200_000, runtimeBaselineMs: 0, generation: 3, networkEgressBytes: 2048,
    }));
    await writeFile(join(stateDirectory, 'assignments.json'), JSON.stringify({
      schemaVersion: 1, identity: overrides.assignmentsIdentity ?? identity,
      assignments: [{ runId: 5, runAttempt: 1, jobId: 50, runnerId: 900, runnerName: 'cirujano-p1-g1', conclusion: 'success' }],
    }));
    return stateDirectory;
  }

  it('reads the controller journals of an enrollment with a consistent identity', async () => {
    const stateDirectory = await journals();
    await expect(readControllerEvidence(stateDirectory, { controllerId: identity.controllerId, resourcePrefix: identity.resourcePrefix })).resolves.toEqual({
      controllerId: identity.controllerId, resourcePrefix: identity.resourcePrefix, startCount: 3, cumulativeRuntimeMs: 7_200_000, cumulativeCostUsd: 0.25,
      diskRetainedMs: 43_200_000, diskSizeGiB: 80, networkEgressBytes: 2048, rates,
      assignments: [{ runId: 5, runAttempt: 1, jobId: 50, runnerId: 900, runnerName: 'cirujano-p1-g1', conclusion: 'success' }],
    });
  });

  it('refuses journals whose identity differs from the enrollment or from each other, and reports a missing journal', async () => {
    const mismatch = await journals({ assignmentsIdentity: { ...identity, controllerId: 'someone-else' } });
    await expect(readControllerEvidence(mismatch, { controllerId: identity.controllerId, resourcePrefix: identity.resourcePrefix })).rejects.toThrow(/assignments\.json identity does not match/u);
    const foreign = await journals();
    await expect(readControllerEvidence(foreign, { controllerId: 'cirujano-p9-20260916', resourcePrefix: 'cirujano-p9' })).rejects.toThrow(/controllerId cirujano-p1-20260916 does not match enrollment controller cirujano-p9-20260916/u);
    const missing = await journals({ omitState: true });
    await expect(readControllerEvidence(missing, { controllerId: identity.controllerId, resourcePrefix: identity.resourcePrefix })).rejects.toThrow(/controller-state\.json/u);
  });

  it('publishes the sanitized report and refuses output that names a private repository or resource', async () => {
    const registryPath = await freshRegistry();
    const directory = join(registryPath, '..');
    const storePath = join(directory, 'store');
    await mkdir(storePath, { recursive: true });
    const snapshot = JSON.parse(await readFile(join(import.meta.dirname, '../fixtures/telemetry-snapshot.fixture.json'), 'utf8')) as { collectedAt: string };
    await writeFile(join(storePath, `${snapshot.collectedAt.slice(0, 10)}.json`), JSON.stringify(snapshot));
    const registry = await readRegistry(registryPath);
    const stateDirectory = await journals();
    const enrollment = {
      id: 'P1', repository: 'juan294/private-one', repositoryId: 1001, workflowPath: '.github/workflows/ci.yml', workflowId: 501, workflowName: 'CI',
      jobKey: 'check', jobNames: ['check'], sku: 'actions_linux' as const, runnerLabel: LABEL, status: 'cut-over' as const,
      before: { commit: '1'.repeat(40), workflowBlobSha: 'a'.repeat(40), runsOn: ['ubuntu-latest'], recordedAt: '2026-09-16T08:00:00.000Z' },
      after: { commit: '2'.repeat(40), workflowBlobSha: 'b'.repeat(40), runsOn: ['self-hosted', 'linux', 'x64', LABEL], recordedAt: '2026-09-17T12:00:00.000Z' },
      controller: { stateDirectory, controllerId: identity.controllerId, resourcePrefix: identity.resourcePrefix, permitId: null }, notes: [],
    };
    await writeFile(registryPath, JSON.stringify({ ...registry, enrollments: [enrollment] }));
    const service = createFleetCommandService({}, pageRunnerFor(fakeGitHub()));
    const outputPath = join(directory, 'report.md');
    const { io, out } = capture();
    expect(await service.run({ command: 'fleet', action: 'publish', registryPath, storePath, since: '2026-09-13', outputPath }, io)).toBe(0);
    const published = await readFile(outputPath, 'utf8');
    expect(published).toContain('# Cirujano fleet migration: net savings');
    expect(published).toContain('| P1 | cut-over |');
    expect(published).not.toMatch(/juan294|private-one|cirujano-p1|project-1|subnet-1/u);
    expect(JSON.parse(out.join(''))).toMatchObject({ status: 'published', outputPath, complete: false });

    // The guard behind publish refuses every private identity class, so a future renderer change cannot leak silently.
    const guarded = { ...registry, enrollments: [enrollment] };
    expect(() => assertPublishable(published, guarded)).not.toThrow();
    expect(() => assertPublishable(`${published}\nsee juan294/private-one`, guarded)).toThrow(/refusing to publish: output contains private repository juan294\/private-one/u);
    expect(() => assertPublishable(`${published}\nsee juan294/home-network`, guarded)).toThrow(/private repository juan294\/home-network/u);
    expect(() => assertPublishable(`${published}\nsee juan294/other`, guarded)).toThrow(/owner prefix juan294\//u);
    expect(() => assertPublishable(`${published}\nvm cirujano-p1-vm`, guarded)).toThrow(/controller identity cirujano-p1/u);
    expect(() => assertPublishable(`${published}\nid computeinstance-e01abc`, guarded)).toThrow(/resource identity computeinstance-e01abc/u);
    expect(() => assertPublishable(`${published}\nproject project-e01v3ms9pa004rtecbkdjt`, guarded)).toThrow(/resource identity project-e01v3ms9pa004rtecbkdjt/u);
  });
});

describe('extractJobRunsOn', () => {
  it('reads scalar, flow and block runs-on forms and the job display name', () => {
    expect(extractJobRunsOn(HOSTED_WORKFLOW, 'check')).toEqual({ runsOn: ['ubuntu-latest'], name: 'Check' });
    expect(extractJobRunsOn(HOSTED_WORKFLOW, 'lint')).toEqual({ runsOn: ['ubuntu-24.04'], name: null });
    expect(extractJobRunsOn(MIGRATED_WORKFLOW, 'check')).toEqual({ runsOn: ['self-hosted', 'linux', 'x64', LABEL], name: 'Check' });
    const block = ['jobs:', '  build:', '    runs-on:', '      - self-hosted', '      - "linux"', "      - 'x64'", '    steps: []', ''].join('\n');
    expect(extractJobRunsOn(block, 'build')).toEqual({ runsOn: ['self-hosted', 'linux', 'x64'], name: null });
  });

  it('refuses expressions, matrices and missing selections rather than guessing', () => {
    expect(() => extractJobRunsOn(HOSTED_WORKFLOW, 'deploy')).toThrow(/job deploy is not defined/u);
    expect(() => extractJobRunsOn(['jobs:', '  a:', '    runs-on: ${{ matrix.os }}', ''].join('\n'), 'a')).toThrow(/expression/u);
    expect(() => extractJobRunsOn(['jobs:', '  a:', '    steps: []', ''].join('\n'), 'a')).toThrow(/has no runs-on/u);
    expect(() => extractJobRunsOn('name: nothing\n', 'a')).toThrow(/has no jobs block/u);
  });
});
