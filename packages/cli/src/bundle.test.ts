import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

it('builds a standalone ESM CLI that starts without repository dependencies', async () => {
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  for (const dependency of ['core', 'runner']) {
    const dependencyBuild = spawnSync('pnpm', ['run', 'build'], {
      cwd: fileURLToPath(new URL(`../../${dependency}/`, import.meta.url)),
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(dependencyBuild.error).toBeUndefined();
    expect(dependencyBuild.status, dependencyBuild.stderr).toBe(0);
  }
  const build = spawnSync(process.execPath, ['scripts/bundle.mjs'], {
    cwd: packageRoot,
    env: {},
    encoding: 'utf8',
    timeout: 30_000,
  });
  expect(build.error).toBeUndefined();
  expect(build.status, build.stderr).toBe(0);

  const directory = await mkdtemp(join(tmpdir(), 'cirujano-standalone-cli-'));
  try {
    const standalonePath = join(directory, 'cirujano.mjs');
    await copyFile(join(packageRoot, 'dist/bin.js'), standalonePath);
    const result = spawnSync(process.execPath, [standalonePath, '--help'], {
      cwd: directory,
      env: {},
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('cirujano');
    expect(result.stdout).toContain('--help');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 90_000);
