import { jsonDigest, type InputArtifact } from '@cirujano/core';

export const model = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';
export const endpoint = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
export const config = { schemaVersion: 1, model, endpoint };
export function inputFixture(): InputArtifact {
  return { schemaVersion: 1, kind: 'input', status: 'collected', provenance: {
    repositoryId: 123, repository: 'public-example/benchmark', baseSha: 'a'.repeat(40), workflowBlobSha: 'b'.repeat(40), workflowPath: '.github/workflows/ci.yml', workflowHash: 'c'.repeat(64), jobId: 'test', stepIndex: 2, lockfileHash: 'd'.repeat(64), sourceTreeDigest: 'e'.repeat(64), verificationProfileHash: 'f'.repeat(64), toolSourceSha: '1'.repeat(40), bundleDigest: '2'.repeat(64),
  }, baselines: [{ runId: 99, attempt: 1, jobId: 100, headSha: 'a'.repeat(40), conclusion: 'success', startedAt: '2026-09-29T10:00:00Z', completedAt: '2026-09-29T10:02:00Z', elapsedMs: 120000, installStepNumber: 4, installElapsedMs: 60000, runnerLabels: ['ubuntu-24.04'], runnerImage: null, requiredChecks: ['test'] }], structuralFacts: { eligible: true }, evidence: { 'install-1': 'frozen pnpm installation' }, operations: [{ type: 'enable-pnpm-cache', jobId: 'test', stepIndex: 2 }], requiredChecks: ['test'] };
}
export function permitFixture(input = inputFixture()) {
  return { schemaVersion: 1, kind: 'inference-permit', permitId: 'test-permit', repositoryId: 123, inputDigest: jsonDigest(input), model, endpoint, expiresAt: '2099-01-01T00:00:00.000Z', maxRequests: 1, maxCompletionTokens: 2048, priceBasis: null };
}
export function decisionFixture() {
  return { decision: 'proposal', analysis: 'Installation can reuse the pnpm store.', uncertainty: 'Cache benefit remains unmeasured.', evidence: { 'install-1': true } as Record<string, boolean>, operation: { type: 'enable-pnpm-cache', jobId: 'test', stepIndex: 2 } };
}
export function responseFixture() {
  return { id: 'completion-1', model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(decisionFixture()), refusal: null } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } };
}
export function transportFixture(response: unknown = responseFixture(), status = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'GET') return new Response(JSON.stringify({ data: [{ id: model }] }));
    return new Response(typeof response === 'string' ? response : JSON.stringify(response), { status });
  };
  return { fetcher, calls };
}
