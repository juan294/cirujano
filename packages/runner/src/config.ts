import { RUNNER_SCHEMA_VERSION, type RunnerConfig } from './contracts.js';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

const ROOT_KEYS = [
  'schemaVersion', 'repository', 'workflowIds', 'allowedBranch', 'eligibleJobNames',
  'runnerLabel', 'slots', 'nebius', 'ssh', 'ownership', 'timing', 'rates',
] as const;
const REPOSITORY_KEYS = ['id', 'nameWithOwner', 'visibility'] as const;
const NEBIUS_KEYS = ['profile', 'projectId', 'subnetId', 'imageId', 'platform', 'preset', 'diskType', 'diskSizeGiB'] as const;
const SSH_KEYS = ['publicKey', 'fingerprint'] as const;
const OWNERSHIP_KEYS = ['controllerId', 'resourcePrefix'] as const;
const TIMING_KEYS = ['pollIntervalMs', 'idleGraceMs', 'bootTimeoutMs', 'maxJobMs', 'lifetimeMs', 'shutdownMarginMs'] as const;
const RATE_KEYS = ['currency', 'quotedAt', 'source', 'computeUsdPerHour', 'diskUsdPerGibMonth', 'networkEgressUsdPerGib', 'hostedUsdPerMinute'] as const;

