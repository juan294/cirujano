# Fleet migration evidence: implementation notes

Plan: [2026-09-15-fleet-migration-evidence.md](2026-09-15-fleet-migration-evidence.md).
Worktree `/Users/juan/code/cirujano-fleet-migration`, branch
`feat/fleet-migration-evidence` from `develop` `c1dccb0` (plan commit on top of
`4312e10`). Phase commits: 1 `0b28e3b`, 2 `0e32b3f`, 4 `042736f`.

## Deviations

### D-1 Enrollment record carries repository and workflow identity

- Plan said: enrollment `{ id, repository, workflowPath, jobName, sku, runnerLabel, status, before, after, controller, notes }`.
- Found: the controller config needs the numeric repository id and workflow id,
  the telemetry join needs the workflow display name, and a YAML job key is not
  always the display name GitHub reports (matrix jobs expand to several).
- Chose: additive fields `repositoryId`, `workflowId`, `workflowName`, `jobKey`
  (YAML key) and `jobNames[]` (display names; default the job `name:` or the
  key, or `--job-name` repeated). `fleet-registry.ts:41-57`.
- Why: every value is captured read-only at enrollment; without them phase 2
  would re-read GitHub to build the config and phase 4 could not join.

### D-2 `fleet verify` refreshes a stale `before`, fails on a stale `after`

- Plan said: "Both are refreshed by `fleet verify`, which fails if the live
  default branch no longer matches the recorded `after` state".
- Chose: a pre-cutover edit refreshes `before` with a note (nothing was cut
  over yet); after cutover, an edit that keeps the label exits 1 and leaves the
  record for review (`fleet cutover --commit <head>` re-records it on purpose);
  a lost label is recorded as `reverted` and exits 1. `fleet-service.ts` `verify`.
- Why: silently refreshing `after` would move the report's split point.

### D-3 Delete-vm state is `absent` with a pending effect, not `absent-pending`

- Plan said: "effect delete-vm, state 'absent-pending'".
- Found: `LifecycleState` has no such value; the controller journals a pending
  effect until reconciliation, which already models "absent pending".
- Chose: decision state `absent`, effect `delete-vm`, reconciled when the
  provider reports the VM absent (`lifecycle.ts`, `runner-service.ts`
  `reconcileEffect`). `grantDeadlineMs` is persisted in the lifecycle journal
  when a start or adoption reconciles and is optional on read so pilot
  journals still parse.

### D-4 Nebius cost uses the 30-day month of the permit accounting

- Plan said: `diskUsd = diskRetainedMs / (730 h) * 80 GiB * diskUsdPerGibMonth`.
- Found: the controller's own accounting (`advanceObservedLifecycle`) and
  `estimateRunnerCost` use a 30-day (720 h) month; the permit ceiling is
  enforced on that basis.
- Chose: reuse `estimateRunnerCost` so the report's Nebius cost and the
  enforced accounting agree; the runbook says so. The difference is 1.4 % of
  the disk term.

### D-5 `fleet publish` subcommand instead of a shell script

- Plan allowed either. The subcommand reuses the report builder and the
  registry validator, and `assertPublishable` is unit-tested directly because
  the sanitized renderer has no path that could carry a private name.

### D-6 Controller eligibility excludes pull_request runs (decision required)

- Plan said: change only the enrolled job's `runs-on`; the controller picks up
  every queued job that carries the label.
- Found: `packages/runner/src/adapters/github.ts:421-428` admits only `push`
  and `workflow_dispatch` runs on `allowedBranch` with zero associated pull
  requests (a pilot safety rule). P1's `check` job runs almost only on
  `pull_request` (PR-validated develop merges skip it, `ci.yml:100-105`), P2
  and P3 are push plus pull_request too. An unconditional cutover would leave
  every PR run queued until GitHub fails it after 24 hours.
