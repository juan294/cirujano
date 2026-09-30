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

  it('normalizes GitHub queued-job zero and empty runner fields to null', () => {
    const jobs = collectJobPages([{
      runId: 1001,
      runAttempt: 2,
      page: 1,
      response: {
        status: 200,
        headers: {},
        body: {
          total_count: 1,
          jobs: [job({ runner_id: 0, runner_name: '', runner_group_id: 0, runner_group_name: '' })],
        },
      },
    }]);
    expect(jobs).toMatchObject({
      complete: true,
      items: [{ runnerId: null, runnerName: null, runnerGroupId: null, runnerGroupName: null }],
    });
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

  it('admits same-repository pull requests, pushes on any branch and schedules under the same-repository policy, never forks', () => {
    const runs = collectRunPages([{ page: 1, response: { status: 200, headers: {}, body: { total_count: 5, workflow_runs: [
      run({ id: 1002, event: 'pull_request', head_branch: 'feature/x', pull_requests: [{ id: 9 }] }),
      run({ id: 1003, event: 'pull_request', head_branch: 'feature/y', head_repository: { id: 999 }, pull_requests: [{ id: 10 }] }),
      run({ id: 1004, event: 'push', head_branch: 'feature/z' }),
      run({ id: 1005, event: 'schedule' }),
      run({ id: 1006, event: 'push', pull_requests: [{ id: 11 }] }),
    ] } } }]);
    const jobs = collectJobPages([1002, 1003, 1004, 1005, 1006].map((runId, index) => (
      { runId, runAttempt: 2, page: 1, response: { status: 200, headers: {}, body: { total_count: 1, jobs: [job({ id: 4000 + index, run_id: runId })] } } }
    )));
    const base = {
      repository: { id: 123, nameWithOwner: 'trusted/private' as const, visibility: 'private' as const, fork: false as const },
      expectedRepository: { id: 123, nameWithOwner: 'trusted/private' },
      runs, jobs, runners: { complete: true, items: [] }, workflowIds: [41],
      allowedBranch: 'develop', eligibleJobNames: ['e2e'], runnerLabel: 'cirujano-pilot-a', expectedRunnerName: 'cirujano-a-g1', observedAtMs: NOW,
    };
    // Same-repository PR (1002), the push on another branch (1004), the schedule (1005: the enrolled repository's own
    // default branch, so the nightly check keeps a runner after cutover) and the default-branch push with an open PR
    // (1006) are admitted; the fork PR is not. The default policy refuses all of them: 1006 only because of its pull
    // request, which pins that term on its own.
    expect(buildQueueSnapshot({ ...base, admission: 'same-repository' })).toMatchObject({ complete: true, eligibleQueuedJobs: 4 });
    expect(buildQueueSnapshot({ ...base, admission: 'default-branch-pushes' })).toMatchObject({ complete: true, eligibleQueuedJobs: 0 });
    expect(buildQueueSnapshot(base)).toMatchObject({ complete: true, eligibleQueuedJobs: 0 });
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

  it('names the redacted stderr tail when gh exits without a response', async () => {
    const process: ExternalProcess = { run: async () => ({ exitCode: 1, stdout: '', stderr: 'gh: keyring unavailable token=ghp_' + 'a'.repeat(36) + '\n' }) };
    const adapter = new GitHubAdapter(process, { ghPath: '/opt/homebrew/bin/gh', timeoutMs: 5_000 });
    await expect(adapter.repository('trusted', 'private')).rejects.toThrow(/gh exited 1 without a parseable response: gh: keyring unavailable token=\[REDACTED\]/u);
    const silent: ExternalProcess = { run: async () => ({ exitCode: 1, stdout: '', stderr: '' }) };
    await expect(new GitHubAdapter(silent, { ghPath: '/opt/homebrew/bin/gh', timeoutMs: 5_000 }).repository('trusted', 'private')).rejects.toThrow(/without a parseable response \(no stderr\)/u);
  });

  it('rejects a relative gh path before any command can execute', () => {
    const process: ExternalProcess = { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) };
    expect(() => new GitHubAdapter(process, { ghPath: 'gh', timeoutMs: 5_000 })).toThrow('absolute');
  });
});

describe('GitHub conditional reads and quota guard', () => {
  const repository = { id: 123, full_name: 'trusted/private', private: true, visibility: 'private', fork: false };
  function reply(status: number, body: unknown = null, headers: Record<string, string> = {}, exitCode = 0): ProcessResult {
    return { exitCode, stderr: '', stdout: `HTTP/2 ${status}\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n${body === null ? '' : JSON.stringify(body)}`.replace('\n\n\n', '\n\n') };
  }
  function fixture(results: ProcessResult[]) {
    const calls: string[][] = [];
    let now = NOW;
    const adapter = new GitHubAdapter({ run: async (_command, args) => { calls.push([...args]); const result = results.shift(); if (!result) throw new Error('unexpected dispatch'); return result; } }, { ghPath: '/bin/gh', timeoutMs: 1000, now: () => now });
    return { adapter, calls, advance: (ms: number) => { now += ms; } };
  }
  it('revalidates repository identity with a matched exit-1 304', async () => {
    const { adapter, calls } = fixture([reply(200, repository, { etag: '"one"' }), reply(304, null, {}, 1)]);
    await adapter.repository('trusted', 'private');
    expect(await adapter.repository('trusted', 'private')).toMatchObject({ id: 123 });
    expect(calls[1]).toContain('If-None-Match: "one"');
  });
  it('revalidates every pagination page and preserves omitted Link on 304', async () => {
    const first = { total_count: 2, workflow_runs: [run()] };
    const second = { total_count: 2, workflow_runs: [run({ id: 1002 })] };
    const { adapter, calls } = fixture([reply(200, first, { etag: '"p1"', link: '<https://api.github.test/runs?page=2>; rel="next"' }), reply(200, second, { etag: '"p2"' }), reply(304), reply(304)]);
    expect((await adapter.listRuns('trusted', 'private', 'queued')).complete).toBe(true);
    expect((await adapter.listRuns('trusted', 'private', 'queued')).items).toHaveLength(2);
    expect(calls[2]).toContain('If-None-Match: "p1"');
    expect(calls[3]).toContain('If-None-Match: "p2"');
  });
  it('replaces pagination and validator metadata on a new 200', async () => {
    const empty = { total_count: 0, workflow_runs: [] };
    const { adapter, calls } = fixture([reply(200, empty, { etag: '"old"' }), reply(200, empty), reply(200, empty)]);
    for (let i = 0; i < 3; i++) expect((await adapter.listRuns('trusted', 'private', 'queued')).complete).toBe(true);
    expect(calls[1]).toContain('If-None-Match: "old"');
    expect(calls[2]!.some((arg) => arg.startsWith('If-None-Match:'))).toBe(false);
  });
  it.each([reply(304), reply(200, repository, { etag: '"bad"' }, 1), reply(500, { message: 'failed' }), { exitCode: 1, stdout: '', stderr: 'failed' }])('never returns stale success for invalid responses', async (failure) => {
    const { adapter } = fixture([reply(200, repository), failure]);
    await adapter.repository('trusted', 'private');
    await expect(adapter.repository('trusted', 'private')).rejects.toThrow();
  });
  it('uses only fresh quota headers on 304 and blocks reads until reset', async () => {
    const { adapter, calls, advance } = fixture([reply(200, repository, { etag: '"one"', 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '4000' }), reply(304, null, { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '2000', 'x-ratelimit-reset': String(NOW / 1000 + 120) }), reply(304)]);
    await adapter.repository('trusted', 'private'); await adapter.repository('trusted', 'private');
    expect(adapter.readHold()).toMatchObject({ retryAfterMs: 120_000, retryAtMs: NOW + 120_000 });
    expect(await adapter.listRuns('trusted', 'private', 'queued')).toMatchObject({ complete: false, items: [], retryAfterMs: 120_000 });
    expect(calls).toHaveLength(2);
    advance(120_000);
    await adapter.repository('trusted', 'private');
    expect(adapter.readHold()).toBeNull();
  });
  it('ignores unrelated resources, uses reserve fallback, and escalates repeated unhinted throttles', async () => {
    const { adapter, advance } = fixture([reply(200, repository, { 'x-ratelimit-resource': 'search', 'x-ratelimit-remaining': '0' }), reply(200, repository, { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '1' }), reply(429, {}), reply(429, {})]);
    await adapter.repository('trusted', 'private'); expect(adapter.readHold()).toBeNull();
    await adapter.repository('trusted', 'private'); expect(adapter.readHold()?.retryAfterMs).toBe(60_000);
    advance(60_000); await expect(adapter.repository('trusted', 'private')).rejects.toThrow(); expect(adapter.readHold()?.retryAfterMs).toBe(60_000);
    advance(60_000); await expect(adapter.repository('trusted', 'private')).rejects.toThrow(); expect(adapter.readHold()?.retryAfterMs).toBe(120_000);
  });
  it('separates status and attempt identities and revalidates jobs and runners', async () => {
    const jobs = { total_count: 1, jobs: [job()] }; const runners = { total_count: 0, runners: [] }; const runs = { total_count: 0, workflow_runs: [] };
    const { adapter, calls } = fixture([reply(200, runs, { etag: '"queued"' }), reply(200, runs), reply(200, jobs, { etag: '"jobs"' }), reply(200, jobs), reply(304), reply(200, runners, { etag: '"runners"' }), reply(304)]);
    await adapter.listRuns('trusted', 'private', 'queued'); await adapter.listRuns('trusted', 'private', 'pending');
    await adapter.listJobs('trusted', 'private', 1001, 2); await adapter.listJobs('trusted', 'private', 1001, 3);
    expect((await adapter.listJobs('trusted', 'private', 1001, 2)).items).toHaveLength(1);
    await adapter.listRunners('trusted', 'private'); expect((await adapter.listRunners('trusted', 'private')).complete).toBe(true);
    for (const i of [1, 3]) expect(calls[i]!.some((arg) => arg.startsWith('If-None-Match:'))).toBe(false);
    expect(calls[4]).toContain('If-None-Match: "jobs"'); expect(calls[6]).toContain('If-None-Match: "runners"');
  });
  it('evicts oldest entries and never retains an oversized representation', async () => {
    const results = Array.from({ length: 130 }, () => reply(200, repository, { etag: '"one"' }));
    results.push(reply(200, { ...repository, padding: 'x'.repeat(8 * 1024 * 1024) }, { etag: '"large"' }), reply(200, repository));
    const { adapter, calls } = fixture(results);
    for (let i = 0; i < 129; i++) await adapter.repository('trusted', `repo${i}`);
    await adapter.repository('trusted', 'repo0'); await adapter.repository('trusted', 'large'); await adapter.repository('trusted', 'large');
    expect(calls[129]!.some((arg) => arg.startsWith('If-None-Match:'))).toBe(false);
    expect(calls[131]!.some((arg) => arg.startsWith('If-None-Match:'))).toBe(false);
  });
  it('does not shorten a hold when concurrent responses arrive out of order', async () => {
    const pending: Array<(value: ProcessResult) => void> = [];
    const adapter = new GitHubAdapter({ run: async () => new Promise((resolve) => { pending.push(resolve); }) }, { ghPath: '/bin/gh', timeoutMs: 1000, now: () => NOW });
    const first = adapter.repository('trusted', 'first'); const second = adapter.repository('trusted', 'second');
    pending[0]!(reply(200, repository, { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': String(NOW / 1000 + 120) })); await first;
    pending[1]!(reply(200, repository, { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '1000' })); await second;
    expect(adapter.readHold()?.retryAfterMs).toBe(120_000);
  });
  it('does not cache mutations and invalidates cached runner lists after registration', async () => {
    const { adapter, calls } = fixture([reply(200, { total_count: 0, runners: [] }, { etag: '"runners"' }), reply(201, { token: 'secret', expires_at: '2026-10-01T00:00:00Z' }, { etag: '"token"' }), reply(201, { token: 'secret', expires_at: '2026-10-01T00:00:00Z' }), reply(200, { total_count: 0, runners: [] })]);
    await adapter.listRunners('trusted', 'private'); await adapter.createRegistrationToken('trusted', 'private'); await adapter.createRegistrationToken('trusted', 'private'); await adapter.listRunners('trusted', 'private');
    for (const i of [1, 2, 3]) expect(calls[i]!.some((arg) => arg.startsWith('If-None-Match:'))).toBe(false);
  });
  it.each([reply(500, {}), reply(403, {}, { 'retry-after': '9' }, 1), { exitCode: 0, stdout: 'HTTP/2 200\n\n{broken', stderr: '' }])('refuses cached evidence after a failed revalidation', async (failure) => {
    const { adapter } = fixture([reply(200, repository, { etag: '"old"' }), failure]);
    await adapter.repository('trusted', 'private');
    await expect(adapter.repository('trusted', 'private')).rejects.toThrow();
  });
  it('replaces an old pagination Link and changed ETag after a new 200', async () => {
    const { adapter, calls } = fixture([
      reply(200, { total_count: 2, workflow_runs: [run()] }, { etag: '"old"', link: '<https://api.github.test/runs?page=2>; rel="next"' }),
      reply(200, { total_count: 2, workflow_runs: [run({ id: 1002 })] }),
      reply(200, { total_count: 0, workflow_runs: [] }, { etag: '"new"' }), reply(304),
    ]);
    await adapter.listRuns('trusted', 'private', 'queued');
    expect((await adapter.listRuns('trusted', 'private', 'queued')).items).toHaveLength(0);
    expect((await adapter.listRuns('trusted', 'private', 'queued')).complete).toBe(true);
    expect(calls).toHaveLength(4); expect(calls[3]).toContain('If-None-Match: "new"');
  });
  it('enforces the total cache byte bound independently of entry count', async () => {
    const large = { ...repository, padding: 'x'.repeat(3 * 1024 * 1024) };
    const { adapter, calls } = fixture([reply(200, large, { etag: '"a"' }), reply(200, large, { etag: '"b"' }), reply(200, large, { etag: '"c"' }), reply(200, repository)]);
    for (const name of ['a', 'b', 'c', 'a']) await adapter.repository('trusted', name);
    expect(calls[3]!.some((arg) => arg.startsWith('If-None-Match:'))).toBe(false);
  });
  it('invalidates runner listings after guarded removal and leaves mutations unblocked', async () => {
    const runner = { id: 9, name: 'owned', os: 'linux', status: 'online' as const, busy: false, labels: ['owned'] };
    const { adapter, calls, advance } = fixture([reply(200, { total_count: 0, runners: [] }, { etag: '"runners"', 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '1' }), reply(204), reply(200, { total_count: 0, runners: [] })]);
    await adapter.listRunners('trusted', 'private');
    await adapter.removeOwnedRunner('trusted', 'private', { ownership: 'owned', matches: [runner], runner });
    expect(calls[1]).toContain('DELETE');
    advance(60_000); await adapter.listRunners('trusted', 'private');
    expect(calls[2]!.some((arg) => arg.startsWith('If-None-Match:'))).toBe(false);
  });
  it('does not mark changing pagination totals complete during mixed revalidation', async () => {
    const first = { total_count: 2, workflow_runs: [run()] };
    const { adapter } = fixture([
      reply(200, first, { etag: '"first"', link: '<https://api.github.test/runs?page=2>; rel="next"' }), reply(200, { total_count: 2, workflow_runs: [run({ id: 1002 })] }),
      reply(304), reply(200, { total_count: 3, workflow_runs: [run({ id: 1002 })] }),
    ]);
    await adapter.listRuns('trusted', 'private', 'queued');
    expect(await adapter.listRuns('trusted', 'private', 'queued')).toMatchObject({ complete: false, items: [], reason: 'pagination total_count changed between pages' });
  });

  it.each([403, 429, 200])('records trustworthy quota headers before rejecting malformed HTTP %s bodies', async (status) => {
    const { adapter, calls } = fixture([{ exitCode: status === 200 ? 0 : 1, stderr: '', stdout: `HTTP/2 ${status}\nretry-after: 120\nx-ratelimit-resource: core\nx-ratelimit-remaining: 1000\nx-ratelimit-reset: ${NOW / 1000 + 120}\n\n<html>not JSON</html>` }]);
    await expect(adapter.repository('trusted', 'private')).rejects.toThrow('not valid JSON');
    expect(adapter.readHold()).toMatchObject({ retryAfterMs: 120_000 });
    expect(await adapter.listRuns('trusted', 'private', 'queued')).toMatchObject({ complete: false, retryAfterMs: 120_000 });
    expect(calls).toHaveLength(1);
  });
  it('rejects a nonempty 304 response even with a matching cached representation', async () => {
    const { adapter } = fixture([reply(200, repository, { etag: '"one"' }), reply(304, { ignored: true })]);
    await adapter.repository('trusted', 'private');
    await expect(adapter.repository('trusted', 'private')).rejects.toThrow('304 response body must be empty');
  });

});
