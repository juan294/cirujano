import { describe, expect, it } from 'vitest';

import {
  BillingInputError,
  billableMinutesForJob,
  estimateCostUsd,
  parseGithubJobs,
  rankWorkflowUsage,
  summarizeBillableMinutes,
} from './billing.js';

describe('billableMinutesForJob', () => {
  it('rounds a partial minute up, as GitHub bills it', () => {
    expect(billableMinutesForJob({
      name: 'checks',
      startedAt: '2026-09-08T12:02:15Z',
      completedAt: '2026-09-08T12:03:06Z',
    })).toBe(1);
    expect(billableMinutesForJob({
      name: 'e2e',
      startedAt: '2026-09-08T12:00:00Z',
      completedAt: '2026-09-08T12:16:01Z',
    })).toBe(17);
  });

  it('returns null for jobs that never started, never completed, or ran backwards', () => {
    expect(billableMinutesForJob({ name: 'skipped', startedAt: null, completedAt: null })).toBeNull();
    expect(billableMinutesForJob({ name: 'running', startedAt: '2026-09-08T12:00:00Z', completedAt: null })).toBeNull();
    expect(billableMinutesForJob({
      name: 'clock-skew',
      startedAt: '2026-09-08T12:05:00Z',
      completedAt: '2026-09-08T12:00:00Z',
    })).toBeNull();
    expect(billableMinutesForJob({ name: 'garbage', startedAt: 'yesterday', completedAt: 'today' })).toBeNull();
  });
});

describe('summarizeBillableMinutes', () => {
  it('sums measured jobs and counts the unmeasurable ones separately', () => {
    const summary = summarizeBillableMinutes([
      { name: 'a', startedAt: '2026-09-08T12:00:00Z', completedAt: '2026-09-08T12:04:30Z' },
      { name: 'b', startedAt: '2026-09-08T12:00:00Z', completedAt: '2026-09-08T12:00:10Z' },
      { name: 'c', startedAt: null, completedAt: null },
    ]);
    expect(summary).toEqual({ billableMinutes: 6, measuredJobs: 2, skippedJobs: 1 });
  });
});

describe('parseGithubJobs', () => {
  it('maps the GitHub jobs payload and keeps missing timestamps as null', () => {
    const jobs = parseGithubJobs({
      total_count: 2,
      jobs: [
        { id: 1, name: 'checks', started_at: '2026-09-08T12:02:15Z', completed_at: '2026-09-08T12:03:06Z' },
        { id: 2, name: 'skipped', started_at: null, completed_at: null },
      ],
    });
    expect(jobs).toEqual([
      { name: 'checks', startedAt: '2026-09-08T12:02:15Z', completedAt: '2026-09-08T12:03:06Z' },
      { name: 'skipped', startedAt: null, completedAt: null },
    ]);
  });

  it('fails closed on a malformed payload instead of reporting a low bill', () => {
    expect(() => parseGithubJobs(null)).toThrow(BillingInputError);
    expect(() => parseGithubJobs({ jobs: 'none' })).toThrow(BillingInputError);
    expect(() => parseGithubJobs({ jobs: [{ id: 3 }] })).toThrow(/index 0 has no string `name`/);
  });
});

describe('rankWorkflowUsage', () => {
  it('ranks by estimated minutes and places unsampled workflows last', () => {
    const ranked = rankWorkflowUsage([
      { repository: 'a', workflow: 'Coverage', runs: 100, sampledMinutes: [6, 7] },
      { repository: 'a', workflow: 'CI', runs: 401, sampledMinutes: [48, 47, 49] },
      { repository: 'b', workflow: 'Never ran', runs: 12, sampledMinutes: [] },
    ]);
    expect(ranked.map((entry) => entry.workflow)).toEqual(['CI', 'Coverage', 'Never ran']);
    expect(ranked[0]?.estimatedMinutes).toBe(19248);
    expect(ranked[1]?.averageMinutesPerRun).toBe(6.5);
    expect(ranked[2]?.estimatedMinutes).toBe(0);
  });
});

describe('estimateCostUsd', () => {
  it('prices minutes at the hosted Linux list price by default and rounds to cents', () => {
    expect(estimateCostUsd(40_064)).toBe(320.51);
    expect(estimateCostUsd(1000, 0.006)).toBe(6);
  });

  it('rejects negative or non-finite inputs', () => {
    expect(() => estimateCostUsd(-1)).toThrow(BillingInputError);
    expect(() => estimateCostUsd(Number.NaN)).toThrow(BillingInputError);
    expect(() => estimateCostUsd(10, Number.POSITIVE_INFINITY)).toThrow(BillingInputError);
  });
});
