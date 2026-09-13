# Phase 3: controller, CLI and local end-to-end verification

Parent: [runner plan](../2026-09-13-on-demand-nebius-runner.md).
Status: planned, not implemented.
Entry: accepted Phase 2 and explicit Phase 3 authorization.

## Deliverables

Create `packages/runner/src/controller.ts`, `journal.ts`, `report.ts`, and tests.
Extend `packages/cli/src/args.ts:29` and `packages/cli/src/cli.ts:17` with the
parent command contract. Add runner workspace dependency/build wiring and bundle
smoke tests. Preserve estimate, version, help and exit codes.

Journal ownership and intent before IO; write state via fsync/atomic replacement.
Use an OS-held exclusive controller lock, fail if the lock cannot be acquired,
and release it on exit. Refuse shared/network state directories and distributed
controllers. Recovery reads actual operations/resources before admitting work;
do not erase a journal to bypass ownership or a budget ceiling.

Guest starts carry a fixed deadline, not a renewable heartbeat lease. Reconcile
known active jobs even if they leave list results. Gather diagnostics before the
next registration. Forward redacted events and stderr with bounded sizes; store
private raw runner logs outside tracked files. Report partial evidence honestly.

```text
@ tick(config, permit, state) -> event
ctx: real journal and adapters under exclusive lock
pre: fixed config and candidate identity
do:
  1. lookup provider and guest observations
  2. compute decision through lifecycle module
  3. write durable intent and execute permitted effect
  4. write readback and emit redacted event
fail: interruption -> preserve intent for next recovery
```

## Behavioral oracles

| ID | Required tests and exact outcome |
| --- | --- |
| R10 | Launch two real controller processes against one temporary state directory: only one can mutate; kill/restart the owner around every journal/IO boundary: no duplicate VM/registration. |
| R11 | Run built CLI through idle→queue→start→busy→complete→drain→stop with external provider fixtures; report contains exact assignment and state readback; queued-during-drain job survives for next start. |
| R12 | Missing permit and dry-run execute zero provider writes; changed config/candidate invalidates permit; SIGINT, auth expiry, rate limit and guest loss yield bounded exit/blocked evidence with owned-resource recovery details. |
| R13 | Built CLI preserves estimate output and 0/1/2 codes; report fails completeness on missing cleanup, skipped required scenario, mismatched candidate, zero passing checks or unknown final provider state. |

Use real filesystem and owned modules throughout; fake only third-party process
endpoints, clock and remote network. The recovery harness must kill subprocesses,
not merely call a mocked restart method. Test lock acquisition and stale recovery
on macOS, the actual controller platform.

## Work units and acceptance

One integration owner implements controller/journal/CLI because their contracts
interact. After event schema freeze, report module/tests can be `[batch-eligible]`
with exclusive file ownership and no changes to controller/shared types. Add
`docs/runbooks/nebius-runner.md` and document one foreground launch and recovery
procedure; no automatic background service installation.

Run R10–R13 and all `.rpi/policy.json:7` checks sequentially after independent
review, repair and simplify. Ensure new CLI assets ship in its bundle/package;
rebuild the committed Action bundle if core or Action source changes.
Exit: end-to-end local simulation passes; real provider certification remains
pending Phase 4. Record SHA/evidence and stop for acceptance.
