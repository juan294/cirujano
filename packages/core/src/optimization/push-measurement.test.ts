import { describe, expect, it } from 'vitest';
import { canonicalJson, jsonDigest } from './canonical.js';
import { decodePushArtifact } from './push-contracts.js';
import { CLASSIFIER_JOB_ID } from './push-guard.js';
import { assertPushMeasuredEvidence, comparePushMeasurement, decodePushCohortManifest } from './push-measurement.js';
import { job, pushComparisonFixture } from './push-measurement.test-helper.js';

describe('per-push measurement gate', () => {
  it('push-gate-pass: candidates skip every guarded job and bill at least one minute below the baseline median', () => {
    const inputs = pushComparisonFixture(), measurement = comparePushMeasurement(inputs);
    expect(measurement).toMatchObject({ family: 'skip-validated-push', status: 'measured-improvement', claimLevel: 'sample-execution-only', baselineMedianMinutes: 12, classifierOverheadMinutes: 1, githubListSavingUsd: 0, cohortDigest: jsonDigest(inputs.cohort) });
    expect(measurement.pushes.map(push => [push.role, push.billedMinutes, push.classifierMinutes, push.validated])).toEqual([['baseline', 11, 0, false], ['baseline', 12, 0, false], ['baseline', 13, 0, false], ['candidate', 1, 1, true], ['candidate', 1, 1, true], ['candidate', 1, 1, true], ['control', 13, 1, false]]);
    expect(measurement.pushes[3]!.guardedJobs).toEqual([{ jobId: 'build', conclusion: 'skipped' }, { jobId: 'lint', conclusion: 'skipped' }, { jobId: 'test', conclusion: 'skipped' }]);
    expect(measurement.modeled).toEqual({ pushes: 10, validatedPushes: 8, projectedSavedMinutes: 8 * 12 - 8 * 1, projectedOverheadMinutes: 2 * 1 });
    expect(measurement.limits).toEqual(expect.arrayContaining(['sample-execution-only', 'per-push-gate', 'classifier-overhead-disclosed', 'modeled-history-projection', 'public-github-list-saving-zero']));
    expect(decodePushArtifact('measurement', measurement)).toEqual(measurement);
    expect(() => assertPushMeasuredEvidence(inputs, measurement)).not.toThrow();
    expect(() => assertPushMeasuredEvidence(inputs, { ...measurement, status: 'no-improvement', claimLevel: 'none' })).toThrow();
  });
  it('push-gate-candidate-not-skipped: a candidate the classifier did not validate earns no improvement', () => {
    const inputs = pushComparisonFixture(); inputs.runs[4]!.classifier = { validated: false, reasonCode: 'no-merged-pr' };
    inputs.runs[4]!.jobs = [job(CLASSIFIER_JOB_ID, 'success', 1), job('lint', 'success', 3), job('test', 'success', 6), job('build', 'success', 3)];
    expect(comparePushMeasurement(inputs)).toMatchObject({ status: 'no-improvement', claimLevel: 'none', limits: expect.arrayContaining(['candidate-not-validated']) });
  });
  it('rejects a validated candidate whose guarded jobs still ran, as a guard that did not hold', () => {
    const inputs = pushComparisonFixture(); inputs.runs[3]!.jobs[2] = job('test', 'success', 6);
    expect(comparePushMeasurement(inputs)).toMatchObject({ status: 'rejected', limits: expect.arrayContaining(['guard-not-honored']) });
  });
  it('push-gate-control-skipped: a control push that skipped a guarded job is rejected', () => {
    const inputs = pushComparisonFixture(); inputs.runs[6]!.jobs[1] = job('lint', 'skipped', 0);
    expect(comparePushMeasurement(inputs)).toMatchObject({ status: 'rejected', limits: expect.arrayContaining(['control-not-full']) });
    const validated = pushComparisonFixture(); validated.runs[6]!.classifier = { validated: true, reasonCode: 'validated' };
    expect(comparePushMeasurement(validated)).toMatchObject({ status: 'rejected', limits: expect.arrayContaining(['control-not-full']) });
  });
  it('push-gate-pr-jobset-drift: candidate PRs must run the same jobs, all green, as the baseline PRs', () => {
    const missing = pushComparisonFixture(); missing.runs[5]!.prJobs = missing.runs[5]!.prJobs.filter(prJob => prJob.name !== 'test');
    expect(comparePushMeasurement(missing)).toMatchObject({ status: 'rejected', limits: expect.arrayContaining(['pr-coverage-drift']) });
    const failed = pushComparisonFixture(); failed.runs[0]!.prJobs[1] = { name: 'lint', conclusion: 'failure' };
    expect(comparePushMeasurement(failed)).toMatchObject({ status: 'rejected', limits: expect.arrayContaining(['pr-run-not-green']) });
  });
  it('reports no improvement when a candidate saves less than one billed minute', () => {
    const inputs = pushComparisonFixture(); inputs.runs[3]!.jobs[0] = job(CLASSIFIER_JOB_ID, 'success', 12);
    expect(comparePushMeasurement(inputs)).toMatchObject({ status: 'no-improvement', limits: expect.arrayContaining(['saving-below-one-minute']) });
  });
  it.each([
    ['membership', (inputs: ReturnType<typeof pushComparisonFixture>) => { inputs.runs[1]!.pushRunId = 9999; }, 'cohort-membership-drift'],
    ['binding', (inputs: ReturnType<typeof pushComparisonFixture>) => { inputs.cohort.sandboxDigest = '0'.repeat(64); }, 'artifact-binding-drift'],
    ['unknown-job', (inputs: ReturnType<typeof pushComparisonFixture>) => { inputs.runs[0]!.jobs.push(job('deploy', 'success', 2)); }, 'run-evidence-invalid'],
    ['baseline-classifier', (inputs: ReturnType<typeof pushComparisonFixture>) => { inputs.runs[0]!.jobs.push(job(CLASSIFIER_JOB_ID, 'success', 1)); }, 'run-evidence-invalid'],
    ['missing-guarded', (inputs: ReturnType<typeof pushComparisonFixture>) => { inputs.runs[3]!.jobs = inputs.runs[3]!.jobs.filter(entry => entry.jobId !== 'build'); }, 'run-evidence-invalid'],
    ['untimed-job', (inputs: ReturnType<typeof pushComparisonFixture>) => { inputs.runs[6]!.jobs[1] = { ...inputs.runs[6]!.jobs[1]!, completedAt: null }; }, 'run-evidence-invalid'],
  ])('push-cohort-incomparable: rejects %s', (_name, mutate, limit) => {
    const inputs = pushComparisonFixture(); mutate(inputs);
    expect(comparePushMeasurement(inputs)).toMatchObject({ status: 'rejected', limits: expect.arrayContaining([limit]) });
  });
  it('decodes the push cohort manifest strictly', () => {
    const { cohort } = pushComparisonFixture();
    expect(decodePushCohortManifest(cohort)).toEqual(cohort);
    for (const mutate of [(c: typeof cohort) => { c.entries.pop(); }, (c: typeof cohort) => { c.entries[6]!.prNumber = 5; }, (c: typeof cohort) => { c.entries[0]!.prRunId = null; }, (c: typeof cohort) => { c.entries[2]!.role = 'candidate'; }, (c: typeof cohort) => { c.entries[4]!.pushRunId = c.entries[3]!.pushRunId; }]) {
      const value = structuredClone(cohort); mutate(value); expect(() => decodePushCohortManifest(value), canonicalJson(value.entries)).toThrow();
    }
  });
  it('counts a private repository list saving only with a known allowance', () => {
    const inputs = { ...pushComparisonFixture(), visibility: 'private' as const, pricing: { usdPerMinute: 0.006, priceBasis: 'owner-supplied list price', allowanceKnown: true } };
    expect(comparePushMeasurement(inputs).githubListSavingUsd).toBeCloseTo((12 - 1) * 3 * 0.006);
    expect(comparePushMeasurement({ ...inputs, pricing: { ...inputs.pricing, allowanceKnown: false } })).toMatchObject({ githubListSavingUsd: 0, limits: expect.arrayContaining(['github-allowance-unknown']) });
  });
});