- Why it matters: this invalidates the phase 3 procedure and the evidence
  volume goal. Options: (A) extend admission to `pull_request` runs whose head
  repository is the same private, non-fork repository, on any branch (a runner
  package change with its own tests and a config field); (B) a conditional
  `runs-on` expression that moves only default-branch pushes (tiny volume,
  and `extractJobRunsOn` refuses expressions by design). Owner decision
  pending; no cutover happens before it.

## Phase 3 state

Local, read-only preparation done on 2026-09-15 with the phase 4 bundle:
`fleet init` wrote the private registry; `fleet enroll` recorded P1
(`juan294/portfolio` is private and stays out of this repository; the handle
mapping lives in the ignored `docs/agents/fleet-migration-targets.md`) with
its default-branch commit and blob SHA; `fleet verify` is green;
`telemetry report --registry` shows 26 hosted `check` jobs, 276 minutes and
USD 1.656 in the before window; `fleet controller-config` wrote
`~/.local/share/cirujano/runner/P1/{config.json,ssh_host_ed25519_key}` with
identity `controllerId cirujano-p1-20260915`, `resourcePrefix cirujano-p1`.
Not done, each needs the owner: D-6 decision, launchd installation (dry-run
smoke), workflow edit merge, operating permit, first real jobs.

## Independent reviews and dispositions

Reviewers ran in fresh contexts against the phase commits; fixes landed in the
review-fix commit that follows `042736f`.

### Phase 1 (`0b28e3b`): CHANGES REQUIRED, no blockers

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | `stripComment` cut a `#` inside quotes (`name: "build #1"`) | resolved: quote-aware comment stripping; test with a quoted `#` |
| 2 | block `runs-on` sequence at the key's own indentation refused | resolved: items accepted at indent `>= body`; test |
| 3 | cutover checked `self-hosted` + label, plan requires `linux`, `x64` too | resolved: `requiredSelfHostedLabels`; validator, cutover and verify use it; tests |
| 4 | matrix job silently enrolled under the job key | resolved: `enroll` refuses a `strategy:` job without `--job-name`; test |
| 5 | "enroll it afresh" after a revert was impossible | resolved: reverted entries no longer block uniqueness; registry and service tests |
| 6 | added enrollment fields undocumented | resolved: D-1 above; phase-1 handoff |
| 7 | block scalar `runs-on: >` persisted `[">"]` on refresh | resolved: block scalars refused; test |
| 8 | fake page runner only rejected `--method` | resolved: fake asserts the exact `api --paginate --slurp <endpoint>` argv |
| 9 | `FLEET_SKUS` duplicates the rate table keys | rejected: `args.ts` stays free of the telemetry import; the registry validator is the authority and rejects an unpriced SKU |
| 10 | queue latency uses the run's first `created_at` | resolved: footer says so |
| 11 | `usd()` renders 3 decimals | rejected: sub-cent per-enrollment values would round to `$0.00`; the fleet table keeps 2 |
| 12 | verify refresh does not re-check the SKU | rejected: `writeFleetRegistry` re-validates and fails closed with the validator's message |
| 13 | test title overclaimed | resolved |
| could not verify | `--slurp` on single-object endpoints returns one page | verified live: `fleet enroll` P1 ran the four endpoints against GitHub and recorded the blob SHA |

### Phase 2 (`0e32b3f`): APPROVED

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | stale `grantDeadlineMs` survived delete/create reconcile | resolved: cleared on create-vm and delete-vm reconcile; recovery test asserts `null` after both |
| 2 | fleet ceiling ignored other enrollments' unissued proposals | resolved: `permit.json`, else `permit-proposal.json` count (the draft carries the same ceiling); service test refuses the fourth USD 40 proposal |
| 3 | installer smoke used a mock CLI | resolved: `run-cirujano-controller.sh` is exercised against the built bundle with the fixture endpoints (`runner-service.test.ts`); the installer test keeps the mock for launchctl orchestration |
| 4 | template rate equal to the SKU rate | resolved: template uses 0.062 |
| 5 | `startCount` 0 could emit `delete-vm` generation 0 | resolved: guard |
| 6 | `launchctl print` failure under `set -e`; sed escaping | resolved |
| 7 | node resolved through the plist PATH | resolved: `CIRUJANO_NODE_PATH` honoured and the version logged; the runbook keeps Node 22 as the expectation |
| 8 | one error text for every absolute path option | resolved |
| 9 | `network_ssd` vs `network-ssd` cosmetic | rejected: mirrors the pilot proposal shape |
| 10 | supplied `estimatedMaximumUsd` overwritten | resolved: a supplied value is validated, an omitted one derived |
| 11 | controller-side deadline before the guest watchdog (observation) | accepted as a phase 3 note: the guest window is shorter by boot time; watch for a pending `start-vm` after an expired generation |

