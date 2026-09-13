import { describe, expect, it } from 'vitest';

import {
  GitHubAdapter,
  RegistrationToken,
  buildQueueSnapshot,
  classifyOwnedRunners,
  collectJobPages,
  collectRunPages,
  parseIncludedResponse,
  parseRegistrationTokenResponse,
  parseRepositoryResponse,
  parseRunnerPage,
  rateLimitBackoffMs,
  type ExternalProcess,
  type ProcessResult,
} from './github.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    workflow_id: 41,
    run_attempt: 2,
    status: 'queued',
    conclusion: null,
    event: 'push',
    head_branch: 'develop',
    head_sha: 'abc123',
    repository: { id: 123 },
    head_repository: { id: 123 },
    pull_requests: [],
    ...overrides,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 2001,
    run_id: 1001,
    head_sha: 'abc123',
    status: 'queued',
    conclusion: null,
    name: 'e2e',
    labels: ['self-hosted', 'cirujano-pilot-a'],
    runner_id: null,
    runner_name: null,
    runner_group_id: null,
    runner_group_name: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

describe('GitHub response parsers (R06)', () => {
  it('strictly accepts only the configured private, non-fork repository identity', () => {
    expect(parseRepositoryResponse({ id: 123, full_name: 'trusted/private', private: true, visibility: 'private', fork: false }))
      .toEqual({ id: 123, nameWithOwner: 'trusted/private', visibility: 'private', fork: false });

    for (const payload of [
      { id: 123, full_name: 'trusted/private', private: false, visibility: 'public', fork: false },
      { id: 123, full_name: 'trusted/private', private: true, visibility: 'private', fork: true },
      { id: '123', full_name: 'trusted/private', private: true, visibility: 'private', fork: false },
    ]) {
      expect(() => parseRepositoryResponse(payload)).toThrow();
    }
  });

  it('parses included headers without treating an error response as JSON data', () => {
    const response = parseIncludedResponse('HTTP/2 200\r\nlink: <https://api.github.test/items?page=2>; rel="next"\r\nx-ratelimit-remaining: 10\r\n\r\n{"items":[]}');
    expect(response.status).toBe(200);
    expect(response.headers.link).toContain('page=2');
    expect(response.body).toEqual({ items: [] });
    expect(parseIncludedResponse('HTTP/2 204\ncontent-length: 0\n\n').body).toBeNull();
    expect(() => parseIncludedResponse('HTTP/2 200\ncontent-type: application/json\n\n{broken')).toThrow();
  });

  it('deduplicates jobs only by exact run, current attempt, and job identity across pages', () => {
    const runs = collectRunPages([
      { page: 1, response: { status: 200, headers: { link: '<https://api.github.test/runs?page=2>; rel="next"' }, body: { total_count: 2, workflow_runs: [run()] } } },
      { page: 2, response: { status: 200, headers: {}, body: { total_count: 2, workflow_runs: [run({ id: 1002, run_attempt: 1 })] } } },
    ]);
    expect(runs.complete).toBe(true);

    const jobs = collectJobPages([
      { runId: 1001, runAttempt: 2, page: 1, response: { status: 200, headers: { link: '<https://api.github.test/jobs?page=2>; rel="next"' }, body: { total_count: 2, jobs: [job()] } } },
      { runId: 1001, runAttempt: 2, page: 2, response: { status: 200, headers: {}, body: { total_count: 2, jobs: [job(), job({ id: 2002 })] } } },
      { runId: 1001, runAttempt: 3, page: 1, response: { status: 200, headers: {}, body: { total_count: 1, jobs: [job()] } } },
    ]);
    expect(jobs.complete).toBe(true);
    expect(jobs.items.map((entry) => entry.key)).toEqual([
      '1001:2:2001', '1001:2:2002', '1001:3:2001',
    ]);
  });

  it.each([
    ['truncated run pages', [{ page: 1, response: { status: 200, headers: { link: '<https://api.github.test/runs?page=2>; rel="next"' }, body: { total_count: 2, workflow_runs: [run()] } } }]],
    ['page discontinuity', [{ page: 2, response: { status: 200, headers: {}, body: { total_count: 1, workflow_runs: [run()] } } }]],
    ['unknown run status', [{ page: 1, response: { status: 200, headers: {}, body: { total_count: 1, workflow_runs: [run({ status: 'mystery' })] } } }]],
    ['rate limit', [{ page: 1, response: { status: 429, headers: { 'retry-after': '7' }, body: {} } }]],
  ])('marks %s incomplete', (_name, pages) => {
    const result = collectRunPages(pages);
    expect(result.complete).toBe(false);
    expect(result.items).toEqual([]);
  });

  it('makes a snapshot incomplete and reports zero eligible jobs when any source is incomplete', () => {
    const result = buildQueueSnapshot({
      repository: { id: 123, nameWithOwner: 'trusted/private', visibility: 'private', fork: false },
      expectedRepository: { id: 123, nameWithOwner: 'trusted/private' },
      runs: collectRunPages([{ page: 1, response: { status: 200, headers: {}, body: { total_count: 1, workflow_runs: [run()] } } }]),
      jobs: { complete: false, items: [], retryAfterMs: 7_000, reason: 'rate limited' },
      runners: { complete: true, items: [] },
      workflowIds: [41],
      allowedBranch: 'develop',
      eligibleJobNames: ['e2e'],
      runnerLabel: 'cirujano-pilot-a',
      expectedRunnerName: 'cirujano-a-g1',
      observedAtMs: NOW,
    });
    expect(result).toMatchObject({ complete: false, eligibleQueuedJobs: 0, ownedBusy: null, retryAfterMs: 7_000 });
  });

  it('requires trusted event, no pull request, exact labels, current attempt and repository identity', () => {
    const runs = collectRunPages([{ page: 1, response: { status: 200, headers: {}, body: { total_count: 2, workflow_runs: [run(), run({ id: 1002, event: 'pull_request', pull_requests: [{ id: 9 }] })] } } }]);
    const jobs = collectJobPages([
      { runId: 1001, runAttempt: 2, page: 1, response: { status: 200, headers: {}, body: { total_count: 2, jobs: [job(), job({ id: 2002, labels: ['self-hosted'] })] } } },
      { runId: 1002, runAttempt: 2, page: 1, response: { status: 200, headers: {}, body: { total_count: 1, jobs: [job({ id: 3001, run_id: 1002 })] } } },
    ]);
    const snapshot = buildQueueSnapshot({
      repository: { id: 123, nameWithOwner: 'trusted/private', visibility: 'private', fork: false },
      expectedRepository: { id: 123, nameWithOwner: 'trusted/private' },
      runs, jobs, runners: { complete: true, items: [] }, workflowIds: [41],
      allowedBranch: 'develop', eligibleJobNames: ['e2e'], runnerLabel: 'cirujano-pilot-a', expectedRunnerName: 'cirujano-a-g1', observedAtMs: NOW,
    });
    expect(snapshot).toMatchObject({ complete: true, eligibleQueuedJobs: 1, ownedBusy: false });
  });

  it('ignores a stale attempt when an exact newer attempt for the run is present', () => {
    const runs = collectRunPages([{ page: 1, response: { status: 200, headers: {}, body: {
      total_count: 2, workflow_runs: [run({ run_attempt: 1 }), run()],
    } } }]);
    const jobs = collectJobPages([
      { runId: 1001, runAttempt: 1, page: 1, response: { status: 200, headers: {}, body: { total_count: 1, jobs: [job()] } } },
      { runId: 1001, runAttempt: 2, page: 1, response: { status: 200, headers: {}, body: { total_count: 1, jobs: [job({ id: 2002 })] } } },
    ]);
    const snapshot = buildQueueSnapshot({
      repository: { id: 123, nameWithOwner: 'trusted/private', visibility: 'private', fork: false },
      expectedRepository: { id: 123, nameWithOwner: 'trusted/private' },
      runs, jobs, runners: { complete: true, items: [] }, workflowIds: [41],
      allowedBranch: 'develop', eligibleJobNames: ['e2e'], runnerLabel: 'cirujano-pilot-a', expectedRunnerName: 'cirujano-a-g1', observedAtMs: NOW,
    });
    expect(snapshot.eligibleQueuedJobs).toBe(1);
  });

  it('treats the exact owned runner busy flag as busy before job mapping propagates', () => {
    const runs = collectRunPages([{ page: 1, response: { status: 200, headers: {}, body: { total_count: 0, workflow_runs: [] } } }]);
    const snapshot = buildQueueSnapshot({
      repository: { id: 123, nameWithOwner: 'trusted/private', visibility: 'private', fork: false },
      expectedRepository: { id: 123, nameWithOwner: 'trusted/private' },
      runs,
      jobs: { complete: true, items: [] },
      runners: { complete: true, items: [{ id: 7, name: 'cirujano-a-g1', os: 'linux', status: 'online', busy: true, labels: ['cirujano-pilot-a'] }] },
      workflowIds: [41],
      allowedBranch: 'develop', eligibleJobNames: ['e2e'], runnerLabel: 'cirujano-pilot-a',
      expectedRunnerName: 'cirujano-a-g1', journaledRunnerId: 7, observedAtMs: NOW,
    });
    expect(snapshot).toMatchObject({ complete: true, ownedBusy: true });
  });
});

