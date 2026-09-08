import { describe, expect, it } from 'vitest';

import { ArgumentError, parseArguments } from './args.js';

describe('parseArguments', () => {
  it('treats no arguments and --help as help, and --version as version', () => {
    expect(parseArguments([])).toEqual({ command: 'help' });
    expect(parseArguments(['--help'])).toEqual({ command: 'help' });
    expect(parseArguments(['--version'])).toEqual({ command: 'version' });
  });

  it('parses estimate with a jobs file and an optional format', () => {
    expect(parseArguments(['estimate', '--jobs', 'jobs.json'])).toEqual({
      command: 'estimate',
      jobsPath: 'jobs.json',
      format: 'text',
    });
    expect(parseArguments(['estimate', '--format', 'json', '--jobs', 'jobs.json'])).toEqual({
      command: 'estimate',
      jobsPath: 'jobs.json',
      format: 'json',
    });
  });

  it('rejects unknown commands, missing values, and bad formats', () => {
    expect(() => parseArguments(['audit'])).toThrow(ArgumentError);
    expect(() => parseArguments(['estimate'])).toThrow(/requires --jobs/);
    expect(() => parseArguments(['estimate', '--jobs'])).toThrow(/requires a file path/);
    expect(() => parseArguments(['estimate', '--jobs', 'x', '--format', 'yaml'])).toThrow(/json.*text/);
    expect(() => parseArguments(['estimate', '--jobs', 'x', '--days', '30'])).toThrow(/Unknown option "--days"/);
  });
});
