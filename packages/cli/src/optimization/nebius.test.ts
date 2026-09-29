import { describe, expect, it } from 'vitest';
import { diagnoseOptimization } from './diagnose.js';
import { config, inputFixture, permitFixture, transportFixture, responseFixture, model, endpoint } from './nebius.test-helper.js';

describe('Nebius external transport boundary', () => {
  it('rejects credential-valued finish_reason before retaining it', async () => {
    const input = inputFixture(), response = responseFixture(); response.choices[0]!.finish_reason = 'synthetic-provider-key'; const transport = transportFixture(response);
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'synthetic-provider-key', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.status).toBe('failed'); expect(result.inference?.finishReason).toBeNull(); expect(JSON.stringify(result)).not.toContain('synthetic-provider-key');
  });
  it('uses exact authorization destination and strict bounded request', async () => {
    const input = inputFixture(), transport = transportFixture();
    await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'source-specific-key', fetch: transport.fetcher, beforePost: async () => {} });
    const post = transport.calls[1]!; expect(post.url).toBe(endpoint); expect(post.init?.redirect).toBe('error'); expect(post.init?.headers).toEqual({ Authorization: 'Bearer source-specific-key', 'Content-Type': 'application/json' });
    const body = JSON.parse(String(post.init?.body)); expect(body).toMatchObject({ model, store: false, stream: false, temperature: 0, max_completion_tokens: 2048, response_format: { type: 'json_schema', json_schema: { strict: true, schema: { additionalProperties: false } } } });
  });
  it.each([401, 403, 429, 500, 503, 302])('never retries status %s', async (status) => {
    const input = inputFixture(), transport = transportFixture({ secret: 'never expose provider body' }, status);
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.status).toBe('failed'); expect(result.reasonCode).toBe(`provider-http-${status}`); expect(result.diagnosis).toBeUndefined(); expect(transport.calls.filter(call => call.init?.method === 'POST')).toHaveLength(1); expect(JSON.stringify(result)).not.toContain('never expose');
  });
  it.each(['refusal', 'truncation', 'model-mismatch', 'negative-usage', 'token-overrun', 'malformed-envelope', 'oversized-response'])('rejects %s with one POST', async (failure) => {
    const response = responseFixture();
    if (failure === 'refusal') response.choices[0]!.message.refusal = 'refused' as never;
    if (failure === 'truncation') response.choices[0]!.finish_reason = 'length';
    if (failure === 'model-mismatch') response.model = 'other/model';
    if (failure === 'negative-usage') response.usage.prompt_tokens = -1;
    if (failure === 'token-overrun') { response.usage.completion_tokens = 2049; response.usage.total_tokens = 2149; }
    const transport = transportFixture(failure === 'malformed-envelope' ? '{}' : failure === 'oversized-response' ? 'x'.repeat(262145) : response), input = inputFixture();
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.status).toBe('failed'); expect(result.diagnosis).toBeUndefined(); expect(transport.calls.filter(call => call.init?.method === 'POST')).toHaveLength(1);
  });
  it('marks missing usage unavailable while retaining an accepted response', async () => {
    const response = responseFixture(); delete (response as { usage?: unknown }).usage;
    const transport = transportFixture(response), input = inputFixture();
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.status).toBe('proposal'); expect(result.inference?.usage).toBeNull(); expect(result.inference?.costStatus).toBe('unavailable');
  });
  it('times out exactly one POST with uncertain spend and no retry', async () => {
    const input = inputFixture(); let posts = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      if (init?.method === 'GET') return new Response(JSON.stringify({ data: [{ id: model }] }));
      posts++; return new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('provider credential body secret')), { once: true }); });
    };
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: fetcher, beforePost: async () => {}, timeoutMs: 10 });
    expect(posts).toBe(1); expect(result.status).toBe('outcome-unknown'); expect(result.reasonCode).toBe('provider-outcome-unknown'); expect(result.inference?.costStatus).toBe('unknown'); expect(result.diagnosis).toBeUndefined();
  });
  it('enforces the deadline even if the injected external transport ignores abort', async () => {
    const input = inputFixture(); let posts = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      if (init?.method === 'GET') return new Response(JSON.stringify({ data: [{ id: model }] }));
      posts++; return new Promise(() => {});
    };
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: fetcher, beforePost: async () => {}, timeoutMs: 10 });
    expect(posts).toBe(1); expect(result.status).toBe('outcome-unknown');
  }, 200);
  it('bounds a stalled intent persistence hook without emitting POST', async () => {
    const input = inputFixture(), transport = transportFixture();
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => new Promise(() => {}), timeoutMs: 10 });
    expect(result.reasonCode).toBe('inference-preflight-failed'); expect(transport.calls).toHaveLength(1);
  }, 200);
  it.each(['scope', 'expiry', 'class', 'extra', 'host', 'cap'])('rejects %s permit before any transport', async (failure) => {
    const input = inputFixture(), permit = permitFixture(input), transport = transportFixture();
    const invalid = { ...permit, ...(failure === 'scope' ? { inputDigest: '0'.repeat(64) } : failure === 'expiry' ? { expiresAt: '2020-01-01T00:00:00.000Z' } : failure === 'class' ? { kind: 'sandbox-permit' } : failure === 'extra' ? { extra: true } : failure === 'host' ? { endpoint: 'https://evil.test/v1/chat/completions' } : { maxRequests: 2 }) };
    const result = await diagnoseOptimization(input, config, invalid, { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.reasonCode).toBe('invalid-inference-permit'); expect(transport.calls).toHaveLength(0);
  });
  it('blocks unavailable models before any POST', async () => {
    const input = inputFixture(); let posts = 0;
    const fetcher: typeof fetch = async (_url, init) => { if (init?.method === 'POST') posts++; return new Response(JSON.stringify({ data: [{ id: 'other-model' }] })); };
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: fetcher, beforePost: async () => {} });
    expect(result.reasonCode).toBe('model-unavailable'); expect(posts).toBe(0);
  });
  it('stops before POST when persistent intent fails', async () => {
    const input = inputFixture(), transport = transportFixture();
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => { throw new Error('disk failure with secret'); } });
    expect(result.reasonCode).toBe('inference-preflight-failed'); expect(transport.calls).toHaveLength(1); expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('records bounded quote-based cost without representing an invoice', async () => {
    const input = inputFixture(), transport = transportFixture(), permit = { ...permitFixture(input), priceBasis: { quoteIdentity: 'owner-quote-1', quotedAt: '2026-01-01T00:00:00.000Z', source: 'https://example.test/reviewed-price', currency: 'USD', inputUsdPerMillion: 1, outputUsdPerMillion: 2, maxCostUsd: 1 } };
    const result = await diagnoseOptimization(input, config, permit, { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.inference?.costStatus).toBe('known'); expect(result.inference?.cost).toEqual({ amount: 0.00016, currency: 'USD' }); expect(result.inference?.quoteIdentity).toBe('owner-quote-1');
  });
  it('requires enough monetary authority for worst-case byte/token reservation', async () => {
    const input = inputFixture(), transport = transportFixture(), permit = { ...permitFixture(input), priceBasis: { quoteIdentity: 'owner-quote-1', quotedAt: '2026-01-01T00:00:00.000Z', source: 'https://example.test/reviewed-price', currency: 'USD', inputUsdPerMillion: 1, outputUsdPerMillion: 2, maxCostUsd: 0.000001 } };
    const result = await diagnoseOptimization(input, config, permit, { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.reasonCode).toBe('invalid-inference-permit'); expect(transport.calls).toHaveLength(0);
  });
  it('never stores credential-valued response receipt fields', async () => {
    const input = inputFixture(), response = responseFixture(); response.id = 'secret'; const transport = transportFixture(response);
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.status).toBe('failed'); expect(JSON.stringify(result)).not.toContain('secret');
  });
});
