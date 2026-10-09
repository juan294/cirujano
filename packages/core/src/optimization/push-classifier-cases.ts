import { canonicalJson } from './canonical.js';
import type { ClassifierGet, PushClassifierContext } from './push-classifier.js';

/**
 * The Phase 3 classifier table, as one source: the unit tests run it in process, and the Sandbox
 * verifier runs the same cases, as data, through a candidate's embedded step script.
 */

export const repository = 'public-example/benchmark', repositoryId = 123, workflowPath = '.github/workflows/ci.yml';
export const mergeSha = 'a'.repeat(40), headSha = 'b'.repeat(40), baseSha = 'c'.repeat(40), treeSha = 'd'.repeat(40);
const repo = `repos/${repository}`;

/** A response override: an HTTP status, a raw body, or a thrown transport error. */
export type Override = { status: number; body?: string } | { raw: string } | { throws: Error };

/** One merged pull request (#7) whose run 55 of `ci.yml` passed at `headSha`, merged as `mergeSha` or fast-forwarded. */
export function githubScenario(merge: 'merge-commit' | 'fast-forward' = 'merge-commit') {
  const pushSha = merge === 'fast-forward' ? headSha : mergeSha;
  const pull = { number: 7, merged_at: '2026-10-08T10:00:00Z', merge_commit_sha: pushSha, base: { ref: 'develop' }, head: { sha: headSha, repo: { id: repositoryId } } };
  const run = { id: 55, path: workflowPath, event: 'pull_request', head_sha: headSha, head_repository: { id: repositoryId }, status: 'completed', conclusion: 'success' };
  const job = (name: string, conclusion = 'success') => ({ name, status: 'completed', conclusion });
  const responses: Record<string, unknown> = {
    [`${repo}/commits/${pushSha}/pulls?per_page=100`]: [pull],
    [`${repo}/git/commits/${headSha}`]: { sha: headSha, tree: { sha: treeSha }, parents: [{ sha: baseSha }] },
    [`${repo}/compare/${baseSha}...${headSha}`]: { status: 'ahead' },
    [`${repo}/commits/${headSha}/pulls?per_page=100`]: [pull],
    [`${repo}/actions/runs?event=pull_request&head_sha=${headSha}&per_page=100`]: { total_count: 1, workflow_runs: [run] },
    [`${repo}/actions/runs/55/jobs?filter=latest&per_page=100`]: { total_count: 3, jobs: [job('lint'), job('test'), job('cirujano_validated_push', 'skipped')] },
  };
  if (merge === 'merge-commit') responses[`${repo}/git/commits/${mergeSha}`] = { sha: mergeSha, tree: { sha: treeSha }, parents: [{ sha: baseSha }, { sha: headSha }] };
  const overrides: Record<string, Override> = {};
  const calls: string[] = [];
  const get: ClassifierGet = async path => {
    calls.push(path);
    const override = overrides[path];
    if (override && 'throws' in override) throw override.throws;
    if (override && 'raw' in override) return { status: 200, body: override.raw };
    if (override) return { status: override.status, body: override.body ?? '{"message":"error"}' };
    if (!Object.hasOwn(responses, path)) return { status: 404, body: '{"message":"Not Found"}' };
    return { status: 200, body: JSON.stringify(responses[path]) };
  };
  const context: PushClassifierContext = { eventName: 'push', ref: 'refs/heads/develop', sha: pushSha, forced: false, repository, repositoryId, workflowPath };
  const paths = {
    pulls: `${repo}/commits/${pushSha}/pulls?per_page=100`, pushCommit: `${repo}/git/commits/${pushSha}`, headCommit: `${repo}/git/commits/${headSha}`,
    compare: `${repo}/compare/${baseSha}...${headSha}`, headPulls: `${repo}/commits/${headSha}/pulls?per_page=100`, runs: `${repo}/actions/runs?event=pull_request&head_sha=${headSha}&per_page=100`, jobs: `${repo}/actions/runs/55/jobs?filter=latest&per_page=100`,
  };
  return { context, get, calls, responses, overrides, paths, pull, run, job };
}

