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
    }, [0, 0]);
    expect(pages).toEqual([{ total_count: 1 }]);
    expect(attempts).toBe(2);
  });

  const failing = (failure: () => never, failures: number) => {
    let attempts = 0;
    const runner = async () => { attempts += 1; if (attempts <= failures) failure(); return { stdout: '[{"total_count":1}]' }; };
    return { runner, attempts: () => attempts };
  };
  const gh = (stderr: string) => () => { throw Object.assign(new Error('gh exited 1'), { stderr }); };
  it.each([
    ['unexpected EOF', gh('Get "https://api.github.com/repos/x": unexpected EOF')],
    ['server error', gh('gh: Server Error (HTTP 502)')],
    ['HTTP 503', gh('HTTP 503: Service Unavailable')],
    ['connection reset', gh('read tcp 10.0.0.1:1->140.82.1.1:443: read: connection reset by peer')],
    ['truncated JSON', () => { throw new SyntaxError('Unexpected end of JSON input'); }],
  ])('retries a transient %s up to three attempts', async (_name, failure) => {
    const twice = failing(failure, 2);
    await expect(githubPages('/usr/bin/gh', '/repos/example/actions/runs', twice.runner, [0, 0])).resolves.toEqual([{ total_count: 1 }]);
    expect(twice.attempts()).toBe(3);
    const always = failing(failure, 3);
    await expect(githubPages('/usr/bin/gh', '/repos/example/actions/runs', always.runner, [0, 0])).rejects.toThrow();
    expect(always.attempts()).toBe(3);
  });
  it('treats truncated page output as transient', async () => {
    let attempts = 0;
    const pages = await githubPages('/usr/bin/gh', '/repos/example/actions/runs', async () => ({ stdout: ++attempts === 1 ? '[{"total_count":' : '[{"total_count":1}]' }), [0, 0]);
    expect(pages).toEqual([{ total_count: 1 }]); expect(attempts).toBe(2);
  });
  it('retries a killed read with a longer timeout each time and names the endpoint when it gives up', async () => {
    const timeouts: number[] = [];
    await expect(githubPages('/usr/bin/gh', '/repos/example/actions/runs', async (_command, _args, options) => { timeouts.push(options.timeout); throw Object.assign(new Error('Command failed: gh api'), { killed: true, signal: 'SIGTERM', stderr: '' }); }, [0, 0]))
      .rejects.toThrow('/repos/example/actions/runs: Command failed: gh api (3 attempts, killed, signal SIGTERM)');
    expect(timeouts).toEqual([120_000, 240_000, 240_000]);
  });
  it.each(['unexpected end of JSON input', 'stream error: stream ID 3; INTERNAL_ERROR', 'Client.Timeout exceeded while awaiting headers'])('retries the gh transport failure %s', async stderr => {
    const transient = failing(gh(stderr), 1);
    await expect(githubPages('/usr/bin/gh', '/repos/example/actions/runs', transient.runner, [0, 0])).resolves.toEqual([{ total_count: 1 }]);
  });
  it('does not mistake a status-like number in the endpoint for a server error', async () => {
    const missing = failing(() => { throw Object.assign(new Error('Command failed: gh api repos/x/api-503/contents/.github/workflows/http-502.yml'), { stderr: 'gh: Not Found (HTTP 404)' }); }, 3);
    await expect(githubPages('/usr/bin/gh', '/repos/x/api-503/contents/.github/workflows/http-502.yml', missing.runner, [0, 0])).rejects.toThrow('http-502.yml');
    expect(missing.attempts()).toBe(1);
  });
  it('does not retry a missing resource', async () => {
    const missing = failing(gh('gh: Not Found (HTTP 404)'), 3);
    await expect(githubPages('/usr/bin/gh', '/repos/example/actions/runs', missing.runner, [0, 0])).rejects.toThrow('gh exited 1');
    expect(missing.attempts()).toBe(1);
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
