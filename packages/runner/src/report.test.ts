import { describe, expect, it } from 'vitest';

import { buildRunnerReport, type RunnerReportInput } from './report.js';

const baseInput: RunnerReportInput = {
  candidateDigest: 'candidate-sha256',
  expectedCandidateDigest: 'candidate-sha256',
  requiredScenarios: ['R11', 'R12', 'R13'],
  checks: [
    { scenario: 'R11', status: 'passed', candidateDigest: 'candidate-sha256', evidence: ['local lifecycle passed'] },
    { scenario: 'R12', status: 'passed', candidateDigest: 'candidate-sha256', evidence: ['failure paths passed'] },
    { scenario: 'R13', status: 'passed', candidateDigest: 'candidate-sha256', evidence: ['report contract passed'] },
  ],
  assignments: [{ runId: 101, runAttempt: 2, jobId: 202, runnerId: 303, runnerName: 'cirujano-g1', conclusion: 'success' }],
  cleanup: { complete: true, vmState: 'absent', ownedRunnersRemaining: 0, diskPresent: false, unresolvedResources: [] },
  finalProviderState: 'absent',
  cost: {
    complete: true,
    currency: 'USD',
    computeUsd: 0.5,
    diskUsd: 0.1,
    networkUsd: 0,
    runnerTotalUsd: 0.6,
    hostedBaselineUsd: 1,
  },
  diagnostics: ['completed without secrets'],
};

describe('buildRunnerReport (R13)', () => {
  it('builds a versioned sanitized complete report with exact assignment and cleanup readback', () => {
    const report = buildRunnerReport(baseInput);

    expect(report).toMatchObject({
      schemaVersion: 1,
      complete: true,
      reasons: [],
      candidateDigest: 'candidate-sha256',
      assignments: [{ runId: 101, runAttempt: 2, jobId: 202, runnerId: 303, runnerName: 'cirujano-g1', conclusion: 'success' }],
      cleanup: { complete: true, vmState: 'absent', ownedRunnersRemaining: 0, diskPresent: false },
      finalProviderState: 'absent',
    });
  });

  it.each([
    ['missing cleanup', { cleanup: null }, 'cleanup readback is missing'],
    [
      'skipped required scenario',
      { checks: baseInput.checks.map((check) => check.scenario === 'R12' ? { ...check, status: 'skipped' as const } : check) },
      'required scenario R12 is skipped',
    ],
    ['mismatched candidate', { candidateDigest: 'other' }, 'candidate digest does not match the expected candidate'],
    ['zero passing checks', { requiredScenarios: [], checks: [] }, 'report has zero passing checks'],
    ['unknown final provider state', { finalProviderState: 'unknown' as const }, 'final provider state is unknown'],
  ])('fails completeness for %s', (_name, changes, reason) => {
    const report = buildRunnerReport({ ...baseInput, ...changes });

    expect(report.complete).toBe(false);
    expect(report.reasons).toContain(reason);
  });

  it('requires every required scenario exactly once on the report candidate', () => {
    const duplicate = baseInput.checks[0]!;
    const report = buildRunnerReport({
      ...baseInput,
      checks: [...baseInput.checks, duplicate, { ...baseInput.checks[1]!, candidateDigest: 'stale-candidate' }],
    });

    expect(report.complete).toBe(false);
    expect(report.reasons).toContain('required scenario R11 has duplicate results');
    expect(report.reasons).toContain('required scenario R12 has a mismatched candidate');
  });

  it('keeps incomplete cost unknown and rejects a silent zero total', () => {
    const unknown = buildRunnerReport({ ...baseInput, cost: { complete: false, reason: 'compute interval end is unknown' } });
    expect(unknown.complete).toBe(false);
    expect(unknown.cost).toEqual({ complete: false, reason: 'compute interval end is unknown' });
    expect(unknown.cost).not.toHaveProperty('runnerTotalUsd');

    const zero = buildRunnerReport({
      ...baseInput,
      cost: {
        complete: true,
        currency: 'USD',
        computeUsd: 0,
        diskUsd: 0,
        networkUsd: 0,
        runnerTotalUsd: 0,
        hostedBaselineUsd: 1,
      },
    });
    expect(zero.complete).toBe(false);
    expect(zero.reasons).toContain('cost estimate must not silently report a zero total');
  });

  it('redacts supplied secrets and common credential forms from diagnostics', () => {
    const report = buildRunnerReport({
      ...baseInput,
      diagnostics: ['token=ghs_secretvalue Authorization: Bearer bearer-value safe'],
      sensitiveValues: ['ghs_secretvalue'],
    });

    expect(report.diagnostics).toEqual(['token=[REDACTED] Authorization: Bearer [REDACTED] safe']);
    expect(JSON.stringify(report)).not.toContain('ghs_secretvalue');
    expect(JSON.stringify(report)).not.toContain('bearer-value');
  });

  it('fails cleanup when residue or an incomplete readback remains', () => {
    const report = buildRunnerReport({
      ...baseInput,
      cleanup: { complete: false, vmState: 'stopped', ownedRunnersRemaining: 1, diskPresent: true, unresolvedResources: ['vm-1'] },
    });

    expect(report.complete).toBe(false);
    expect(report.reasons).toEqual(expect.arrayContaining([
      'cleanup readback is incomplete',
      'cleanup left owned runners',
      'cleanup left an owned disk',
      'cleanup has unresolved resources',
    ]));
  });
});
