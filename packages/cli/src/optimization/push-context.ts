import { dirname, join } from 'node:path';
import { artifactFamily, assertSamePushProvenance, canonicalJson, CLASSIFIER_DIGEST, createPushInput, decodePushSourceManifest, inspectRenderablePushWorkflow, isTopLevelWorkflowPath, jsonDigest, PUSH_FAMILY, pushSourceText, validatePushDiagnosisEvidence, type OptimizationFamily, type PushDiagnosisArtifact, type PushInferenceArtifact, type PushInputArtifact, type PushSourceManifest, type PushWorkflowEvidence } from '@cirujano/core';
import { readBoundDiagnosis, type DiagnosisFamily } from './diagnosis-journal.js';
import { readRetainedOptimizationContext, RetainedInputError } from './input-context.js';
import { readPrivateJson, readPushArtifact } from './store.js';

export interface PushCollectionReceipt { schemaVersion: 1; kind: 'collection-receipt'; family: typeof PUSH_FAMILY; inputDigest: string; sourceManifestDigest: string }
export interface PushInputContext { input: PushInputArtifact; source: PushSourceManifest; collectionReceipt: PushCollectionReceipt }
export interface PushDiagnosisContext extends PushInputContext { diagnosis: PushDiagnosisArtifact; inference: PushInferenceArtifact; config: unknown; intent: unknown; diagnosisState: unknown }

export function pushCollectionReceipt(input: PushInputArtifact, source: PushSourceManifest): PushCollectionReceipt {
  return { schemaVersion: 1, kind: 'collection-receipt', family: PUSH_FAMILY, inputDigest: jsonDigest(input), sourceManifestDigest: jsonDigest(source) };
}

/** The retained workflow text and the eligibility evidence it was collected with. */
export function pushWorkflowEvidence(input: PushInputArtifact, source: PushSourceManifest): { workflow: string; evidence: PushWorkflowEvidence } {
  const file = source.files.find(entry => entry.path === input.provenance.workflowPath)!;
  const inventory = source.files.filter(entry => isTopLevelWorkflowPath(entry.path)).map(entry => ({ path: entry.path, source: pushSourceText(entry) }));
  return { workflow: pushSourceText(file), evidence: { workflowHash: file.hash, workflowPath: file.path, integrationBranch: input.provenance.integrationBranch, inventory } };
}
/** Re-derives the retained input from the retained workflow bytes and history with the same policy collection used. */
export async function readRetainedPushContext(inputPath: string): Promise<PushInputContext> {
  try {
    const input = await readPushArtifact('input', inputPath), directory = dirname(inputPath);
    const source = decodePushSourceManifest(await readPrivateJson(join(directory, 'source.json'), 32 * 1024 * 1024)); assertSamePushProvenance(input.provenance, source.provenance);
    // The receipt is fully determined by the input and source, so exact equality is its whole check.
    const collectionReceipt = pushCollectionReceipt(input, source);
    if (canonicalJson(await readPrivateJson(join(directory, 'collection-receipt.json'))) !== canonicalJson(collectionReceipt)) throw new Error('collection receipt drift');
    // A different classifier would embed different bytes than the one that judged this history.
    if (input.provenance.classifierDigest !== CLASSIFIER_DIGEST) throw new Error('classifier drift');
    const { workflow, evidence } = pushWorkflowEvidence(input, source), eligibility = inspectRenderablePushWorkflow(workflow, evidence);
    if (canonicalJson(createPushInput({ provenance: input.provenance, eligibility, history: input.history, treeSha: String(input.structuralFacts.treeSha) })) !== canonicalJson(input)) throw new Error('retained policy drift');
    return { input, source, collectionReceipt };
  } catch { throw new RetainedInputError(); }
}

const pushDiagnosis: DiagnosisFamily<PushInputContext, PushDiagnosisArtifact, PushInferenceArtifact> = {
  readContext: readRetainedPushContext,
  readDiagnosis: path => readPushArtifact('diagnosis', path),
  readInference: path => readPushArtifact('inference', path),
  bind: (context, diagnosis, inference) => { assertSamePushProvenance(context.input.provenance, inference.provenance); validatePushDiagnosisEvidence(diagnosis, context.input); },
};
/** The push counterpart of `readDiagnosisContext`, with the same shared binding order. */
export function readPushDiagnosisContext(inputPath: string, diagnosisPath: string, stateFile = 'operation.json', intentFile = 'intent.json'): Promise<PushDiagnosisContext> {
  return readBoundDiagnosis(pushDiagnosis, inputPath, diagnosisPath, stateFile, intentFile);
}

/** The family of a retained input, or null when it cannot be read; the family's own reader then validates it. */
export async function retainedFamily(inputPath: string): Promise<OptimizationFamily | null> {
  try { return artifactFamily(await readPrivateJson(inputPath)); } catch { return null; }
}
/** Either family's retained collection, chosen by the input's `family` field. */
export async function readRetainedFamilyContext(inputPath: string) {
  const family = await retainedFamily(inputPath);
  if (!family) throw new RetainedInputError();
  return family === PUSH_FAMILY ? { family, ...await readRetainedPushContext(inputPath) } as const : { family, ...await readRetainedOptimizationContext(inputPath) } as const;
}
