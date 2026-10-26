import { canonicalJson, jsonDigest, OptimizationInputError, sha256 } from './canonical.js';
import { conditionExpression, evaluateExpression, isTruthy, usesStatusFunction, type ExpressionNode } from './guard-expression.js';
import type { ClassifierCase } from './push-classifier-cases.js';
import type { PushOperation } from './push-contracts.js';
import { CLASSIFIER_JOB_ID } from './push-guard.js';
import { extractClassifierScript, validateGuardOnlyChange } from './push-patch.js';
import { list } from './push-workflow.js';
import { parseWorkflowSource } from './workflow.js';

/** What the Sandbox verifier receives: both workflows, the operation, and the Phase 3 classifier cases as data. */
export interface PushGuardPayload {
  schemaVersion: 1; kind: 'push-guard-payload'; profileDigest: string; proposalDigest: string; toolSourceSha: string; bundleDigest: string; imageManifestHash: string; harnessHash: string;
  classifierDigest: string; workflowPath: string; baseWorkflow: string; candidateWorkflow: string; operation: PushOperation; cases: ClassifierCase[]; fixtureDigest: string;
}
export interface PushGuardResult {
  schemaVersion: 1; kind: 'push-guard-result'; profileDigest: string; proposalDigest: string; toolSourceSha: string; bundleDigest: string; imageManifestHash: string; harnessHash: string;
  /** `classifierCases` counts the cases actually run: none when the script fails its digest. */
  status: 'passed' | 'failed'; failure: string | null; matrixCells: number; mismatchCount: number; mismatches: string[]; classifierCases: number; classifierMismatchCount: number; classifierMismatches: string[]; classifierDigest: string | null; fixtureDigest: string;
}
export type ClassifierCaseRunner = (script: string, testCase: ClassifierCase) => Promise<{ validated: boolean; reasonCode: string }>;
const IDENTITY = ['profileDigest', 'proposalDigest', 'toolSourceSha', 'bundleDigest', 'imageManifestHash', 'harnessHash'] as const;
const LISTED = 20;

