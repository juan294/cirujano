import { describe, expect, it, vi } from 'vitest';

import { parseRunnerConfig } from '../config.js';
import { validConfig } from '../config.test.js';
import {
  NebiusCli,
  NebiusParseError,
  decideDelete,
  decideStop,
  parseInstancePage,
  parseOperationPage,
  reconcileCreate,
  renderCreateRequest,
  type NebiusCommand,
} from './nebius.js';

const config = parseRunnerConfig(validConfig);
const expected = {
  parentId: config.nebius.projectId,
  name: `${config.ownership.resourcePrefix}-vm`,
  labels: {
    'cirujano-controller': config.ownership.controllerId,
    'cirujano-config': 'config-sha256',
  },
  nebius: config.nebius,
};

function instance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metadata: {
      id: 'instance-1',
      parent_id: expected.parentId,
      name: expected.name,
      labels: expected.labels,
    },
    spec: {
      stopped: true,
      recovery_policy: 'FAIL',
      resources: { platform: 'cpu-d3', preset: '4vcpu-16gb' },
      network_interfaces: [{ name: 'primary', subnet_id: 'subnet-1', ip_address: {}, public_ip_address: {} }],
      boot_disk: {
        attach_mode: 'READ_WRITE',
        managed_disk: {
          name: `${config.ownership.resourcePrefix}-boot`,
          spec: { type: 'NETWORK_SSD', size_gibibytes: 80, source_image_id: 'image-1' },
        },
      },
    },
    status: {
      state: 'STOPPED',
      network_interfaces: [{ name: 'primary', ip_address: { address: '10.0.0.4' }, public_ip_address: { address: '203.0.113.4' } }],
      disk_attachments: [{ name: `${config.ownership.resourcePrefix}-boot`, id: 'disk-1' }],
    },
    ...overrides,
  };
}

describe('Nebius create request', () => {
  it('renders the fixed stopped pilot shape without credentials', () => {
    const request = renderCreateRequest(config, 'config-sha256', '#cloud-config\nusers: []\n');

    expect(request).toEqual({
      metadata: { parent_id: 'project-1', name: 'cirujano-a-vm', labels: expected.labels },
      spec: {
        stopped: true,
        recovery_policy: 'FAIL',
        resources: { platform: 'cpu-d3', preset: '4vcpu-16gb' },
        network_interfaces: [{ name: 'primary', subnet_id: 'subnet-1', ip_address: {}, public_ip_address: {} }],
        boot_disk: {
          attach_mode: 'READ_WRITE',
          managed_disk: {
            name: 'cirujano-a-boot',
            labels: expected.labels,
            spec: { type: 'NETWORK_SSD', size_gibibytes: 80, source_image_id: 'image-1' },
          },
        },
        cloud_init_user_data: '#cloud-config\nusers: []\n',
      },
    });
    expect(JSON.stringify(request)).not.toContain(config.ssh.publicKey);
  });
});

describe('strict provider response parsers', () => {
  it('accepts the CLI empty-page representation', () => {
    expect(parseInstancePage('{}')).toEqual({ items: [], nextPageToken: null });
    expect(parseOperationPage('{}')).toEqual({ items: [], nextPageToken: null });
  });

  it('parses an instance page, including status network and disk identities', () => {
    const parsed = parseInstancePage(JSON.stringify({ items: [instance()], next_page_token: 'page-2' }));
    expect(parsed.nextPageToken).toBe('page-2');
    expect(parsed.items[0]).toMatchObject({
      id: 'instance-1', state: 'stopped', privateIp: '10.0.0.4', publicIp: '203.0.113.4',
      diskIds: ['disk-1'],
    });
  });

  it.each(['CREATING', 'UPDATING', 'STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'DELETING', 'ERROR'])('accepts documented instance state %s', (state) => {
    expect(parseInstancePage(JSON.stringify({ items: [instance({ status: { state } })] })).items[0]?.providerState).toBe(state);
  });

  it.each([
    ['unknown state', { items: [instance({ status: { state: 'PAUSED' } })] }],
    ['missing item metadata', { items: [{ status: { state: 'STOPPED' } }] }],
    ['malformed pagination', { items: [], next_page_token: 7 }],
    ['invalid JSON', '{'],
  ])('rejects %s', (_name, input) => {
    expect(() => parseInstancePage(typeof input === 'string' ? input : JSON.stringify(input))).toThrow(NebiusParseError);
  });

  it('parses accepted operation states and rejects an unknown one', () => {
    for (const state of ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']) {
      const page = parseOperationPage(JSON.stringify({
        items: [{ metadata: { id: `op-${state}` }, spec: { resource_id: 'instance-1' }, status: { state } }],
      }));
      expect(page.items[0]).toEqual({ id: `op-${state}`, resourceId: 'instance-1', state });
    }
    expect(() => parseOperationPage(JSON.stringify({
      items: [{ metadata: { id: 'op-1' }, spec: { resource_id: 'instance-1' }, status: { state: 'MYSTERY' } }],
    }))).toThrow(NebiusParseError);
  });
});

