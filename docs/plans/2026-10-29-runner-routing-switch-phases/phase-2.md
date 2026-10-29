# Phase 2: Fleet health and owner release

Parent: [runner routing switch plan](../2026-10-29-runner-routing-switch.md). Entry: phase 1 accepted; `pnpm run ci:fast` green at the phase 1 commit.

## Goal

The owner can see, every day and without opening a controller log, which enrollments are serving, expiring, unserviceable or stranding jobs. Each red row prints the exact command that ends it. The owner can release one enrollment with one command, from any machine with their `gh` login.

## Changes

### Shared stranded-run selection: `packages/runner/src/routing.ts` (new, pure)

```
@ selectStrandedRuns(runs, jobs, runnerLabel) -> {cancellable: runId[], waiting: runId[]}
pre: jobs belong to the current attempt of each run
do:
  1. lookup jobs queued whose labels include runnerLabel (stranded)
  2. compute, per run, unfinished jobs that are not stranded
  3. emit cancellable when that set is empty; else waiting
```

```
@ serviceEnd(permit, timing) -> ms
do:
  1. compute permit.expiresAtMs - timing.maxJobMs - timing.shutdownMarginMs (same cutoff as lifecycle.ts:341)
```

Export both from `packages/runner/src/index.ts` so the CLI and (in phase 3) the controller use one copy.

### GitHub writes: `packages/runner/src/adapters/github.ts`

Add to `GitHubAdapter` (`:480`), through the existing `#call` (`:576`):
- `getVariable(owner, repo, name)` -> `{ state: 'on' | 'other' | 'absent' } | incomplete` (404 = absent);
- `deleteVariable(owner, repo, name)` (204, or 404 = already absent);
- `forceCancelRun(owner, repo, runId)` (`POST /actions/runs/{id}/force-cancel`; 202 accepted, 409 already completed counts as done).

`#call` gains `'PATCH'` only if a test needs it. Every non-2xx response keeps its status and body in the thrown `GitHubResponseError`, following the existing pattern (`:606`).

### `cirujano fleet health --registry <file> [--format json|markdown] [--now <ISO>]` (read-only)

```
@ fleetHealth(registry, nowMs) -> rows, exitCode
ctx: permit.json and config.json per controller dir; GitHub GETs
do:
  1. lookup cut-over enrollments; read switch state, permit, config timing
  2. compute status per row (table below)
  3. lookup queued runs and jobs for rows with a switch label; selectStrandedRuns
  4. emit rows with recovery command; exit 1 if any row is red
fx: none (no registry write, no GitHub write)
```

| Status | Condition | Colour | Printed recovery |
| --- | --- | --- | --- |
| `serving` | switch `on`, permit valid, service end more than 7 days away | green | none |
| `expiring` | switch `on`, service end within 7 days | amber | "service ends <ISO>; renew the permit or run `cirujano fleet release --registry <R> --id <P#>`" |
| `no-auto-release` | switch `on`, permit valid but without `release-routing` | amber | "the controller cannot release this runner; reissue the permit with release-routing, or release by hand before <service end ISO>" |
| `unserviceable` | switch `on` and permit absent, invalid, expired, past service end, runtime or cost exhausted, or repository not private | red | the exact `fleet release` command |
| `released` | switch absent or not `on` | green | none, unless stranded runs exist |
| `stranded` | any job queued on the label, older than 15 minutes, while the row is `released` or `unserviceable` | red | `fleet release ... --cancel-stranded`, plus the run ids |
| `ungated` | cut-over without `routingSwitch` | red | "generate the selection with `cirujano fleet runs-on`" |
| `unknown` | any GitHub read incomplete | red | "retry; GitHub read incomplete: <reason>" |

`--now` exists only for tests and rehearsal, and it is printed in the output whenever it is used.

### `cirujano fleet release --registry <file> --id <P#> [--cancel-stranded]` (owner-run writes)

```
@ fleetRelease(enrollment, cancelStranded) -> report
pre: enrollment cut-over with routingSwitch
do:
  1. write deleteVariable; readback getVariable == absent (retry once)
  2. lookup queued runs/jobs; selectStrandedRuns
  3. if cancelStranded: write forceCancelRun per cancellable run; readback status
  4. emit report: released, cancelled ids, waiting ids, next step
fx: GitHub variable delete; run force-cancels; registry note appended
fail: readback still present -> exit 1 with status and body
```

The next step reads "push or dispatch a new run for each cancelled run". Phase 4 may change it to an automatic re-run. The registry gets a note `routing released at <ISO> by fleet release`, and the status stays `cut-over`.

### Daily agent: `scripts/collect-actions-telemetry.sh`

After the fleet report, when a registry exists: run `fleet health --format markdown`, write `$STORE_PATH/fleet-health.md` atomically, and capture its exit status without tripping `set -e`. On status 1, run `${CIRUJANO_NOTIFY_COMMAND:-/usr/bin/osascript} -e 'display notification "Cirujano fleet health is red; see fleet-health.md" with title "Cirujano"'`. A notification failure is logged and does not fail the script.

## Tests (write first)

- `packages/runner/src/routing.test.ts`: "waits while another job runs, then selects the run"; a queued job on another label is not stranded; jobs from a stale attempt are ignored; `serviceEnd` equals the lifecycle cutoff for the operating timing (`OPERATING_TIMING`, `packages/cli/src/fleet-service.ts:57-64`).
- `packages/runner/src/adapters/github.test.ts`: status mapping for get, delete and force-cancel (200/204/404/409/403/5xx) with a fake process. The real-API contract probe is phase 4.
- `packages/cli/src/fleet-health.test.ts` (new): one case per status row; "prints the release command for each unserviceable reason"; the 2026-10-28 incident replay (permit expiry `2026-10-28T23:59:59Z`, timing 60 min + 5 min, `--now 2026-10-28T23:00:00Z`) gives `unserviceable`, and `--now 2026-10-21T23:00:00Z` gives `expiring`.
- `packages/cli/src/fleet-service.test.ts`: "release deletes the switch and confirms by readback"; "release prints the push-or-dispatch step"; "release exits 1 when readback still shows the switch"; "release without --cancel-stranded cancels nothing".
- `packages/cli/src/telemetry-scheduler.test.ts`: "notifies on a red health exit and keeps the report"; "a failing notifier does not fail collection"; "no registry means no health step" (extends the existing case at `:120`).

## Acceptance

Automated:
- New tests red on the phase 1 commit, green after; `pnpm run ci:fast` exits 0.

Manual (read-only):
- `fleet health` against a scratchpad copy of the private registry reports no cut-over enrollment (all 10 are `reverted`), exits 0 and makes no GitHub write. Evidence: the command output, kept in the ignored `docs/agents/` report and never in a committed file, because it names private repositories.
- `fleet release` is not run against any real repository in this phase.

## Stop

Stop for acceptance and update the handoff.
