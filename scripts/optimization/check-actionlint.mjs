import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createPnpmCachePatch, createSkipValidatedPushPatch, gitBlobSha, sha256 } from '../../packages/core/dist/index.js';

const execute = promisify(execFile);
const binary = process.env.CIRUJANO_ACTIONLINT_PATH ?? 'actionlint';
const limits = { timeout: 10000, maxBuffer: 65536 };
const version = await execute(binary, ['-version'], limits);
if (version.stdout.split('\n')[0] !== '1.7.12') throw new Error('This gate requires actionlint 1.7.12');
// actionlint silently skips shell checks when shellcheck is missing; the classifier's heredoc step needs them.
const shellcheck = process.env.CIRUJANO_SHELLCHECK_PATH ?? 'shellcheck';
await execute(shellcheck, ['--version'], limits).catch(() => { throw new Error('This gate requires shellcheck'); });
const fixtures = new URL('../../packages/core/fixtures/optimization/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', fixtures), 'utf8'));
// Synthetic parser fixtures cannot authorize external execution.
const provenance = manifest.provenance;
const receipt = JSON.parse(await readFile(new URL('setup-node-receipt.json', fixtures), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'cirujano-actionlint-'));
let checked = 0;
const lint = async (name, candidate) => {
  const path = join(directory, `${name}.yml`);
  await writeFile(path, candidate, { mode: 0o600 });
  await execute(binary, [`-shellcheck=${shellcheck}`, path], limits);
};
try {
  for (const entry of manifest.cases.filter(entry => entry.status === 'eligible')) {
    const source = await readFile(new URL(entry.file, fixtures), 'utf8');
    const result = createPnpmCachePatch(source, {
      provenance: { ...provenance, workflowHash: sha256(source), workflowBlobSha: gitBlobSha(source) },
      receipt, rootLockfile: true, timedBaseline: true, requiredChecks: ['test'], verificationProfilePresent: true,
    });
    await lint(entry.name, result.candidate);
    checked++;
  }
  // Every eligible push fixture, guarded; actionlint also runs shellcheck on the classifier's heredoc step.
  const push = new URL('push/', fixtures), pushManifest = JSON.parse(await readFile(new URL('manifest.json', push), 'utf8'));
  const pushCases = [...pushManifest.cases.filter(entry => entry.status === 'eligible'), { name: 'shapes', file: 'patch/shapes.yml', branch: 'develop' }];
  let guarded = 0;
  for (const entry of pushCases) {
    const source = await readFile(new URL(entry.file, push), 'utf8'), workflowPath = '.github/workflows/ci.yml';
    const result = createSkipValidatedPushPatch(source, { workflowHash: sha256(source), workflowPath, integrationBranch: entry.branch, inventory: [{ path: workflowPath, source }] });
    if (result.status !== 'proposed') throw new Error(`push fixture ${entry.name} was not guarded`);
    await lint(`push-${entry.name}`, result.candidate);
    guarded++;
  }
  if (guarded !== 3) throw new Error('push actionlint corpus drift');
  console.log(`actionlint 1.7.12 accepted ${checked} generated synthetic workflows and ${guarded} guarded push workflows`);
} finally { await rm(directory, { recursive: true, force: true }); }
