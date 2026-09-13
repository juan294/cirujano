import type { NebiusConfig, RunnerConfig, VmStatus } from '../contracts.js';

const INSTANCE_STATES = ['CREATING', 'UPDATING', 'STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'DELETING', 'ERROR'] as const;
const OPERATION_STATES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;

type InstanceProviderState = typeof INSTANCE_STATES[number];
type OperationState = typeof OPERATION_STATES[number];

export class NebiusParseError extends Error {
  override readonly name = 'NebiusParseError';
}

export interface NebiusCreateRequest {
  metadata: {
    parent_id: string;
    name: string;
    labels: Record<string, string>;
  };
  spec: {
    stopped: true;
    recovery_policy: 'FAIL';
    resources: { platform: 'cpu-d3'; preset: '4vcpu-16gb' };
    network_interfaces: [{ name: 'primary'; subnet_id: string; ip_address: Record<string, never>; public_ip_address: Record<string, never> }];
    boot_disk: {
      attach_mode: 'READ_WRITE';
      managed_disk: {
        name: string;
        labels: Record<string, string>;
        spec: { type: 'NETWORK_SSD'; size_gibibytes: 80; source_image_id: string };
      };
    };
    cloud_init_user_data: string;
  };
}

export interface ExpectedNebiusResource {
  parentId: string;
  name: string;
  labels: Readonly<Record<string, string>>;
  nebius: NebiusConfig;
  instanceId?: string;
}

export interface NebiusInstance {
  id: string;
  parentId: string;
  name: string;
  labels: Record<string, string>;
  providerState: InstanceProviderState;
  state: VmStatus;
  stopped: boolean;
  recoveryPolicy: string;
  platform: string;
  preset: string;
  subnetId: string;
  diskName: string;
  diskType: string;
  diskSizeGiB: number;
  imageId: string;
  privateIp: string | null;
  publicIp: string | null;
  diskIds: string[];
}

export interface NebiusOperation {
  id: string;
  resourceId: string | null;
  state: OperationState;
}

export interface ParsedPage<T> {
  items: T[];
  nextPageToken: string | null;
}

export type CreateReconciliation =
  | { action: 'create' }
  | { action: 'adopt'; instanceId: string }
  | { action: 'block'; reason: string };

export type MutationDecision =
  | { action: 'stop' | 'delete'; instanceId: string }
  | { action: 'done' | 'wait' }
  | { action: 'block'; reason: string };

export interface NebiusCommand {
  file: string;
  args: readonly string[];
  stdin?: string;
  timeoutMs: number;
  shell: false;
}

export interface NebiusCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type NebiusCommandExecutor = (command: NebiusCommand) => Promise<NebiusCommandResult>;

export interface NebiusCliOptions {
  binaryPath: string;
  profile: string;
  projectId: string;
  execute: NebiusCommandExecutor;
  readTimeoutMs?: number;
  mutationTimeoutMs?: number;
}

export function renderCreateRequest(config: RunnerConfig, configHash: string, cloudInitUserData: string): NebiusCreateRequest {
  const labels = ownershipLabels(config.ownership.controllerId, configHash);
  return {
    metadata: {
      parent_id: config.nebius.projectId,
      name: `${config.ownership.resourcePrefix}-vm`,
      labels,
    },
    spec: {
      stopped: true,
      recovery_policy: 'FAIL',
      resources: { platform: 'cpu-d3', preset: '4vcpu-16gb' },
      network_interfaces: [{
        name: 'primary', subnet_id: config.nebius.subnetId, ip_address: {}, public_ip_address: {},
      }],
      boot_disk: {
        attach_mode: 'READ_WRITE',
        managed_disk: {
          name: `${config.ownership.resourcePrefix}-boot`,
          labels,
          spec: {
            type: 'NETWORK_SSD', size_gibibytes: 80, source_image_id: config.nebius.imageId,
          },
        },
      },
      cloud_init_user_data: cloudInitUserData,
    },
  };
}

export function parseInstancePage(json: string): ParsedPage<NebiusInstance> {
  const root = parseJsonObject(json, 'instance page');
  const items = optionalArray(root['items'], 'instance page.items').map((value, index) => parseInstance(value, `instance page.items[${index}]`));
  return { items, nextPageToken: optionalPageToken(root['next_page_token'], 'instance page.next_page_token') };
}

export function parseOperationPage(json: string): ParsedPage<NebiusOperation> {
  const root = parseJsonObject(json, 'operation page');
  const items = optionalArray(root['items'], 'operation page.items').map((value, index) => {
    const operation = objectAt(value, `operation page.items[${index}]`);
    const metadata = objectAt(operation['metadata'], `operation page.items[${index}].metadata`);
    const spec = objectAt(operation['spec'], `operation page.items[${index}].spec`);
    const status = objectAt(operation['status'], `operation page.items[${index}].status`);
    return {
      id: stringAt(metadata['id'], `operation page.items[${index}].metadata.id`),
      resourceId: nullableStringAt(spec['resource_id'], `operation page.items[${index}].spec.resource_id`),
      state: enumAt(status['state'], OPERATION_STATES, `operation page.items[${index}].status.state`),
    };
  });
  return { items, nextPageToken: optionalPageToken(root['next_page_token'], 'operation page.next_page_token') };
}

export function reconcileCreate(input: {
  timedOut: boolean;
  instances: readonly NebiusInstance[];
  operation: NebiusOperation | null;
  expected: ExpectedNebiusResource;
}): CreateReconciliation {
  const related = input.instances.filter((item) => relatedToExpected(item, input.expected));
  if (related.length > 1) return { action: 'block', reason: `found ${related.length} matching resources` };
  if (related.length === 1) {
    const candidate = related[0]!;
    const mismatch = mismatchReason(candidate, input.expected);
    if (mismatch !== null) return { action: 'block', reason: mismatch };
    if (!candidate.stopped) return { action: 'block', reason: `created instance ${candidate.id} was not stopped` };
    if (candidate.state === 'error') return { action: 'block', reason: `instance ${candidate.id} is in ERROR state` };
    if (input.operation?.resourceId !== null && input.operation?.resourceId !== undefined && input.operation.resourceId !== candidate.id) {
      return { action: 'block', reason: `operation resource ${input.operation.resourceId} does not match ${candidate.id}` };
    }
    return { action: 'adopt', instanceId: candidate.id };
  }

  if (!input.timedOut) return { action: 'create' };
  if (input.operation === null) return { action: 'block', reason: 'timed-out create has no conclusive operation result' };
  if (input.operation.state === 'FAILED' || input.operation.state === 'CANCELLED') {
    return { action: 'block', reason: `timed-out create resolved ${input.operation.state} but no owned resource was found` };
  }
  return { action: 'block', reason: `create operation ${input.operation.id} is ${input.operation.state}` };
}

export function decideStop(instance: NebiusInstance | null, expected: ExpectedNebiusResource): MutationDecision {
  if (instance === null) return { action: 'done' };
  const mismatch = mismatchReason(instance, expected);
  if (mismatch !== null) return { action: 'block', reason: mismatch };
  if (instance.state === 'stopped' || instance.state === 'absent') return { action: 'done' };
  if (instance.state === 'stopping') return { action: 'wait' };
  if (instance.state === 'running') return { action: 'stop', instanceId: instance.id };
  return { action: 'block', reason: `cannot stop instance ${instance.id} from ${instance.providerState}` };
}

export function decideDelete(instance: NebiusInstance | null, expected: ExpectedNebiusResource): MutationDecision {
  if (instance === null) return { action: 'done' };
  const mismatch = mismatchReason(instance, expected);
  if (mismatch !== null) return { action: 'block', reason: mismatch };
  if (instance.providerState === 'DELETING') return { action: 'wait' };
  if (instance.state !== 'stopped') return { action: 'block', reason: `cannot delete instance ${instance.id} from ${instance.providerState}` };
  return { action: 'delete', instanceId: instance.id };
}

export class NebiusCli {
  readonly #options: Required<Omit<NebiusCliOptions, 'readTimeoutMs' | 'mutationTimeoutMs'>> & {
    readTimeoutMs: number;
    mutationTimeoutMs: number;
  };

  constructor(options: NebiusCliOptions) {
    if (!options.binaryPath.startsWith('/')) throw new Error('Nebius CLI path must be absolute');
    if (options.profile.trim().length === 0) throw new Error('Nebius profile must be nonempty');
    if (options.projectId.trim().length === 0) throw new Error('Nebius project id must be nonempty');
    this.#options = { ...options, readTimeoutMs: options.readTimeoutMs ?? 30_000, mutationTimeoutMs: options.mutationTimeoutMs ?? 60_000 };
  }

  async create(request: NebiusCreateRequest): Promise<NebiusCommandResult> {
    return this.#mutate(['compute', 'instance', 'create', '-'], `${JSON.stringify(request)}\n`);
  }

  async listInstances(pageToken?: string): Promise<NebiusCommandResult> {
    return this.#read([
      'compute', 'instance', 'list', '--parent-id', this.#options.projectId, '--page-size', '999',
      ...(pageToken === undefined ? [] : ['--page-token', nonemptyArgument(pageToken, 'page token')]),
    ]);
  }

  async listOperationsByParent(pageToken?: string): Promise<NebiusCommandResult> {
    return this.#read([
      'compute', 'instance', 'list-operations-by-parent', '--parent-id', this.#options.projectId, '--page-size', '999',
      ...(pageToken === undefined ? [] : ['--page-token', nonemptyArgument(pageToken, 'page token')]),
    ]);
  }

  async getInstance(instanceId: string): Promise<NebiusCommandResult> {
    assertResourceId(instanceId);
    return this.#read(['compute', 'instance', 'get', '--id', instanceId]);
  }

  async getOperation(operationId: string): Promise<NebiusCommandResult> {
    assertResourceId(operationId);
    return this.#read(['compute', 'instance', 'operation', 'get', '--id', operationId]);
  }

  async start(instanceId: string): Promise<NebiusCommandResult> {
    assertResourceId(instanceId);
    return this.#mutate(['compute', 'instance', 'start', '--id', instanceId]);
  }

  async stop(instanceId: string): Promise<NebiusCommandResult> {
    assertResourceId(instanceId);
    return this.#mutate(['compute', 'instance', 'stop', '--id', instanceId]);
  }

  async delete(instanceId: string): Promise<NebiusCommandResult> {
    assertResourceId(instanceId);
    return this.#mutate(['compute', 'instance', 'delete', '--id', instanceId]);
  }

  async #read(args: string[]): Promise<NebiusCommandResult> {
    const timeoutSeconds = durationSeconds(this.#options.readTimeoutMs);
    return this.#options.execute({
      file: this.#options.binaryPath,
      args: [...args, ...commonArguments(this.#options.profile, timeoutSeconds), '--retries', '3'],
      timeoutMs: this.#options.readTimeoutMs,
      shell: false,
    });
  }

  async #mutate(args: string[], stdin?: string): Promise<NebiusCommandResult> {
    const timeoutSeconds = durationSeconds(this.#options.mutationTimeoutMs);
    return this.#options.execute({
      file: this.#options.binaryPath,
      args: [...args, ...commonArguments(this.#options.profile, timeoutSeconds), '--retries', '1', '--async'],
      ...(stdin === undefined ? {} : { stdin }),
      timeoutMs: this.#options.mutationTimeoutMs,
      shell: false,
    });
  }
}

