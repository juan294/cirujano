export const VERSION = '0.0.1';

export const USAGE = [
  'Usage:',
  '  cirujano estimate --jobs <github-jobs.json> [--format json|text]',
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

export type ParsedArguments = EstimateArguments | HelpArguments | VersionArguments;

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
