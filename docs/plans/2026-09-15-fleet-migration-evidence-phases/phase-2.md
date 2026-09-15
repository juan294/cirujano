# Phase 2: operating controller

Parent: [plan](../2026-09-15-fleet-migration-evidence.md). Entry: phase 1
accepted.

## Deliverables

- `packages/runner/src/pilot.ts` (or a new `operating.ts`):
  `buildOperatingPermitProposal` with the D3 bounds and a dated quote; it
  refuses expiry after the measurement window, more than 600 starts, more than
  150 h, more than USD 40, or a fleet ceiling above USD 120 when given the
  other enrollments' permits.
- `packages/cli/src/fleet-service.ts`: `fleet controller-config <id>` writes
  the enrollment's `config.json` (D5, D6) and generates the per-enrollment host
  key into the state directory; prints the identity for the permit.
- `packages/runner/src/lifecycle.ts`: expired-generation recovery. When the
  provider is `stopped`, the journal state is in `GUEST_UP_STATES`, and the
  journaled grant deadline (persist it in the lifecycle journal at arm time)
  is in the past, emit `delete-vm` under `delete`; a later eligible demand
  creates a fresh generation. Before the deadline the existing block stays.
- `packages/cli/src/runner-service.ts`: `delete-vm` effect execution and
  reconciliation (absent readback), journaled grant deadline from the arm.
- `scripts/launchd/com.thecreativetoken.cirujano-runner.plist.in`,
  `scripts/run-cirujano-controller.sh`, `scripts/install-runner-agent.sh <id>`:
  KeepAlive agent, owner-only paths, log without tokens, dry-run smoke on
  install.
- `docs/runbooks/nebius-runner.md`: operating section (permit issuance,
  install, verify freshness, stop and remove an agent, recovery).

## Units

- U1 `[batch-eligible]` operating permit + config generator + tests.
- U2 `[batch-eligible]` lifecycle expired-generation recovery + controller
  `delete-vm` + tests.
- U3 (after U1) launchd agent, installer, runbook; test through the existing
  `telemetry-scheduler.test.ts` pattern (`macIt`, fake launchctl).

## Pseudocode

```
@ decideLifecycle(input) -> decision   [expired-generation branch]
pre: provider stopped; journal.state in GUEST_UP_STATES
do:
  1. lookup journal.grantDeadlineMs (persisted at arm)
  2. if nowMs >= grantDeadlineMs and permit allows delete -> effect delete-vm, state 'absent-pending'
  3. else -> blocked('owned VM stopped outside the controller; delete it and create a fresh generation')
fx: journal state; provider delete on reconcile
risk: a quarantine that happens to coincide with the deadline is deleted too; acceptable, the disk holds no evidence the journal lacks
```

```
@ buildOperatingPermitProposal(input) -> proposal | reasons
pre: identity fields non-empty; quote dated within 7 days
do:
  1. validate expiry <= 2026-10-28T23:59:59Z and > now
  2. validate maxStarts <= 600, maxRuntimeMs <= 540000000, maxTotalCostUsd <= 40
  3. validate fleet sum of maxTotalCostUsd across supplied permits <= 120
  4. compute estimated maximum from the quote and the bounds; refuse if it exceeds maxTotalCostUsd
fail: any -> { accepted: false, reasons }
```

## Tests (test first)

- Operating permit: each bound rejected one at a time; a valid proposal
  parses through `parsePermit`.
- Config generator: output parses with `parseRunnerConfig`, carries the
  enrollment repository id, workflow id, job name, label and D6 timing.
- Lifecycle: stopped + up + past deadline → `delete-vm`; stopped + up + before
  deadline → blocked; after delete reconciles absent, eligible demand →
  `create-vm` generation `startCount + 1` under the same permit.
- Built CLI: fixture lifecycle where the fake provider reports STOPPED after
  the journaled deadline; the next ticks delete, then create a new VM; start
  count and cost accounting continue monotonically.
- Installer: plist has no token, KeepAlive true, one loaded agent, dry-run
  tick succeeds against a fixture config.

## Acceptance

Automated: tests above and the full gate. Manual: owner approves the launchd
installation once (`install-runner-agent.sh` against a dry-run config on the
Mac; no permit, no provider writes). External state: none.
