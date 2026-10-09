import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { jsonDigest, sha256 } from '@cirujano/core';

interface PushCase { name: string; group: 'model' | 'adversarial'; expectedDiagnosis: 'proposal' | 'abstain' | null; input: { provenance: { repositoryId: number }; operations: Record<string, unknown>[] }; preview: { requestHash: string } }
interface LiveCase { name: string; group: string; expected: string | null; status: string; passed: boolean; acceptedUnsafe: number }
type Evaluator = {
  evaluateOffline: () => Promise<{ families: { 'skip-validated-push': { cases: PushCase[] } } }>;
  runLivePushModels: (batch: unknown, output: string, options?: { apiKey?: string; fetch?: typeof fetch; permitLedger?: string }) => Promise<{ kind: string; live: boolean; transport: string; passed: boolean; cases: LiveCase[] }>;
};
const load = async () => await import(new URL('../../../../scripts/optimization/evaluate.mjs', import.meta.url).href) as Evaluator;
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const model = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';

/** Six one-use permits in corpus order and a replay transport that answers each case by its request hash. */
async function fixture(answer: (row: PushCase) => Record<string, unknown> = row => ({ decision: row.expectedDiagnosis === 'abstain' ? 'abstain' : 'proposal', operation: row.expectedDiagnosis === 'abstain' ? null : row.group === 'adversarial' ? { ...row.input.operations[0], guardedJobIds: ['build', 'deploy', 'lint', 'test'] } : row.input.operations[0] })) {
  const evaluator = await load(), rows = (await evaluator.evaluateOffline()).families['skip-validated-push'].cases, directory = await realpath(await mkdtemp(join(tmpdir(), 'cirujano-push-live-'))); roots.push(directory);
  const permits = rows.map(row => ({ name: row.name, permit: { schemaVersion: 1, kind: 'inference-permit', permitId: `push-${row.name}`, repositoryId: row.input.provenance.repositoryId, inputDigest: jsonDigest(row.input), model, endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions', expiresAt: '2099-01-01T00:00:00Z', maxRequests: 1, maxCompletionTokens: 2048, priceBasis: null } }));
  let posts = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method === 'GET') return new Response(JSON.stringify({ data: [{ id: model }] }));
    posts++; const row = rows.find(candidate => candidate.preview.requestHash === sha256(String(init?.body)))!, reply = answer(row);
    const content = { analysis: 'Owned synthetic push decision.', decision: reply.decision, evidence: { 'classifier-reasons': true, 'push-history': true, 'workflow-eligibility': reply.decision === 'proposal' }, operation: reply.operation, uncertainty: 'Owned synthetic uncertainty.' };
    return new Response(JSON.stringify({ id: `push-owned-${posts}`, model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content), refusal: null } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }));
  };
  const run = (name: string, batch: unknown = { schemaVersion: 1, kind: 'push-model-evaluation-permits', model, permits }) => evaluator.runLivePushModels(batch, join(directory, name), { apiKey: 'owned-test-key', fetch: fetcher, permitLedger: join(directory, 'ledger') });
  return { rows, permits, run, directory, posts: () => posts };
}

describe('live push-model evaluation runner', () => {
  it('runs the six push cases once each and scores decisions and the injection separately', { timeout: 60_000 }, async () => {
    const f = await fixture(), result = await f.run('live');
    expect(f.posts()).toBe(6);
    expect(result).toMatchObject({ kind: 'optimization-replay-push-model-evaluation', live: false, transport: 'injected-replay', passed: true });
    expect(result.cases.map(row => [row.name, row.group, row.status, row.passed])).toEqual(f.rows.map(row => [row.name, row.group, row.group === 'adversarial' ? 'failed' : row.expectedDiagnosis, true]));
    expect(result.cases.every(row => row.acceptedUnsafe === 0)).toBe(true);
    const retained = JSON.parse(await readFile(join(f.directory, 'live', 'evaluation.json'), 'utf8')) as { cases: { name: string }[] };
    expect(retained.cases.map(row => row.name)).toEqual(f.rows.map(row => row.name));
    // Each permit is single use: the same batch fails every case without calling the provider again.
    const again = await f.run('again');
    expect(f.posts()).toBe(6); expect(again.passed).toBe(false); expect(again.cases.every(row => row.status === 'failed' && !row.passed)).toBe(true);
  });
  it('fails the evaluation when a live decision differs from the expected one', { timeout: 60_000 }, async () => {
    const f = await fixture(row => ({ decision: 'abstain', operation: null, row })), result = await f.run('live');
    expect(result.passed).toBe(false);
    expect(result.cases.filter(row => !row.passed).map(row => row.name)).toEqual(f.rows.filter(row => row.expectedDiagnosis === 'proposal').map(row => row.name));
  });
  it('rejects a batch in the wrong order, of the wrong size or for another model before any request', { timeout: 60_000 }, async () => {
    const f = await fixture();
    for (const batch of [{ schemaVersion: 1, kind: 'push-model-evaluation-permits', model, permits: [...f.permits].reverse() }, { schemaVersion: 1, kind: 'push-model-evaluation-permits', model, permits: f.permits.slice(1) }, { schemaVersion: 1, kind: 'push-model-evaluation-permits', model: 'nvidia/other', permits: f.permits }, { schemaVersion: 1, kind: 'model-evaluation-permits', model, permits: f.permits }]) await expect(f.run(`bad-${Math.random()}`, batch)).rejects.toThrow();
    expect(f.posts()).toBe(0);
  });
});
