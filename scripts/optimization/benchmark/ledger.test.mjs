import { describe, expect, it } from 'vitest';
import { roundedJobMinutes, aggregateMinutes } from './src/ledger.mjs';

describe('public benchmark job minute ledger', () => {
  it.each([[0, 0], [1, 1], [59999, 1], [60000, 1], [60001, 2], [120000, 2]])('rounds %i milliseconds to %i minutes', (elapsed, expected) => {
    expect(roundedJobMinutes(elapsed)).toBe(expected);
  });
  it.each([-1, NaN, Infinity, '60000', null])('rejects invalid elapsed input %s', elapsed => {
    expect(() => roundedJobMinutes(elapsed)).toThrow('invalid-elapsed-ms');
  });
  it('rounds per job before aggregation', () => {
    expect(aggregateMinutes([{ elapsedMs: 1 }, { elapsedMs: 1 }])).toBe(2);
    expect(aggregateMinutes([])).toBe(0);
  });
  it('preserves permutation and whole-minute extension across generated real workloads', () => {
    for (let count = 1; count <= 1000; count++) {
      const jobs = Array.from({ length: count % 19 + 1 }, (_, index) => ({ elapsedMs: (count * 65537 + index * 7919) % 180001 }));
      const before = aggregateMinutes(jobs);
      expect(aggregateMinutes([...jobs].reverse())).toBe(before);
      expect(aggregateMinutes(jobs.map(job => ({ elapsedMs: job.elapsedMs + 60000 })))).toBe(before + jobs.length);
    }
  });
});
