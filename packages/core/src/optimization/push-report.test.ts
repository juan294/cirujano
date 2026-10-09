import { describe, expect, it } from 'vitest';
import { jsonDigest, sha256 } from './canonical.js';
import { PUSH_FAMILY } from './push-contracts.js';
import { comparePushMeasurement } from './push-measurement.js';
import { pushBase, pushComparisonFixture } from './push-measurement.test-helper.js';
import { createSkipValidatedPushPatch } from './push-patch.js';
import { renderPushReport, type PushReportRenderInputs } from './push-report.js';

function fixture(): PushReportRenderInputs {
  const inputs = pushComparisonFixture(), provenance = inputs.input.provenance;
  const inference: PushReportRenderInputs['inference'] = { schemaVersion: 1, kind: 'inference', family: PUSH_FAMILY, provenance, requestedModel: 'nvidia/nemotron-3-super-120b-a12b', returnedModel: 'nvidia/nemotron-3-super-120b-a12b', endpointHost: 'api.tokenfactory.nebius.com', completionId: 'completion-owned', requestHash: 'a'.repeat(64), responseHash: 'b'.repeat(64), startedAt: '2026-10-10T07:00:00Z', completedAt: '2026-10-10T07:00:01Z', latencyMs: 1000, finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }, quoteIdentity: null, costStatus: 'unavailable', cost: null, status: 'completed' };
  const diagnosis: PushReportRenderInputs['diagnosis'] = { schemaVersion: 1, kind: 'diagnosis', family: PUSH_FAMILY, provenance, status: 'proposal', reason: 'Most pushes land a green PR', uncertainty: 'A sample is required', evidenceIds: ['push-history', 'workflow-eligibility'], operation: inputs.proposal.operation, promptVersion: 'skip-validated-push-v1', schemaVersionId: 'skip-validated-push-v1', inferenceReceiptDigest: jsonDigest(inference) };
  const source = inputs.input.provenance.workflowPath;
  const patch = createSkipValidatedPushPatch(pushBase, { workflowHash: provenance.workflowHash, workflowPath: source, integrationBranch: 'main', inventory: [{ path: source, source: pushBase }] }).patch;
  const f = { ...inputs, inference, diagnosis, measurement: comparePushMeasurement(inputs), patch, baseRef: 'main', headRef: 'cirujano/skip-validated-push' };
  refresh(f);
  return f;
}
/** Rebind every digest after a mutation, as an honest pipeline would. */
function refresh(f: PushReportRenderInputs) {
  f.diagnosis.inferenceReceiptDigest = jsonDigest(f.inference); f.proposal.diagnosisDigest = jsonDigest(f.diagnosis); f.proposal.patchHash = sha256(f.patch);
  f.sandbox.patchHash = f.proposal.patchHash; f.sandbox.proposalDigest = jsonDigest(f.proposal); f.cohort.proposalDigest = jsonDigest(f.proposal); f.cohort.sandboxDigest = jsonDigest(f.sandbox);
  f.measurement = comparePushMeasurement({ input: f.input, proposal: f.proposal, sandbox: f.sandbox, cohort: f.cohort, runs: f.runs, visibility: f.visibility, pricing: f.pricing });
}

describe('skip-validated-push report', () => {
  it('push-report-golden: renders the exact public report bytes', async () => {
    const f = fixture(), report = renderPushReport(f);
    expect(report).toEqual(renderPushReport(f));
    expect(report).toMatchObject({ family: PUSH_FAMILY, status: 'ready-to-publish', marker: `<!-- cirujano-optimization:${jsonDigest(f.proposal)}:${jsonDigest(f.measurement)} -->`, markdownHash: sha256(report.markdown) });
    expect(report.markdown.endsWith(report.marker)).toBe(true);
    expect(Buffer.byteLength(report.markdown)).toBeLessThanOrEqual(8192);
    await expect(report.markdown).toMatchFileSnapshot('../../fixtures/optimization/push/report/golden.md');
  });
  it.each(['measurement-row', 'measurement-status', 'patch', 'receipt', 'diagnosis', 'provenance', 'run', 'ref'])('rejects immutable chain mutation: %s', mutation => {
    const f = fixture();
    if (mutation === 'measurement-row') f.measurement.pushes[3]!.billedMinutes = 0;
    if (mutation === 'measurement-status') f.measurement.status = 'no-improvement';
    if (mutation === 'patch') f.patch += 'malicious';
    if (mutation === 'receipt') f.diagnosis.inferenceReceiptDigest = '0'.repeat(64);
    if (mutation === 'diagnosis') f.diagnosis.reason = 'changed';
    if (mutation === 'provenance') f.inference.provenance = { ...f.inference.provenance, repositoryId: 999 };
    if (mutation === 'run') f.runs[3]!.jobs[1]!.conclusion = 'success';
    if (mutation === 'ref') f.headRef = 'develop\n<script>';
    expect(() => renderPushReport(f)).toThrow();
  });
  it('prints a known inference cost in short decimal form', () => {
    const f = fixture(); f.inference.costStatus = 'known'; f.inference.cost = { amount: 0.00012251999999999999, currency: 'USD' }; refresh(f);
    expect(renderPushReport(f).markdown).toContain('Inference cost: known; 0.00012252 USD.');
    f.inference.cost = { amount: 0.0000001, currency: 'USD' }; refresh(f);
    expect(renderPushReport(f).markdown).toContain('Inference cost: known; 0.0000001 USD.');
  });
  it('reports a rejected gate without a ready claim', () => {
    const f = fixture(); f.runs[6]!.classifier = { validated: true, reasonCode: 'validated' }; refresh(f);
    const report = renderPushReport(f);
    expect(report.status).toBe('rejected'); expect(report.markdown).toContain('control-not-full');
    for (const claim of ['which ran every guarded job', 'every sampled PR run passed', 'direct push']) expect(report.markdown).not.toContain(claim);
  });
  it('does not mark an inference that was never run ready', () => {
    const f = fixture(); Object.assign(f.inference, { status: 'not-run', returnedModel: null, completionId: null, responseHash: null, finishReason: null, usage: null }); refresh(f);
    expect(renderPushReport(f).status).toBe('rejected');
  });
  it('omits private names, job identities, URLs and model prose', () => {
    const f = fixture(); f.visibility = 'private'; f.diagnosis.reason = 'PRIVATE_CANARY <script> https://private.example token=SECRET'; f.diagnosis.uncertainty = 'RAW_SOURCE_CANARY'; f.inference.completionId = 'PRIVATE_COMPLETION_CANARY'; refresh(f);
    const report = renderPushReport(f);
    for (const canary of ['public-example', 'PRIVATE_CANARY', 'RAW_SOURCE_CANARY', 'PRIVATE_COMPLETION_CANARY', 'private.example', 'SECRET', '<script>', 'https://github.com/', 'lint, test']) expect(report.markdown).not.toContain(canary);
    expect(report.markdown).toContain('3 (identities withheld)'); expect(report.markdown).not.toContain('integration branch: main'); expect(report.markdown).not.toContain('push to main');
  });
});
