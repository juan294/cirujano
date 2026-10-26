# Phase 4: net savings report

Parent: [plan](../2026-09-15-fleet-migration-evidence.md). Entry: at least one
enrollment cut over with after-window jobs (phase 3). Can start in parallel
with later enrollments.

## Deliverables

- `packages/cli/src/telemetry.ts`: enrollment cost fields filled from
  controller evidence: `nebiusComputeUsd`, `nebiusDiskUsd`, `nebiusTotalUsd`,
  `netSavingsUsd = grossHostedCostAvoidedUsd − nebiusTotalUsd`, plus
  `assignments` (runner id and name per Cirujano job, matched against the
  controller's `assignments.json`) and `unmatchedCirujanoJobs` (jobs credited
  by telemetry but absent from any controller journal, which must be zero).
- `packages/cli/src/fleet-service.ts`: `readControllerEvidence(stateDirectory)`
  reading `controller-state.json` (lifecycle cumulative runtime and cost),
  `accounting-state.json` (retained disk, egress) and `assignments.json`,
  with the dated rates from the enrollment's `config.json`.
- Markdown: fleet totals line "gross avoided / Nebius cost / net savings", a
  per-enrollment table, queue latency, and the limits paragraph (list prices,
  no allowance, single-slot serialization, Mac sleep).
- `scripts/publish-fleet-report.sh` (or a `fleet publish` subcommand):
  renders the sanitized version with P-handles into `docs/research/` and
  refuses to write if any private repository name or resource id appears.
- Runbook: how to produce the 45-day report on 2026-10-28.

## Pseudocode

```
@ enrollmentCost(enrollment, evidence, rates) -> cost
ctx: controller journals (local files)
pre: evidence identity matches enrollment.controller
do:
  1. compute computeUsd = cumulativeRuntimeMs / 3.6e6 * rates.computeUsdPerHour
  2. compute diskUsd = diskRetainedMs / (730 h) * 80 GiB * rates.diskUsdPerGibMonth
  3. compute nebiusTotalUsd = computeUsd + diskUsd + egress * rate
  4. compute net = grossAvoided (telemetry, after window) - nebiusTotalUsd
  5. match each cirujano job (runId, jobId) to assignments; count unmatched
fail: identity mismatch -> throw; unmatched > 0 -> report incomplete: true with reason
```

## Tests (test first)

- Fixture controller journals plus fixture snapshots produce the expected
  per-enrollment cost, net and matched assignments; an unmatched credited job
  marks the report incomplete.
- A public repository enrollment yields zero gross avoided and negative net,
  and the Markdown says so (guards against migrating public repositories).
- Publisher refuses output containing a private name from the registry or a
  `computeinstance-` id.

## Acceptance

Automated: tests and the full gate; the report over the real private store
runs with `complete: true` for every cut-over enrollment. Manual: owner reads
the first real net-savings figure and the limits paragraph. External state:
none.

## Exit

Record the first real figures in the private targets file; the publishable
report is produced on 2026-10-28 or on demand for the submission.

## Handoff (2026-09-15)

- [x] Enrollment cost fields, assignments, unmatched jobs, `complete`/`incompleteReason`, fleet totals (`packages/cli/src/telemetry.ts`, `telemetry-enrollments.test.ts`)
- [x] `readControllerEvidence` / `loadControllerEvidence` with identity checks (`fleet-service.ts` + tests)
- [x] Markdown fleet line, public-repository note, limits paragraph; sanitized `renderFleetSavingsMarkdown`
- [x] `fleet publish` with the `assertPublishable` guard (private names, owner prefix, controller identity, Nebius resource ids)
- [x] Runbook "Net savings and the 45-day report" in `docs/runbooks/fleet-telemetry.md`
- Commit `042736f`. Checks on that commit: typecheck, lint, build, verify-bundle, `pnpm run test` (506 tests green).
- Deviations D-4, D-5 in the notes file. The acceptance item "report over the real private store runs with `complete: true` for every cut-over enrollment" is vacuous until phase 3 cuts an enrollment over; today the real store reports `fleet.enrollments: 0`.
- Independent review: see the notes file (findings and dispositions).
