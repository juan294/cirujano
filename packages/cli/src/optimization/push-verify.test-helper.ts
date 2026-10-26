import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { canonicalJson, decodePushArtifact, decodePushGuardPayload, jsonDigest, sha256, verifyPushGuards } from '@cirujano/core';
import { config } from './nebius.test-helper.js';
import { baseSha, branch, pushGithubFixture, repository, workflow } from './push-collect.test-helper.js';
import { pushDecision, pushPermitFixture, pushTransport } from './push-diagnose.test-helper.js';
import { runClassifierCase } from './push-guard-harness-entry.js';
import { decodePushGuardProfile, type PushGuardProfile } from './push-verify.js';
import { createOptimizationService, type OptimizeArguments } from './service.js';
import { readPrivateJson } from './store.js';

export const command = (action: OptimizeArguments['action'], flags: Record<string, string>): OptimizeArguments => ({ command: 'optimize', action, flags, format: 'json' });
type Provider = (payload: unknown) => Promise<string>;
/** The provider runs the real push-guard verifier on the uploaded payload, spawning the embedded script per case as the image's harness does. */
export const realHarness: Provider = async payload => `${canonicalJson(await verifyPushGuards(decodePushGuardPayload(payload), runClassifierCase))}\n`;
/** The same verifier with each case answered in process: the CLI tests need the binding, not 60 node spawns each. */
export async function resultFor(payload: unknown, override: Record<string, unknown> = {}): Promise<string> {
  return `${canonicalJson({ ...await verifyPushGuards(decodePushGuardPayload(payload), async (_script, testCase) => testCase.expected), ...override })}\n`;
}

