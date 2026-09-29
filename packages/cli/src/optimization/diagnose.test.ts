import { describe, expect, it } from 'vitest';
import { diagnoseOptimization } from './diagnose.js';
import { config, inputFixture, permitFixture, transportFixture, responseFixture, decisionFixture } from './nebius.test-helper.js';

describe('bounded model diagnosis', () => {
  it.each(['empty-baseline', 'wrong-operation-target', 'missing-operation'])('rejects %s before availability or inference', async (failure) => {
    const input = inputFixture(), transport = transportFixture();
    if (failure === 'empty-baseline') input.baselines = [];
    if (failure === 'wrong-operation-target') input.operations[0]!.jobId = 'different';
    if (failure === 'missing-operation') input.operations = [];
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.reasonCode).toBe('invalid-input'); expect(transport.calls).toHaveLength(0);
  });
  it('previews without permit or transport and sends no POST', async () => {
    const transport = transportFixture();
    const result = await diagnoseOptimization(inputFixture(), config, undefined, { fetch: transport.fetcher });
    expect(result.status).toBe('not-run'); expect(result.preview?.requestBytes).toBeLessThanOrEqual(65536); expect(transport.calls).toHaveLength(0);
  });
  it('requires credential and persistent-intent hook before external calls', async () => {
    const transport = transportFixture();
    const input = inputFixture();
    expect((await diagnoseOptimization(input, config, permitFixture(input), { fetch: transport.fetcher })).reasonCode).toBe('credential-required');
    expect((await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher })).reasonCode).toBe('intent-persistence-required');
    expect(transport.calls).toHaveLength(0);
  });
  it('validates the actual model decision and retains typed usage', async () => {
    const input = inputFixture(), transport = transportFixture(); const order: string[] = [];
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => { order.push('persist'); } });
    expect(result.status).toBe('proposal'); expect(result.diagnosis?.operation?.type).toBe('enable-pnpm-cache');
    expect(result.inference?.usage).toEqual({ promptTokens: 100, completionTokens: 30, totalTokens: 130 });
    expect(result.inference?.costStatus).toBe('unavailable'); expect(order).toEqual(['persist']); expect(transport.calls.map(call => call.init?.method)).toEqual(['GET', 'POST']);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('accepts explicit abstention without inventing an operation', async () => {
    const response = responseFixture(); response.choices[0]!.message.content = JSON.stringify({ ...decisionFixture(), status: 'abstain', operation: null });
    const input = inputFixture(), transport = transportFixture(response);
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.status).toBe('abstain'); expect(result.diagnosis?.operation).toBeNull();
  });
  it.each(['unknown-evidence', 'extra-command', 'wrong-target', 'invalid-json', 'duplicate-key'])('rejects %s without diagnosis', async (failure) => {
    const response = responseFixture(), decision = decisionFixture();
    if (failure === 'unknown-evidence') decision.evidenceIds = ['made-up'];
    if (failure === 'wrong-target') decision.operation.jobId = 'other';
    response.choices[0]!.message.content = failure === 'invalid-json' ? 'bad' : failure === 'duplicate-key' ? '{"status":"proposal","status":"abstain"}' : JSON.stringify(failure === 'extra-command' ? { ...decision, command: 'curl attacker' } : decision);
    const input = inputFixture(), transport = transportFixture(response);
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.status).toBe('failed'); expect(result.reasonCode).toBe('invalid-model-output'); expect(result.diagnosis).toBeUndefined();
  });
  it('enforces serialized request bounds before availability or POST', async () => {
    const input = inputFixture(); for (let i = 0; i < 20; i++) input.evidence[String(i)] = 'x'.repeat(8192);
    const transport = transportFixture();
    const result = await diagnoseOptimization(input, config, permitFixture(input), { apiKey: 'secret', fetch: transport.fetcher, beforePost: async () => {} });
    expect(result.reasonCode).toBe('request-too-large'); expect(transport.calls).toHaveLength(0);
  });
});
