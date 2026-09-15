import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { validIsoDate } from './args.js';
import { HOSTED_SKUS, TELEMETRY_RATES, type HostedSku } from './telemetry.js';

/**
 * Exclusions locked by the fleet telemetry plan (docs/plans/2026-09-13-fleet-telemetry.md).
 * Frozen products cover their `-cli`, `-alexa` and `-upptime` companions under the registry owner.
 */
export const LOCKED_EXCLUSIONS = {
  frozenProducts: ['chapa', 'spoken-letter'],
  companionSuffixes: ['-cli', '-alexa', '-upptime'],
  repositories: ['frivas/contribution-dashboard', 'behboud/opencode-rpi', 'juan294/home-network'],
  lockedBy: 'fleet-telemetry plan 2026-09-13',
} as const;

export type EnrollmentStatus = 'proposed' | 'cut-over' | 'reverted';

export interface FleetExclusion {
  repository: string;
  reason: string;
  lockedBy: string;
}

export interface WorkflowIdentity {
  commit: string;
  workflowBlobSha: string;
  runsOn: string[];
  recordedAt: string;
}

export interface EnrollmentController {
  stateDirectory: string;
  controllerId: string;
  resourcePrefix: string;
  permitId: string | null;
}

export interface FleetEnrollment {
  id: string;
  repository: string;
  repositoryId: number;
  workflowPath: string;
  workflowId: number;
  workflowName: string;
  jobKey: string;
  jobNames: string[];
  sku: HostedSku;
  runnerLabel: string;
  status: EnrollmentStatus;
  before: WorkflowIdentity;
  after: WorkflowIdentity | null;
  controller: EnrollmentController | null;
  notes: string[];
}

export interface FleetRegistry {
  schemaVersion: 1;
  owner: string;
  measurementWindow: { since: string; through: string };
  exclusions: FleetExclusion[];
  enrollments: FleetEnrollment[];
}

export class FleetRegistryError extends Error {
  override readonly name = 'FleetRegistryError';
}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u;
export const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ENROLLMENT_ID_PATTERN = /^P[1-9]\d{0,3}$/u;
const STATUSES: readonly EnrollmentStatus[] = ['proposed', 'cut-over', 'reverted'];
const ENROLLMENT_KEYS = [
  'id', 'repository', 'repositoryId', 'workflowPath', 'workflowId', 'workflowName', 'jobKey', 'jobNames',
  'sku', 'runnerLabel', 'status', 'before', 'after', 'controller', 'notes',
] as const;

export function lockedExclusionRepositories(owner: string): string[] {
  return [
    ...LOCKED_EXCLUSIONS.frozenProducts.map((product) => `${owner}/${product}`),
    ...LOCKED_EXCLUSIONS.repositories,
  ];
}

export function enrollmentLabelFor(sku: HostedSku): string {
  const label = Object.entries(TELEMETRY_RATES.cirujanoLabels)
    .find(([name, labelSku]) => labelSku === sku && name.startsWith('cirujano-baseline-'))?.[0];
  if (label === undefined) throw new FleetRegistryError(`sku ${sku} has no enrolled Cirujano label`);
  return label;
}

/** Plan phase 1 `fleetCutover`: the migrated selection is `[self-hosted, linux, x64, <label>]`. */
export function requiredSelfHostedLabels(runnerLabel: string): string[] {
  return ['self-hosted', 'linux', 'x64', runnerLabel];
}

/** The live (not reverted) enrollment of one workflow job, if any. */
export function findActiveEnrollment(registry: Pick<FleetRegistry, 'enrollments'>, repository: string, workflowPath: string, jobKey: string): FleetEnrollment | undefined {
  return registry.enrollments.find((entry) => entry.status !== 'reverted' && entry.repository === repository && entry.workflowPath === workflowPath && entry.jobKey === jobKey);
}

/** Exact exclusion, or a frozen product's companion under the registry owner. */
export function isExcludedRepository(registry: Pick<FleetRegistry, 'owner' | 'exclusions'>, repository: string): boolean {
  if (registry.exclusions.some((exclusion) => exclusion.repository === repository)) return true;
  return LOCKED_EXCLUSIONS.frozenProducts.some((product) => LOCKED_EXCLUSIONS.companionSuffixes
    .some((suffix) => repository === `${registry.owner}/${product}${suffix}`));
}