/** A push proposal from a real local candidate commit, a bound push-guard profile and permit, and a fake Sandbox provider. */
export async function pushVerificationFixture(options: { provider?: Provider; imageStatus?: number; createStatus?: number } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'cirujano-push-verify-'))), repositoryPath = join(directory, 'repository');
  const github = pushGithubFixture();
  const git = (...args: string[]) => execFileSync('git', ['-C', repositoryPath, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'user.name=Owned Fixture', '-c', 'user.email=fixture@invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  await mkdir(repositoryPath);
  for (const [path, bytes] of Object.entries(github.files)) { await mkdir(dirname(join(repositoryPath, path)), { recursive: true }); await writeFile(join(repositoryPath, path), bytes); }
  git('init', '--initial-branch=develop'); git('add', '.'); git('commit', '-m', 'Owned baseline'); const realBase = git('rev-parse', 'HEAD');
  // The synthetic GitHub fixture names a placeholder base commit; this repository holds the real one.
  const rewrite = (value: unknown): unknown => Array.isArray(value) ? value.map(rewrite) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'sha' && item === baseSha ? realBase : rewrite(item)])) : value;
  const pageRunner: typeof github.pageRunner = async (cmd, args, runOptions) => ({ stdout: JSON.stringify(rewrite(JSON.parse((await github.pageRunner(cmd, args.map(arg => arg.replace(realBase, baseSha)), runOptions)).stdout))) });
  const output: string[] = [], io = { stdout: (value: string) => { output.push(value); }, stderr: (value: string) => { output.push(value); } };
  const service = createOptimizationService({ pageRunner, fetch: pushTransport(pushDecision()).fetcher, apiKey: 'synthetic-provider-key', toolSourceSha: '1'.repeat(40), bundleDigest: '2'.repeat(64), permitLedger: join(directory, 'inference-ledger') });
  const collected = join(directory, 'collected'), diagnosed = join(directory, 'diagnosed'), proposed = join(directory, 'proposed'), verified = join(directory, 'verified');
  if (await service.run(command('collect', { family: 'skip-validated-push', repository, ref: realBase, workflow, branch, output: collected }), io) !== 0) throw new Error(output.join(''));
  const input = decodePushArtifact('input', await readPrivateJson(join(collected, 'input.json'))), configPath = join(directory, 'config.json'), inferencePermit = join(directory, 'inference-permit.json');
  await writeFile(configPath, canonicalJson(config)); await writeFile(inferencePermit, canonicalJson(pushPermitFixture(input)));
  if (await service.run(command('diagnose', { input: join(collected, 'input.json'), config: configPath, permit: inferencePermit, output: diagnosed }), io) !== 0) throw new Error(output.join(''));
  if (await service.run(command('propose', { input: join(collected, 'input.json'), diagnosis: join(diagnosed, 'diagnosis.json'), output: proposed }), io) !== 0) throw new Error(output.join(''));
  const proposal = decodePushArtifact('proposal', await readPrivateJson(join(proposed, 'proposal.json'))), candidate = await readFile(join(proposed, 'candidate.yml'), 'utf8');
  await writeFile(join(repositoryPath, workflow), candidate); git('add', '.'); git('commit', '-m', 'Owned exact candidate'); const candidateSha = git('rev-parse', 'HEAD');
  const harnessBytes = await readFile(new URL('../../../../scripts/optimization/push-guard-harness.mjs', import.meta.url));
  const manifest = { schemaVersion: 1, kind: 'push-guard-image', toolSourceSha: input.provenance.toolSourceSha, bundleDigest: input.provenance.bundleDigest, nodeVersion: '22.23.3', harnessHash: sha256(harnessBytes), recipeHash: '8'.repeat(64) }, manifestBytes = Buffer.from(canonicalJson(manifest));
  const profile: PushGuardProfile = decodePushGuardProfile({ schemaVersion: 1, kind: 'push-guard-profile', provenance: input.provenance, proposalDigest: jsonDigest(proposal), candidateSha, candidateRepository: repositoryPath, project: 'owned-project', image: { uuid: '12345678-9abc-baba-deda-0123456789ab', ociDigest: '4'.repeat(64), registryReference: `docker://registry.invalid/proof@sha256:${'4'.repeat(64)}`, importOperationId: '12345678-9abc-baba-deda-0123456789ac', buildOperationIds: [], recipeHash: manifest.recipeHash, manifestHash: sha256(manifestBytes), harnessHash: manifest.harnessHash }, timeoutSeconds: 600, maxLayerBytes: 1024 * 1024 * 1024, imageRetention: 'owner-retained' });
  const permit = { schemaVersion: 1, kind: 'sandbox-permit', permitId: 'owned-push-guard', repositoryId: input.provenance.repositoryId, proposalDigest: jsonDigest(proposal), profileDigest: jsonDigest(profile), candidateSha, imageUuid: profile.image.uuid, project: profile.project, expiresAt: '2099-09-29T23:00:00Z', maxOperations: 2 };
  const calls: { url: string; method: string }[] = [], uploads = new Map<string, string>(), stdoutById = new Map<string, string>(), requests = new Map<string, unknown>();
  let creates = 0;
  const provider = options.provider ?? (raw => resultFor(raw));
  const fetcher: typeof fetch = async (url, init) => {
    const target = String(url), method = init?.method ?? 'GET';
    if (method === 'POST' && target.endsWith('/sandboxes/v1/files')) { const bytes = Buffer.from(init!.body as Uint8Array), uuid = `f1f1f1f1-f1f1-5f1f-8f1f-0000000000${String(uploads.size).padStart(2, '0')}`; uploads.set(uuid, bytes.toString('utf8')); return new Response(JSON.stringify({ uuid, sha256: sha256(bytes), size: bytes.length }), { status: 201 }); }
    calls.push({ url: target, method });
    if (target.includes('/inspect/') && options.imageStatus) return new Response('{}', { status: options.imageStatus });
    if (target.includes('/inspect/') && target.includes('/download?')) return new Response(target.includes('harness.mjs') ? harnessBytes : manifestBytes);
    if (target.includes('/inspect/')) return new Response(JSON.stringify({ uuid: profile.image.uuid, operation_uuid: profile.image.importOperationId }));
    if (target.endsWith(profile.image.importOperationId)) return new Response(JSON.stringify({ uuid: profile.image.importOperationId, kind: 'image_import', status: 'SUCCESS', result: { image: profile.image.uuid }, metadata: { registry: { url: profile.image.registryReference } } }));
    const body = init?.body ? JSON.parse(String(init.body)) as { files: Record<string, { uuid: string }> } & Record<string, unknown> : null;
    if (method === 'POST' && options.createStatus) return new Response('{}', { status: options.createStatus });
    if (method === 'POST') { const id = `12345678-9abc-baba-deda-0123456789${++creates === 1 ? 'ad' : 'ae'}`; requests.set(id, body); stdoutById.set(id, await provider(JSON.parse(uploads.get(body!.files['/tmp/cirujano-payload.json']!.uuid)!))); return new Response(JSON.stringify({ uuid: id, image: profile.image.uuid }), { status: 201, headers: { Location: `/sandboxes/v1/operations/${id}` } }); }
    const id = target.split('/').at(-1)!, stdout = stdoutById.get(id); if (stdout === undefined) throw new Error('unowned operation');
    return new Response(JSON.stringify({ uuid: id, kind: 'instance', status: 'SUCCESS', image_uuid: profile.image.uuid, result_image_uuid: null, metadata: { ...(requests.get(id) as object), result: { state: { exit_code: 0, signal: 0, timed_out: false, stopped: false, continued: false, core_dump: false }, stdout: { value: Buffer.from(stdout).toString('base64'), encoding: 'base64', truncated: false }, stderr: { value: '', encoding: 'ascii', truncated: false }, resources: { cost: 0.01 } } } }));
  };
  const profilePath = join(directory, 'push-guard-profile.json'), permitPath = join(directory, 'sandbox-permit.json');
  await writeFile(profilePath, canonicalJson(profile)); await writeFile(permitPath, canonicalJson(permit));
  const verifier = createOptimizationService({ fetch: fetcher, iamToken: 'owned-iam-token', permitLedger: join(directory, 'sandbox-ledger') });
  const verify = () => verifier.run(command('verify', { proposal: join(proposed, 'proposal.json'), profile: profilePath, permit: permitPath, output: verified }), io);
  const last = () => JSON.parse(output.at(-1)!) as { status: string; reasonCode: string; recovery?: string };
  return { directory, repositoryPath, git, proposal, candidate, candidateSha, profile, permit, profilePath, permitPath, verified, verifier, verify, calls, creates: () => creates, io, output, last };
}
