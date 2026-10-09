import { describe, expect, it } from 'vitest';
import { CLASSIFIER_DIGEST, decodePushArtifact, decodePushSourceManifest, gitBlobSha } from '@cirujano/core';
import { collectPushInput } from './github-read.js';
import { baseSha, branch, eligibleWorkflow, pushGithubFixture, repository, workflow } from './push-collect.test-helper.js';

const request = { repository, ref: baseSha, workflow, branch };
const identity = { toolSourceSha: '1'.repeat(40), bundleDigest: '2'.repeat(64) };
type Fixture = ReturnType<typeof pushGithubFixture>;
const listing = `repos/${repository}/actions/workflows/ci.yml/runs?branch=develop&event=push&status=completed&per_page=30`, firstJobs = `repos/${repository}/actions/runs/301/attempts/1/jobs?per_page=100&page=1`;
const endpoints = (fixture: Fixture) => fixture.calls.map(call => call.find(value => value.startsWith('repos/'))!);

describe('skip-validated-push collection', () => {
  it('collects the last pushes with billed minutes and the classifier verdict for each', async () => {
    const fixture = pushGithubFixture(), result = await collectPushInput(request, { ...identity, pageRunner: fixture.pageRunner });
    const input = decodePushArtifact('input', result.input);
    expect(result.reasonCode).toBe('collected');
    expect(input.history.map(({ pushRunId, billedMinutes, jobsBilled, validated, prNumber, reasonCode }) => ({ pushRunId, billedMinutes, jobsBilled, validated, prNumber, reasonCode }))).toEqual([
      { pushRunId: 301, billedMinutes: 5, jobsBilled: 1, validated: true, prNumber: 41, reasonCode: 'validated' },
      { pushRunId: 302, billedMinutes: 3, jobsBilled: 1, validated: false, prNumber: null, reasonCode: 'no-merged-pr' },
      { pushRunId: 303, billedMinutes: 4, jobsBilled: 1, validated: true, prNumber: 43, reasonCode: 'validated' },
    ]);
    expect(input.provenance).toMatchObject({ repositoryId: 123, baseSha, workflowPath: workflow, integrationBranch: branch, guardedJobIds: ['test'], classifierDigest: CLASSIFIER_DIGEST, workflowBlobSha: gitBlobSha(eligibleWorkflow), ...identity });
    expect(input.structuralFacts).toMatchObject({ validatedShare: 0.6667, validatedMinutes: 9, unvalidatedCount: 1, medianPushMinutes: 4, guardedJobCount: 1, treeSha: fixture.treeSha });
    expect(input.operations).toEqual([{ type: 'skip-validated-push', integrationBranch: branch, guardedJobIds: ['test'], classifierJobId: 'cirujano_validated_push' }]);
    expect(decodePushSourceManifest(result.source).files.map(file => file.path)).toEqual(['.cirujano/optimization-profile.json', '.github/workflows/ci.yml', '.github/workflows/release.yml']);
  });
  it('reads only bounded GET endpoints, never logs, and never fetches non-workflow source', async () => {
    const fixture = pushGithubFixture(); await collectPushInput(request, { ...identity, pageRunner: fixture.pageRunner, ghPath: '/trusted/gh' });
    expect(fixture.calls.every(call => call[0] === '/trusted/gh' && call.includes('GET') && !call.includes('--paginate'))).toBe(true);
    expect(endpoints(fixture).some(endpoint => endpoint.includes('/logs'))).toBe(false);
    expect(endpoints(fixture)).not.toContain(`repos/${repository}/git/blobs/${gitBlobSha(fixture.files['package.json']!)}`);
    expect(endpoints(fixture)).toContain(listing);
  });
  it('refuses an ineligible workflow without reading any run history', async () => {
    const fixture = pushGithubFixture(eligibleWorkflow.replace('permissions: read-all', 'permissions: write-all'));
    const result = await collectPushInput(request, { ...identity, pageRunner: fixture.pageRunner });
    expect(result).toMatchObject({ reasonCode: 'permissions-not-read-only', input: { status: 'unsupported', history: [], operations: [] } });
    expect(endpoints(fixture).some(endpoint => endpoint.includes('/actions/'))).toBe(false);
  });
  it('returns unsupported no-push-history when the branch has no completed pushes', async () => {
    const fixture = pushGithubFixture();
    fixture.responses[listing] = { total_count: 0, workflow_runs: [] };
    expect(await collectPushInput(request, { ...identity, pageRunner: fixture.pageRunner })).toMatchObject({ reasonCode: 'no-push-history', input: { status: 'unsupported' } });
  });
  it('records a read failure during classification as unvalidated rather than failing collection', async () => {
    const fixture = pushGithubFixture(); delete fixture.responses[`repos/${repository}/compare/${fixture.sha(43001)}...${fixture.sha(3031)}`];
    const result = await collectPushInput(request, { ...identity, pageRunner: fixture.pageRunner });
    expect(result.input.history[2]).toMatchObject({ validated: false, reasonCode: 'api-error', prNumber: 43 });
  });
  it.each([
    ['run-event', 'github-run-identity', (f: Fixture) => { f.runs[0]!.event = 'pull_request'; }],
    ['run-branch', 'github-run-identity', (f: Fixture) => { f.runs[0]!.head_branch = 'main'; }],
    ['run-path', 'github-run-identity', (f: Fixture) => { f.runs[0]!.path = '.github/workflows/other.yml'; }],
    ['run-in-progress', 'github-run-identity', (f: Fixture) => { f.runs[0]!.status = 'in_progress'; }],
    ['run-fork', 'github-run-identity', (f: Fixture) => { f.runs[0]!.head_repository = { id: 456, full_name: 'fork/benchmark', fork: true }; }],
    ['incomplete-listing', 'github-push-history-incomplete', (f: Fixture) => { (f.responses[listing] as { total_count: number }).total_count = 5; }],
    ['job-attempt', 'github-job-inventory', (f: Fixture) => { (f.responses[firstJobs] as { jobs: { run_attempt: number }[] }).jobs[0]!.run_attempt = 2; }],
    ['job-untimed', 'github-job-timing', (f: Fixture) => { (f.responses[firstJobs] as { jobs: { completed_at: string | null }[] }).jobs[0]!.completed_at = null; }],
    ['fork-repository', 'github-repository-identity', (f: Fixture) => { f.responses[`repos/${repository}`] = { id: 123, full_name: repository, fork: true }; }],
  ])('rejects %s with %s', async (_name, reason, mutate) => {
    const fixture = pushGithubFixture(); mutate(fixture);
    await expect(collectPushInput(request, { ...identity, pageRunner: fixture.pageRunner })).rejects.toThrow(reason);
  });
  it.each([
    ['.cirujano/optimization-profile.json', 'github-missing-verification-profile'],
    ['.github/workflows/ci.yml', 'github-missing-workflow'],
  ])('rejects a consistent tree without %s', async (path, reason) => {
    const fixture = pushGithubFixture(eligibleWorkflow, [path]);
    await expect(collectPushInput(request, { ...identity, pageRunner: fixture.pageRunner })).rejects.toThrow(reason);
  });
  it.each([
    ['branch', { ...request, branch: 'feature/*' }],
    ['ref', { ...request, ref: 'develop' }],
    ['workflow', { ...request, workflow: '.github/workflows/nested/ci.yml' }],
    ['repository', { ...request, repository: '../x' }],
  ])('validates the %s before any API call', async (_name, invalid) => {
    const fixture = pushGithubFixture();
    await expect(collectPushInput(invalid, { ...identity, pageRunner: fixture.pageRunner })).rejects.toThrow(/^github-invalid-/); expect(fixture.calls).toHaveLength(0);
  });
});
