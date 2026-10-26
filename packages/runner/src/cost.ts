import type { CostRates, RunnerCostEstimate, RunnerCostInput } from './contracts.js';

const HOUR_MS = 3_600_000;
const THIRTY_DAY_MONTH_MS = 30 * 24 * HOUR_MS;

export function estimateRunnerCost(input: RunnerCostInput): RunnerCostEstimate {
  if (input.rates === null) return incomplete('explicit dated rates are required');
  const rateProblem = validateRates(input.rates);
  if (rateProblem !== null) return incomplete(rateProblem);
  if (input.computeIntervals.length === 0) return incomplete('at least one observed compute interval is required');
  if (!nonnegativeFinite(input.disk.sizeGiB) || !nonnegativeFinite(input.disk.retainedMs)) {
    return incomplete('disk size and retained interval must be non-negative finite numbers');
  }
  if (!nonnegativeFinite(input.networkEgressGiB)) return incomplete('network egress must be a non-negative finite number');
  if (input.hostedBillableMinutes === null || !nonnegativeFinite(input.hostedBillableMinutes)) {
    return incomplete('hosted baseline requires explicit billable minutes');
  }
  if (input.rates.hostedUsdPerMinute === null) return incomplete('hosted baseline requires an explicit rate');

  let computeMs = 0;
  for (const interval of input.computeIntervals) {
    if (!nonnegativeFinite(interval.startMs) || interval.endMs === null || !nonnegativeFinite(interval.endMs) || interval.endMs < interval.startMs) {
      return incomplete('every compute interval must have finite ordered bounds');
    }
    computeMs += interval.endMs - interval.startMs;
  }

  const computeUsd = money((computeMs / HOUR_MS) * input.rates.computeUsdPerHour);
  const diskUsd = money((input.disk.retainedMs / THIRTY_DAY_MONTH_MS) * input.disk.sizeGiB * input.rates.diskUsdPerGibMonth);
  const networkUsd = money(input.networkEgressGiB * input.rates.networkEgressUsdPerGib);
  return {
    complete: true,
    currency: input.rates.currency,
    computeUsd,
    diskUsd,
    networkUsd,
    runnerTotalUsd: money(computeUsd + diskUsd + networkUsd),
    hostedBaselineUsd: money(input.hostedBillableMinutes * input.rates.hostedUsdPerMinute),
  };
}

function validateRates(rates: CostRates): string | null {
  if (rates.currency.trim().length === 0 || rates.quotedAt.trim().length === 0 || rates.source.trim().length === 0) {
    return 'rates require currency, quote date and source';
  }
  if (!validDateOnly(rates.quotedAt)) return 'quotedAt must be a valid YYYY-MM-DD date';
  for (const [name, value] of [
    ['computeUsdPerHour', rates.computeUsdPerHour],
    ['diskUsdPerGibMonth', rates.diskUsdPerGibMonth],
    ['networkEgressUsdPerGib', rates.networkEgressUsdPerGib],
  ] as const) {
    if (!nonnegativeFinite(value)) return `${name} must be a non-negative finite number`;
  }
  if (rates.hostedUsdPerMinute !== null && !nonnegativeFinite(rates.hostedUsdPerMinute)) {
    return 'hostedUsdPerMinute must be a non-negative finite number';
  }
  return null;
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function nonnegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function incomplete(reason: string): RunnerCostEstimate {
  return { complete: false, reason };
}
