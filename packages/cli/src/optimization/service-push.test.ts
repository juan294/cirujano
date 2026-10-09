import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, decodePushArtifact, jsonDigest } from '@cirujano/core';
import { createOptimizationService, type OptimizeArguments } from './service.js';
import { config } from './nebius.test-helper.js';
import { baseSha, branch, eligibleWorkflow, pushGithubFixture, repository, workflow } from './push-collect.test-helper.js';
import { pushDecision, pushPermitFixture, pushTransport } from './push-diagnose.test-helper.js';
import { readPrivateJson } from './store.js';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const args = (action: OptimizeArguments['action'], flags: Record<string, string>): OptimizeArguments => ({ command: 'optimize', action, flags, format: 'json' });
function output() { const stdout: string[] = []; return { stdout, last: () => JSON.parse(stdout.at(-1)!) as { status: string; reasonCode: string; nextCommand: string }, io: { stdout: (value: string) => { stdout.push(value); }, stderr: () => {} } }; }

async function collected(source = eligibleWorkflow, decision: unknown = pushDecision()) {
  const directory = await mkdtemp(join(tmpdir(), 'cirujano-push-service-')); directories.push(directory);
  const fixture = pushGithubFixture(source), transport = pushTransport(decision), io = output();
  const service = createOptimizationService({ pageRunner: fixture.pageRunner, fetch: transport.fetcher, apiKey: 'synthetic-provider-key', toolSourceSha: '1'.repeat(40), bundleDigest: '2'.repeat(64), permitLedger: join(directory, 'permits') });
  const operation = join(directory, 'collected');
  const code = await service.run(args('collect', { family: 'skip-validated-push', repository, ref: baseSha, workflow, branch, output: operation }), io.io);
  const configPath = join(directory, 'config.json'); await writeFile(configPath, canonicalJson(config));
  return { directory, service, io, code, operation, inputPath: join(operation, 'input.json'), configPath, transport };
}
async function permit(context: Awaited<ReturnType<typeof collected>>) {
  const path = join(context.directory, 'permit.json'), input = decodePushArtifact('input', await readPrivateJson(context.inputPath));
  await writeFile(path, canonicalJson(pushPermitFixture(input))); return path;
}

describe('skip-validated-push operations', () => {
  it('collects into a private operation that status re-derives', async () => {
    const context = await collected();
    expect(context.code).toBe(0); expect(context.io.last()).toMatchObject({ status: 'collected', reasonCode: 'collected' });
    expect(context.io.last().nextCommand).toContain('optimize diagnose --input');
    const input = decodePushArtifact('input', await readPrivateJson(context.inputPath)), receipt = await readPrivateJson(join(context.operation, 'collection-receipt.json'));
    expect(receipt).toEqual({ schemaVersion: 1, kind: 'collection-receipt', family: 'skip-validated-push', inputDigest: jsonDigest(input), sourceManifestDigest: jsonDigest(await readPrivateJson(join(context.operation, 'source.json'), 32 * 1024 * 1024)) });
    await expect(readFile(join(context.operation, 'action-receipt.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await context.service.run(args('status', { operation: context.operation }), context.io.io)).toBe(0);
    expect(context.io.last()).toMatchObject({ status: 'collected' });
  });
  it('previews, diagnoses with one permit and reports the retained diagnosis through status', async () => {
    const context = await collected(), preview = join(context.directory, 'preview'), diagnosed = join(context.directory, 'diagnosed');
    expect(await context.service.run(args('diagnose', { input: context.inputPath, config: context.configPath, output: preview }), context.io.io)).toBe(0);
    expect(context.io.last()).toMatchObject({ status: 'not-run', reasonCode: 'inference-permit-required' }); expect(context.transport.calls).toHaveLength(0);
    expect(await context.service.run(args('status', { operation: preview }), context.io.io)).toBe(0); expect(context.io.last().status).toBe('not-run');
    expect(await context.service.run(args('diagnose', { input: context.inputPath, config: context.configPath, permit: await permit(context), output: diagnosed }), context.io.io)).toBe(0);
    expect(context.io.last()).toMatchObject({ status: 'proposal', reasonCode: 'model-proposal-validated' });
    const diagnosis = decodePushArtifact('diagnosis', await readPrivateJson(join(diagnosed, 'diagnosis.json'))), inference = decodePushArtifact('inference', await readPrivateJson(join(diagnosed, 'inference.json')));
    expect(diagnosis.inferenceReceiptDigest).toBe(jsonDigest(inference));
    expect(await context.service.run(args('status', { operation: diagnosed }), context.io.io)).toBe(0); expect(context.io.last().status).toBe('proposal');
    expect(context.io.stdout.join('')).not.toContain('synthetic-provider-key');
  });
  it('records an abstention whose next step is to collect more pushes', async () => {
    const context = await collected(eligibleWorkflow, pushDecision('abstain')), diagnosed = join(context.directory, 'abstained');
    expect(await context.service.run(args('diagnose', { input: context.inputPath, config: context.configPath, permit: await permit(context), output: diagnosed }), context.io.io)).toBe(0);
    expect(context.io.last()).toMatchObject({ status: 'abstain' }); expect(context.io.last().nextCommand).toContain('optimize collect --family skip-validated-push');
    expect(await context.service.run(args('status', { operation: diagnosed }), context.io.io)).toBe(0); expect(context.io.last().status).toBe('abstain');
  });
  it('keeps an unsupported collection inert', async () => {
    const context = await collected(eligibleWorkflow.replace('permissions: read-all', 'permissions: write-all'));
    expect(context.io.last()).toMatchObject({ status: 'unsupported', reasonCode: 'permissions-not-read-only' });
    expect(await context.service.run(args('diagnose', { input: context.inputPath, config: context.configPath, output: join(context.directory, 'refused') }), context.io.io)).toBe(1);
    expect(context.io.last()).toMatchObject({ status: 'unsupported' });
  });
  it.each([
    ['history', (input: Record<string, unknown>) => { (input.history as { billedMinutes: number }[])[0]!.billedMinutes += 1; }],
    ['facts', (input: Record<string, unknown>) => { (input.structuralFacts as Record<string, unknown>).validatedShare = 1; }],
    ['classifier', (input: Record<string, unknown>) => { (input.provenance as Record<string, unknown>).classifierDigest = 'f'.repeat(64); }],
  ])('refuses a retained input whose %s no longer re-derives', async (_name, mutate) => {
    const context = await collected(), input = await readPrivateJson(context.inputPath) as Record<string, unknown>; mutate(input);
    await writeFile(context.inputPath, canonicalJson(input), { mode: 0o600 });
    expect(await context.service.run(args('diagnose', { input: context.inputPath, config: context.configPath, output: join(context.directory, 'tampered') }), context.io.io)).toBe(1);
    expect(context.io.last()).toMatchObject({ status: 'failed', reasonCode: 'retained-input-invalid' });
  });
});
