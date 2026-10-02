import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createPnpmCachePatch, gitBlobSha, sha256 } from '../../packages/core/dist/index.js';

const execute = promisify(execFile);
const binary = process.env.CIRUJANO_ACTIONLINT_PATH ?? 'actionlint';
const version = await execute(binary, ['-version'], { timeout: 10000, maxBuffer: 65536 });
if (version.stdout.split('\n')[0] !== '1.7.12') throw new Error('This gate requires actionlint 1.7.12');
const fixtures = new URL('../../packages/core/fixtures/optimization/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', fixtures), 'utf8'));
// Synthetic parser fixtures cannot authorize external execution.
const provenance = manifest.provenance;
const receipt = JSON.parse(await readFile(new URL('setup-node-receipt.json', fixtures), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'cirujano-actionlint-'));
let checked = 0;
try {
  for (const entry of manifest.cases.filter(entry => entry.status === 'eligible')) {
    const source = await readFile(new URL(entry.file, fixtures), 'utf8');
    const result = createPnpmCachePatch(source, {
      provenance: { ...provenance, workflowHash: sha256(source), workflowBlobSha: gitBlobSha(source) },
      receipt, rootLockfile: true, timedBaseline: true, requiredChecks: ['test'], verificationProfilePresent: true,
    });
    const path = join(directory, `${entry.name}.yml`);
    await writeFile(path, result.candidate, { mode: 0o600 });
    await execute(binary, [path], { timeout: 10000, maxBuffer: 65536 });
    checked++;
  }
  console.log(`actionlint 1.7.12 accepted ${checked} generated synthetic workflows`);
} finally { await rm(directory, { recursive: true, force: true }); }
