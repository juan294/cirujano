import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPushGuardPayload, canonicalJson, CLASSIFIER_DIGEST, CLASSIFIER_SOURCE, classifierCases, createSkipValidatedPushPatch, sha256 } from '@cirujano/core';
import { PAYLOAD_PATH as HARNESS_PAYLOAD_PATH, runClassifierCase, runPushGuardHarness } from './push-guard-harness-entry.js';
import { PAYLOAD_PATH } from './sandbox.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const workflowPath = '.github/workflows/ci.yml';
const base = readFileSync(new URL('../../../core/fixtures/optimization/push/eligible-multi-job.yml', import.meta.url), 'utf8');
const patch = createSkipValidatedPushPatch(base, { workflowHash: sha256(base), workflowPath, integrationBranch: 'main', inventory: [{ path: workflowPath, source: base }] });
const identity = { profileDigest: '1'.repeat(64), proposalDigest: '2'.repeat(64), toolSourceSha: '3'.repeat(40), bundleDigest: '4'.repeat(64), imageManifestHash: '5'.repeat(64), harnessHash: '6'.repeat(64) };
// Two cases suffice here; the first test runs all of them through the real script.
const payload = () => buildPushGuardPayload({ ...identity, workflowPath, baseWorkflow: base, candidateWorkflow: patch.candidate, operation: patch.operation!, classifierDigest: CLASSIFIER_DIGEST, cases: classifierCases().slice(0, 2) });

describe('push guard harness', () => {
  it('runs every Phase 3 case through the real step script with node and no network', { timeout: 120_000 }, async () => {
    for (const testCase of classifierCases()) expect(await runClassifierCase(CLASSIFIER_SOURCE, testCase), testCase.name).toEqual(testCase.expected);
  });
  it('reports a script that does not write its outputs', async () => {
    expect(await runClassifierCase('process.exit(3);\n', classifierCases()[0]!)).toEqual({ validated: false, reasonCode: 'no-classifier-output' });
  });
  it('verifies a payload file by digest and writes one canonical passed result', { timeout: 120_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-push-harness-')); directories.push(directory);
    const path = join(directory, 'payload.json'), bytes = canonicalJson(payload()); await writeFile(path, bytes);
    const output = await runPushGuardHarness(path, sha256(bytes), path);
    const result = JSON.parse(output) as { status: string; failure: string | null; classifierCases: number; matrixCells: number };
    expect(output).toBe(`${canonicalJson(result)}\n`);
    expect(result).toMatchObject({ status: 'passed', failure: null, classifierCases: 2 });
    expect(result.matrixCells).toBeGreaterThan(100);
  });
  it('reads the payload where the Sandbox request mounts it', () => { expect(HARNESS_PAYLOAD_PATH).toBe(PAYLOAD_PATH); });
  it('refuses a payload at another path or with another digest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-push-harness-')); directories.push(directory);
    const path = join(directory, 'payload.json'), bytes = canonicalJson(payload()); await writeFile(path, bytes);
    await expect(runPushGuardHarness(path, sha256(bytes))).rejects.toThrow('push-harness-payload-path');
    await expect(runPushGuardHarness(path, '0'.repeat(64), path)).rejects.toThrow('push-harness-payload-digest');
  });
});
