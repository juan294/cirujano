import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalJson, CLASSIFIER_JOB_ID, createSkipValidatedPushPatch, decodePushArtifact, extractClassifierScript, jsonDigest, PUSH_FAMILY, sha256, type PushProposalArtifact, type SkipValidatedPushPatch } from '@cirujano/core';
import type { CliIo } from '../cli.js';
import type { OptimizeArguments } from './arguments.js';
import { exactKeys, record } from './diagnosis-journal.js';
import { pushWorkflowEvidence, readPushDiagnosisContext, readRetainedPushContext, type PushDiagnosisContext, type PushInputContext } from './push-context.js';
import { emitStage, shellQuote } from './stage-output.js';
import { readPrivateJson, readPrivateText, readPushArtifact, withOperationStore, type OperationStore } from './store.js';

export interface PushProposalContext extends PushDiagnosisContext { proposal: PushProposalArtifact; candidate: string; patch: string }
const preconditions = ['exact-retained-workflow-inventory', 'eligible-before-inference', 'guard-only-change', 'classifier-digest-bound', 'fail-open-classifier'];
const reasons = { proposed: 'guard-only-proposal', abstain: 'model-abstained', 'no-change': 'already-guarded-no-change' } as const;

/** The same deterministic patch collection's eligibility allows, rebuilt from the retained workflow inventory. */
function editor(context: PushInputContext): SkipValidatedPushPatch {
  const { workflow, evidence } = pushWorkflowEvidence(context.input, context.source);
  return createSkipValidatedPushPatch(workflow, evidence);
}
function proposalFor(context: PushDiagnosisContext, patch: SkipValidatedPushPatch, candidateSha: string | null = null): PushProposalArtifact {
  const { diagnosis, input } = context;
  if (diagnosis.status !== 'proposal' || patch.status !== 'proposed' || canonicalJson(patch.operation) !== canonicalJson(diagnosis.operation)) throw new Error('model-proposal-required');
  // The candidate must embed exactly the classifier that judged the collected history.
  if (sha256(extractClassifierScript(patch.candidate)) !== input.provenance.classifierDigest) throw new Error('classifier-digest-drift');
  return decodePushArtifact('proposal', { schemaVersion: 1, kind: 'proposal', family: PUSH_FAMILY, provenance: input.provenance, status: 'proposed', operation: diagnosis.operation, candidateSha, candidateWorkflowHash: patch.afterHash, patchHash: sha256(patch.patch), beforeStructuralDigest: patch.beforeStructuralDigest, afterStructuralDigest: patch.afterStructuralDigest, permittedDiff: { classifierJobId: CLASSIFIER_JOB_ID, guardedJobIds: input.provenance.guardedJobIds }, preconditions, diagnosisDigest: jsonDigest(diagnosis) });
}
function patchReceipt(context: PushDiagnosisContext, proposal: PushProposalArtifact, patch: SkipValidatedPushPatch): unknown {
  return { schemaVersion: 1, kind: 'patch-receipt', inputDigest: jsonDigest(context.input), diagnosisDigest: jsonDigest(context.diagnosis), inferenceDigest: jsonDigest(context.inference), proposalDigest: jsonDigest(proposal), beforeHash: patch.beforeHash, afterHash: patch.afterHash, patchHash: sha256(patch.patch) };
}
async function copyPushInputContext(store: OperationStore, context: PushInputContext): Promise<void> {
  await store.writeText('source.json', canonicalJson(context.source)); await store.writeArtifact('input', context.input); await store.writeJson('collection-receipt.json', context.collectionReceipt);
}
async function copyPushDiagnosisContext(store: OperationStore, context: PushDiagnosisContext): Promise<void> {
  await copyPushInputContext(store, context); await store.writeJson('config.json', context.config); await store.writeArtifact('diagnosis', context.diagnosis); await store.writeArtifact('inference', context.inference); await store.writeJson('diagnosis-intent.json', context.intent); await store.writeJson('diagnosis-state.json', context.diagnosisState);
}
export async function copyPushProposalContext(store: OperationStore, context: PushProposalContext): Promise<void> {
  await copyPushDiagnosisContext(store, context); await store.writeArtifact('proposal', context.proposal); await store.writeText('candidate.yml', context.candidate); await store.writeText('workflow.patch', context.patch); await store.writeJson('patch-receipt.json', patchReceipt(context, context.proposal, editor(context)));
}
const readCopiedDiagnosisContext = (directory: string) => readPushDiagnosisContext(join(directory, 'input.json'), join(directory, 'diagnosis.json'), 'diagnosis-state.json', 'diagnosis-intent.json');

