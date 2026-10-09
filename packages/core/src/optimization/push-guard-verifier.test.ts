import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jsonDigest, sha256 } from './canonical.js';
import { classifierCases, type ClassifierCase } from './push-classifier-cases.js';
import { CLASSIFIER_DIGEST } from './push-classifier.js';
import { createSkipValidatedPushPatch } from './push-patch.js';
import { buildPushGuardPayload, decodePushGuardPayload, guardMatrix, verifyPushGuards } from './push-guard-verifier.js';

const push = new URL('../../fixtures/optimization/push/', import.meta.url);
const workflowPath = '.github/workflows/ci.yml';
function guarded(file: string, branch: string) {
  const base = readFileSync(new URL(file, push), 'utf8');
  const result = createSkipValidatedPushPatch(base, { workflowHash: sha256(base), workflowPath, integrationBranch: branch, inventory: [{ path: workflowPath, source: base }] });
  return { base, candidate: result.candidate, operation: result.operation! };
}
const identity = { profileDigest: '1'.repeat(64), proposalDigest: '2'.repeat(64), toolSourceSha: '3'.repeat(40), bundleDigest: '4'.repeat(64), imageManifestHash: '5'.repeat(64), harnessHash: '6'.repeat(64) };
/** Runs a case's expected verdict, as a correct embedded script would. */
const faithful = async (_script: string, testCase: ClassifierCase) => testCase.expected;

describe('push guard decision matrix', () => {
  it('push-guard-matrix-pass: candidate equals base in every cell except a validated push, where every guarded job skips', () => {
    for (const [file, branch] of [['eligible-multi-job.yml', 'main'], ['eligible-matrix.yml', 'develop'], ['patch/shapes.yml', 'develop']] as const) {
      const { base, candidate, operation } = guarded(file, branch), matrix = guardMatrix(base, candidate, operation);
      expect(matrix.mismatches, file).toEqual([]); expect(matrix.cells).toBeGreaterThanOrEqual(22);
    }
  });
  it('counts the cells it checked, including the classifier condition per event', () => {
    const { base, candidate, operation } = guarded('eligible-matrix.yml', 'develop');
    // One guarded job without needs or condition: 10 classifier/event states x 2 cancellation states, plus 6 classifier-condition cells and 1 needs cell.
    expect(guardMatrix(base, candidate, operation).cells).toBe(10 * 2 + 6 + 1);
  });
  it.each([
    ['drop-cancelled', (guard: string) => guard.replace('!cancelled() && ', ''), /event=pull_request .*base=run candidate=skip/],
    ['drop-need-success', (guard: string) => guard.replace("needs.lint.result == 'success' && ", ''), /^test .*needs=lint:failure .*base=skip candidate=run/],
    ['invert-guard', (guard: string) => guard.replace("(needs.cirujano_validated_push.result != 'success' || needs.cirujano_validated_push.outputs.validated != 'true')", "(needs.cirujano_validated_push.result == 'success' && needs.cirujano_validated_push.outputs.validated == 'true')"), /event=push classifier=success\/false .*base=run candidate=skip/],
    ['drop-classifier-result', (guard: string) => guard.replace("needs.cirujano_validated_push.result != 'success' || ", ''), /event=push classifier=failure\/true .*base=run candidate=skip/],
    ['drop-original-condition', (guard: string) => guard.replace(" && (github.repository == 'public-example/benchmark')", ''), /^test .*original=false .*base=skip candidate=run/],
  ])('push-guard mutation %s is detected by a named matrix cell', (_name, mutate, cell) => {
    const { base, candidate, operation } = guarded('eligible-multi-job.yml', 'main');
    const testGuard = /( {4}if: )(".*needs\.lint\.result == 'success' && \(needs\.cirujano.*")/.exec(candidate)!;
    const mutated = candidate.replace(testGuard[2]!, JSON.stringify(mutate(JSON.parse(testGuard[2]!) as string)));
    expect(mutated).not.toBe(candidate);
    const { mismatches } = guardMatrix(base, mutated, operation);
    expect(mismatches.some(line => cell.test(line)), mismatches.slice(0, 3).join('\n')).toBe(true);
  });
  it('detects a candidate whose needs are not the original needs plus the classifier', () => {
    const { base, candidate, operation } = guarded('eligible-multi-job.yml', 'main');
    expect(guardMatrix(base, candidate.replace('needs: [lint, test, cirujano_validated_push]', 'needs: [lint, test]'), operation).mismatches).toContain('build needs: [lint,test] expected [lint,test,cirujano_validated_push]');
  });
  it('covers a job with more than five needs by varying each need alone', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'], jobs = ids.map(id => `  ${id}:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${id}\n`).join('');
    const base = `name: Wide\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\npermissions: read-all\njobs:\n${jobs}  wide:\n    needs: [${ids.join(', ')}]\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo wide\n`;
    const result = createSkipValidatedPushPatch(base, { workflowHash: sha256(base), workflowPath, integrationBranch: 'main', inventory: [{ path: workflowPath, source: base }] });
    expect(guardMatrix(base, result.candidate, result.operation!).mismatches).toEqual([]);
    const dropped = result.candidate.replace("needs.c.result == 'success' && ", '');
    expect(guardMatrix(base, dropped, result.operation!).mismatches.some(line => /^wide .*c:failure.*base=skip candidate=run/.test(line))).toBe(true);
  });
  it('detects a classifier job that would run outside a push to the integration branch', () => {
    const { base, candidate, operation } = guarded('eligible-matrix.yml', 'develop');
    const mutated = candidate.replace("if: github.event_name == 'push' && github.ref == 'refs/heads/develop'", "if: github.event_name == 'push'");
    expect(guardMatrix(base, mutated, operation).mismatches).toContain('cirujano_validated_push event=push ref=refs/heads/other: runs=true expected=false');
  });
});

