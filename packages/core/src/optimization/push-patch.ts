import { isMap, isScalar, parseDocument, type Pair } from 'yaml';
import { jsonDigest, OptimizationInputError, sha256 } from './canonical.js';
import { unifiedPatch } from './patch.js';
import { CLASSIFIER_SOURCE } from './push-classifier.js';
import { isLiteralBranch, isLiteralWorkflowPath, type PushOperation } from './push-contracts.js';
import { conditionText } from './guard-expression.js';
import { CLASSIFIER_JOB_ID, guardExpression } from './push-guard.js';
import { inspectPushWorkflow, list, triggerBranch, type PushWorkflowEligibility, type PushWorkflowEvidence } from './push-workflow.js';
import { parseWorkflowSource } from './workflow.js';

export interface SkipValidatedPushPatch {
  status: 'proposed' | 'no-change'; candidate: string; patch: string; beforeHash: string; afterHash: string;
  beforeStructuralDigest: string; afterStructuralDigest: string; operation: PushOperation | null;
}
const STEP_NAME = 'Check whether this push was already validated by its PR (Cirujano)';
const DELIMITER = 'CIRUJANO_CLASSIFIER';
const RUN_PREFIX = `node --input-type=module <<'${DELIMITER}'\n`, RUN_SUFFIX = `${DELIMITER}\n`;
function fail(reason: string): never { throw new OptimizationInputError(`push-patch-${reason}`); }
function mapping(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('unsupported-map-format'); return value as Record<string, unknown>; }
function needsOf(job: Record<string, unknown>): string[] { return list(job.needs) as string[]; }
/** The original condition as the guard's last operand, read exactly as eligibility parsed it. */
function originalCondition(job: Record<string, unknown>): string | null {
  if (!('if' in job)) return null;
  return typeof job.if === 'string' ? conditionText(job.if).trim() : String(job.if);
}
function guardFor(job: Record<string, unknown>): string { return `\${{ ${guardExpression([...needsOf(job)].sort(), originalCondition(job))} }}`; }

/** The generated classifier job as the parsed workflow holds it (plan § Patch shape; phase 4 exact shape). */
export function classifierJob(branch: string): Record<string, unknown> {
  return {
    if: `github.event_name == 'push' && github.ref == 'refs/heads/${branch}'`, 'runs-on': 'ubuntu-latest', 'timeout-minutes': 2,
    permissions: { actions: 'read', contents: 'read', 'pull-requests': 'read' },
    outputs: { validated: '${{ steps.classify.outputs.validated }}' },
    steps: [{ name: STEP_NAME, id: 'classify', env: { GH_TOKEN: '${{ github.token }}' }, run: `${RUN_PREFIX}${CLASSIFIER_SOURCE}${RUN_SUFFIX}` }],
  };
}
function classifierJobText(indent: string, newline: string, branch: string): string {
  const at = (depth: number) => indent + '  '.repeat(depth);
  const script = CLASSIFIER_SOURCE.slice(0, -1).split('\n').map(line => line ? at(4) + line : '');
  return [
    `${indent}${CLASSIFIER_JOB_ID}:`,
    `${at(1)}if: github.event_name == 'push' && github.ref == 'refs/heads/${branch}'`,
    `${at(1)}runs-on: ubuntu-latest`, `${at(1)}timeout-minutes: 2`,
    `${at(1)}permissions:`, `${at(2)}actions: read`, `${at(2)}contents: read`, `${at(2)}pull-requests: read`,
    `${at(1)}outputs:`, `${at(2)}validated: \${{ steps.classify.outputs.validated }}`,
    `${at(1)}steps:`, `${at(2)}- name: ${STEP_NAME}`, `${at(3)}id: classify`, `${at(3)}env:`, `${at(4)}GH_TOKEN: \${{ github.token }}`,
    `${at(3)}run: |`, `${at(4)}${RUN_PREFIX.slice(0, -1)}`, ...script, `${at(4)}${DELIMITER}`,
  ].join(newline) + newline;
}

