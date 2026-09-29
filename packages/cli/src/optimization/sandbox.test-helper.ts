import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { canonicalJson, sha256 } from '@cirujano/core';

export const sandboxImageUuid = '12345678-1234-4234-8234-123456789abc';
export const sandboxOperationId = '87654321-4321-4321-8321-cba987654321';
export const importOperationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const sandboxProject = 'owner-project';
export const sandboxOrigin = 'https://api.tokenfactory.nebius.com';
export const sandboxPrefix = '/sandboxes/v1/';
export const harnessBytes = Buffer.from('trusted harness fixture');
export const manifestBytes = Buffer.from('{"schemaVersion":1,"kind":"optimization-image"}');
export const imageProfile = { image: { uuid: sandboxImageUuid, ociDigest: 'a'.repeat(64), registryReference: `docker://registry.example.test/cirujano@sha256:${'a'.repeat(64)}`, importOperationId, harnessHash: sha256(harnessBytes), manifestHash: sha256(manifestBytes) } };
export function requestFixture() {
  return { command: '/usr/local/bin/node', args: ['/opt/cirujano/harness.mjs'], image: sandboxImageUuid, shell: false, disposable: true, preserve_env: false, networking: { enabled: false }, timeout: 600, truncate_output_at: 1048576, cwd: '/workspace', uid: 0, resources_limits: { max_layer_bytes: 1024 }, env: { PNPM_CONFIG_OFFLINE: 'true', PNPM_CONFIG_STORE_DIR: '/opt/cirujano/store', HOME: '/workspace/.home', PATH: '/usr/local/bin:/usr/bin:/bin', CI: 'true', CIRUJANO_SANDBOX_AUTHORITY: '0'.repeat(64) }, stdin: { value: Buffer.from(canonicalJson({ schemaVersion: 1, kind: 'sandbox-payload', role: 'base', sourceDigest: 'a'.repeat(64) })).toString('base64'), encoding: 'base64', close: true } };
}
export function operationFixture(status = 'SUCCESS') {
  return { uuid: sandboxOperationId, kind: 'instance', status, error: null, created_at: '2026-09-29T10:00:00Z', duration: 1, image_uuid: sandboxImageUuid, result_image_uuid: null, metadata: { ...requestFixture(), result: { state: { exit_code: 0, signal: 0, timed_out: false, stopped: false, continued: false, core_dump: false, pid: 1 }, stdout: { value: Buffer.from('{"kind":"harness-result"}').toString('base64'), encoding: 'base64', truncated: false }, stderr: { value: '', encoding: 'ascii', truncated: false }, resources: { cost: 0.001, elapsed_time: 1 } } }, result: { image: null, tag: null } };
}
export interface FixtureCall { path: string; method: string; headers: IncomingMessage['headers']; body: string }
export async function sandboxHttpFixture(handler?: (call: FixtureCall, response: ServerResponse) => void) {
  const calls: FixtureCall[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const call = { path: request.url ?? '', method: request.method ?? '', headers: request.headers, body: Buffer.concat(chunks).toString('utf8') }; calls.push(call);
    if (handler) return handler(call, response);
    response.setHeader('Content-Type', 'application/json');
    if (call.method === 'POST') { response.statusCode = 201; response.setHeader('Location', `${sandboxPrefix}operations/${sandboxOperationId}`); response.end(JSON.stringify({ uuid: sandboxOperationId, image: sandboxImageUuid })); }
    else if (call.method === 'DELETE') { response.statusCode = 202; response.end(); }
    else if (call.path === `${sandboxPrefix}inspect/${sandboxImageUuid}/`) response.end(JSON.stringify({ uuid: sandboxImageUuid, tag: null, created_at: '2026-09-29T10:00:00Z', operation_uuid: importOperationId }));
    else if (call.path === `${sandboxPrefix}operations/${importOperationId}`) response.end(JSON.stringify({ uuid: importOperationId, kind: 'image_import', status: 'SUCCESS', metadata: { registry: { url: imageProfile.image.registryReference } }, result: { image: sandboxImageUuid } }));
    else if (call.path.startsWith(`${sandboxPrefix}inspect/${sandboxImageUuid}/download?`)) { response.setHeader('Content-Type', 'application/octet-stream'); response.end(new URL(call.path, sandboxOrigin).searchParams.get('path') === '/opt/cirujano/harness.mjs' ? harnessBytes : manifestBytes); }
    else response.end(JSON.stringify(operationFixture()));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture address unavailable');
  const logicalCalls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => { const url = new URL(String(input)); logicalCalls.push(url.toString()); if (url.origin !== sandboxOrigin || !url.pathname.startsWith(sandboxPrefix)) throw new Error('wrong logical API destination'); return fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init); };
  return { calls, logicalCalls, fetcher, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
