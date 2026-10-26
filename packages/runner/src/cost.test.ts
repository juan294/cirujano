import { describe, expect, it } from 'vitest';

import { estimateRunnerCost } from './cost.js';

const rates = {
  currency: 'USD', quotedAt: '2026-09-13', source: 'provider quote',
  computeUsdPerHour: 0.24, diskUsdPerGibMonth: 0.10,
  networkEgressUsdPerGib: 0.05, hostedUsdPerMinute: 0.008,
} as const;

describe('estimateRunnerCost (R05)', () => {
  it('reproduces hand-calculated compute, retained disk, network and hosted totals', () => {
    const result = estimateRunnerCost({
      rates,
      computeIntervals: [{ startMs: 0, endMs: 7_200_000 }],
      disk: { sizeGiB: 80, retainedMs: 15 * 24 * 3_600_000 },
      networkEgressGiB: 2,
      hostedBillableMinutes: 100,
    });
    expect(result).toEqual({
      complete: true, currency: 'USD', computeUsd: 0.48, diskUsd: 4,
      networkUsd: 0.1, runnerTotalUsd: 4.58, hostedBaselineUsd: 0.8,
    });
  });

  it.each([
    ['missing rates', { rates: null, computeIntervals: [], disk: { sizeGiB: 80, retainedMs: 1 }, networkEgressGiB: 0, hostedBillableMinutes: 1 }],
    ['open interval', { rates, computeIntervals: [{ startMs: 0, endMs: null }], disk: { sizeGiB: 80, retainedMs: 1 }, networkEgressGiB: 0, hostedBillableMinutes: 1 }],
    ['missing hosted baseline', { rates: { ...rates, hostedUsdPerMinute: null }, computeIntervals: [], disk: { sizeGiB: 80, retainedMs: 1 }, networkEgressGiB: 0, hostedBillableMinutes: 1 }],
    ['nonfinite rate', { rates: { ...rates, computeUsdPerHour: Number.NaN }, computeIntervals: [], disk: { sizeGiB: 80, retainedMs: 1 }, networkEgressGiB: 0, hostedBillableMinutes: 1 }],
    ['empty compute evidence', { rates, computeIntervals: [], disk: { sizeGiB: 80, retainedMs: 1 }, networkEgressGiB: 0, hostedBillableMinutes: 1 }],
    ['invalid quote date', { rates: { ...rates, quotedAt: '13 September' }, computeIntervals: [{ startMs: 0, endMs: 1 }], disk: { sizeGiB: 80, retainedMs: 1 }, networkEgressGiB: 0, hostedBillableMinutes: 1 }],
  ])('reports incomplete for %s and never presents zero-cost success', (_name, input) => {
    const result = estimateRunnerCost(input);
    expect(result.complete).toBe(false);
    expect(result).toHaveProperty('reason');
    expect(result).not.toHaveProperty('runnerTotalUsd');
  });
});