/** The base workflow tree with the guard applied: what a correct candidate must parse to. */
function guardedTree(base: string, operation: PushOperation): Record<string, unknown> {
  const tree = parseWorkflowSource(base), jobs = mapping(tree.jobs), trigger = triggerBranch(mapping(tree.on).push);
  if (JSON.stringify(Object.keys(jobs).sort()) !== JSON.stringify(operation.guardedJobIds) || operation.classifierJobId !== CLASSIFIER_JOB_ID || !isLiteralBranch(operation.integrationBranch) || !('branch' in trigger) || trigger.branch !== operation.integrationBranch) fail('operation-mismatch');
  for (const id of operation.guardedJobIds) {
    const job = mapping(jobs[id]);
    jobs[id] = { ...job, if: guardFor(job), needs: [...needsOf(job), CLASSIFIER_JOB_ID] };
  }
  jobs[CLASSIFIER_JOB_ID] = classifierJob(operation.integrationBranch);
  return tree;
}
function keyStart(pair: Pair): number { if (!isScalar(pair.key) || !pair.key.range) fail('unsupported-key-format'); return pair.key.range[0]; }
function lineIndent(source: string, offset: number): { lineStart: number; indent: string } {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1, indent = source.slice(lineStart, offset);
  if (!/^ +$/.test(indent)) fail('unsupported-indentation');
  return { lineStart, indent };
}
/** Byte edits inside the parsed AST only: one inserted job, and per guarded job an `if` and a `needs` written or replaced. */
function renderCandidate(source: string, operation: PushOperation): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  if (newline === '\r\n' && source.replaceAll('\r\n', '').includes('\n')) fail('mixed-newlines');
  const document = parseDocument(source, { version: '1.2', uniqueKeys: true, strict: true, keepSourceTokens: true });
  const jobs = document.get('jobs', true), tree = mapping(parseWorkflowSource(source).jobs);
  if (!isMap(jobs) || jobs.flow || !jobs.items.length) fail('unsupported-map-format');
  const edits: { start: number; end: number; text: string }[] = [];
  // The classifier goes first, above the comment lines that introduce the first job. A deeper
  // comment would fall inside the classifier's run block, so the walk stops there.
  const first = lineIndent(source, keyStart(jobs.items[0]!));
  let insertAt = first.lineStart;
  while (insertAt > 0) {
    const previous = source.lastIndexOf('\n', insertAt - 2) + 1, line = source.slice(previous, insertAt);
    if (!line.trim().startsWith('#') || line.length - line.trimStart().length > first.indent.length) break;
    insertAt = previous;
  }
  edits.push({ start: insertAt, end: insertAt, text: classifierJobText(first.indent, newline, operation.integrationBranch) });
  for (const pair of jobs.items) {
    const id = isScalar(pair.key) ? String(pair.key.value) : fail('unsupported-key-format'), job = pair.value, parsed = mapping(tree[id]);
    if (!isMap(job) || job.flow || !job.items.length) fail('unsupported-map-format');
    const values = { if: JSON.stringify(guardFor(parsed)), needs: `[${[...needsOf(parsed), CLASSIFIER_JOB_ID].join(', ')}]` };
    const { lineStart, indent } = lineIndent(source, keyStart(job.items[0]!));
    for (const key of ['if', 'needs'] as const) {
      const existing = job.items.find(item => isScalar(item.key) && item.key.value === key);
      if (!existing) { edits.push({ start: lineStart, end: lineStart, text: `${indent}${key}: ${values[key]}${newline}` }); continue; }
      const range = (existing.value as { range?: [number, number, number] } | null)?.range, keyEnd = (existing.key as { range?: [number, number, number] }).range?.[1];
      if (!range || keyEnd === undefined) fail('unsupported-value-format');
      // From the key's end, so the new value sits on the key's line even when a block value started below it,
      // keeping the line break that ends a block scalar or block sequence.
      const tail = /\s*$/.exec(source.slice(range[0], range[1]))![0];
      edits.push({ start: keyEnd, end: range[1], text: `: ${values[key]}${tail.includes('\n') ? tail : ''}` });
    }
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let candidate = source;
  for (const [index, edit] of edits.entries()) {
    if (index > 0 && edit.end > edits[index - 1]!.start) fail('overlapping-edits');
    candidate = candidate.slice(0, edit.start) + edit.text + candidate.slice(edit.end);
  }
  return candidate;
}

