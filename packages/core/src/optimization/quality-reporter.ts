import { isAbsolute, relative, resolve } from 'node:path';
import { canonicalJson, jsonDigest, OptimizationInputError, safeRelativePath } from './canonical.js';
import { decodeQualityEvidence, decodeVerificationProfile, type CoverageCounters, type QualityEvidence, type VerificationProfile } from './contracts.js';

type RecordValue = Record<string, unknown>;
function fail(message: string): never { throw new OptimizationInputError(`Invalid quality report: ${message}`); }
function object(value: unknown): RecordValue { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected object'); return value as RecordValue; }
function array(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > 10000) fail('expected bounded array'); return value; }
function count(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('invalid count'); return value; }
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 4096 || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid text'); return value; }
function exactKeys(left: RecordValue, right: RecordValue): void { if (canonicalJson(Object.keys(left).sort()) !== canonicalJson(Object.keys(right).sort())) fail('counter/map key mismatch'); }
function safeSource(path: string): string { safeRelativePath(path); if (/[:*?\[\]{}]/.test(path)) fail('nonliteral source path'); if (path.split('/').some(part => /^(?:\.git|\.ssh|\.aws|\.env(?:\..*)?|\.npmrc|\.pnpmfile\.cjs|credentials(?:\..*)?)$/i.test(part))) fail('sensitive path'); return path; }
function reportPath(value: unknown, workspace: string): string {
  const path = text(value);
  if (!isAbsolute(path) || path.includes('\\') || path.split('/').some(part => part === '.' || part === '..') || resolve(path) !== path) fail('noncanonical absolute report path');
  return safeSource(relative(workspace, path));
}
function location(value: unknown, unknownEndColumn = false): number {
  const loc = object(value), start = object(loc.start), end = object(loc.end);
  const line = count(start.line), column = count(start.column), endLine = count(end.line), endColumn = unknownEndColumn && end.column === null ? null : count(end.column);
  if (!line || !endLine || endLine < line || (endLine === line && endColumn !== null && endColumn < column)) fail('invalid coverage location');
  return line;
}

