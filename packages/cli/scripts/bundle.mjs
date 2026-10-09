import { chmod, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const toolSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: new URL('../../..', import.meta.url) }).trim();
if (!/^[a-f0-9]{40}$/u.test(toolSourceSha)) throw new Error('CLI build requires an exact source commit');
const harnessHash=createHash('sha256').update(await readFile(new URL('../../../scripts/optimization/harness.mjs',import.meta.url))).digest('hex');

// Every bundle: self-contained Node 22 ESM; bundled CommonJS dependencies may require Node built-ins from ESM.
const node22 = { bundle: true, platform: 'node', target: 'node22', format: 'esm', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, sourcemap: false, legalComments: 'eof' };

// The push-guard image's trusted harness: self-contained, committed, and hash-bound into the CLI.
const pushHarness = new URL('../../../scripts/optimization/push-guard-harness.mjs', import.meta.url);
await build({ ...node22, entryPoints: ['src/optimization/push-guard-harness-entry.ts'], outfile: fileURLToPath(pushHarness) });
const pushHarnessHash = createHash('sha256').update(await readFile(pushHarness)).digest('hex');

await build({ ...node22, entryPoints: ['src/bin.ts'], outfile: 'dist/bin.js', define: { CIRUJANO_TOOL_SOURCE_SHA: JSON.stringify(toolSourceSha), CIRUJANO_HARNESS_HASH: JSON.stringify(harnessHash), CIRUJANO_PUSH_HARNESS_HASH: JSON.stringify(pushHarnessHash) } });
await chmod('dist/bin.js', 0o755);

// The same owned reporter runs unchanged in baseline/candidate verification.
await build({ ...node22, entryPoints: ['src/optimization/quality-reporter-entry.ts'], outfile: 'dist/quality-reporter.mjs', define: { CIRUJANO_TOOL_SOURCE_SHA: JSON.stringify(toolSourceSha) } });
await chmod('dist/quality-reporter.mjs', 0o755);
