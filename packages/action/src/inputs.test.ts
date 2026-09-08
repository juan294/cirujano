import { describe, expect, it } from 'vitest';

import { ActionInputError, resolveInputs } from './inputs.js';

function inputs(values: Record<string, string>): (name: string) => string {
  return (name) => values[name] ?? '';
}

describe('resolveInputs', () => {
  it('uses an explicit run-id when given', () => {
    expect(resolveInputs(inputs({ 'github-token': 'ghs_x', 'run-id': ' 34232598488 ' }), 1)).toEqual({
      githubToken: 'ghs_x',
      runId: 34232598488,
    });
  });

  it('falls back to the current run when run-id is empty', () => {
    expect(resolveInputs(inputs({ 'github-token': 'ghs_x' }), 77)).toEqual({ githubToken: 'ghs_x', runId: 77 });
  });

  it('fails closed on a missing token, a non-numeric run-id, or no current run', () => {
    expect(() => resolveInputs(inputs({ 'run-id': '5' }), 1)).toThrow(ActionInputError);
    expect(() => resolveInputs(inputs({ 'github-token': 't', 'run-id': 'latest' }), 1)).toThrow(/positive integer/);
    expect(() => resolveInputs(inputs({ 'github-token': 't', 'run-id': '0' }), 1)).toThrow(/positive integer/);
    expect(() => resolveInputs(inputs({ 'github-token': 't' }), 0)).toThrow(/no current workflow run/);
  });
});
