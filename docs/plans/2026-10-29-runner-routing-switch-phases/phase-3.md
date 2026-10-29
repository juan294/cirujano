# Phase 3: Controller auto-release

Parent: [runner routing switch plan](../2026-10-29-runner-routing-switch.md). Entry: phase 2 accepted; `pnpm run ci:fast` green at the phase 2 commit.

## Goal

A controller whose runner is enrolled with a switch turns the switch off by itself once it cannot serve, and does so before jobs strand. That includes the service end before permit expiry, with no queued demand. It then force-cancels runs whose only unfinished jobs are stranded on its label. The authority comes from the permit (decision D1) and survives permit expiry (D7).

## Changes

### Contracts and config

- `packages/runner/src/contracts.ts:13`: `PermitOperation` adds `'release-routing'`. `RunnerConfig` (`:60`) adds optional `routingSwitch?: { variable: string }`.
- `packages/runner/src/config.ts:14`: `OPTIONAL_ROOT_KEYS` adds `routingSwitch`, with exact keys `['variable']` and the pattern `^CIRUJANO_RUNNER_P[1-9]\d{0,3}$`. `runnerConfigHash` serializes the key only when present, so every existing `config.json` keeps its hash.
- `packages/runner/src/lifecycle.ts:17`: `PERMIT_OPERATIONS` accepts `'release-routing'`.
- `packages/runner/src/operating.ts:13`: operating proposals include `'release-routing'`. Pilot permits (`pilot.ts:432`) stay unchanged.
- `packages/cli/src/fleet-service.ts:288-304` (`controller-config`): write `routingSwitch` when the enrollment has one.

### Release authority: `packages/runner/src/lifecycle.ts`

```
@ validateReleasePermit(permit, identity, nowMs) -> PermitValidation
do:
  1. validate current permit; else validate recovery permit (lifecycle.ts:371)
  2. validate permit.operations includes release-routing
br: permit null -> invalid 'approval permit is absent'
```

### Serviceability: `packages/runner/src/routing.ts`

```
@ assessRouting(input) -> {serviceable: true} | {serviceable: false, reason} | {unknown: reason}
ctx: permit, journal totals, config timing, repository observation, projected start cost
do:
  1. validate repository observation complete; else unknown
  2. compute reason: not-private | permit-expired | past-service-end | runtime-exhausted | cost-exhausted
  3. emit serviceable when no reason applies
risk: must agree with startBudget (lifecycle.ts:390-402); a shared test pins that
```

The demand-independent checks reuse the same arithmetic as `startBudget`. `past-service-end` uses `serviceEnd` from phase 2.

### Release step: `packages/cli/src/runner-service.ts`

Runs after each controller tick (`:257`) when `config.routingSwitch` is set. The step runs at most once every 10 minutes per process, with one immediate run at process start and on the first tick a new `unserviceable` reason appears.

```
@ releaseStep(context, tickObservation) -> events
ctx: GitHubAdapter (phase 2 methods); events.jsonl
pre: config.routingSwitch set; not --dry-run (dry-run emits the would-be action only)
do:
  1. compute assessRouting; serviceable -> stop
  2. validate validateReleasePermit; invalid -> event routing-release-unauthorized (health shows S2)
  3. lookup getVariable; on -> deleteVariable; readback getVariable == absent
  4. compute selectStrandedRuns from this tick's runs/jobs; forceCancelRun each cancellable
  5. emit routing-release | routing-release-failed | routing-stranded-cancelled | routing-stranded-waiting
fail: 403 -> event names `cirujano fleet release`; 5xx/network -> retry next window
```

Events go through `appendRedactedEvent`, follow the existing schema (`schemaVersion: 1`, `type`, fields) and never carry tokens. A cancelled run event includes the next step "push or dispatch a new run", which phase 4 may replace.

### Documentation

- `docs/decisions/0002-runner-routing-switch.md`: context (the 2026-10-28 incident, anonymized), decisions D1 to D9, consequences, and the rejected options from the plan.
- `docs/runbooks/nebius-runner.md`, operating-controller section (`:125-210`): the gated selection, turning a runner on (`gh variable set ... --body on`) as an owner action after cutover, automatic release, `fleet health`, `fleet release`, the S8 sleep risk, and the note that the operating bounds still end 2026-10-28 (`:201`) until the owner sets new ones.
- `docs/runbooks/fleet-telemetry.md`: the `fleet-health.md` output and the notification.
- `README.md` fleet section (`:146-168`): one paragraph pointing to the runbook.

## Tests (write first)

- `packages/runner/src/routing.test.ts`:
  - "releases at the service end with no demand": expiry `2026-10-28T23:59:59Z`, timing 60 min + 5 min; serviceable at exactly `22:54:59.000Z` (matching the strict `<` at `lifecycle.ts:401`), unserviceable `past-service-end` at `22:54:59.001Z`;
  - one case per other reason; `unknown` on an incomplete repository observation;
  - "agrees with startBudget": for a table of journals and permits, `assessRouting` is unserviceable exactly when `startBudget` is invalid for a terminal reason.
- `packages/runner/src/lifecycle.test.ts`: `validateReleasePermit` accepts an expired permit with `recoveryAllowed` and the operation; refuses without the operation, without `recoveryAllowed` after expiry, and on identity mismatch.
- `packages/runner/src/config.test.ts`: `routingSwitch` parse and refusals; "hash unchanged when the switch is absent", checked against a stored hash from a pre-change config.
- `packages/runner/src/operating.test.ts`: the proposal lists `release-routing` (update the expectation at `:61`).
- `packages/runner/src/controller.test.ts`: a pending lifecycle effect never carries `release-routing` (guards the D6 exclusion of `controller.ts:388`).
- `packages/cli/src/runner-service.test.ts`:
  - "deletes the switch and confirms by readback";
  - "does nothing while serviceable" (no GitHub write);
  - "retries a failed delete and reports a 403 with the owner command";
  - "dry-run records the would-be release and writes nothing";
  - "cancels a stranded run only after its other jobs finish";
  - "releases after permit expiry under recovery authority";
  - "checks at most once per 10 minutes" (fake clock).

## Acceptance

Automated:
- New tests red on the phase 2 commit, green after; `pnpm run ci:fast` exits 0.

Manual (local only):
- An incident replay with the controller in `--dry-run` against a fake GitHub process, at simulated times `22:54:59.000Z` and `22:54:59.001Z`, shows `routing-release` only at the second. Evidence goes in the ignored agent report.
- No installed bundle is replaced and no controller is started in this phase.

## Stop

Stop for acceptance and update the handoff.