describe('R07 ownership and reconciliation', () => {
  it('adopts one exact owned resource after an ambiguous create timeout', () => {
    expect(reconcileCreate({ timedOut: true, instances: parseInstancePage(JSON.stringify({ items: [instance()] })).items, operation: null, expected }))
      .toEqual({ action: 'adopt', instanceId: 'instance-1' });
  });

  it('blocks zero matches while a timed-out create operation remains unresolved', () => {
    expect(reconcileCreate({
      timedOut: true,
      instances: [],
      operation: { id: 'op-1', resourceId: null, state: 'RUNNING' },
      expected,
    })).toEqual({ action: 'block', reason: 'create operation op-1 is RUNNING' });
    expect(reconcileCreate({ timedOut: true, instances: [], operation: null, expected })).toEqual({
      action: 'block', reason: 'timed-out create has no conclusive operation result',
    });
    expect(reconcileCreate({
      timedOut: true,
      instances: [],
      operation: { id: 'op-1', resourceId: null, state: 'FAILED' },
      expected,
    })).toEqual({ action: 'block', reason: 'timed-out create resolved FAILED but no owned resource was found' });
  });

  it('blocks multiple exact resources, foreign ids, error state and configuration drift', () => {
    const owned = parseInstancePage(JSON.stringify({ items: [instance()] })).items[0]!;
    expect(reconcileCreate({ timedOut: true, instances: [owned, { ...owned, id: 'instance-2' }], operation: null, expected }).action).toBe('block');
    expect(reconcileCreate({ timedOut: true, instances: [{ ...owned, id: 'foreign-id' }], operation: { id: 'op-1', resourceId: 'expected-id', state: 'SUCCEEDED' }, expected: { ...expected, instanceId: 'expected-id' } }).action).toBe('block');
    expect(reconcileCreate({ timedOut: true, instances: [{ ...owned, state: 'error', providerState: 'ERROR' }], operation: null, expected }).action).toBe('block');
    expect(reconcileCreate({ timedOut: true, instances: [{ ...owned, preset: '8vcpu-32gb' }], operation: null, expected }).action).toBe('block');
  });

  it('allows an initial create only before an ambiguous mutation exists', () => {
    expect(reconcileCreate({ timedOut: false, instances: [], operation: null, expected })).toEqual({ action: 'create' });
  });

  it('makes stop and delete idempotent while preserving ownership', () => {
    const owned = parseInstancePage(JSON.stringify({ items: [instance()] })).items[0]!;
    expect(decideStop({ ...owned, state: 'running', providerState: 'RUNNING', stopped: false }, expected)).toEqual({ action: 'stop', instanceId: 'instance-1' });
    expect(decideStop(owned, expected)).toEqual({ action: 'done' });
    expect(decideStop({ ...owned, state: 'stopping', providerState: 'STOPPING' }, expected)).toEqual({ action: 'wait' });
    expect(decideDelete(null, expected)).toEqual({ action: 'done' });
    expect(decideDelete(owned, expected)).toEqual({ action: 'delete', instanceId: 'instance-1' });
    expect(decideStop({ ...owned, labels: { stranger: 'true' } }, expected).action).toBe('block');
    expect(decideDelete({ ...owned, name: 'someone-else' }, expected).action).toBe('block');
  });
});