function parseInstance(value: unknown, location: string): NebiusInstance {
  const item = objectAt(value, location);
  const metadata = objectAt(item['metadata'], `${location}.metadata`);
  const spec = objectAt(item['spec'], `${location}.spec`);
  const status = objectAt(item['status'], `${location}.status`);
  const resources = objectAt(spec['resources'], `${location}.spec.resources`);
  const bootDisk = objectAt(spec['boot_disk'], `${location}.spec.boot_disk`);
  const managedDisk = objectAt(bootDisk['managed_disk'], `${location}.spec.boot_disk.managed_disk`);
  const diskSpec = objectAt(managedDisk['spec'], `${location}.spec.boot_disk.managed_disk.spec`);
  const networks = arrayAt(spec['network_interfaces'], `${location}.spec.network_interfaces`);
  if (networks.length !== 1) throw new NebiusParseError(`${location}.spec.network_interfaces must contain exactly one item`);
  const network = objectAt(networks[0], `${location}.spec.network_interfaces[0]`);
  const providerState = enumAt(status['state'], INSTANCE_STATES, `${location}.status.state`);
  const statusNetworks = optionalArray(status['network_interfaces'], `${location}.status.network_interfaces`);
  const firstStatusNetwork = statusNetworks.length === 0 ? null : objectAt(statusNetworks[0], `${location}.status.network_interfaces[0]`);
  const attachments = optionalArray(status['disk_attachments'], `${location}.status.disk_attachments`);
  return {
    id: stringAt(metadata['id'], `${location}.metadata.id`),
    parentId: stringAt(metadata['parent_id'], `${location}.metadata.parent_id`),
    name: stringAt(metadata['name'], `${location}.metadata.name`),
    labels: stringMapAt(metadata['labels'], `${location}.metadata.labels`),
    providerState,
    state: mapInstanceState(providerState),
    stopped: booleanAt(spec['stopped'], `${location}.spec.stopped`),
    recoveryPolicy: stringAt(spec['recovery_policy'], `${location}.spec.recovery_policy`).toUpperCase(),
    platform: stringAt(resources['platform'], `${location}.spec.resources.platform`),
    preset: stringAt(resources['preset'], `${location}.spec.resources.preset`),
    subnetId: stringAt(network['subnet_id'], `${location}.spec.network_interfaces[0].subnet_id`),
    diskName: stringAt(managedDisk['name'], `${location}.spec.boot_disk.managed_disk.name`),
    diskType: stringAt(diskSpec['type'], `${location}.spec.boot_disk.managed_disk.spec.type`).toUpperCase(),
    diskSizeGiB: finiteNumberAt(diskSpec['size_gibibytes'], `${location}.spec.boot_disk.managed_disk.spec.size_gibibytes`),
    imageId: stringAt(diskSpec['source_image_id'], `${location}.spec.boot_disk.managed_disk.spec.source_image_id`),
    privateIp: addressAt(firstStatusNetwork?.['ip_address'], `${location}.status.network_interfaces[0].ip_address`),
    publicIp: addressAt(firstStatusNetwork?.['public_ip_address'], `${location}.status.network_interfaces[0].public_ip_address`),
    diskIds: attachments.map((entry, index) => stringAt(objectAt(entry, `${location}.status.disk_attachments[${index}]`)['id'], `${location}.status.disk_attachments[${index}].id`)),
  };
}

