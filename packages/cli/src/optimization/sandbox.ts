import { canonicalJson, jsonDigest, parseStrictJson, sha256 } from '@cirujano/core';

export const SANDBOX_ORIGIN = 'https://api.tokenfactory.nebius.com';
export const SANDBOX_PREFIX = '/sandboxes/v1/';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const STREAM_BYTES = 1024 * 1024;
const OPERATION_BYTES = 32 * 1024 * 1024;
const PAYLOAD_BYTES = 16 * 1024 * 1024;
const REQUEST_BYTES = 24 * 1024 * 1024;
const LINEAGE_STEPS = 64;
/** Built images pin every build operation, newest first, ending above the approved import. */
export function buildLineageValid(ids: unknown, importOperationId: string): ids is string[] { return Array.isArray(ids) && ids.length <= LINEAGE_STEPS && ids.every(id => typeof id === 'string' && UUID.test(id) && id !== importOperationId) && new Set(ids).size === ids.length; }
/** Directly imported images are digest-pinned; Sandbox-built images may name their base by tag and bind its digest through owner approval. */
export function imageReferenceValid(reference: string, ociDigest: string, built: boolean): boolean { return /^docker:\/\/[A-Za-z0-9./_:-]+(?:@sha256:[a-f0-9]{64})?$/.test(reference) && (reference.endsWith(`@sha256:${ociDigest}`) || (built && !reference.includes('@'))); }
const states = ['PENDING', 'ASSIGNED', 'EXECUTING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const;
export type SandboxStatus = typeof states[number];
export interface SandboxRecord { id: string; url: string; imageUuid: string; project: string; requestHash: string; createdAt: string }
export interface SandboxCreateIntent { schemaVersion: 1; kind: 'sandbox-intent'; attemptId: string; requestHash: string; payloadDigest: string; payloadFileUuid: string; imageUuid: string; project: string; createdAt: string }
export interface SandboxCreateResult { status: 'created' | 'failed' | 'outcome-unknown'; reasonCode: string; record: SandboxRecord | null }
export interface SandboxProcess { exitCode: number; signal: number; timedOut: boolean; stopped: boolean; continued: boolean; coreDump: boolean }
/** An allowlisted receipt. Raw metadata, credentials, stdin and streams are excluded. */
export interface SandboxObservedOperation { id: string; status: SandboxStatus; imageUuid: string; project: string; disposable: true; process: SandboxProcess | null; usage: { value: number; unit: 'undocumented-provider-unit'; currency: null } | null; createdAt: string | null; providerDuration: number | null; stdoutHash: string | null; stderrHash: string | null; stdoutTruncated: boolean | null; stderrTruncated: boolean | null }
export interface SandboxResult { status: 'observed' | 'terminal' | 'failed' | 'outcome-unknown'; reasonCode: string; operation: SandboxObservedOperation | null; stdout: string | null; stderr: string | null; retryAfterMs: number }
export interface SandboxImageProfile { image: { uuid: string; ociDigest: string; registryReference: string; importOperationId: string; buildOperationIds: string[]; harnessHash: string; manifestHash: string } }
export interface ImageReadbackReceipt { imageUuid: string; importOperationId: string; buildOperationIds: string[]; registryReference: string; approvedOciDigest: string; harnessHash: string; manifestHash: string; readAt: string }
export interface SandboxImageResult { status: 'verified' | 'failed'; reasonCode: string; receipt: ImageReadbackReceipt | null; harnessBytes: Uint8Array | null; manifestBytes: Uint8Array | null }
export interface SandboxClientOptions { iamToken: string; project: string; authorityDigest?: string; fetch?: typeof fetch; now?: () => number; sleep?: (milliseconds: number) => Promise<void>; deadlineMs?: number; pollIntervalMs?: number }
export interface SandboxClient {
  create(payload: unknown, imageUuid: string, maxLayerBytes: number, beforePost: (intent: SandboxCreateIntent) => Promise<void>, onCreated: (record: SandboxRecord) => Promise<void>, beforeUpload?: (payloadDigest: string) => Promise<void>): Promise<SandboxCreateResult>;
  read(record: SandboxRecord): Promise<SandboxResult>;
  poll(record: SandboxRecord): Promise<SandboxResult>;
  cancel(record: SandboxRecord, beforeDelete: (record: SandboxRecord) => Promise<void>): Promise<SandboxResult>;
  inspectImage(profile: SandboxImageProfile): Promise<SandboxImageResult>;
}
class SandboxError extends Error { constructor(readonly code: string) { super(code); } }
function invalid(): never { throw new SandboxError('sandbox-response-invalid'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function finite(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(); return value; }
function integer(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(); return value; }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function timestamp(value: unknown): string { if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) invalid(); return new Date(value).toISOString(); }
function nonempty(value: string): boolean { return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 8192 && !/[\u0000-\u001f\u007f]/.test(value); }
function operationUrl(id: string): string { if (!UUID.test(id)) invalid(); return `${SANDBOX_ORIGIN}${SANDBOX_PREFIX}operations/${id}`; }
function decodeRecord(record: SandboxRecord, project: string): void { if (!record || record.url !== operationUrl(record.id) || !UUID.test(record.imageUuid) || record.project !== project || !DIGEST.test(record.requestHash)) invalid(); timestamp(record.createdAt); }
function failure(reasonCode: string, operation: SandboxObservedOperation | null = null): SandboxResult { return { status: 'failed', reasonCode, operation, stdout: null, stderr: null, retryAfterMs: 0 }; }
function unknown(reasonCode: string): SandboxResult { return { status: 'outcome-unknown', reasonCode, operation: null, stdout: null, stderr: null, retryAfterMs: 0 }; }
function reason(error: unknown): string { return error instanceof SandboxError ? error.code : 'sandbox-transport-failed'; }
const requestFields = ['command', 'args', 'image', 'shell', 'disposable', 'preserve_env', 'networking', 'timeout', 'truncate_output_at', 'cwd', 'uid', 'resources_limits', 'env', 'stdin', 'files'] as const;
/** Instance requests are capped near 1 MiB, so the payload travels as an uploaded, digest-checked, read-only file. */
export const PAYLOAD_PATH = '/tmp/cirujano-payload.json';
/** Exact pure request identity shared by create and durable receipt validation. */
export function previewSandboxRequest(payload: unknown, imageUuid: string, maxLayerBytes: number, payloadFileUuid: string, authorityDigest = '0'.repeat(64)): { body: string; requestHash: string; payloadDigest: string } {
  if (!UUID.test(imageUuid) || !UUID.test(payloadFileUuid) || !Number.isSafeInteger(maxLayerBytes) || maxLayerBytes < 1 || maxLayerBytes > 1024 * 1024 * 1024 || !DIGEST.test(authorityDigest)) throw new SandboxError('sandbox-request-invalid');
  const serialized = canonicalJson(payload); if (Buffer.byteLength(serialized) > PAYLOAD_BYTES) throw new SandboxError('sandbox-payload-invalid');
  const payloadDigest = sha256(serialized);
  const body = canonicalJson({ command: '/usr/local/bin/node', args: ['/opt/cirujano/harness.mjs', PAYLOAD_PATH], image: imageUuid, shell: false, disposable: true, preserve_env: false, networking: { enabled: false }, timeout: 600, truncate_output_at: STREAM_BYTES, cwd: '/workspace', uid: 0, resources_limits: { max_layer_bytes: maxLayerBytes }, env: { npm_config_offline: 'true', npm_config_store_dir: '/opt/cirujano/store', HOME: '/workspace/.home', PATH: '/usr/local/bin:/usr/bin:/bin', CI: 'true', CIRUJANO_SANDBOX_AUTHORITY: authorityDigest, CIRUJANO_PAYLOAD_SHA256: payloadDigest }, stdin: { value: '', encoding: 'ascii', close: true }, files: { [PAYLOAD_PATH]: { uuid: payloadFileUuid, mode: '0400', uid: 0, gid: 0 } } });
  if (Buffer.byteLength(body) > REQUEST_BYTES) throw new SandboxError('sandbox-request-too-large');
  return { body, requestHash: sha256(body), payloadDigest };
}
function truncation(value: unknown): boolean | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const flag = (value as Record<string, unknown>).truncated; return typeof flag === 'boolean' ? flag : null;
}

/** No retrying side effects and no inference-credential fallback. */
export function createSandboxClient(options: SandboxClientOptions): SandboxClient {
  if (!nonempty(options.iamToken) || !nonempty(options.project)) throw new SandboxError('sandbox-credential-required');
  if (options.authorityDigest !== undefined && !DIGEST.test(options.authorityDigest)) throw new SandboxError('sandbox-options-invalid');
  const deadlineMs = options.deadlineMs ?? 660000, intervalMs = options.pollIntervalMs ?? 500;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 660000 || !Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 5000) throw new SandboxError('sandbox-options-invalid');
  const fetcher = options.fetch ?? fetch, now = options.now ?? Date.now;
  const sleep = options.sleep ?? (async ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const headers = { Authorization: `Bearer ${options.iamToken}`, Project: options.project, 'Content-Type': 'application/json' };
  function context(deadline = now() + deadlineMs) {
    const controller = new AbortController(), remaining = Math.min(deadlineMs, Math.max(0, deadline - now()));
    const timer = setTimeout(() => controller.abort(), remaining);
    function check() { if (controller.signal.aborted || now() >= deadline) throw new SandboxError('sandbox-deadline-exceeded'); }
    async function bounded<T>(operation: Promise<T>): Promise<T> {
      // A caller may already have started work before its deadline check fails.
      // Drain its eventual rejection even when we cannot wait for its result.
      try { check(); } catch (error) { void operation.catch(() => {}); throw error; }
      return new Promise<T>((resolve, reject) => {
        const abort = () => reject(new SandboxError('sandbox-deadline-exceeded'));
        controller.signal.addEventListener('abort', abort, { once: true });
        operation.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
      });
    }
    async function request(url: string, method: 'GET' | 'POST' | 'DELETE', body?: string | Uint8Array, contentType = 'application/json'): Promise<Response> {
      check(); const response = await bounded(fetcher(url, { method, headers: { ...headers, 'Content-Type': contentType }, ...(body === undefined ? {} : { body }), redirect: 'error', signal: controller.signal }));
      if (response.redirected) throw new SandboxError('sandbox-redirect-rejected'); return response;
    }
    async function bytes(response: Response, maximum: number): Promise<Buffer> {
      const length = response.headers.get('Content-Length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new SandboxError('sandbox-response-too-large');
      if (!response.body) invalid(); const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const chunk = await bounded(reader.read()); if (chunk.done) break; size += chunk.value.byteLength; if (size > maximum) throw new SandboxError('sandbox-response-too-large'); chunks.push(chunk.value); } return Buffer.concat(chunks); }
      finally { void reader.cancel().catch(() => {}); }
    }
    async function json(response: Response, maximum = OPERATION_BYTES): Promise<Record<string, unknown>> { return object(parseStrictJson(new TextDecoder('utf8', { fatal: true }).decode(await bytes(response, maximum)), maximum)); }
    return { deadline, check, bounded, request, bytes, json, close: () => { clearTimeout(timer); controller.abort(); } };
  }
  function stream(value: unknown): { text: string; hash: string } {
    const source = object(value); if (typeof source.value !== 'string' || source.truncated !== false) throw new SandboxError('sandbox-stream-incomplete');
    let bytes: Buffer;
    if (source.encoding === 'base64') {
      if (source.value.length > Math.ceil(STREAM_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source.value)) throw new SandboxError('sandbox-stream-encoding-invalid');
      bytes = Buffer.from(source.value, 'base64'); if (bytes.toString('base64') !== source.value) throw new SandboxError('sandbox-stream-encoding-invalid');
    } else if (source.encoding === 'ascii') { if (/[^\x00-\x7f]/.test(source.value)) throw new SandboxError('sandbox-stream-encoding-invalid'); bytes = Buffer.from(source.value, 'ascii'); }
    else throw new SandboxError('sandbox-stream-encoding-invalid');
    if (bytes.length > STREAM_BYTES) throw new SandboxError('sandbox-stream-too-large');
    return { text: new TextDecoder('utf8', { fatal: true }).decode(bytes), hash: sha256(bytes) };
  }
  async function readWithin(record: SandboxRecord, ctx: ReturnType<typeof context>): Promise<SandboxResult> {
    decodeRecord(record, options.project); const response = await ctx.request(record.url, 'GET');
    if (response.status !== 200) return failure(`sandbox-http-${response.status}`);
    const raw = await ctx.json(response), metadata = object(raw.metadata);
    if (raw.uuid !== record.id || raw.kind !== 'instance' || !states.includes(raw.status as SandboxStatus) || raw.image_uuid !== record.imageUuid || metadata.image !== record.imageUuid || metadata.disposable !== true || metadata.shell !== false || metadata.preserve_env !== false || object(metadata.networking).enabled !== false) invalid();
    if (requestFields.some(field => !Object.hasOwn(metadata, field)) || sha256(canonicalJson(Object.fromEntries(requestFields.map(field => [field, metadata[field]])))) !== record.requestHash) return failure('sandbox-request-readback-mismatch');
    if (object(metadata.env).CIRUJANO_SANDBOX_AUTHORITY !== (options.authorityDigest ?? '0'.repeat(64))) return failure('sandbox-request-readback-mismatch');
    ctx.check();
    const operation: SandboxObservedOperation = { id: record.id, status: raw.status as SandboxStatus, imageUuid: record.imageUuid, project: options.project, disposable: true, process: null, usage: null, createdAt: raw.created_at === undefined ? null : timestamp(raw.created_at), // The provider reports duration -1 until an operation finishes.
      providerDuration: raw.duration === undefined || raw.duration === null || raw.duration === -1 ? null : finite(raw.duration), stdoutHash: null, stderrHash: null, stdoutTruncated: null, stderrTruncated: null };
    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(operation.status) && metadata.result && typeof metadata.result === 'object' && !Array.isArray(metadata.result)) {
      const result = metadata.result as Record<string, unknown>; operation.stdoutTruncated = truncation(result.stdout); operation.stderrTruncated = truncation(result.stderr);
    }
    const retry = response.headers.get('Retry-After'); const retryAfterMs = retry !== null && /^\d{1,10}$/.test(retry) ? Math.max(1, Math.min(5000, Number(retry) * 1000)) : intervalMs;
    if (operation.status !== 'SUCCESS') return { status: 'observed', reasonCode: ['FAILED', 'CANCELLED'].includes(operation.status) ? 'sandbox-terminal-observed' : 'sandbox-running', operation, stdout: null, stderr: null, retryAfterMs };
    try {
      const result = object(metadata.result), state = object(result.state), resources = result.resources === undefined ? {} : object(result.resources);
      if (resources.cost !== undefined && resources.cost !== null) operation.usage = { value: finite(resources.cost), unit: 'undocumented-provider-unit', currency: null };
      operation.process = { exitCode: integer(state.exit_code), signal: integer(state.signal), timedOut: boolean(state.timed_out), stopped: boolean(state.stopped), continued: boolean(state.continued), coreDump: boolean(state.core_dump) };
      if (operation.process.exitCode !== 0 || operation.process.signal !== 0 || operation.process.timedOut || operation.process.stopped || operation.process.continued || operation.process.coreDump) return failure('sandbox-process-failed', operation);
      const stdout = stream(result.stdout), stderr = stream(result.stderr); operation.stdoutHash = stdout.hash; operation.stderrHash = stderr.hash;
      ctx.check();
      return { status: 'observed', reasonCode: 'sandbox-success-observed', operation, stdout: stdout.text, stderr: stderr.text, retryAfterMs };
    } catch (error) { return failure(reason(error), operation); }
  }
  async function pollWithin(record: SandboxRecord, ctx: ReturnType<typeof context>): Promise<SandboxResult> {
    for (let attempt = 0; attempt < 1321; attempt++) {
      ctx.check(); const result = await readWithin(record, ctx); if (result.status !== 'observed') return result;
      if (result.operation && ['SUCCESS', 'FAILED', 'CANCELLED'].includes(result.operation.status)) return { ...result, status: 'terminal' };
      const backoff = Math.min(5000, intervalMs * 2 ** Math.min(attempt, 4));
      const delay = Math.min(Math.max(backoff, result.retryAfterMs), 5000, Math.max(1, ctx.deadline - now())); await ctx.bounded(sleep(delay));
    }
    return unknown('sandbox-poll-limit');
  }
  return {
    async create(payload, imageUuid, maxLayerBytes, beforePost, onCreated, beforeUpload = async () => {}) {
      let sent = false, record: SandboxRecord | null = null; const ctx = context();
      try {
        if (typeof beforePost !== 'function' || typeof onCreated !== 'function' || typeof beforeUpload !== 'function') throw new SandboxError('sandbox-request-invalid');
        const serialized = canonicalJson(payload); if (Buffer.byteLength(serialized) > PAYLOAD_BYTES) throw new SandboxError('sandbox-payload-invalid');
        if (serialized.includes(options.iamToken)) throw new SandboxError('sandbox-payload-invalid');
        // Authority is consumed before any source byte leaves; the upload itself starts no instance.
        await ctx.bounded(beforeUpload(sha256(serialized)));
        const uploaded = await ctx.request(`${SANDBOX_ORIGIN}${SANDBOX_PREFIX}files`, 'POST', Buffer.from(serialized), 'application/octet-stream');
        if (uploaded.status !== 200 && uploaded.status !== 201) return { status: 'failed', reasonCode: `sandbox-upload-http-${uploaded.status}`, record: null };
        const file = await ctx.json(uploaded, 65536);
        if (typeof file.uuid !== 'string' || !UUID.test(file.uuid) || file.sha256 !== sha256(serialized) || file.size !== Buffer.byteLength(serialized)) throw new SandboxError('sandbox-upload-mismatch');
        const { body, requestHash, payloadDigest } = previewSandboxRequest(payload, imageUuid, maxLayerBytes, file.uuid, options.authorityDigest);
        const createdAt = new Date(now()).toISOString();
        await ctx.bounded(beforePost({ schemaVersion: 1, kind: 'sandbox-intent', attemptId: jsonDigest({ requestHash, payloadDigest, imageUuid, project: options.project }), requestHash, payloadDigest, payloadFileUuid: file.uuid, imageUuid, project: options.project, createdAt }));
        ctx.check(); sent = true; const response = await ctx.request(`${SANDBOX_ORIGIN}${SANDBOX_PREFIX}instances`, 'POST', body);
        if (response.status !== 201) return { status: response.status >= 400 && response.status < 500 ? 'failed' : 'outcome-unknown', reasonCode: `sandbox-http-${response.status}`, record: null };
        const location = response.headers.get('Location'); if (!location) throw new SandboxError('sandbox-location-invalid');
        const url = new URL(location, SANDBOX_ORIGIN), id = url.pathname.slice(`${SANDBOX_PREFIX}operations/`.length);
        if (url.origin !== SANDBOX_ORIGIN || url.username || url.password || url.search || url.hash || !UUID.test(id) || url.href !== operationUrl(id)) throw new SandboxError('sandbox-location-invalid');
        record = { id, url: url.href, imageUuid, project: options.project, requestHash, createdAt };
        await ctx.bounded(onCreated(record));
        const raw = await ctx.json(response); if (raw.uuid !== id || (raw.image !== undefined && raw.image !== imageUuid)) throw new SandboxError('sandbox-location-body-mismatch');
        return { status: 'created', reasonCode: 'sandbox-created', record };
      } catch (error) { return { status: sent ? 'outcome-unknown' : 'failed', reasonCode: reason(error), record }; } finally { ctx.close(); }
    },
    async read(record) { const ctx = context(); try { return await readWithin(record, ctx); } catch (error) { return reason(error) === 'sandbox-deadline-exceeded' ? unknown(reason(error)) : failure(reason(error)); } finally { ctx.close(); } },
    async poll(record) { const ctx = context(Math.min(now() + deadlineMs, Date.parse(record.createdAt) + deadlineMs)); try { return await pollWithin(record, ctx); } catch (error) { return unknown(reason(error)); } finally { ctx.close(); } },
    async cancel(record, beforeDelete) {
      const ctx = context(); let sent = false;
      try {
        decodeRecord(record, options.project); const current = await readWithin(record, ctx);
        if (!current.operation) return current.reasonCode === 'sandbox-request-readback-mismatch' ? current : unknown('sandbox-ownership-unconfirmed');
        if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(current.operation.status)) return { ...current, status: 'terminal' };
        if (current.status !== 'observed') return unknown('sandbox-ownership-unconfirmed');
        await ctx.bounded(beforeDelete(record)); ctx.check(); sent = true; const response = await ctx.request(record.url, 'DELETE'); if (response.status !== 202) return failure(`sandbox-cancel-http-${response.status}`); return await pollWithin(record, ctx);
      }
      catch (error) { return sent ? unknown(reason(error)) : failure(reason(error)); } finally { ctx.close(); }
    },
    async inspectImage(profile) {
      const ctx = context(); const failure = (reasonCode: string): SandboxImageResult => ({ status: 'failed', reasonCode, receipt: null, harnessBytes: null, manifestBytes: null });
      try {
        const image = profile.image;
        if (!UUID.test(image.importOperationId) || !buildLineageValid(image.buildOperationIds, image.importOperationId)) return failure('sandbox-image-profile-invalid');
        const built = image.buildOperationIds.length > 0;
        if (!UUID.test(image.uuid) || ![image.ociDigest, image.harnessHash, image.manifestHash].every(value => DIGEST.test(value)) || !imageReferenceValid(image.registryReference, image.ociDigest, built) || /[\u0000-\u0020\u007f]/.test(image.registryReference) || image.registryReference.includes(options.iamToken)) return failure('sandbox-image-profile-invalid');
        const registry = new URL(image.registryReference);
        if (registry.protocol !== 'docker:' || !registry.hostname || registry.username || registry.password || registry.search || registry.hash) return failure('sandbox-image-profile-invalid');
        const inspect = await ctx.request(`${SANDBOX_ORIGIN}${SANDBOX_PREFIX}inspect/${image.uuid}/`, 'GET'); if (inspect.status !== 200) return failure(`sandbox-image-http-${inspect.status}`);
        const metadata = await ctx.json(inspect, 65536); const chain = [...image.buildOperationIds, image.importOperationId];
        if (metadata.uuid !== image.uuid || metadata.operation_uuid !== chain[0]) return failure('sandbox-image-identity-mismatch');
        // A built image must chain through exactly the approved, successful, persisted build steps to the approved import.
        let current = image.uuid;
        for (const [index, operationId] of image.buildOperationIds.entries()) {
          const read = await ctx.request(operationUrl(operationId), 'GET'); if (read.status !== 200) return failure(`sandbox-build-http-${read.status}`);
          const build = await ctx.json(read), buildMetadata = object(build.metadata), state = object(object(buildMetadata.result).state);
          if (build.uuid !== operationId || build.kind !== 'instance' || build.status !== 'SUCCESS' || build.result_image_uuid !== current || buildMetadata.disposable !== false || state.exit_code !== 0 || typeof build.image_uuid !== 'string' || !UUID.test(build.image_uuid)) return failure('sandbox-image-lineage-invalid');
          current = build.image_uuid; const parent = await ctx.request(`${SANDBOX_ORIGIN}${SANDBOX_PREFIX}inspect/${current}/`, 'GET'); if (parent.status !== 200) return failure(`sandbox-image-http-${parent.status}`);
          const parentMetadata = await ctx.json(parent, 65536); if (parentMetadata.uuid !== current || parentMetadata.operation_uuid !== chain[index + 1]) return failure('sandbox-image-lineage-invalid');
        }
        const imported = await ctx.request(operationUrl(image.importOperationId), 'GET'); if (imported.status !== 200) return failure(`sandbox-import-http-${imported.status}`);
        const operation = await ctx.json(imported); if (operation.uuid !== image.importOperationId || operation.kind !== 'image_import' || operation.status !== 'SUCCESS' || object(operation.result).image !== current || object(object(operation.metadata).registry).url !== image.registryReference) return failure('sandbox-import-identity-mismatch');
        const download = async (path: string, maximum: number) => { const url = new URL(`${SANDBOX_ORIGIN}${SANDBOX_PREFIX}inspect/${image.uuid}/download`); url.searchParams.set('path', path); const response = await ctx.request(url.href, 'GET'); if (response.status !== 200) throw new SandboxError(`sandbox-image-file-http-${response.status}`); return ctx.bytes(response, maximum); };
        const harnessBytes = await download('/opt/cirujano/harness.mjs', 512 * 1024), manifestBytes = await download('/opt/cirujano/image.json', 65536);
        if (sha256(harnessBytes) !== image.harnessHash || sha256(manifestBytes) !== image.manifestHash) return failure('sandbox-image-bytes-mismatch');
        return { status: 'verified', reasonCode: 'sandbox-image-readback-verified', receipt: { imageUuid: image.uuid, importOperationId: image.importOperationId, buildOperationIds: [...image.buildOperationIds], registryReference: image.registryReference, approvedOciDigest: image.ociDigest, harnessHash: image.harnessHash, manifestHash: image.manifestHash, readAt: new Date(now()).toISOString() }, harnessBytes, manifestBytes };
      } catch (error) { return failure(reason(error)); } finally { ctx.close(); }
    },
  };
}
