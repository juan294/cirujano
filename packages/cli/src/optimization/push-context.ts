import { dirname, join } from 'node:path';
import { artifactFamily, assertSamePushProvenance, canonicalJson, CLASSIFIER_DIGEST, createPushInput, decodePushSourceManifest, isTopLevelWorkflowPath, inspectPushWorkflow, jsonDigest, PUSH_FAMILY, pushSourceText, validatePushDiagnosisEvidence, type PushDiagnosisArtifact, type PushInferenceArtifact, type PushInputArtifact, type PushSourceManifest } from '@cirujano/core';
import { readBoundDiagnosis, type DiagnosisFamily } from './diagnosis-journal.js';
import { readRetainedOptimizationContext, RetainedInputError } from './input-context.js';
import { readPrivateJson, readPushArtifact } from './store.js';

export interface PushCollectionReceipt { schemaVersion: 1; kind: 'collection-receipt'; family: typeof PUSH_FAMILY; inputDigest: string; sourceManifestDigest: string }
export interface PushInputContext { input: PushInputArtifact; source: PushSourceManifest; collectionReceipt: PushCollectionReceipt }
export interface PushDiagnosisContext extends PushInputContext { diagnosis: PushDiagnosisArtifact; inference: PushInferenceArtifact; config: unknown; intent: unknown; diagnosisState: unknown }

export function pushCollectionReceipt(input: PushInputArtifact, source: PushSourceManifest): PushCollectionReceipt {
  return { schemaVersion: 1, kind: 'collection-receipt', family: PUSH_FAMILY, inputDigest: jsonDigest(input), sourceManifestDigest: jsonDigest(source) };
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
    const workflow = source.files.find(file => file.path === input.provenance.workflowPath)!;
    const inventory = source.files.filter(file => isTopLevelWorkflowPath(file.path)).map(file => ({ path: file.path, source: pushSourceText(file) }));
    const eligibility = inspectPushWorkflow(pushSourceText(workflow), { workflowHash: workflow.hash, workflowPath: workflow.path, integrationBranch: input.provenance.integrationBranch, inventory });
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

/** Either family's retained collection, chosen by the input's `family` field. */
export async function readRetainedFamilyContext(inputPath: string) {
  let family;
  try { family = artifactFamily(await readPrivateJson(inputPath)); } catch { throw new RetainedInputError(); }
  return family === PUSH_FAMILY ? { family, ...await readRetainedPushContext(inputPath) } as const : { family, ...await readRetainedOptimizationContext(inputPath) } as const;
}
