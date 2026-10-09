import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { assertSamePushProvenance, buildPushGuardPayload, canonicalJson, classifierCases, decodePushArtifact, decodePushProvenance, jsonDigest, parseStrictJson, PUSH_FAMILY, pushSourceText, sha256, type PushGuardPayload, type PushGuardResult, type PushProvenance, type PushSandboxArtifact } from '@cirujano/core';
import { readLocalPushCandidate } from './candidate-source.js';
import { bounded, decodeSandboxPermit, hash, uuid, type SandboxPermit } from './execution-profile.js';
import { copyPushProposalContext, readPushProposalContext, type PushProposalContext } from './push-propose.js';
import { buildLineageValid, createSandboxClient, imageReferenceValid, previewSandboxRequest, type SandboxCreateIntent, type SandboxObservedOperation, type SandboxRecord, type SandboxResult } from './sandbox.js';
import { consumePermit, readPrivateJson, scrubOptimizationValue, withOperationStore, type OperationStore } from './store.js';
import { decodeReceipt, type VerificationDisposition, type VerificationOptions } from './verify.js';

declare const CIRUJANO_PUSH_HARNESS_HASH: string | undefined;
/** The push-guard execution profile (Phase 5): its own image, whose `/opt/cirujano/harness.mjs` is the push-guard harness. */
export interface PushGuardProfile {
  schemaVersion: 1; kind: 'push-guard-profile'; provenance: PushProvenance; proposalDigest: string; candidateSha: string; candidateRepository: string; project: string;
  image: { uuid: string; ociDigest: string; registryReference: string; importOperationId: string; buildOperationIds: string[]; recipeHash: string; manifestHash: string; harnessHash: string };
  timeoutSeconds: 600; maxLayerBytes: number; imageRetention: 'owner-retained';
}
export interface PushGuardImageManifest { schemaVersion: 1; kind: 'push-guard-image'; toolSourceSha: string; bundleDigest: string; nodeVersion: string; harnessHash: string; recipeHash: string }
interface PushGuardJournal {
  schemaVersion: 1; kind: 'push-guard-run'; proposalDigest: string; profileDigest: string; permitDigest: string; payloadDigest: string; status: 'running' | 'failed' | 'outcome-unknown' | 'sandbox-verified';
  createStatus: 'intent' | 'created' | 'failed' | 'outcome-unknown' | null; intent: SandboxCreateIntent | null; record: SandboxRecord | null; receipt: SandboxObservedOperation | null; result: PushGuardResult | null; cancelRequested: boolean;
  startedAt: string; completedAt: string | null; latestArtifact: string | null; artifactDigest: string | null;
}
interface PushGuardRun { context: PushProposalContext; profile: PushGuardProfile; permit: SandboxPermit; payload: PushGuardPayload; journal: PushGuardJournal }
export const PUSH_GUARD_IMAGE_COMMAND = 'node scripts/optimization/image-context.mjs --push-guard <recipe.json> <new-context-directory>';

function invalid(): never { throw new Error('unsupported-push-guard-profile'); }
function exact(value: unknown, keys: string[], code = 'unsupported-push-guard-profile'): Record<string, unknown> { canonicalJson(value); if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(code); return value as Record<string, unknown>; }
const terminal = (status: string) => ['SUCCESS', 'FAILED', 'CANCELLED'].includes(status);