export function parseRunnerConfig(input: unknown): RunnerConfig {
  const root = objectAt(input, 'config');
  exactKeys(root, ROOT_KEYS, 'config');
  if (root['schemaVersion'] !== RUNNER_SCHEMA_VERSION) throw new ConfigError('schemaVersion must be 1');

  const repository = objectAt(root['repository'], 'repository');
  exactKeys(repository, REPOSITORY_KEYS, 'repository');
  const repositoryId = positiveInteger(repository['id'], 'repository.id');
  const nameWithOwner = nonemptyString(repository['nameWithOwner'], 'repository.nameWithOwner');
  if (!/^[^/\s]+\/[^/\s]+$/.test(nameWithOwner)) throw new ConfigError('repository.nameWithOwner must be owner/name');
  if (repository['visibility'] !== 'private') throw new ConfigError('repository.visibility must be private');

  const nebius = objectAt(root['nebius'], 'nebius');
  exactKeys(nebius, NEBIUS_KEYS, 'nebius');
  const ssh = objectAt(root['ssh'], 'ssh');
  exactKeys(ssh, SSH_KEYS, 'ssh');
  const ownership = objectAt(root['ownership'], 'ownership');
  exactKeys(ownership, OWNERSHIP_KEYS, 'ownership');
  const timing = objectAt(root['timing'], 'timing');
  exactKeys(timing, TIMING_KEYS, 'timing');
  const rates = objectAt(root['rates'], 'rates');
  exactKeys(rates, RATE_KEYS, 'rates');

  const workflowIds = positiveIntegerArray(root['workflowIds'], 'workflowIds');
  const eligibleJobNames = stringArray(root['eligibleJobNames'], 'eligibleJobNames');
  if (root['slots'] !== 1) throw new ConfigError('slots must equal 1 for the pilot');

  const parsed: RunnerConfig = {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    repository: { id: repositoryId, nameWithOwner, visibility: 'private' },
    workflowIds,
    allowedBranch: nonemptyString(root['allowedBranch'], 'allowedBranch'),
    eligibleJobNames,
    runnerLabel: nonemptyString(root['runnerLabel'], 'runnerLabel'),
    slots: 1,
    nebius: {
      profile: nonemptyString(nebius['profile'], 'nebius.profile'),
      projectId: nonemptyString(nebius['projectId'], 'nebius.projectId'),
      subnetId: nonemptyString(nebius['subnetId'], 'nebius.subnetId'),
      imageId: nonemptyString(nebius['imageId'], 'nebius.imageId'),
      platform: nonemptyString(nebius['platform'], 'nebius.platform'),
      preset: nonemptyString(nebius['preset'], 'nebius.preset'),
      diskType: nonemptyString(nebius['diskType'], 'nebius.diskType'),
      diskSizeGiB: positiveFinite(nebius['diskSizeGiB'], 'nebius.diskSizeGiB'),
    },
    ssh: {
      publicKey: nonemptyString(ssh['publicKey'], 'ssh.publicKey'),
      fingerprint: nonemptyString(ssh['fingerprint'], 'ssh.fingerprint'),
    },
    ownership: {
      controllerId: nonemptyString(ownership['controllerId'], 'ownership.controllerId'),
      resourcePrefix: nonemptyString(ownership['resourcePrefix'], 'ownership.resourcePrefix'),
    },
    timing: {
      pollIntervalMs: positiveFinite(timing['pollIntervalMs'], 'timing.pollIntervalMs'),
      idleGraceMs: positiveFinite(timing['idleGraceMs'], 'timing.idleGraceMs'),
      bootTimeoutMs: positiveFinite(timing['bootTimeoutMs'], 'timing.bootTimeoutMs'),
      maxJobMs: positiveFinite(timing['maxJobMs'], 'timing.maxJobMs'),
      lifetimeMs: positiveFinite(timing['lifetimeMs'], 'timing.lifetimeMs'),
      shutdownMarginMs: positiveFinite(timing['shutdownMarginMs'], 'timing.shutdownMarginMs'),
    },
    rates: {
      currency: nonemptyString(rates['currency'], 'rates.currency'),
      quotedAt: nonemptyString(rates['quotedAt'], 'rates.quotedAt'),
      source: nonemptyString(rates['source'], 'rates.source'),
      computeUsdPerHour: nonnegativeFinite(rates['computeUsdPerHour'], 'rates.computeUsdPerHour'),
      diskUsdPerGibMonth: nonnegativeFinite(rates['diskUsdPerGibMonth'], 'rates.diskUsdPerGibMonth'),
      networkEgressUsdPerGib: nonnegativeFinite(rates['networkEgressUsdPerGib'], 'rates.networkEgressUsdPerGib'),
      hostedUsdPerMinute: nonnegativeFinite(rates['hostedUsdPerMinute'], 'rates.hostedUsdPerMinute'),
    },
  };
  if (parsed.nebius.platform !== 'cpu-d3') throw new ConfigError('nebius.platform must be cpu-d3 for the pilot');
  if (parsed.nebius.preset !== '4vcpu-16gb') throw new ConfigError('nebius.preset must be 4vcpu-16gb for the pilot');
  if (parsed.nebius.diskType !== 'network-ssd') throw new ConfigError('nebius.diskType must be network-ssd for the pilot');
  if (parsed.nebius.diskSizeGiB !== 80) throw new ConfigError('nebius.diskSizeGiB must equal 80 for the pilot');
  if (parsed.timing.maxJobMs + parsed.timing.shutdownMarginMs > parsed.timing.lifetimeMs) {
    throw new ConfigError('maxJobMs plus shutdownMarginMs must fit within lifetimeMs');
  }
  return parsed;
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(object: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(object).find((key) => !allowedSet.has(key));
  if (unknown !== undefined) throw new ConfigError(`${path} contains unknown key ${unknown}`);
  const missing = allowed.find((key) => !Object.hasOwn(object, key));
  if (missing !== undefined) throw new ConfigError(`${path} is missing ${missing}`);
}

function nonemptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ConfigError(`${path} must be a nonempty string`);
  return value;
}

function positiveFinite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new ConfigError(`${path} must be a positive finite number`);
  return value;
}

function nonnegativeFinite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ConfigError(`${path} must be a non-negative finite number`);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = positiveFinite(value, path);
  if (!Number.isInteger(parsed)) throw new ConfigError(`${path} must be an integer`);
  return parsed;
}

function positiveIntegerArray(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new ConfigError(`${path} must be a nonempty array`);
  const parsed = value.map((entry, index) => positiveInteger(entry, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) throw new ConfigError(`${path} must not contain duplicates`);
  return parsed;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new ConfigError(`${path} must be a nonempty array`);
  const parsed = value.map((entry, index) => nonemptyString(entry, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) throw new ConfigError(`${path} must not contain duplicates`);
  return parsed;
}
