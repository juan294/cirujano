import { canonicalJson, jsonDigest, OptimizationInputError, parseStrictJson, sha256, type InferenceArtifact, type InputArtifact } from '@cirujano/core';

export const DEFAULT_INFERENCE_MODEL = 'nvidia/nvidia-nemotron-3-nano-30b-a3b';
export const DEFAULT_INFERENCE_ENDPOINT = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_COMPLETION_TOKENS = 2048;
const MAX_RESPONSE_BYTES = 256 * 1024;
export interface InferenceConfig { schemaVersion: 1; model: string; endpoint: string }
export interface InferencePriceBasis { quoteIdentity: string; quotedAt: string; source: string; currency: 'USD'; inputUsdPerMillion: number; outputUsdPerMillion: number; maxCostUsd: number }
export interface InferencePermit { schemaVersion: 1; kind: 'inference-permit'; permitId: string; repositoryId: number; inputDigest: string; model: string; endpoint: string; expiresAt: string; maxRequests: 1; maxCompletionTokens: 2048; priceBasis: InferencePriceBasis | null }
export interface InferenceIntent { schemaVersion: 1; kind: 'inference-intent'; attemptId: string; permitId: string; permitDigest: string; inputDigest: string; requestHash: string; requestBytes: number; model: string; endpoint: string; startedAt: string }
export interface InferenceTransportOptions { fetch?: typeof fetch; apiKey: string; beforePost: (intent: InferenceIntent) => Promise<void>; now?: () => Date; timeoutMs?: number }
export interface InferenceTransportResult { reasonCode: string; inference: InferenceArtifact; content: string | null }

function invalid(): never { throw new OptimizationInputError('Invalid inference configuration or permit'); }
function record(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (keys && (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)))) invalid();
  return result;
}
function boundedText(value: unknown): string { if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024 || /[\u0000-\u001f\u007f]/.test(value)) invalid(); return value; }
function timestamp(value: unknown): string { const text = boundedText(value); if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().replace('.000Z', 'Z') !== text.replace('.000Z', 'Z')) invalid(); return text; }
function amount(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(); return value; }
export function decodeInferenceConfig(value: unknown): InferenceConfig {
  canonicalJson(value); const config = record(value, ['schemaVersion', 'model', 'endpoint']);
  if (config.schemaVersion !== 1 || !/^nvidia\/[A-Za-z0-9_.-]+$/.test(boundedText(config.model)) || config.endpoint !== DEFAULT_INFERENCE_ENDPOINT) invalid();
  return value as InferenceConfig;
}
export function decodeInferencePermit(value: unknown): InferencePermit {
  canonicalJson(value); const permit = record(value, ['schemaVersion', 'kind', 'permitId', 'repositoryId', 'inputDigest', 'model', 'endpoint', 'expiresAt', 'maxRequests', 'maxCompletionTokens', 'priceBasis']);
  decodeInferenceConfig({ schemaVersion: permit.schemaVersion, model: permit.model, endpoint: permit.endpoint });
  if (permit.kind !== 'inference-permit' || !Number.isSafeInteger(permit.repositoryId) || Number(permit.repositoryId) <= 0 || !/^[a-f0-9]{64}$/.test(boundedText(permit.inputDigest)) || permit.maxRequests !== 1 || permit.maxCompletionTokens !== MAX_COMPLETION_TOKENS || !/^[A-Za-z0-9_-]{1,128}$/.test(boundedText(permit.permitId))) invalid();
  timestamp(permit.expiresAt);
  if (permit.priceBasis !== null) {
    const price = record(permit.priceBasis, ['quoteIdentity', 'quotedAt', 'source', 'currency', 'inputUsdPerMillion', 'outputUsdPerMillion', 'maxCostUsd']);
    boundedText(price.quoteIdentity); timestamp(price.quotedAt);
    const url = new URL(boundedText(price.source)); if (url.protocol !== 'https:' || url.username || url.password || price.currency !== 'USD') invalid();
    amount(price.inputUsdPerMillion); amount(price.outputUsdPerMillion); amount(price.maxCostUsd);
  }
  return value as InferencePermit;
}
export function assertInferenceAuthority(permit: InferencePermit, config: InferenceConfig, input: InputArtifact, requestBytes: number, now: Date): void {
  if (permit.repositoryId !== input.provenance.repositoryId || permit.inputDigest !== jsonDigest(input) || permit.model !== config.model || permit.endpoint !== config.endpoint || Date.parse(permit.expiresAt) <= now.getTime()) invalid();
  if (permit.priceBasis) {
    if (Date.parse(permit.priceBasis.quotedAt) > now.getTime()) invalid();
    // One token cannot exceed one UTF-8 byte of the submitted text. Reserve the
    // complete serialized request rather than estimating from language averages.
    const reservation = (requestBytes * permit.priceBasis.inputUsdPerMillion + MAX_COMPLETION_TOKENS * permit.priceBasis.outputUsdPerMillion) / 1_000_000;
    if (!Number.isFinite(reservation) || reservation > permit.priceBasis.maxCostUsd) invalid();
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) invalid();
  if (!response.body) invalid();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > MAX_RESPONSE_BYTES) invalid(); chunks.push(chunk.value); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function beforeDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Inference deadline exceeded'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function usage(value: unknown): InferenceArtifact['usage'] {
  if (value === undefined || value === null) return null;
  const counters = record(value); const promptTokens = amount(counters.prompt_tokens), completionTokens = amount(counters.completion_tokens), totalTokens = amount(counters.total_tokens);
  if (![promptTokens, completionTokens, totalTokens].every(Number.isSafeInteger) || totalTokens !== promptTokens + completionTokens || completionTokens > MAX_COMPLETION_TOKENS) invalid();
  return { promptTokens, completionTokens, totalTokens };
}

