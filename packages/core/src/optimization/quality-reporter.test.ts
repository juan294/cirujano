import { afterAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { jsonDigest } from './canonical.js';
import { captureQualityFixture } from './quality-reporter.test-helper.js';
import { normalizeQualityReports } from './quality-reporter.js';

const fixture = captureQualityFixture();
afterAll(() => rmSync(fixture.workspace, { recursive: true, force: true }));
const normalize = (vitest: unknown = fixture.vitest, coverage: unknown = fixture.coverage) => normalizeQualityReports(vitest, coverage, fixture.profile, fixture.workspace);
describe('actual Vitest and Istanbul quality normalization', () => {
  it('retains every actual outcome, uncovered source and maximum hit on shared lines', () => {
    const evidence = normalize();
    expect(evidence.tests).toEqual([{ id: 'math.test.ts::adds', outcome: 'passed' }, { id: 'math.test.ts::future', outcome: 'skipped' }, { id: 'math.test.ts::skipped', outcome: 'skipped' }]);
    expect(evidence.commandDigest).toBe(jsonDigest([['pnpm', 'install', '--frozen-lockfile'], ...fixture.profile.commands]));
    expect(evidence.coverage).toEqual([{ path: 'src/math.ts', statements: 3, coveredStatements: 2, branches: 2, coveredBranches: 1, functions: 1, coveredFunctions: 1, lines: 1, coveredLines: 1 }, { path: 'src/uncovered.ts', statements: 1, coveredStatements: 0, branches: 0, coveredBranches: 0, functions: 1, coveredFunctions: 0, lines: 1, coveredLines: 0 }]);
    expect(normalize(fixture.vitest, { coverageMap: fixture.coverage })).toEqual(evidence);
  });
  it.each(['failed', 'pending', 'skipped', 'todo'])('preserves actual %s assertion status', status => {
    const v = structuredClone(fixture.vitest) as { testResults: { assertionResults: { status: string }[] }[]; numPassedTests: number; numFailedTests: number; numPendingTests: number; numTodoTests: number; success: boolean };
    v.testResults[0]!.assertionResults[0]!.status = status;
    v.numPassedTests = 0; if (status === 'failed') { v.numFailedTests = 1; v.success = false; } else if (status === 'todo') v.numTodoTests++; else v.numPendingTests++;
    expect(normalize(v).tests[0]!.outcome).toBe(status === 'failed' ? 'failed' : 'skipped');
  });
  it.each(['duplicate', 'missing-name', 'unknown-status', 'counter', 'hook-error', 'outside', 'traversal', 'sensitive'])('rejects mutated test identity or counters: %s', mutation => {
    const v = structuredClone(fixture.vitest) as { testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[]; numTotalTests: number; success: boolean };
    const suite = v.testResults[0]!;
    if (mutation === 'duplicate') suite.assertionResults.push(suite.assertionResults[0]!);
    if (mutation === 'missing-name') suite.assertionResults[0]!.fullName = '';
    if (mutation === 'unknown-status') suite.assertionResults[0]!.status = 'disabled';
    if (mutation === 'counter') v.numTotalTests++;
    if (mutation === 'hook-error') v.success = false;
    if (mutation === 'outside') suite.name = '/outside/math.test.ts';
    if (mutation === 'traversal') suite.name = `${fixture.workspace}/../math.test.ts`;
    if (mutation === 'sensitive') suite.name = `${fixture.workspace}/.env`;
    expect(() => normalize(v)).toThrow();
  });
  it.each(['missing-file', 'extra-file', 'counter-key', 'negative', 'nan', 'statement-map', 'branch-denominator', 'branch-location', 'branch-end', 'path-drift', 'line', 'wrapper'])('rejects coverage mutation: %s', mutation => {
    const c = structuredClone(fixture.coverage) as Record<string, { path: string; s: Record<string, number>; b: Record<string, number[]>; statementMap: Record<string, { start: { line: number } }>; branchMap: Record<string, { locations: unknown[] }> }>;
    const key = Object.keys(c)[0]!; const file = c[key]!;
    if (mutation === 'missing-file') delete c[key];
    if (mutation === 'extra-file') c[`${fixture.workspace}/src/extra.ts`] = file;
    if (mutation === 'counter-key') file.s.extra = 0;
    if (mutation === 'negative') file.s['0'] = -1;
    if (mutation === 'nan') file.s['0'] = NaN;
    if (mutation === 'statement-map') delete file.statementMap['0'];
    if (mutation === 'branch-denominator') file.b['0']!.push(0);
    if (mutation === 'branch-location') file.branchMap['0']!.locations[0] = null;
    if (mutation === 'branch-end') file.branchMap['0']!.locations[0] = { start: { line: 2, column: 0 }, end: { line: 1, column: 0 } };
    if (mutation === 'path-drift') file.path = `${fixture.workspace}/src/other.ts`;
    if (mutation === 'line') file.statementMap['0']!.start.line = 0;
    expect(() => normalize(fixture.vitest, mutation === 'wrapper' ? { coverageMap: c, injected: true } : c)).toThrow();
  });
  it('rejects unsupported relative workspace and glob inventory', () => {
    expect(() => normalizeQualityReports(fixture.vitest, fixture.coverage, fixture.profile, 'relative/workspace')).toThrow();
    expect(() => normalizeQualityReports(fixture.vitest, fixture.coverage, { ...fixture.profile, sourcePaths: ['src/*.ts'] }, fixture.workspace)).toThrow();
  });
  it('rejects empty inventory and duplicated install commands', () => {
    expect(() => normalizeQualityReports(fixture.vitest, fixture.coverage, { ...fixture.profile, sourcePaths: [] }, fixture.workspace)).toThrow();
    expect(() => normalizeQualityReports(fixture.vitest, fixture.coverage, { ...fixture.profile, commands: [['pnpm', 'install', '--frozen-lockfile']] }, fixture.workspace)).toThrow();
  });
});
