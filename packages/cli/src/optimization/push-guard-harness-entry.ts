import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, decodePushGuardPayload, NULL_BODY_STATUSES, parseStrictJson, sha256, verifyPushGuards, type ClassifierCase } from '@cirujano/core';

/**
 * The trusted, offline push-guard harness (Phase 5). Bundled to `scripts/optimization/push-guard-harness.mjs`
 * and installed in the push-guard image as `/opt/cirujano/harness.mjs`, it reads the uploaded payload,
 * runs `verifyPushGuards`, and runs every classifier case through the candidate's embedded step script.
 */
/** Must equal `PAYLOAD_PATH` in sandbox.ts, where the request mounts the payload (pinned by a test). */
export const PAYLOAD_PATH = '/tmp/cirujano-payload.json';
/** All cases share one budget well inside the Sandbox's 600 s request timeout, so a stall is a named failure. */
const CASES_BUDGET_MS = 500_000;
const PAYLOAD_BYTES = 16 * 1024 * 1024, RESULT_BYTES = 1024 * 1024, CASE_TIMEOUT_MS = 30_000, OUTPUT_BYTES = 4096;
/** Under root (the Sandbox), each case runs as nobody, as the cache harness's commands do. */
const CHILD = process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
/** Loaded with `--import` before the step script: GitHub answers come only from the case, never the network. */
const FETCH_STUB = `import { readFileSync } from 'node:fs';
const responses = JSON.parse(readFileSync(process.env.CIRUJANO_CASE_RESPONSES, 'utf8'));
globalThis.fetch = async url => {
  const response = responses[String(url).replace('https://api.github.com/', '')];
  if (!response) return new Response('{"message":"Not Found"}', { status: 404 });
  if (response.error) throw response.error === 'TimeoutError' ? new DOMException('timed out', 'TimeoutError') : new TypeError('fetch failed');
  return new Response(${JSON.stringify(NULL_BODY_STATUSES)}.includes(response.status) ? null : response.body, { status: response.status });
};
`;
function fail(code: string): never { throw new Error(code); }

/** One case through the step script exactly as the workflow runs it: `node --input-type=module` reading stdin. */
export async function runClassifierCase(script: string, testCase: ClassifierCase, timeoutMs = CASE_TIMEOUT_MS): Promise<{ validated: boolean; reasonCode: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'cirujano-classifier-case-'));
  try {
    const paths = { stub: join(directory, 'stub.mjs'), responses: join(directory, 'responses.json'), event: join(directory, 'event.json'), output: join(directory, 'output') };
    await writeFile(paths.stub, FETCH_STUB); await writeFile(paths.responses, JSON.stringify(testCase.responses)); await writeFile(paths.event, testCase.event); await writeFile(paths.output, '');
    await chmod(directory, 0o755); for (const path of [paths.stub, paths.responses, paths.event]) await chmod(path, 0o444); await chmod(paths.output, 0o666);
    await new Promise<void>(resolveRun => {
      const child = spawn(process.execPath, ['--import', pathToFileURL(paths.stub).href, '--input-type=module'], { env: { ...testCase.env, PATH: '/usr/local/bin:/usr/bin:/bin', GITHUB_EVENT_PATH: paths.event, GITHUB_OUTPUT: paths.output, CIRUJANO_CASE_RESPONSES: paths.responses }, stdio: ['pipe', 'ignore', 'ignore'], timeout: timeoutMs, killSignal: 'SIGKILL', ...CHILD });
      child.on('error', () => resolveRun()); child.on('close', () => resolveRun());
      child.stdin.on('error', () => {}); child.stdin.end(script);
    });
    const handle = await open(paths.output, constants.O_RDONLY | constants.O_NOFOLLOW), buffer = Buffer.alloc(OUTPUT_BYTES + 1);
    let read: number;
    try { ({ bytesRead: read } = await handle.read(buffer, 0, buffer.length, 0)); } finally { await handle.close(); }
    const match = read > OUTPUT_BYTES ? null : /^validated=(true|false)\nreason=([a-z0-9-]+)\n$/.exec(buffer.subarray(0, read).toString('utf8'));
    return match ? { validated: match[1] === 'true', reasonCode: match[2]! } : { validated: false, reasonCode: 'no-classifier-output' };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** The provider attaches the payload read-only at one fixed path; its digest travels separately in the request. */
export async function runPushGuardHarness(path: string, expectedDigest: string | undefined, allowedPath = PAYLOAD_PATH): Promise<string> {
  if (path !== allowedPath) fail('push-harness-payload-path');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > PAYLOAD_BYTES) fail('push-harness-payload-size'); bytes = await handle.readFile(); } finally { await handle.close(); }
  if (typeof expectedDigest !== 'string' || sha256(bytes) !== expectedDigest) fail('push-harness-payload-digest');
  const deadline = Date.now() + CASES_BUDGET_MS;
  const result = await verifyPushGuards(decodePushGuardPayload(parseStrictJson(bytes.toString('utf8'), PAYLOAD_BYTES)), async (script, testCase) => {
    const remaining = deadline - Date.now();
    return remaining <= 0 ? { validated: false, reasonCode: 'harness-deadline' } : runClassifierCase(script, testCase, Math.min(CASE_TIMEOUT_MS, remaining));
  });
  const output = `${canonicalJson(result)}\n`;
  if (Buffer.byteLength(output) > RESULT_BYTES) fail('push-harness-result-size');
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(await runPushGuardHarness(process.argv[2] ?? '', process.env['CIRUJANO_PAYLOAD_SHA256'])); }
  catch (error) { process.stderr.write(`${error instanceof Error && /^push-harness-[a-z-]+$/.test(error.message) ? error.message : 'push-harness-failed'}\n`); process.exitCode = 1; }
}
