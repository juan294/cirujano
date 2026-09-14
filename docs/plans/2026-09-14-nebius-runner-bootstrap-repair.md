# Nebius runner bootstrap repair plan

**Status:** Accepted for implementation

**Date:** 2026-09-14

**Integration branch:** `develop` at `bae7bbd49cbb0f9dfd17a757fe0f22b5e08ca4e4`

**Research:** [Nebius runner bootstrap failure assessment](../research/2026-09-14-nebius-runner-bootstrap-assessment.md)

**Phase contracts:** [phase 1](2026-09-14-nebius-runner-bootstrap-repair-phases/phase-1.md), [phase 2](2026-09-14-nebius-runner-bootstrap-repair-phases/phase-2.md), [phase 3](2026-09-14-nebius-runner-bootstrap-repair-phases/phase-3.md), [phase 4](2026-09-14-nebius-runner-bootstrap-repair-phases/phase-4.md)

## Objective

Restore deterministic SSH readiness for the on-demand Nebius runner while
preserving the accepted watchdog-first safety boundary. Prove the repair with
schema, Ubuntu boot, controller, and one separately authorized live bootstrap
gate before any full R14 workload resumes.

## Problem and evidence

The sixth live attempt reached the guest but stopped at its SSH boundary. The
watchdog started, `ssh.service` repeatedly failed, cloud-init completed, and the
watchdog powered the guest off without runner registration or workload
execution. The retained evidence and confidence limit are recorded in the
assessment (`docs/research/2026-09-14-nebius-runner-bootstrap-assessment.md:35-80`).