describe('safe CLI execution', () => {
  it('uses an absolute binary, no shell, JSON stdin, bounded timeouts and retries=1 for mutations', async () => {
    const calls: NebiusCommand[] = [];
    const execute = vi.fn(async (command: NebiusCommand) => {
      calls.push(command);
      return { exitCode: 0, stdout: JSON.stringify({ metadata: { id: 'op-1' } }), stderr: '', timedOut: false };
    });
    const cli = new NebiusCli({
      binaryPath: '/Users/juan/.nebius/bin/nebius', profile: 'TCT', projectId: 'project-1', execute,
      readTimeoutMs: 30_000, mutationTimeoutMs: 60_000,
    });

    await cli.create(renderCreateRequest(config, 'config-sha256', '#cloud-config\n'));
    await cli.stop('instance-1');
    await cli.delete('instance-1');

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.file).toBe('/Users/juan/.nebius/bin/nebius');
      expect(call.shell).toBe(false);
      expect(call.timeoutMs).toBe(60_000);
      expect(call.args).toEqual(expect.arrayContaining(['--profile', 'TCT', '--format', 'json', '--no-browser', '--no-progress', '--no-check-update', '--color=false', '--timeout', '60s', '--per-retry-timeout', '60s', '--retries', '1', '--async']));
    }
    expect(calls[0]?.args.slice(0, 4)).toEqual(['compute', 'instance', 'create', '-']);
    expect(calls[0]?.stdin).toBe(`${JSON.stringify(renderCreateRequest(config, 'config-sha256', '#cloud-config\n'))}\n`);
    expect(calls[1]?.args.slice(0, 5)).toEqual(['compute', 'instance', 'stop', '--id', 'instance-1']);
    expect(calls[2]?.args.slice(0, 5)).toEqual(['compute', 'instance', 'delete', '--id', 'instance-1']);
  });

  it('builds bounded read and start commands without a shell', async () => {
    const calls: NebiusCommand[] = [];
    const execute = vi.fn(async (command: NebiusCommand) => {
      calls.push(command);
      return { exitCode: 0, stdout: '{"items":[]}', stderr: '', timedOut: false };
    });
    const cli = new NebiusCli({
      binaryPath: '/opt/nebius/bin/nebius', profile: 'TCT', projectId: 'project-1', execute,
      readTimeoutMs: 30_000, mutationTimeoutMs: 60_000,
    });

    await cli.listInstances('next-page');
    await cli.listOperationsByParent('next-operations');
    await cli.getInstance('instance-1');
    await cli.getOperation('op-1');
    await cli.start('instance-1');

    expect(calls[0]?.args.slice(0, 7)).toEqual(['compute', 'instance', 'list', '--parent-id', 'project-1', '--page-size', '999']);
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['--page-token', 'next-page', '--retries', '3']));
    expect(calls[1]?.args.slice(0, 5)).toEqual(['compute', 'instance', 'list-operations-by-parent', '--parent-id', 'project-1']);
    expect(calls[2]?.args.slice(0, 5)).toEqual(['compute', 'instance', 'get', '--id', 'instance-1']);
    expect(calls[3]?.args.slice(0, 6)).toEqual(['compute', 'instance', 'operation', 'get', '--id', 'op-1']);
    expect(calls[4]?.args.slice(0, 5)).toEqual(['compute', 'instance', 'start', '--id', 'instance-1']);
    expect(calls[4]?.args).toEqual(expect.arrayContaining(['--retries', '1', '--async']));
    for (const call of calls.slice(0, 4)) {
      expect(call).toMatchObject({ file: '/opt/nebius/bin/nebius', shell: false, timeoutMs: 30_000 });
    }
  });

  it('rejects relative executables and unsafe resource ids before execution', async () => {
    const execute = vi.fn();
    expect(() => new NebiusCli({ binaryPath: 'nebius', profile: 'TCT', projectId: 'project-1', execute })).toThrow('absolute');
    const cli = new NebiusCli({ binaryPath: '/opt/nebius/bin/nebius', profile: 'TCT', projectId: 'project-1', execute });
    await expect(cli.stop('--profile=attacker')).rejects.toThrow('resource id');
    expect(execute).not.toHaveBeenCalled();
  });
});
