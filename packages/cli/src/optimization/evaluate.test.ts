import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { jsonDigest, type ComparisonInputs, type MeasurementSample } from '@cirujano/core';
const comparisonUrl = new URL('../../../core/src/optimization/measurement.test-helper.ts', import.meta.url);
const comparisonFixture = async () => (await import(comparisonUrl.href) as { measurementFixture: () => ComparisonInputs }).measurementFixture();
function setTiming(sample: MeasurementSample, elapsedMs: number) { sample.elapsedMs = elapsedMs; sample.completedAt = new Date(Date.parse(sample.startedAt) + elapsedMs).toISOString(); sample.roundedMinutes = Math.ceil(elapsedMs / 60000); sample.endToEndMs = sample.queueMs + elapsedMs; }
import { publicationFixture } from './publish.test-helper.js';
import { sha256 } from '@cirujano/core';
import { runPublish } from './publish.js';

type Evaluation = { live: boolean; passed: boolean; inferenceCalls: number; groups: { prefilter: { total: number; passed: number; inferenceCalls: number }; adversarial: { total: number; acceptedUnsafe: number }; model: { total: number; opportunitiesCorrect: number; abstentionsCorrect: number; scoreApplicable: boolean } }; cases: { name: string; passed: boolean; input: unknown; preview?: unknown }[]; measurement: { passed: boolean } };
type LiveEvaluation = { cases: { name: string; result: { inference: { completionId: string; requestedModel: string }; diagnosis: { status: string; evidenceIds: string[] } } }[] };
type Evaluator = { validateReplayStructure: (value: unknown) => Promise<unknown>; buildSandboxBoundaryRequest: (profile: unknown, name: string) => { body: string; requestHash: string; fixtureHash: string }; validateSandboxBoundaries: (receipt: unknown, profile: unknown, replay?: boolean) => Promise<unknown>; evaluateOffline: () => Promise<Evaluation>; validateComparison: (value: unknown) => unknown; validateLiveProof: (value: unknown) => Promise<unknown>; runLiveModels: (batch: unknown, output: string, options?: { apiKey?: string; fetch?: typeof fetch; permitLedger?: string }) => Promise<unknown> };
const url = new URL('../../../../scripts/optimization/evaluate.mjs', import.meta.url);
const load = async () => await import(url.href) as Evaluator;
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('complete synthetic policy/replay evaluator', () => {
  it('pins separate 6/8/7 denominators, real boundaries and zero live calls', async () => {
    const result = await (await load()).evaluateOffline();
    expect(result.live).toBe(false); expect(result.passed).toBe(true); expect(result.inferenceCalls).toBe(0);
    expect(result.groups.prefilter).toMatchObject({ total: 6, passed: 6, inferenceCalls: 0 });
    expect(result.groups.adversarial).toMatchObject({ total: 8, acceptedUnsafe: 0 });
    expect(result.groups.model).toMatchObject({ total: 7, opportunitiesCorrect: 6, abstentionsCorrect: 1, scoreApplicable: false });
    expect(result.cases).toHaveLength(21); expect(result.cases.every(row => row.passed)).toBe(true);
    expect(result.measurement.passed).toBe(true);
  });
  it.each(['non-improving', 'below-ten-percent', 'cold-missing', 'sample-failed', 'quality-drift', 'cohort-short'])('rejects %s through the actual comparison', async attack => {
    const comparison = await comparisonFixture();
    if (attack === 'non-improving') for (const row of comparison.samples) setTiming(row, 120000);
    if (attack === 'below-ten-percent') for (const row of comparison.samples.filter(row => row.role === 'candidate')) setTiming(row, 119000);
    if (attack === 'cold-missing') comparison.samples[3]!.cacheObservation = 'hit';
    if (attack === 'sample-failed') comparison.samples[3]!.conclusion = 'failure';
    if (attack === 'quality-drift') comparison.samples[3]!.quality.coverage[0]!.coveredStatements = 1;
    if (attack === 'cohort-short') comparison.samples.pop();
    await expect(Promise.resolve().then(async () => (await load()).validateComparison(comparison))).rejects.toThrow();
  });
  it('requires concrete seven-case permits before any transport or private output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cirujano-eval-')); roots.push(root); let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; throw new Error('must not call'); };
    await expect((await load()).runLiveModels({ schemaVersion: 1, permits: [] }, join(root, 'live'), { apiKey: 'owned-canary', fetch: fetcher })).rejects.toThrow();
    expect(calls).toBe(0); await expect(readFile(join(root, 'live', 'evaluation.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects offline and incomplete manifests without opening a provider connection', async () => {
    for (const manifest of [{ live: false }, { schemaVersion: 1, kind: 'optimization-live-proof', live: true, provider: 'other' }, { schemaVersion: 1, kind: 'optimization-live-proof', live: true, provider: 'nebius-token-factory' }]) await expect((await load()).validateLiveProof(manifest)).rejects.toThrow();
  });
  it('validates the entire model-to-PR chain and rejects mutated evidence', { timeout: 30000 }, async () => {
    const evaluator = await load(), offline = await evaluator.evaluateOffline(), f = await publicationFixture(); roots.push(f.directory); f.pulls.push(f.pull());
    expect((await runPublish(f.reportPath, f.permit, f.options)).status).toBe('published');
    const model = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B', permits = offline.cases.filter(row => row.preview).filter(row => !['prompt-injection', 'unknown-evidence', 'changed-test', 'changed-permission'].includes(row.name)).map(row => ({ name: row.name, permit: { schemaVersion: 1, kind: 'inference-permit', permitId: row.name, repositoryId: 123, inputDigest: jsonDigest(row.input), model, endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions', expiresAt: '2099-01-01T00:00:00Z', maxRequests: 1, maxCompletionTokens: 2048, priceBasis: null } }));
    let posts = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      if (init?.method === 'GET') return new Response(JSON.stringify({ data: [{ id: model }] }));
      posts++; const request = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const facts = JSON.parse(request.messages[1]!.content) as { baselines: { installElapsedMs: number }[]; operations: unknown[] };
      const abstain = facts.baselines[0]!.installElapsedMs === 1;
      return new Response(JSON.stringify({ id: `live-owned-${posts}`, model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ decision: abstain ? 'abstain' : 'proposal', analysis: 'Owned synthetic model response for live harness test.', uncertainty: 'Timing remains unmeasured.', evidence: { install: true }, operation: abstain ? null : facts.operations[0] }), refusal: null } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }));
    };
    const output = join(f.directory, 'live-models');
    const replayed = await evaluator.runLiveModels({ schemaVersion: 1, kind: 'model-evaluation-permits', model, permits }, output, { apiKey: 'owned-test-key', fetch: fetcher, permitLedger: join(f.directory, 'model-ledger') }); expect(posts).toBe(7); expect(replayed).toMatchObject({ live: false, transport: 'injected-replay' });
    const replayOutput = join(f.directory, 'live-models-replay');
    await expect(evaluator.runLiveModels({ schemaVersion: 1, kind: 'model-evaluation-permits', model, permits }, replayOutput, { apiKey: 'owned-test-key', fetch: fetcher, permitLedger: join(f.directory, 'model-ledger') })).rejects.toThrow(); expect(posts).toBe(7);
    const stopped = JSON.parse(await readFile(join(replayOutput, 'evaluation.json'), 'utf8')) as { cases: { result: { status: string } }[] };
    expect(stopped.cases).toHaveLength(7); expect(stopped.cases[0]!.result.status).toBe('failed'); expect(stopped.cases.slice(1).every(row => row.result.status === 'not-run')).toBe(true);
    const sandboxBoundaryPath = join(f.directory, 'boundary.json');
    const checks = ['network-denial', 'output-bound', 'cancel-terminal'].map((name, index) => {
      const request = evaluator.buildSandboxBoundaryRequest(f.profile, name), stdout = name === 'network-denial' ? '{"networkDenied":true}\n' : name === 'output-bound' ? 'a'.repeat(1048576) : '';
      return { name, fixtureHash: request.fixtureHash, requestHash: request.requestHash, request: JSON.parse(request.body) as unknown, stdout, stderr: '', cancelRequested: name === 'cancel-terminal', terminalReadback: true, operation: { id: `00000000-0000-4000-8000-00000000000${index}`, status: name === 'cancel-terminal' ? 'CANCELLED' : 'SUCCESS', imageUuid: f.profile.image.uuid, project: f.profile.project, disposable: true, process: { exitCode: 0, signal: name === 'cancel-terminal' ? 15 : 0, timedOut: false, stopped: false, continued: false, coreDump: false }, usage: null, createdAt: '2026-09-30T00:00:00Z', providerDuration: 100, stdoutHash: sha256(stdout), stderrHash: sha256(''), stdoutTruncated: name === 'output-bound', stderrTruncated: false } };
    });
    const boundaries = { schemaVersion: 1, kind: 'sandbox-boundary-receipt', live: false, transport: 'injected-replay', profileDigest: jsonDigest(f.profile), imageUuid: f.profile.image.uuid, imageDigest: f.profile.image.ociDigest, project: f.profile.project, harnessHash: f.profile.image.harnessHash, toolSourceSha: f.profile.provenance.toolSourceSha, bundleDigest: f.profile.provenance.bundleDigest, sourceTreeDigest: f.profile.provenance.sourceTreeDigest, checks };
    await writeFile(sandboxBoundaryPath, JSON.stringify(boundaries), { mode: 0o600 });
    await expect(evaluator.validateSandboxBoundaries(boundaries, f.profile, true)).resolves.toBeDefined();
    const nullCancellation = { ...boundaries, checks: boundaries.checks.map((check, index) => index === 2 ? { ...check, stdout: null, stderr: null, operation: { ...check.operation, process: null, stdoutHash: null, stderrHash: null, stdoutTruncated: null, stderrTruncated: null } } : check) };
    await expect(evaluator.validateSandboxBoundaries(nullCancellation, f.profile, true)).resolves.toBeDefined();
    const numericTimestamp = { ...boundaries, checks: boundaries.checks.map((check, index) => index === 0 ? { ...check, operation: { ...check.operation, createdAt: 0 } } : check) };
    await expect(evaluator.validateSandboxBoundaries(numericTimestamp, f.profile, true)).rejects.toThrow();

    for (const index of [0, 1]) {
      const nullSuccess = { ...boundaries, checks: boundaries.checks.map((check, row) => row === index ? { ...check, operation: { ...check.operation, process: null } } : check) };
      await expect(evaluator.validateSandboxBoundaries(nullSuccess, f.profile, true)).rejects.toThrow();
    }
    const malformedCancellation = { ...boundaries, checks: boundaries.checks.map((check, index) => index === 2 ? { ...check, operation: { ...check.operation, process: { ...check.operation.process, signal: '15' } } } : check) };
    await expect(evaluator.validateSandboxBoundaries(malformedCancellation, f.profile, true)).rejects.toThrow();

    for (const attack of ['image', 'network', 'output', 'cancel', 'terminal', 'duplicate', 'fixture']) {
      const changed = structuredClone(boundaries);
      if (attack === 'image') changed.imageUuid = '00000000-0000-0000-0000-000000000000';
      if (attack === 'network') changed.checks[0]!.stdout = '{"networkDenied":false}\n';
      if (attack === 'output') changed.checks[1]!.operation.stdoutTruncated = false;
      if (attack === 'cancel') changed.checks[2]!.cancelRequested = false;
      if (attack === 'terminal') changed.checks[2]!.operation.status = 'EXECUTING';
      if (attack === 'duplicate') changed.checks[2]!.operation.id = changed.checks[0]!.operation.id;
      if (attack === 'fixture') changed.checks[0]!.fixtureHash = 'f'.repeat(64);
      await expect(evaluator.validateSandboxBoundaries(changed, f.profile, true)).rejects.toThrow();
    }
    const modelEvaluationPath = join(output, 'evaluation.json'), manifest = { schemaVersion: 1, kind: 'optimization-replay-proof', provider: 'nebius-token-factory', live: false, model, reportPath: f.reportPath, publicationDirectory: f.publication, modelEvaluationPath, sandboxBoundaryPath };
    // Only the external transports are synthetic; all retained product stages are real.
    await expect(evaluator.validateReplayStructure(manifest)).resolves.toMatchObject({ structuralComplete: true, passed: false, live: false, h1Closed: false, inferenceCalls: 0, models: { scoreApplicable: false }, publicationUrl: f.pull().html_url });
    await expect(evaluator.validateLiveProof({ ...manifest, kind: 'optimization-live-proof', live: true })).rejects.toThrow();
    const original = await readFile(modelEvaluationPath, 'utf8');
    await writeFile(modelEvaluationPath, JSON.stringify({ ...JSON.parse(original) as Record<string, unknown>, kind: 'optimization-live-model-evaluation', live: true, transport: 'native' }), { mode: 0o600 });
    await writeFile(sandboxBoundaryPath, JSON.stringify({ ...boundaries, live: true, transport: 'native' }), { mode: 0o600 });
    // Even structurally native-looking retained receipts do not grant native acceptance.
    await expect(evaluator.validateLiveProof({ ...manifest, kind: 'optimization-live-proof', live: true })).resolves.toMatchObject({ structuralComplete: true, passed: false, live: false, h1Closed: false, nativeAcceptance: 'not-assessed', requiredNativeGates: ['native-sandbox-boundary-provider-readback', 'current-github-publication-readback'] });
    await writeFile(modelEvaluationPath, original, { mode: 0o600 }); await writeFile(sandboxBoundaryPath, JSON.stringify(boundaries), { mode: 0o600 });
    await expect(evaluator.validateReplayStructure({ ...manifest, sandboxBoundaryPath: join(f.directory, 'absent-boundary.json') })).rejects.toThrow();

    for (const attack of ['wrong-model', 'unknown-evidence', 'no-abstention', 'duplicate-completion', 'held-out-reuse']) {
      const evaluation = JSON.parse(original) as LiveEvaluation;
      if (attack === 'wrong-model') evaluation.cases[0]!.result.inference.requestedModel = 'nvidia/other';
      if (attack === 'unknown-evidence') evaluation.cases[0]!.result.diagnosis.evidenceIds = ['invented'];
      if (attack === 'no-abstention') evaluation.cases[6]!.result.diagnosis.status = 'proposal';
      if (attack === 'duplicate-completion') evaluation.cases[1]!.result.inference.completionId = evaluation.cases[0]!.result.inference.completionId;
      if (attack === 'held-out-reuse') evaluation.cases[0]!.result.inference.completionId = 'completion-1';
      await writeFile(modelEvaluationPath, JSON.stringify(evaluation), { mode: 0o600 }); await expect(evaluator.validateReplayStructure(manifest)).rejects.toThrow();
    }
    await writeFile(modelEvaluationPath, original, { mode: 0o600 });
    const readback = JSON.parse(await readFile(join(f.publication, 'publication-readback.json'), 'utf8')) as Record<string, unknown>;
    readback.headSha = 'f'.repeat(40); await writeFile(join(f.publication, 'publication-readback.json'), JSON.stringify(readback), { mode: 0o600 });
    await expect(evaluator.validateReplayStructure(manifest)).rejects.toThrow('publication-readback-drift');
  });
});
