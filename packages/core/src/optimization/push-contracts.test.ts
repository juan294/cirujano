import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical.js';
import { decodeArtifact } from './contracts.js';
import { artifacts as cacheArtifacts } from './contracts.test-helper.js';
import { artifactFamily, assertSamePushProvenance, decodeFamilyArtifact, decodePushArtifact, decodePushProvenance, validatePushDiagnosisEvidence } from './push-contracts.js';
import type { PushArtifactMap } from './push-contracts.js';
import { historyEntry, pushArtifacts, pushOperation, pushProvenance, pushSample } from './push-contracts.test-helper.js';

const kinds = Object.keys(pushArtifacts) as (keyof PushArtifactMap)[];
const clone = <T>(value: T): T => structuredClone(value);

describe('skip-validated-push family contracts', () => {
  for (const kind of kinds) it(`decodes a complete ${kind} and rejects extras, version drift, missing provenance and a missing family`, () => {
    expect(decodePushArtifact(kind, pushArtifacts[kind]).kind).toBe(kind);
    expect(() => decodePushArtifact(kind, { ...pushArtifacts[kind], extra: true })).toThrow();
    expect(() => decodePushArtifact(kind, { ...pushArtifacts[kind], schemaVersion: 2 })).toThrow();
    const missing = { ...pushArtifacts[kind] } as Record<string, unknown>; delete missing.provenance;
    expect(() => decodePushArtifact(kind, missing)).toThrow();
    const unfamilied = { ...pushArtifacts[kind] } as Record<string, unknown>; delete unfamilied.family;
    expect(() => decodePushArtifact(kind, unfamilied)).toThrow();
  });
  it('keeps the families apart: neither decoder accepts the other family', () => {
    for (const kind of kinds) {
      expect(() => decodeArtifact(kind, pushArtifacts[kind])).toThrow();
      expect(() => decodePushArtifact(kind, cacheArtifacts[kind])).toThrow();
    }
  });
  it('dispatches by family and returns cache artifacts exactly as the cache decoder does', () => {
    for (const kind of kinds) {
      expect(canonicalJson(decodeFamilyArtifact(kind, cacheArtifacts[kind]))).toBe(canonicalJson(decodeArtifact(kind, cacheArtifacts[kind])));
      expect(decodeFamilyArtifact(kind, pushArtifacts[kind])).toHaveProperty('family', 'skip-validated-push');
      expect(() => decodeFamilyArtifact(kind, { ...pushArtifacts[kind], family: 'pnpm-cache' })).toThrow();
      expect(() => decodeFamilyArtifact(kind, { ...pushArtifacts[kind], family: 'unknown' })).toThrow();
    }
    expect(artifactFamily(cacheArtifacts.input)).toBe('pnpm-cache');
    expect(artifactFamily(pushArtifacts.input)).toBe('skip-validated-push');
  });
  it('binds push provenance: sorted unique guarded jobs, one literal branch, no cache step identity', () => {
    expect(decodePushProvenance(pushProvenance)).toEqual(pushProvenance);
    for (const guardedJobIds of [['test', 'lint'], ['lint', 'lint'], ['lint', 'cirujano_validated_push'], ['bad job']]) expect(() => decodePushProvenance({ ...pushProvenance, guardedJobIds })).toThrow();
    for (const integrationBranch of ['release/*', 'main**', '!main', '-main', 'a..b', 'refs/heads/', '']) expect(() => decodePushProvenance({ ...pushProvenance, integrationBranch })).toThrow();
    expect(decodePushProvenance({ ...pushProvenance, integrationBranch: 'release/v2.x' }).integrationBranch).toBe('release/v2.x');
    expect(() => decodePushProvenance({ ...pushProvenance, stepIndex: 2 })).toThrow();
    expect(decodePushProvenance({ ...pushProvenance, guardedJobIds: [] }).guardedJobIds).toEqual([]);
    expect(() => assertSamePushProvenance(pushProvenance, { ...pushProvenance, classifierDigest: '9'.repeat(64) })).toThrow();
  });
  it('requires every operation and permitted diff to target the provenance branch and guarded jobs', () => {
    const drifted = [{ ...pushOperation, integrationBranch: 'develop' }, { ...pushOperation, guardedJobIds: ['test'] }, { ...pushOperation, classifierJobId: 'other' }];
    for (const operation of drifted) {
      expect(() => decodePushArtifact('input', { ...pushArtifacts.input, operations: [operation] })).toThrow();
      expect(() => decodePushArtifact('diagnosis', { ...pushArtifacts.diagnosis, operation })).toThrow();
      expect(() => decodePushArtifact('proposal', { ...pushArtifacts.proposal, operation })).toThrow();
    }
    expect(() => decodePushArtifact('proposal', { ...pushArtifacts.proposal, permittedDiff: { classifierJobId: 'cirujano_validated_push', guardedJobIds: ['lint'] } })).toThrow();
  });
  it('bounds and checks the collected push history', () => {
    const history = Array.from({ length: 30 }, (_, index) => ({ ...historyEntry, pushRunId: index + 1 }));
    expect(decodePushArtifact('input', { ...pushArtifacts.input, history }).history).toHaveLength(30);
    expect(() => decodePushArtifact('input', { ...pushArtifacts.input, history: [...history, { ...historyEntry, pushRunId: 31 }] })).toThrow();
    expect(() => decodePushArtifact('input', { ...pushArtifacts.input, history: [historyEntry, historyEntry] })).toThrow();
    expect(() => decodePushArtifact('input', { ...pushArtifacts.input, history: [{ ...historyEntry, prNumber: null }] })).toThrow();
    expect(() => decodePushArtifact('input', { ...pushArtifacts.input, history: [{ ...historyEntry, reasonCode: 'Not A Code' }] })).toThrow();
    expect(decodePushArtifact('input', { ...pushArtifacts.input, history: [{ ...historyEntry, prNumber: null, validated: false, reasonCode: 'no-merged-pull-request' }] }).history[0]?.validated).toBe(false);
  });
  it('requires collected prerequisites and no operation on a refused input', () => {
    expect(() => decodePushArtifact('input', { ...pushArtifacts.input, history: [] })).toThrow();
    expect(() => decodePushArtifact('input', { ...pushArtifacts.input, evidence: {} })).toThrow();
    expect(() => decodePushArtifact('input', { ...pushArtifacts.input, operations: [] })).toThrow();
    expect(() => decodePushArtifact('input', { ...pushArtifacts.input, status: 'unsupported' })).toThrow();
    expect(decodePushArtifact('input', { ...pushArtifacts.input, status: 'unsupported', operations: [], history: [] }).status).toBe('unsupported');
  });
  it('lets only a refused input record an empty guarded job set', () => {
    const empty = { ...pushProvenance, guardedJobIds: [] };
    expect(decodePushArtifact('input', { ...pushArtifacts.input, provenance: empty, status: 'unsupported', operations: [], history: [] }).provenance.guardedJobIds).toEqual([]);
    expect(decodePushArtifact('input', { ...pushArtifacts.input, provenance: empty, status: 'no-change', operations: [], history: [] }).status).toBe('no-change');
    expect(() => decodePushArtifact('input', { ...pushArtifacts.input, provenance: empty })).toThrow();
    for (const kind of kinds.filter(kind => kind !== 'input')) expect(() => decodePushArtifact(kind, { ...pushArtifacts[kind], provenance: empty }), kind).toThrow();
  });
  it('keeps the diagnosis status and operation consistent and bound to collected evidence', () => {
    expect(() => decodePushArtifact('diagnosis', { ...pushArtifacts.diagnosis, operation: null })).toThrow();
    expect(() => decodePushArtifact('diagnosis', { ...pushArtifacts.diagnosis, status: 'abstain' })).toThrow();
    expect(decodePushArtifact('diagnosis', { ...pushArtifacts.diagnosis, status: 'abstain', operation: null }).operation).toBeNull();
    validatePushDiagnosisEvidence(pushArtifacts.diagnosis, pushArtifacts.input);
    expect(() => validatePushDiagnosisEvidence({ ...pushArtifacts.diagnosis, evidenceIds: ['unknown'] }, pushArtifacts.input)).toThrow();
    expect(() => validatePushDiagnosisEvidence(pushArtifacts.diagnosis, { ...pushArtifacts.input, status: 'unsupported', operations: [], history: [] })).toThrow();
    expect(() => validatePushDiagnosisEvidence({ ...pushArtifacts.diagnosis, provenance: { ...pushProvenance, baseSha: '9'.repeat(40) } }, pushArtifacts.input)).toThrow();
  });
  it('accepts a verified Sandbox only with one clean verifier operation, zero mismatches and the bound classifier', () => {
    const sandbox = pushArtifacts.sandbox;
    expect(() => decodePushArtifact('sandbox', { ...sandbox, mismatches: 1, firstMismatch: 'push-validated/needs=success/original=true' })).toThrow();
    expect(decodePushArtifact('sandbox', { ...sandbox, status: 'failed', mismatches: 1, firstMismatch: 'push-validated/needs=success/original=true' }).mismatches).toBe(1);
    expect(() => decodePushArtifact('sandbox', { ...sandbox, status: 'failed', mismatches: 1, firstMismatch: null })).toThrow();
    expect(() => decodePushArtifact('sandbox', { ...sandbox, firstMismatch: 'none' })).toThrow();
    expect(() => decodePushArtifact('sandbox', { ...sandbox, classifierDigest: '9'.repeat(64) })).toThrow();
    expect(() => decodePushArtifact('sandbox', { ...sandbox, matrixCells: 0 })).toThrow();
    expect(() => decodePushArtifact('sandbox', { ...sandbox, classifierCases: 0 })).toThrow();
    expect(() => decodePushArtifact('sandbox', { ...sandbox, operations: [{ ...sandbox.operations[0]!, role: 'base' }] })).toThrow();
    expect(() => decodePushArtifact('sandbox', { ...sandbox, operations: [...sandbox.operations, { ...sandbox.operations[0]!, id: 'verifier-2' }] })).toThrow();
    expect(() => decodePushArtifact('sandbox', { ...sandbox, operations: [{ ...sandbox.operations[0]!, exitCode: 1 }] })).toThrow();
    expect(() => decodePushArtifact('sandbox', { ...sandbox, cleanupState: 'pending' })).toThrow();
  });
  it('accepts a measured improvement only with the full per-push cohort shape', () => {
    const measurement = pushArtifacts.measurement, pushes = measurement.pushes;
    const replace = (index: number, change: (sample: typeof pushes[number]) => void) => { const next = clone(pushes); change(next[index]!); return { ...measurement, pushes: next }; };
    expect(() => decodePushArtifact('measurement', { ...measurement, pushes: pushes.slice(1) })).toThrow();
    expect(() => decodePushArtifact('measurement', replace(3, sample => { sample.guardedJobs[0]!.conclusion = 'success'; }))).toThrow();
    expect(() => decodePushArtifact('measurement', replace(3, sample => { sample.validated = false; }))).toThrow();
    expect(() => decodePushArtifact('measurement', replace(6, sample => { sample.validated = true; }))).toThrow();
    expect(() => decodePushArtifact('measurement', replace(6, sample => { sample.guardedJobs[1]!.conclusion = 'skipped'; }))).toThrow();
    expect(() => decodePushArtifact('measurement', replace(0, sample => { sample.guardedJobs = sample.guardedJobs.slice(1); }))).toThrow();
    expect(() => decodePushArtifact('measurement', replace(6, sample => { sample.prNumber = 3; }))).toThrow();
    expect(() => decodePushArtifact('measurement', replace(1, sample => { sample.prRunId = null; }))).toThrow();
    expect(() => decodePushArtifact('measurement', { ...measurement, pushes: [...pushes, pushSample('baseline', 1)] })).toThrow();
    expect(() => decodePushArtifact('measurement', { ...measurement, claimLevel: 'none' })).toThrow();
    expect(() => decodePushArtifact('measurement', { ...measurement, modeled: { ...measurement.modeled, validatedPushes: 31 } })).toThrow();
    expect(() => decodePushArtifact('measurement', replace(4, sample => { sample.billedMinutes = 50; }))).toThrow();
    expect(() => decodePushArtifact('measurement', replace(4, sample => { sample.billedMinutes = 6; }))).toThrow();
    expect(decodePushArtifact('measurement', replace(4, sample => { sample.billedMinutes = 5; })).status).toBe('measured-improvement');
    expect(() => decodePushArtifact('measurement', { ...measurement, baselineMedianMinutes: 999 })).toThrow();
    expect(() => decodePushArtifact('measurement', { ...measurement, classifierOverheadMinutes: 0 })).toThrow();
    expect(() => decodePushArtifact('measurement', replace(4, sample => { sample.prJobs[1]!.conclusion = 'failure'; }))).toThrow();
    expect(() => decodePushArtifact('measurement', replace(4, sample => { sample.prJobs = sample.prJobs.slice(1); }))).toThrow();
    expect(() => decodePushArtifact('measurement', replace(0, sample => { sample.prJobs[0]!.conclusion = 'failure'; }))).toThrow();
    const allPrJobs = (conclusion: string) => ({ ...measurement, pushes: pushes.map(sample => ({ ...sample, prJobs: sample.prJobs.map(job => ({ ...job, conclusion })) })) });
    expect(() => decodePushArtifact('measurement', allPrJobs('failure'))).toThrow();
    expect(() => decodePushArtifact('measurement', replace(4, sample => { sample.prJobs.push({ name: 'cirujano_validated_push', conclusion: 'skipped' }); }))).toThrow();
    expect(() => decodePushArtifact('measurement', { ...measurement, status: 'no-improvement', claimLevel: 'none', pushes: [{ ...pushes[0]!, prJobs: [...pushes[0]!.prJobs, { name: 'cirujano_validated_push', conclusion: 'skipped' }] }] })).toThrow();
    expect(decodePushArtifact('measurement', { ...measurement, status: 'no-improvement', claimLevel: 'none', pushes: pushes.slice(0, 2) }).status).toBe('no-improvement');
  });
  it('keeps the shared inference, report and publication rules', () => {
    expect(() => decodePushArtifact('inference', { ...pushArtifacts.inference, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 1 } })).toThrow();
    expect(() => decodePushArtifact('inference', { ...pushArtifacts.inference, latencyMs: 1 })).toThrow();
    expect(() => decodePushArtifact('report', { ...pushArtifacts.report, markdown: 'tamper' })).toThrow();
    expect(() => decodePushArtifact('publication', { ...pushArtifacts.publication, number: 2 })).toThrow();
  });
});