The renderer currently declares only `ssh_keys.ed25519_public` and separately
writes both host-key files later through `write_files`
(`packages/runner/src/adapters/cloud-init.ts:35-65`). Cloud-init documents
matching private and public entries in `ssh_keys`; its schema command validates
an arbitrary rendered configuration. The repair will use that native pair and
remove the competing file writes.
[Cloud-init SSH keys](https://docs.cloud-init.io/en/26.1/reference/yaml_examples/ssh.html),
[cloud-init schema validation](https://docs.cloud-init.io/en/26.1/howto/debug_user_data.html)

The controller currently treats the first failed SSH command while reconciling
`start-vm` as a terminal command failure
(`packages/cli/src/runner-service.ts:587-598`,
`packages/cli/src/runner-service.ts:764-790`). OpenSSH is already configured for
one connection attempt and a bounded connect timeout
(`packages/runner/src/adapters/ssh.ts:23-46`), so the missing behavior is a
narrow readiness classification and retry boundary in reconciliation.

## Scope

Included:

- Render one complete native Ed25519 host-key pair and suppress host-key
  material and fingerprints from the serial console.
- Validate the exact production rendering path with cloud-init 26.1.
- Boot the rendered document on a digest-pinned Ubuntu 24.04 Noble cloud image
  and prove SSH identity, systemd SSH readiness, watchdog readiness, and the
  real unarmed shutdown deadline.
- Emit bounded, redacted serial diagnostics when SSH activation fails.
- Retry only recognized transient SSH readiness failures until the fixed boot
  deadline without another provider start.
- Run one candidate-bound live bootstrap proof after a separate approval.

Excluded:

- Provider lifecycle redesign, custom images, moving bootstrap work to
  `bootcmd`, runner registration changes, queue policy changes, or cost-model
  changes.
- Full R14 workload rows, four-slot operation, release, deployment, or push.
- Any live Nebius create/start, GitHub fixture dispatch, runner registration,
  or remote mutation during phases 1 through 3.

## Fixed design decisions

### One native host-key owner

`renderCloudInit` will emit `ssh_keys.ed25519_private` as a YAML literal block
and `ssh_keys.ed25519_public` as its matching scalar. It will remove the two
`write_files` entries for `/etc/ssh/ssh_host_ed25519_key*`. Existing input
validation remains the authority for format and pair matching
(`packages/runner/src/adapters/cloud-init.ts:102-175`). The renderer will set
`ssh.emit_keys_to_console: false` and `no_ssh_fingerprints: true` so the serial
log does not disclose key material or fingerprints.

The private host key remains confined to provider user-data and ephemeral test
fixtures. Tests, reports, snapshots, exceptions, and diagnostics must not print
it or its base64 encoding.

### Immutable schema and boot inputs

The schema harness will run the production renderer and validate its output
with `cloud-init schema -c <rendered-file> --annotate`. It will pin cloud-init
26.1 to upstream commit
`8bf3567532b07e2cc15aa4c76c36ebed65ccfaec` (annotated tag object
`a854e0b78ff18dc93c018ad6f15be56fed990dd9`) rather than install an unbounded
latest version.

The boot harness will use Canonical's dated Noble AMD64 image:

- URL: `https://cloud-images.ubuntu.com/noble/20260911/noble-server-cloudimg-amd64.img`
- SHA-256: `612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354`

It will create an ephemeral copy-on-write disk and NoCloud seed, use QEMU with
`accel=kvm:tcg`, capture the serial console, and delete all task-owned disks,
seeds, keys, and logs on exit. This follows Canonical's documented NoCloud QEMU
path. [Launch cloud images with QEMU](https://docs.cloud-init.io/en/26.1/howto/launch_qemu.html)

### Failure-only diagnostics

A production guest helper will run only when `systemctl restart ssh` fails. It
will emit a fixed marker, `sshd -t`, bounded `systemctl status ssh.service`, and
bounded `journalctl -u ssh.service` output to the serial console. The helper
will cap total output at 64 KiB, replace credential and private-key patterns,
and return the original SSH restart failure. It must not relax SSH settings or
keep bootstrapping after a failed daemon preflight.

### Retry only readiness failures

The SSH adapter will expose a pure classifier over the process result. Exit 255
with connection refusal, reset, timeout, route failure, or pre-banner key
exchange reset is transient only while a pending `start-vm` is younger than
`pending.createdAtMs + bootTimeoutMs`. Host-key mismatch, authentication
failure, invalid configuration, helper failure after connection, other exit
codes, and the expired deadline remain fatal.

Each SSH process attempt will use the existing connect timeout derived from
`pollIntervalMs` and a process timeout limited to that attempt. A transient
result returns the same pending effect and readback to the controller loop. It
does not call Nebius start again, change generation, arm a new deadline, obtain
a registration token, or register a runner.

### Live proof uses the existing one-step controller boundary

The live proof will use the existing bounded, one-step controller mode and stop
immediately after the `start-vm` effect reconciles and the short grant is armed.
A single queued fixture may create demand, but it must remain queued and be
cancelled before any further controller tick can plan registration. No new
bootstrap-only production command is needed.

The proof then observes guest poweroff, provider `Stopped`, no provider restart
during the defined window, no owned runner, cancelled fixture demand, and exact
resource cleanup. Any ambiguous ownership or incomplete provider/GitHub read
fails closed.

## Work sequence

| Phase | Outcome | External mutation | Gate |
| --- | --- | --- | --- |
| 1 | Complete host-key contract and exact cloud-init 26.1 schema oracle | None | Schema and focused tests pass |
| 2 | Ubuntu 24.04 boot oracle and safe serial diagnostics | None | Real boot reaches SSH and powers off at the unarmed deadline |
| 3 | Bounded SSH readiness reconciliation | None | Transient/fatal/expiry tests and full local verification pass |
| 4 | Candidate-bound live bootstrap proof | One separately approved fixture and Nebius VM | Exact stop, no restart, no runner, and cleanup evidence pass |

The work is sequential because phases 1 and 2 share the renderer and guest file
contract, while phase 3 depends on the verified boot timing and failure shape.
There are no batch-eligible implementation units.

## Verification contract

Behavioral changes follow test-first implementation. After each phase:

1. Run the phase's focused failing test before implementation and record that it
   fails for the intended missing behavior.
2. Implement, run an independent plan-compliance review, repair findings, and
   run `codex-simplify` for reuse, quality, and efficiency.
3. Run the focused tests, then execute
   `python3 .rpi/scripts/rpi-verify.py` sequentially. The repository policy runs
   typecheck, lint, build, bundle verification, and tests in that order
   (`.rpi/policy.json:6-12`).
4. Record the exact commit and test input identities. A later success cannot
   replace an earlier failed required check without a corrective change and a
   complete rerun.

The QEMU boot oracle is a required Linux gate. It will run locally on a
compatible Linux host when available and in a dedicated `ubuntu-24.04` CI job
using TCG when KVM is unavailable. It must have its own timeout of at least 20
minutes because it observes the production ten-minute unarmed deadline. A
remote push to run this job remains a separate owner authorization under the
repository push policy.

## Failure and rollback rules

- A schema error, SSH identity mismatch, active SSH failure, missing watchdog,
  failure to power off, or surviving QEMU process blocks the next phase.
- A diagnostic leak test failure blocks all boot and live execution.
- An unclassified SSH failure remains fatal. Do not broaden the transient list
  to make a test pass.
- Failure of the focused standard-image boot proof ends this plan before live
  execution. Return to `rpi-assess` for `bootcmd` ordering or a custom image.
- Any live ambiguity triggers cancellation of fixture demand and exact cleanup;
  do not start a replacement VM under the same approval.
- Source rollback is a local revert of the repair commits. Live rollback is
  stop/delete of only the exact candidate-bound owned VM and cancellation of
  only the proof fixture.

## Authorization boundaries

This plan authorizes local documents and, after owner acceptance, local
implementation in an isolated worktree. It does not authorize a push, CI
dispatch, GitHub fixture dispatch, Nebius create/start, runner registration,
deployment, or release.

Phase 4 needs a new exact authorization bound to the final candidate commit and
configuration hash. The request must state the one fixture dispatch, one VM,
allowed create/start/stop/delete operations, maximum runtime and cost, evidence
paths, cleanup behavior, and the explicit prohibition on registration and
workload admission.

## Final acceptance

The automated acceptance boundary requires:

- The exact rendered document passes cloud-init 26.1 schema validation.
- The pinned Noble image boots with the expected SSH host identity,
  `ssh.socket` listening, `ssh.service` usable, and watchdog active.
- The unarmed guest powers off within the declared tolerance.
- Transient SSH refusal/reset remains pending before the fixed deadline without
  another provider start; fatal errors and expiry fail closed.
- Failure diagnostics are sufficient to identify `sshd` startup errors and do
  not expose secrets or private key material.

The separately authorized live acceptance boundary requires:

- One live guest accepts a short grant, powers off, reaches provider `Stopped`,
  stays stopped for the observation window, never registers a runner, and is
  cleaned up exactly.

The repair is complete only when both boundaries and all four phase contracts
pass.

Only then may a new plan or authorization resume the workload-dependent R14
rows.

## Durable handoff

Objective and scope are fixed by this plan. Research and planning used
`develop` at `bae7bbd49cbb0f9dfd17a757fe0f22b5e08ca4e4`; implementation must
start from the then-current verified `develop` in an isolated worktree. The
existing assessment is intentionally uncommitted and must be preserved with
these plan artifacts until the repository workflow decides their commit.

The decisive evidence is the sixth attempt's repeated `ssh.service` failure,
successful cloud-init completion, watchdog poweroff, and absence of runner or
workload execution. The accepted design keeps the provider and controller
architecture, makes cloud-init the sole host-key owner, adds a pinned schema and
boot oracle, and retries only classified SSH readiness failures inside the
original boot window.

No technical or product decision remains open for phases 1 through 3. Phase 4
is intentionally gated on the final candidate identity, current read-only
provider/GitHub state, and a new owner authorization. The next action after
plan acceptance is phase 1 test-first implementation. Do not infer live, push,
deployment, or continuous-phase authority from this document.
