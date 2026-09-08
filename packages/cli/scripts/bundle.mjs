import { chmod } from 'node:fs/promises';

import { build } from 'esbuild';

await build({
  entryPoints: ['src/bin.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/bin.js',
  sourcemap: false,
  legalComments: 'eof',
});

await chmod('dist/bin.js', 0o755);
