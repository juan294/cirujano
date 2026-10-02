# Phase 1: policy oracles and read-only measurement

Parent: [CI cadence plan](../2026-10-02-ci-cadence.md). Entry: explicit local phase-1 implementation authority. Stop after acceptance; no remote action.

## Scope and ownership

One Cirujano worktree from current develop. Preserve the unrelated ahead commit. Add planned standalone `scripts/measure-ci-cadence.mjs`, its Node test file and anonymized `tests/fixtures/ci-cadence/` event/history/job fixtures. The tool remains separate from core optimizer, telemetry-store and registry contracts. Add a public-safe contract document and ignored private rollout ledger. Do not copy private workflow snapshots, names or account data into public fixtures.

Define fixture schema/version, event matrix, policy validation, expected lane, target SHA/branch, applicable full-job graph and required check results. Publish a frozen contract checksum for per-repository copies; phase 3/5 helpers consume it locally. Exercise graph results, not YAML string matching alone. Missing/invalid mode preserves legacy; malformed policy blocks with repair instructions.

Measurement accepts supplied run/job evidence files and an optional read-only gh collection mode. Collection paginates runs and every attempt's jobs, records source interval, fetch time, errors and completeness. CLI never invokes workflow dispatch/rerun, provider execution, registry verify, publication or budget mutation. Explicit source/output paths; private live output defaults to ignored evidence directory with restrictive file permissions. Public output uses aliases.

## Behavioral contract

```
@ measureCadence(records, interval, rates) -> report
ctx: captured run/job API data and separately supplied billing/provider evidence
pre: interval and visibility/rate inputs validated
do:
  1. validate all attempts and observed execution timestamps
  2. compute per-job rounded known hosted duration and event attribution
  3. compute source gaps, unknown runtime and explicit billing reconciliation
  4. emit report with cost target status and completeness
fail: absent cash/provider data -> net savings unmeasured
fx: write local evidence and anonymized summary only
```

Use a full run-created cohort and a wider collection interval to capture prior-created jobs executing inside the accounting window. Distinguish rounded full-job billing reconstruction from clipped execution overlap; do not claim clipping reconstructs GitHub's invoice. SKU-specific rates/weights must come from timestamped billing/export evidence, not hardcoded assumptions. Preserve public discounts, larger runner and self-hosted distinctions. Never use queue timestamps as runtime or count cancellation as avoided cost without a valid comparator.

## Automated acceptance

Write failing oracles first for main/master release, base changes, fast-only reuse, docs-only required checks, forks/bots, unchanged receipts, invalid mode, failed child, cancelled/nightly and definitions on the wrong branch. Cost fixtures include all attempts, per-job rounding, unknown labels, absent timing, zero baseline, public discounts, unsupported SKU and window boundary. A missing billing/provider input must make `netSavings` unavailable and `scan_complete` reflect collection gaps.

Run sequentially: `node --test scripts/measure-ci-cadence.test.mjs`; contract fixture validator; `pnpm run typecheck`; `pnpm run lint`; `pnpm run test`; `pnpm run test:coverage`; `pnpm run build`; `node scripts/verify-bundle.mjs`; `git diff --check`. Add the actual validator command to package.json when implemented and record it in notes. No live app/provider calls. Capture candidate SHA/tree, runtime and every exit code.

## Manual acceptance and recovery

Owner reviews the event table, eight-day quiet coverage age and 36-hour changed-head deadline. Agent reviews output disclosure and private-data exclusion. Invalid evidence produces a field-specific error; correcting it succeeds in a test. Missing API pages yield incomplete reporting; a complete captured retry fixture restores completeness, without the tool retrying remote jobs. Known-failure fixtures show a linked blocked state and recover only on changed identity/explicit authorized retry.

## Handoff

Record contract checksum, actual added paths/commands, base/current identity, review/simplify findings and local gate evidence. Phase 2 requires accepted fixtures; phase 3 requires the frozen checksum. No existing optimizer, controller, returned telemetry type or cache format changes, so existing consumers stay unchanged.

## Local implementation acceptance, 2026-10-02

- [x] Shared policy/event/history/full-job graph oracles and anonymized measurement fixtures.
- [x] Read-only measurement, all-attempt pagination, explicit completeness/accounting limitations and restrictive local evidence output.
- [x] Independent review, regression repairs and simplify.
- [x] Required sequential local gates; cold-build failures retained and corrected through build preparation.
- [x] Frozen checksum `3c6a2a44caa1cfbfda2a4ffd2c5e3ad56e0814c5def7aedc717fa16fecf93b57` and durable handoff in [implementation notes](../2026-10-02-ci-cadence-notes.md).

Owner authorized all-phase continuation; continue to phase 2 without a phase stop. This local acceptance supplies no publication, deployed consumer or financial outcome evidence.