export function decodePushGuardProfile(value: unknown): PushGuardProfile {
  const profile = exact(value, ['schemaVersion', 'kind', 'provenance', 'proposalDigest', 'candidateSha', 'candidateRepository', 'project', 'image', 'timeoutSeconds', 'maxLayerBytes', 'imageRetention']) as unknown as PushGuardProfile;
  decodePushProvenance(profile.provenance);
  const image = exact(profile.image, ['uuid', 'ociDigest', 'registryReference', 'importOperationId', 'buildOperationIds', 'recipeHash', 'manifestHash', 'harnessHash']);
  if (profile.schemaVersion !== 1 || profile.kind !== 'push-guard-profile' || !hash(profile.proposalDigest) || typeof profile.candidateSha !== 'string' || !/^[a-f0-9]{40}$/.test(profile.candidateSha) || profile.candidateSha === profile.provenance.baseSha || !bounded(profile.candidateRepository) || !profile.candidateRepository.startsWith('/') || !bounded(profile.project)) invalid();
  if (!uuid(image.uuid) || !uuid(image.importOperationId) || !buildLineageValid(image.buildOperationIds, String(image.importOperationId)) || !['ociDigest', 'recipeHash', 'manifestHash', 'harnessHash'].every(key => hash(image[key])) || !bounded(image.registryReference) || !imageReferenceValid(String(image.registryReference), String(image.ociDigest), (image.buildOperationIds as string[]).length > 0)) invalid();
  if (profile.timeoutSeconds !== 600 || !Number.isSafeInteger(profile.maxLayerBytes) || profile.maxLayerBytes < 1 || profile.maxLayerBytes > 1024 * 1024 * 1024 || profile.imageRetention !== 'owner-retained') invalid();
  return profile;
}
export function decodePushGuardImageManifest(value: unknown, profile: PushGuardProfile): PushGuardImageManifest {
  const manifest = exact(value, ['schemaVersion', 'kind', 'toolSourceSha', 'bundleDigest', 'nodeVersion', 'harnessHash', 'recipeHash']) as unknown as PushGuardImageManifest;
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'push-guard-image' || manifest.toolSourceSha !== profile.provenance.toolSourceSha || manifest.bundleDigest !== profile.provenance.bundleDigest || !/^\d+\.\d+\.\d+$/.test(String(manifest.nodeVersion)) || manifest.harnessHash !== profile.image.harnessHash || manifest.recipeHash !== profile.image.recipeHash) invalid();
  return manifest;
}
export async function trustedPushHarnessHash(): Promise<string> {
  return typeof CIRUJANO_PUSH_HARNESS_HASH !== 'undefined' ? CIRUJANO_PUSH_HARNESS_HASH : sha256(await readFile(new URL('../../../../scripts/optimization/push-guard-harness.mjs', import.meta.url)));
}
/** The profile must name this proposal, the trusted harness, and a local commit holding exactly the candidate workflow. */
async function bound(context: PushProposalContext, raw: unknown): Promise<{ profile: PushGuardProfile; payload: PushGuardPayload }> {
  const profile = decodePushGuardProfile(raw), { provenance } = context.proposal;
  assertSamePushProvenance(profile.provenance, provenance);
  if (profile.proposalDigest !== jsonDigest(context.proposal) || profile.image.harnessHash !== await trustedPushHarnessHash() || (context.proposal.candidateSha !== null && context.proposal.candidateSha !== profile.candidateSha)) throw new Error('push-guard-profile-drift');
  await readLocalPushCandidate(profile.candidateRepository, profile.candidateSha, provenance.baseSha, provenance.workflowPath, context.candidate);
  const base = pushSourceText(context.source.files.find(file => file.path === provenance.workflowPath)!);
  const payload = buildPushGuardPayload({ profileDigest: jsonDigest(profile), proposalDigest: profile.proposalDigest, toolSourceSha: provenance.toolSourceSha, bundleDigest: provenance.bundleDigest, imageManifestHash: profile.image.manifestHash, harnessHash: profile.image.harnessHash, classifierDigest: provenance.classifierDigest, workflowPath: provenance.workflowPath, baseWorkflow: base, candidateWorkflow: context.candidate, operation: context.proposal.operation, cases: classifierCases() });
  return { profile, payload };
}
/** The harness result must be exactly one canonical line bound to this payload. */
function decodeResult(stdout: string, payload: PushGuardPayload): PushGuardResult {
  const result = exact(parseStrictJson(stdout), ['schemaVersion', 'kind', 'profileDigest', 'proposalDigest', 'toolSourceSha', 'bundleDigest', 'imageManifestHash', 'harnessHash', 'status', 'failure', 'matrixCells', 'mismatchCount', 'mismatches', 'classifierCases', 'classifierMismatchCount', 'classifierMismatches', 'classifierDigest', 'fixtureDigest'], 'push-guard-result-invalid') as unknown as PushGuardResult;
  const counters = [result.matrixCells, result.mismatchCount, result.classifierCases, result.classifierMismatchCount];
  if (stdout !== `${canonicalJson(result)}\n` || result.schemaVersion !== 1 || result.kind !== 'push-guard-result' || (['profileDigest', 'proposalDigest', 'toolSourceSha', 'bundleDigest', 'imageManifestHash', 'harnessHash', 'fixtureDigest'] as const).some(key => result[key] !== payload[key])
    || !['passed', 'failed'].includes(result.status) || (result.status === 'passed') !== (result.failure === null) || (result.failure !== null && !/^[a-z][a-z0-9-]{0,63}$/.test(result.failure)) || !counters.every(count => Number.isSafeInteger(count) && count >= 0)
    || !Array.isArray(result.mismatches) || !Array.isArray(result.classifierMismatches) || [...result.mismatches, ...result.classifierMismatches].some(line => typeof line !== 'string' || !line || Buffer.byteLength(line) > 512) || result.mismatches.length > 20 || result.classifierMismatches.length > 20
    || (result.classifierDigest !== null && !hash(result.classifierDigest)) || result.classifierCases > payload.cases.length || (result.status === 'passed' && result.classifierCases !== payload.cases.length)
    || result.mismatches.length !== Math.min(result.mismatchCount, 20) || result.classifierMismatches.length !== Math.min(result.classifierMismatchCount, 20)
    // A passed result ran exactly the digest-bound script on every case.
    || (result.status === 'passed' && (result.classifierDigest !== payload.classifierDigest || result.mismatchCount !== 0 || result.classifierMismatchCount !== 0 || result.matrixCells === 0))) throw new Error('push-guard-result-invalid');
  return result;
}
function accept(run: PushGuardRun, result: SandboxResult): void {
  run.journal.receipt = result.operation; run.journal.result = null;
  if (!result.operation || result.operation.status !== 'SUCCESS' || !result.operation.process || result.status === 'failed' || result.status === 'outcome-unknown' || result.stdout === null) return;
  try { if (result.operation.stdoutHash !== sha256(result.stdout)) throw new Error('push-guard-result-bytes'); run.journal.result = decodeResult(result.stdout, run.payload); } catch { run.journal.result = null; }
}
function artifactFor(run: PushGuardRun): PushSandboxArtifact {
  const { journal, profile, context, payload } = run, receipt = journal.receipt, process = receipt?.process ?? null, result = journal.result;
  const known = !!journal.record && !!receipt && terminal(receipt.status), truncated = receipt?.stdoutTruncated === true || receipt?.stderrTruncated === true;
  const clean = receipt?.status === 'SUCCESS' && !!process && process.exitCode === 0 && process.signal === 0 && !process.timedOut && !process.stopped && !process.continued && !process.coreDump;
  const status: PushSandboxArtifact['status'] = clean && result?.status === 'passed' ? 'sandbox-verified' : !known && !!journal.intent && journal.createStatus !== 'failed' ? 'outcome-unknown' : 'failed';
  const listed = [...(result?.mismatches ?? []), ...(result?.classifierMismatches ?? [])], completedAt = status === 'outcome-unknown' ? null : journal.completedAt;
  return decodePushArtifact('sandbox', {
    schemaVersion: 1, kind: 'sandbox', family: PUSH_FAMILY, provenance: profile.provenance, candidateSha: profile.candidateSha, patchHash: context.proposal.patchHash, proposalDigest: jsonDigest(context.proposal), status,
    image: { uuid: profile.image.uuid, digest: profile.image.ociDigest, recipeHash: profile.image.recipeHash, manifestHash: profile.image.manifestHash },
    operations: journal.record && receipt ? [{ id: journal.record.id, status: receipt.status, role: 'verifier', exitCode: process?.exitCode ?? null, signal: process?.signal ? String(process.signal) : null, timedOut: process?.timedOut ?? false, truncated }] : [],
    networkEnabled: false, matrixCells: result?.matrixCells ?? 0, mismatches: (result?.mismatchCount ?? 0) + (result?.classifierMismatchCount ?? 0), firstMismatch: listed[0] ?? null,
    classifierCases: result?.classifierCases ?? 0, classifierDigest: result?.classifierDigest ?? payload.classifierDigest, fixtureDigest: payload.fixtureDigest,
    startedAt: journal.startedAt, completedAt, elapsedMs: completedAt ? Date.parse(completedAt) - Date.parse(journal.startedAt) : null,
    usage: receipt?.usage ?? null, truncated, cleanupState: known ? 'disposable-confirmed' : 'unknown', retainedImage: true,
  });
}
async function writeJournal(store: OperationStore, journal: PushGuardJournal, options: VerificationOptions): Promise<void> {
  if (canonicalJson(scrubOptimizationValue(journal, [options.iamToken])) !== canonicalJson(journal)) throw new Error('sandbox-journal-secret');
  await store.writeJson('intent.json', journal, { replaceIntent: true });
}
async function finish(store: OperationStore, run: PushGuardRun, options: VerificationOptions, initial: boolean, imageReasonCode: string | null = null): Promise<VerificationDisposition> {
  // Only a missing image or one whose bytes differ means the image must be built; other read-back failures say why.
  const imageMissing = imageReasonCode === 'sandbox-image-http-404' || imageReasonCode === 'sandbox-image-bytes-mismatch';
  run.journal.completedAt = new Date((options.now ?? Date.now)()).toISOString();
  const artifact = artifactFor(run); run.journal.status = artifact.status;
  const name = initial ? 'sandbox.json' : `sandbox-${jsonDigest(artifact)}.json`;
  try { await store.writeJson(name, artifact); } catch (error) { if (!(error instanceof Error && error.message.startsWith('artifact-exists')) || canonicalJson(await readPrivateJson(join(store.directory, name))) !== canonicalJson(artifact)) throw error; }
  run.journal.latestArtifact = name; run.journal.artifactDigest = jsonDigest(artifact); await writeJournal(store, run.journal, options);
  const needsInspection = artifact.status === 'outcome-unknown' && !!run.journal.intent && !run.journal.record && run.journal.createStatus !== 'failed';
  const reasonCode = artifact.status === 'sandbox-verified' ? 'push-guard-verified' : imageReasonCode ? (imageMissing ? 'push-guard-image-unavailable' : imageReasonCode) : needsInspection ? 'sandbox-create-id-unavailable-provider-inspection-required' : artifact.status === 'outcome-unknown' ? 'sandbox-outcome-unresolved' : run.journal.result?.failure ? `push-guard-${run.journal.result.failure}` : 'push-guard-sandbox-failed';
  await store.writeJson('operation.json', { schemaVersion: 1, kind: 'optimization-operation', action: 'verify', status: artifact.status, reasonCode, inputDigest: jsonDigest(run.context.input), nextCommand: 'cirujano --help' }, { replaceIntent: true });
  const recovery = imageMissing ? `The push-guard image could not be read back. Build its context with \`${PUSH_GUARD_IMAGE_COMMAND}\`, then build, import and bind it to the profile (owner-authorized).` : needsInspection ? 'Provider inspection is required before a new create. No operation ID was returned; this stage cannot safely look it up or retry.' : undefined;
  return { status: artifact.status, reasonCode, artifactPath: join(store.directory, name), ...(recovery ? { recovery } : {}) };
}
function journalFor(context: PushProposalContext, profile: PushGuardProfile, permit: SandboxPermit, payload: PushGuardPayload, startedAt: string): PushGuardJournal {
  return { schemaVersion: 1, kind: 'push-guard-run', proposalDigest: jsonDigest(context.proposal), profileDigest: jsonDigest(profile), permitDigest: jsonDigest(permit), payloadDigest: jsonDigest(payload), status: 'running', createStatus: null, intent: null, record: null, receipt: null, result: null, cancelRequested: false, startedAt, completedAt: null, latestArtifact: null, artifactDigest: null };
}