/** Every retained proposal file must equal what the retained diagnosis deterministically produces. */
export async function readPushProposalContext(proposalPath: string): Promise<PushProposalContext> {
  const directory = dirname(proposalPath), context = await readCopiedDiagnosisContext(directory), proposal = await readPushArtifact('proposal', proposalPath);
  // `expected` passed the guard proof inside the patch, so byte equality with it proves the retained candidate.
  const candidate = await readPrivateText(join(directory, 'candidate.yml')), patch = await readPrivateText(join(directory, 'workflow.patch')), expected = editor(context);
  if (candidate !== expected.candidate || patch !== expected.patch || canonicalJson(proposal) !== canonicalJson(proposalFor(context, expected, proposal.candidateSha)) || canonicalJson(await readPrivateJson(join(directory, 'patch-receipt.json'))) !== canonicalJson(patchReceipt(context, proposal, expected))) throw new Error('proposal-artifact-drift');
  return { ...context, proposal, candidate, patch };
}

/** `optimize propose` for a push input: a local patch only, with the same lifecycle as the cache family. */
export async function runPushPropose(args: OptimizeArguments, io: CliIo): Promise<0 | 1> {
  try {
    const inputPath = args.flags.input, diagnosisPath = args.flags.diagnosis, output = args.flags.output;
    if (typeof inputPath !== 'string' || typeof diagnosisPath !== 'string' || typeof output !== 'string') throw new Error('proposal-arguments-invalid');
    const inputContext = await readRetainedPushContext(inputPath);
    const diagnosisContext = inputContext.input.status === 'no-change' ? null : await readPushDiagnosisContext(inputPath, diagnosisPath);
    const disposition = !diagnosisContext ? 'no-change' : diagnosisContext.diagnosis.status === 'abstain' ? 'abstain' : 'proposed';
    let nextCommand = 'cirujano --help';
    await withOperationStore(output, async store => {
      await store.writeJson('local-stage.json', { schemaVersion: 1, kind: 'proposal-stage', status: 'local-only', inputDigest: jsonDigest(inputContext.input) });
      if (diagnosisContext) await copyPushDiagnosisContext(store, diagnosisContext); else await copyPushInputContext(store, inputContext);
      if (disposition === 'proposed' && diagnosisContext) {
        nextCommand = `cirujano optimize status --operation ${shellQuote(await realpath(store.directory))}`;
        const generated = editor(diagnosisContext), proposal = proposalFor(diagnosisContext, generated);
        await store.writeText('workflow.patch', generated.patch); await store.writeText('candidate.yml', generated.candidate);
        await store.writeJson('patch-receipt.json', patchReceipt(diagnosisContext, proposal, generated)); await store.writeArtifact('proposal', proposal);
      }
      await store.writeJson('operation.json', { schemaVersion: 1, kind: 'optimization-operation', action: 'propose', status: disposition, reasonCode: reasons[disposition], nextCommand, inputDigest: jsonDigest(inputContext.input) });
    });
    emitStage(args, io, disposition, reasons[disposition], nextCommand); return 0;
  } catch { emitStage(args, io, 'rejected', 'proposal-evidence-rejected'); return 1; }
}
export async function readPushProposalStatus(directory: string): Promise<{ status: string; reasonCode: string; nextCommand: string }> {
  const state = record(await readPrivateJson(join(directory, 'operation.json'))); exactKeys(state, ['schemaVersion', 'kind', 'action', 'status', 'reasonCode', 'nextCommand', 'inputDigest']);
  const context = await readRetainedPushContext(join(directory, 'input.json'));
  if (state.schemaVersion !== 1 || state.kind !== 'optimization-operation' || state.action !== 'propose' || state.inputDigest !== jsonDigest(context.input) || !Object.hasOwn(reasons, String(state.status)) || state.reasonCode !== reasons[state.status as keyof typeof reasons]) throw new Error('proposal-state-invalid');
  if (state.status === 'proposed') { await readPushProposalContext(join(directory, 'proposal.json')); if (state.nextCommand !== `cirujano optimize status --operation ${shellQuote(await realpath(directory))}`) throw new Error('proposal-state-invalid'); }
  else if (state.nextCommand !== 'cirujano --help' || (state.status === 'abstain' ? (await readCopiedDiagnosisContext(directory)).diagnosis.status !== 'abstain' : context.input.status !== 'no-change')) throw new Error('proposal-state-invalid');
  return { status: state.status as string, reasonCode: state.reasonCode as string, nextCommand: state.nextCommand as string };
}
