import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from './canonical.js';
import { CLASSIFIER_DIGEST, CLASSIFIER_SOURCE, classifyPush, runClassifierStep } from './push-classifier.js';
import { CLASSIFIER_JOB_ID } from './push-guard.js';
import { classifierCases, failOpenCases, NULL_BODY_STATUSES, githubScenario, headSha, mergeSha, repository, repositoryId, workflowPath, type Scenario } from './push-classifier-cases.js';

const templatePath = new URL('./push-classifier.template.mjs', import.meta.url);
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

  it.each(failOpenCases)('classifier-fail-open-%s gives false with reason %s', async (_name, reasonCode, mutate) => {
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

describe('classifier cases as data', () => {
  it('classifier-cases-as-data: every case gives the same verdict through the workflow step', async () => {
    const cases = classifierCases();
    expect(cases).toHaveLength(failOpenCases.length + 2); expect(new Set(cases.map(c => c.name)).size).toBe(cases.length);
    for (const testCase of cases) {
      const directory = mkdtempSync(join(tmpdir(), 'cirujano-classifier-case-')); directories.push(directory);
      const event = join(directory, 'event.json'), output = join(directory, 'output'); writeFileSync(event, testCase.event); writeFileSync(output, '');
      const fetcher: typeof fetch = async url => {
        const response = testCase.responses[String(url).replace('https://api.github.com/', '')];
        if (!response) return new Response('{"message":"Not Found"}', { status: 404 });
        if ('error' in response) throw response.error === 'TimeoutError' ? new DOMException('timed out', 'TimeoutError') : new TypeError('fetch failed');
        return new Response(NULL_BODY_STATUSES.includes(response.status) ? null : response.body, { status: response.status });
      };
      const result = await runClassifierStep({ ...testCase.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output }, fetcher);
      expect({ validated: result.validated, reasonCode: result.reasonCode }, testCase.name).toEqual(testCase.expected);
    }
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
