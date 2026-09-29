import { chmod } from 'node:fs/promises';

import { build } from 'esbuild';

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
});

await chmod('dist/bin.js', 0o755);
