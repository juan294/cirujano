import { expect, it } from 'vitest';
import { parseStrictJson } from './canonical.js';
import { parseWorkflowSource } from './workflow.js';

it('shares the strict YAML interpretation with collection', () => {
  expect(parseWorkflowSource('on: [push]\njobs: {}\n')).toEqual({ on: ['push'], jobs: {} });
  expect(() => parseWorkflowSource('a: 1\na: 2\n')).toThrow();
  expect(() => parseWorkflowSource('x: &x 1\ny: *x\n')).toThrow();
});
it('supports an explicitly bounded large source snapshot without weakening default artifact bounds', () => {
  const json = JSON.stringify({ source: 'x'.repeat(1024 * 1024) });
  expect(() => parseStrictJson(json)).toThrow(/exceeds/);
  expect(parseStrictJson(json, 2 * 1024 * 1024)).toEqual({ source: 'x'.repeat(1024 * 1024) });
  expect(() => parseStrictJson('null', 0)).toThrow();
  expect(() => parseStrictJson('null', 33 * 1024 * 1024)).toThrow();
});
