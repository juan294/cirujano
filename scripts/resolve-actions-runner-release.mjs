#!/usr/bin/env node
// Resolves the Actions runner release the fleet installs: the latest actions/runner release and the
// sha256 GitHub publishes for its linux-x64 archive. The machine owns the version; a human only pins
// one deliberately by setting CIRUJANO_ACTIONS_RUNNER_VERSION and CIRUJANO_ACTIONS_RUNNER_SHA256
// together. Prints the two variables in the actions-runner.env shape that the installer records and
// the controller wrapper sources.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RELEASE_URL = 'https://api.github.com/repos/actions/runner/releases/latest';
const EXACT_VERSION = /^\d+\.\d+\.\d+$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export function selectActionsRunnerRelease(release) {
  const tag = typeof release?.tag_name === 'string' ? release.tag_name : '';
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  if (!EXACT_VERSION.test(version)) {
    throw new Error(`actions/runner release tag ${JSON.stringify(tag)} is not an exact version`);
  }
  const archive = `actions-runner-linux-x64-${version}.tar.gz`;
  const asset = Array.isArray(release.assets) ? release.assets.find((candidate) => candidate?.name === archive) : undefined;
  if (asset === undefined) {
    throw new Error(`actions/runner v${version} publishes no ${archive} asset`);
  }
  const digest = typeof asset.digest === 'string' ? asset.digest : '';
  if (!digest.startsWith('sha256:') || !SHA256.test(digest.slice('sha256:'.length))) {
    throw new Error(`${archive} carries no sha256 digest`);
  }
  return { version, sha256: digest.slice('sha256:'.length) };
}

export async function resolveActionsRunnerRelease(environment = process.env) {
  const pinnedVersion = environment.CIRUJANO_ACTIONS_RUNNER_VERSION;
  const pinnedSha256 = environment.CIRUJANO_ACTIONS_RUNNER_SHA256;
  if (pinnedVersion !== undefined || pinnedSha256 !== undefined) {
    if (pinnedVersion === undefined || pinnedSha256 === undefined) {
      throw new Error('CIRUJANO_ACTIONS_RUNNER_VERSION and CIRUJANO_ACTIONS_RUNNER_SHA256 must be set together');
    }
    if (!EXACT_VERSION.test(pinnedVersion)) {
      throw new Error(`CIRUJANO_ACTIONS_RUNNER_VERSION must be an exact version such as 2.338.1, got ${JSON.stringify(pinnedVersion)}`);
    }
    if (!SHA256.test(pinnedSha256)) {
      throw new Error('CIRUJANO_ACTIONS_RUNNER_SHA256 must be the lowercase hex sha256 of the linux-x64 archive');
    }
    return { version: pinnedVersion, sha256: pinnedSha256, source: 'pinned by environment' };
  }
  const releasePath = environment.CIRUJANO_ACTIONS_RUNNER_RELEASE_JSON;
  if (releasePath !== undefined) {
    return { ...selectActionsRunnerRelease(JSON.parse(readFileSync(releasePath, 'utf8'))), source: releasePath };
  }
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'cirujano-runner-installer' };
  const token = environment.GITHUB_TOKEN ?? environment.GH_TOKEN;
  if (token !== undefined && token !== '') {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(RELEASE_URL, { headers });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for ${RELEASE_URL}`);
  }
  return { ...selectActionsRunnerRelease(await response.json()), source: RELEASE_URL };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const release = await resolveActionsRunnerRelease();
    process.stderr.write(`runner: Actions runner ${release.version} (${release.source})\n`);
    process.stdout.write(`CIRUJANO_ACTIONS_RUNNER_VERSION=${release.version}\nCIRUJANO_ACTIONS_RUNNER_SHA256=${release.sha256}\n`);
  } catch (error) {
    process.stderr.write(`runner: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