export type Scenario = ReturnType<typeof githubScenario>;
export const failOpenCases: [string, string, (scenario: Scenario) => void][] = [
  ['not-push-event', 'not-push-event', s => { s.context.eventName = 'pull_request'; }],
  ['forced-push', 'forced-push', s => { s.context.forced = true; }],
  ['push-event-unreadable', 'push-event-unreadable', s => { s.context.forced = undefined as unknown as boolean; }],
  ['fast-forward-other-pr-at-head', 'other-pr-at-head', s => { s.context.sha = headSha; s.pull.merge_commit_sha = headSha; s.responses[`repos/${repository}/commits/${headSha}/pulls?per_page=100`] = [s.pull, { ...s.pull, number: 99, merged_at: null, merge_commit_sha: null, base: { ref: 'main' } }]; }],
  ['other-pr-at-head', 'other-pr-at-head', s => { s.responses[s.paths.headPulls] = [s.pull, { ...s.pull, number: 99, merged_at: null, base: { ref: 'main' } }]; }],
  ['paginated-head-pulls', 'pulls-paginated', s => { s.responses[s.paths.headPulls] = Array.from({ length: 100 }, () => s.pull); }],
  ['classifier-named-job-ran', 'pr-job-not-successful', s => { s.responses[s.paths.jobs] = { total_count: 2, jobs: [s.job('lint'), s.job('cirujano_validated_push')] }; }],
  ['two-classifier-named-jobs', 'pr-job-not-successful', s => { s.responses[s.paths.jobs] = { total_count: 3, jobs: [s.job('lint'), s.job('cirujano_validated_push', 'skipped'), s.job('cirujano_validated_push', 'skipped')] }; }],
  ['tag-ref', 'not-branch-ref', s => { s.context.ref = 'refs/tags/v1'; }],
  ['empty-branch', 'not-branch-ref', s => { s.context.ref = 'refs/heads/'; }],
  ['branch-sha', 'invalid-context', s => { s.context.sha = 'develop'; }],
  ['repository-id', 'invalid-context', s => { s.context.repositoryId = Number.NaN; }],
  ['repository-name', 'invalid-context', s => { s.context.repository = 'no-owner'; }],
  ['workflow-path', 'invalid-context', s => { s.context.workflowPath = 'ci.yml'; }],
  ['unmerged', 'no-merged-pr', s => { s.pull.merged_at = null as unknown as string; }],
  ['merge-sha-differs', 'no-merged-pr', s => { s.pull.merge_commit_sha = 'e'.repeat(40); }],
  ['other-base', 'no-merged-pr', s => { s.pull.base.ref = 'main'; }],
  ['two-prs', 'multiple-merged-prs', s => { s.responses[s.paths.pulls] = [s.pull, { ...s.pull, number: 8 }]; }],
  ['paginated-pulls', 'pulls-paginated', s => { s.responses[s.paths.pulls] = Array.from({ length: 100 }, (_, number) => ({ ...s.pull, number: number + 1 })); }],
  ['fork-pr', 'fork-pr', s => { s.pull.head.repo = { id: 456 }; }],
  ['deleted-fork', 'fork-pr', s => { s.pull.head.repo = null as unknown as { id: number }; }],
  ['pr-number', 'api-unexpected-shape', s => { s.pull.number = 0; }],
  ['head-sha', 'api-unexpected-shape', s => { s.pull.head.sha = 'short'; }],
  ['tree-mismatch', 'tree-mismatch', s => { s.responses[s.paths.headCommit] = { sha: headSha, tree: { sha: 'f'.repeat(40) }, parents: [{ sha: baseSha }] }; }],
  ['squash-base-moved-tree', 'tree-mismatch', s => { s.responses[s.paths.pushCommit] = { sha: mergeSha, tree: { sha: 'f'.repeat(40) }, parents: [{ sha: '9'.repeat(40) }] }; }],
  ['squash-base-moved', 'base-not-ancestor', s => { s.responses[s.paths.pushCommit] = { sha: mergeSha, tree: { sha: treeSha }, parents: [{ sha: '9'.repeat(40) }] }; s.responses[`repos/${repository}/compare/${'9'.repeat(40)}...${headSha}`] = { status: 'diverged' }; }],
  ['behind-base', 'base-not-ancestor', s => { s.responses[s.paths.compare] = { status: 'behind' }; }],
  ['no-parents', 'base-not-ancestor', s => { s.responses[s.paths.pushCommit] = { sha: mergeSha, tree: { sha: treeSha }, parents: [] }; }],
  ['commit-drift', 'api-unexpected-shape', s => { s.responses[s.paths.pushCommit] = { sha: 'e'.repeat(40), tree: { sha: treeSha }, parents: [{ sha: baseSha }] }; }],
  ['head-commit-drift', 'api-unexpected-shape', s => { s.responses[s.paths.headCommit] = { sha: 'e'.repeat(40), tree: { sha: treeSha }, parents: [{ sha: baseSha }] }; }],
  ['pr-run-failed', 'pr-run-not-successful', s => { s.run.conclusion = 'failure'; }],
  ['pr-run-in-progress', 'pr-run-not-successful', s => { s.run.status = 'in_progress'; }],
  ['different-workflow-path', 'pr-run-missing', s => { s.run.path = '.github/workflows/other.yml'; }],
  ['two-pr-runs', 'pr-run-ambiguous', s => { s.responses[s.paths.runs] = { total_count: 2, workflow_runs: [s.run, { ...s.run, id: 56 }] }; }],
  ['paginated-pr-runs', 'pr-runs-paginated', s => { s.responses[s.paths.runs] = { total_count: 2, workflow_runs: [s.run] }; }],
  ['full-page-pr-runs', 'pr-runs-paginated', s => { s.responses[s.paths.runs] = { total_count: 100, workflow_runs: Array.from({ length: 100 }, (_, index) => ({ ...s.run, id: 1000 + index, path: '.github/workflows/other.yml' })) }; }],
  ['pr-run-event', 'pr-run-identity', s => { s.run.event = 'push'; }],
  ['pr-run-head', 'pr-run-identity', s => { s.run.head_sha = mergeSha; }],
  ['pr-run-fork-head', 'pr-run-identity', s => { s.run.head_repository = { id: 456 }; }],
  ['pr-run-other-pr', 'pr-run-identity', s => { (s.run as Record<string, unknown>).pull_requests = [{ number: 99, base: { ref: 'develop' } }]; }],
  ['pr-run-other-base', 'pr-run-identity', s => { (s.run as Record<string, unknown>).pull_requests = [{ number: 7, base: { ref: 'main' } }]; }],
  ['pr-run-pull-requests-shape', 'pr-run-identity', s => { (s.run as Record<string, unknown>).pull_requests = [null]; }],
  ['pr-run-id', 'api-unexpected-shape', s => { s.run.id = -1; }],
  ['job-skipped', 'pr-job-not-successful', s => { s.responses[s.paths.jobs] = { total_count: 3, jobs: [s.job('lint'), s.job('test', 'skipped'), s.job('cirujano_validated_push', 'skipped')] }; }],
  ['job-in-progress', 'pr-job-not-successful', s => { s.responses[s.paths.jobs] = { total_count: 2, jobs: [s.job('lint'), { name: 'test', status: 'in_progress', conclusion: null }] }; }],
  ['job-status-inconsistent', 'pr-job-not-successful', s => { s.responses[s.paths.jobs] = { total_count: 2, jobs: [s.job('lint'), { name: 'test', status: 'queued', conclusion: 'success' }] }; }],
  ['jobs-empty', 'pr-jobs-empty', s => { s.responses[s.paths.jobs] = { total_count: 1, jobs: [s.job('cirujano_validated_push', 'skipped')] }; }],
  ['paginated-jobs', 'pr-jobs-paginated', s => { s.responses[s.paths.jobs] = { total_count: 4, jobs: [s.job('lint'), s.job('test')] }; }],
  ['full-page-jobs', 'pr-jobs-paginated', s => { s.responses[s.paths.jobs] = { total_count: 100, jobs: Array.from({ length: 100 }, (_, index) => s.job(`job-${index}`)) }; }],
  ['http-403', 'api-http-403', s => { s.overrides[s.paths.pulls] = { status: 403 }; }],
  ['http-404', 'api-http-404', s => { s.overrides[s.paths.runs] = { status: 404 }; }],
  ['head-pulls-http-500', 'api-http-500', s => { s.overrides[s.paths.headPulls] = { status: 500 }; }],
  ['http-500', 'api-http-500', s => { s.overrides[s.paths.jobs] = { status: 500 }; }],
  ['http-304', 'api-unexpected-status', s => { s.overrides[s.paths.pushCommit] = { status: 304 }; }],
  ['timeout', 'api-timeout', s => { s.overrides[s.paths.compare] = { throws: new DOMException('The operation timed out.', 'TimeoutError') }; }],
  ['network-error', 'api-error', s => { s.overrides[s.paths.headCommit] = { throws: new TypeError('fetch failed') }; }],
  ['malformed-json', 'api-malformed-json', s => { s.overrides[s.paths.jobs] = { raw: '{"jobs": [' }; }],
  ['unexpected-shape', 'api-unexpected-shape', s => { s.responses[s.paths.pulls] = { pulls: [] }; }],
];