/** Convert the supported real Vitest JSON + Istanbul coverage-final formats only. */
export function normalizeQualityReports(vitest: unknown, coverage: unknown, suppliedProfile: VerificationProfile, workspace: string): QualityEvidence {
  if (!isAbsolute(workspace) || resolve(workspace) !== workspace || workspace === '/' || workspace.includes('\\') || workspace.split('/').some(part => part === '.' || part === '..')) fail('invalid workspace');
  for (const value of [vitest, coverage]) if (Buffer.byteLength(canonicalJson(value)) > 16 * 1024 * 1024) fail('report byte bound');
  const profile = decodeVerificationProfile(suppliedProfile);
  if (!profile.sourcePaths.length || profile.commands.some(command => command[0] === 'pnpm' && command[1] === 'install')) fail('empty source inventory or duplicate install');
  const expectedPaths = profile.sourcePaths.map(safeSource).sort();
  const root = object(vitest); const suites = array(root.testResults);
  const tests: QualityEvidence['tests'] = []; const ids = new Set<string>();
  const observed = { passed: 0, failed: 0, pending: 0, todo: 0 };
  if (!suites.length) fail('empty test suites');
  for (const value of suites) {
    const suite = object(value); const path = reportPath(suite.name, workspace);
    const assertions = array(suite.assertionResults); if (!assertions.length) fail('empty assertions');
    for (const entry of assertions) {
      const assertion = object(entry); const name = text(assertion.fullName); const status = assertion.status;
      if (!['passed', 'failed', 'pending', 'skipped', 'todo'].includes(String(status))) fail('unknown assertion status');
      const id = `${path}::${name}`; if (ids.has(id)) fail('duplicate test ID'); ids.add(id);
      const outcome = status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'skipped';
      tests.push({ id, outcome });
      observed[status === 'skipped' || status === 'pending' ? 'pending' : status as 'passed' | 'failed' | 'todo']++;
    }
  }
  if (count(root.numTotalTests) !== tests.length || count(root.numPassedTests) !== observed.passed || count(root.numFailedTests) !== observed.failed || count(root.numPendingTests) !== observed.pending || count(root.numTodoTests) !== observed.todo) fail('test summary mismatch');
  if (typeof root.success !== 'boolean' || root.success !== (observed.failed === 0)) fail('success summary mismatch');
  // Vitest counts suites according to nested describe blocks, rather than files.
  const totalSuites = count(root.numTotalTestSuites);
  if (totalSuites < suites.length || count(root.numPassedTestSuites) + count(root.numFailedTestSuites) + count(root.numPendingTestSuites) !== totalSuites) fail('suite summary mismatch');
  let map = object(coverage);
  if (Object.hasOwn(map, 'coverageMap')) { if (Object.keys(map).length !== 1) fail('unsupported coverage wrapper'); map = object(map.coverageMap); }
  const results: CoverageCounters[] = [];
  for (const [key, value] of Object.entries(map)) {
    const path = reportPath(key, workspace); const file = object(value);
    if (reportPath(file.path, workspace) !== path) fail('coverage path drift');
    const allowed = ['path', 'statementMap', 'fnMap', 'branchMap', 's', 'f', 'b', 'meta', '_coverageSchema', 'hash', 'all'];
    if (Object.keys(file).some(field => !allowed.includes(field))) fail('unsupported coverage field');
    const statements = object(file.s), functions = object(file.f), branches = object(file.b);
    const statementMap = object(file.statementMap), fnMap = object(file.fnMap), branchMap = object(file.branchMap);
    exactKeys(statements, statementMap); exactKeys(functions, fnMap); exactKeys(branches, branchMap);
    if ([statements, functions, branches].some(counters => Object.keys(counters).length > 10000 || Object.keys(counters).some(id => !/^(?:0|[1-9]\d*)$/.test(id)))) fail('invalid coverage counter identity');
    const lineHits = new Map<number, number>();
    let coveredStatements = 0, coveredFunctions = 0, branchCount = 0, coveredBranches = 0;
    for (const [id, value] of Object.entries(statements)) { const hit = count(value); const line = location(statementMap[id]); lineHits.set(line, Math.max(lineHits.get(line) ?? 0, hit)); if (hit > 0) coveredStatements++; }
    for (const [id, value] of Object.entries(functions)) { location(object(fnMap[id]).loc, true); if (count(value) > 0) coveredFunctions++; }
    for (const [id, value] of Object.entries(branches)) {
      const hits = array(value); const metadata = object(branchMap[id]); const locations = array(metadata.locations);
      if (!hits.length || hits.length !== locations.length) fail('branch denominator mismatch');
      location(metadata.loc);
      for (const value of locations) {
        const branch = object(value), start = object(branch.start), end = object(branch.end);
        // Istanbul represents the implicit else branch with two empty positions.
        if (Object.keys(branch).sort().join(',') === 'end,start' && Object.keys(start).length === 0 && Object.keys(end).length === 0) continue;
        location(branch);
      }
      branchCount += hits.length; coveredBranches += hits.filter(hit => count(hit) > 0).length;
    }
    results.push({ path, statements: Object.keys(statements).length, coveredStatements, branches: branchCount, coveredBranches, functions: Object.keys(functions).length, coveredFunctions, lines: lineHits.size, coveredLines: [...lineHits.values()].filter(hit => hit > 0).length });
  }
  results.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (canonicalJson(results.map(file => file.path)) !== canonicalJson(expectedPaths)) fail('source inventory mismatch');
  tests.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return decodeQualityEvidence({ commandDigest: jsonDigest([['pnpm', 'install', '--frozen-lockfile'], ...profile.commands]), tests, coverage: results });
}
