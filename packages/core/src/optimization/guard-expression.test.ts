import { describe, expect, it } from 'vitest';
import { conditionExpression, evaluateExpression, isTruthy, parseExpression, usesStatusFunction } from './guard-expression.js';
import { guardExpression } from './push-guard.js';
import type { EvaluationContext } from './guard-expression.js';

const clean: EvaluationContext['status'] = { success: true, failure: false, cancelled: false };
const evaluate = (text: string, contexts: Record<string, unknown> = {}, status = clean) => evaluateExpression(parseExpression(text), { contexts, status });

// Documented examples: https://docs.github.com/en/actions/reference/workflows-and-actions/expressions
// (retrieved 2026-10-08): literals, the operator table, loose equality and the status check functions.
describe('GitHub Actions expression reference examples', () => {
  it('evaluates the documented literals', () => {
    expect(evaluate('null')).toBeNull();
    expect(evaluate('true')).toBe(true);
    expect(evaluate('false')).toBe(false);
    expect(evaluate('711')).toBe(711);
    expect(evaluate('-9.2')).toBe(-9.2);
    expect(evaluate('0xff')).toBe(255);
    expect(evaluate('-2.99e-2')).toBe(-0.0299);
    expect(evaluate("'Mona the Octocat'")).toBe('Mona the Octocat');
    expect(evaluate("'It''s open source!'")).toBe("It's open source!");
  });
  it('rejects double-quoted strings, as documented', () => expect(() => parseExpression('"push"')).toThrow());
  it('coerces mismatched types to numbers for loose equality', () => {
    expect(evaluate('null == 0')).toBe(true);
    expect(evaluate('true == 1')).toBe(true);
    expect(evaluate('false == 0')).toBe(true);
    expect(evaluate("'' == 0")).toBe(true);
    expect(evaluate("'12' == 12")).toBe(true);
    expect(evaluate("'1e1' == 10")).toBe(true);
    expect(evaluate("'twelve' == 12")).toBe(false);
    expect(evaluate("'abc' != 1")).toBe(true);
    expect(evaluate('a == 0', { a: [] })).toBe(false);
    expect(evaluate('a == 0', { a: {} })).toBe(false);
  });
  it('ignores case when comparing strings and compares objects by instance', () => {
    expect(evaluate("'SUCCESS' == 'success'")).toBe(true);
    expect(evaluate("'abc' < 'ABD'")).toBe(true);
    const shared = { x: 1 };
    expect(evaluate('a == b', { a: shared, b: shared })).toBe(true);
    expect(evaluate('a == b', { a: { x: 1 }, b: { x: 1 } })).toBe(false);
  });
  it('returns false for every relational comparison with NaN', () => {
    for (const operator of ['<', '<=', '>', '>=']) expect(evaluate(`'nan' ${operator} 1`)).toBe(false);
    expect(evaluate('2 > 1')).toBe(true);
    expect(evaluate('1 >= 1')).toBe(true);
    expect(evaluate("'2' < 10")).toBe(true);
  });
  it('treats only the documented falsy values as false', () => {
    for (const value of [false, 0, -0, '', null]) expect(isTruthy(value)).toBe(false);
    for (const value of [true, 1, -1, 'false', '0', {}, []]) expect(isTruthy(value)).toBe(true);
  });
  it('returns operands from && and || and negates with !', () => {
    expect(evaluate("x && 'yes' || 'no'", { x: true })).toBe('yes');
    expect(evaluate("x && 'yes' || 'no'", { x: '' })).toBe('no');
    expect(evaluate("'' || 0")).toBe(0);
    expect(evaluate("!''")).toBe(true);
    expect(evaluate('!(1 == 1)')).toBe(false);
  });
  it('de-references properties and indexes case-insensitively and yields null for missing paths', () => {
    const contexts = { needs: { build: { result: 'success', outputs: { validated: 'true' } } }, list: ['a', 'b'] };
    expect(evaluate('needs.build.result', contexts)).toBe('success');
    expect(evaluate('NEEDS.Build.Outputs.VALIDATED', contexts)).toBe('true');
    expect(evaluate("needs['build'].result", contexts)).toBe('success');
    expect(evaluate('list[1]', contexts)).toBe('b');
    expect(evaluate('needs.missing.result', contexts)).toBeNull();
    expect(evaluate('needs.build.result.deeper', contexts)).toBeNull();
    expect(evaluate('needs.my-job.result', { needs: { 'my-job': { result: 'failure' } } })).toBe('failure');
  });
  it('evaluates the documented status check functions', () => {
    expect(evaluate('success()')).toBe(true);
    expect(evaluate('always()', {}, { success: false, failure: false, cancelled: true })).toBe(true);
    expect(evaluate('cancelled()', {}, { success: false, failure: false, cancelled: true })).toBe(true);
    expect(evaluate('failure()', {}, { success: false, failure: true, cancelled: false })).toBe(true);
    expect(evaluate("failure() && steps.demo.conclusion == 'failure'", { steps: { demo: { conclusion: 'failure' } } }, { success: false, failure: true, cancelled: false })).toBe(true);
    expect(() => evaluate('success(1)')).toThrow();
  });
  it('parses other functions for detection but never evaluates them', () => {
    expect(() => parseExpression("contains(fromJSON('[\"push\", \"pull_request\"]'), github.event_name)")).not.toThrow();
    expect(() => evaluate("contains('abc', 'a')")).toThrow();
  });
  it('rejects syntax outside the supported grammar', () => {
    for (const text of ['', 'a ==', '(a', 'a)', 'a = b', 'a.*.b', 'a +1', "'unterminated", 'a b', '1 2', 'needs.', '[1]']) expect(() => parseExpression(text), text).toThrow();
  });
});

