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
    expect(parseArguments(['telemetry', 'report', '--store', '/tmp/data', '--since', '2026-09-13', '--registry', '/tmp/fleet.json'])).toEqual({
      command: 'telemetry', action: 'report', storePath: '/tmp/data', since: '2026-09-13', format: 'markdown', registryPath: '/tmp/fleet.json',
    });
  });

  it('parses every fleet registry command contract', () => {
    expect(parseArguments(['fleet', 'init', '--registry', '/tmp/fleet.json', '--owner', 'juan294'])).toEqual({
      command: 'fleet', action: 'init', registryPath: '/tmp/fleet.json', owner: 'juan294', since: '2026-09-13', through: '2026-10-28',
    });
    expect(parseArguments(['fleet', 'init', '--registry', '/tmp/fleet.json', '--owner', 'juan294', '--since', '2026-09-20', '--through', '2026-10-01'])).toEqual({
      command: 'fleet', action: 'init', registryPath: '/tmp/fleet.json', owner: 'juan294', since: '2026-09-20', through: '2026-10-01',
    });
    expect(parseArguments(['fleet', 'enroll', '--registry', '/tmp/fleet.json', '--repository', 'juan294/app', '--workflow', '.github/workflows/ci.yml', '--job', 'check'])).toEqual({
      command: 'fleet', action: 'enroll', registryPath: '/tmp/fleet.json', repository: 'juan294/app', workflowPath: '.github/workflows/ci.yml', jobKey: 'check', jobNames: [], sku: 'actions_linux',
    });
    expect(parseArguments(['fleet', 'enroll', '--registry', 'r', '--repository', 'juan294/app', '--workflow', 'w.yml', '--job', 'shard', '--job-name', 'Shard 1', '--job-name', 'Shard 2', '--sku', 'actions_linux'])).toEqual({
      command: 'fleet', action: 'enroll', registryPath: 'r', repository: 'juan294/app', workflowPath: 'w.yml', jobKey: 'shard', jobNames: ['Shard 1', 'Shard 2'], sku: 'actions_linux',
    });
    expect(parseArguments(['fleet', 'cutover', '--registry', 'r', '--id', 'P1', '--commit', 'a'.repeat(40)])).toEqual({
      command: 'fleet', action: 'cutover', registryPath: 'r', id: 'P1', commit: 'a'.repeat(40),
    });
    expect(parseArguments(['fleet', 'verify', '--registry', 'r'])).toEqual({ command: 'fleet', action: 'verify', registryPath: 'r' });
    expect(parseArguments(['fleet', 'show', '--registry', 'r'])).toEqual({ command: 'fleet', action: 'show', registryPath: 'r' });
    expect(parseArguments(['fleet', 'controller-config', '--registry', 'r', '--id', 'P1', '--state-root', '/tmp/runner', '--template', '/tmp/t.json'])).toEqual({
      command: 'fleet', action: 'controller-config', registryPath: 'r', id: 'P1', stateRoot: '/tmp/runner', templatePath: '/tmp/t.json',
    });
    expect(parseArguments(['fleet', 'controller-config', '--registry', 'r', '--id', 'P1', '--state-root', '/tmp/runner', '--template', '/tmp/t.json', '--allowed-branch', 'main'])).toEqual({
      command: 'fleet', action: 'controller-config', registryPath: 'r', id: 'P1', stateRoot: '/tmp/runner', templatePath: '/tmp/t.json', allowedBranch: 'main',
    });
    expect(parseArguments(['fleet', 'permit-proposal', '--registry', 'r', '--id', 'P1', '--candidate-digest', 'd', '--quote', '/tmp/q.json'])).toEqual({
      command: 'fleet', action: 'permit-proposal', registryPath: 'r', id: 'P1', candidateDigest: 'd', quotePath: '/tmp/q.json',
    });
    expect(parseArguments(['fleet', 'publish', '--registry', 'r', '--store', '/tmp/store', '--since', '2026-09-13', '--output', '/tmp/out.md'])).toEqual({
      command: 'fleet', action: 'publish', registryPath: 'r', storePath: '/tmp/store', since: '2026-09-13', outputPath: '/tmp/out.md',
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
    [['telemetry', 'report', '--store', '/tmp/data', '--since', '2026-09-13', '--registry'], /requires a value/],
    [['telemetry', 'collect', '--owner', 'juan294', '--store', '/tmp/data', '--registry', 'r'], /report-only option/],
    [['fleet'], /requires a subcommand/],
    [['fleet', 'migrate', '--registry', 'r'], /Unknown fleet command/],
    [['fleet', 'verify'], /requires --registry/],
    [['fleet', 'init', '--registry', 'r'], /requires --owner/],
    [['fleet', 'init', '--registry', 'r', '--owner', 'juan294', '--since', 'soon'], /YYYY-MM-DD/],
    [['fleet', 'enroll', '--registry', 'r', '--repository', 'juan294/app', '--workflow', 'w.yml'], /requires --job/],
    [['fleet', 'enroll', '--registry', 'r', '--repository', 'app', '--workflow', 'w.yml', '--job', 'j'], /owner\/name/],
    [['fleet', 'enroll', '--registry', 'r', '--repository', 'juan294/app', '--workflow', 'w.yml', '--job', 'j', '--sku', 'actions_gpu'], /--sku must be one of/],
    [['fleet', 'cutover', '--registry', 'r', '--id', 'P1'], /requires --commit/],
    [['fleet', 'cutover', '--registry', 'r', '--id', 'P1', '--commit', 'abc'], /40-character/],
    [['fleet', 'cutover', '--registry', 'r', '--commit', 'a'.repeat(40)], /requires --id/],
    [['fleet', 'verify', '--registry', 'r', '--id', 'P1'], /Unknown option "--id" for fleet verify/],
    [['fleet', 'show', '--registry', 'r', '--wat'], /Unknown option/],
    [['fleet', 'controller-config', '--registry', 'r', '--id', 'P1', '--state-root', '/tmp/runner'], /requires --template/],
    [['fleet', 'controller-config', '--registry', 'r', '--id', 'P1', '--template', 't'], /requires --state-root/],
    [['fleet', 'controller-config', '--registry', 'r', '--state-root', 's', '--template', 't'], /requires --id/],
    [['fleet', 'permit-proposal', '--registry', 'r', '--id', 'P1', '--quote', 'q'], /requires --candidate-digest/],
    [['fleet', 'permit-proposal', '--registry', 'r', '--id', 'P1', '--candidate-digest', 'd'], /requires --quote/],
    [['fleet', 'publish', '--registry', 'r', '--store', 's', '--since', '2026-09-13'], /requires --output/],
    [['fleet', 'publish', '--registry', 'r', '--store', 's', '--output', 'o'], /requires --since/],
    [['fleet', 'publish', '--registry', 'r', '--since', '2026-09-13', '--output', 'o'], /requires --store/],
    [['fleet', 'publish', '--registry', 'r', '--store', 's', '--since', 'soon', '--output', 'o'], /YYYY-MM-DD/],
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
