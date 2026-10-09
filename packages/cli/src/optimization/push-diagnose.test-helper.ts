import { readFileSync } from 'node:fs';
import { CLASSIFIER_DIGEST, createPushInput, gitBlobSha, inspectPushWorkflow, jsonDigest, sha256, type PushHistoryEntry, type PushInputArtifact } from '@cirujano/core';
import { model, endpoint } from './nebius.test-helper.js';

export const pushWorkflow = readFileSync(new URL('../../../core/fixtures/optimization/push/eligible-matrix.yml', import.meta.url), 'utf8');
const workflowPath = '.github/workflows/ci.yml';
export const pushOperation = { type: 'skip-validated-push', integrationBranch: 'develop', guardedJobIds: ['test'], classifierJobId: 'cirujano_validated_push' };

/** `validated` of `pushes` recent pushes came from green PRs; every push billed `minutes`. */
export function pushInputFixture(pushes = 10, validated = 8, minutes = 6, source = pushWorkflow): PushInputArtifact {
  const history: PushHistoryEntry[] = Array.from({ length: pushes }, (_, index) => ({ pushRunId: 500 + index, attempt: 1, headSha: index.toString(16).padStart(40, '0'), billedMinutes: minutes, jobsBilled: 2, prNumber: index < validated ? 40 + index : null, validated: index < validated, reasonCode: index < validated ? 'validated' : 'no-merged-pr' }));
  const eligibility = inspectPushWorkflow(source, { workflowHash: sha256(source), workflowPath, integrationBranch: 'develop', inventory: [{ path: workflowPath, source }] });
  return createPushInput({ provenance: { repositoryId: 123, repository: 'public-example/benchmark', baseSha: 'a'.repeat(40), workflowBlobSha: gitBlobSha(source), workflowPath, workflowHash: sha256(source), integrationBranch: 'develop', classifierDigest: CLASSIFIER_DIGEST, verificationProfileHash: 'f'.repeat(64), toolSourceSha: '1'.repeat(40), bundleDigest: '2'.repeat(64) }, eligibility, history, treeSha: 'e'.repeat(40) });
}
export function pushPermitFixture(input: PushInputArtifact) {
  return { schemaVersion: 1, kind: 'inference-permit', permitId: 'push-permit', repositoryId: input.provenance.repositoryId, inputDigest: jsonDigest(input), model, endpoint, expiresAt: '2099-01-01T00:00:00.000Z', maxRequests: 1, maxCompletionTokens: 2048, priceBasis: null };
}
export function pushDecision(status: 'proposal' | 'abstain' = 'proposal') {
  return { analysis: 'Most recent pushes repeat a tree their pull request already tested green, and each push bills six minutes.', decision: status, evidence: { 'classifier-reasons': true, 'push-history': true, 'workflow-eligibility': status === 'proposal' } as Record<string, boolean>, operation: status === 'proposal' ? structuredClone(pushOperation) as typeof pushOperation | null : null, uncertainty: 'The saving is unmeasured until the per-push gate runs.' };
}
export function pushTransport(decision: unknown = pushDecision()) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'GET') return new Response(JSON.stringify({ data: [{ id: model }] }));
    return new Response(JSON.stringify({ id: 'completion-push-1', model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: typeof decision === 'string' ? decision : JSON.stringify(decision), refusal: null } }], usage: { prompt_tokens: 400, completion_tokens: 60, total_tokens: 460 } }));
  };
  const request = () => JSON.parse(String(calls.find(call => call.init?.method === 'POST')?.init?.body)) as { messages: { content: string }[]; response_format: { json_schema: { name: string; schema: { properties: Record<string, unknown> } } } };
  return { fetcher, calls, request };
}