function invalid(): never { throw new OptimizationInputError('push-guard-payload'); }
export function buildPushGuardPayload(fields: Omit<PushGuardPayload, 'schemaVersion' | 'kind' | 'fixtureDigest'>): PushGuardPayload {
  return decodePushGuardPayload({ schemaVersion: 1, kind: 'push-guard-payload', ...fields, fixtureDigest: jsonDigest(fields.cases) });
}
export function decodePushGuardPayload(value: unknown): PushGuardPayload {
  canonicalJson(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const payload = value as PushGuardPayload;
  const keys = ['schemaVersion', 'kind', ...IDENTITY, 'classifierDigest', 'workflowPath', 'baseWorkflow', 'candidateWorkflow', 'operation', 'cases', 'fixtureDigest'];
  if (Object.keys(payload).sort().join(',') !== [...keys].sort().join(',') || payload.schemaVersion !== 1 || payload.kind !== 'push-guard-payload') invalid();
  if (![...IDENTITY.filter(key => key !== 'toolSourceSha'), 'classifierDigest', 'fixtureDigest'].every(key => /^[a-f0-9]{64}$/.test(String(payload[key as keyof PushGuardPayload]))) || !/^[a-f0-9]{40}$/.test(payload.toolSourceSha)) invalid();
  if (typeof payload.baseWorkflow !== 'string' || typeof payload.candidateWorkflow !== 'string' || typeof payload.workflowPath !== 'string' || !payload.operation || typeof payload.operation !== 'object') invalid();
  if (!Array.isArray(payload.cases) || !payload.cases.length || payload.cases.length > 200 || jsonDigest(payload.cases) !== payload.fixtureDigest) invalid();
  return payload;
}

const EVENTS = [
  { event: 'push', classifier: 'success', validated: 'true' }, { event: 'push', classifier: 'success', validated: 'false' }, { event: 'push', classifier: 'success', validated: '' },
  // A classifier that wrote `validated=true` and then failed or timed out must still run the full suite.
  { event: 'push', classifier: 'failure', validated: '' }, { event: 'push', classifier: 'failure', validated: 'true' }, { event: 'push', classifier: 'cancelled', validated: '' }, { event: 'push', classifier: 'cancelled', validated: 'true' },
  { event: 'pull_request', classifier: 'skipped', validated: '' }, { event: 'workflow_dispatch', classifier: 'skipped', validated: '' }, { event: 'schedule', classifier: 'skipped', validated: '' },
];
const RESULTS = ['success', 'failure', 'skipped', 'cancelled'];
/** Every combination of need results up to five needs; beyond that, all-success and each need failing alone. */
function needCombinations(needs: string[]): Record<string, string>[] {
  if (needs.length > 5) return [Object.fromEntries(needs.map(need => [need, 'success'])), ...needs.flatMap(need => RESULTS.slice(1).map(result => Object.fromEntries(needs.map(other => [other, other === need ? result : 'success']))))];
  return needs.reduce<Record<string, string>[]>((combos, need) => combos.flatMap(combo => RESULTS.map(result => ({ ...combo, [need]: result }))), [{}]);
}
function condition(job: Record<string, unknown>): ExpressionNode | null { return 'if' in job ? conditionExpression(job.if) : null; }

/**
 * Job run/skip decisions for base and candidate across the decision matrix (plan § Patch shape,
 * Phase 5). A condition without a status function gets GitHub's implicit `success()`. The base
 * condition is opaque: it is substituted only where it is exactly the guard's last operand.
 */
export function guardMatrix(base: string, candidate: string, operation: PushOperation, listed = Infinity): { cells: number; mismatchCount: number; mismatches: string[] } {
  const baseJobs = parseWorkflowSource(base).jobs as Record<string, Record<string, unknown>>, candidateJobs = parseWorkflowSource(candidate).jobs as Record<string, Record<string, unknown>>;
  const mismatches: string[] = [];
  let cells = 0, mismatchCount = 0;
  // Count every mismatch but format only the first `listed`: a broken guard on a wide job has tens of thousands.
  const report = (line: () => string) => { mismatchCount++; if (mismatches.length < listed) mismatches.push(line()); };
  const classifier = candidateJobs[CLASSIFIER_JOB_ID] ?? {}, classifierIf = condition(classifier) ?? { type: 'literal', value: true };
  const branchRef = `refs/heads/${operation.integrationBranch}`;
  for (const [event, ref, expected] of [['push', branchRef, true], ['push', 'refs/heads/other', false], ['push', 'refs/tags/v1', false], ['pull_request', 'refs/pull/1/merge', false], ['workflow_dispatch', branchRef, false], ['schedule', branchRef, false]] as const) {
    cells++;
    const runs = isTruthy(evaluateExpression(classifierIf, { contexts: { github: { event_name: event, ref } }, status: { success: true, failure: false, cancelled: false } }));
    if (runs !== expected) report(() => `${CLASSIFIER_JOB_ID} event=${event} ref=${ref}: runs=${runs} expected=${expected}`);
  }
  for (const id of operation.guardedJobIds) {
    const baseJob = baseJobs[id] ?? {}, guard = condition(candidateJobs[id] ?? {}) ?? { type: 'literal', value: true };
    const needs = list(baseJob.needs) as string[], original = condition(baseJob), implicit = !usesStatusFunction(guard);
    const substituted = original !== null && guard.type === 'binary' && guard.operator === '&&' && canonicalJson(guard.right) === canonicalJson(original);
    // The matrix reads need results by name, so it also checks the candidate waits on exactly the original needs and the classifier.
    cells++;
    const candidateNeeds = list((candidateJobs[id] ?? {}).needs) as string[], expectedNeeds = [...needs, CLASSIFIER_JOB_ID];
    if (canonicalJson(candidateNeeds) !== canonicalJson(expectedNeeds)) report(() => `${id} needs: [${candidateNeeds.join(',')}] expected [${expectedNeeds.join(',')}]`);
    for (const state of EVENTS) for (const combo of needCombinations(needs)) for (const opaque of original === null ? [true] : [true, false]) for (const cancelled of [false, true]) {
      cells++;
      const baseRun = !cancelled && needs.every(need => combo[need] === 'success') && opaque;
      const results = { ...combo, [CLASSIFIER_JOB_ID]: state.classifier };
      const context = { contexts: { needs: Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result, outputs: job === CLASSIFIER_JOB_ID ? { validated: state.validated } : {} }])) }, status: { success: !cancelled && Object.values(results).every(result => result === 'success'), failure: Object.values(results).includes('failure'), cancelled } };
      const evaluated = substituted && guard.type === 'binary' ? isTruthy(evaluateExpression(guard.left, context)) && opaque : isTruthy(evaluateExpression(guard, context));
      const candidateRun = (implicit ? context.status.success : true) && evaluated;
      const expected = baseRun && !(state.classifier === 'success' && state.validated === 'true');
      if (candidateRun !== expected) report(() => `${id} event=${state.event} classifier=${state.classifier}/${state.validated || '-'} needs=${needs.length ? needs.map(need => `${need}:${combo[need]}`).join(',') : '-'} original=${original === null ? '-' : opaque} cancelled=${cancelled}: base=${baseRun ? 'run' : 'skip'} candidate=${candidateRun ? 'run' : 'skip'} expected=${expected ? 'run' : 'skip'}`);
    }
  }
  return { cells, mismatchCount, mismatches };
}