/** Statuses a fetch `Response` cannot carry a body with; the case stubs answer them with none. */
export const NULL_BODY_STATUSES = [204, 205, 304];
export type ClassifierCaseResponse = { status: number; body: string } | { error: 'TimeoutError' | 'TypeError' };
export interface ClassifierCase { name: string; env: Record<string, string>; event: string; responses: Record<string, ClassifierCaseResponse>; expected: { validated: boolean; reasonCode: string } }
/** One scenario as the workflow step sees it: runner environment, push event file and GitHub responses. */
function asCase(name: string, scenario: Scenario, expected: ClassifierCase['expected']): ClassifierCase {
  const { context } = scenario, responses: Record<string, ClassifierCaseResponse> = {};
  for (const [path, value] of Object.entries(scenario.responses)) responses[path] = { status: 200, body: JSON.stringify(value) };
  for (const [path, override] of Object.entries(scenario.overrides)) {
    responses[path] = 'throws' in override ? { error: override.throws.name === 'TimeoutError' ? 'TimeoutError' : 'TypeError' } : 'raw' in override ? { status: 200, body: override.raw } : { status: override.status, body: override.body ?? '{"message":"error"}' };
  }
  const env = { GITHUB_API_URL: 'https://api.github.com', GITHUB_REPOSITORY: context.repository, GITHUB_REPOSITORY_ID: String(context.repositoryId), GITHUB_SHA: context.sha, GITHUB_REF: context.ref, GITHUB_EVENT_NAME: context.eventName, GITHUB_WORKFLOW_REF: `${context.repository}/${context.workflowPath}@${context.ref}`, GH_TOKEN: 'fixture-token' };
  return { name, env, event: canonicalJson(context.forced === undefined ? {} : { forced: context.forced }), responses, expected };
}
/** Every validated and fail-open case of the table, as data. */
export function classifierCases(): ClassifierCase[] {
  return [
    asCase('validated-merge-commit', githubScenario(), { validated: true, reasonCode: 'validated' }),
    asCase('validated-fast-forward', githubScenario('fast-forward'), { validated: true, reasonCode: 'validated' }),
    ...failOpenCases.map(([name, reasonCode, mutate]) => { const scenario = githubScenario(); mutate(scenario); return asCase(name, scenario, { validated: false, reasonCode }); }),
  ];
}
