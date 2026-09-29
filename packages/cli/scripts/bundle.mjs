import { chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

import { build } from 'esbuild';

const toolSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: new URL('../../..', import.meta.url) }).trim();
if (!/^[a-f0-9]{40}$/u.test(toolSourceSha)) throw new Error('CLI build requires an exact source commit');

await build({
  entryPoints: ['src/bin.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Bundled CommonJS dependencies may require Node built-ins from ESM.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  outfile: 'dist/bin.js',
  sourcemap: false,
  legalComments: 'eof',
  define: { CIRUJANO_TOOL_SOURCE_SHA: JSON.stringify(toolSourceSha) },
});

await chmod('dist/bin.js', 0o755);
