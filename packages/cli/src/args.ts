export const VERSION = '0.0.1';

export const USAGE = [
  'Usage:',
  '  cirujano estimate --jobs <github-jobs.json> [--format json|text]',
  '  cirujano runner inspect --config <runner.json> [--format json|text]',
  '  cirujano runner watch --config <runner.json> [--permit <permit.json>] [--dry-run]',
  '  cirujano runner stop --config <runner.json> --permit <permit.json>',
  '  cirujano runner cleanup --config <runner.json> --permit <permit.json>',
  '  cirujano runner report --state <state.json> --format json',
  '  cirujano telemetry collect --owner <login> --store <directory> [--lookback-hours 48]',
  '  cirujano telemetry report --store <directory> --since <YYYY-MM-DD> [--format json|markdown] [--registry <fleet-registry.json>]',
  '  cirujano fleet init --registry <file> --owner <login> [--since <YYYY-MM-DD>] [--through <YYYY-MM-DD>]',
  '  cirujano fleet enroll --registry <file> --repository <owner/name> --workflow <path> --job <key> [--job-name <name>]... [--sku actions_linux]',
  '  cirujano fleet cutover --registry <file> --id <P#> --commit <sha>',
  '  cirujano fleet verify --registry <file>',
  '  cirujano fleet show --registry <file>',
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

export interface TelemetryCollectArguments {
  command: 'telemetry';
  action: 'collect';
  owner: string;
  storePath: string;
  lookbackHours: number;
}

export interface TelemetryReportArguments {
  command: 'telemetry';
  action: 'report';
  storePath: string;
  since: string;
  format: 'json' | 'markdown';
  registryPath?: string;
}

export type TelemetryArguments = TelemetryCollectArguments | TelemetryReportArguments;

export const FLEET_SKUS = ['actions_linux', 'actions_linux_arm', 'actions_windows', 'actions_macos'] as const;
export type FleetSku = typeof FLEET_SKUS[number];

export interface FleetInitArguments {
  command: 'fleet';
  action: 'init';
  registryPath: string;
  owner: string;
  since: string;
  through: string;
}

export interface FleetEnrollArguments {
  command: 'fleet';
  action: 'enroll';
  registryPath: string;
  repository: string;
  workflowPath: string;
  jobKey: string;
  jobNames: string[];
  sku: FleetSku;
}

export interface FleetCutoverArguments {
  command: 'fleet';
  action: 'cutover';
  registryPath: string;
  id: string;
  commit: string;
}

export interface FleetReadArguments {
  command: 'fleet';
  action: 'verify' | 'show';
  registryPath: string;
}

export type FleetArguments = FleetInitArguments | FleetEnrollArguments | FleetCutoverArguments | FleetReadArguments;

export type RunnerArguments = RunnerInspectArguments | RunnerWatchArguments | RunnerMutationArguments | RunnerReportArguments;
export type ParsedArguments = EstimateArguments | HelpArguments | VersionArguments | RunnerArguments | TelemetryArguments | FleetArguments;

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
  if (first === 'telemetry') return parseTelemetryArguments(rest);
  if (first === 'fleet') return parseFleetArguments(rest);
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

function parseTelemetryArguments(argv: readonly string[]): TelemetryArguments {
  const [action, ...rest] = argv;
  if (action === undefined) throw new ArgumentError('telemetry requires a subcommand.');
  if (action !== 'collect' && action !== 'report') throw new ArgumentError(`Unknown telemetry command "${action}".`);
  let owner: string | undefined;
  let storePath: string | undefined;
  let since: string | undefined;
  let registryPath: string | undefined;
  let format: 'json' | 'markdown' = action === 'report' ? 'markdown' : 'json';
  let lookbackHours = 48;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new ArgumentError(`${flag ?? 'option'} requires a value.`);
    index += 1;
    if (flag === '--owner') owner = value;
    else if (flag === '--store') storePath = value;
    else if (flag === '--since') since = value;
    else if (flag === '--registry') registryPath = value;
    else if (flag === '--lookback-hours') {
      lookbackHours = Number(value);
      if (!Number.isInteger(lookbackHours) || lookbackHours < 1 || lookbackHours > 1080) {
        throw new ArgumentError('--lookback-hours must be an integer from 1 through 1080.');
      }
    } else if (flag === '--format' && (value === 'json' || value === 'markdown')) format = value;
    else throw new ArgumentError(`Unknown option "${flag ?? ''}" for telemetry ${action}.`);
  }
  if (storePath === undefined) throw new ArgumentError(`telemetry ${action} requires --store <directory>.`);
  if (action === 'collect') {
    if (owner === undefined) throw new ArgumentError('telemetry collect requires --owner <login>.');
    if (since !== undefined || format !== 'json' || registryPath !== undefined) throw new ArgumentError('telemetry collect received a report-only option.');
    return { command: 'telemetry', action, owner, storePath, lookbackHours };
  }
  if (owner !== undefined || lookbackHours !== 48) throw new ArgumentError('telemetry report received a collect-only option.');
  if (since === undefined || !validIsoDate(since)) {
    throw new ArgumentError('telemetry report requires --since YYYY-MM-DD.');
  }
  return registryPath === undefined
    ? { command: 'telemetry', action, storePath, since, format }
    : { command: 'telemetry', action, storePath, since, format, registryPath };
}