/** One explicitly authorized inference attempt. No request or provider body is returned. */
export async function requestInference(input: InputArtifact, config: InferenceConfig, permit: InferencePermit, body: string, options: InferenceTransportOptions): Promise<InferenceTransportResult> {
  const now = options.now ?? (() => new Date()); const startedAt = now().toISOString(); const requestHash = sha256(body);
  const fetcher = options.fetch ?? fetch; const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) invalid();
  const timer = setTimeout(() => controller.abort(), timeoutMs); let sent = false;
  const inference: InferenceArtifact = { schemaVersion: 1, kind: 'inference', provenance: input.provenance, requestedModel: config.model, returnedModel: null, endpointHost: new URL(config.endpoint).hostname, completionId: null, requestHash, responseHash: null, startedAt, completedAt: startedAt, latencyMs: 0, finishReason: null, usage: null, quoteIdentity: permit.priceBasis?.quoteIdentity ?? null, costStatus: 'unavailable', cost: null, status: 'failed' };
  function result(reasonCode: string, content: string | null = null): InferenceTransportResult { inference.completedAt = now().toISOString(); inference.latencyMs = Date.parse(inference.completedAt) - Date.parse(startedAt); return { reasonCode, inference, content }; }
  try {
    const headers = { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' };
    const models = await beforeDeadline(fetcher(new URL('/v1/models', config.endpoint), { method: 'GET', headers, redirect: 'error', signal: controller.signal }), controller.signal);
    if (!models.ok || models.redirected) return result('model-availability-failed');
    const available = record(parseStrictJson(await beforeDeadline(readBoundedResponse(models), controller.signal)));
    if (!Array.isArray(available.data) || available.data.length > 1000 || !available.data.some(entry => record(entry).id === config.model)) return result('model-unavailable');
    assertInferenceAuthority(permit, config, input, Buffer.byteLength(body), now());
    const permitDigest = jsonDigest(permit), inputDigest = jsonDigest(input);
    await beforeDeadline(options.beforePost({ schemaVersion: 1, kind: 'inference-intent', attemptId: jsonDigest({ permitDigest, inputDigest, requestHash }), permitId: permit.permitId, permitDigest, inputDigest, requestHash, requestBytes: Buffer.byteLength(body), model: config.model, endpoint: config.endpoint, startedAt }), controller.signal);
    assertInferenceAuthority(permit, config, input, Buffer.byteLength(body), now());
    if (controller.signal.aborted) return result('provider-deadline-before-post');
    sent = true;
    const response = await beforeDeadline(fetcher(config.endpoint, { method: 'POST', headers, body, redirect: 'error', signal: controller.signal }), controller.signal);
    if (!response.ok || response.redirected) return result(`provider-http-${response.status}`);
    let raw: string;
    try { raw = await beforeDeadline(readBoundedResponse(response), controller.signal); } catch { if (controller.signal.aborted) throw new Error('deadline'); return result('invalid-provider-response'); }
    inference.responseHash = sha256(raw);
    let envelope: Record<string, unknown>;
    try { envelope = record(parseStrictJson(raw)); } catch { return result('invalid-provider-response'); }
    try {
      if (envelope.model !== config.model) return result('returned-model-mismatch');
      inference.returnedModel = config.model;
      const completionId = boundedText(envelope.id);
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(completionId) || completionId.includes(options.apiKey)) invalid();
      inference.completionId = completionId;
      if (!Array.isArray(envelope.choices) || envelope.choices.length !== 1) invalid();
      const choice = record(envelope.choices[0]), message = record(choice.message);
      const finishReason = boundedText(choice.finish_reason);
      if (!['stop', 'length', 'tool_calls', 'function_call', 'content_filter'].includes(finishReason)) invalid();
      inference.finishReason = finishReason; inference.usage = usage(envelope.usage);
      if (message.refusal !== undefined && message.refusal !== null && message.refusal !== '') return result('model-refusal');
      if (choice.finish_reason !== 'stop') return result('model-truncated');
      if (typeof message.content !== 'string' || !message.content || message.role !== 'assistant') invalid();
      if (inference.usage && permit.priceBasis) {
        const amount = (inference.usage.promptTokens * permit.priceBasis.inputUsdPerMillion + inference.usage.completionTokens * permit.priceBasis.outputUsdPerMillion) / 1_000_000;
        if (!Number.isFinite(amount) || amount > permit.priceBasis.maxCostUsd) invalid();
        inference.cost = { amount, currency: 'USD' }; inference.costStatus = 'known';
      }
      inference.status = 'completed'; return result('inference-completed', message.content);
    } catch { return result('invalid-provider-response'); }
  } catch {
    if (sent) { inference.status = 'outcome-unknown'; inference.costStatus = 'unknown'; return result('provider-outcome-unknown'); }
    return result('inference-preflight-failed');
  } finally { clearTimeout(timer); }
}