function relatedToExpected(instance: NebiusInstance, expected: ExpectedNebiusResource): boolean {
  return instance.name === expected.name
    || instance.labels['cirujano-controller'] === expected.labels['cirujano-controller']
    || instance.labels['cirujano-config'] === expected.labels['cirujano-config'];
}

function mismatchReason(instance: NebiusInstance, expected: ExpectedNebiusResource): string | null {
  if (expected.instanceId !== undefined && instance.id !== expected.instanceId) return `instance id ${instance.id} is not permit-owned`;
  if (instance.parentId !== expected.parentId) return `instance ${instance.id} has the wrong parent`;
  if (instance.name !== expected.name) return `instance ${instance.id} has the wrong name`;
  if (!sameStringMap(instance.labels, expected.labels)) return `instance ${instance.id} has ownership label drift`;
  if (instance.recoveryPolicy !== 'FAIL') return `instance ${instance.id} has lifecycle configuration drift`;
  if (instance.platform !== expected.nebius.platform || instance.preset !== expected.nebius.preset) return `instance ${instance.id} has compute configuration drift`;
  if (instance.subnetId !== expected.nebius.subnetId) return `instance ${instance.id} has network configuration drift`;
  if (instance.diskName !== expected.name.replace(/-vm$/, '-boot')
    || instance.diskType !== expected.nebius.diskType.replaceAll('-', '_').toUpperCase()
    || instance.diskSizeGiB !== expected.nebius.diskSizeGiB
    || instance.imageId !== expected.nebius.imageId) return `instance ${instance.id} has disk configuration drift`;
  return null;
}