const FLEET_ACTIONS = ['init', 'enroll', 'cutover', 'verify', 'show'] as const;
const FLEET_OPTIONS: Record<typeof FLEET_ACTIONS[number], readonly string[]> = {
  init: ['--registry', '--owner', '--since', '--through'],
  enroll: ['--registry', '--repository', '--workflow', '--job', '--job-name', '--sku'],
  cutover: ['--registry', '--id', '--commit'],
  verify: ['--registry'],
  show: ['--registry'],
};

function parseFleetArguments(argv: readonly string[]): FleetArguments {
  const [action, ...rest] = argv;
  if (action === undefined) throw new ArgumentError('fleet requires a subcommand.');
  if (!FLEET_ACTIONS.includes(action as typeof FLEET_ACTIONS[number])) throw new ArgumentError(`Unknown fleet command "${action}".`);
  const allowed = FLEET_OPTIONS[action as typeof FLEET_ACTIONS[number]];
  const values = new Map<string, string>();
  const jobNames: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === undefined || !allowed.includes(flag)) throw new ArgumentError(`Unknown option "${flag ?? ''}" for fleet ${action}.`);
    if (value === undefined || value.startsWith('--')) throw new ArgumentError(`${flag} requires a value.`);
    index += 1;
    if (flag === '--job-name') jobNames.push(value);
    else values.set(flag, value);
  }
  const registryPath = values.get('--registry');
  if (registryPath === undefined) throw new ArgumentError(`fleet ${action} requires --registry <file>.`);
  if (action === 'verify' || action === 'show') return { command: 'fleet', action, registryPath };
  if (action === 'init') {
    const owner = values.get('--owner');
    if (owner === undefined) throw new ArgumentError('fleet init requires --owner <login>.');
    const since = values.get('--since') ?? '2026-09-13';
    const through = values.get('--through') ?? '2026-10-28';
    if (!validIsoDate(since) || !validIsoDate(through)) throw new ArgumentError('fleet init --since and --through require YYYY-MM-DD.');
    return { command: 'fleet', action, registryPath, owner, since, through };
  }
  if (action === 'cutover') {
    const id = values.get('--id');
    const commit = values.get('--commit');
    if (id === undefined) throw new ArgumentError('fleet cutover requires --id <P#>.');
    if (commit === undefined) throw new ArgumentError('fleet cutover requires --commit <sha>.');
    if (!/^[0-9a-f]{40}$/u.test(commit)) throw new ArgumentError('fleet cutover --commit must be a 40-character lowercase SHA.');
    return { command: 'fleet', action, registryPath, id, commit };
  }
  const repository = values.get('--repository');
  const workflowPath = values.get('--workflow');
  const jobKey = values.get('--job');
  const sku = values.get('--sku') ?? 'actions_linux';
  if (repository === undefined) throw new ArgumentError('fleet enroll requires --repository <owner/name>.');
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) throw new ArgumentError('fleet enroll --repository must be owner/name.');
  if (workflowPath === undefined) throw new ArgumentError('fleet enroll requires --workflow <path>.');
  if (jobKey === undefined) throw new ArgumentError('fleet enroll requires --job <key>.');
  if (!FLEET_SKUS.includes(sku as FleetSku)) throw new ArgumentError(`fleet enroll --sku must be one of ${FLEET_SKUS.join(', ')}.`);
  return { command: 'fleet', action: 'enroll', registryPath, repository, workflowPath, jobKey, jobNames, sku: sku as FleetSku };
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
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
