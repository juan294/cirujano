import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson, gitBlobSha, sha256 } from './canonical.js';
import { decodePushSourceManifest, type PushHistoryEntry } from './push-contracts.js';
import { createPushInput, summarizePushHistory } from './push-input.js';
import { inspectPushWorkflow } from './push-workflow.js';

const workflowPath = '.github/workflows/ci.yml', profilePath = '.cirujano/optimization-profile.json';
const source = readFileSync(new URL('../../fixtures/optimization/push/eligible-matrix.yml', import.meta.url), 'utf8');
const profile = '{"schemaVersion":1}';
const base = { repositoryId: 123, repository: 'public-example/benchmark', baseSha: 'a'.repeat(40), workflowBlobSha: gitBlobSha(source), workflowPath, workflowHash: sha256(source), integrationBranch: 'develop', classifierDigest: '3'.repeat(64), verificationProfileHash: sha256(profile), toolSourceSha: '1'.repeat(40), bundleDigest: '2'.repeat(64) };
const eligibility = (text = source) => inspectPushWorkflow(text, { workflowHash: sha256(text), workflowPath, integrationBranch: 'develop', inventory: [{ path: workflowPath, source: text }] });
const entry = (pushRunId: number, billedMinutes: number, validated: boolean): PushHistoryEntry => ({ pushRunId, attempt: 1, headSha: 'b'.repeat(40), billedMinutes, jobsBilled: 2, prNumber: validated ? pushRunId : null, validated, reasonCode: validated ? 'validated' : 'no-merged-pr' });

describe('push history facts', () => {
  it('summarizes share, minutes and an exact median', () => {
    expect(summarizePushHistory([entry(1, 4, true), entry(2, 6, false), entry(3, 9, true)])).toEqual({ pushCount: 3, validatedCount: 2, validatedShare: 0.6667, validatedMinutes: 13, unvalidatedCount: 1, medianPushMinutes: 6 });
    expect(summarizePushHistory([entry(1, 4, true), entry(2, 7, false)]).medianPushMinutes).toBe(5.5);
    expect(summarizePushHistory([])).toEqual({ pushCount: 0, validatedCount: 0, validatedShare: 0, validatedMinutes: 0, unvalidatedCount: 0, medianPushMinutes: 0 });
  });
});

describe('push input policy', () => {
  it('collects an eligible workflow with history into one operation, facts and evidence', () => {
    const history = [entry(10, 8, true), entry(11, 8, false)];
    const input = createPushInput({ provenance: base, eligibility: eligibility(), history, treeSha: 'e'.repeat(40) });
    expect(input).toMatchObject({ family: 'skip-validated-push', status: 'collected', operations: [{ type: 'skip-validated-push', integrationBranch: 'develop', guardedJobIds: ['test'], classifierJobId: 'cirujano_validated_push' }] });
    expect(input.provenance.guardedJobIds).toEqual(['test']);
    expect(input.structuralFacts).toMatchObject({ reasonCode: 'eligible', treeSha: 'e'.repeat(40), guardedJobCount: 1, validatedShare: 0.5, medianPushMinutes: 8, validatedMinutes: 8, unvalidatedCount: 1 });
    expect(Object.keys(input.evidence).sort()).toEqual(['classifier-reasons', 'push-history', 'workflow-eligibility']);
    expect(JSON.parse(input.evidence['classifier-reasons']!)).toEqual({ 'no-merged-pr': 1, validated: 1 });
    expect(JSON.parse(input.evidence['push-history']!)).toEqual(history.map(({ pushRunId, attempt, billedMinutes, jobsBilled, validated, reasonCode }) => ({ pushRunId, attempt, billedMinutes, jobsBilled, validated, reasonCode })));
  });
  it('refuses an eligible workflow without push history', () => {
    const input = createPushInput({ provenance: base, eligibility: eligibility(), history: [], treeSha: 'e'.repeat(40) });
    expect(input).toMatchObject({ status: 'unsupported', operations: [], history: [], structuralFacts: { reasonCode: 'no-push-history' } });
  });
  it('passes refused and already-guarded workflows through without an operation', () => {
    const unsupported = createPushInput({ provenance: base, eligibility: eligibility(source.replace('permissions: read-all', 'permissions: write-all')), history: [], treeSha: 'e'.repeat(40) });
    expect(unsupported).toMatchObject({ status: 'unsupported', operations: [], structuralFacts: { reasonCode: 'permissions-not-read-only' } });
    expect(unsupported.provenance.guardedJobIds).toEqual([]);
  });
  it('is deterministic for the same retained facts', () => {
    const options = { provenance: base, eligibility: eligibility(), history: [entry(10, 8, true)], treeSha: 'e'.repeat(40) };
    expect(canonicalJson(createPushInput(options))).toBe(canonicalJson(createPushInput(structuredClone(options))));
  });
});

describe('push source manifest', () => {
  const file = (path: string, text: string) => ({ path, mode: '100644' as const, hash: sha256(text), bytesBase64: Buffer.from(text).toString('base64') });
  const manifest = () => ({ schemaVersion: 1, kind: 'push-source', family: 'skip-validated-push', provenance: { ...base, guardedJobIds: ['test'] }, profilePath, files: [file(profilePath, profile), file('.github/workflows/ci.yml', source), file('.github/workflows/release.yaml', 'on: push\n')] });
  it('retains the workflow inventory and the verification profile only', () => {
    expect(decodePushSourceManifest(manifest()).files.map(entry => entry.path)).toEqual([profilePath, '.github/workflows/ci.yml', '.github/workflows/release.yaml']);
  });
  it.each([
    ['missing-workflow', (m: ReturnType<typeof manifest>) => { m.files.splice(1, 1); }],
    ['missing-profile', (m: ReturnType<typeof manifest>) => { m.files.splice(0, 1); }],
    ['workflow-hash', (m: ReturnType<typeof manifest>) => { m.provenance.workflowHash = 'f'.repeat(64); }],
    ['workflow-blob', (m: ReturnType<typeof manifest>) => { m.provenance.workflowBlobSha = 'f'.repeat(40); }],
    ['profile-hash', (m: ReturnType<typeof manifest>) => { m.provenance.verificationProfileHash = 'f'.repeat(64); }],
    ['file-hash', (m: ReturnType<typeof manifest>) => { m.files[2]!.hash = 'f'.repeat(64); }],
    ['source-file', (m: ReturnType<typeof manifest>) => { m.files.push(file('src/index.ts', 'x')); }],
    ['nested-workflow', (m: ReturnType<typeof manifest>) => { m.files.push(file('.github/workflows/nested/x.yml', 'x')); }],
    ['unsorted', (m: ReturnType<typeof manifest>) => { m.files.reverse(); }],
    ['family', (m: ReturnType<typeof manifest>) => { (m as { family: string }).family = 'pnpm-cache'; }],
  ])('rejects %s', (_name, mutate) => {
    const value = manifest(); mutate(value);
    expect(() => decodePushSourceManifest(value)).toThrow();
  });
});
