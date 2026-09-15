import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  core: {
    getInput: vi.fn(),
    setFailed: vi.fn(),
    setOutput: vi.fn(),
    info: vi.fn(),
  },
  github: {
    context: {
      runId: 77,
      repo: { owner: 'juan294', repo: 'cirujano' },
    },
    getOctokit: vi.fn(),
  },
}));

vi.mock('@actions/core', () => mocks.core);
vi.mock('@actions/github', () => mocks.github);

import { runAction } from './main.js';

describe('runAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.core.getInput.mockImplementation((name: string) => name === 'github-token' ? 'ghs_test' : '');
  });

  it('reports billable minutes for the current workflow run', async () => {
    const listJobsForWorkflowRun = vi.fn();
    const paginate = vi.fn().mockResolvedValue([
      { name: 'checks', started_at: '2026-09-15T10:00:00Z', completed_at: '2026-09-15T10:01:01Z' },
      { name: 'queued', started_at: null, completed_at: null },
    ]);
    const octokit = { paginate, rest: { actions: { listJobsForWorkflowRun } } };
    mocks.github.getOctokit.mockReturnValue(octokit);

    await runAction();

    expect(mocks.github.getOctokit).toHaveBeenCalledWith('ghs_test');
    expect(paginate).toHaveBeenCalledWith(listJobsForWorkflowRun, {
      owner: 'juan294', repo: 'cirujano', run_id: 77, per_page: 100,
    });
    expect(mocks.core.setOutput).toHaveBeenNthCalledWith(1, 'billable-minutes', '2');
    expect(mocks.core.setOutput).toHaveBeenNthCalledWith(2, 'job-count', '1');
    expect(mocks.core.info).toHaveBeenCalledWith('Run 77: 2 billable minutes across 1 jobs (1 not yet complete)');
    expect(mocks.core.setFailed).not.toHaveBeenCalled();
  });

  it('fails through the Action API when inputs are invalid', async () => {
    mocks.core.getInput.mockReturnValue('');

    await runAction();

    expect(mocks.core.setFailed).toHaveBeenCalledWith('Invalid input: github-token is required.');
    expect(mocks.github.getOctokit).not.toHaveBeenCalled();
  });

  it('sanitizes provider failures through the Action API', async () => {
    const paginate = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    mocks.github.getOctokit.mockReturnValue({
      paginate,
      rest: { actions: { listJobsForWorkflowRun: vi.fn() } },
    });

    await runAction();

    expect(mocks.core.setFailed).toHaveBeenCalledWith('provider unavailable');
  });
});
