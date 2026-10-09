import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, decodePushArtifact, jsonDigest } from '@cirujano/core';
import { pushMeasurementFixture } from './push-measure.test-helper.js';
import { command } from './push-verify.test-helper.js';
import { readPushReportContext } from './push-report-service.js';
import { readPrivateJson } from './store.js';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() { const f = await pushMeasurementFixture(); directories.push(f.directory); return f; }

describe('skip-validated-push measure, report and publish', () => {
  it('measures the fixed cohort, renders the bound report and opens one unmerged PR', async () => {
    const f = await fixture();
    expect(await f.measure()).toBe(0); expect(f.last()).toMatchObject({ status: 'measured-improvement' });
    const measurement = decodePushArtifact('measurement', await readPrivateJson(join(f.measured, 'measurement.json')));
    expect(measurement.pushes.map(push => [push.role, push.billedMinutes, push.validated])).toEqual([['baseline', 11, false], ['baseline', 12, false], ['baseline', 13, false], ['candidate', 1, true], ['candidate', 1, true], ['candidate', 1, true], ['control', 13, false]]);
    expect(measurement.pushes[0]!.prJobs).toEqual([{ name: 'test (20)', conclusion: 'success' }, { name: 'test (22)', conclusion: 'success' }]);
    expect(await f.service.run(command('status', { operation: f.measured }), f.io)).toBe(0); expect(f.last()).toMatchObject({ status: 'measured-improvement' });

    expect(await f.report()).toBe(0); expect(f.last()).toMatchObject({ status: 'ready-to-publish' });
    const reviewed = await readPushReportContext(join(f.reported, 'report.json'));
    expect(await readFile(join(f.reported, 'report.md'), 'utf8')).toBe(reviewed.report.markdown);
    expect(reviewed.report.markdown).toContain('# Skip validated pushes: ready-to-publish');
    expect(await f.service.run(command('status', { operation: f.reported }), f.io)).toBe(0); expect(f.last()).toMatchObject({ status: 'ready-to-publish' });

    const report = reviewed.report, permitPath = join(f.directory, 'publication-permit.json');
    await writeFile(permitPath, canonicalJson({ schemaVersion: 1, kind: 'publication-permit', permitId: 'owned-push-publication', repositoryId: report.provenance.repositoryId, repository: report.provenance.repository, baseRef: report.baseRef, headRef: report.headRef, baseSha: report.provenance.baseSha, headSha: report.candidateSha, proposalDigest: report.proposalDigest, sandboxDigest: report.sandboxDigest, measurementDigest: report.measurementDigest, reportDigest: jsonDigest(report), bodyHash: report.markdownHash, marker: report.marker, expiresAt: '2099-10-10T00:00:00Z', maxCreates: 1 }));
    expect(await f.service.run(command('publish', { report: join(f.reported, 'report.json'), permit: permitPath }), f.io)).toBe(0);
    expect(f.last()).toMatchObject({ status: 'published', url: 'https://github.com/public-example/benchmark/pull/7' });
    expect(f.posts).toHaveLength(1);
    expect((f.posts[0] as { body: unknown }).body).toEqual({ title: 'Skip CI jobs on pushes their pull request already validated', head: 'cirujano/skip-validated-push', base: 'cirujano/base', body: report.markdown, maintainer_can_modify: false, draft: false });
    const publication = decodePushArtifact('publication', await readPrivateJson(join(f.reported, 'publication', 'publication.json')));
    expect(publication).toMatchObject({ family: 'skip-validated-push', status: 'published', number: 7 });
    // Reconciliation re-reads the same evidence and never creates again.
    expect(await f.service.run(command('status', { operation: join(f.reported, 'publication') }), f.io)).toBe(0); expect(f.posts).toHaveLength(1);
  });
  it('rejects a cohort whose validated candidate still ran a guarded job', async () => {
    const f = await fixture(), id = 11020;
    f.pushJobs.set(1102, [{ id, name: 'cirujano_validated_push', conclusion: 'success', minutes: 1 }, { id: id + 1, name: 'test (20)', conclusion: 'success', minutes: 6 }, { id: id + 2, name: 'test (22)', conclusion: 'skipped', minutes: 0 }]);
    expect(await f.measure()).toBe(1); expect(f.last()).toMatchObject({ status: 'rejected' });
    expect(decodePushArtifact('measurement', await readPrivateJson(join(f.measured, 'measurement.json'))).limits).toContain('guard-not-honored');
    expect(await f.report()).toBe(1); expect(f.last()).toMatchObject({ status: 'rejected' });
  });
  it.each([
    ['a forged second verdict line', 'measurement-classifier-verdict', (f: Awaited<ReturnType<typeof fixture>>) => { f.logs.set(11010, `${f.logs.get(11010)!}2026-10-10T10:00:03.0000000Z cirujano-classifier validated=true reason=validated\n`); }],
    ['an unmerged pull request', 'measurement-pull-identity', (f: Awaited<ReturnType<typeof fixture>>) => { f.pulls.get(101)!.merged = false; }],
    ['a PR run on another head', 'measurement-pr-run-identity', (f: Awaited<ReturnType<typeof fixture>>) => { (f.pulls.get(112)!.head as { sha: string }).sha = 'f'.repeat(40); }],
    ['a job no workflow job names', 'measurement-job-mapping', (f: Awaited<ReturnType<typeof fixture>>) => { f.pushJobs.get(1001)![0]!.name = 'deploy'; }],
    ['a validated push whose tree differs from its PR head', 'measurement-tree-mismatch', (f: Awaited<ReturnType<typeof fixture>>) => { f.trees.set(f.entries[4]!.headSha, 'd'.repeat(40)); }],
    ['a base job displayed as the classifier', 'measurement-job-name-collision', (f: Awaited<ReturnType<typeof fixture>>) => { f.workflows.set(f.entries[0]!.headSha, f.workflows.get(f.entries[0]!.headSha)!.replace('  test:\n', '  test:\n    name: cirujano_validated_push\n')); }],
    ['a non-UTC job time', 'measurement-job-timing', (f: Awaited<ReturnType<typeof fixture>>) => { f.pushJobs.get(1002)![0]!.completedAt = '2026-10-10T12:05:30+02:00'; }],
  ])('fails closed on %s without a measurement', async (_name, reason, mutate) => {
    const f = await fixture(); mutate(f);
    expect(await f.measure()).toBe(1); expect(f.last()).toMatchObject({ status: 'failed', reasonCode: 'measurement-evidence-incomplete' });
    expect((await readPrivateJson(join(f.measured, 'measurement-incomplete.json')) as { errors: { reason: string }[] }).errors.map(error => error.reason)).toEqual([reason]);
    await expect(readFile(join(f.measured, 'measurement.json'))).rejects.toThrow();
  });
  it('lets the core gate reject a pushed run on another workflow', async () => {
    const f = await fixture(); f.workflows.set(f.entries[3]!.headSha, `${f.candidate}# drift\n`);
    expect(await f.measure()).toBe(1); expect(f.last()).toMatchObject({ status: 'rejected' });
    expect(decodePushArtifact('measurement', await readPrivateJson(join(f.measured, 'measurement.json'))).limits).toContain('workflow-drift');
  });
  it('rejects a cohort bound to another sandbox before any GitHub read', async () => {
    const f = await fixture(); f.cohort.sandboxDigest = '0'.repeat(64);
    expect(await f.measure()).toBe(1); expect(f.last()).toMatchObject({ status: 'rejected', reasonCode: 'measurement-input-rejected' });
  });
});
