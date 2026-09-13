import { describe, expect, it } from 'vitest';

import { ConfigError, parseRunnerConfig } from './config.js';

const validConfig = {
  schemaVersion: 1,
  repository: { id: 123, nameWithOwner: 'trusted/private', visibility: 'private' },
  workflowIds: [41],
  allowedBranch: 'develop',
  eligibleJobNames: ['e2e'],
  runnerLabel: 'cirujano-pilot-a',
  slots: 1,
  nebius: {
    profile: 'pilot', projectId: 'project-1', subnetId: 'subnet-1', imageId: 'image-1',
    platform: 'cpu-d3', preset: '4vcpu-16gb', diskType: 'network-ssd', diskSizeGiB: 80,
  },
  ssh: { publicKey: 'ssh-ed25519 AAAA pilot', fingerprint: 'SHA256:pilot' },
  ownership: { controllerId: 'controller-a', resourcePrefix: 'cirujano-a' },
  timing: {
    pollIntervalMs: 30_000, idleGraceMs: 300_000, bootTimeoutMs: 600_000,
    maxJobMs: 3_600_000, lifetimeMs: 5_400_000, shutdownMarginMs: 300_000,
  },
  rates: {
    currency: 'USD', quotedAt: '2026-09-13', source: 'provider quote',
    computeUsdPerHour: 0.24, diskUsdPerGibMonth: 0.10,
    networkEgressUsdPerGib: 0.05, hostedUsdPerMinute: 0.008,
  },
} as const;

describe('parseRunnerConfig (R01)', () => {
  it.each([
    ['schema version', { ...validConfig, schemaVersion: 2 }],
    ['public repository', { ...validConfig, repository: { ...validConfig.repository, visibility: 'public' } }],
    ['multiple slots', { ...validConfig, slots: 2 }],
    ['missing ownership', { ...validConfig, ownership: undefined }],
    ['unknown root key', { ...validConfig, surprise: true }],
    ['unknown provider key', { ...validConfig, nebius: { ...validConfig.nebius, resolvedIp: '192.0.2.1' } }],
    ['missing platform', { ...validConfig, nebius: { ...validConfig.nebius, platform: undefined } }],
    ['wrong platform', { ...validConfig, nebius: { ...validConfig.nebius, platform: 'gpu-h100' } }],
    ['wrong preset', { ...validConfig, nebius: { ...validConfig.nebius, preset: '8vcpu-32gb' } }],
    ['wrong disk type', { ...validConfig, nebius: { ...validConfig.nebius, diskType: 'local-ssd' } }],
    ['wrong disk size', { ...validConfig, nebius: { ...validConfig.nebius, diskSizeGiB: 100 } }],
    ['invalid timing bound', { ...validConfig, timing: { ...validConfig.timing, idleGraceMs: Number.POSITIVE_INFINITY } }],
    ['nonfinite rate', { ...validConfig, rates: { ...validConfig.rates, computeUsdPerHour: Number.NaN } }],
  ])('rejects %s so malformed configuration cannot authorize effects', (_name, input) => {
    expect(() => parseRunnerConfig(input)).toThrow(ConfigError);
  });

  it('accepts one private repository and preserves supplied selectors without resolved network state', () => {
    const parsed = parseRunnerConfig(validConfig);
    expect(parsed.repository.visibility).toBe('private');
    expect(parsed.slots).toBe(1);
    expect(parsed.nebius.subnetId).toBe('subnet-1');
    expect(parsed).not.toHaveProperty('ipAddress');
  });
});

export { validConfig };
