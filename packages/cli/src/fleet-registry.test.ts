import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FleetRegistryError,
  LOCKED_EXCLUSIONS,
  enrollmentLabelFor,
  isExcludedRepository,
  lockedExclusionRepositories,
  parseFleetRegistry,
  writeFleetRegistry,
  type FleetEnrollment,
  type FleetRegistry,
} from './fleet-registry.js';

const OWNER = 'example-owner';

describe('fleet registry (phase 1 U1)', () => {
  it('derives the locked exclusions for an owner from the parent plan', () => {
    expect(lockedExclusionRepositories(OWNER)).toEqual([
      `${OWNER}/chapa`,
      `${OWNER}/spoken-letter`,
      'frivas/contribution-dashboard',
      'behboud/opencode-rpi',
      'juan294/home-network',
    ]);
    expect(LOCKED_EXCLUSIONS.lockedBy).toBe('fleet-telemetry plan 2026-09-13');
  });

  it('round-trips the placeholder fixture through write and parse with owner-only modes', async () => {
    const registry = parseFleetRegistry(JSON.parse(await readFile(fixturePath(), 'utf8')));
    expect(registry.enrollments.map(({ id, status }) => [id, status])).toEqual([['P1', 'cut-over'], ['P2', 'proposed']]);
    const directory = await mkdtemp(join(tmpdir(), 'cirujano-fleet-registry-'));
    const path = join(directory, 'fleet-registry.json');
    await writeFleetRegistry(path, registry);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(parseFleetRegistry(JSON.parse(await readFile(path, 'utf8')))).toEqual(registry);
  });

  it.each([
    ['a missing locked exclusion', (registry: FleetRegistry) => {
      registry.exclusions = registry.exclusions.filter(({ repository }) => repository !== 'behboud/opencode-rpi');
    }, /locked exclusion behboud\/opencode-rpi is missing/u],
    ['an enrollment of a frozen product companion', (registry: FleetRegistry) => {
      registry.enrollments[1]!.repository = `${OWNER}/spoken-letter-alexa`;
    }, /spoken-letter-alexa is excluded/u],
    ['an enrollment of a named exclusion', (registry: FleetRegistry) => {
      registry.exclusions.push({ repository: `${OWNER}/private-two`, reason: 'owner decision', lockedBy: 'owner' });
    }, /private-two is excluded/u],
    ['a SKU and label mismatch', (registry: FleetRegistry) => {
      registry.enrollments[1]!.sku = 'actions_macos';
    }, /runnerLabel .* is not enrolled for sku actions_macos/u],
    ['an unknown SKU', (registry: FleetRegistry) => {
      (registry.enrollments[1] as { sku: string }).sku = 'actions_gpu';
    }, /sku must be one of/u],
    ['a repository outside the owner', (registry: FleetRegistry) => {
      registry.enrollments[1]!.repository = 'someone-else/private-two';
    }, /must belong to example-owner/u],
    ['a duplicate enrollment id', (registry: FleetRegistry) => {
      registry.enrollments[1]!.id = 'P1';
    }, /duplicate enrollment id P1/u],
    ['a proposed enrollment that carries an after record', (registry: FleetRegistry) => {
      registry.enrollments[1]!.after = registry.enrollments[0]!.after;
    }, /proposed enrollment P2 must not carry an after record/u],
    ['a cut-over enrollment without an after record', (registry: FleetRegistry) => {
      registry.enrollments[0]!.after = null;
    }, /cut-over enrollment P1 requires an after record/u],
    ['a cut-over after record whose runs-on lacks the enrolled label', (registry: FleetRegistry) => {
      registry.enrollments[0]!.after!.runsOn = ['self-hosted', 'linux', 'x64'];
    }, /after\.runsOn must include self-hosted and cirujano-baseline-actions_linux/u],
    ['a window that ends before it starts', (registry: FleetRegistry) => {
      registry.measurementWindow.through = '2026-09-01';
    }, /measurementWindow\.since must not follow through/u],
    ['a duplicate workflow job enrollment', (registry: FleetRegistry) => {
      registry.enrollments[1]!.repository = registry.enrollments[0]!.repository;
      registry.enrollments[1]!.workflowPath = registry.enrollments[0]!.workflowPath;
      registry.enrollments[1]!.jobKey = registry.enrollments[0]!.jobKey;
    }, /already enrolled as P1/u],
  ])('rejects %s', async (_name, tamper, message) => {
    const registry = parseFleetRegistry(JSON.parse(await readFile(fixturePath(), 'utf8')));
    tamper(registry);
    expect(() => parseFleetRegistry(JSON.parse(JSON.stringify(registry)))).toThrow(FleetRegistryError);
    expect(() => parseFleetRegistry(JSON.parse(JSON.stringify(registry)))).toThrow(message);
  });

  it('matches exclusions exactly and through the frozen product companion suffixes only', async () => {
    const registry = parseFleetRegistry(JSON.parse(await readFile(fixturePath(), 'utf8')));
    expect(isExcludedRepository(registry, `${OWNER}/chapa`)).toBe(true);
    expect(isExcludedRepository(registry, `${OWNER}/chapa-cli`)).toBe(true);
    expect(isExcludedRepository(registry, `${OWNER}/chapa-upptime`)).toBe(true);
    expect(isExcludedRepository(registry, `${OWNER}/spoken-letter-alexa`)).toBe(true);
    expect(isExcludedRepository(registry, 'juan294/home-network')).toBe(true);
    expect(isExcludedRepository(registry, 'juan294/home-network-cli')).toBe(false);
    expect(isExcludedRepository(registry, `${OWNER}/chapati`)).toBe(false);
    expect(isExcludedRepository(registry, `${OWNER}/private-one`)).toBe(false);
  });

  it('maps every priced SKU to its enrolled baseline label and refuses unpriced ones', () => {
    expect(enrollmentLabelFor('actions_linux')).toBe('cirujano-baseline-actions_linux');
    expect(() => enrollmentLabelFor('actions_windows')).toThrow(/no enrolled Cirujano label/u);
  });

  it('rejects an unknown enrollment key so private records never carry stray fields', async () => {
    const raw = JSON.parse(await readFile(fixturePath(), 'utf8')) as { enrollments: Array<FleetEnrollment & { extra?: boolean }> };
    raw.enrollments[0]!.extra = true;
    expect(() => parseFleetRegistry(raw)).toThrow(/enrollments\[0\] contains unknown key extra/u);
  });
});

function fixturePath(): string {
  return join(import.meta.dirname, '../fixtures/fleet-registry.example.json');
}
