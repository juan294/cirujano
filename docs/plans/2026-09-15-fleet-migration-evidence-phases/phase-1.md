# Phase 1: registry, enrollment records and report section

Parent: [plan](../2026-09-15-fleet-migration-evidence.md). Entry: plan accepted;
`develop` at `4312e10` or later with green CI.

## Deliverables

- `packages/cli/src/fleet-registry.ts`: registry types, `parseFleetRegistry`,
  `LOCKED_EXCLUSIONS`, `enrollmentLabelFor(sku)`, atomic `writeFleetRegistry`
  (mode 0600, same temp-and-rename pattern as `writeTelemetrySnapshot`,
  `telemetry.ts:253-264`).
- `packages/cli/src/fleet-service.ts`: `cirujano fleet init|enroll|cutover|verify|show`
  over the existing injected GitHub page runner (`telemetry-service.ts:24-34`).
- `packages/cli/src/args.ts`: `fleet` command parsing with the same strict
  option rules as `telemetry`.
- `packages/cli/src/telemetry.ts` + `telemetry-service.ts`: optional
  `--registry <file>` for `telemetry report`; JSON gains `enrollments[]`, the
  Markdown gains an "Enrollments" table. Without a registry the output is
  byte-identical to today (fixture test pins it).
- `packages/cli/fixtures/fleet-registry.example.json` with placeholder names.
- Runbook section in `docs/runbooks/fleet-telemetry.md`.

## Units

- U1 `[batch-eligible]` registry module, validator, fixture, tests.
- U2 `[batch-eligible]` `fleet` CLI + service + read-only GitHub reads, tests
  through the injected page runner (no network in tests).
- U3 (after U1) report section and Markdown, fixture test.

## Pseudocode

```
@ parseFleetRegistry(input) -> FleetRegistry
ctx: none (pure)
pre: input is the parsed JSON of the private registry
do:
  1. validate schemaVersion 1, owner login shape, window dates (since <= through)
  2. validate every LOCKED_EXCLUSIONS entry is present in exclusions (locked)
  3. validate each enrollment: unique id, repository under owner, sku in TELEMETRY_RATES.skus, runnerLabel enrolled for that sku, status enum, before present, after present iff status != proposed
  4. reject any enrollment whose repository matches an exclusion (exact or companion suffix -cli, -alexa, -upptime)
fail: any violation -> throw FleetRegistryError(reason)
```

```
@ fleetEnroll(registry, repository, workflowPath, jobName, sku, source) -> FleetRegistry
ctx: GitHub reads only (default branch, contents blob sha, workflow yaml)
pre: registry valid; repository not excluded; no existing enrollment for (repository, workflowPath, jobName)
do:
  1. lookup default branch head commit
  2. lookup workflow file blob sha at that commit; parse the job's runs-on
  3. validate runs-on is a hosted label priced as `sku`
  4. write enrollment { id: next P<n>, status: proposed, before: {...}, after: null }
fx: registry file rewritten atomically
fail: runs-on not hosted or already carries a cirujano label -> throw
```

```
@ fleetCutover(registry, id, commit, source) -> FleetRegistry
ctx: GitHub reads only
pre: enrollment status proposed; commit on the default branch
do:
  1. lookup workflow blob sha at commit; parse runs-on
  2. validate runs-on contains self-hosted, linux, x64 and the enrolled label
  3. write after {...}, status cut-over, recordedAt now
fail: label missing -> throw (cutover not recorded)
```

```
@ aggregateTelemetry(snapshots, sinceMs, registry?) -> TelemetryReport
ctx: none
do:
  1. existing aggregation unchanged
  2. for each enrollment: split that (repository, workflow, job) jobs at after.recordedAt into before/after
  3. compute before hosted minutes and cost, after cirujano jobs, minutes, gross avoided, queue latency p50/p95
  4. emit enrollments[] (cost fields from phase 4 stay null here)
br: if registry undefined -> enrollments omitted and output identical to today
```

## Tests (test first)

- Registry: locked exclusion missing → error; enrolling a companion of a
  frozen product → error; sku/label mismatch → error; valid fixture round-trips
  through write and parse with mode 0600.
- Fleet CLI: `enroll` records the exact blob SHA and `runs-on` returned by the
  fake page runner; `cutover` refuses a workflow that lacks the label and
  records one that has it; `verify` fails when the live blob differs from
  `after`.
- Report: fixture snapshots with two jobs before and two after a cutover
  produce the expected enrollment rows; no-registry output equals the existing
  fixture byte for byte.
- Args: unknown options and missing `--registry` rejected with exit 2.

## Acceptance

Automated: all of the above plus `python3 .rpi/scripts/rpi-verify.py` green.
Manual: none. External state: none (no GitHub writes, no Nebius).

## Exit

Record commit, checks and findings here; stop for acceptance.
