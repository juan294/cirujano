import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  R14_SCENARIOS,
  analyzePilotResults,
  buildPermitProposal,
  calculatePilotQuoteMaximum,
  exactDispatchCount,
  materializePilotJobs,
  parsePilotManifest,
  renderPilotWorkflow,
  validateR14Matrix,
  type PilotResult,
} from './pilot.js';

const manifest = parsePilotManifest(JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../fixtures/pilot/workload.json'),
  'utf8',
)));
const candidate = '0123456789abcdef0123456789abcdef01234567';
const workflow = readFileSync(resolve(import.meta.dirname, '../fixtures/pilot/runner-pilot.yml'), 'utf8');

function passingResults(): PilotResult[] {
  return manifest.dispatches.map((dispatch, index) => ({
    dispatchId: dispatch.id,
    target: dispatch.target,
    sequence: dispatch.sequence,
    candidateDigest: candidate,
    workflowFile: manifest.workflowFile,
    conclusion: 'success',
    assertions: { node22: true, pnpm11220: true, deterministicTests: true, dockerFixedPort: true, sentinelAbsent: true },
    runnerRegistrationId: dispatch.target === 'self-hosted' ? 700 + index : 100 + index,
    workspaceIdentity: `${dispatch.target}-workspace-${dispatch.sequence}`,
  }));
}

