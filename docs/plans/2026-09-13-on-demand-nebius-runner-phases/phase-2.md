# Phase 2: provider adapters and guest bootstrap

Parent: [runner plan](../2026-09-13-on-demand-nebius-runner.md).
Status: planned, not implemented.
Entry: accepted Phase 1 and explicit Phase 2 authorization.

## Deliverables and contracts

Create `packages/runner/src/adapters/github.ts`, `nebius.ts`, `ssh.ts`,
`process.ts`, and tests; create `packages/runner/guest/` bootstrap, registration,
drain and watchdog scripts with fixture-based tests. Preserve the research draft
as history and label it superseded when the replacement is verified.

GitHub adapter: list run statuses and all job pages/current attempts; obtain
repository identity and visibility; list owned runners and register/remove only
owned ephemeral identities. Use documented API schema fixtures from the sources
in the parent, not guessed fields. Re-read attempt and assignment at handoff.

Nebius adapter: explicit profile/project and bounded noninteractive subprocesses;
create stopped resources where supported, await/read back start and stop,
reconcile timed-out operations via ownership and IDs, delete only permit-owned
resources. Creation of even a stopped VM/disk remains billable and unauthorized
in this phase. Validate selected preset, network, disk and recovery policy in
rendered JSON. Never log raw provider requests that contain guest host keys.

Guest bootstrap: install watchdog before runner readiness, use recovery policy
FAIL, pin runner archive/version/checksum, use one runner account and one slot,
install Node 22/pnpm 11.22.0/Docker and workload prerequisites. No embedded
registration token or long-lived cloud/GitHub credential. Registration helper
receives private stdin, creates one ephemeral runner, deletes temporary secrets,
then exposes local process/worker status. Add a bounded job-start hook that fails
before user steps when the remaining grant cannot fit job timeout plus margin.
The boot service implements the parent's persisted grant, unarmed timer, normal
drain and emergency-quarantine contract. Drain disables registration first,
waits for active work and preserves diagnostics before cleanup. Clean only
run-owned workspace, containers, volumes and process trees. Docker/root access
is permitted only under the trusted-repository limitation in the parent plan.

## Behavioral oracles

| ID | Required tests and exact outcome |
| --- | --- |
| R06 | Multi-page queued/in-progress runs and rerun attempts resolve once per job; malformed/truncated/429/403 responses produce incomplete snapshots and zero scaling decisions. |
| R07 | Create timeout with one owned resource adopts it; multiple matches, foreign IDs and Error state block; repeated stop reconciles without touching other resources. |
| R08 | Token sent through stdin is absent from argv/local logs/events/cloud-init; strict SSH host-key mismatch blocks; invalid runner checksum prevents readiness. |
| R09 | Bootstrap/watchdog failure forbids registration; drain racing assignment preserves worker; second job gets fresh registration and workspace; normal second start gets a new grant, controller restart and guest reboot preserve the old deadline, clock rollback cannot extend it, and delayed assignment fails before user code. |

Local tests execute owned adapters and helpers, replacing only external process,
network, clock and Linux system boundaries. Syntax-check every shell script with
`bash -n`. Linux systemd/Docker semantics are a named Phase 4 live gap; do not
claim that a macOS shell test validates them. Capture real provider responses in
Phase 4 and replay them through these same parsers to pin the fixture contract.

## Independent units and gates

After Phase 1 contracts are fixed, these units are `[batch-eligible]`:
A owns GitHub adapter/tests; B owns Nebius adapter/tests; C owns SSH/process and
guest files/tests. None changes shared contracts or package wiring. One integration
owner handles any shared wiring after unit completion. Use at most three local
implementers; sequential work is acceptable. No remote branches or PRs.

Run R06–R09, shell syntax checks, independent review/repair, simplify and all
`.rpi/policy.json:7` checks sequentially. No live registration/provisioning here.
Exit: locally verified adapters with explicit live coverage gap and candidate
record. Stop for Phase 2 acceptance; live readiness is not claimed.