export function parseFleetRegistry(input: unknown): FleetRegistry {
  const root = strictObject(input, ['schemaVersion', 'owner', 'measurementWindow', 'exclusions', 'enrollments'], 'registry');
  if (root['schemaVersion'] !== 1) throw new FleetRegistryError('registry schemaVersion must be 1');
  const owner = text(root['owner'], 'owner');
  if (!OWNER_PATTERN.test(owner)) throw new FleetRegistryError('owner must be a GitHub login');
  const window = strictObject(root['measurementWindow'], ['since', 'through'], 'measurementWindow');
  const since = isoDate(window['since'], 'measurementWindow.since');
  const through = isoDate(window['through'], 'measurementWindow.through');
  if (since > through) throw new FleetRegistryError('measurementWindow.since must not follow through');

  const exclusions = array(root['exclusions'], 'exclusions').map((entry, index) => {
    const exclusion = strictObject(entry, ['repository', 'reason', 'lockedBy'], `exclusions[${index}]`);
    const repository = text(exclusion['repository'], `exclusions[${index}].repository`);
    if (!REPOSITORY_PATTERN.test(repository)) throw new FleetRegistryError(`exclusions[${index}].repository must be owner/name`);
    return {
      repository,
      reason: text(exclusion['reason'], `exclusions[${index}].reason`),
      lockedBy: text(exclusion['lockedBy'], `exclusions[${index}].lockedBy`),
    };
  });
  for (const locked of lockedExclusionRepositories(owner)) {
    if (!exclusions.some(({ repository }) => repository === locked)) throw new FleetRegistryError(`locked exclusion ${locked} is missing`);
  }
  const partial = { owner, exclusions };

  const enrollments: FleetEnrollment[] = [];
  for (const [index, entry] of array(root['enrollments'], 'enrollments').entries()) {
    const enrollment = parseEnrollment(entry, `enrollments[${index}]`, partial);
    if (enrollments.some(({ id }) => id === enrollment.id)) throw new FleetRegistryError(`duplicate enrollment id ${enrollment.id}`);
    // A reverted enrollment keeps its history; the same job may be enrolled afresh later.
    const existing = enrollment.status === 'reverted' ? undefined : findActiveEnrollment({ enrollments }, enrollment.repository, enrollment.workflowPath, enrollment.jobKey);
    if (existing !== undefined) throw new FleetRegistryError(`${enrollment.repository} ${enrollment.workflowPath} job ${enrollment.jobKey} is already enrolled as ${existing.id}`);
    enrollments.push(enrollment);
  }
  return { schemaVersion: 1, owner, measurementWindow: { since, through }, exclusions, enrollments };
}