### Phase 4 (`042736f`): CHANGES REQUIRED, no blockers

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | documented `fleet publish --output` relative path was refused | resolved: the output path is resolved against the working directory; the runbook uses `$PWD`; publish test runs with a relative path |
| 2 | a lazily written `assignments.json` hid real Nebius spend | resolved: absent `assignments.json` means no assignments yet; controller-state and accounting stay required; test |
| 3 | regenerated config next to old journals was costed at new rates | resolved: `configHash` and `repositoryId` checked across config, state and the enrollment; tests |
| 4 | guard case-sensitive and full-name only | resolved: case-insensitive, bare repository segment matched; tests |
| 5 | reverted enrollments counted as "cut-over" in totals | resolved: documented in `fleetSavings`; they keep their evidence |
| 6 | `measurementWindow.through` never applied | resolved: a registry report is bounded by the window end; test |
| 7 | 30-day month deviation not in the phase file | resolved: D-4 and the phase-4 handoff |
| 8 | no end-to-end `complete: true` publish case | resolved: publish test journals match the fixture jobs and assert `complete: true`, USD 0.293 / -0.257 |

## Simplify pass (reuse, simplification, efficiency, altitude)

Applied: shared `requiredSelfHostedLabels`, `findActiveEnrollment` and
`SHA_PATTERN` in `fleet-registry.ts`; `runnerConfigHash` exported from the
runner `config.ts` and used by the runner service, the fleet service and the
tests; `finitePositive`/`validRecentQuoteDate` exported from `pilot.ts` for
`operating.ts`; `HOSTED_SKUS` as the single SKU list (args, registry,
telemetry); `absolutePath`/`expandHome`/`readOptionalJson`/`nonnegativeNumber`
in `github-api.ts` replacing four path normalisers and three ENOENT readers;
`validIsoDate` reused by the registry; shared Markdown row cells and footnotes
between the private and sanitized renderers; `compactDate`; the compare read
asks for one commit per page; the wrapper no longer overrides the CLI's
self-measured candidate digest; a plain whole-word scan replaces regex
construction in the publication guard; the fleet ceiling reads `permit.json`
or `permit-proposal.json` (the draft carries the same ceiling); one
`removeOwnedRegistration` serves drain and delete.

Recorded for later (architectural, not drive-by): a `PublishableFleetReport`
projection so the sanitized renderer structurally cannot leak; a registry
`controller.permit` record instead of state-directory archaeology for the
fleet ceiling; a YAML dependency or a narrower `runs-on` contract for
`extractJobRunsOn`; journaling the whole `StartGrant` with invariants in
`assertStateInvariants`; a shared identity comparator exported from the
runner; moving `readRegistry` and the evidence readers out of the fleet
command module; a shared validator module parameterised by error class; the
two launchd installers sharing a sourced library; parallel GitHub reads in
`verify` once enrollments exceed a handful.

### Fix commit (`b4e50a1`): APPROVED

Every disposition above was confirmed against the code. Low notes accepted as
is: an apostrophe inside an unquoted job `name:` keeps a trailing comment in
the captured display name (`--job-name` overrides it); the bare-segment guard
refuses a publish whose private repository name coincides with a word of the
report template (fail closed and loud).