/** One disposable, network-disabled Sandbox operation runs the push-guard harness on the proposal. */
export async function verifyPushGuard(proposalPath: string, profileRaw: unknown, permitRaw: unknown, output: string, options: VerificationOptions): Promise<VerificationDisposition> {
  let run: PushGuardRun;
  try {
    const context = await readPushProposalContext(proposalPath), { profile, payload } = await bound(context, profileRaw), now = (options.now ?? Date.now)();
    const permit = decodeSandboxPermit(permitRaw, profile, now);
    run = { context, profile, permit, payload, journal: journalFor(context, profile, permit, payload, new Date(now).toISOString()) };
  } catch { return { status: 'rejected', reasonCode: 'sandbox-evidence-rejected', artifactPath: null }; }
  try {
    return await withOperationStore(output, async store => {
      try { await readPrivateJson(join(store.directory, 'intent.json')); return { status: 'outcome-unknown', reasonCode: 'existing-sandbox-intent', artifactPath: null } as VerificationDisposition; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await copyPushProposalContext(store, run.context); await store.writeJson('push-guard-profile.json', run.profile); await store.writeJson('sandbox-permit.json', run.permit); await writeJournal(store, run.journal, options);
      const client = createSandboxClient({ ...options, project: run.profile.project, authorityDigest: jsonDigest(run.permit) }), image = await client.inspectImage(run.profile);
      if (image.status !== 'verified' || !image.receipt || !image.manifestBytes) return await finish(store, run, options, true, image.reasonCode);
      decodePushGuardImageManifest(parseStrictJson(new TextDecoder('utf8', { fatal: true }).decode(image.manifestBytes)), run.profile); await store.writeJson('image-readback.json', image.receipt);
      run.journal.createStatus = 'intent';
      const created = await client.create(run.payload, run.profile.image.uuid, run.profile.maxLayerBytes,
        async intent => { run.journal.intent = intent; await writeJournal(store, run.journal, options); },
        async record => { run.journal.record = record; await writeJournal(store, run.journal, options); },
        async payloadDigest => { await consumePermit({ kind: 'sandbox', digest: jsonDigest(run.permit), operation: jsonDigest({ permitDigest: jsonDigest(run.permit), role: 'verifier', payloadDigest }), maximum: run.permit.maxOperations, ...(options.permitLedger ? { ledger: options.permitLedger } : {}) }); });
      run.journal.createStatus = created.status; await writeJournal(store, run.journal, options);
      if (created.status === 'created' && created.record) {
        let result = await client.poll(created.record);
        if (result.status === 'outcome-unknown') result = await client.cancel(created.record, async () => { run.journal.cancelRequested = true; await writeJournal(store, run.journal, options); });
        accept(run, result); await writeJournal(store, run.journal, options);
      }
      return finish(store, run, options, true);
    });
  } catch { return { status: run.journal.intent && run.journal.createStatus !== 'failed' && (!run.journal.receipt || !terminal(run.journal.receipt.status)) ? 'outcome-unknown' : 'failed', reasonCode: 'sandbox-stage-interrupted', artifactPath: null }; }
}

async function readRun(directory: string): Promise<PushGuardRun> {
  const context = await readPushProposalContext(join(directory, 'proposal.json')), { profile, payload } = await bound(context, await readPrivateJson(join(directory, 'push-guard-profile.json')));
  const permit = decodeSandboxPermit(await readPrivateJson(join(directory, 'sandbox-permit.json')), profile, 0);
  const journal = exact(await readPrivateJson(join(directory, 'intent.json')), ['schemaVersion', 'kind', 'proposalDigest', 'profileDigest', 'permitDigest', 'payloadDigest', 'status', 'createStatus', 'intent', 'record', 'receipt', 'result', 'cancelRequested', 'startedAt', 'completedAt', 'latestArtifact', 'artifactDigest'], 'sandbox-journal-invalid') as unknown as PushGuardJournal;
  if (journal.schemaVersion !== 1 || journal.kind !== 'push-guard-run' || journal.proposalDigest !== jsonDigest(context.proposal) || journal.profileDigest !== jsonDigest(profile) || journal.permitDigest !== jsonDigest(permit) || journal.payloadDigest !== jsonDigest(payload) || !['running', 'failed', 'outcome-unknown', 'sandbox-verified'].includes(journal.status) || ![null, 'intent', 'created', 'failed', 'outcome-unknown'].includes(journal.createStatus) || typeof journal.cancelRequested !== 'boolean' || !Number.isFinite(Date.parse(journal.startedAt))) throw new Error('sandbox-journal-drift');
  // The same intent, record and receipt checks the cache pair journal applies.
  if (journal.intent) {
    const intent = exact(journal.intent, ['schemaVersion', 'kind', 'attemptId', 'requestHash', 'payloadDigest', 'payloadFileUuid', 'imageUuid', 'project', 'createdAt'], 'sandbox-intent-drift');
    if (typeof intent.payloadFileUuid !== 'string') throw new Error('sandbox-intent-drift');
    const preview = previewSandboxRequest(payload, profile.image.uuid, profile.maxLayerBytes, intent.payloadFileUuid, jsonDigest(permit));
    if (intent.schemaVersion !== 1 || intent.kind !== 'sandbox-intent' || intent.requestHash !== preview.requestHash || intent.payloadDigest !== preview.payloadDigest || intent.imageUuid !== profile.image.uuid || intent.project !== profile.project || intent.attemptId !== jsonDigest({ requestHash: preview.requestHash, payloadDigest: preview.payloadDigest, imageUuid: profile.image.uuid, project: profile.project }) || typeof intent.createdAt !== 'string' || !Number.isFinite(Date.parse(intent.createdAt))) throw new Error('sandbox-intent-drift');
  }
  if (journal.record) {
    const record = exact(journal.record, ['id', 'url', 'imageUuid', 'project', 'requestHash', 'createdAt'], 'sandbox-record-drift');
    if (!journal.intent || record.requestHash !== journal.intent.requestHash || record.imageUuid !== profile.image.uuid || record.project !== profile.project || record.createdAt !== journal.intent.createdAt || !uuid(record.id) || record.url !== `https://api.tokenfactory.nebius.com/sandboxes/v1/operations/${String(record.id)}`) throw new Error('sandbox-record-drift');
  }
  if (journal.receipt) decodeReceipt(journal.receipt, journal, profile);
  if (journal.result && (!journal.receipt || journal.receipt.status !== 'SUCCESS' || journal.receipt.stdoutHash !== sha256(`${canonicalJson(journal.result)}\n`) || canonicalJson(decodeResult(`${canonicalJson(journal.result)}\n`, payload)) !== canonicalJson(journal.result))) throw new Error('sandbox-envelope-drift');
  return { context, profile, permit, payload, journal };
}
async function readBoundArtifact(path: string, run: PushGuardRun): Promise<PushSandboxArtifact> {
  const sandbox = decodePushArtifact('sandbox', await readPrivateJson(path)), { image } = run.profile;
  const readback = exact(await readPrivateJson(join(dirname(path), 'image-readback.json')), ['imageUuid', 'importOperationId', 'buildOperationIds', 'registryReference', 'approvedOciDigest', 'harnessHash', 'manifestHash', 'readAt'], 'sandbox-readback-drift');
  if (readback.imageUuid !== image.uuid || readback.importOperationId !== image.importOperationId || canonicalJson(readback.buildOperationIds) !== canonicalJson(image.buildOperationIds) || readback.registryReference !== image.registryReference || readback.approvedOciDigest !== image.ociDigest || readback.harnessHash !== image.harnessHash || readback.manifestHash !== image.manifestHash || !Number.isFinite(Date.parse(String(readback.readAt)))) throw new Error('sandbox-readback-drift');
  if (run.journal.latestArtifact !== basename(path) || run.journal.artifactDigest !== jsonDigest(sandbox) || canonicalJson(sandbox) !== canonicalJson({ ...artifactFor(run), startedAt: sandbox.startedAt, completedAt: sandbox.completedAt, elapsedMs: sandbox.elapsedMs })) throw new Error('sandbox-artifact-drift');
  return sandbox;
}
/** The push-guard counterpart of `readSandboxContext`, for measurement and report. */
export async function readPushSandboxContext(path: string): Promise<PushSandboxContext> {
  const run = await readRun(dirname(path)); return { ...run, sandbox: await readBoundArtifact(path, run) };
}
export type PushSandboxContext = PushGuardRun & { sandbox: PushSandboxArtifact };
/** Retains the verified run beside a later stage under the same file names, so that stage re-reads the same bound evidence. */
export async function retainPushSandboxEvidence(store: OperationStore, path: string, pair: PushSandboxContext): Promise<void> {
  await withOperationStore(join(store.directory, 'sandbox-evidence'), async nested => {
    await copyPushProposalContext(nested, pair.context); await nested.writeJson('push-guard-profile.json', pair.profile); await nested.writeJson('sandbox-permit.json', pair.permit);
    await nested.writeJson('image-readback.json', await readPrivateJson(join(dirname(path), 'image-readback.json'))); await nested.writeJson(basename(path), pair.sandbox); await nested.writeJson('intent.json', pair.journal);
  });
}
async function recover(directory: string, options: VerificationOptions, cancelPermit?: unknown): Promise<VerificationDisposition> {
  try {
    return await withOperationStore(directory, async store => {
      const run = await readRun(store.directory);
      if (cancelPermit !== undefined) decodeSandboxPermit(cancelPermit, run.profile, (options.now ?? Date.now)());
      if (run.journal.latestArtifact) { const existing = await readBoundArtifact(join(store.directory, run.journal.latestArtifact), run); if (existing.status === 'sandbox-verified') return { status: 'sandbox-verified', reasonCode: 'push-guard-verified', artifactPath: join(store.directory, run.journal.latestArtifact) } as VerificationDisposition; }
      const record = run.journal.record;
      if (record && !(run.journal.receipt && terminal(run.journal.receipt.status) && run.journal.result)) {
        const client = createSandboxClient({ ...options, project: run.profile.project, authorityDigest: jsonDigest(run.permit) });
        if (cancelPermit !== undefined) { const observed = await client.read(record); if (!observed.operation) throw new Error('sandbox-operation-ownership-unverified'); }
        accept(run, cancelPermit === undefined ? await client.read(record) : await client.cancel(record, async () => { run.journal.cancelRequested = true; await writeJournal(store, run.journal, options); }));
      }
      return finish(store, run, options, false);
    });
  } catch { return { status: 'rejected', reasonCode: 'sandbox-recovery-rejected', artifactPath: null }; }
}
export const reconcilePushGuard = (directory: string, options: VerificationOptions) => recover(directory, options);
export const cancelPushGuard = (directory: string, permit: unknown, options: VerificationOptions) => recover(directory, options, permit);
