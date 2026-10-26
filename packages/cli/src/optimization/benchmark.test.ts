import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createPnpmCachePatch, decodeActionReceipt, decodeVerificationProfile, gitBlobSha, inspectWorkflow, sha256, validateCacheOnlyChange } from '@cirujano/core';
import { validateProfileCommands } from './execution-profile.js';

describe('public benchmark enters the actual cache-only policy', () => {
  it('retains exact checks and is eligible before the two-field candidate', async () => {
    const directory = new URL('../../../../scripts/optimization/benchmark/', import.meta.url);
    const fixtures = new URL('../../../core/fixtures/optimization/', import.meta.url);
    const source = await readFile(new URL('ci.yml.template', directory), 'utf8');
    const profile = decodeVerificationProfile(JSON.parse(await readFile(new URL('optimization-profile.json', directory), 'utf8')));
    const receipt = decodeActionReceipt(JSON.parse(await readFile(new URL('setup-node-receipt.json', fixtures), 'utf8')));
    // This parser regression has no provider, repository or spending authority.
    const manifest = JSON.parse(await readFile(new URL('manifest.json', fixtures), 'utf8')) as { provenance: Parameters<typeof inspectWorkflow>[1]['provenance'] };
    const options = { provenance: { ...manifest.provenance, workflowHash: sha256(source), workflowBlobSha: gitBlobSha(source) }, receipt, rootLockfile: true, timedBaseline: true, requiredChecks: ['test'], verificationProfilePresent: true };
    expect(inspectWorkflow(source, options).status).toBe('eligible');
    validateProfileCommands(source, profile, 'test');
    const candidate = createPnpmCachePatch(source, options).candidate;
    validateCacheOnlyChange(source, candidate, 'test', 2);
    validateProfileCommands(candidate, profile, 'test');
    expect(inspectWorkflow(candidate, { ...options, provenance: { ...options.provenance, workflowHash: sha256(candidate), workflowBlobSha: gitBlobSha(candidate) } }).status).toBe('no-change');
  });
});
