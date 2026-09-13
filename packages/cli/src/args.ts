export const VERSION = '0.0.1';

export const USAGE = [
  'Usage:',
  '  cirujano estimate --jobs <github-jobs.json> [--format json|text]',
  '  cirujano runner inspect --config <runner.json> [--format json|text]',
  '  cirujano runner watch --config <runner.json> [--permit <permit.json>] [--dry-run]',
  '  cirujano runner stop --config <runner.json> --permit <permit.json>',
  '  cirujano runner cleanup --config <runner.json> --permit <permit.json>',
  '  cirujano runner report --state <state.json> --format json',
  '  cirujano --help',
  '  cirujano --version',
  '',
  'estimate reads the JSON body of GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
  'and reports the billable minutes GitHub charges for that run.',
].join('\n');

export type OutputFormat = 'json' | 'text';

export interface EstimateArguments {
  command: 'estimate';
  jobsPath: string;
  format: OutputFormat;
}

export interface HelpArguments {
  command: 'help';
}

export interface VersionArguments {
  command: 'version';
}

export interface RunnerInspectArguments {
  command: 'runner';
  action: 'inspect';
  configPath: string;
  format: OutputFormat;
}

export interface RunnerWatchArguments {
  command: 'runner';
  action: 'watch';
  configPath: string;
  permitPath?: string;
  dryRun: boolean;
}

export interface RunnerMutationArguments {
  command: 'runner';
  action: 'stop' | 'cleanup';
  configPath: string;
  permitPath: string;
}

export interface RunnerReportArguments {
  command: 'runner';
  action: 'report';
  statePath: string;
  format: 'json';
}

export type RunnerArguments = RunnerInspectArguments | RunnerWatchArguments | RunnerMutationArguments | RunnerReportArguments;
export type ParsedArguments = EstimateArguments | HelpArguments | VersionArguments | RunnerArguments;

export class ArgumentError extends Error {
  override readonly name = 'ArgumentError';
}

export function parseArguments(argv: readonly string[]): ParsedArguments {
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h') {
    return { command: 'help' };
  }
  if (first === '--version' || first === '-v') {
    return { command: 'version' };
  }
  if (first === 'runner') return parseRunnerArguments(rest);
  if (first !== 'estimate') {
    throw new ArgumentError(`Unknown command "${first}".`);
  }

  let jobsPath: string | undefined;
  let format: OutputFormat = 'text';
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    switch (flag) {
      case '--jobs':
        if (value === undefined || value.startsWith('--')) {
          throw new ArgumentError('--jobs requires a file path.');
        }
        jobsPath = value;
        index += 1;
        break;
      case '--format':
        if (value !== 'json' && value !== 'text') {
          throw new ArgumentError('--format must be "json" or "text".');
        }
        format = value;
        index += 1;
        break;
      default:
        throw new ArgumentError(`Unknown option "${flag ?? ''}" for estimate.`);
    }
  }
  if (jobsPath === undefined) {
    throw new ArgumentError('estimate requires --jobs <file>.');
  }
  return { command: 'estimate', jobsPath, format };
}

function parseRunnerArguments(argv: readonly string[]): RunnerArguments {
  const [action, ...rest] = argv;
  if (action === undefined) throw new ArgumentError('runner requires a subcommand.');
  if (action !== 'inspect' && action !== 'watch' && action !== 'stop' && action !== 'cleanup' && action !== 'report') {
    throw new ArgumentError(`Unknown runner command "${action}".`);
  }
  let configPath: string | undefined;
  let permitPath: string | undefined;
  let statePath: string | undefined;
  let format: OutputFormat | undefined;
  let dryRun = false;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--dry-run') {
      if (action !== 'watch') throw new ArgumentError(`Unknown option "${flag}" for runner ${action}.`);
      dryRun = true;
      continue;
    }
    if (flag !== '--config' && flag !== '--permit' && flag !== '--state' && flag !== '--format') {
      throw new ArgumentError(`Unknown option "${flag ?? ''}" for runner ${action}.`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new ArgumentError(`${flag} requires a file path or value.`);
    index += 1;
    if (flag === '--config') configPath = value;
    else if (flag === '--permit') permitPath = value;
    else if (flag === '--state') statePath = value;
    else if (value === 'json' || value === 'text') format = value;
    else throw new ArgumentError('--format must be "json" or "text".');
  }
  if (action === 'report') {
    if (configPath !== undefined || permitPath !== undefined || dryRun) throw new ArgumentError(`Unknown option for runner ${action}.`);
    if (statePath === undefined) throw new ArgumentError('runner report requires --state <file>.');
    if (format === undefined) throw new ArgumentError('runner report requires --format json.');
    if (format !== 'json') throw new ArgumentError('runner report only supports --format json.');
    return { command: 'runner', action, statePath, format };
  }
  if (statePath !== undefined) throw new ArgumentError(`Unknown option "--state" for runner ${action}.`);
  if (configPath === undefined) throw new ArgumentError(`runner ${action} requires --config <file>.`);
  if (action === 'inspect') {
    if (permitPath !== undefined || dryRun) throw new ArgumentError(`Unknown option for runner ${action}.`);
    return { command: 'runner', action, configPath, format: format ?? 'text' };
  }
  if (format !== undefined) throw new ArgumentError(`Unknown option "--format" for runner ${action}.`);
  if (action === 'watch') {
    return permitPath === undefined
      ? { command: 'runner', action, configPath, dryRun }
      : { command: 'runner', action, configPath, permitPath, dryRun };
  }
  if (permitPath === undefined) throw new ArgumentError(`runner ${action} requires --permit <file>.`);
  return { command: 'runner', action, configPath, permitPath };
}
