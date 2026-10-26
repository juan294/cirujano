import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const resolver = resolve(root, 'scripts/resolve-actions-runner-release.mjs');
const fixture = resolve(root, 'packages/cli/fixtures/actions-runner-release.fixture.json');
const execFile = promisify(execFileCallback);
const sha = '08e9ccb3604d2462c24b5e33604dc30810296ca15cc65f23cffd4317eb144c37';

// The resolver never reaches GitHub in tests: CIRUJANO_ACTIONS_RUNNER_RELEASE_JSON stands in for the
// latest-release response, and an unreadable path proves a code path did not consult it.
function run(environment: Record<string, string>) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
  for (const key of ['CIRUJANO_ACTIONS_RUNNER_VERSION', 'CIRUJANO_ACTIONS_RUNNER_SHA256', 'GITHUB_TOKEN', 'GH_TOKEN']) delete env[key];
  return execFile(process.execPath, [resolver], { env: { ...env, ...environment }, timeout: 10_000 });
}

async function releaseFile(release: unknown) {
  const path = resolve(await mkdtemp(resolve(tmpdir(), 'cirujano-runner-release-')), 'release.json');
  await writeFile(path, JSON.stringify(release));
  return path;
}

describe('resolve-actions-runner-release', () => {
  it('takes the latest release version and the linux-x64 archive digest GitHub publishes', async () => {
    const { stdout, stderr } = await run({ CIRUJANO_ACTIONS_RUNNER_RELEASE_JSON: fixture });
    expect(stdout).toBe(`CIRUJANO_ACTIONS_RUNNER_VERSION=2.338.1\nCIRUJANO_ACTIONS_RUNNER_SHA256=${sha}\n`);
    expect(stderr).toContain('2.338.1');
    expect(stderr).toContain(fixture);
  });

  it('honors an explicit pin without consulting the release', async () => {
    const { stdout, stderr } = await run({
      CIRUJANO_ACTIONS_RUNNER_RELEASE_JSON: '/nonexistent/release.json',
      CIRUJANO_ACTIONS_RUNNER_VERSION: '2.337.0',
      CIRUJANO_ACTIONS_RUNNER_SHA256: 'a'.repeat(64),
    });
    expect(stdout).toBe(`CIRUJANO_ACTIONS_RUNNER_VERSION=2.337.0\nCIRUJANO_ACTIONS_RUNNER_SHA256=${'a'.repeat(64)}\n`);
    expect(stderr).toContain('pinned');
  });

  it('refuses a half pin and malformed pins', async () => {
    await expect(run({ CIRUJANO_ACTIONS_RUNNER_RELEASE_JSON: fixture, CIRUJANO_ACTIONS_RUNNER_VERSION: '2.337.0' }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('set together') });
    await expect(run({ CIRUJANO_ACTIONS_RUNNER_VERSION: 'v2.337.0', CIRUJANO_ACTIONS_RUNNER_SHA256: 'a'.repeat(64) }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('exact version') });
    await expect(run({ CIRUJANO_ACTIONS_RUNNER_VERSION: '2.337.0', CIRUJANO_ACTIONS_RUNNER_SHA256: 'A'.repeat(64) }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('sha256') });
  });

  it('rejects a release without a usable linux-x64 digest or an exact version tag', async () => {
    const noDigest = await releaseFile({ tag_name: 'v2.338.1', assets: [{ name: 'actions-runner-linux-x64-2.338.1.tar.gz' }] });
    await expect(run({ CIRUJANO_ACTIONS_RUNNER_RELEASE_JSON: noDigest }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('sha256 digest') });
    const wrongAsset = await releaseFile({ tag_name: 'v2.338.1', assets: [{ name: 'actions-runner-linux-arm64-2.338.1.tar.gz', digest: `sha256:${sha}` }] });
    await expect(run({ CIRUJANO_ACTIONS_RUNNER_RELEASE_JSON: wrongAsset }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('actions-runner-linux-x64-2.338.1.tar.gz') });
    const preRelease = await releaseFile({ tag_name: 'v2.339.0-rc1', assets: [] });
    await expect(run({ CIRUJANO_ACTIONS_RUNNER_RELEASE_JSON: preRelease }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('exact version') });
  });
});
