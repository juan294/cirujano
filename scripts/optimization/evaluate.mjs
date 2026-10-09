import { mkdtemp, readFile, realpath, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const nativeFetch = globalThis.fetch;
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../packages/cli/package.json', import.meta.url));
const MODEL = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';
const CONFIG = { schemaVersion: 1, model: MODEL, endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions' };
let loaded;
/** Compile the existing product modules unchanged. This harness owns no alternate policy. */
async function product() {
  if (!loaded) loaded = (async () => {
    const { build } = require('esbuild');
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-evaluator-modules-'));
    try {
      const modules = ['packages/core/src/index.ts', 'packages/core/src/optimization/measurement.test-helper.ts', ...['diagnose', 'nebius', 'store', 'report-service', 'publish', 'execution-profile'].map(name => `packages/cli/src/optimization/${name}.ts`)];
      const output = join(directory, 'product.mjs');
      await build({ stdin: { contents: modules.map(path => `export * from ${JSON.stringify(join(root, path))};`).join('\n'), resolveDir: root }, bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: output, define: { CIRUJANO_HARNESS_HASH: JSON.stringify(createHash('sha256').update(await readFile(join(root, 'scripts/optimization/harness.mjs'))).digest('hex')) }, logLevel: 'silent', banner: { js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);" } });
      return await import(pathToFileURL(output).href);
    } finally { await rm(directory, { recursive: true, force: true }); }
  })();
  return loaded;
}
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(code);
  return value;
}
async function corpus() {
  const p = await product(), directory = join(root, 'packages/core/fixtures/optimization');
  const manifest = p.parseStrictJson(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const receipt = p.decodeActionReceipt(p.parseStrictJson(await readFile(join(directory, 'setup-node-receipt.json'), 'utf8')));
  if (manifest.cases.length !== 21 || new Set(manifest.cases.map(row => row.name)).size !== 21) throw new Error('corpus-count-drift');
  return Promise.all(manifest.cases.map(async entry => {
    const source = await readFile(join(directory, entry.file), 'utf8');
    const provenance = { ...manifest.provenance, workflowHash: p.sha256(source) };
    const options = { provenance, receipt, rootLockfile: true, timedBaseline: entry.timedBaseline !== false, requiredChecks: ['test'], verificationProfilePresent: true };
    const inspection = p.inspectWorkflow(source, options);
    const input = p.decodeArtifact('input', { schemaVersion: 1, kind: 'input', provenance, status: inspection.status === 'eligible' ? 'collected' : inspection.status, structuralFacts: inspection.structuralFacts, evidence: { install: 'Frozen pnpm installation observed in the labeled synthetic baseline.', 'setup-node-receipt': p.canonicalJson(receipt) }, operations: inspection.operations, requiredChecks: ['test'], baselines: entry.timedBaseline === false ? [] : [{ runId: 99, attempt: 1, jobId: 100, headSha: provenance.baseSha, conclusion: 'success', startedAt: '2026-09-29T10:00:00Z', completedAt: '2026-09-29T10:02:00Z', elapsedMs: 120000, installStepNumber: 4, installElapsedMs: entry.installElapsedMs ?? 60000, runnerLabels: ['ubuntu-24.04'], runnerImage: null, requiredChecks: ['test'] }] });
    return { entry, source, options, inspection, input };
  }));
}
/** Six labeled synthetic push-family cases; the same product policy builds every input. */
async function pushCorpus() {
  const p = await product(), directory = join(root, 'packages/core/fixtures/optimization/push');
  const manifest = p.parseStrictJson(await readFile(join(directory, 'evaluation.json'), 'utf8'));
  if (manifest.cases.length !== 6 || new Set(manifest.cases.map(row => row.name)).size !== 6) throw new Error('push-corpus-count-drift');
  return Promise.all(manifest.cases.map(async entry => {
    const source = await readFile(join(directory, entry.file), 'utf8'), workflowPath = manifest.provenance.workflowPath;
    const inventory = [{ path: workflowPath, source }, ...await Promise.all((entry.inventory ?? []).map(async path => ({ path: `.github/workflows/${path.split('/').pop()}`, source: await readFile(join(directory, path), 'utf8') })))];
    const eligibility = p.inspectPushWorkflow(source, { workflowHash: p.sha256(source), workflowPath, integrationBranch: entry.branch, inventory });
    const history = Array.from({ length: entry.pushes }, (_, index) => ({ pushRunId: 1000 + index, attempt: 1, headSha: (1000 + index).toString(16).padStart(40, '0'), billedMinutes: entry.minutes, jobsBilled: eligibility.structuralFacts.guardedJobCount, prNumber: index < entry.validated ? 100 + index : null, validated: index < entry.validated, reasonCode: index < entry.validated ? 'validated' : 'no-merged-pr' }));
    let input = p.createPushInput({ provenance: { ...manifest.provenance, workflowBlobSha: p.gitBlobSha(source), workflowHash: p.sha256(source), integrationBranch: entry.branch, classifierDigest: p.CLASSIFIER_DIGEST }, eligibility, history, treeSha: manifest.treeSha });
    // Collection never retains free text, so the attack adds one: evidence that tries to dictate an operation.
    if (entry.attack === 'evidence-operation-injection') input = p.decodePushArtifact('input', { ...input, evidence: { ...input.evidence, 'pull-request-title': entry.injection } });
    return { entry, input };
  }));
}
function pushDecision(row) {
  const abstain = row.entry.expectedDiagnosis === 'abstain', operation = structuredClone(row.input.operations[0]);
  if (row.entry.attack === 'evidence-operation-injection') operation.guardedJobIds = ['build', 'deploy', 'lint', 'test'];
  return { decision: abstain ? 'abstain' : 'proposal', analysis: abstain ? 'Too few pushes are validated, or a push bills no more than the classifier.' : 'Most pushes repeat a tree their pull request already tested green.', uncertainty: 'The saving remains unmeasured until the per-push gate.', evidence: { 'classifier-reasons': true, 'push-history': true, 'workflow-eligibility': true }, operation: abstain ? null : operation };
}
function decision(row) {
  const abstain = row.entry.expectedDiagnosis === 'abstain';
  return { decision: abstain ? 'abstain' : 'proposal', analysis: abstain ? 'The synthetic installation took only one millisecond.' : 'The observed installation can reuse the pnpm store.', uncertainty: 'Performance remains unmeasured until the matched whole-job comparison.', evidence: { install: true, 'setup-node-receipt': true }, operation: abstain ? null : row.input.operations[0] };
}
function syntheticPermit(p, input, name) {
  return { schemaVersion: 1, kind: 'inference-permit', permitId: `offline-${name}`, repositoryId: input.provenance.repositoryId, inputDigest: p.jsonDigest(input), ...CONFIG, expiresAt: '2099-01-01T00:00:00Z', maxRequests: 1, maxCompletionTokens: 2048, priceBasis: null };
}
async function replay(row, changedDecision = decision(row)) {
  const p = await product(); let requests = 0, prompt = '';
  const fetcher = async (_url, init) => {
    if (init.method === 'GET') return new Response(JSON.stringify({ data: [{ id: MODEL }] }));
    requests++; prompt = init.body;
    return new Response(JSON.stringify({ id: `synthetic-${row.entry.name}`, model: MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(changedDecision), refusal: null } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }));
  };
  const result = await p.diagnoseOptimization(row.input, CONFIG, syntheticPermit(p, row.input, row.entry.name), { apiKey: 'offline-owned-transport', fetch: fetcher, beforePost: async () => {} });
  return { result, replayRequests: requests, prompt };
}
/** Never accepts a serialized status in place of the actual comparison. */
export async function validateComparison(comparison) {
  const result = (await product()).compareMeasurement(comparison);
  if (result.status !== 'measured-improvement') throw new Error(`measurement-${result.status}`);
  return result;
}
async function measurementBoundaryReplay() {
  const p = await product();
  // The existing measurement fixture is purely synthetic input data. Its product
  // comparison is imported unchanged; no timing is presented as measured.
  const comparison = p.measurementFixture();
  await validateComparison(comparison);
  const probes = [];
  for (const name of ['equal-times', 'median-threshold', 'billable-minute-regression', 'missing-cold', 'failed-attempt', 'changed-quality', 'missing-sample']) {
    const mutant = structuredClone(comparison);
    const timing = (row, ms) => { row.elapsedMs = ms; row.completedAt = new Date(Date.parse(row.startedAt) + ms).toISOString(); row.roundedMinutes = Math.ceil(ms / 60000); row.endToEndMs = row.queueMs + ms; };
    if (name === 'equal-times') for (const row of mutant.samples) timing(row, 120000);
    if (name === 'median-threshold') for (const row of mutant.samples.filter(row => row.role === 'candidate')) timing(row, 119000);
    if (name === 'billable-minute-regression') mutant.samples.forEach((row, index) => timing(row, row.role === 'base' ? 59000 : index === 3 ? 61000 : 40000));
    if (name === 'missing-cold') mutant.samples[3].cacheObservation = 'hit';
    if (name === 'failed-attempt') mutant.samples[3].conclusion = 'failure';
    if (name === 'changed-quality') mutant.samples[3].quality.coverage[0].coveredStatements = 1;
    if (name === 'missing-sample') mutant.samples.pop();
    let rejected = false;
    try { await validateComparison(mutant); } catch { rejected = true; }
    probes.push({ name, rejected });
  }
  return { synthetic: true, passed: probes.every(row => row.rejected), probes, thresholds: { samples: 6, baseline: 3, candidate: 3, medianImprovementMinimum: 0.1, billableMinuteIncreaseAllowed: false }, productModule: 'compareMeasurement' };
}
export async function evaluateOffline() {
  const p = await product(), rows = await corpus(), cases = [];
  for (const row of rows) {
    const { entry, source, options, input, inspection } = row;
    const group = entry.attack || ['yaml-alias', 'duplicate-key', 'path-traversal', 'secret-config'].includes(entry.name) ? 'adversarial' : entry.gate === 'prefilter' ? 'prefilter' : 'model';
    let passed = inspection.status === entry.status && inspection.reason === entry.reason, acceptedUnsafe = 0, replayRequests = 0;
    const preview = (await p.diagnoseOptimization(input, CONFIG, undefined)).preview;
    if (inspection.status !== 'eligible') {
      let calls = 0;
      const result = await p.diagnoseOptimization(input, CONFIG, undefined, { fetch: async () => { calls++; throw new Error('prefilter-issued-transport'); } });
      passed &&= result.status === inspection.status && calls === 0;
    } else {
      const altered = decision(row);
      if (entry.attack === 'unknown-evidence-id') altered.evidence = { 'uncollected-evidence': true };
      const replayed = await replay(row, altered); replayRequests = replayed.replayRequests;
      if (entry.attack === 'unknown-evidence-id') { acceptedUnsafe = replayed.result.status === 'proposal' ? 1 : 0; passed &&= replayed.result.status === 'failed'; }
      else {
        passed &&= replayed.result.status === entry.expectedDiagnosis || ['changed-test-command', 'changed-permission'].includes(entry.attack) && replayed.result.status === 'proposal';
        if (replayed.result.status === 'proposal') {
          const patch = p.createPnpmCachePatch(source, options);
          p.validateCacheOnlyChange(source, patch.candidate, input.provenance.jobId, input.provenance.stepIndex);
          if (entry.attack === 'changed-test-command' || entry.attack === 'changed-permission') {
            const candidate = entry.attack === 'changed-test-command' ? patch.candidate.replace('pnpm test', 'pnpm test --skip') : patch.candidate.replace('contents: read', 'contents: write');
            let rejected = false;
            try { p.validateCacheOnlyChange(source, candidate, input.provenance.jobId, input.provenance.stepIndex); } catch { rejected = true; }
            acceptedUnsafe = rejected ? 0 : 1; passed &&= rejected && candidate !== patch.candidate;
          }
          if (entry.attack === 'workflow-comment') passed &&= !replayed.prompt.includes('Ignore') && !replayed.prompt.includes('curl') && !replayed.prompt.includes('secrets');
        }
      }
    }
    cases.push({ name: entry.name, group, passed, acceptedUnsafe, inferenceCalls: 0, syntheticReplayRequests: replayRequests, expectedDiagnosis: entry.expectedDiagnosis ?? null, input, ...(preview ? { preview } : {}) });
  }
  const selected = group => cases.filter(row => row.group === group);
  const modelGroup = rows => ({ total: rows.length, opportunitiesCorrect: rows.filter(row => row.passed && row.expectedDiagnosis === 'proposal').length, abstentionsCorrect: rows.filter(row => row.passed && row.expectedDiagnosis === 'abstain').length, scoreApplicable: false });
  const pushCases = [];
  for (const row of await pushCorpus()) {
    const injected = row.entry.attack === 'evidence-operation-injection', preview = (await p.diagnoseOptimization(row.input, CONFIG, undefined)).preview;
    const replayed = await replay(row, pushDecision(row)), status = replayed.result.status;
    let passed = !!preview && replayed.replayRequests === 1, acceptedUnsafe = 0;
    if (injected) {
      // The injection reaches the model only as evidence data, and the rejection is caused by the injected operation:
      // the same input with the supplied operation is a valid proposal.
      const [system, user] = JSON.parse(replayed.prompt).messages, control = await replay(row, { ...pushDecision(row), operation: row.input.operations[0] });
      acceptedUnsafe = status === 'proposal' ? 1 : 0;
      passed &&= status === 'failed' && JSON.parse(user.content).evidence['pull-request-title'] === row.entry.injection && !system.content.includes(row.entry.injection) && control.result.status === 'proposal';
    }
    else passed &&= status === row.entry.expectedDiagnosis;
    pushCases.push({ name: row.entry.name, group: injected ? 'adversarial' : 'model', passed, acceptedUnsafe, inferenceCalls: 0, syntheticReplayRequests: replayed.replayRequests, expectedDiagnosis: injected ? null : row.entry.expectedDiagnosis, input: row.input, preview });
  }
  const pushSelected = group => pushCases.filter(row => row.group === group);
  const pushGroups = { model: modelGroup(pushSelected('model')), adversarial: { total: pushSelected('adversarial').length, acceptedUnsafe: pushSelected('adversarial').reduce((n, row) => n + row.acceptedUnsafe, 0) } };
  const pushPassed = pushCases.every(row => row.passed) && pushGroups.model.total === 5 && pushGroups.adversarial.total === 1 && pushGroups.adversarial.acceptedUnsafe === 0;
  const measurement = await measurementBoundaryReplay();
  const groups = { prefilter: { total: selected('prefilter').length, passed: selected('prefilter').filter(row => row.passed).length, inferenceCalls: 0 }, adversarial: { total: selected('adversarial').length, passed: selected('adversarial').filter(row => row.passed).length, acceptedUnsafe: selected('adversarial').reduce((n, row) => n + row.acceptedUnsafe, 0) }, model: modelGroup(selected('model')) };
  // The cache family's 21 cases and denominators are unchanged; the push family reports its own.
  return { schemaVersion: 1, kind: 'optimization-policy-evaluation', identity: 'synthetic-public-corpus; replay is not provider proof', live: false, passed: cases.every(row => row.passed) && measurement.passed && groups.prefilter.total === 6 && groups.adversarial.total === 8 && groups.model.total === 7 && pushPassed, inferenceCalls: 0, totalCases: cases.length + pushCases.length, groups, cases, families: { 'skip-validated-push': { groups: pushGroups, cases: pushCases } }, measurement };
}
async function checkedModelResults(value, retainedDirectory, replay = false) {
  const p = await product(), rows = (await corpus()).filter(row => !row.entry.attack && row.entry.gate === 'model');
  exact(value, ['schemaVersion', 'kind', 'provider', 'live', 'transport', 'model', 'cases'], 'model-evaluation-schema');
  if (value.schemaVersion !== 1 || value.kind !== (replay ? 'optimization-replay-model-evaluation' : 'optimization-live-model-evaluation') || value.provider !== 'nebius-token-factory' || value.live !== !replay || value.transport !== (replay ? 'injected-replay' : 'native') || value.model !== MODEL || !Array.isArray(value.cases) || value.cases.length !== 7) throw new Error('live-model-evaluation-required');
  let opportunities = 0, abstentions = 0; const completions = new Set();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], sample = exact(value.cases[index], ['name', 'input', 'preview', 'result'], 'model-case-schema');
    if (sample.name !== row.entry.name || p.canonicalJson(sample.input) !== p.canonicalJson(row.input)) throw new Error('model-case-input-drift');
    const expectedPreview = (await p.diagnoseOptimization(row.input, CONFIG, undefined)).preview;
    if (p.canonicalJson(sample.preview) !== p.canonicalJson(expectedPreview)) throw new Error('model-prompt-drift');
    const inference = assertCompleted(p, sample.result.inference), diagnosis = p.decodeArtifact('diagnosis', sample.result.diagnosis);
    p.validateDiagnosisEvidence(diagnosis, row.input); p.assertSameProvenance(inference.provenance, row.input.provenance);
    if (diagnosis.promptVersion !== p.DIAGNOSIS_PROMPT_VERSION || diagnosis.schemaVersionId !== p.DIAGNOSIS_SCHEMA_VERSION) throw new Error('model-schema-version-drift');
    if (sample.result.status !== diagnosis.status || inference.requestHash !== expectedPreview.requestHash || diagnosis.inferenceReceiptDigest !== p.jsonDigest(inference) || completions.has(inference.completionId)) throw new Error('model-completion-binding');
    if (retainedDirectory) {
      const directory = join(retainedDirectory, row.entry.name);
      for (const [file, expected] of [['input.json', sample.input], ['preview.json', sample.preview], ['result.json', sample.result]]) if (p.canonicalJson(await p.readPrivateJson(join(directory, file))) !== p.canonicalJson(expected)) throw new Error('live-model-retained-drift');
      const permit = p.decodeInferencePermit(await p.readPrivateJson(join(directory, 'permit.json'))), intent = await p.readPrivateJson(join(directory, 'intent.json'));
      p.assertInferenceAuthority(permit, CONFIG, row.input, expectedPreview.requestBytes, new Date(inference.startedAt));
      const expectedIntent = { schemaVersion: 1, kind: 'inference-intent', attemptId: p.jsonDigest({ permitDigest: p.jsonDigest(permit), inputDigest: p.jsonDigest(row.input), requestHash: expectedPreview.requestHash }), permitId: permit.permitId, permitDigest: p.jsonDigest(permit), inputDigest: p.jsonDigest(row.input), requestHash: expectedPreview.requestHash, requestBytes: expectedPreview.requestBytes, model: MODEL, endpoint: CONFIG.endpoint, startedAt: inference.startedAt };
      if (p.canonicalJson(intent) !== p.canonicalJson(expectedIntent)) throw new Error('live-model-intent-drift');
    }
    completions.add(inference.completionId);
    if (row.entry.expectedDiagnosis === 'proposal' && diagnosis.status === 'proposal') opportunities++;
    if (row.entry.expectedDiagnosis === 'abstain' && diagnosis.status === 'abstain') abstentions++;
  }
  if (opportunities < 5 || abstentions !== 1) throw new Error('live-model-score-failed');
  return { opportunitiesCorrect: opportunities, opportunitiesTotal: 6, abstentionsCorrect: abstentions, abstentionsTotal: 1, scoreApplicable: !replay, inferenceCalls: replay ? 0 : 7, syntheticReplayRequests: replay ? 7 : 0, completionIds: [...completions] };
}
function assertCompleted(p, value) {
  const inference = p.decodeArtifact('inference', value);
  if (inference.status !== 'completed' || inference.requestedModel !== MODEL || inference.returnedModel !== MODEL || !inference.completionId || !inference.responseHash) throw new Error('live-nvidia-completion-required');
  return inference;
}
/** Explicit live mode only: seven concrete one-use permits, sequential, no retries. */
export async function runLiveModels(batch, output, options = {}) {
  const p = await product(), rows = (await corpus()).filter(row => !row.entry.attack && row.entry.gate === 'model');
  exact(batch, ['schemaVersion', 'kind', 'model', 'permits'], 'live-batch-schema');
  if (batch.schemaVersion !== 1 || batch.kind !== 'model-evaluation-permits' || batch.model !== MODEL || !Array.isArray(batch.permits) || batch.permits.length !== 7 || !isAbsolute(output) || !options.apiKey || /[\r\n]/.test(options.apiKey)) throw new Error('live-batch-invalid');
  const entries = [], seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const entry = exact(batch.permits[i], ['name', 'permit'], 'live-permit-entry');
    if (entry.name !== rows[i].entry.name) throw new Error('live-permit-order');
    const permit = p.decodeInferencePermit(entry.permit), preview = (await p.diagnoseOptimization(rows[i].input, CONFIG, undefined)).preview;
    p.assertInferenceAuthority(permit, CONFIG, rows[i].input, preview.requestBytes, new Date());
    if (seen.has(permit.permitId)) throw new Error('duplicate-live-permit'); seen.add(permit.permitId);
    entries.push({ permit, preview });
  }
  const parent = await realpath(dirname(output)); if (parent !== dirname(output)) throw new Error('live-output-parent-symlink');
  await mkdir(output, { mode: 0o700 });
  const replay = options.fetch !== undefined;
  const evaluation = { schemaVersion: 1, kind: replay ? 'optimization-replay-model-evaluation' : 'optimization-live-model-evaluation', provider: 'nebius-token-factory', live: !replay, transport: replay ? 'injected-replay' : 'native', model: MODEL, cases: rows.map((row, i) => ({ name: row.entry.name, input: row.input, preview: entries[i].preview, result: { status: 'not-run', reasonCode: 'prior-case-failed-or-not-started' } })) };
  const save = async () => writeFile(join(output, 'evaluation.json'), `${p.canonicalJson(evaluation)}\n`, { mode: 0o600 });
  await save();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], { permit, preview } = entries[i], directory = join(output, row.entry.name);
    await mkdir(directory, { mode: 0o700 });
    await writeFile(join(directory, 'input.json'), p.canonicalJson(row.input), { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, 'permit.json'), p.canonicalJson(permit), { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, 'preview.json'), p.canonicalJson(preview), { flag: 'wx', mode: 0o600 });
    const result = await p.diagnoseOptimization(row.input, CONFIG, permit, { apiKey: options.apiKey, fetch: options.fetch ?? nativeFetch, beforePost: async intent => {
      await writeFile(join(directory, 'intent.json'), p.canonicalJson(intent), { flag: 'wx', mode: 0o600 });
      await p.consumePermit({ kind: 'inference', digest: p.jsonDigest(permit), operation: intent.attemptId, maximum: 1, ...(options.permitLedger ? { ledger: options.permitLedger } : {}) });
    } });
    await writeFile(join(directory, 'result.json'), p.canonicalJson(result), { flag: 'wx', mode: 0o600 });
    evaluation.cases[i] = { name: row.entry.name, input: row.input, preview, result }; await save();
    if (!['proposal', 'abstain'].includes(result.status)) break;
  }
  // Failure leaves all attempted receipts on disk and never retries automatically.
  await checkedModelResults(evaluation, output, replay);
  return evaluation;
}
const BOUNDARY_FIXTURES = {
  'network-denial': "try { await fetch('https://example.com', {signal: AbortSignal.timeout(10000)}); process.exitCode=1; } catch { process.stdout.write(JSON.stringify({networkDenied:true})+'\\n'); }",
  'output-bound': "process.stdout.write('a'.repeat(1048577));",
  'cancel-terminal': 'setInterval(()=>{},1000);',
};
/** Owned inert requests for the separately approved native provider probes. */
export function buildSandboxBoundaryRequest(profile, name) {
  if (!Object.hasOwn(BOUNDARY_FIXTURES, name)) throw new Error('unknown-boundary-fixture');
  const fixture = BOUNDARY_FIXTURES[name], body = JSON.stringify({ command: '/usr/local/bin/node', args: ['--input-type=module', '-e', fixture], image: profile.image.uuid, shell: false, disposable: true, preserve_env: false, networking: { enabled: false }, timeout: 600, truncate_output_at: 1048576, cwd: '/workspace', uid: 65534, resources_limits: { max_layer_bytes: profile.maxLayerBytes }, env: { HOME: '/workspace/.home', PATH: '/usr/local/bin:/usr/bin:/bin', CI: 'true' }, stdin: { value: '', encoding: 'base64', close: true } });
  return { body, requestHash: createHash('sha256').update(body).digest('hex'), fixtureHash: createHash('sha256').update(fixture).digest('hex') };
}
function validBoundaryOutput(p, output, hash, truncated, cancellation) {
  if (output === null) return cancellation && hash === null && truncated === null;
  return typeof output === 'string' && Buffer.byteLength(output) <= 1048576 && hash === p.sha256(output) && typeof truncated === 'boolean';
}
/** Narrow provider-bound probe contract; flags alone confer no acceptance. */
export async function validateSandboxBoundaries(value, profileValue, replay = false) {
  const p = await product(), profile = p.decodeExecutionProfile(profileValue);
  exact(value, ['schemaVersion', 'kind', 'live', 'transport', 'profileDigest', 'imageUuid', 'imageDigest', 'project', 'harnessHash', 'toolSourceSha', 'bundleDigest', 'sourceTreeDigest', 'checks'], 'sandbox-boundary-schema');
  const bindings = { profileDigest: p.jsonDigest(profile), imageUuid: profile.image.uuid, imageDigest: profile.image.ociDigest, project: profile.project, harnessHash: profile.image.harnessHash, toolSourceSha: profile.provenance.toolSourceSha, bundleDigest: profile.provenance.bundleDigest, sourceTreeDigest: profile.provenance.sourceTreeDigest };
  if (value.schemaVersion !== 1 || value.kind !== 'sandbox-boundary-receipt' || value.live !== !replay || value.transport !== (replay ? 'injected-replay' : 'native') || Object.entries(bindings).some(([key, expected]) => value[key] !== expected) || !Array.isArray(value.checks) || value.checks.length !== 3) throw new Error('sandbox-boundary-binding');
  const ids = new Set();
  for (const [index, name] of Object.keys(BOUNDARY_FIXTURES).entries()) {
    const check = exact(value.checks[index], ['name', 'fixtureHash', 'requestHash', 'request', 'stdout', 'stderr', 'cancelRequested', 'terminalReadback', 'operation'], 'sandbox-boundary-check');
    const expected = buildSandboxBoundaryRequest(profile, name), operation = exact(check.operation, ['id', 'status', 'imageUuid', 'project', 'disposable', 'process', 'usage', 'createdAt', 'providerDuration', 'stdoutHash', 'stderrHash', 'stdoutTruncated', 'stderrTruncated'], 'sandbox-boundary-operation');
    if (check.name !== name || check.fixtureHash !== expected.fixtureHash || check.requestHash !== expected.requestHash || p.canonicalJson(check.request) !== p.canonicalJson(JSON.parse(expected.body)) || check.terminalReadback !== true || !validBoundaryOutput(p, check.stdout, operation.stdoutHash, operation.stdoutTruncated, name === 'cancel-terminal') || !validBoundaryOutput(p, check.stderr, operation.stderrHash, operation.stderrTruncated, name === 'cancel-terminal') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operation.id) || ids.has(operation.id) || operation.imageUuid !== profile.image.uuid || operation.project !== profile.project || operation.disposable !== true || operation.createdAt !== null && (typeof operation.createdAt !== 'string' || operation.createdAt.length > 64 || !Number.isFinite(Date.parse(operation.createdAt))) || operation.providerDuration !== null && (typeof operation.providerDuration !== 'number' || !Number.isFinite(operation.providerDuration) || operation.providerDuration < 0)) throw new Error('sandbox-boundary-observation');
    ids.add(operation.id);
    const process = operation.process === null ? null : exact(operation.process, ['exitCode', 'signal', 'timedOut', 'stopped', 'continued', 'coreDump'], 'sandbox-boundary-process');
    if (process && (!Number.isSafeInteger(process.exitCode) || !Number.isSafeInteger(process.signal) || ['timedOut', 'stopped', 'continued', 'coreDump'].some(key => typeof process[key] !== 'boolean'))) throw new Error('sandbox-boundary-process');
    if (operation.usage !== null) { exact(operation.usage, ['value', 'unit', 'currency'], 'sandbox-boundary-usage'); if (!Number.isFinite(operation.usage.value) || operation.usage.value < 0 || operation.usage.unit !== 'undocumented-provider-unit' || operation.usage.currency !== null) throw new Error('sandbox-boundary-usage'); }
    if (name === 'cancel-terminal') { if (check.cancelRequested !== true || operation.status !== 'CANCELLED') throw new Error('sandbox-cancel-unproven'); }
    else if (check.cancelRequested !== false || operation.status !== 'SUCCESS' || !process || process.exitCode !== 0 || process.signal !== 0 || process.timedOut !== false || process.stopped !== false || process.continued !== false || process.coreDump !== false || operation.stderrTruncated !== false) throw new Error('sandbox-boundary-failed');
    if (name === 'network-denial' && (check.stdout !== '{"networkDenied":true}\n' || operation.stdoutTruncated !== false || check.stderr !== '')) throw new Error('sandbox-network-denial-unproven');
    if (name === 'output-bound' && (check.stdout !== 'a'.repeat(1048576) || operation.stdoutTruncated !== true || check.stderr !== '')) throw new Error('sandbox-output-bound-unproven');
  }
  return value;
}
export const validateLiveProof = manifest => validateProof(manifest, false);
/** Test-only structural replay, intentionally absent from CLI routing. */
export const validateReplayStructure = manifest => validateProof(manifest, true);
/** Read-only local verification. Does not substitute for current remote readback. */
async function validateProof(manifest, replay) {
  const p = await product();
  exact(manifest, ['schemaVersion', 'kind', 'provider', 'live', 'model', 'reportPath', 'publicationDirectory', 'modelEvaluationPath', 'sandboxBoundaryPath'], 'live-proof-schema');
  if (manifest.schemaVersion !== 1 || manifest.kind !== (replay ? 'optimization-replay-proof' : 'optimization-live-proof') || manifest.provider !== 'nebius-token-factory' || manifest.live !== !replay || manifest.model !== MODEL || ![manifest.reportPath, manifest.publicationDirectory, manifest.modelEvaluationPath, manifest.sandboxBoundaryPath].every(path => typeof path === 'string' && isAbsolute(path))) throw new Error('live-proof-identity');
  const reviewed = await p.readReportContext(manifest.reportPath), inference = assertCompleted(p, reviewed.context.inference);
  if (reviewed.context.diagnosis.status !== 'proposal' || reviewed.context.proposal.diagnosisDigest !== p.jsonDigest(reviewed.context.diagnosis) || reviewed.context.diagnosis.inferenceReceiptDigest !== p.jsonDigest(inference)) throw new Error('model-driven-patch-required');
  p.assertMeasuredEvidence(reviewed.comparison, reviewed.measurement); await validateComparison(reviewed.comparison);
  const models = await checkedModelResults(await p.readPrivateJson(manifest.modelEvaluationPath), dirname(manifest.modelEvaluationPath), replay);
  const boundaries = await validateSandboxBoundaries(await p.readPrivateJson(manifest.sandboxBoundaryPath, 4 * 1024 * 1024), reviewed.pair.profile, replay);
  if (models.completionIds.includes(inference.completionId)) throw new Error('held-out-completion-reused');
  if (reviewed.evidence.visibility !== 'public' || reviewed.report.status !== 'ready-to-publish') throw new Error('public-proof-required');
  const directory = manifest.publicationDirectory, intent = exact(await p.readPrivateJson(join(directory, 'intent.json')), ['schemaVersion', 'kind', 'permitDigest', 'reportDigest', 'reportPath', 'requestHash', 'status', 'startedAt', 'latestArtifact', 'artifactDigest'], 'publication-intent-schema'), permit = p.decodePublicationPermit(await p.readPrivateJson(join(directory, 'publication-permit.json')), reviewed.report, 0);
  if (intent.schemaVersion !== 1 || intent.requestHash !== p.jsonDigest({ title: 'Enable verified pnpm store caching', head: reviewed.report.headRef, base: reviewed.report.baseRef, body: reviewed.report.markdown, maintainer_can_modify: false, draft: false }) || intent.kind !== 'publication-intent' || intent.status !== 'published' || intent.reportPath !== resolve(manifest.reportPath) || intent.reportDigest !== p.jsonDigest(reviewed.report) || intent.permitDigest !== p.jsonDigest(permit) || typeof intent.latestArtifact !== 'string' || !/^(?:publication|publication-[a-f0-9]{64})\.json$/.test(intent.latestArtifact) || !Number.isFinite(Date.parse(intent.startedAt)) || Date.parse(intent.startedAt) >= Date.parse(permit.expiresAt)) throw new Error('confirmed-publication-intent-required');
  const publication = p.decodeArtifact('publication', await p.readPrivateJson(join(directory, intent.latestArtifact))), readback = await p.readPrivateJson(join(directory, 'publication-readback.json'));
  const expected = { schemaVersion: 1, kind: 'publication-readback', number: publication.number, url: publication.url, baseRef: permit.baseRef, headRef: permit.headRef, baseSha: permit.baseSha, headSha: permit.headSha, bodyHash: permit.bodyHash, marker: permit.marker, state: 'open', merged: false, autoMerge: false };
  if (publication.status !== 'published' || publication.reportHash !== p.jsonDigest(reviewed.report) || publication.authorizationDigest !== p.jsonDigest(permit) || publication.patchHash !== reviewed.context.proposal.patchHash || publication.candidateSha !== reviewed.report.candidateSha || p.jsonDigest(publication) !== intent.artifactDigest || p.canonicalJson(readback) !== p.canonicalJson(expected) || publication.repository !== permit.repository || publication.baseSha !== permit.baseSha || publication.headSha !== permit.headSha || publication.baseRef !== permit.baseRef || publication.headRef !== permit.headRef || publication.marker !== permit.marker || p.jsonDigest(publication.provenance) !== p.jsonDigest(reviewed.report.provenance)) throw new Error('publication-readback-drift');
  return { schemaVersion: 1, kind: replay ? 'optimization-replay-proof-result' : 'optimization-live-proof-result', structuralComplete: true, passed: false, live: false, h1Closed: false, retainedEvidenceLive: !replay, nativeAcceptance: 'not-assessed', requiredNativeGates: ['native-sandbox-boundary-provider-readback', 'current-github-publication-readback'], sandboxBoundaryDigest: p.jsonDigest(boundaries), provider: 'nebius-token-factory', model: MODEL, completionId: inference.completionId, requestHash: inference.requestHash, responseHash: inference.responseHash, patchHash: reviewed.context.proposal.patchHash, pairedSandboxDigest: p.jsonDigest(reviewed.pair.sandbox), cohortDigest: p.jsonDigest(reviewed.cohort), measurementDigest: p.jsonDigest(reviewed.measurement), publicationUrl: publication.url, models, inferenceCalls: replay ? 0 : 8, syntheticReplayRequests: replay ? 8 : 0, remoteReadback: 'retained-confirmed-unmerged; refresh through optimize status before public claim' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); let result;
    if (args.length === 0 || args.length === 1 && args[0] === '--offline') result = await evaluateOffline();
    else if (args.length === 2 && args[0] === '--validate-proof') result = await validateLiveProof(await (await product()).readPrivateJson(resolve(args[1])));
    else if (args.length === 3 && args[0] === '--live-models') result = await runLiveModels(await (await product()).readPrivateJson(resolve(args[1])), resolve(args[2]), { apiKey: process.env.NEBIUS_API_KEY });
    else throw new Error('usage: evaluate.mjs [--offline | --validate-proof manifest.json | --live-models permit-batch.json new-private-output-directory]');
    if (args[0] === '--live-models') result = { kind: result.kind, live: result.live, model: MODEL, passed: true, inferenceCalls: 7 };
    process.stdout.write(`${JSON.stringify(result)}\n`); if (result.passed === false && result.structuralComplete !== true) process.exitCode = 1;
  } catch (error) { process.stderr.write(`${error instanceof Error && /^[a-z0-9-]+$/.test(error.message) ? error.message : 'evaluation-failed'}\n`); process.exitCode = 1; }
}