function ownershipLabels(controllerId: string, configHash: string): Record<string, string> {
  if (configHash.trim().length === 0) throw new Error('config hash must be nonempty');
  return { 'cirujano-controller': controllerId, 'cirujano-config': configHash };
}

function mapInstanceState(state: InstanceProviderState): VmStatus {
  switch (state) {
    case 'CREATING':
    case 'UPDATING':
    case 'STARTING': return 'starting';
    case 'RUNNING': return 'running';
    case 'STOPPING':
    case 'DELETING': return 'stopping';
    case 'STOPPED': return 'stopped';
    case 'ERROR': return 'error';
  }
}

function parseJsonObject(json: string, location: string): Record<string, unknown> {
  try {
    return objectAt(JSON.parse(json) as unknown, location);
  } catch (error) {
    if (error instanceof NebiusParseError) throw error;
    throw new NebiusParseError(`${location} is not valid JSON`);
  }
}

function objectAt(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new NebiusParseError(`${location} must be an object`);
  return value as Record<string, unknown>;
}

function arrayAt(value: unknown, location: string): unknown[] {
  if (!Array.isArray(value)) throw new NebiusParseError(`${location} must be an array`);
  return value;
}

function optionalArray(value: unknown, location: string): unknown[] {
  return value === undefined ? [] : arrayAt(value, location);
}

