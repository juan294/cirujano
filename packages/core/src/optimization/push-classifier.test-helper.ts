import type { ClassifierGet, PushClassifierContext } from './push-classifier.js';

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