describe('job conditions', () => {
  it('reads if: values with and without ${{ }}, and YAML scalars', () => {
    expect(evaluateExpression(conditionExpression("${{ github.repository == 'a/b' }}"), { contexts: { github: { repository: 'A/B' } }, status: clean })).toBe(true);
    expect(evaluateExpression(conditionExpression("github.repository == 'a/b'"), { contexts: { github: { repository: 'x/y' } }, status: clean })).toBe(false);
    expect(evaluateExpression(conditionExpression(false), { contexts: {}, status: clean })).toBe(false);
    for (const value of ["${{ a }} && ${{ b }}", "prefix ${{ a }}", null, {}, []]) expect(() => conditionExpression(value)).toThrow();
  });
  it('detects status functions anywhere in an original condition', () => {
    for (const text of ['always()', "!cancelled() && x == 'y'", "x || failure()", "(SUCCESS())"]) expect(usesStatusFunction(conditionExpression(text)), text).toBe(true);
    for (const text of ["x == 'success'", "contains(x, 'always()')", 'steps.always.result']) expect(usesStatusFunction(conditionExpression(text)), text).toBe(false);
  });
});

type Result = 'success' | 'failure' | 'skipped' | 'cancelled';
const classifierStates = [{ name: 'skipped', result: 'skipped', validated: '' }, { name: 'success+true', result: 'success', validated: 'true' }, { name: 'success+false', result: 'success', validated: 'false' }, { name: 'failure', result: 'failure', validated: '' }, { name: 'cancelled', result: 'cancelled', validated: '' }, { name: 'failure+true', result: 'failure', validated: 'true' }, { name: 'cancelled+true', result: 'cancelled', validated: 'true' }] as const;
const needResults: Result[] = ['success', 'failure', 'skipped', 'cancelled'];
function combinations(length: number): Result[][] { return length === 0 ? [[]] : combinations(length - 1).flatMap(rest => needResults.map(result => [...rest, result])); }
/** Modeled default GitHub semantics for a job with needs and a status-free `if`: run when nothing was cancelled, every need succeeded and the condition holds. */
function baseRuns(needs: Result[], original: boolean, runCancelled: boolean): boolean { return !runCancelled && needs.every(result => result === 'success') && original; }
function candidateRuns(needs: Result[], original: boolean | null, classifier: typeof classifierStates[number], runCancelled = false): boolean {
  const names = needs.map((_, index) => `job_${index}`);
  const contexts = { needs: { ...Object.fromEntries(names.map((name, index) => [name, { result: needs[index], outputs: {} }])), cirujano_validated_push: { result: classifier.result, outputs: classifier.validated ? { validated: classifier.validated } : {} } } };
  const text = guardExpression(names, original === null ? null : String(original));
  return isTruthy(evaluateExpression(parseExpression(text), { contexts, status: { success: !runCancelled && [...needs, classifier.result].every(result => result === 'success'), failure: [...needs, classifier.result].includes('failure'), cancelled: runCancelled } }));
}

describe('generated guard wrapper', () => {
  it('builds the planned wrapper text', () => {
    expect(guardExpression(['build', 'lint'], "github.repository == 'a/b'")).toBe("!cancelled() && needs.build.result == 'success' && needs.lint.result == 'success' && (needs.cirujano_validated_push.result != 'success' || needs.cirujano_validated_push.outputs.validated != 'true') && (github.repository == 'a/b')");
    expect(guardExpression([], null)).toBe("!cancelled() && (needs.cirujano_validated_push.result != 'success' || needs.cirujano_validated_push.outputs.validated != 'true')");
    expect(() => guardExpression(['b', 'a'], null)).toThrow();
    expect(() => guardExpression(['cirujano_validated_push'], null)).toThrow();
    expect(() => guardExpression(["a') || always() || ('x"], null)).toThrow();
    expect(() => guardExpression(['a b'], null)).toThrow();
  });
  it('guard-classifier-failure-runs-full', () => {
    for (const length of [0, 1, 2]) for (const original of [true, null]) for (const classifier of [classifierStates[3], classifierStates[4], classifierStates[5], classifierStates[6]]) {
      expect(candidateRuns(Array<Result>(length).fill('success'), original, classifier, false), `${classifier.name}/${length}/${original}`).toBe(true);
    }
  });
  it('wrapper-equivalent-when-not-validated', () => {
    let cells = 0;
    for (const classifier of classifierStates) for (const length of [0, 1, 2]) for (const needs of combinations(length)) for (const original of [true, false]) for (const runCancelled of [false, true]) {
      const expected = classifier.name === 'success+true' ? false : baseRuns(needs, original, runCancelled);
      expect(candidateRuns(needs, original, classifier, runCancelled), `${classifier.name}/${needs.join(',') || 'no-needs'}/${original}/run-cancelled=${runCancelled}`).toBe(expected);
      cells++;
    }
    expect(cells).toBe(7 * (1 + 4 + 16) * 2 * 2);
  });
});
