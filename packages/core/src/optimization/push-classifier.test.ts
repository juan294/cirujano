import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from './canonical.js';
import { CLASSIFIER_DIGEST, CLASSIFIER_SOURCE, classifyPush, runClassifierStep } from './push-classifier.js';
import { CLASSIFIER_JOB_ID } from './push-guard.js';
import { baseSha, githubScenario, headSha, mergeSha, repository, repositoryId, treeSha, workflowPath } from './push-classifier.test-helper.js';

const templatePath = new URL('./push-classifier.template.mjs', import.meta.url);
type Scenario = ReturnType<typeof githubScenario>;
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('skip-validated-push classifier rule', () => {
  it('validates a merge commit whose base tip is an ancestor of the tested head', async () => {
    const scenario = githubScenario();
    expect(await classifyPush(scenario.context, scenario.get)).toEqual({ validated: true, reasonCode: 'validated', prNumber: 7, prHeadSha: headSha, prRunId: 55 });
    expect(scenario.calls).toEqual([scenario.paths.pulls, scenario.paths.pushCommit, scenario.paths.headCommit, scenario.paths.compare, scenario.paths.headPulls, scenario.paths.runs, scenario.paths.jobs]);
  });
  it('validates a fast-forward push without a comparison', async () => {
    const scenario = githubScenario('fast-forward');
    expect(await classifyPush(scenario.context, scenario.get)).toMatchObject({ validated: true, reasonCode: 'validated', prNumber: 7 });
    expect(scenario.calls).not.toContain(scenario.paths.compare);
    expect(scenario.calls.filter(path => path === scenario.paths.pulls)).toHaveLength(1);
    expect(scenario.calls.filter(path => path === scenario.paths.headCommit)).toHaveLength(1);
  });
  it('validates when the run names only the merged pull request, or none', async () => {
    const scenario = githubScenario(); (scenario.run as Record<string, unknown>).pull_requests = [{ number: 7, base: { ref: 'develop' } }];
    expect((await classifyPush(scenario.context, scenario.get)).validated).toBe(true);
    (scenario.run as Record<string, unknown>).pull_requests = [];
    expect((await classifyPush(scenario.context, scenario.get)).validated).toBe(true);
  });
  it('validates when the base tip is identical to the tested head', async () => {
    const scenario = githubScenario();
    scenario.responses[scenario.paths.compare] = { status: 'identical' };
    expect((await classifyPush(scenario.context, scenario.get)).validated).toBe(true);
  });

  const failOpen: [string, string, (scenario: Scenario) => void][] = [
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
  it.each(failOpen)('classifier-fail-open-%s gives false with reason %s', async (_name, reasonCode, mutate) => {
    const scenario = githubScenario(); mutate(scenario);
    const result = await classifyPush(scenario.context, scenario.get);
    expect(result.validated).toBe(false); expect(result.reasonCode).toBe(reasonCode);
  });
  it('classifier-fail-open-malformed-reader gives false when the reader breaks its contract', async () => {
    const scenario = githubScenario();
    expect(await classifyPush(scenario.context, async () => ({ status: '200', body: '[]' }) as never)).toMatchObject({ validated: false, reasonCode: 'api-error' });
    expect(await classifyPush(null as never, scenario.get)).toMatchObject({ validated: false, reasonCode: 'not-push-event' });
  });
  it('reads only the seven bounded GitHub paths and never sends the token to the reader', async () => {
    const scenario = githubScenario(); await classifyPush(scenario.context, scenario.get);
    expect(scenario.calls.every(path => path.startsWith(`repos/${repository}/`) && !/\s/.test(path))).toBe(true);
    expect(scenario.calls).toHaveLength(7);
  });
});

describe('classifier workflow step', () => {
  function stepEnvironment(overrides: Record<string, string | undefined> = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'cirujano-classifier-')); directories.push(directory);
    const output = join(directory, 'output'), summary = join(directory, 'summary'), event = join(directory, 'event.json'); writeFileSync(output, ''); writeFileSync(summary, ''); writeFileSync(event, JSON.stringify({ forced: false, after: mergeSha }));
    const env: Record<string, string | undefined> = { GITHUB_API_URL: 'https://api.github.com', GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: String(repositoryId), GITHUB_SHA: mergeSha, GITHUB_REF: 'refs/heads/develop', GITHUB_EVENT_NAME: 'push', GITHUB_WORKFLOW_REF: `${repository}/${workflowPath}@refs/heads/develop`, GH_TOKEN: 'owned-test-token', GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...overrides };
    return { env, output, summary, event };
  }
  function fetchFrom(scenario: Scenario) {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      const response = await scenario.get(String(url).replace('https://api.github.com/', ''));
      return new Response(response.body, { status: response.status });
    };
    return { fetcher, requests };
  }
  it('writes validated=true with the PR number and authenticates every read', async () => {
    const step = stepEnvironment(), scenario = githubScenario(), transport = fetchFrom(scenario);
    expect(await runClassifierStep(step.env, transport.fetcher)).toMatchObject({ validated: true, prNumber: 7 });
    expect(readFileSync(step.output, 'utf8')).toBe('validated=true\nreason=validated\n');
    expect(readFileSync(step.summary, 'utf8')).toContain('pull request #7');
    expect(transport.requests).toHaveLength(7);
    for (const request of transport.requests) {
      expect(request.url.startsWith('https://api.github.com/repos/')).toBe(true);
      expect(request.init).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer owned-test-token', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
      expect(request.init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it.each([
    ['missing-token', { GH_TOKEN: undefined }],
    ['insecure-api', { GITHUB_API_URL: 'http://api.github.com' }],
    // Same length as the repository, so only the prefix check can tell the workflow is foreign.
    ['foreign-workflow-ref', { GITHUB_WORKFLOW_REF: `${repository.slice(0, -1)}X/${workflowPath}@refs/heads/develop` }],
    // No `@ref` suffix: dropping the last character would otherwise leave a valid-looking path.
    ['unversioned-workflow-ref', { GITHUB_WORKFLOW_REF: `${repository}/${workflowPath}x` }],
  ])('classifier-fail-open-step-%s writes validated=false without a read', async (_name, overrides) => {
    const step = stepEnvironment(overrides), transport = fetchFrom(githubScenario());
    expect(await runClassifierStep(step.env, transport.fetcher)).toMatchObject({ validated: false, reasonCode: 'invalid-context' });
    expect(readFileSync(step.output, 'utf8')).toBe('validated=false\nreason=invalid-context\n');
    expect(readFileSync(step.summary, 'utf8')).toContain('the full suite runs');
    expect(transport.requests).toHaveLength(0);
  });
  it.each([
    ['forced', JSON.stringify({ forced: true }), 'forced-push'],
    ['malformed-event', '{', 'push-event-unreadable'],
    ['missing-forced', JSON.stringify({ after: mergeSha }), 'push-event-unreadable'],
  ])('classifier-fail-open-step-%s reads the push event and refuses', async (_name, body, reasonCode) => {
    const step = stepEnvironment(); writeFileSync(step.event, body);
    expect(await runClassifierStep(step.env, fetchFrom(githubScenario()).fetcher)).toMatchObject({ validated: false, reasonCode });
    expect(readFileSync(step.output, 'utf8')).toBe(`validated=false\nreason=${reasonCode}\n`);
  });
  it('classifier-fail-open-step-no-event-file refuses without the event path', async () => {
    const step = stepEnvironment({ GITHUB_EVENT_PATH: undefined });
    expect(await runClassifierStep(step.env, fetchFrom(githubScenario()).fetcher)).toMatchObject({ validated: false, reasonCode: 'push-event-unreadable' });
  });
  it('classifier-fail-open-step-transport writes validated=false when every request fails', async () => {
    const step = stepEnvironment();
    expect(await runClassifierStep(step.env, async () => { throw new TypeError('fetch failed'); })).toMatchObject({ validated: false, reasonCode: 'api-error' });
    expect(readFileSync(step.output, 'utf8')).toBe('validated=false\nreason=api-error\n');
  });
  it('classifier-fail-open-step-oversized-body treats an oversized response as a read failure', async () => {
    const step = stepEnvironment();
    expect(await runClassifierStep(step.env, async () => new Response('x'.repeat(8 * 1024 * 1024 + 1)))).toMatchObject({ validated: false, reasonCode: 'api-error' });
  });
  it('never throws when the output files cannot be written', async () => {
    const step = stepEnvironment({ GITHUB_OUTPUT: tmpdir(), GITHUB_STEP_SUMMARY: tmpdir() });
    await expect(runClassifierStep(step.env, fetchFrom(githubScenario()).fetcher)).resolves.toMatchObject({ validated: true });
  });
  it('has no side effects when imported, even from an eval entry', () => {
    const step = stepEnvironment({ GH_TOKEN: undefined });
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(templatePath.href)});`], { env: { PATH: process.env['PATH'] ?? '', ...step.env } as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 30000 });
    expect(child.status).toBe(0); expect(readFileSync(step.output, 'utf8')).toBe(''); expect(child.stdout).toBe('');
  });
  it('runs the embedded step script from stdin, exits 0 and writes its outputs', () => {
    const step = stepEnvironment({ GH_TOKEN: undefined });
    const child = spawnSync(process.execPath, ['--input-type=module'], { input: CLASSIFIER_SOURCE, env: { PATH: process.env['PATH'] ?? '', ...step.env } as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 30000 });
    expect(child.status).toBe(0);
    expect(readFileSync(step.output, 'utf8')).toBe('validated=false\nreason=invalid-context\n');
    expect(child.stdout).toContain('cirujano-classifier validated=false reason=invalid-context');
  });
});

describe('classifier template identity', () => {
  const template = readFileSync(templatePath, 'utf8');
  it('classifier-template-source-in-sync: the step script is the template bytes plus the entry call', () => {
    expect(CLASSIFIER_SOURCE, 'run node scripts/optimization/generate-classifier-source.mjs').toBe(`${template}await main();\n`);
    expect(CLASSIFIER_DIGEST).toBe(sha256(CLASSIFIER_SOURCE));
  });
  it('embeds safely in a workflow run block', () => {
    expect(/^[\x20-\x7e\n]*$/.test(CLASSIFIER_SOURCE)).toBe(true);
    expect(template.endsWith('}\n')).toBe(true);
    expect(CLASSIFIER_SOURCE).not.toContain('${{');
    expect(CLASSIFIER_SOURCE).not.toContain('CIRUJANO_CLASSIFIER');
    expect(template).not.toContain('import.meta');
    expect([...template.matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1])).toEqual(['node:fs']);
    expect(template).not.toMatch(/\bimport\(/);
    expect(template).toContain(`const CLASSIFIER_JOB_ID = '${CLASSIFIER_JOB_ID}';`);
  });
});