describe('pilot workload preparation', () => {
  it('pins the deterministic workload and computes four exact dispatches', () => {
    expect(manifest.timeoutMinutes).toBe(60);
    expect(manifest.steps.map((step) => step.id)).toEqual([
      'node', 'pnpm', 'deterministic-tests', 'sentinel-absent', 'docker-fixed-port', 'first-run-sentinel',
    ]);
    const dockerStep = manifest.steps.find((step) => step.id === 'docker-fixed-port')?.run;
    expect(dockerStep).toContain('-p 43119:43119');
    expect(dockerStep).toContain("trap 'docker rm -f cirujano-pilot-http");
    expect(dockerStep).toContain('test \"$ready\" = 1');
    expect(exactDispatchCount(manifest)).toBe(4);
  });

  it('materializes hosted and self-hosted jobs with only runner selection differing', () => {
    const jobs = materializePilotJobs(manifest, candidate);
    const hosted = jobs.find((job) => job.dispatchId === 'hosted-1')!;
    const selfHosted = jobs.find((job) => job.dispatchId === 'self-hosted-1')!;
    expect({ ...hosted, runsOn: undefined, dispatchId: undefined, target: undefined }).toEqual({
      ...selfHosted, runsOn: undefined, dispatchId: undefined, target: undefined,
    });
    expect(hosted.runsOn).toEqual(['ubuntu-24.04']);
    expect(selfHosted.runsOn).toContain('cirujano-pilot-fixture');
  });

  it('materializes a pinned workflow_dispatch workload with one shared job body', () => {
    expect(manifest.workflowFile).toBe('.github/workflows/runner-pilot.yml');
    expect(renderPilotWorkflow(manifest)).toBe(workflow);
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('fixture_commit:');
    expect(workflow).toContain('timeout-minutes: 60');
    expect(workflow).toContain('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7');
    expect(workflow).toContain('pnpm/action-setup@f520eceda224fe1a4aed5a2a27a194379a409996 # v6');
    expect(workflow).toContain('actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7');
    expect(workflow).toContain('node-version: 22');
    expect(workflow).toContain('version: 11.22.0');
    expect(workflow.match(/^  workload:$/gmu)).toHaveLength(1);
    expect(workflow).toContain('fromJSON(inputs.target');
    expect(workflow).toContain("inputs.sequence == '1'");
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('executes the deterministic fixture tests locally', () => {
    expect(execFileSync(process.execPath, ['--test', resolve(import.meta.dirname, '../fixtures/pilot/deterministic.mjs')], { encoding: 'utf8' }))
      .toContain('pass 2');
  });

  it('rejects a dispatch whose id does not match its target and sequence', () => {
    const malformed = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
    const dispatches = malformed.dispatches as Array<Record<string, unknown>>;
    dispatches[0]!.target = 'self-hosted';
    expect(() => parsePilotManifest(malformed)).toThrow('dispatch hosted-1 must select hosted sequence 1');
  });

  it('analyzes exact results and requires second-run isolation on both targets', () => {
    expect(analyzePilotResults(manifest, candidate, passingResults())).toMatchObject({ complete: true, dispatchCount: 4 });

    const failed = passingResults();
    failed[3] = { ...failed[3]!, assertions: { ...failed[3]!.assertions, sentinelAbsent: false } };
    expect(analyzePilotResults(manifest, candidate, failed)).toMatchObject({
      complete: false,
      reasons: expect.arrayContaining(['dispatch self-hosted-2 failed sentinel absence']),
    });
  });
});

describe('pilot permit proposal', () => {
  const proposalInput = {
    nowMs: Date.parse('2026-09-13T12:00:00Z'),
    expiresAtMs: Date.parse('2026-09-14T12:00:00Z'),
    candidateDigest: candidate,
    configHash: 'config-sha256',
    repositoryId: 123,
    projectId: 'project-1',
    controllerId: 'controller-1',
    resourcePrefix: 'cirujano-pilot',
    maxStarts: 4,
    maxRuntimeMs: 6 * 60 * 60 * 1000,
    maxTotalCostUsd: 5,
    quote: {
      complete: true as const,
      currency: 'USD', quotedAt: '2026-09-13', source: 'Nebius quote',
      computeUsdPerHour: 0.0992,
      diskUsdPerGibMonth: 0.071,
      publicIpUsdPerHour: 0,
      networkUsdPerGib: 0,
      maxRetainedDiskHours: 24,
      maxPublicIpHours: 24,
      maxNetworkEgressGiB: 10,
      estimatedMaximumUsd: 0.7819397260273973,
      includesRetainedDiskAndIp: true,
    },
  };

  it('computes the conservative six-hour compute plus full-day retained-resource total', () => {
    expect(calculatePilotQuoteMaximum(proposalInput.quote, proposalInput.maxRuntimeMs)).toBeCloseTo(0.78194, 5);
  });

  it('creates an explicitly unapproved one-VM bounded proposal', () => {
    const result = buildPermitProposal(proposalInput);
    expect(result).toMatchObject({
      accepted: true,
      proposal: {
        approved: false,
        maxConcurrentVms: 1,
        resources: { platform: 'cpu-d3', preset: '4vcpu-16gb', diskCount: 1, diskSizeGiB: 80 },
        maxStarts: 4,
        maxRuntimeMs: 21_600_000,
        maxTotalCostUsd: 5,
      },
    });
    if (result.accepted) expect(result.proposal.resourceGenerations).toHaveLength(4);
    if (result.accepted) expect(result.proposal.quote.estimatedMaximumUsd).toBeCloseTo(0.78194, 5);
  });

  it.each([
    ['more than one VM', { maxConcurrentVms: 2 }],
    ['too many starts', { maxStarts: 5 }],
    ['too much runtime', { maxRuntimeMs: 21_600_001 }],
    ['expiry beyond 24 hours', { expiresAtMs: Date.parse('2026-09-14T12:00:00Z') + 1 }],
    ['more than USD 5', { maxTotalCostUsd: 5.01 }],
    ['incomplete quote', { quote: { complete: false as const, reason: 'network rate unavailable' } }],
    ['quote excludes retention', { quote: { ...proposalInput.quote, includesRetainedDiskAndIp: false } }],
    ['quote exceeds ceiling', { quote: { ...proposalInput.quote, estimatedMaximumUsd: 5.01 } }],
    ['stale quote date', { quote: { ...proposalInput.quote, quotedAt: '2026-09-05' } }],
    ['invalid quote date', { quote: { ...proposalInput.quote, quotedAt: '2026-02-30' } }],
    ['inconsistent supplied total', { quote: { ...proposalInput.quote, estimatedMaximumUsd: 0.75 } }],
    ['overflowing calculated total', { quote: { ...proposalInput.quote, computeUsdPerHour: 1e308, estimatedMaximumUsd: 1 } }],
    ['partial disk retention bound', { quote: { ...proposalInput.quote, maxRetainedDiskHours: 23 } }],
    ['partial IP retention bound', { quote: { ...proposalInput.quote, maxPublicIpHours: 23 } }],
    ['missing network bound', { quote: { ...proposalInput.quote, maxNetworkEgressGiB: Number.NaN } }],
  ])('rejects %s', (_name, change) => {
    expect(buildPermitProposal({ ...proposalInput, ...change })).toMatchObject({ accepted: false });
  });
});

describe('R14 evidence matrix', () => {
  const rows = R14_SCENARIOS.map((scenario) => ({
    scenario,
    status: 'passed' as const,
    candidateDigest: candidate,
    evidence: [`${scenario} evidence`],
  }));

  it('requires live authorization, prerequisites, nonzero passes and every row passing', () => {
    expect(validateR14Matrix({ candidateDigest: candidate, liveAuthorized: true, prerequisitesComplete: true, rows })).toMatchObject({
      complete: true, passCount: R14_SCENARIOS.length,
    });
  });

  it.each(['skipped', 'failed', 'not-run'] as const)('does not convert %s into success', (status) => {
    const changed = rows.map((row) => row.scenario === 'watchdog-first' ? { ...row, status } : row);
    const result = validateR14Matrix({ candidateDigest: candidate, liveAuthorized: true, prerequisitesComplete: true, rows: changed });
    expect(result.complete).toBe(false);
    expect(result.reasons).toContain(`required R14 scenario watchdog-first is ${status}`);
  });

  it('rejects missing, duplicate, stale, unevidenced and unauthorized matrices', () => {
    const changed = rows.filter((row) => row.scenario !== 'cleanup');
    changed.push({ ...rows[0]!, candidateDigest: 'stale' });
    const result = validateR14Matrix({ candidateDigest: candidate, liveAuthorized: false, prerequisitesComplete: false, rows: changed });
    expect(result.complete).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'live pilot authorization is absent',
      'live pilot prerequisites are incomplete',
      'required R14 scenario cleanup is missing',
      'required R14 scenario provider-contract has duplicate results',
      'required R14 scenario provider-contract has a mismatched candidate',
    ]));
  });
});
