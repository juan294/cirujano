import { parseDocument, visit } from 'yaml';
import { jsonDigest, OptimizationInputError, sha256 } from './canonical.js';
import { conditionExpression, usesStatusFunction } from './guard-expression.js';
import type { PushOperation } from './push-contracts.js';
import { CLASSIFIER_JOB_ID, JOB_ID } from './push-guard.js';
import { allStrings as strings, parseWorkflowSource, record as mapping } from './workflow.js';

export interface PushWorkflowEvidence {
  workflowHash: string; workflowPath: string; integrationBranch: string;
  /** Every workflow file in the repository at the same ref; used to find `workflow_run` consumers. */
  inventory: { path: string; source: string }[];
}
export interface PushWorkflowEligibility { status: 'eligible' | 'no-change' | 'unsupported'; reason: string; operations: PushOperation[]; protectedDigest: string | null; structuralFacts: Record<string, string | number | boolean> }

function isMap(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function list(value: unknown): unknown[] { return Array.isArray(value) ? value : value === undefined ? [] : [value]; }
/** Explicit read-only token permissions: `read-all`, or a map whose every scope is read or none. */
function readOnly(value: unknown): boolean {
  if (value === 'read-all') return true;
  return isMap(value) && Object.values(value).every(permission => permission === 'read' || permission === 'none');
}
const SECRET = /\bsecrets\b/i, ALLOWED_SECRET = /\bsecrets\s*\.\s*GITHUB_TOKEN\b/gi;
/** `github.event*`, `github.ref*`, `github.head_ref`, `github.base_ref`, `github.workflow_ref`, `github.*`, and the runner variables `GITHUB_*REF*` and `GITHUB_EVENT*`. */
const EVENT_CONTEXT = /\bgithub\s*(?:\.\s*|\[\s*')(?:event|ref|head_ref|base_ref|workflow_ref|\*)|GITHUB_(?:[A-Z_]*_)?(?:REF|EVENT)/i;
/** The whole `github` context (for example `toJSON(github)`) inside an expression also exposes the event. */
const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g, WHOLE_GITHUB = /\bgithub\b(?!\s*[.[])/i;
function exposesEvent(value: string): boolean { return EVENT_CONTEXT.test(value) || [...value.matchAll(EXPRESSION)].some(match => WHOLE_GITHUB.test(match[1]!)); }
/** Every job and step `if:` is an expression even without `${{ }}`. */
function jobConditions(job: Record<string, unknown>): string[] {
  return [job.if, ...list(job.steps).map(step => mapping(step).if)].filter((value): value is string => typeof value === 'string');
}
function conditions(jobs: Record<string, unknown>): string[] { return Object.values(jobs).flatMap(job => jobConditions(mapping(job))); }
const DEFAULT_PULL_REQUEST_TYPES = ['opened', 'reopened', 'synchronize'];
/** Environment that changes how bash or node start, or where they connect. */
const RUNTIME_ENV = /^(?:NODE_\w*|NPM_CONFIG_\w*|BASH_ENV|ENV|\w*_PROXY)$/i;

/** The one literal branch an event filters on, or the reason it has none. */
export function triggerBranch(filter: unknown): { branch: string } | { reason: string } {
  if (isMap(filter) && 'branches-ignore' in filter) return { reason: 'branch-ignore' };
  if (!isMap(filter) || !('branches' in filter)) return { reason: 'branch-filter-missing' };
  const branches = list(filter.branches);
  if (branches.some(name => typeof name !== 'string' || !name || /[*?+[\]!]/.test(name))) return { reason: 'branch-glob' };
  if (branches.length !== 1) return { reason: 'multiple-branches' };
  return { branch: branches[0] as string };
}

/** The guard patch edits keys in place; an explicit `? key` cannot be rewritten that way. */
function explicitKeys(source: string): boolean {
  let found = false;
  visit(parseDocument(source, { keepSourceTokens: true }), { Pair(_, pair) { if (pair.srcToken?.start.some(token => token.type === 'explicit-key-ind')) found = true; } });
  return found;
}
/**
 * True when any expression in the job reads `needs` other than as `needs.<declared need>`. The patch
 * adds the classifier to `needs`, so a wider read (`toJSON(needs)`, an index, the classifier itself)
 * would change meaning.
 */
function readsUndeclaredNeeds(job: Record<string, unknown>, declared: readonly string[]): boolean {
  // A string with any expression is scanned whole: a `}}` inside a string literal would end a lazy match early.
  const expressions = [...jobConditions(job), ...strings(job).filter(value => value.includes('${{'))];
  return expressions.some(text => [...text.matchAll(/\bneeds\b(?:\s*\.\s*([A-Za-z_][A-Za-z0-9_-]*))?/gi)].some(match => !declared.some(need => need.toLowerCase() === match[1]?.toLowerCase())));
}
function consumesWorkflow(source: string, names: string[]): boolean {
  const on = parseWorkflowSource(source).on, run = isMap(on) ? on.workflow_run : undefined;
  return isMap(run) && list(run.workflows).some(name => typeof name === 'string' && names.includes(name.toLowerCase()));
}

/**
 * Decide, before any inference, whether every job of a workflow can be guarded by the
 * validated-push classifier (plan § Eligible). Any rule failure is `unsupported` with a reason code.
 */
export function inspectPushWorkflow(source: string, evidence: PushWorkflowEvidence): PushWorkflowEligibility {
  if (sha256(source) !== evidence.workflowHash) throw new OptimizationInputError('Immutable workflow hash mismatch');
  const refuse = (reason: string, status: 'unsupported' | 'no-change' = 'unsupported'): PushWorkflowEligibility => ({ status, reason, operations: [], protectedDigest: null, structuralFacts: {} });
  let workflow: Record<string, unknown>;
  try { workflow = parseWorkflowSource(source); } catch (error) { if (error instanceof OptimizationInputError) return refuse(error.message); throw error; }
  if (explicitKeys(source)) return refuse('unsupported-workflow-shape');
  try {
    const jobs = mapping(workflow.jobs ?? {});
    if (Object.hasOwn(jobs, CLASSIFIER_JOB_ID)) return refuse('already-guarded', 'no-change');
    const on = workflow.on;
    if (isMap(on) && 'pull_request_target' in on || strings(on).includes('pull_request_target')) return refuse('pull-request-target');
    if (!isMap(on)) return refuse('branch-filter-missing');
    if ('workflow_call' in on) return refuse('workflow-call');
    const push = triggerBranch(on.push), pullRequestFilter = triggerBranch(on.pull_request);
    if ('reason' in push) return refuse(push.reason);
    if ('reason' in pullRequestFilter) return refuse(pullRequestFilter.reason);
    const pushBranch = push.branch;
    if (pushBranch !== pullRequestFilter.branch || pushBranch !== evidence.integrationBranch) return refuse('branch-mismatch');
    const pullRequest = mapping(on.pull_request);
    if ('types' in pullRequest && list(pullRequest.types).some(type => typeof type !== 'string' || !DEFAULT_PULL_REQUEST_TYPES.includes(type))) return refuse('pull-request-types');
    if (new Set(evidence.inventory.map(other => other.path)).size !== evidence.inventory.length) return refuse('workflow-inventory-unreadable');
    const names = [typeof workflow.name === 'string' ? workflow.name : evidence.workflowPath].map(name => name.toLowerCase());
    for (const other of evidence.inventory) {
      if (other.path === evidence.workflowPath) continue;
      let consumer: boolean;
      try { consumer = consumesWorkflow(other.source, names); } catch (error) { if (error instanceof OptimizationInputError) return refuse('workflow-inventory-unreadable'); throw error; }
      if (consumer) return refuse('workflow-run-consumer');
    }
    const ids = Object.keys(jobs).sort();
    if (!ids.length) return refuse('no-guarded-jobs');
    // The added classifier job inherits workflow-level run defaults and env; any that can break its node step is refused.
    if (isMap(workflow.defaults) && 'run' in workflow.defaults) return refuse('workflow-run-defaults');
    if (isMap(workflow.env) && Object.keys(workflow.env).some(key => RUNTIME_ENV.test(key))) return refuse('workflow-runtime-env');
    let matrixJobs = 0;
    for (const id of ids) {
      const job = mapping(jobs[id]);
      if ('uses' in job) return refuse('reusable-job');
      if ('environment' in job) return refuse('job-environment');
      if ('continue-on-error' in job) return refuse('job-continue-on-error');
      if (!JOB_ID.test(id)) return refuse('unsupported-workflow-shape');
      if (list(job.steps).some(step => { const uses = mapping(step).uses; return typeof uses === 'string' && uses.startsWith('./'); })) return refuse('local-action');
      if (!readOnly(job.permissions ?? workflow.permissions)) return refuse('permissions-not-read-only');
      const needs = list(job.needs);
      if (needs.some(need => typeof need !== 'string' || need === id || !Object.hasOwn(jobs, need)) || new Set(needs).size !== needs.length) return refuse('unsupported-workflow-shape');
      if ('if' in job) {
        let condition;
        try { condition = conditionExpression(job.if); } catch (error) { if (error instanceof OptimizationInputError) return refuse('unparseable-condition'); throw error; }
        if (usesStatusFunction(condition)) return refuse('status-function-condition');
      }
      if (readsUndeclaredNeeds(job, needs as string[])) return refuse('needs-context-reference');
      if ('strategy' in job) matrixJobs++;
    }
    if (strings(workflow).some(value => SECRET.test(value.replace(ALLOWED_SECRET, '')))) return refuse('secret-reference');
    if (strings([workflow.jobs, workflow.env, workflow.defaults]).some(exposesEvent) || conditions(jobs).some(condition => WHOLE_GITHUB.test(condition))) return refuse('event-context-reference');
    const operation: PushOperation = { type: 'skip-validated-push', integrationBranch: pushBranch, guardedJobIds: ids, classifierJobId: CLASSIFIER_JOB_ID };
    const inventoryDigest = jsonDigest(evidence.inventory.map(other => ({ path: other.path, hash: sha256(other.source) })).sort((a, b) => a.path < b.path ? -1 : 1));
    const structuralFacts = { integrationBranch: pushBranch, guardedJobCount: ids.length, matrixJobCount: matrixJobs, triggers: Object.keys(on).sort().join(','), inventoryDigest };
    return { status: 'eligible', reason: 'eligible', operations: [operation], protectedDigest: jsonDigest(workflow), structuralFacts };
  } catch (error) {
    if (error instanceof OptimizationInputError) return refuse('unsupported-workflow-shape');
    throw error;
  }
}