describe('runner ownership and sensitive responses (R06)', () => {
  const runnerPayload = {
    total_count: 2,
    runners: [
      { id: 7, name: 'cirujano-a-g1', os: 'linux', status: 'online', busy: true, labels: [{ id: 1, name: 'cirujano-owner-a', type: 'custom' }] },
      { id: 8, name: 'unrelated', os: 'linux', status: 'offline', busy: false, labels: [] },
    ],
  };

  it('requires deterministic name, ownership label, and the journaled runner id when present', () => {
    const parsed = parseRunnerPage(runnerPayload);
    expect(classifyOwnedRunners(parsed, { expectedName: 'cirujano-a-g1', ownershipLabel: 'cirujano-owner-a', journaledRunnerId: 7 }).ownership).toBe('owned');
    expect(classifyOwnedRunners(parsed, { expectedName: 'cirujano-a-g1', ownershipLabel: 'cirujano-owner-a', journaledRunnerId: 8 }).ownership).toBe('foreign');
    expect(classifyOwnedRunners([...parsed, { ...parsed[0]!, id: 9 }], { expectedName: 'cirujano-a-g1', ownershipLabel: 'cirujano-owner-a' }).ownership).toBe('ambiguous');
  });

  it('keeps registration tokens out of JSON and inspection while allowing explicit consumption', () => {
    const token = parseRegistrationTokenResponse({ token: 'secret-registration-token', expires_at: '2026-09-13T13:00:00Z' });
    expect(token).toBeInstanceOf(RegistrationToken);
    expect(token.consume()).toBe('secret-registration-token');
    expect(JSON.stringify(token)).toBe('{"expiresAt":"2026-09-13T13:00:00Z","token":"[REDACTED]"}');
    expect(String(token)).toBe('[REDACTED GitHub registration token]');
  });

  it('uses manual pagination and exposes rate-limit backoff without retrying as an empty page', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const results: ProcessResult[] = [
      { exitCode: 0, stdout: 'HTTP/2 200\nlink: <https://api.github.test/runs?page=2>; rel="next"\n\n{"total_count":2,"workflow_runs":[' + JSON.stringify(run()) + ']}', stderr: '' },
      { exitCode: 1, stdout: 'HTTP/2 403\nretry-after: 4\nx-ratelimit-reset: 1789300809\n\n{"message":"rate limited"}', stderr: 'HTTP 403' },
    ];
    const process: ExternalProcess = {
      run: async (command, args) => {
        calls.push({ command, args });
        return results.shift()!;
      },
    };
    const adapter = new GitHubAdapter(process, { ghPath: '/opt/homebrew/bin/gh', timeoutMs: 5_000, now: () => NOW });
    const collected = await adapter.listRuns('trusted', 'private', 'queued');
    expect(collected).toMatchObject({ complete: false, items: [], retryAfterMs: 4_000 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ command: '/opt/homebrew/bin/gh' });
    expect(calls[0]!.args).toContain('X-GitHub-Api-Version: 2026-03-10');
    expect(calls[1]!.args).toContain('page=2');
  });

  it('unions every supported active run status and deduplicates the exact current attempt', async () => {
    const calls: readonly string[][] = [];
    const process: ExternalProcess = {
      run: async (_command, args) => {
        (calls as string[][]).push([...args]);
        return {
          exitCode: 0, stderr: '',
          stdout: `HTTP/2 200\n\n{"total_count":1,"workflow_runs":[${JSON.stringify(run())}]}`,
        };
      },
    };
    const result = await new GitHubAdapter(process, { ghPath: '/opt/homebrew/bin/gh', timeoutMs: 5_000 }).listActiveRuns('trusted', 'private');
    expect(result).toMatchObject({ complete: true });
    expect(result.items).toHaveLength(1);
    expect(calls.map((args) => args[args.indexOf('-f') + 1])).toEqual([
      'status=queued', 'status=in_progress', 'status=waiting', 'status=requested', 'status=pending',
    ]);
  });

  it('prefers Retry-After and otherwise uses the future rate reset', () => {
    expect(rateLimitBackoffMs(429, { 'retry-after': '3', 'x-ratelimit-reset': String((NOW / 1000) + 99) }, NOW)).toBe(3_000);
    expect(rateLimitBackoffMs(403, { 'x-ratelimit-reset': String((NOW / 1000) + 9) }, NOW)).toBe(9_000);
    expect(rateLimitBackoffMs(500, {}, NOW)).toBeNull();
  });

  it('rejects a relative gh path before any command can execute', () => {
    const process: ExternalProcess = { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) };
    expect(() => new GitHubAdapter(process, { ghPath: 'gh', timeoutMs: 5_000 })).toThrow('absolute');
  });
});
