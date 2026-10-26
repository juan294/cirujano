import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256 } from './canonical.js';
import { evaluateExpression, conditionExpression } from './guard-expression.js';
import { CLASSIFIER_DIGEST, CLASSIFIER_SOURCE } from './push-classifier.js';
import { CLASSIFIER_JOB_ID, guardExpression } from './push-guard.js';
import { classifierJob, createSkipValidatedPushPatch, extractClassifierScript, inspectRenderablePushWorkflow, validateGuardOnlyChange } from './push-patch.js';
import { inspectPushWorkflow } from './push-workflow.js';
import { parseWorkflowSource } from './workflow.js';

const push = new URL('../../fixtures/optimization/push/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, push), 'utf8');
const workflowPath = '.github/workflows/ci.yml';
const fixtures = [
  { name: 'eligible-multi-job', file: 'eligible-multi-job.yml', branch: 'main' },
  { name: 'eligible-matrix', file: 'eligible-matrix.yml', branch: 'develop' },
  { name: 'shapes', file: 'patch/shapes.yml', branch: 'develop' },
];
const evidence = (source: string, branch: string) => ({ workflowHash: sha256(source), workflowPath, integrationBranch: branch, inventory: [{ path: workflowPath, source }] });
type Jobs = Record<string, Record<string, unknown>>;
const jobsOf = (source: string) => parseWorkflowSource(source).jobs as Jobs;
const list = (value: unknown) => Array.isArray(value) ? value as string[] : value === undefined ? [] : [value as string];
/** Each job's original condition, written out by hand so the guard check does not reuse the implementation's parsing. */
const originals: Record<string, Record<string, string | null>> = {
  'eligible-multi-job': { lint: null, test: "github.repository == 'public-example/benchmark'", build: null },
  'eligible-matrix': { test: null },
  shapes: { lint: null, unit: "github.repository_owner == 'public-example'", package: "github.repository != ''" },
};
function applyPatch(source: string, patch: string): string {
  const root = mkdtempSync(join(tmpdir(), 'cirujano-push-patch-'));
  try {
    mkdirSync(join(root, '.github/workflows'), { recursive: true }); writeFileSync(join(root, workflowPath), source); writeFileSync(join(root, 'candidate.patch'), patch);
    execFileSync('git', ['apply', '--check', 'candidate.patch'], { cwd: root }); execFileSync('git', ['apply', 'candidate.patch'], { cwd: root });
    return readFileSync(join(root, workflowPath), 'utf8');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('skip-validated-push patch', () => {
  for (const fixture of fixtures) {
    it(`push-patch-inverse: ${fixture.name} changes only the classifier job, guards and needs`, () => {
      const source = read(fixture.file), result = createSkipValidatedPushPatch(source, evidence(source, fixture.branch));
      expect(result.status).toBe('proposed');
      const before = jobsOf(source), after = jobsOf(result.candidate), operation = result.operation!;
      expect(operation.guardedJobIds).toEqual(Object.keys(before).sort());
      expect(after[CLASSIFIER_JOB_ID]).toEqual(classifierJob(fixture.branch));
      for (const id of operation.guardedJobIds) {
        const needs = list(before[id]!.needs);
        expect(after[id]!.if).toBe(`\${{ ${guardExpression([...needs].sort(), originals[fixture.name]![id]!)} }}`);
        expect(after[id]!.needs).toEqual([...needs, CLASSIFIER_JOB_ID]);
      }
      // Unwrap: drop the classifier, restore each original `if` and `needs`, and the base tree returns.
      const unwrapped = structuredClone(after); delete unwrapped[CLASSIFIER_JOB_ID];
      for (const id of operation.guardedJobIds) {
        if ('if' in before[id]!) unwrapped[id]!.if = before[id]!.if; else delete unwrapped[id]!.if;
        if ('needs' in before[id]!) unwrapped[id]!.needs = before[id]!.needs; else delete unwrapped[id]!.needs;
      }
      expect(canonicalJson({ ...parseWorkflowSource(result.candidate), jobs: unwrapped })).toBe(canonicalJson(parseWorkflowSource(source)));
      expect(() => validateGuardOnlyChange(source, result.candidate, operation)).not.toThrow();
      expect(applyPatch(source, result.patch)).toBe(result.candidate);
      expect(result).toMatchObject({ beforeHash: sha256(source), afterHash: sha256(result.candidate) });
    });
    it(`push-patch-golden: ${fixture.name} candidate bytes`, () => {
      const source = read(fixture.file), result = createSkipValidatedPushPatch(source, evidence(source, fixture.branch));
      const indented = CLASSIFIER_SOURCE.slice(0, -1).split('\n').map(line => line ? `          ${line}` : '').join('\n');
      expect(result.candidate).toBe(read(`patch/golden/${fixture.name}.yml`).replace('          __CLASSIFIER_SCRIPT__', indented));
    });
    it(`push-patch-idempotent-no-change: ${fixture.name} candidate is already guarded`, () => {
      const source = read(fixture.file), candidate = createSkipValidatedPushPatch(source, evidence(source, fixture.branch)).candidate;
      expect(inspectPushWorkflow(candidate, evidence(candidate, fixture.branch))).toMatchObject({ status: 'no-change', reason: 'already-guarded' });
      expect(createSkipValidatedPushPatch(candidate, evidence(candidate, fixture.branch))).toMatchObject({ status: 'no-change', candidate, patch: '', operation: null, beforeHash: sha256(candidate), afterHash: sha256(candidate) });
    });
  }
  it('classifier-template-embedded-verbatim: the extracted script is the digested step script', () => {
    const source = read('eligible-matrix.yml'), { candidate } = createSkipValidatedPushPatch(source, evidence(source, 'develop'));
    const script = extractClassifierScript(candidate);
    expect(script).toBe(CLASSIFIER_SOURCE); expect(sha256(script)).toBe(CLASSIFIER_DIGEST);
    expect(() => extractClassifierScript(candidate.replace("refuse('fork-pr')", "refuse('fork')"))).not.toThrow();
    expect(sha256(extractClassifierScript(candidate.replace("refuse('fork-pr')", "refuse('fork')")))).not.toBe(CLASSIFIER_DIGEST);
    expect(() => extractClassifierScript(source)).toThrow('push-patch-classifier-script-missing');
  });
  it('runs the generated step under bash -e, exits 0 and writes validated=false without a token', () => {
    const source = read('eligible-matrix.yml'), { candidate } = createSkipValidatedPushPatch(source, evidence(source, 'develop'));
    const step = (jobsOf(candidate)[CLASSIFIER_JOB_ID]!.steps as { run: string }[])[0]!, root = mkdtempSync(join(tmpdir(), 'cirujano-push-step-'));
    try {
      const output = join(root, 'output'); writeFileSync(output, '');
      execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run], { env: { PATH: process.env['PATH'] ?? '', GITHUB_OUTPUT: output }, stdio: 'pipe' });
      expect(readFileSync(output, 'utf8')).toBe('validated=false\nreason=invalid-context\n');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('push-patch-matrix-job: a matrix job is guarded at the job level and its strategy is untouched', () => {
    const source = read('eligible-matrix.yml'), result = createSkipValidatedPushPatch(source, evidence(source, 'develop'));
    expect(jobsOf(result.candidate).test).toMatchObject({ strategy: jobsOf(source).test!.strategy, needs: [CLASSIFIER_JOB_ID] });
  });
  it('writes guards that evaluate to skip only on a validated push', () => {
    const source = read('eligible-multi-job.yml'), after = jobsOf(createSkipValidatedPushPatch(source, evidence(source, 'main')).candidate);
    const context = (validated: string, classifier = 'success') => ({ contexts: { github: { repository: 'public-example/benchmark' }, needs: { lint: { result: 'success' }, test: { result: 'success' }, [CLASSIFIER_JOB_ID]: { result: classifier, outputs: { validated } } } }, status: { success: true, failure: false, cancelled: false } });
    for (const id of ['lint', 'test', 'build']) {
      const guard = conditionExpression(after[id]!.if);
      expect(evaluateExpression(guard, context('true'))).toBe(false);
      expect(evaluateExpression(guard, context('false'))).toBe(true);
      expect(evaluateExpression(guard, context('true', 'failure'))).toBe(true);
    }
  });
  it.each([
    ['changed-command', (candidate: string) => candidate.replace('pnpm test', 'pnpm test --skip')],
    ['changed-runner', (candidate: string) => candidate.replace('runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955\n      - run: pnpm lint', 'runs-on: ubuntu-22.04\n    steps:\n      - uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955\n      - run: pnpm lint')],
    ['dropped-cancel-guard', (candidate: string) => candidate.replace('"${{ !cancelled() && ', '"${{ ')],
    ['classifier-timeout', (candidate: string) => candidate.replace('timeout-minutes: 2', 'timeout-minutes: 30')],
    ['classifier-permission', (candidate: string) => candidate.replace('      contents: read\n      pull-requests: read', '      contents: write\n      pull-requests: read')],
    ['tampered-script', (candidate: string) => candidate.replace("refuse('fork-pr')", "refuse('fork')")],
    ['extra-job', (candidate: string) => `${candidate}  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo extra\n`],
    ['reformatted-only', (candidate: string) => candidate.replace('    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955\n      - run: pnpm lint', '    runs-on: "ubuntu-latest"\n    steps:\n      - uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955\n      - run: pnpm lint')],
  ])('push-patch-rejects-extra-edit: %s', (_name, mutate) => {
    const source = read('eligible-multi-job.yml'), result = createSkipValidatedPushPatch(source, evidence(source, 'main')), mutated = mutate(result.candidate);
    expect(mutated).not.toBe(result.candidate);
    expect(() => validateGuardOnlyChange(source, mutated, result.operation!)).toThrow(/^push-patch-protected-/);
  });
  it('writes a block needs list at the key indentation as a valid flow list', () => {
    const source = read('patch/shapes.yml').replace('    needs:\n      - lint # unit waits for lint\n', '    needs:\n    - lint\n'), result = createSkipValidatedPushPatch(source, evidence(source, 'develop'));
    expect(jobsOf(result.candidate).unit!.needs).toEqual(['lint', CLASSIFIER_JOB_ID]);
    expect(applyPatch(source, result.patch)).toBe(result.candidate);
  });
  it('keeps a deeply indented comment above the first job out of the classifier script', () => {
    const source = read('patch/shapes.yml').replace('  # Lint has no dependencies.\n', '            # deep note\n  # Lint has no dependencies.\n'), result = createSkipValidatedPushPatch(source, evidence(source, 'develop'));
    expect(extractClassifierScript(result.candidate)).toBe(CLASSIFIER_SOURCE);
  });
  it('rejects an operation pinned to another branch than the workflow triggers on', () => {
    const source = read('eligible-multi-job.yml'), result = createSkipValidatedPushPatch(source, evidence(source, 'main'));
    expect(() => validateGuardOnlyChange(source, result.candidate, { ...result.operation!, integrationBranch: 'develop' })).toThrow('push-patch-operation-mismatch');
    expect(() => validateGuardOnlyChange(source, result.candidate, { ...result.operation!, integrationBranch: "main' || true || '" })).toThrow('push-patch-operation-mismatch');
  });
  it('rejects an operation that does not guard every job', () => {
    const source = read('eligible-multi-job.yml'), result = createSkipValidatedPushPatch(source, evidence(source, 'main'));
    expect(() => validateGuardOnlyChange(source, result.candidate, { ...result.operation!, guardedJobIds: ['lint', 'test'] })).toThrow('push-patch-operation-mismatch');
  });
  it.each(['crlf', 'no-final-newline'])('preserves %s format and applies with real git', format => {
    const base = read('patch/shapes.yml'), source = format === 'crlf' ? base.replaceAll('\n', '\r\n') : base.trimEnd();
    const result = createSkipValidatedPushPatch(source, evidence(source, 'develop'));
    expect(applyPatch(source, result.patch)).toBe(result.candidate);
    expect(extractClassifierScript(result.candidate)).toBe(CLASSIFIER_SOURCE);
    if (format === 'crlf') expect(result.candidate.replaceAll('\r\n', '').includes('\n')).toBe(false);
    else expect(result.candidate.endsWith('pnpm pack')).toBe(true);
  });
  it.each([
    ['flow-job', (source: string) => source.replace('  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm lint\n', '  lint: {runs-on: ubuntu-latest, steps: [{run: pnpm lint}]}\n'), 'push-patch-unsupported-map-format'],
    ['ineligible', (source: string) => source.replace('permissions: read-all', 'permissions: write-all'), 'push-patch-permissions-not-read-only'],
    ['mixed-newlines', (source: string) => source.replace('name: Shapes\n', 'name: Shapes\r\n'), 'push-patch-mixed-newlines'],
  ])('refuses %s without a candidate', (_name, mutate, reason) => {
    const source = mutate(read('patch/shapes.yml'));
    expect(() => createSkipValidatedPushPatch(source, evidence(source, 'develop'))).toThrow(reason);
  });
  it('marks an eligible workflow the patch cannot render as unsupported before any inference', () => {
    const shapes = read('patch/shapes.yml');
    expect(inspectRenderablePushWorkflow(shapes, evidence(shapes, 'develop'))).toEqual(inspectPushWorkflow(shapes, evidence(shapes, 'develop')));
    for (const source of [shapes.replace('  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm lint\n', '  lint: {runs-on: ubuntu-latest, steps: [{run: pnpm lint}]}\n'), shapes.replace('name: Shapes\n', 'name: Shapes\r\n')]) {
      expect(inspectPushWorkflow(source, evidence(source, 'develop')).status).toBe('eligible');
      expect(inspectRenderablePushWorkflow(source, evidence(source, 'develop'))).toEqual({ status: 'unsupported', reason: 'unrenderable-workflow', operations: [], protectedDigest: null, structuralFacts: {} });
    }
  });
  it('refuses a workflow path outside the literal workflow directory', () => {
    const source = read('patch/shapes.yml');
    expect(() => createSkipValidatedPushPatch(source, { ...evidence(source, 'develop'), workflowPath: '.github/workflows/nested/ci.yml' })).toThrow('push-patch-unsupported-workflow-path');
  });
});