/** The candidate parses to exactly the guarded base tree; returns the candidate's structural digest. */
function assertGuardedTree(base: string, candidate: string, operation: PushOperation): string {
  const digest = jsonDigest(parseWorkflowSource(candidate));
  if (digest !== jsonDigest(guardedTree(base, operation))) fail('protected-semantics-changed');
  return digest;
}
/** The inverse proof for a supplied candidate: the guarded tree, and exactly the deterministic bytes. */
export function validateGuardOnlyChange(base: string, candidate: string, operation: PushOperation): void {
  assertGuardedTree(base, candidate, operation);
  if (candidate !== renderCandidate(base, operation)) fail('protected-bytes-changed');
}
/** The exact step script a candidate embeds; its sha256 must be the provenance `classifierDigest`. */
export function extractClassifierScript(candidate: string): string {
  let run: unknown;
  try {
    const steps = mapping(mapping(parseWorkflowSource(candidate).jobs)[CLASSIFIER_JOB_ID]).steps;
    run = Array.isArray(steps) ? mapping(steps[0]).run : undefined;
  } catch { run = undefined; }
  if (typeof run !== 'string' || !run.startsWith(RUN_PREFIX) || !run.endsWith(RUN_SUFFIX)) fail('classifier-script-missing');
  return run.slice(RUN_PREFIX.length, -RUN_SUFFIX.length);
}
export function createSkipValidatedPushPatch(source: string, evidence: PushWorkflowEvidence): SkipValidatedPushPatch {
  if (!isLiteralWorkflowPath(evidence.workflowPath)) fail('unsupported-workflow-path');
  const eligibility = inspectPushWorkflow(source, evidence);
  if (eligibility.status === 'unsupported') fail(eligibility.reason);
  const beforeHash = sha256(source), beforeStructuralDigest = jsonDigest(parseWorkflowSource(source));
  if (eligibility.status === 'no-change') return { status: 'no-change', candidate: source, patch: '', beforeHash, afterHash: beforeHash, beforeStructuralDigest, afterStructuralDigest: beforeStructuralDigest, operation: null };
  // The candidate is the deterministic render itself, so only its tree needs proving here.
  const operation = eligibility.operations[0]!, candidate = renderCandidate(source, operation), afterStructuralDigest = assertGuardedTree(source, candidate, operation);
  return { status: 'proposed', candidate, patch: unifiedPatch(source, candidate, evidence.workflowPath), beforeHash, afterHash: sha256(candidate), beforeStructuralDigest, afterStructuralDigest, operation };
}
/**
 * Eligibility that also proves the patch can render the workflow (for example, no flow-style job maps or
 * mixed newlines), so collection refuses before any inference what proposal would later reject.
 */
export function inspectRenderablePushWorkflow(source: string, evidence: PushWorkflowEvidence): PushWorkflowEligibility {
  const eligibility = inspectPushWorkflow(source, evidence);
  if (eligibility.status !== 'eligible') return eligibility;
  try { assertGuardedTree(source, renderCandidate(source, eligibility.operations[0]!), eligibility.operations[0]!); }
  catch (error) { if (error instanceof OptimizationInputError) return { status: 'unsupported', reason: 'unrenderable-workflow', operations: [], protectedDigest: null, structuralFacts: {} }; throw error; }
  return eligibility;
}
