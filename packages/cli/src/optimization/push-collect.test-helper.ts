import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gitBlobSha } from '@cirujano/core';
import type { GitHubPageRunner } from '../github-api.js';

export const repository = 'public-example/benchmark', baseSha = 'a'.repeat(40), branch = 'develop', workflow = '.github/workflows/ci.yml';
const repo = `repos/${repository}`;
export const eligibleWorkflow = readFileSync(new URL('../../../core/fixtures/optimization/push/eligible-matrix.yml', import.meta.url), 'utf8');
const sha = (seed: number) => createHash('sha1').update(String(seed)).digest('hex');

function treeResponses(files: Record<string, string>) {
  const entries: { path: string; type: string; mode: string; sha: string; size?: number }[] = Object.entries(files).map(([path, content]) => ({ path, type: 'blob', mode: '100644', sha: gitBlobSha(content), size: Buffer.byteLength(content) }));
  const directories = new Set(['']);
  for (const path of Object.keys(files)) for (let i = 1; i < path.split('/').length; i++) directories.add(path.split('/').slice(0, i).join('/'));
  let treeSha = '';
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    const name = (entry: { path: string; type: string }) => Buffer.from(entry.path.split('/').at(-1)! + (entry.type === 'tree' ? '/' : ''));
    const children = entries.filter(entry => entry.path.split('/').slice(0, -1).join('/') === directory).sort((a, b) => Buffer.compare(name(a), name(b)));
    const bytes = Buffer.concat(children.map(entry => Buffer.concat([Buffer.from(`${entry.mode === '040000' ? '40000' : entry.mode} ${entry.path.split('/').at(-1)!}\0`), Buffer.from(entry.sha, 'hex')])));
    const digest = createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex');
    if (directory) entries.push({ path: directory, type: 'tree', mode: '040000', sha: digest }); else treeSha = digest;
  }
  const responses: Record<string, unknown> = {
    [`${repo}/git/commits/${baseSha}`]: { sha: baseSha, tree: { sha: treeSha } },
    [`${repo}/git/trees/${treeSha}?recursive=1`]: { sha: treeSha, truncated: false, tree: entries },
  };
  for (const content of Object.values(files)) responses[`${repo}/git/blobs/${gitBlobSha(content)}`] = { sha: gitBlobSha(content), encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') };
  return { responses, treeSha };
}

/** The classifier reads for one push merged from PR `number` (head `head`, run `runId`), all green. */
function validatedPush(push: string, head: string, number: number, runId: number) {
  const tree = sha(number * 1000);
  return {
    [`${repo}/commits/${push}/pulls?per_page=100`]: [{ number, merged_at: '2026-10-08T10:00:00Z', merge_commit_sha: push, base: { ref: branch }, head: { sha: head, repo: { id: 123 } } }],
    [`${repo}/git/commits/${push}`]: { sha: push, tree: { sha: tree }, parents: [{ sha: sha(number * 1000 + 1) }, { sha: head }] },
    [`${repo}/git/commits/${head}`]: { sha: head, tree: { sha: tree }, parents: [{ sha: sha(number * 1000 + 1) }] },
    [`${repo}/compare/${sha(number * 1000 + 1)}...${head}`]: { status: 'ahead' },
    [`${repo}/commits/${head}/pulls?per_page=100`]: [{ number, merged_at: '2026-10-08T10:00:00Z', merge_commit_sha: push, base: { ref: branch }, head: { sha: head, repo: { id: 123 } } }],
    [`${repo}/actions/runs?event=pull_request&head_sha=${head}&per_page=100`]: { total_count: 1, workflow_runs: [{ id: runId, path: workflow, event: 'pull_request', head_sha: head, head_repository: { id: 123 }, status: 'completed', conclusion: 'success' }] },
    [`${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`]: { total_count: 1, jobs: [{ name: 'test (20)', status: 'completed', conclusion: 'success' }] },
  };
}

/** Three completed pushes of `ci.yml` on `develop`: runs 301 and 303 came from green PRs; run 302 was a direct push. */
export function pushGithubFixture(source = eligibleWorkflow, omit: string[] = []) {
  const files: Record<string, string> = {
    '.cirujano/optimization-profile.json': '{"schemaVersion":1,"kind":"push-guard"}',
    '.github/workflows/ci.yml': source,
    '.github/workflows/release.yml': 'name: Release\non:\n  workflow_dispatch:\njobs:\n  noop:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo release\n',
    'package.json': '{"private":true}',
  };
  for (const path of omit) delete files[path];
  const { responses, treeSha } = treeResponses(files);
  responses[repo] = { id: 123, full_name: repository, fork: false };
  const runs = [301, 302, 303].map(id => ({ id, run_attempt: 1, head_sha: sha(id), path: workflow, event: 'push', head_branch: branch, status: 'completed', conclusion: 'success', repository: { id: 123, full_name: repository }, head_repository: { id: 123, full_name: repository, fork: false } }));
  responses[`${repo}/actions/workflows/ci.yml/runs?branch=develop&event=push&status=completed&per_page=30`] = { total_count: 3, workflow_runs: runs };
  for (const [index, run] of runs.entries()) {
    const minutes = [5, 3, 4][index]!;
    responses[`${repo}/actions/runs/${run.id}/attempts/1/jobs?per_page=100&page=1`] = { total_count: 2, jobs: [
      { id: run.id * 10, run_id: run.id, run_attempt: 1, head_sha: run.head_sha, name: 'test (20)', status: 'completed', conclusion: 'success', started_at: '2026-10-08T10:00:00Z', completed_at: `2026-10-08T10:0${minutes - 1}:30Z` },
      { id: run.id * 10 + 1, run_id: run.id, run_attempt: 1, head_sha: run.head_sha, name: 'test (22)', status: 'completed', conclusion: 'skipped', started_at: '2026-10-08T10:00:00Z', completed_at: '2026-10-08T10:00:00Z' },
    ] };
  }
  Object.assign(responses, validatedPush(sha(301), sha(3011), 41, 501), validatedPush(sha(303), sha(3031), 43, 503));
  responses[`${repo}/commits/${sha(302)}/pulls?per_page=100`] = [];
  const calls: string[][] = [];
  const pageRunner: GitHubPageRunner = async (command, args) => {
    calls.push([command, ...args]);
    const endpoint = args.find(value => value.startsWith('repos/'));
    if (!endpoint || !Object.hasOwn(responses, endpoint)) throw new Error(`Unexpected endpoint: ${endpoint}`);
    return { stdout: JSON.stringify(responses[endpoint]) };
  };
  return { responses, calls, pageRunner, files, treeSha, runs, sha };
}
