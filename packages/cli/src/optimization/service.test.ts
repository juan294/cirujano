import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson, decodeArtifact, jsonDigest } from '@cirujano/core';
import { createOptimizationService, type OptimizeArguments } from './service.js';
import { githubFixture, baseSha, repository } from './github-read.test-helper.js';
import { config, permitFixture, responseFixture, model } from './nebius.test-helper.js';
import { readPrivateJson } from './store.js';

const directories: string[] = [];
async function temporary() { const directory = await mkdtemp(join(tmpdir(), 'cirujano-optimizer-service-')); directories.push(directory); return directory; }
afterEach(async () => { vi.unstubAllEnvs(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
function args(action: OptimizeArguments['action'], flags: Record<string, string | string[]>): OptimizeArguments { return { command: 'optimize', action, flags, format: 'json' }; }
function output() { const stdout: string[] = [], stderr: string[] = []; return { stdout, stderr, io: { stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value) } }; }
async function setup(workflow?: string) {
  const directory = await temporary(), fixture = githubFixture(workflow); let posts = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method === 'GET') return new Response(JSON.stringify({ data: [{ id: model }] }));
    posts++; const response = responseFixture(); const decision = JSON.parse(response.choices[0]!.message.content); decision.evidence = { 'install-timing': true }; response.choices[0]!.message.content = JSON.stringify(decision);
    return new Response(JSON.stringify(response));
  };
  const service = createOptimizationService({ pageRunner: fixture.pageRunner, fetch: fetcher, apiKey: 'synthetic-provider-key', toolSourceSha: '1'.repeat(40), bundleDigest: '2'.repeat(64), permitLedger: join(directory, 'permits') });
  const collected = join(directory, 'collected'), io = output();
  const collect = await service.run(args('collect', { repository, ref: baseSha, workflow: '.github/workflows/ci.yml', job: 'test', run: ['99'], output: collected }), io.io);
  return { directory, fixture, service, collected, io, collect, posts: () => posts };
}
describe('optimization collection and diagnosis integration', () => {
  it('uses only the source-specific inference credential at run time', async () => {
    const result = await setup(), inputPath = join(result.collected, 'input.json'), input = decodeArtifact('input', await readPrivateJson(inputPath));
    const configPath = join(result.directory, 'config.json'), permitPath = join(result.directory, 'permit.json'); await writeFile(configPath, canonicalJson(config)); await writeFile(permitPath, canonicalJson(permitFixture(input)));
    let authorization = '';
    const fetcher: typeof fetch = async (_url, init) => { authorization = new Headers(init?.headers).get('Authorization') ?? ''; if (init?.method === 'GET') return new Response(JSON.stringify({ data: [{ id: model }] })); const response = responseFixture(), decision = JSON.parse(response.choices[0]!.message.content); decision.evidence = { 'install-timing': true }; response.choices[0]!.message.content = JSON.stringify(decision); return new Response(JSON.stringify(response)); };
    const service = createOptimizationService({ fetch: fetcher, permitLedger: join(result.directory, 'env-permits') });
    vi.stubEnv('NEBIUS_API_KEY', 'source-specific-environment-key'); vi.stubEnv('GITHUB_TOKEN', 'never-use-github-token-for-inference');
    expect(await service.run(args('diagnose', { input: inputPath, config: configPath, permit: permitPath, output: join(result.directory, 'environment-diagnosis') }), result.io.io)).toBe(0); expect(authorization).toBe('Bearer source-specific-environment-key');
    expect(result.io.stdout.join('')).not.toContain('source-specific-environment-key');
  });
  it('collects retained immutable source and previews through actual owned modules', async () => {
    const setupResult = await setup(); expect(setupResult.collect).toBe(0);
    const inputPath = join(setupResult.collected, 'input.json'), input = decodeArtifact('input', await readPrivateJson(inputPath));
    expect(input.status).toBe('collected'); expect(await readPrivateJson(join(setupResult.collected, 'source.json'), 32 * 1024 * 1024)).toHaveProperty('files');
    const configPath = join(setupResult.directory, 'config.json'); await writeFile(configPath, JSON.stringify(config));
    const target = join(setupResult.directory, 'preview'); const result = await setupResult.service.run(args('diagnose', { input: inputPath, config: configPath, output: target }), setupResult.io.io);
    expect(result).toBe(0); expect(await readPrivateJson(join(target, 'request-preview.json'))).toHaveProperty('requestHash'); expect(setupResult.posts()).toBe(0);
    expect((await stat(target)).mode & 0o777).toBe(0o700); expect((await stat(join(target, 'request-preview.json'))).mode & 0o777).toBe(0o600);
  });
  it('persists inference and diagnosis with intact receipt digests and one global permit use', async () => {
    const result = await setup(), inputPath = join(result.collected, 'input.json'), input = decodeArtifact('input', await readPrivateJson(inputPath));
    const configPath = join(result.directory, 'config.json'), permitPath = join(result.directory, 'permit.json');
    await writeFile(configPath, canonicalJson(config)); await writeFile(permitPath, canonicalJson(permitFixture(input)));
    const target = join(result.directory, 'diagnosed');
    expect(await result.service.run(args('diagnose', { input: inputPath, config: configPath, permit: permitPath, output: target }), result.io.io)).toBe(0);
    const inference = decodeArtifact('inference', await readPrivateJson(join(target, 'inference.json'))), diagnosis = decodeArtifact('diagnosis', await readPrivateJson(join(target, 'diagnosis.json')));
    expect(diagnosis.inferenceReceiptDigest).toBe(jsonDigest(inference)); expect(inference.usage?.totalTokens).toBe(130); expect(result.posts()).toBe(1);
    expect(await result.service.run(args('diagnose', { input: inputPath, config: configPath, permit: permitPath, output: join(result.directory, 'repeat') }), result.io.io)).toBe(1);
    expect(result.posts()).toBe(1); expect(result.io.stdout.join('')).not.toContain('synthetic-provider-key');
  });
  it('rejects a mutually consistent diagnosis/receipt swapped from another repository', async () => {
    const result = await setup(), inputPath = join(result.collected, 'input.json'), input = decodeArtifact('input', await readPrivateJson(inputPath));
    const configPath = join(result.directory, 'config.json'), permitPath = join(result.directory, 'permit.json'); await writeFile(configPath, canonicalJson(config)); await writeFile(permitPath, canonicalJson(permitFixture(input)));
    const target = join(result.directory, 'diagnosed'); await result.service.run(args('diagnose', { input: inputPath, config: configPath, permit: permitPath, output: target }), result.io.io);
    const inference = decodeArtifact('inference', await readPrivateJson(join(target, 'inference.json'))), diagnosis = decodeArtifact('diagnosis', await readPrivateJson(join(target, 'diagnosis.json')));
    inference.provenance.repositoryId = 999; diagnosis.provenance.repositoryId = 999; diagnosis.inferenceReceiptDigest = jsonDigest(inference);
    await writeFile(join(target, 'inference.json'), canonicalJson(inference)); await writeFile(join(target, 'diagnosis.json'), canonicalJson(diagnosis));
    expect(await result.service.run(args('status', { operation: target }), result.io.io)).toBe(1); expect(result.posts()).toBe(1);
  });
  it('blocks retained source tampering before any model call', async () => {
    const result = await setup(), path = join(result.collected, 'source.json'), source = await readPrivateJson(path, 32 * 1024 * 1024) as { files: { bytesBase64: string }[] };
    source.files[0]!.bytesBase64 = Buffer.from('tamper').toString('base64'); await writeFile(path, canonicalJson(source));
    const configPath = join(result.directory, 'config.json'); await writeFile(configPath, canonicalJson(config));
    expect(await result.service.run(args('diagnose', { input: join(result.collected, 'input.json'), config: configPath, output: join(result.directory, 'blocked') }), result.io.io)).toBe(1); expect(result.posts()).toBe(0);
    expect(result.io.stdout.join('')).toContain('retained-input-invalid');
  });
  it('rejects eligible facts tampering independently of a newly bound permit', async () => {
    const result = await setup(), path = join(result.collected, 'input.json'), input = decodeArtifact('input', await readPrivateJson(path)); input.structuralFacts.nodeVersion = '99.0.0'; await writeFile(path, canonicalJson(input));
    const configPath = join(result.directory, 'config.json'), permitPath = join(result.directory, 'permit.json'); await writeFile(configPath, canonicalJson(config)); await writeFile(permitPath, canonicalJson(permitFixture(input)));
    expect(await result.service.run(args('diagnose', { input: path, config: configPath, permit: permitPath, output: join(result.directory, 'blocked') }), result.io.io)).toBe(1); expect(result.posts()).toBe(0);
  });
  it('rejects valid-range timing tampering even with a newly bound permit', async () => {
    const result = await setup(), path = join(result.collected, 'input.json'), input = decodeArtifact('input', await readPrivateJson(path)); input.baselines[0]!.installElapsedMs = 1; await writeFile(path, canonicalJson(input));
    const configPath = join(result.directory, 'config.json'), permitPath = join(result.directory, 'permit.json'); await writeFile(configPath, canonicalJson(config)); await writeFile(permitPath, canonicalJson(permitFixture(input)));
    expect(await result.service.run(args('diagnose', { input: path, config: configPath, permit: permitPath, output: join(result.directory, 'blocked') }), result.io.io)).toBe(1); expect(result.posts()).toBe(0);
  });
  it('rejects modified previews on status readback', async () => {
    const result = await setup(), target = join(result.directory, 'preview'), configPath = join(result.directory, 'config.json'); await writeFile(configPath, canonicalJson(config));
    await result.service.run(args('diagnose', { input: join(result.collected, 'input.json'), config: configPath, output: target }), result.io.io);
    const path = join(target, 'request-preview.json'), preview = await readPrivateJson(path) as Record<string, unknown>; preview.requestHash = '0'.repeat(64); await writeFile(path, canonicalJson(preview));
    expect(await result.service.run(args('status', { operation: target }), result.io.io)).toBe(1);
  });
  it('cannot turn collected input into no-change by editing a stage journal', async () => {
    const result = await setup(), target = join(result.directory, 'preview'), configPath = join(result.directory, 'config.json'); await writeFile(configPath, canonicalJson(config));
    await result.service.run(args('diagnose', { input: join(result.collected, 'input.json'), config: configPath, output: target }), result.io.io);
    const path = join(target, 'operation.json'), state = await readPrivateJson(path) as Record<string, unknown>; state.status = 'no-change'; await writeFile(path, canonicalJson(state));
    expect(await result.service.run(args('status', { operation: target }), result.io.io)).toBe(1);
  });
  it('already cached input completes no-change with no inference or permit', async () => {
    const fixture = githubFixture(), result = await setup(fixture.source.replace('node-version: 22.20.0', 'node-version: 22.20.0\n          cache: pnpm'));
    const configPath = join(result.directory, 'config.json'); await writeFile(configPath, canonicalJson(config));
    expect(await result.service.run(args('diagnose', { input: join(result.collected, 'input.json'), config: configPath, output: join(result.directory, 'no-change') }), result.io.io)).toBe(0);
    expect(result.posts()).toBe(0); expect(result.io.stdout.join('')).toContain('no-change');
  });
  it('treats malformed config as usage failure without raw payload output', async () => {
    const result = await setup(), configPath = join(result.directory, 'config.json'); await writeFile(configPath, '{"raw":"synthetic-provider-key"}');
    expect(await result.service.run(args('diagnose', { input: join(result.collected, 'input.json'), config: configPath, output: join(result.directory, 'invalid') }), result.io.io)).toBe(2);
    expect(result.posts()).toBe(0); expect(result.io.stdout.join('')).not.toContain('synthetic-provider-key');
  });
  it('status reads persisted state and treats incomplete intents as outcome unknown', async () => {
    const result = await setup(), target = join(result.directory, 'preview'), configPath = join(result.directory, 'config.json'); await writeFile(configPath, canonicalJson(config));
    await result.service.run(args('diagnose', { input: join(result.collected, 'input.json'), config: configPath, output: target }), result.io.io);
    const before = await readFile(join(target, 'operation.json'), 'utf8');
    expect(await result.service.run(args('status', { operation: target }), result.io.io)).toBe(0); expect(await readFile(join(target, 'operation.json'), 'utf8')).toBe(before);
    const interrupted = join(result.directory, 'interrupted'); const { withOperationStore } = await import('./store.js');
    await withOperationStore(interrupted, async store => store.writeJson('intent.json', { schemaVersion: 1, kind: 'inference-intent', status: 'intent' }));
    expect(await result.service.run(args('status', { operation: interrupted }), result.io.io)).toBe(1); expect(result.io.stdout.join('')).toContain('outcome-unknown');
  });
});
