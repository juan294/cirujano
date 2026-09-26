import { describe, expect, it } from 'vitest';

import { githubPages } from './github-api.js';

describe('GitHub paginated reads', () => {
  it('retries a transient TLS handshake timeout from gh once', async () => {
    let attempts = 0;
    const pages = await githubPages('/usr/bin/gh', '/repos/example/actions/runs', async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error('gh exited 1'), { stderr: 'Get "https://api.github.com": net/http: TLS handshake timeout' });
      }
      return { stdout: '[{"total_count":1}]' };
    });
    expect(pages).toEqual([{ total_count: 1 }]);
    expect(attempts).toBe(2);
  });

  it('does not retry authorization failures', async () => {
    let attempts = 0;
    await expect(githubPages('/usr/bin/gh', '/repos/example/actions/runs', async () => {
      attempts += 1;
      throw Object.assign(new Error('gh exited 1'), { stderr: 'HTTP 403: Resource not accessible by integration' });
    })).rejects.toThrow('gh exited 1');
    expect(attempts).toBe(1);
  });
});
