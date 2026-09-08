import { execFileSync } from 'node:child_process';

const BUNDLE = 'packages/action/dist/index.cjs';

const changed = execFileSync('git', ['status', '--porcelain', '--', BUNDLE], { encoding: 'utf8' }).trim();
if (changed) {
  process.stderr.write(
    `[FAIL] ${BUNDLE} is stale: the committed Action bundle does not match the current source.\n`
    + `       Run \`pnpm run build\` and commit ${BUNDLE} together with the source change.\n`,
  );
  process.exit(1);
}
process.stdout.write(`[PASS] ${BUNDLE} matches the current source.\n`);
