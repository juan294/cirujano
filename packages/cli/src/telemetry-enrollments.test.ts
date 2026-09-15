import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseFleetRegistry, type FleetEnrollment, type FleetRegistry } from './fleet-registry.js';
import { aggregateTelemetry, renderTelemetryMarkdown, type TelemetrySnapshot } from './telemetry.js';

const SINCE = Date.parse('2026-09-13T00:00:00Z');
const LABEL = 'cirujano-baseline-actions_linux';
const fixtures = join(import.meta.dirname, '../fixtures');

async function fixtureSnapshot(): Promise<TelemetrySnapshot> {
  return JSON.parse(await readFile(join(fixtures, 'telemetry-snapshot.fixture.json'), 'utf8')) as TelemetrySnapshot;
}

function enrollment(overrides: Partial<FleetEnrollment>): FleetEnrollment {
  return {
    id: 'P1', repository: 'juan294/private-one', repositoryId: 1001, workflowPath: '.github/workflows/ci.yml', workflowId: 501,
    workflowName: 'CI', jobKey: 'check', jobNames: ['check'], sku: 'actions_linux', runnerLabel: LABEL, status: 'cut-over',
    before: { commit: '1'.repeat(40), workflowBlobSha: 'a'.repeat(40), runsOn: ['ubuntu-latest'], recordedAt: '2026-09-16T08:00:00.000Z' },
    after: { commit: '2'.repeat(40), workflowBlobSha: 'b'.repeat(40), runsOn: ['self-hosted', 'linux', 'x64', LABEL], recordedAt: '2026-09-17T12:00:00.000Z' },
    controller: null, notes: [],
    ...overrides,
  };
}

function registry(enrollments: FleetEnrollment[]): FleetRegistry {
  return parseFleetRegistry({
    schemaVersion: 1, owner: 'juan294', measurementWindow: { since: '2026-09-13', through: '2026-10-28' },
    exclusions: ['juan294/chapa', 'juan294/spoken-letter', 'frivas/contribution-dashboard', 'behboud/opencode-rpi', 'juan294/home-network']
      .map((repository) => ({ repository, reason: 'locked', lockedBy: 'fleet-telemetry plan 2026-09-13' })),
    enrollments,
  });
}

describe('telemetry enrollment section (phase 1 U3)', () => {
  it('keeps the no-registry JSON and Markdown byte-identical to the pinned fixture', async () => {
    const report = aggregateTelemetry([await fixtureSnapshot()], SINCE);
    expect(`${JSON.stringify(report)}\n`).toBe(await readFile(join(fixtures, 'telemetry-report.expected.json'), 'utf8'));
    expect(renderTelemetryMarkdown(report)).toBe(await readFile(join(fixtures, 'telemetry-report.expected.md'), 'utf8'));
    expect('enrollments' in report).toBe(false);
  });

  it('splits an enrolled job at its cutover into before and after windows with queue latency', async () => {
    const report = aggregateTelemetry([await fixtureSnapshot()], SINCE, registry([
      enrollment({}),
      enrollment({ id: 'P2', repository: 'juan294/private-two', repositoryId: 1002, workflowId: 502, jobKey: 'test', jobNames: ['test'], status: 'proposed', after: null }),
    ]));
    expect(report.enrollments).toEqual([
      {
        id: 'P1', repository: 'juan294/private-one', workflowName: 'CI', jobNames: ['check'], status: 'cut-over', cutoverAt: '2026-09-17T12:00:00.000Z',
        before: { jobs: 2, hostedJobs: 2, hostedMinutes: 5, hostedListCostUsd: 0.03 },
        after: {
          jobs: 3, hostedJobs: 1, hostedMinutes: 2, hostedListCostUsd: 0.012,
          cirujanoJobs: 2, cirujanoMinutes: 6, grossHostedCostAvoidedUsd: 0.036,
          queueLatencySamples: 2, queueLatencyP50Ms: 90_000, queueLatencyP95Ms: 300_000,
        },
        nebiusComputeUsd: null, nebiusDiskUsd: null, nebiusTotalUsd: null, netSavingsUsd: null,
      },
      {
        id: 'P2', repository: 'juan294/private-two', workflowName: 'CI', jobNames: ['test'], status: 'proposed', cutoverAt: null,
        before: { jobs: 1, hostedJobs: 1, hostedMinutes: 6, hostedListCostUsd: 0.036 },
        after: {
          jobs: 0, hostedJobs: 0, hostedMinutes: 0, hostedListCostUsd: 0,
          cirujanoJobs: 0, cirujanoMinutes: 0, grossHostedCostAvoidedUsd: 0,
          queueLatencySamples: 0, queueLatencyP50Ms: null, queueLatencyP95Ms: null,
        },
        nebiusComputeUsd: null, nebiusDiskUsd: null, nebiusTotalUsd: null, netSavingsUsd: null,
      },
    ]);
    // The unrelated Release workflow and the other repositories never leak into an enrollment row.
    expect(report.byRepository.find(({ repository }) => repository === 'juan294/private-one')?.jobs).toBe(6);
    expect(report.githubHostedListCostUsd).toBe(0.09);
  });

  it('renders the enrollment table only when a registry is supplied', async () => {
    const snapshot = await fixtureSnapshot();
    const markdown = renderTelemetryMarkdown(aggregateTelemetry([snapshot], SINCE, registry([enrollment({})])));
    expect(markdown).toContain('## Enrollments');
    expect(markdown).toContain('| P1 | `juan294/private-one` | CI / check | cut-over | 2 | 5 | $0.030 | 3 | 1 | 2 | 6 | $0.036 | 1.5 min | 5.0 min | n/a | n/a |');
    expect(markdown).toContain('Queue latency is job start minus run creation for Cirujano jobs after the cutover');
    expect(renderTelemetryMarkdown(aggregateTelemetry([snapshot], SINCE))).not.toContain('## Enrollments');
  });

  it('credits nothing to a labelled job without a cirujano- runner name and matches job names exactly', async () => {
    const snapshot = await fixtureSnapshot();
    const stray = snapshot.jobs.find(({ jobId }) => jobId === 1003)!;
    stray.runnerName = 'someone-else';
    stray.runnerKind = 'self-hosted';
    stray.counterfactualHostedCostUsd = 0;
    stray.actualGithubListCostUsd = 0;
    const report = aggregateTelemetry([snapshot], SINCE, registry([enrollment({ jobNames: ['check', 'Check'] })]));
    expect(report.enrollments?.[0]?.after).toMatchObject({ jobs: 3, cirujanoJobs: 1, cirujanoMinutes: 3, grossHostedCostAvoidedUsd: 0.018, queueLatencySamples: 1 });
  });
});
