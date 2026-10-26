import { basename, dirname, join } from 'node:path';
import { canonicalJson, jsonDigest, renderPushReport, type PushReportArtifact, type PushReportRenderInputs } from '@cirujano/core';
import { readPushMeasurementContext, type PushMeasurementContext } from './push-measure.js';
import { copyPushProposalContext, readPushProposalContext } from './push-propose.js';
import { readPushSandboxContext, retainPushSandboxEvidence } from './push-verify.js';
import { exact, type ReportDisposition } from './report-service.js';
import { readPrivateJson, readPrivateText, readPushArtifact, withOperationStore, type OperationStore } from './store.js';

export interface PushReportContext extends PushMeasurementContext { report: PushReportArtifact; render: PushReportRenderInputs }
function renderInputs(measured: PushMeasurementContext, baseRef: string, headRef: string): PushReportRenderInputs {
  return { ...measured.comparison, diagnosis: measured.context.diagnosis, inference: measured.context.inference, measurement: measured.measurement, patch: measured.context.patch, baseRef, headRef };
}
async function retainPushMeasurementEvidence(store: OperationStore, path: string, measured: PushMeasurementContext): Promise<void> {
  await withOperationStore(join(store.directory, 'measurement-evidence'), async nested => {
    await copyPushProposalContext(nested, measured.context); await retainPushSandboxEvidence(nested, join(dirname(path), 'sandbox-evidence', measured.pair.journal.latestArtifact!), measured.pair);
    await nested.writeJson('cohort.json', measured.cohort); await nested.writeJson('intent.json', measured.intent); await nested.writeJson('measurement-evidence.json', measured.evidence);
    await nested.writeArtifact('measurement', measured.measurement); await nested.writeJson('measurement-receipt.json', await readPrivateJson(join(dirname(path), 'measurement-receipt.json')));
  });
}

/** `optimize report` for a push measurement: the same retention and receipts as the cache report; the PR refs are the owner's pinned branches. */
export async function runPushReport(proposalPath: string, sandboxPath: string, measurementPath: string, output: string, baseRef = 'main', headRef = 'develop'): Promise<ReportDisposition> {
  try {
    const context = await readPushProposalContext(proposalPath), pair = await readPushSandboxContext(sandboxPath), measured = await readPushMeasurementContext(measurementPath);
    if (jsonDigest(context.proposal) !== jsonDigest(measured.context.proposal) || jsonDigest(pair.sandbox) !== jsonDigest(measured.pair.sandbox)) throw new Error('report-input-drift');
    const render = renderInputs(measured, baseRef, headRef), report = renderPushReport(render);
    return await withOperationStore(output, async store => {
      await copyPushProposalContext(store, context); await retainPushMeasurementEvidence(store, measurementPath, measured);
      await store.writeArtifact('report', report); await store.writeText('report.md', report.markdown);
      await store.writeJson('report-receipt.json', { schemaVersion: 1, kind: 'report-receipt', renderDigest: jsonDigest(render), reportDigest: jsonDigest(report), bodyHash: report.markdownHash });
      await store.writeJson('operation.json', { schemaVersion: 1, kind: 'optimization-operation', action: 'report', status: report.status, reasonCode: report.status, inputDigest: jsonDigest(context.input), nextCommand: 'cirujano --help' });
      return { status: report.status, reasonCode: report.status, artifactPath: join(store.directory, 'report.json') };
    });
  } catch { return { status: 'failed', reasonCode: 'report-evidence-rejected', artifactPath: null }; }
}

/** Re-renders a retained push report from its retained evidence; any byte of drift rejects. */
export async function readPushReportContext(path: string): Promise<PushReportContext> {
  if (basename(path) !== 'report.json') throw new Error('report-filename');
  const directory = dirname(path), context = await readPushProposalContext(join(directory, 'proposal.json')), measured = await readPushMeasurementContext(join(directory, 'measurement-evidence', 'measurement.json'));
  const report = await readPushArtifact('report', path), receipt = exact(await readPrivateJson(join(directory, 'report-receipt.json')), ['schemaVersion', 'kind', 'renderDigest', 'reportDigest', 'bodyHash']), render = renderInputs(measured, report.baseRef, report.headRef);
  if (jsonDigest(context.proposal) !== jsonDigest(measured.context.proposal) || canonicalJson(report) !== canonicalJson(renderPushReport(render)) || receipt.schemaVersion !== 1 || receipt.kind !== 'report-receipt' || receipt.renderDigest !== jsonDigest(render) || receipt.reportDigest !== jsonDigest(report) || receipt.bodyHash !== report.markdownHash || await readPrivateText(join(directory, 'report.md')) !== report.markdown) throw new Error('report-evidence-drift');
  return { ...measured, report, render };
}
