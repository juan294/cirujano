import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256 } from './canonical.js';
import { decodeActionReceipt, decodeArtifact } from './contracts.js';
import type { ArtifactKind } from './contracts.js';
import { artifacts } from './contracts.test-helper.js';
import { compareMeasurement } from './measurement.js';
import { measurementFixture } from './measurement.test-helper.js';
import { provenance } from './optimization.test-helper.js';
import { inspectWorkflow } from './workflow.js';

const directory = new URL('../../fixtures/optimization/', import.meta.url);
/** Both snapshots were captured with the `develop` 7bfc9fd decoder, before the family contracts existed; never regenerate them. */
const goldenPath = new URL('golden-decode.json', directory);

/** Every cache-family artifact the repository builds in tests or the offline evaluation corpus. */
function cacheCorpus(): [string, ArtifactKind, unknown][] {
  const rows: [string, ArtifactKind, unknown][] = Object.entries(artifacts).map(([kind, value]) => [`contracts-helper:${kind}`, kind as ArtifactKind, value]);
  const fixture = measurementFixture();
  rows.push(['measurement-helper:input', 'input', fixture.input], ['measurement-helper:proposal', 'proposal', fixture.proposal], ['measurement-helper:sandbox', 'sandbox', fixture.sandbox], ['measurement-helper:measurement', 'measurement', compareMeasurement(fixture)]);
  const receipt = decodeActionReceipt(JSON.parse(readFileSync(new URL('setup-node-receipt.json', directory), 'utf8')));
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as { cases: { name: string; file: string; timedBaseline?: boolean; installElapsedMs?: number }[] };
  for (const entry of manifest.cases) {
    const source = readFileSync(new URL(entry.file, directory), 'utf8');
    const caseProvenance = { ...provenance, workflowHash: sha256(source) };
    const inspection = inspectWorkflow(source, { provenance: caseProvenance, receipt, rootLockfile: true, timedBaseline: entry.timedBaseline !== false, requiredChecks: ['test'], verificationProfilePresent: true });
    rows.push([`corpus:${entry.name}`, 'input', { schemaVersion: 1, kind: 'input', provenance: caseProvenance, status: inspection.status === 'eligible' ? 'collected' : inspection.status, structuralFacts: inspection.structuralFacts, evidence: { install: 'Frozen pnpm installation observed in the labeled synthetic baseline.', 'setup-node-receipt': canonicalJson(receipt) }, operations: inspection.operations, requiredChecks: ['test'], baselines: entry.timedBaseline === false ? [] : [{ runId: 99, attempt: 1, jobId: 100, headSha: caseProvenance.baseSha, conclusion: 'success', startedAt: '2026-09-29T10:00:00Z', completedAt: '2026-09-29T10:02:00Z', elapsedMs: 120000, installStepNumber: 4, installElapsedMs: entry.installElapsedMs ?? 60000, runnerLabels: ['ubuntu-24.04'], runnerImage: null, requiredChecks: ['test'] }] }]);
  }
  return rows;
}

/** Field-level mutations of each corpus artifact; the pre-family decoder's verdicts on them are pinned too. */
function mutations(rows: [string, ArtifactKind, unknown][]): [string, ArtifactKind, unknown][] {
  return rows.flatMap(([name, kind, value]) => {
    const record = value as Record<string, unknown>, provenance = record.provenance as Record<string, unknown>;
    const top = Object.keys(record).sort().flatMap(key => [['delete', key, undefined], ['null', key, null], ['text', key, 'x'], ['negative', key, -1]] as const).map(([mutation, key, replacement]) => {
      const next = structuredClone(record);
      if (mutation === 'delete') delete next[key]; else next[key] = replacement;
      return [`${name}|${mutation}:${key}`, kind, next] as [string, ArtifactKind, unknown];
    });
    const nested = Object.keys(provenance).sort().map(key => { const next = structuredClone(record), inner = next.provenance as Record<string, unknown>; delete inner[key]; return [`${name}|delete:provenance.${key}`, kind, next] as [string, ArtifactKind, unknown]; });
    return [...top, ...nested, [`${name}|extra`, kind, { ...record, family: 'pnpm-cache' }] as [string, ArtifactKind, unknown]];
  });
}
function verdict(kind: ArtifactKind, value: unknown): string { try { decodeArtifact(kind, value); return 'accepted'; } catch (error) { return error instanceof Error ? error.message : 'non-error'; } }
const rejectionsPath = new URL('golden-decode-rejections.json', directory);

describe('cache-artifacts-decode-unchanged', () => {
  const rows = cacheCorpus();
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<string, { kind: ArtifactKind; canonical: string }>;
  it('covers exactly the captured artifact set', () => expect(rows.map(([name]) => name).sort()).toEqual(Object.keys(golden).sort()));
  it.each(rows)('%s decodes byte-identically to the pre-family snapshot', (name, kind, value) => {
    expect(golden[name]?.kind).toBe(kind);
    expect(canonicalJson(decodeArtifact(kind, value))).toBe(golden[name]?.canonical);
  });
  it('accepts and rejects every mutated artifact exactly as the pre-family decoder did', () => {
    const expected = JSON.parse(readFileSync(rejectionsPath, 'utf8')) as Record<string, string>;
    const actual = Object.fromEntries(mutations(rows).map(([name, kind, value]) => [name, verdict(kind, value)]));
    expect(Object.keys(actual).length).toBeGreaterThan(1000);
    expect(actual).toEqual(expected);
  });
});