describe('push guard verifier', () => {
  const payloadFor = (file = 'eligible-multi-job.yml', branch = 'main') => { const { base, candidate, operation } = guarded(file, branch); return buildPushGuardPayload({ ...identity, workflowPath, baseWorkflow: base, candidateWorkflow: candidate, operation, classifierDigest: CLASSIFIER_DIGEST, cases: classifierCases() }); };
  it('passes a correct candidate and reports cells, cases and digests', async () => {
    const payload = payloadFor(), result = await verifyPushGuards(decodePushGuardPayload(payload), faithful);
    expect(result).toMatchObject({ kind: 'push-guard-result', status: 'passed', failure: null, mismatchCount: 0, mismatches: [], classifierMismatchCount: 0, classifierMismatches: [], classifierCases: classifierCases().length, classifierDigest: CLASSIFIER_DIGEST, fixtureDigest: jsonDigest(classifierCases()), ...identity });
    expect(result.matrixCells).toBeGreaterThan(100);
  });
  it('push-guard-mismatch-disclosed: fails with the first mismatching cell and at most 20 listed', async () => {
    const payload = payloadFor(), test = /( {4}if: )(".*needs\.lint\.result == 'success' && \(needs\.cirujano.*")/.exec(payload.candidateWorkflow)!;
    const candidate = payload.candidateWorkflow.replace(test[2]!, JSON.stringify((JSON.parse(test[2]!) as string).replace('!cancelled() && ', '')));
    const result = await verifyPushGuards(decodePushGuardPayload({ ...payload, candidateWorkflow: candidate }), faithful);
    expect(result.status).toBe('failed'); expect(result.failure).toBe('inverse-mismatch');
    expect(result.mismatchCount).toBeGreaterThan(0); expect(result.mismatches.length).toBeLessThanOrEqual(20); expect(result.mismatches[0]).toMatch(/^test /);
  });
  it('push-guard-script-tamper: a changed embedded script fails on its digest and is never run', async () => {
    const payload = payloadFor(), candidate = payload.candidateWorkflow.replace("refuse('fork-pr')", "refuse('fork')");
    let runs = 0;
    const result = await verifyPushGuards(decodePushGuardPayload({ ...payload, candidateWorkflow: candidate }), async (_script, testCase) => { runs++; return testCase.expected; });
    expect(result).toMatchObject({ status: 'failed', failure: 'inverse-mismatch', classifierCases: 0, classifierMismatchCount: 0 });
    expect(result.classifierDigest).not.toBe(CLASSIFIER_DIGEST); expect(runs).toBe(0);
  });
  it('counts every classifier mismatch though it lists at most 20', async () => {
    const result = await verifyPushGuards(decodePushGuardPayload(payloadFor()), async () => ({ validated: true, reasonCode: 'validated' }));
    expect(result.classifierMismatchCount).toBe(classifierCases().length - 2); expect(result.classifierMismatches).toHaveLength(20);
  });
  it('fails a classifier case that disagrees with its expected verdict', async () => {
    const result = await verifyPushGuards(decodePushGuardPayload(payloadFor()), async (_script, testCase) => testCase.name === 'tree-mismatch' ? { validated: true, reasonCode: 'validated' } : testCase.expected);
    expect(result).toMatchObject({ status: 'failed', failure: 'classifier-case-mismatch', classifierMismatchCount: 1, classifierMismatches: ['tree-mismatch: expected false/tree-mismatch, got true/validated'] });
  });
  it('rejects a payload whose fixtures do not match their digest, and malformed payloads', () => {
    const payload = payloadFor();
    expect(() => decodePushGuardPayload({ ...payload, fixtureDigest: '0'.repeat(64) })).toThrow('push-guard-payload');
    expect(() => decodePushGuardPayload({ ...payload, extra: true })).toThrow('push-guard-payload');
    expect(() => decodePushGuardPayload({ ...payload, cases: [] })).toThrow('push-guard-payload');
  });
});