/** Phase 5 `verifyPushGuards`: the inverse proof, the decision matrix, and the embedded script on every case. */
export async function verifyPushGuards(payload: PushGuardPayload, runCase: ClassifierCaseRunner): Promise<PushGuardResult> {
  let failure: string | null = null;
  const note = (code: string) => { failure ??= code; };
  try { validateGuardOnlyChange(payload.baseWorkflow, payload.candidateWorkflow, payload.operation); } catch { note('inverse-mismatch'); }
  let matrix = { cells: 0, mismatchCount: 0, mismatches: [] as string[] };
  try { matrix = guardMatrix(payload.baseWorkflow, payload.candidateWorkflow, payload.operation, LISTED); } catch { note('matrix-unreadable'); }
  if (matrix.mismatchCount || !matrix.cells) note('matrix-mismatch');
  let script: string | null = null;
  try { script = extractClassifierScript(payload.candidateWorkflow); } catch { note('script-missing'); }
  const classifierDigest = script === null ? null : sha256(script);
  if (classifierDigest !== payload.classifierDigest) note('script-digest-mismatch');
  const classifierMismatches: string[] = [];
  let ran = 0;
  // Only the digest-bound script runs: a changed script has already failed and is never executed.
  if (script !== null && classifierDigest === payload.classifierDigest) for (const testCase of payload.cases) {
    const actual = await runCase(script, testCase), expected = testCase.expected; ran++;
    if (actual.validated !== expected.validated || actual.reasonCode !== expected.reasonCode) classifierMismatches.push(`${testCase.name}: expected ${expected.validated}/${expected.reasonCode}, got ${actual.validated}/${actual.reasonCode}`);
  }
  if (classifierMismatches.length) note('classifier-case-mismatch');
  return {
    schemaVersion: 1, kind: 'push-guard-result', ...Object.fromEntries(IDENTITY.map(key => [key, payload[key]])) as Pick<PushGuardPayload, typeof IDENTITY[number]>,
    status: failure === null ? 'passed' : 'failed', failure, matrixCells: matrix.cells, mismatchCount: matrix.mismatchCount, mismatches: matrix.mismatches,
    classifierCases: ran, classifierMismatchCount: classifierMismatches.length, classifierMismatches: classifierMismatches.slice(0, LISTED), classifierDigest, fixtureDigest: payload.fixtureDigest,
  };
}
