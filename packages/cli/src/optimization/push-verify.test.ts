import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, CLASSIFIER_DIGEST, classifierCases, decodePushArtifact, jsonDigest } from '@cirujano/core';
import { command, pushVerificationFixture, realHarness, resultFor } from './push-verify.test-helper.js';
import { readPushSandboxContext } from './push-verify.js';
import { readPrivateJson } from './store.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const fixture = async (options?: Parameters<typeof pushVerificationFixture>[0]) => { const f = await pushVerificationFixture(options); directories.push(f.directory); return f; };

describe('push-guard Sandbox verification', () => {
  it('verifies the proposal in one disposable network-disabled operation and binds the artifact', { timeout: 120_000 }, async () => {
    const f = await fixture({ provider: realHarness });
    expect(await f.verify()).toBe(0); expect(f.last()).toMatchObject({ status: 'sandbox-verified', reasonCode: 'push-guard-verified' });
    expect(f.creates()).toBe(1);
    const sandbox = decodePushArtifact('sandbox', await readPrivateJson(join(f.verified, 'sandbox.json')));
    expect(sandbox).toMatchObject({ family: 'skip-validated-push', status: 'sandbox-verified', candidateSha: f.candidateSha, patchHash: f.proposal.patchHash, proposalDigest: jsonDigest(f.proposal), networkEnabled: false, mismatches: 0, firstMismatch: null, classifierCases: classifierCases().length, classifierDigest: CLASSIFIER_DIGEST, fixtureDigest: jsonDigest(classifierCases()), cleanupState: 'disposable-confirmed', operations: [{ role: 'verifier', status: 'SUCCESS', exitCode: 0 }] });
    expect(sandbox.matrixCells).toBeGreaterThan(20);
    await expect(readPushSandboxContext(join(f.verified, 'sandbox.json'))).resolves.toMatchObject({ sandbox });
    expect(await f.verifier.run(command('status', { operation: f.verified }), f.io)).toBe(0); expect(f.last().status).toBe('sandbox-verified');
  });
  it('push-guard-mismatch-disclosed: a failed verifier names the first mismatching cell', { timeout: 120_000 }, async () => {
    const f = await fixture({ provider: raw => resultFor(raw, { status: 'failed', failure: 'matrix-mismatch', mismatchCount: 2, mismatches: ['test event=pull_request classifier=skipped/- needs=- original=- cancelled=false: base=run candidate=skip expected=run', 'test event=schedule classifier=skipped/- needs=- original=- cancelled=false: base=run candidate=skip expected=run'] }) });
    expect(await f.verify()).toBe(1); expect(f.last()).toMatchObject({ status: 'failed', reasonCode: 'push-guard-matrix-mismatch' });
    expect(decodePushArtifact('sandbox', await readPrivateJson(join(f.verified, 'sandbox.json')))).toMatchObject({ status: 'failed', mismatches: 2, firstMismatch: expect.stringContaining('event=pull_request') });
  });
  it('fails closed on a result bound to another payload', { timeout: 120_000 }, async () => {
    const f = await fixture({ provider: raw => resultFor(raw, { fixtureDigest: '0'.repeat(64) }) });
    expect(await f.verify()).toBe(1); expect(f.last()).toMatchObject({ status: 'failed', reasonCode: 'push-guard-sandbox-failed' });
  });
  it('push-guard-image-unavailable: names the image context command and creates nothing', async () => {
    const f = await fixture({ imageStatus: 404 });
    expect(await f.verify()).toBe(1);
    expect(f.last()).toMatchObject({ status: 'failed', reasonCode: 'push-guard-image-unavailable', recovery: expect.stringContaining('image-context.mjs --push-guard') });
    expect(f.creates()).toBe(0);
  });
  it('never creates a second operation over an existing intent', { timeout: 120_000 }, async () => {
    const f = await fixture(); expect(await f.verify()).toBe(0);
    expect(await f.verify()).toBe(1); expect(f.last()).toMatchObject({ status: 'outcome-unknown', reasonCode: 'existing-sandbox-intent' }); expect(f.creates()).toBe(1);
  });
  it('reconciles a run whose result was lost by reading the same operation again', { timeout: 120_000 }, async () => {
    const f = await fixture(); expect(await f.verify()).toBe(0);
    const journal = await readPrivateJson(join(f.verified, 'intent.json')) as Record<string, unknown>;
    await writeFile(join(f.verified, 'intent.json'), canonicalJson({ ...journal, status: 'running', receipt: null, result: null, latestArtifact: null, artifactDigest: null }), { mode: 0o600 });
    const before = f.calls.length;
    expect(await f.verifier.run(command('status', { operation: f.verified }), f.io)).toBe(0); expect(f.last()).toMatchObject({ status: 'sandbox-verified', reasonCode: 'push-guard-verified' });
    expect(f.calls.slice(before).map(call => call.method)).toEqual(['GET']); expect(f.creates()).toBe(1);
    expect((await readdir(f.verified)).filter(name => /^sandbox-[a-f0-9]{64}\.json$/.test(name))).toHaveLength(1);
  });
  it('returns a verified run on cancel without touching the operation', { timeout: 120_000 }, async () => {
    const f = await fixture(); expect(await f.verify()).toBe(0); const before = f.calls.length;
    expect(await f.verifier.run(command('cancel', { operation: f.verified, permit: f.permitPath }), f.io)).toBe(0);
    expect(f.last()).toMatchObject({ status: 'sandbox-verified' }); expect(f.calls.length).toBe(before);
  });
  it.each([
    ['journal', 'intent.json', (value: Record<string, unknown>) => ({ ...value, payloadDigest: '0'.repeat(64) })],
    ['image readback', 'image-readback.json', (value: Record<string, unknown>) => ({ ...value, harnessHash: '0'.repeat(64) })],
    ['artifact', 'sandbox.json', (value: Record<string, unknown>) => ({ ...value, matrixCells: 1 })],
  ])('rejects recovery over a drifted %s', { timeout: 120_000 }, async (_name, file, mutate) => {
    const f = await fixture(); expect(await f.verify()).toBe(0);
    await writeFile(join(f.verified, file), canonicalJson(mutate(await readPrivateJson(join(f.verified, file)) as Record<string, unknown>)), { mode: 0o600 });
    expect(await f.verifier.run(command('status', { operation: f.verified }), f.io)).toBe(1); expect(f.last()).toMatchObject({ status: 'rejected', reasonCode: 'sandbox-recovery-rejected' });
  });
  it('records a create whose outcome the provider did not confirm as outcome-unknown, needing inspection', async () => {
    const f = await fixture({ createStatus: 500 });
    expect(await f.verify()).toBe(1);
    expect(f.last()).toMatchObject({ status: 'outcome-unknown', reasonCode: 'sandbox-create-id-unavailable-provider-inspection-required', recovery: expect.stringContaining('Provider inspection is required') });
    expect(decodePushArtifact('sandbox', await readPrivateJson(join(f.verified, 'sandbox.json')))).toMatchObject({ status: 'outcome-unknown', operations: [], completedAt: null, cleanupState: 'unknown' });
  });
  it.each([
    ['harness', (f: Awaited<ReturnType<typeof pushVerificationFixture>>) => ({ ...f.profile, image: { ...f.profile.image, harnessHash: '9'.repeat(64) } })],
    ['proposal', (f: Awaited<ReturnType<typeof pushVerificationFixture>>) => ({ ...f.profile, proposalDigest: '9'.repeat(64) })],
  ])('rejects a profile bound to another %s before any Sandbox call', { timeout: 120_000 }, async (_name, mutate) => {
    const f = await fixture(); await writeFile(f.profilePath, canonicalJson(mutate(f)));
    expect(await f.verify()).toBe(1); expect(f.last()).toMatchObject({ status: 'rejected', reasonCode: 'sandbox-evidence-rejected' }); expect(f.calls).toEqual([]);
  });
  it('rejects a candidate commit that changes more than the workflow', { timeout: 120_000 }, async () => {
    const f = await fixture();
    await writeFile(join(f.repositoryPath, 'extra.txt'), 'x'); f.git('add', '.'); f.git('commit', '-m', 'Extra change');
    await writeFile(f.profilePath, canonicalJson({ ...f.profile, candidateSha: f.git('rev-parse', 'HEAD') }));
    expect(await f.verify()).toBe(1); expect(f.last()).toMatchObject({ status: 'rejected', reasonCode: 'sandbox-evidence-rejected' }); expect(f.calls).toEqual([]);
  });
});
