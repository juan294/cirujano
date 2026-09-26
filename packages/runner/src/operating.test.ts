import { describe, expect, it } from 'vitest';

import { parsePermit } from './lifecycle.js';
import {
  OPERATING_PERMIT_BOUNDS,
  buildOperatingPermitProposal,
  calculateOperatingQuoteMaximum,
  renderOperatingPermit,
  type OperatingPermitProposalInput,
} from './operating.js';
import type { PilotQuote } from './pilot.js';

type CompleteQuote = Extract<PilotQuote, { complete: true }>;

const NOW = Date.parse('2026-09-16T12:00:00Z');

const input: OperatingPermitProposalInput & { quote: CompleteQuote } = {
  enrollmentId: 'P1',
  nowMs: NOW,
  expiresAtMs: Date.parse('2026-10-28T23:59:59Z'),
  candidateDigest: 'candidate-sha256',
  configHash: 'config-sha256',
  repositoryId: 1001,
  projectId: 'project-1',
  controllerId: 'cirujano-P1-20260916',
  resourcePrefix: 'cirujano-p1',
  maxStarts: 600,
  maxRuntimeMs: 540_000_000,
  maxTotalCostUsd: 40,
  otherPermits: [{ permitId: 'P2-operating', maxTotalCostUsd: 40 }, { permitId: 'P3-operating', maxTotalCostUsd: 40 }],
  quote: {
    complete: true as const,
    currency: 'USD', quotedAt: '2026-09-15', source: 'https://docs.nebius.com/compute/resources/pricing',
    computeUsdPerHour: 0.0992,
    diskUsdPerGibMonth: 0.071,
    publicIpUsdPerHour: 0,
    networkUsdPerGib: 0,
    maxRetainedDiskHours: 1020,
    maxPublicIpHours: 1020,
    maxNetworkEgressGiB: 10,
    estimatedMaximumUsd: 0,
    includesRetainedDiskAndIp: true,
  },
};

describe('operating permit proposal (phase 2 U1)', () => {
  it('computes the D3 maximum from 150 compute hours plus the retained disk over the permit lifetime', () => {
    const maximum = calculateOperatingQuoteMaximum(input.quote, input.maxRuntimeMs, input.expiresAtMs - input.nowMs);
    // 150 h × 0.0992 + 1020 h × 80 GiB × 0.071 / 730 + 10 GiB × 0
    expect(maximum).toBeCloseTo(14.88 + 7.936438, 5);
    expect(OPERATING_PERMIT_BOUNDS).toEqual({
      expiresAtMs: Date.parse('2026-10-28T23:59:59Z'), maxStarts: 600, maxRuntimeMs: 540_000_000, maxTotalCostUsd: 40, fleetCeilingUsd: 320,
    });
  });

  it('creates an unapproved operating proposal whose rendered permit parses', () => {
    const quote = { ...input.quote, estimatedMaximumUsd: calculateOperatingQuoteMaximum(input.quote, input.maxRuntimeMs, input.expiresAtMs - input.nowMs) };
    const result = buildOperatingPermitProposal({ ...input, quote });
    expect(result).toMatchObject({ accepted: true, proposal: {
      kind: 'operating', enrollmentId: 'P1', approved: false, maxStarts: 600, maxRuntimeMs: 540_000_000, maxTotalCostUsd: 40,
      fleetCeilingUsd: 320, fleetCommittedUsd: 120, operations: ['create', 'start', 'register', 'stop', 'delete'], recoveryAllowed: true,
      resources: { platform: 'cpu-d3', preset: '4vcpu-16gb', vmCount: 1, diskCount: 1, diskType: 'network_ssd', diskSizeGiB: 80 },
    } });
    if (!result.accepted) throw new Error('unreachable');
    const permit = renderOperatingPermit(result.proposal, 'P1-operating-20260916');
    expect(parsePermit(permit)).toEqual(permit);
    expect(permit).toMatchObject({ permitId: 'P1-operating-20260916', issuedAtMs: NOW, expiresAtMs: input.expiresAtMs, recoveryAllowed: true });
    expect(Object.keys(permit).sort()).toEqual([
      'candidateDigest', 'configHash', 'controllerId', 'expiresAtMs', 'issuedAtMs', 'maxRuntimeMs', 'maxStarts', 'maxTotalCostUsd',
      'operations', 'permitId', 'projectId', 'recoveryAllowed', 'repositoryId', 'resourcePrefix', 'schemaVersion',
    ]);
  });

  it('accepts exactly eight USD 40 permits at the fleet ceiling', () => {
    const quote = { ...input.quote, estimatedMaximumUsd: calculateOperatingQuoteMaximum(input.quote, input.maxRuntimeMs, input.expiresAtMs - input.nowMs) };
    const otherPermits = Array.from({ length: 7 }, (_, index) => ({ permitId: `P${index + 2}`, maxTotalCostUsd: 40 }));
    const result = buildOperatingPermitProposal({ ...input, otherPermits, quote });
    expect(result).toMatchObject({ accepted: true, proposal: { fleetCeilingUsd: 320, fleetCommittedUsd: 320 } });
  });

  it.each([
    ['expiry after the measurement window', { expiresAtMs: Date.parse('2026-10-29T00:00:00Z') }, /measurement window/u],
    ['expiry in the past', { expiresAtMs: NOW }, /follow now/u],
    ['too many starts', { maxStarts: 601 }, /at most 600 starts/u],
    ['too much runtime', { maxRuntimeMs: 540_000_001 }, /150 hours/u],
    ['too much cost', { maxTotalCostUsd: 40.01 }, /USD 40/u],
    ['a fleet ceiling breach', { otherPermits: Array.from({ length: 8 }, (_, index) => ({ permitId: `P${index + 2}`, maxTotalCostUsd: 40 })) }, /fleet ceiling USD 320/u],
    ['a quote that exceeds the cost ceiling', { maxTotalCostUsd: 20 }, /exceeds the cost ceiling/u],
    ['a stale quote', { quote: { ...input.quote, quotedAt: '2026-09-01' } }, /dated within seven days/u],
    ['disk retention shorter than the permit', { quote: { ...input.quote, maxRetainedDiskHours: 100 } }, /disk retention/u],
    ['a mismatched supplied total', { quote: { ...input.quote, estimatedMaximumUsd: 1 } }, /does not match/u],
    ['an empty identity field', { controllerId: ' ' }, /controllerId is required/u],
    ['a non-P enrollment id', { enrollmentId: 'pilot' }, /enrollmentId/u],
  ])('refuses %s', (_name, change, message) => {
    const quote: CompleteQuote = { ...input.quote, ...('quote' in change ? change.quote : {}) };
    const merged = { ...input, ...change, quote: { ...quote, estimatedMaximumUsd: quote.estimatedMaximumUsd === 0
      ? calculateOperatingQuoteMaximum(quote, (change as { maxRuntimeMs?: number }).maxRuntimeMs ?? input.maxRuntimeMs, ((change as { expiresAtMs?: number }).expiresAtMs ?? input.expiresAtMs) - input.nowMs)
      : quote.estimatedMaximumUsd } };
    const result = buildOperatingPermitProposal(merged);
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error('unreachable');
    expect(result.reasons.join('\n')).toMatch(message);
  });
});
