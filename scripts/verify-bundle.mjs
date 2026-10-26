import { execFileSync } from 'node:child_process';

/** Generated files committed with their sources: the Action bundle and the push-guard image harness. */
const BUNDLES = ['packages/action/dist/index.cjs', 'scripts/optimization/push-guard-harness.mjs'];

for (const bundle of BUNDLES) {
  const changed = execFileSync('git', ['status', '--porcelain', '--', bundle], { encoding: 'utf8' }).trim();
  if (changed) {
    process.stderr.write(
      `[FAIL] ${bundle} is stale: the committed bundle does not match the current source.\n`
      + `       Run \`pnpm run build\` and commit ${bundle} together with the source change.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`[PASS] ${bundle} matches the current source.\n`);
}
