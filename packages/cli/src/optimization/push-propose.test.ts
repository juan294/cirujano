import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, CLASSIFIER_DIGEST, createSkipValidatedPushPatch, decodePushArtifact, extractClassifierScript, jsonDigest, sha256 } from '@cirujano/core';
import { createOptimizationService, type OptimizeArguments } from './service.js';
import { config } from './nebius.test-helper.js';
import { baseSha, branch, eligibleWorkflow, pushGithubFixture, repository, workflow } from './push-collect.test-helper.js';
import { pushDecision, pushPermitFixture, pushTransport } from './push-diagnose.test-helper.js';
import { readPushProposalContext } from './push-propose.js';
import { readPrivateJson } from './store.js';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const args = (action: OptimizeArguments['action'], flags: Record<string, string>): OptimizeArguments => ({ command: 'optimize', action, flags, format: 'json' });
type State = { status: string; reasonCode: string; nextCommand: string };

async function setup(decision: 'proposal' | 'abstain' = 'proposal', source = eligibleWorkflow) {
  const directory = await mkdtemp(join(tmpdir(), 'cirujano-push-propose-')); directories.push(directory);
  const stdout: string[] = [], io = { stdout: (value: string) => { stdout.push(value); }, stderr: () => {} }, last = () => JSON.parse(stdout.at(-1)!) as State;
  const service = createOptimizationService({ pageRunner: pushGithubFixture(source).pageRunner, fetch: pushTransport(pushDecision(decision)).fetcher, apiKey: 'synthetic-provider-key', toolSourceSha: '1'.repeat(40), bundleDigest: '2'.repeat(64), permitLedger: join(directory, 'permits') });
  const collected = join(directory, 'collected'), diagnosed = join(directory, 'diagnosed'), proposed = join(directory, 'proposed');
  expect(await service.run(args('collect', { family: 'skip-validated-push', repository, ref: baseSha, workflow, branch, output: collected }), io)).toBe(0);
  const input = decodePushArtifact('input', await readPrivateJson(join(collected, 'input.json')));
  if (input.status === 'collected') {
    const configPath = join(directory, 'config.json'), permitPath = join(directory, 'permit.json');
    await writeFile(configPath, canonicalJson(config)); await writeFile(permitPath, canonicalJson(pushPermitFixture(input)));
    expect(await service.run(args('diagnose', { input: join(collected, 'input.json'), config: configPath, permit: permitPath, output: diagnosed }), io)).toBe(0);
  }
  const propose = () => service.run(args('propose', { input: join(collected, 'input.json'), diagnosis: join(diagnosed, 'diagnosis.json'), output: proposed }), io);
  const status = () => service.run(args('status', { operation: proposed }), io);
  return { directory, service, io, last, input, collected, diagnosed, proposed, propose, status };
}

describe('skip-validated-push propose', () => {
  it('writes a guard-only proposal bound to the diagnosis, the candidate and the classifier digest', async () => {
    const context = await setup();
    expect(await context.propose()).toBe(0);
    expect(context.last()).toMatchObject({ status: 'proposed', reasonCode: 'guard-only-proposal' });
    const proposal = decodePushArtifact('proposal', await readPrivateJson(join(context.proposed, 'proposal.json')));
    const diagnosis = decodePushArtifact('diagnosis', await readPrivateJson(join(context.diagnosed, 'diagnosis.json')));
    const candidate = await readFile(join(context.proposed, 'candidate.yml'), 'utf8'), patch = await readFile(join(context.proposed, 'workflow.patch'), 'utf8');
    const expected = createSkipValidatedPushPatch(eligibleWorkflow, { workflowHash: sha256(eligibleWorkflow), workflowPath: workflow, integrationBranch: branch, inventory: [{ path: workflow, source: eligibleWorkflow }, { path: '.github/workflows/release.yml', source: pushGithubFixture().files['.github/workflows/release.yml']! }] });
    expect(candidate).toBe(expected.candidate); expect(patch).toBe(expected.patch);
    expect(proposal).toMatchObject({ family: 'skip-validated-push', status: 'proposed', operation: diagnosis.operation, candidateSha: null, candidateWorkflowHash: sha256(candidate), patchHash: sha256(patch), permittedDiff: { classifierJobId: 'cirujano_validated_push', guardedJobIds: ['test'] }, diagnosisDigest: jsonDigest(diagnosis) });
    expect(sha256(extractClassifierScript(candidate))).toBe(proposal.provenance.classifierDigest); expect(proposal.provenance.classifierDigest).toBe(CLASSIFIER_DIGEST);
    await expect(readFile(join(context.proposed, 'action-receipt.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await context.status()).toBe(0); expect(context.last()).toMatchObject({ status: 'proposed', reasonCode: 'guard-only-proposal' });
    await expect(readPushProposalContext(join(context.proposed, 'proposal.json'))).resolves.toMatchObject({ candidate, patch });
  });
  it('records an abstention without a patch', async () => {
    const context = await setup('abstain');
    expect(await context.propose()).toBe(0); expect(context.last()).toMatchObject({ status: 'abstain', reasonCode: 'model-abstained' });
    await expect(readFile(join(context.proposed, 'candidate.yml'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await context.status()).toBe(0); expect(context.last().status).toBe('abstain');
  });
  it('records an already guarded workflow as no-change without a diagnosis', async () => {
    const guarded = createSkipValidatedPushPatch(eligibleWorkflow, { workflowHash: sha256(eligibleWorkflow), workflowPath: workflow, integrationBranch: branch, inventory: [] }).candidate;
    const context = await setup('proposal', guarded);
    expect(context.input).toMatchObject({ status: 'no-change', structuralFacts: { reasonCode: 'already-guarded' } });
    expect(await context.propose()).toBe(0); expect(context.last()).toMatchObject({ status: 'no-change', reasonCode: 'already-guarded-no-change' });
    expect(await context.status()).toBe(0); expect(context.last().status).toBe('no-change');
  });
  it.each([
    ['candidate', 'candidate.yml', (text: string) => text.replace('timeout-minutes: 2', 'timeout-minutes: 3')],
    ['patch', 'workflow.patch', (text: string) => `${text}\n`],
    ['proposal', 'proposal.json', (text: string) => text.replace('"guard-only-change"', '"other-change"')],
    ['receipt', 'patch-receipt.json', (text: string) => text.replace(/"patchHash":"[a-f0-9]{64}"/, `"patchHash":"${'0'.repeat(64)}"`)],
  ])('rejects a retained proposal whose %s drifted', async (_name, file, mutate) => {
    const context = await setup(); expect(await context.propose()).toBe(0);
    const path = join(context.proposed, file), before = await readFile(path, 'utf8'), after = mutate(before);
    expect(after).not.toBe(before); await writeFile(path, after, { mode: 0o600 });
    expect(await context.status()).toBe(1); expect(context.last().status).toBe('failed');
    await expect(readPushProposalContext(join(context.proposed, 'proposal.json'))).rejects.toThrow();
  });
  it('rejects a diagnosis from another collection', async () => {
    const first = await setup(), second = await setup('proposal', `${eligibleWorkflow}# another revision\n`);
    expect(await first.service.run(args('propose', { input: join(first.collected, 'input.json'), diagnosis: join(second.diagnosed, 'diagnosis.json'), output: join(first.directory, 'crossed') }), first.io)).toBe(1);
    expect(first.last()).toMatchObject({ status: 'rejected', reasonCode: 'proposal-evidence-rejected' });
  });
});
