import { describe, expect, it } from 'vitest';
import { jsonDigest, sha256 } from './canonical.js';
import { compareMeasurement } from './measurement.js';
import { measurementFixture, setTiming } from './measurement.test-helper.js';
import { renderOptimizationReport, type ReportRenderInputs } from './report.js';

function fixture(): ReportRenderInputs {
  const inputs = measurementFixture(); const provenance = inputs.input.provenance;
  const inference: ReportRenderInputs['inference'] = { schemaVersion: 1, kind: 'inference', provenance, requestedModel: 'nvidia/nemotron-3-super-120b-a12b', returnedModel: 'nvidia/nemotron-3-super-120b-a12b', endpointHost: 'api.tokenfactory.nebius.com', completionId: 'completion-owned', requestHash: 'a'.repeat(64), responseHash: 'b'.repeat(64), startedAt: '2026-09-29T10:00:00Z', completedAt: '2026-09-29T10:00:01Z', latencyMs: 1000, finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }, quoteIdentity: null, costStatus: 'unavailable', cost: null, status: 'completed' };
  const diagnosis: ReportRenderInputs['diagnosis'] = { schemaVersion: 1, kind: 'diagnosis', provenance, status: 'proposal', reason: 'Cache the pnpm dependencies', uncertainty: 'A sample is required', evidenceIds: ['install'], operation: inputs.proposal.operation, promptVersion: 'optimization-1', schemaVersionId: 'optimization-1', inferenceReceiptDigest: jsonDigest(inference) };
  const patch = 'diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n@@ -1,1 +1,3 @@\n with:\n+  cache: pnpm\n+  cache-dependency-path: pnpm-lock.yaml\n';
  inputs.proposal.diagnosisDigest = jsonDigest(diagnosis); inputs.proposal.patchHash = sha256(patch); inputs.sandbox.patchHash = sha256(patch); inputs.sandbox.proposalDigest = jsonDigest(inputs.proposal); inputs.cohort.proposalDigest = jsonDigest(inputs.proposal); inputs.cohort.sandboxDigest = jsonDigest(inputs.sandbox);
  return { ...inputs, inference, diagnosis, measurement: compareMeasurement(inputs), patch, baseRef: 'main', headRef: 'develop' };
}
function comparison(f: ReportRenderInputs) { return { input: f.input, proposal: f.proposal, sandbox: f.sandbox, cohort: f.cohort, samples: f.samples, visibility: f.visibility, pricing: f.pricing }; }
function refresh(f: ReportRenderInputs) { f.diagnosis.inferenceReceiptDigest = jsonDigest(f.inference); f.proposal.diagnosisDigest = jsonDigest(f.diagnosis); f.sandbox.proposalDigest = jsonDigest(f.proposal); f.cohort.proposalDigest = jsonDigest(f.proposal); f.cohort.sandboxDigest = jsonDigest(f.sandbox); f.measurement = compareMeasurement(comparison(f)); }
describe('evidence-bound optimization report', () => {
  it('preserves the canonical mixed-case NVIDIA catalog identity in bound public evidence', () => {
    const f = fixture(), model = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';
    f.inference.requestedModel = model; f.inference.returnedModel = model; refresh(f);
    const report = renderOptimizationReport(f);
    expect(report.status).toBe('ready-to-publish');
    expect(report.markdown).toContain(`Model requested: ${model}; returned: ${model};`);
  });
  it.each(['nvidia/Model<script>', 'nvidia/Model space', 'nvidia/Model[link](https://example.com)', 'nvidia/Model`code`'])('rejects unsafe mixed-case model identity %s', model => {
    const f = fixture(); f.inference.requestedModel = model; f.inference.returnedModel = model; refresh(f);
    expect(() => renderOptimizationReport(f)).toThrow('unsafe model identity');
  });
  it('renders deterministic six-row measured report, exact marker, rollback and honest costs', () => {
    const f = fixture(); const report = renderOptimizationReport(f);
    expect(report).toEqual(renderOptimizationReport(f)); expect(report.status).toBe('ready-to-publish');
    expect(report.marker).toBe(`<!-- cirujano-optimization:${jsonDigest(f.proposal)}:${jsonDigest(f.measurement)} -->`);
    expect(report.markdown.endsWith(report.marker)).toBe(true); expect(sha256(report.markdown)).toBe(report.markdownHash);
    for (const sample of f.samples) expect(report.markdown).toContain(`actions/runs/${sample.runId}/attempts/${sample.attempt}`);
    for (const value of ['cold', 'hit', 'cache: pnpm', 'cache-dependency-path: pnpm-lock.yaml', 'git apply --reverse workflow.patch', '10 / 20 / 30', 'finish: stop', 'undocumented-provider-unit', 'currency unavailable', 'Inference cost: unavailable', 'sample', 'invoice']) expect(report.markdown).toContain(value);
    expect(report.markdown).not.toContain('Sandbox cost: $'); expect(Buffer.byteLength(report.markdown)).toBeLessThanOrEqual(8192);
  });
  it.each(['measurement-total', 'measurement-status', 'measurement-row', 'patch', 'receipt', 'diagnosis', 'provenance', 'operation', 'ref'])('rejects immutable chain mutation: %s', mutation => {
    const f = fixture();
    if (mutation === 'measurement-total') f.measurement.baselineMinutes++;
    if (mutation === 'measurement-status') f.measurement.status = 'no-improvement';
    if (mutation === 'measurement-row') f.measurement.samples[0]!.quality.tests[0]!.outcome = 'failed';
    if (mutation === 'patch') f.patch += 'malicious';
    if (mutation === 'receipt') f.diagnosis.inferenceReceiptDigest = '0'.repeat(64);
    if (mutation === 'diagnosis') f.diagnosis.reason = 'changed';
    if (mutation === 'provenance') f.inference.provenance = { ...f.inference.provenance, repositoryId: 999 };
    if (mutation === 'operation') { f.diagnosis.operation = { ...f.proposal.operation, stepIndex: 9 }; }
    if (mutation === 'ref') f.headRef = 'develop\n<script>';
    expect(() => renderOptimizationReport(f)).toThrow();
  });
  it('retains failed and cold sample rows without a ready claim', () => {
    const f = fixture(); f.samples[5]!.conclusion = 'failure'; f.measurement = compareMeasurement(comparison(f));
    const report = renderOptimizationReport(f); expect(report.status).toBe('rejected'); expect(report.markdown).toContain('failure'); expect(report.markdown).toContain('cold');
  });
  it('reports incomplete Sandbox operations without claiming two checks succeeded', () => {
    const f = fixture(); f.sandbox.status = 'failed'; f.sandbox.operations[1]!.status = 'FAILED'; f.sandbox.operations[1]!.exitCode = 1; refresh(f);
    const report = renderOptimizationReport(f); expect(report.status).toBe('rejected'); expect(report.markdown).toContain('candidate: FAILED; exit 1'); expect(report.markdown).not.toContain('two isolated checks');
  });
  it('returns no-improvement with all rows at equal timing', () => {
    const f = fixture(); f.samples.forEach(sample => setTiming(sample, 120000)); f.measurement = compareMeasurement(comparison(f));
    expect(renderOptimizationReport(f).status).toBe('no-improvement');
  });
  it('does not mark an inference that was never run ready', () => {
    const f = fixture(); f.inference.status = 'not-run'; f.inference.returnedModel = null; f.inference.completionId = null; f.inference.responseHash = null; f.inference.finishReason = null; f.inference.usage = null; refresh(f);
    expect(renderOptimizationReport(f).status).toBe('rejected');
  });
  it('omits private names, URLs, model prose, credentials and raw source canaries', () => {
    const f = fixture(); f.visibility = 'private'; f.input.provenance.repository = 'PRIVATE_OWNER/PRIVATE_PROJECT'; f.diagnosis.reason = 'PRIVATE_CANARY ```diff\n+ delete tests\n``` <script> https://private.example/source token=SECRET'; f.diagnosis.uncertainty = 'RAW_SOURCE_CANARY'; f.inference.completionId = 'PRIVATE_COMPLETION_CANARY'; refresh(f);
    const report = renderOptimizationReport(f);
    for (const canary of ['PRIVATE_OWNER', 'PRIVATE_PROJECT', 'PRIVATE_CANARY', 'RAW_SOURCE_CANARY', 'PRIVATE_COMPLETION_CANARY', 'private.example', 'SECRET', '<script>', 'delete tests']) expect(report.markdown).not.toContain(canary);
    expect(report.markdown).toContain('.github/workflows/ci.yml'); expect(report.markdown).not.toContain('https://github.com/');
  });
  it('public export does not interpret model Markdown or credential prose', () => {
    const f = fixture(); f.diagnosis.reason = '<script> ```diff\n+ remove tests\n``` token=SUPER_SECRET https://private.example'; refresh(f);
    const text = renderOptimizationReport(f).markdown;
    for (const value of ['<script>', 'remove tests', 'SUPER_SECRET', 'private.example']) expect(text).not.toContain(value);
  });
  it('known prices remain explicit list estimates and model currency is exact', () => {
    const f = fixture(); f.visibility = 'private'; f.pricing = { usdPerMinute: .008, priceBasis: 'owner-confirmed list rate', allowanceKnown: true }; f.inference.costStatus = 'known'; f.inference.cost = { amount: .12, currency: 'EUR' }; refresh(f);
    expect(renderOptimizationReport(f).markdown).toContain('0.12 EUR'); expect(renderOptimizationReport(f).markdown).toContain('GitHub list estimate: 0.024 USD');
  });
});