function parseEnrollment(input: unknown, name: string, registry: Pick<FleetRegistry, 'owner' | 'exclusions'>): FleetEnrollment {
  const root = strictObject(input, ENROLLMENT_KEYS, name);
  const id = text(root['id'], `${name}.id`);
  if (!ENROLLMENT_ID_PATTERN.test(id)) throw new FleetRegistryError(`${name}.id must look like P1`);
  const repository = text(root['repository'], `${name}.repository`);
  if (!REPOSITORY_PATTERN.test(repository)) throw new FleetRegistryError(`${name}.repository must be owner/name`);
  if (!repository.startsWith(`${registry.owner}/`)) throw new FleetRegistryError(`${name}.repository must belong to ${registry.owner}`);
  if (isExcludedRepository(registry, repository)) throw new FleetRegistryError(`${name}.repository ${repository} is excluded from migration`);
  const sku = root['sku'];
  if (typeof sku !== 'string' || !(HOSTED_SKUS as readonly string[]).includes(sku)) throw new FleetRegistryError(`${name}.sku must be one of ${HOSTED_SKUS.join(', ')}`);
  const runnerLabel = text(root['runnerLabel'], `${name}.runnerLabel`);
  const labelSku = (TELEMETRY_RATES.cirujanoLabels as Record<string, HostedSku>)[runnerLabel];
  if (labelSku !== sku || !runnerLabel.startsWith('cirujano-baseline-')) {
    throw new FleetRegistryError(`${name}.runnerLabel ${runnerLabel} is not enrolled for sku ${sku}`);
  }
  const status = root['status'];
  if (typeof status !== 'string' || !STATUSES.includes(status as EnrollmentStatus)) throw new FleetRegistryError(`${name}.status must be one of ${STATUSES.join(', ')}`);
  const before = parseWorkflowIdentity(root['before'], `${name}.before`);
  if (before.runsOn.some((label) => label.startsWith('cirujano-') || label === 'self-hosted')) {
    throw new FleetRegistryError(`${name}.before.runsOn must be a hosted runner selection`);
  }
  const after = root['after'] === null ? null : parseWorkflowIdentity(root['after'], `${name}.after`);
  if (status === 'proposed' && after !== null) throw new FleetRegistryError(`proposed enrollment ${id} must not carry an after record`);
  if (status !== 'proposed' && after === null) throw new FleetRegistryError(`${status} enrollment ${id} requires an after record`);
  if (after !== null && requiredSelfHostedLabels(runnerLabel).some((label) => !after.runsOn.includes(label))) {
    throw new FleetRegistryError(`${name}.after.runsOn must include self-hosted, linux, x64 and ${runnerLabel}`);
  }
  let controller: EnrollmentController | null = null;
  if (root['controller'] !== null) {
    const value = strictObject(root['controller'], ['stateDirectory', 'controllerId', 'resourcePrefix', 'permitId'], `${name}.controller`);
    const permitId = value['permitId'];
    if (permitId !== null && (typeof permitId !== 'string' || permitId.length === 0)) throw new FleetRegistryError(`${name}.controller.permitId must be null or a nonempty string`);
    controller = {
      stateDirectory: text(value['stateDirectory'], `${name}.controller.stateDirectory`),
      controllerId: text(value['controllerId'], `${name}.controller.controllerId`),
      resourcePrefix: text(value['resourcePrefix'], `${name}.controller.resourcePrefix`),
      permitId: permitId as string | null,
    };
  }
  return {
    id,
    repository,
    repositoryId: positiveInteger(root['repositoryId'], `${name}.repositoryId`),
    workflowPath: text(root['workflowPath'], `${name}.workflowPath`),
    workflowId: positiveInteger(root['workflowId'], `${name}.workflowId`),
    workflowName: text(root['workflowName'], `${name}.workflowName`),
    jobKey: text(root['jobKey'], `${name}.jobKey`),
    jobNames: stringArray(root['jobNames'], `${name}.jobNames`),
    sku: sku as HostedSku,
    runnerLabel,
    status: status as EnrollmentStatus,
    before,
    after,
    controller,
    notes: array(root['notes'], `${name}.notes`).map((note, index) => text(note, `${name}.notes[${index}]`)),
  };
}

function parseWorkflowIdentity(input: unknown, name: string): WorkflowIdentity {
  const root = strictObject(input, ['commit', 'workflowBlobSha', 'runsOn', 'recordedAt'], name);
  const commit = text(root['commit'], `${name}.commit`);
  const workflowBlobSha = text(root['workflowBlobSha'], `${name}.workflowBlobSha`);
  if (!SHA_PATTERN.test(commit) || !SHA_PATTERN.test(workflowBlobSha)) throw new FleetRegistryError(`${name} requires 40-character commit and blob SHAs`);
  return { commit, workflowBlobSha, runsOn: stringArray(root['runsOn'], `${name}.runsOn`), recordedAt: timestamp(root['recordedAt'], `${name}.recordedAt`) };
}

/** Owner-only atomic write, mirroring writeTelemetrySnapshot (telemetry.ts). */
export async function writeFleetRegistry(path: string, registry: FleetRegistry): Promise<void> {
  parseFleetRegistry(JSON.parse(JSON.stringify(registry)));
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function strictObject(input: unknown, allowed: readonly string[], name: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new FleetRegistryError(`${name} must be an object`);
  const root = input as Record<string, unknown>;
  const unknown = Object.keys(root).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw new FleetRegistryError(`${name} contains unknown key ${unknown}`);
  const missing = allowed.find((key) => !Object.hasOwn(root, key));
  if (missing !== undefined) throw new FleetRegistryError(`${name} is missing ${missing}`);
  return root;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new FleetRegistryError(`${name} must be an array`);
  return value;
}

function stringArray(value: unknown, name: string): string[] {
  const items = array(value, name).map((item, index) => text(item, `${name}[${index}]`));
  if (items.length === 0) throw new FleetRegistryError(`${name} must not be empty`);
  return items;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new FleetRegistryError(`${name} must be a nonempty string`);
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new FleetRegistryError(`${name} must be a positive integer`);
  return value;
}

function timestamp(value: unknown, name: string): string {
  const result = text(value, name);
  if (!Number.isFinite(Date.parse(result))) throw new FleetRegistryError(`${name} must be a timestamp`);
  return result;
}

function isoDate(value: unknown, name: string): string {
  const result = text(value, name);
  if (!validIsoDate(result)) throw new FleetRegistryError(`${name} must be a YYYY-MM-DD date`);
  return result;
}
