import { dirname, join } from 'node:path';
import { assertSameProvenance, canonicalJson, decodeActionReceipt, decodeSourceManifest, decodeVerificationProfile, inspectWorkflow, jsonDigest, parseStrictJson, type InputArtifact, type SourceManifest, type ActionReceipt, type VerificationProfile } from '@cirujano/core';
import { readOptimizationArtifact, readPrivateJson } from './store.js';
export class RetainedInputError extends Error { constructor() { super('retained-input-invalid'); } }
export interface CollectionReceipt { schemaVersion: 1; kind: 'collection-receipt'; inputDigest: string; sourceManifestDigest: string; actionReceiptDigest: string }
export function decodeCollectionReceipt(value: unknown): CollectionReceipt {
  canonicalJson(value); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('collection-receipt-invalid');
  const receipt = value as CollectionReceipt;
  if (Object.keys(receipt).sort().join(',') !== ['schemaVersion', 'kind', 'inputDigest', 'sourceManifestDigest', 'actionReceiptDigest'].sort().join(',') || receipt.schemaVersion !== 1 || receipt.kind !== 'collection-receipt' || ![receipt.inputDigest, receipt.sourceManifestDigest, receipt.actionReceiptDigest].every(digest => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest))) throw new Error('collection-receipt-invalid'); return receipt;
}
export async function readRetainedOptimizationContext(inputPath: string): Promise<{ input: InputArtifact; source: SourceManifest; receipt: ActionReceipt; collectionReceipt: CollectionReceipt; profile: VerificationProfile }> {
  try {
    const input = await readOptimizationArtifact('input', inputPath), directory = dirname(inputPath);
    const source = decodeSourceManifest(await readPrivateJson(join(directory, 'source.json'), 32 * 1024 * 1024)); assertSameProvenance(input.provenance, source.provenance);
    const receipt = decodeActionReceipt(await readPrivateJson(join(directory, 'action-receipt.json')));
    const collectionReceipt = decodeCollectionReceipt(await readPrivateJson(join(directory, 'collection-receipt.json')));
    if (collectionReceipt.inputDigest !== jsonDigest(input) || collectionReceipt.sourceManifestDigest !== jsonDigest(source) || collectionReceipt.actionReceiptDigest !== jsonDigest(receipt)) throw new Error('collection receipt drift');
    const profileFile = source.files.find(file => file.path === source.profilePath)!, workflow = source.files.find(file => file.path === input.provenance.workflowPath)!;
    const profile = decodeVerificationProfile(parseStrictJson(Buffer.from(profileFile.bytesBase64, 'base64').toString('utf8')));
    const eligibility = inspectWorkflow(Buffer.from(workflow.bytesBase64, 'base64').toString('utf8'), { provenance: input.provenance, receipt, rootLockfile: source.files.some(file => file.path === 'pnpm-lock.yaml'), timedBaseline: input.baselines.length > 0, requiredChecks: input.requiredChecks, verificationProfilePresent: true });
    const expectedStatus = eligibility.status === 'eligible' ? 'collected' : eligibility.status;
    if (input.status !== expectedStatus || canonicalJson(input.operations) !== canonicalJson(eligibility.operations) || Object.entries(eligibility.structuralFacts).some(([key, value]) => input.structuralFacts[key] !== value) || input.structuralFacts.reasonCode !== eligibility.reason || input.structuralFacts.actionReceiptDigest !== jsonDigest(receipt) || input.evidence['setup-node-receipt'] !== canonicalJson(receipt)) throw new Error('retained policy drift');
    if (eligibility.status === 'eligible' && (profile.nodeVersion !== eligibility.structuralFacts.nodeVersion || profile.pnpmVersion !== eligibility.structuralFacts.pnpmVersion)) throw new Error('profile runtime drift');
    return { input, source, receipt, collectionReceipt, profile };
  } catch { throw new RetainedInputError(); }
}
export async function readRetainedOptimizationInput(inputPath: string): Promise<InputArtifact> { return (await readRetainedOptimizationContext(inputPath)).input; }