function stringAt(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new NebiusParseError(`${location} must be a nonempty string`);
  return value;
}

function nullableStringAt(value: unknown, location: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return stringAt(value, location);
}

function booleanAt(value: unknown, location: string): boolean {
  if (typeof value !== 'boolean') throw new NebiusParseError(`${location} must be a boolean`);
  return value;
}

function finiteNumberAt(value: unknown, location: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new NebiusParseError(`${location} must be a finite number`);
  return value;
}

function stringMapAt(value: unknown, location: string): Record<string, string> {
  const object = objectAt(value, location);
  for (const [key, entry] of Object.entries(object)) {
    if (typeof entry !== 'string') throw new NebiusParseError(`${location}.${key} must be a string`);
  }
  return object as Record<string, string>;
}

function enumAt<const T extends readonly string[]>(value: unknown, allowed: T, location: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new NebiusParseError(`${location} has unsupported value ${String(value)}`);
  return value as T[number];
}

function optionalPageToken(value: unknown, location: string): string | null {
  if (value === undefined || value === '') return null;
  return stringAt(value, location);
}

function addressAt(value: unknown, location: string): string | null {
  if (value === undefined) return null;
  const object = objectAt(value, location);
  if (object['address'] === undefined || object['address'] === '') return null;
  return stringAt(object['address'], `${location}.address`);
}

function sameStringMap(actual: Readonly<Record<string, string>>, expected: Readonly<Record<string, string>>): boolean {
  const actualEntries = Object.entries(actual);
  return actualEntries.length === Object.keys(expected).length && actualEntries.every(([key, value]) => expected[key] === value);
}

function assertResourceId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error('invalid Nebius resource id');
}

function nonemptyArgument(value: string, name: string): string {
  if (value.length === 0 || value.includes('\0')) throw new Error(`${name} must be a nonempty argument`);
  return value;
}

function commonArguments(profile: string, timeout: string): string[] {
  return ['--profile', profile, '--format', 'json', '--no-browser', '--no-progress', '--no-check-update', '--color=false', '--timeout', timeout, '--per-retry-timeout', timeout];
}

function durationSeconds(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds % 1000 !== 0) throw new Error('timeout must be a positive whole number of seconds');
  return `${milliseconds / 1000}s`;
}
