import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, sha256 } from '@cirujano/core';
import { createSandboxClient, type SandboxRecord } from './sandbox.js';
import { sandboxHttpFixture, sandboxImageUuid, sandboxOperationId, sandboxProject, sandboxOrigin, sandboxPrefix, operationFixture, imageProfile, harnessBytes, manifestBytes, requestFixture } from './sandbox.test-helper.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const payload = { schemaVersion: 1, kind: 'sandbox-payload', role: 'base', sourceDigest: 'a'.repeat(64) };
function record(): SandboxRecord { return { id: sandboxOperationId, url: `${sandboxOrigin}${sandboxPrefix}operations/${sandboxOperationId}`, imageUuid: sandboxImageUuid, project: sandboxProject, requestHash: sha256(canonicalJson(requestFixture())), createdAt: new Date().toISOString() }; }
async function fixture(handler?: Parameters<typeof sandboxHttpFixture>[0]) { const fixture = await sandboxHttpFixture(handler); cleanups.push(fixture.close); return fixture; }
describe('Sandbox fixed-origin transport', () => {
  it.each(['command', 'args', 'stdin', 'env', 'cwd', 'timeout', 'resources', 'output-cap'])('R4-2 rejects %s request identity drift even with successful quality output', async field => {
    const operation = operationFixture();
    if (field === 'command') operation.metadata.command = '/usr/local/bin/other';
    if (field === 'args') operation.metadata.args = ['/tmp/untrusted.mjs'];
    if (field === 'stdin') operation.metadata.stdin.value = Buffer.from('different payload').toString('base64');
    if (field === 'env') operation.metadata.env.CI = 'false';
    if (field === 'cwd') operation.metadata.cwd = '/other';
    if (field === 'timeout') operation.metadata.timeout = 601;
    if (field === 'resources') operation.metadata.resources_limits.max_layer_bytes = 2048;
    if (field === 'output-cap') operation.metadata.truncate_output_at = 2;
    const external = await fixture((_call, response) => response.end(JSON.stringify(operation)));
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).read(record());
    expect(result.status).toBe('failed'); expect(result.reasonCode).toBe('sandbox-request-readback-mismatch'); expect(result.operation).toBeNull();
  });
  it.each(['truncated', 'complete', 'unknown'])('R4-8 preserves %s stream truncation evidence without assuming flags', async flag => {
    const operation = operationFixture(); if (flag === 'truncated') operation.metadata.result.stdout.truncated = true;
    if (flag === 'unknown') delete (operation.metadata.result.stdout as { truncated?: unknown }).truncated;
    const external = await fixture((_call, response) => response.end(JSON.stringify(operation)));
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).read(record());
    expect(result.operation?.stdoutTruncated).toBe(flag === 'unknown' ? null : flag === 'truncated'); expect(result.operation?.stderrTruncated).toBe(false);
  });
  it('R4-5 refuses DELETE when the current operation no longer matches the recorded request', async () => {
    const operation = operationFixture('EXECUTING'); operation.metadata.command = '/tmp/other'; let authorizations = 0;
    const external = await fixture((_call, response) => response.end(JSON.stringify(operation)));
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).cancel(record(), async () => { authorizations++; });
    expect(result.status).toBe('failed'); expect(authorizations).toBe(0); expect(external.calls.map(call => call.method)).toEqual(['GET']);
  });
  it('R4-5 refuses another approval operation even when source and image match', async () => {
    const operation = operationFixture('EXECUTING'); operation.metadata.env.CIRUJANO_SANDBOX_AUTHORITY = 'f'.repeat(64); let authorizations = 0;
    const external = await fixture((_call, response) => response.end(JSON.stringify(operation)));
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).cancel(record(), async () => { authorizations++; });
    expect(result.status).toBe('failed'); expect(authorizations).toBe(0); expect(external.calls.map(call => call.method)).toEqual(['GET']);
  });
  it('R4-5 binds configured authority even when a foreign record hash is substituted consistently', async () => {
    const operation = operationFixture('EXECUTING'), request = requestFixture(); operation.metadata.env.CIRUJANO_SANDBOX_AUTHORITY = 'f'.repeat(64); request.env.CIRUJANO_SANDBOX_AUTHORITY = 'f'.repeat(64); let authorizations = 0;
    const external = await fixture((_call, response) => response.end(JSON.stringify(operation)));
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, authorityDigest: '0'.repeat(64), fetch: external.fetcher }).cancel({ ...record(), requestHash: sha256(canonicalJson(request)) }, async () => { authorizations++; });
    expect(result.status).toBe('failed'); expect(authorizations).toBe(0); expect(external.calls.map(call => call.method)).toEqual(['GET']);
  });
  it('R4-5 reads an already terminal owned operation without issuing DELETE', async () => {
    const external = await fixture(); let authorizations = 0;
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).cancel(record(), async () => { authorizations++; });
    expect(result.status).toBe('terminal'); expect(authorizations).toBe(0); expect(external.calls.map(call => call.method)).toEqual(['GET']);
  });
  it('R4-6 rejects trusted parent UID readback drift', async () => {
    const operation = operationFixture(); operation.metadata.uid = 1000;
    const external = await fixture((_call, response) => response.end(JSON.stringify(operation)));
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).read(record());
    expect(result.status).toBe('failed'); expect(result.reasonCode).toBe('sandbox-request-readback-mismatch');
  });
  it.each(['iam', 'project', 'deadline'])('rejects missing or invalid %s configuration', field => {
    expect(() => createSandboxClient({ iamToken: field === 'iam' ? '' : 'source-specific-iam', project: field === 'project' ? '' : sandboxProject, ...(field === 'deadline' ? { deadlineMs: 660001 } : {}) })).toThrow(field === 'deadline' ? 'sandbox-options-invalid' : 'sandbox-credential-required');
  });
  it.each([401, 403, 429, 503])('returns a sanitized GET HTTP %s failure without retry', async status => {
    const external = await fixture((_call, response) => { response.statusCode = status; response.end('provider body includes source-specific-iam'); });
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).read(record());
    expect(result.reasonCode).toBe(`sandbox-http-${status}`); expect(external.calls).toHaveLength(1); expect(JSON.stringify(result)).not.toContain('source-specific-iam');
  });
  it('rejects another project operation before any external GET or DELETE', async () => {
    const external = await fixture(), client = createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }); let authorizations = 0;
    expect((await client.read({ ...record(), project: 'other-project' })).status).toBe('failed');
    expect((await client.cancel({ ...record(), project: 'other-project' }, async () => { authorizations++; })).status).toBe('failed'); expect(authorizations).toBe(0); expect(external.calls).toHaveLength(0);
  });
  it('creates once with safe arguments and durable intent before POST', async () => {
    const external = await fixture(), order: string[] = [], client = createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher });
    const result = await client.create(payload, sandboxImageUuid, 1024, async intent => { expect(intent.requestHash).toMatch(/^[a-f0-9]{64}$/); expect(external.calls).toHaveLength(0); order.push('intent'); }, async created => { expect(created.id).toBe(sandboxOperationId); order.push('created'); });
    expect(result.status).toBe('created'); expect(order).toEqual(['intent', 'created']); expect(external.calls).toHaveLength(1);
    const call = external.calls[0]!, body = JSON.parse(call.body);
    expect(call.headers.authorization).toBe('Bearer source-specific-iam'); expect(call.headers.project).toBe(sandboxProject);
    expect(body).toMatchObject({ command: '/usr/local/bin/node', args: ['/opt/cirujano/harness.mjs'], image: sandboxImageUuid, shell: false, disposable: true, preserve_env: false, networking: { enabled: false }, timeout: 600, truncate_output_at: 1048576, cwd: '/workspace', uid: 0, resources_limits: { max_layer_bytes: 1024 }, stdin: { encoding: 'base64', close: true } });
    expect(JSON.stringify(body.env)).not.toContain('source-specific-iam'); expect(Buffer.from(body.stdin.value, 'base64').toString()).not.toContain('source-specific-iam');
  });
  it.each(['cross-origin', 'outside-prefix', 'uuid-mismatch', 'redirect', 'lost-response'])('never retries %s create outcome', async failure => {
    const external = await fixture((_call, response) => {
      if (failure === 'lost-response') return response.destroy();
      response.statusCode = failure === 'redirect' ? 302 : 201;
      response.setHeader('Location', failure === 'cross-origin' ? `https://attacker.example/operations/${sandboxOperationId}` : failure === 'outside-prefix' ? `/v1/operations/${sandboxOperationId}` : `${sandboxPrefix}operations/${sandboxOperationId}`);
      response.end(JSON.stringify({ uuid: failure === 'uuid-mismatch' ? sandboxImageUuid : sandboxOperationId }));
    });
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).create(payload, sandboxImageUuid, 1024, async () => {}, async () => {});
    expect(result.status).toBe('outcome-unknown'); expect(external.calls).toHaveLength(1);
  });
  it('retains known operation after onCreated persistence interruption', async () => {
    const external = await fixture(); const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).create(payload, sandboxImageUuid, 1024, async () => {}, async () => { throw new Error('disk interruption'); });
    expect(result.status).toBe('outcome-unknown'); expect(result.record?.id).toBe(sandboxOperationId); expect(external.calls).toHaveLength(1);
  });
  it.each(['malformed', 'stalled'])('journals trusted Location before reading %s response body', async mode => {
    let persisted = false;
    const external = await fixture((_call, response) => { response.statusCode = 201; response.setHeader('Location', `${sandboxPrefix}operations/${sandboxOperationId}`); if (mode === 'stalled') { response.flushHeaders(); response.write('{'); } else response.end('{malformed'); });
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher, deadlineMs: 50 }).create(payload, sandboxImageUuid, 1024, async () => {}, async () => { persisted = true; });
    expect(persisted).toBe(true); expect(result.status).toBe('outcome-unknown'); expect(result.record?.id).toBe(sandboxOperationId); expect(external.calls).toHaveLength(1);
  });
  it('blocks oversized stdin before intent or transport', async () => {
    const external = await fixture(); let intents = 0;
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).create({ text: 'x'.repeat(16 * 1024 * 1024) }, sandboxImageUuid, 1024, async () => { intents++; }, async () => {});
    expect(result.status).toBe('failed'); expect(intents).toBe(0); expect(external.calls).toHaveLength(0);
  });
  it('accepts complete disposable success without a resulting image and preserves unknown cost units', async () => {
    const external = await fixture(); const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).read(record());
    expect(result.status).toBe('observed'); expect(result.operation?.status).toBe('SUCCESS'); expect(result.stdout).toBe('{"kind":"harness-result"}'); expect(result.operation?.usage).toEqual({ value: 0.001, unit: 'undocumented-provider-unit', currency: null }); expect(JSON.stringify(result.operation)).not.toContain('harness-result');
  });
  it.each(['missing-state', 'missing-signal', 'wrong-image', 'truncated', 'missing-truncation', 'bad-base64', 'unknown-encoding', 'oversized-stream', 'bad-status', 'nonzero-exit', 'timed-out'])('rejects %s execution result', async failure => {
    const operation = operationFixture(); const result = operation.metadata.result;
    if (failure === 'missing-state') delete (result as { state?: unknown }).state;
    if (failure === 'missing-signal') delete (result.state as { signal?: unknown }).signal;
    if (failure === 'wrong-image') operation.image_uuid = sandboxOperationId;
    if (failure === 'truncated') result.stdout.truncated = true;
    if (failure === 'missing-truncation') delete (result.stdout as { truncated?: unknown }).truncated;
    if (failure === 'bad-base64') result.stdout.value = '!!!!';
    if (failure === 'unknown-encoding') result.stdout.encoding = 'utf8';
    if (failure === 'oversized-stream') result.stdout.value = Buffer.alloc(1048577).toString('base64');
    if (failure === 'bad-status') operation.status = 'DONE';
    if (failure === 'nonzero-exit') result.state.exit_code = 1;
    if (failure === 'timed-out') result.state.timed_out = true;
    const external = await fixture((_call, response) => { response.end(JSON.stringify(operation)); });
    const observed = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).read(record());
    expect(observed.status).toBe('failed'); expect(observed.stdout).toBeNull();
  });
  it('polls pending states with bounded Retry-After and exact terminal readback', async () => {
    let gets = 0; const delays: number[] = [], external = await fixture((_call, response) => { gets++; response.setHeader('Retry-After', '99999'); response.end(JSON.stringify(operationFixture(gets === 1 ? 'EXECUTING' : 'SUCCESS'))); });
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher, sleep: async ms => { delays.push(ms); } }).poll(record());
    expect(result.status).toBe('terminal'); expect(result.operation?.status).toBe('SUCCESS'); expect(gets).toBe(2); expect(delays[0]).toBeLessThanOrEqual(5000);
  });
  it('requires terminal GET after cancellation acceptance', async () => {
    let deletes = 0, gets = 0, authorized = false;
    const external = await fixture((call, response) => { if (call.method === 'DELETE') { expect(authorized).toBe(true); deletes++; response.statusCode = 202; response.end(); } else { gets++; response.end(JSON.stringify(operationFixture(deletes ? 'CANCELLED' : 'EXECUTING'))); } });
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).cancel(record(), async () => { authorized = true; });
    expect(result.status).toBe('terminal'); expect(result.operation?.status).toBe('CANCELLED'); expect(deletes).toBe(1); expect(gets).toBe(2);
  });
  it('does not equate cancel 202 plus continuing execution with cleanup', async () => {
    const external = await fixture((call, response) => { response.statusCode = call.method === 'DELETE' ? 202 : 200; response.end(call.method === 'DELETE' ? '' : JSON.stringify(operationFixture('EXECUTING'))); });
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher, deadlineMs: 20, pollIntervalMs: 1 }).cancel(record(), async () => {});
    expect(result.status).toBe('outcome-unknown'); expect(external.calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
  });
  it('drains a rejected fetch when the deadline expires while fetch is starting', async () => {
    let clock = 0, calls = 0;
    const fetcher: typeof fetch = () => { calls++; clock = 11; return Promise.reject(new DOMException('expired fixture request', 'AbortError')); };
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: fetcher, now: () => clock, deadlineMs: 10 }).read(record());
    expect(result.status).toBe('outcome-unknown'); expect(result.reasonCode).toBe('sandbox-deadline-exceeded'); expect(calls).toBe(1);
    await new Promise<void>(resolve => setImmediate(resolve));
  });
  it('bounds ignored-abort fetch and durable hooks', async () => {
    let posts = 0; const fetcher: typeof fetch = async (_url, init) => { if (init?.method === 'POST') posts++; return new Promise(() => {}); };
    const client = createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: fetcher, deadlineMs: 10 });
    expect((await client.create(payload, sandboxImageUuid, 1024, async () => {}, async () => {})).status).toBe('outcome-unknown'); expect(posts).toBe(1);
    expect((await client.create(payload, sandboxImageUuid, 1024, async () => new Promise(() => {}), async () => {})).status).toBe('failed'); expect(posts).toBe(1);
  }, 1000);
  it('reads UUID/import identity and exact trusted rootfs bytes without invented digest metadata', async () => {
    const external = await fixture(); const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).inspectImage(imageProfile);
    expect(result.status).toBe('verified'); expect(result.receipt?.imageUuid).toBe(sandboxImageUuid); expect(result.receipt?.registryReference).toBe(imageProfile.image.registryReference); expect(result.receipt).not.toHaveProperty('providerOciDigest'); expect(external.calls.every(call => call.method === 'GET')).toBe(true); expect(external.calls).toHaveLength(4);
  });
  it('rejects credential-bearing registry references before any readback', async () => {
    const external = await fixture(); const profile = { image: { ...imageProfile.image, registryReference: `docker://user:password@registry.example.test/cirujano@sha256:${'a'.repeat(64)}` } };
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).inspectImage(profile);
    expect(result.status).toBe('failed'); expect(external.calls).toHaveLength(0); expect(JSON.stringify(result)).not.toContain('password');
  });
  it.each(['wrong-uuid', 'wrong-import', 'mutable-reference', 'harness-drift', 'manifest-drift'])('blocks %s image readback', async failure => {
    const external = await fixture((call, response) => {
      if (call.path.endsWith(`${sandboxImageUuid}/`)) response.end(JSON.stringify({ uuid: failure === 'wrong-uuid' ? sandboxOperationId : sandboxImageUuid, operation_uuid: failure === 'wrong-import' ? sandboxOperationId : imageProfile.image.importOperationId }));
      else if (call.path.includes('/operations/')) response.end(JSON.stringify({ uuid: imageProfile.image.importOperationId, kind: 'image_import', status: 'SUCCESS', metadata: { registry: { url: failure === 'mutable-reference' ? 'docker://registry.example.test/image:latest' : imageProfile.image.registryReference } }, result: { image: sandboxImageUuid } }));
      else { const harness = new URL(call.path, sandboxOrigin).searchParams.get('path') === '/opt/cirujano/harness.mjs'; response.end((harness && failure === 'harness-drift') || (!harness && failure === 'manifest-drift') ? 'altered bytes' : harness ? harnessBytes : manifestBytes); }
    });
    const result = await createSandboxClient({ iamToken: 'source-specific-iam', project: sandboxProject, fetch: external.fetcher }).inspectImage(imageProfile);
    expect(result.status).toBe('failed'); expect(result.receipt).toBeNull();
  });
});
