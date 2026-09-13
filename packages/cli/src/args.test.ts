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

  it('parses every runner command contract', () => {
    expect(parseArguments(['runner', 'inspect', '--config', 'runner.json'])).toEqual({
      command: 'runner', action: 'inspect', configPath: 'runner.json', format: 'text',
    });
    expect(parseArguments(['runner', 'inspect', '--config', 'runner.json', '--format', 'json'])).toEqual({
      command: 'runner', action: 'inspect', configPath: 'runner.json', format: 'json',
    });
    expect(parseArguments(['runner', 'watch', '--config', 'runner.json', '--dry-run'])).toEqual({
      command: 'runner', action: 'watch', configPath: 'runner.json', dryRun: true,
    });
    expect(parseArguments(['runner', 'watch', '--config', 'runner.json', '--permit', 'permit.json'])).toEqual({
      command: 'runner', action: 'watch', configPath: 'runner.json', permitPath: 'permit.json', dryRun: false,
    });
    expect(parseArguments(['runner', 'stop', '--config', 'runner.json', '--permit', 'permit.json'])).toEqual({
      command: 'runner', action: 'stop', configPath: 'runner.json', permitPath: 'permit.json',
    });
    expect(parseArguments(['runner', 'cleanup', '--config', 'runner.json', '--permit', 'permit.json'])).toEqual({
      command: 'runner', action: 'cleanup', configPath: 'runner.json', permitPath: 'permit.json',
    });
    expect(parseArguments(['runner', 'report', '--state', 'state.json', '--format', 'json'])).toEqual({
      command: 'runner', action: 'report', statePath: 'state.json', format: 'json',
    });
  });

  it('parses telemetry collection and reporting contracts', () => {
    expect(parseArguments(['telemetry', 'collect', '--owner', 'juan294', '--store', '/tmp/data'])).toEqual({
      command: 'telemetry', action: 'collect', owner: 'juan294', storePath: '/tmp/data', lookbackHours: 48,
    });
    expect(parseArguments(['telemetry', 'report', '--store', '/tmp/data', '--since', '2026-09-13', '--format', 'markdown'])).toEqual({
      command: 'telemetry', action: 'report', storePath: '/tmp/data', since: '2026-09-13', format: 'markdown',
    });
  });

  it.each([
    [['runner'], /requires a subcommand/],
    [['runner', 'start'], /Unknown runner command/],
    [['runner', 'inspect'], /requires --config/],
    [['runner', 'inspect', '--config', 'x', '--format', 'yaml'], /must be "json" or "text"/],
    [['runner', 'watch', '--config', 'x', '--permit'], /requires a file path/],
    [['runner', 'stop', '--config', 'x'], /requires --permit/],
    [['runner', 'cleanup', '--permit', 'p'], /requires --config/],
    [['runner', 'report', '--state', 's'], /requires --format json/],
    [['runner', 'report', '--state', 's', '--format', 'text'], /only supports --format json/],
    [['runner', 'watch', '--config', 'x', '--wat'], /Unknown option/],
    [['telemetry'], /requires a subcommand/],
    [['telemetry', 'collect', '--owner', 'juan294'], /requires --store/],
    [['telemetry', 'collect', '--store', '/tmp/data'], /requires --owner/],
    [['telemetry', 'collect', '--owner', 'juan294', '--store', '/tmp/data', '--lookback-hours', '0'], /from 1 through 1080/],
    [['telemetry', 'report', '--store', '/tmp/data', '--since', 'yesterday'], /YYYY-MM-DD/],
    [['telemetry', 'report', '--store', '/tmp/data', '--since', '2026-99-99'], /YYYY-MM-DD/],
  ])('rejects invalid runner invocation %j', (argv, message) => {
    expect(() => parseArguments(argv)).toThrow(message);
  });

  it('rejects unknown commands, missing values, and bad formats', () => {
    expect(() => parseArguments(['audit'])).toThrow(ArgumentError);
    expect(() => parseArguments(['estimate'])).toThrow(/requires --jobs/);
    expect(() => parseArguments(['estimate', '--jobs'])).toThrow(/requires a file path/);
    expect(() => parseArguments(['estimate', '--jobs', 'x', '--format', 'yaml'])).toThrow(/json.*text/);
    expect(() => parseArguments(['estimate', '--jobs', 'x', '--days', '30'])).toThrow(/Unknown option "--days"/);
  });
});
