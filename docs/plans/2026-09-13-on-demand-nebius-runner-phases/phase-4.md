# Phase 4: authorized live pilot and evidence

Parent: [runner plan](../2026-09-13-on-demand-nebius-runner.md).
Status: complete. The eleventh live attempt (2026-09-15, candidate `5a86aab`) passed every R14 row and `runner report` returned `complete: true`; see the exit record at the end of this file.
Entry: accepted Phase 3 plus explicit authorization to prepare this phase.
Preparation alone does not authorize GitHub mutations or spending.

## Prepare the concrete pilot before the live approval boundary

Implement `packages/runner/src/pilot.ts` and tests, a synthetic workload under
`packages/runner/fixtures/pilot/`, and a local result analyzer. The fixture runs
identical assertions on hosted Linux and the Nebius runner: Node/pnpm install,
a small deterministic test suite, and Docker service access on a fixed port.
A second sequential execution must prove fresh registration and cleanup. Preserve
workflow checks and assertions; only runner selection differs between targets.
Use workflow_dispatch, a fixed fixture commit and a 60-minute job timeout.

Read-only preflight resolves authenticated identities, a trusted private fixture
repository selected from the owner's accessible repositories, allowlisted workflow,
image ID, subnet, availability/quota, SSH route and current itemized quote.
Prefer a dedicated existing private fixture repo; if absent, prepare its concrete
creation details for the same approval request. Do not include private identifiers
in tracked docs. No automatic project/preset/region fallback.

Prepare a local permit proposal with exact candidate/config hashes and resources:
one `4vcpu-16gb` CPU VM, one 80 GiB disk, at most four starts, at most six cumulative
running hours, pilot expiry within 24 hours and estimated total ceiling of USD 5.
Failed-bootstrap and watchdog-only VMs may be deleted and recreated sequentially
within the one-VM-at-a-time limit; name each planned resource generation in the
receipt. No unplanned replacement after a test failure is authorized.
Refuse to proceed if a refreshed compute/storage/network quote does not fit that
ceiling. Budget accounting reserves the full remaining start lifetime before
starting; retained disk/IP exposure until cleanup is part of the estimate.
These are proposed ceilings, not an assertion that the owner has approved them.

The approval request must name the actual fixture repo/commit/workflow, any repo
or workflow publication, exact dispatch count, runner registration/removal,
resource create/start/stop/delete actions, deadline-interruption behavior and
cleanup and the attended first-boot limitation. Show the quote and recovery plan.
Ask once for that concrete scope;
any rejected or changed scope requires a revised proposal, not silent expansion.
No native workflow reruns or fix-and-repush loop is included.

## R14: automated live scenario and evidence matrix

| Scenario | Mandatory evidence |
| --- | --- |
| Provider contract | Real sanitized list/get/jobs/runner responses pass production parsers; permissions, resource identity and pinned artifact digest match. |
| First-boot failure | Keep the Mac awake and independently monitor startup; interrupt the controller before watchdog readiness, recover via separately authorized API stop within the ten-minute readiness bound, confirm Stopped and record the simultaneous-host-loss limitation. |
| Watchdog first | Start with no workload, shorten the test lifetime to five minutes, disconnect controller; observe VM Stopped and no automatic recovery for ten minutes. No jobs admitted until this passes. |
| Queue and execute | Dispatch the approved fixture; queued job causes start on the next successful 30-second poll; guest ready within ten minutes; job succeeds and runner ID maps to actual job/attempt. |
| Sequential isolation | Second approved job uses new registration, fixed port is free and first-job sentinel/workspace is absent; normal stop/start arms a new deadline, while controller restart and guest reboot during a grant cannot extend it. |
| Normal idle | After last job and five-minute idle grace, stop requested within one poll; VM reaches Stopped within five minutes; no owned runner remains online. |
| Restart and failure | Interrupt controller while a job runs, restart within lifetime; adopt same VM and preserve job; inject a read failure without an extra start or ordinary busy stop. |
| Comparison | Hosted/self-hosted runs share fixture commit and assertions; record durations, full VM intervals, explicit rates and estimated costs without asserting a required percentage saving. |
| Cleanup | Remove only approved run-owned runner, VM, disk and any separately created IP; API readback proves absence and identifies any residual charge-bearing resource. |

Exact dispatch count is computed from the finalized harness before approval;
never dispatch additional jobs to investigate a failure without authority.
Record every result at the tested candidate, no success-by-skip. If watchdog,
cleanup, timing or provider-contract checks fail, report failure, use the approved
recovery actions and return to local repair. Another live attempt needs approval.
API outages leave cleanup incomplete; report resource identities privately and
keep the pilot blocked until readback succeeds. Do not delete shared subnet,
project, keys or unrelated runners.

## Verification, output and exit

Before live approval, run R01–R13, local pilot/analyzer tests, independent review,
repair, simplify and all `.rpi/policy.json:7` checks sequentially. The live suite
is separate from ordinary CI and fails if invoked without required prerequisites.
No required manual visual tests apply; agents execute approved operations.

Store raw evidence and actual identifiers under ignored `.cirujano/runner/` or
`docs/agents/`. Produce a sanitized dated report under `docs/research/` with fixture
identity that is safe to publish, candidate SHA, rates, result counts, measured
latency, all state transitions, cleanup result and clear limits. Do not commit
private repo names or raw billing screenshots. Update README status and runbook
only to behavior demonstrated by R14; leave full roadmap stages visibly pending.

Phase exit requires nonzero passes, every required R14 row passing, no missing
candidate/cleanup evidence, all local gates passing and local integration
verified. No release/tag/npm publication or production migration is included.
Record findings/dispositions and final evidence paths here, then stop for owner
acceptance. Four-slot economics and Nemotron diagnosis require later plans.

## Preparation handoff and live blocker

The local pilot analyzer, exact four-dispatch manifest, deterministic workload
and materialized `workflow_dispatch` file are complete. Hosted and self-hosted
targets share one workload body and differ only in runner selection. The permit
proposal remains explicitly unapproved and enforces one VM, four starts, six
compute hours, a 24-hour expiry, full retained disk/IP and bounded network
exposure, and a USD 5 ceiling. Quote validation recomputes the total, rejects
stale or inconsistent rates and fails closed on numeric overflow.

Independent local review approved the preparation after 28 focused tests,
workflow lint and YAML parsing. The sanitized evidence report is
`docs/research/2026-09-13-nebius-runner-pilot.md`. Read-only Nebius inspection
authenticated successfully, found zero VMs, and found the tenant and every
listed project in `SUSPENDED` state. No VM, disk, IP, runner, workflow or
dispatch was created. All nine live R14 rows remain `not-run`, so Phase 4 exit
is not met and no live certification is claimed.

## First live attempt result

After billing activation, read-only preflight confirmed an active tenant and
project, a ready subnet, an empty instance inventory, the ready Ubuntu 24.04
driverless AMD64 image and the requested `cpu-d3` preset. The approved private
fixture workflow was present at its green exact commit. One self-hosted fixture
dispatch was queued to trigger the attended first-boot scenario.

The provider-contract row failed before the first start. The create request
produced one correctly shaped stopped VM, but the installed Nebius CLI returned
the async operation ID as plain text and encoded live resource fields differently
from the prepared JSON fixtures. The controller failed closed and never started
the VM or registered a runner. Recovery cancelled the queued dispatch, deleted
the stopped VM and its managed disk, and verified empty instance, disk and
allocation inventories. The remaining eight R14 scenarios were not run.

Local repair now accepts the observed async operation ID, operation collection,
queued-job sentinel fields, string-encoded disk size, CIDR-suffixed addresses and
valid block-aligned OpenSSH host keys. The complete local verification policy
passes with 307 tests. Per the R14 contract, another live attempt requires a new
candidate-bound authorization.

## Second live attempt result

The fresh receipt was bound to the repaired controller and four new fixture
dispatches. The first hosted dispatch failed before the workload because
`pnpm/action-setup` received pnpm 11.22.0 from the workflow while the exact
fixture commit declared pnpm 10.29.2 in `packageManager`. The remaining three
dispatches were not issued. No Nebius VM, disk, IP or runner was created.

The fixture now lets `pnpm/action-setup` resolve the exact version from the
checked-out commit and asserts that the installed version equals that commit's
`packageManager`. A fixture-repository regression test prevents a second version
from being added to the action configuration. The repaired fixture is integrated
locally but requires a new authorized publication before another live attempt.

## Third live attempt result

The repaired fixture and candidate received a fresh bounded authorization. Both
hosted dispatches passed the exact workload at the published fixture commit. The
first self-hosted dispatch was then queued for the attended first-boot scenario.
The controller created the single owned VM in the required stopped state, but
blocked before `start-vm`: creation had already advanced `startCount` to one, so
the one-start generation permit appeared exhausted.

The VM never ran, no guest booted, no runner registered and no workload began.
Recovery cancelled the queued dispatch, deleted the exact owned stopped VM and
managed disk, and verified empty instance, disk and allocation inventories. The
second self-hosted dispatch was not issued. Raw accounting recorded zero compute
runtime, 69.179 seconds of retained disk exposure and an estimated USD 0.000122.

The local repair advances `startCount` only when `start-vm` is journaled and
validates the create intent as a reservation for exactly the next generation.
A regression test covers create, stopped readback and first start under a
one-start permit. R14 still has no self-hosted pass and requires a new
candidate-bound authorization before another live attempt.

## Fourth live attempt result

The repaired controller and exact fixture commit received a fresh bounded
authorization. Both hosted dispatches passed the shared workload in 44 and 35
seconds. The first self-hosted dispatch queued correctly and the controller
created one owned stopped VM, reconciled it, and emitted the first authorized
start.

Nebius rejected that start with `QuotaFailure`: the active tenant's
`compute.instance.non-gpu.vcpu` allowance is zero in the selected `eu-north1`
region. The VM entered `STARTING` briefly but never ran, so no guest booted,
runner registered or self-hosted workload began. The provider also omitted the
protobuf `false` value for `spec.stopped` after the rejected start. The strict
parser blocked interrupt recovery on that valid representation.

Recovery cancelled the queued self-hosted dispatch and deleted the exact owned
VM and managed disk through the separately authorized provider API. Final live
readbacks returned empty instance, disk and allocation inventories. The fourth
dispatch was not issued. Read-only quota inspection found 200 non-GPU vCPUs in
the same tenant's `eu-west1` region and an existing active project, subnet and
matching Ubuntu image there.

The local repair treats only an omitted protobuf boolean as `false` while still
rejecting malformed values. The next proposal must bind a new candidate,
`eu-west1` project, subnet, image and resource prefixes. R14 still has no
self-hosted pass, and the failed-attempt contract requires fresh authorization
before any new dispatch or resource creation.

## Fifth live attempt result

The repaired controller was published at commit
`7576a5f8545ea2949d39971e60f6df45a43b2d3e` with CLI digest
`635735d704f065637e4995ac54d12ced3273d3b556bf5d6dd51b8d4fb2fec2f7`.
Its exact CI and CodeQL runs passed. A fresh receipt bound the same fixture to
the active `eu-west1` project, one VM at a time, four starts, six cumulative
hours and a USD 5 cap. The two hosted baselines passed in 40 and 38 seconds.

The attended first-boot generation reached `RUNNING`. The controller attempted
the pinned SSH path before the guest listener was ready, failed closed, and the
separate provider stop reached `STOPPED` within the ten-minute recovery bound.
Cleanup removed the exact VM and disk. The first-boot failure row therefore
passed without registering a runner or starting the queued workload.

The watchdog generation also reached `RUNNING`, but port 22 remained closed for
more than eleven minutes. The five-minute start deadline expired before the
controller could arm the guest watchdog. Provider and network readbacks showed
an active VM, a reachable public IP and an allow-all default security group;
the generated cloud-init placed package installation before its `runcmd`, where
the watchdog helpers and SSH restart were installed. The watchdog-first row
failed, so the queued self-hosted dispatch was cancelled and the fourth dispatch
was not issued.

Recovery stopped and deleted the exact watchdog generation. Final live reads
returned empty R5 instance, disk and allocation inventories. Conservative
provider-operation intervals and retained-disk accounting estimate USD 0.02895
for both generations. The local repair removes cloud-init's pre-`runcmd` package
work, installs and starts the watchdog control helpers first, opens the pinned
SSH path, then performs package provisioning. A new candidate-bound receipt is
required before another dispatch or resource creation.

## Sixth live attempt result

The repaired bootstrap candidate (`develop` `291a9c0e97ff9dc5906e3d216f4133b16e2a2a64`,
CLI digest identical to the accepted bootstrap proof) received a fresh bounded
authorization on 2026-09-15: three sequential generations, four starts, six
compute hours, USD 5, refreshed public rates. Both hosted baselines passed the
shared workload in 43 and 37 seconds.

Generation one proved the first-boot-failure row: the controller was
interrupted before any readiness, the separately observed provider stop reached
`STOPPED` within the ten-minute bound, and exact cleanup removed the VM and disk.
Generation two proved the watchdog-first row at this candidate: strict SSH
accepted the pinned host key, the grant armed about two minutes after start, the
controller was disconnected, the guest powered itself off within about eighty
seconds of its immutable deadline, and ten one-minute provider reads showed
`STOPPED` with no automatic recovery. No runner registered in either generation.

Generation three reached a fully provisioned guest (`ready`, watchdog active,
Node 22 and Docker present) and emitted the first live `register-runner`. The
guest helper exited before `config.sh` ran: the bootstrap creates the state
directory `/var/lib/cirujano` with mode 0700, and the helper changes into
`/var/lib/cirujano/runner-1` as the unprivileged `runner` user, which the
parent directory forbids. Read-only guest inspection reproduced the
`Permission denied`. The registration token was never used; GitHub listed zero
runners throughout. The controller failed closed, `runner stop` drained and
stopped the guest, `runner cleanup` removed the VM and disk, and the queued
self-hosted dispatch was cancelled with zero steps executed. The fourth dispatch
was not issued. Final reads returned empty instance, disk and allocation
inventories and no runners.

Conservative provider-interval accounting estimates about USD 0.043 for the
three generations. Two further findings were recorded: helper failures persist
only their classification, not a redacted stderr tail; and unrelated CI activity
in the fixture repository made the GitHub pagination snapshot transiently
inconsistent, so the controller correctly reported no complete demand for about
twelve minutes before the first create. The local repair must make the runner
working directory traversable by the `runner` user without exposing the grant
file, add that assertion to the boot oracle, and persist bounded helper
diagnostics. Queue-and-execute, sequential-isolation, normal-idle,
restart-and-failure and comparison remain `not-run` or `failed`; a new
candidate-bound receipt is required before another dispatch or resource
creation.

## Local repair after the sixth attempt

Implemented on 2026-09-15 in an isolated worktree from `develop`
`4478b55f1facd72d54c08b0843df384f2ac8bd92`, test first. Independent review and
four simplify passes (reuse, simplification, efficiency, altitude) ran before
integration; every actionable finding was applied or given a disposition.

Findings and repairs:

- The state directory `/var/lib/cirujano` is now 0711 in the bootstrap and,
  because GNU `install -d` re-applies its mode to an existing directory, also
  in `arm-grant.sh` and `watchdog.sh`. Review found that the two runtime
  helpers would otherwise have reverted the bootstrap fix on the first grant.
  A static test rejects any private mode on the shared state directory and a
  behavioral test asserts 0711 after both helpers run.
- `grant.env` is 0644 (generation, timestamps and margins only) so the
  job-start hook can read it as the runner account. The hook also used
  `deadline_ms` where the grant writes `grant_deadline_ms`, which would have
  refused every job; it now uses the real field names, refuses a missing or
  unreadable grant instead of treating the bounds as zero, and takes no
  environment overrides because it runs inside the job's environment. The test
  exercises a substituted copy against a grant that `arm-grant.sh` wrote.
- The QEMU boot oracle additionally requires
  `state-dir-traversable-not-listable` from the runner account. The oracle
  arms no grant on purpose, so the arm-grant and watchdog mode paths are
  covered by the unit tests above rather than by the oracle.
- Guest helper failures persist a bounded, credential-shape-scrubbed
  stderr/stdout tail to `helper-diagnostics.jsonl`. The per-tick status probe
  never persists (its failure is already an incomplete snapshot), a
  persistence failure never masks the classified SSH error, and
  `SshInvocationError` classifies once. One `CREDENTIAL_SHAPE_PATTERN` in
  `journal.ts` now backs cloud-init rejection, every redacted event and the
  helper tails.

Disposition: the altitude suggestion to arm a grant inside the boot oracle was
declined because it would change the unarmed-poweroff timing the oracle
exists to prove. The pre-existing telemetry scheduler lock test failed once
under review-agent load and passed in the accepted sequential run; it is a
100 ms startup race unrelated to this change and is recorded here rather than
silently retried.

Evidence at the candidate: complete local policy passed (typecheck, lint,
build, bundle verification, 84 CLI and 293 runner tests among the workspace
suites); the pinned Noble boot oracle passed with SSH ready after 51 s, the
new traversal proof satisfied, unarmed poweroff 609 s after readiness and
clean ephemeral cleanup; cloud-init 26.1 schema validation passed. No GitHub
or Nebius mutation occurred. Queue-and-execute and the later R14 rows still
require a new candidate-bound authorization.

## Seventh live attempt result

The state-directory repair candidate (`develop`
`8d128b55699928d1e494b5d22bd5340b7a9116ff`) passed exact CI and CodeQL and
received a bounded authorization for the workloads generation only. Both
hosted baselines passed in 38 and 48 seconds. The controller created, started
and armed the guest, reached `ready`, and emitted the first live
`register-runner`, which failed again. The newly persisted helper diagnostics
recorded the Actions runner's own message: read permission is required for
the generation directory and every directory up the hierarchy, and
`/var/lib/cirujano` denied it. A traverse-only 0711 state directory is
therefore insufficient; the runner enumerates its ancestors.

Recovery drained and stopped the guest, deleted the exact VM and disk, and
cancelled the queued self-hosted dispatch with zero steps executed. The
fourth dispatch was not issued; final reads showed empty inventories and no
runners. One start and roughly five minutes of compute were consumed.

The local repair makes the state directory 0755 in the bootstrap, arm-grant
and watchdog helpers, tightens the static guest test to reject any
non-enumerable mode, asserts 0755 after both helpers run, and changes the boot
oracle proof to require that the runner account can both enter and read the
directory. The complete local policy and the pinned Noble boot oracle passed
at that candidate (SSH ready after 55 s, unarmed poweroff 612 s after
readiness). Queue-and-execute onward still requires a new candidate-bound
authorization.

## Eighth live attempt result

The enumerable-state-directory candidate (`develop`
`152a10acf7409e28c6415eddced76083c6607dad`) passed exact CI and CodeQL and
received a bounded authorization for the workloads generation only. Both
hosted baselines passed in 35 and 37 seconds. The controller created, started
and armed generation one, but the guest watchdog quarantined it about two
minutes after start, before provisioning finished, and powered it off. The
controller then observed the stopped VM with eligible demand and emitted a
second start; generation two booted from the same disk, which does not
re-run cloud-init, so `ready` never appeared and the controller blocked on an
uncertain guest state. Both permitted starts were consumed. Registration was
therefore not reached and the previous repair remains unexercised.

Read-only guest inspection showed the `quarantined` marker, a chrony
configuration that steps the clock during its first three updates, and a guest
clock within a third of a second of the controller after synchronization. The
quarantine cause is inferred, not observed: the watchdog quarantined on any
backward wall-clock movement and the grant seeded that comparison from the
controller's clock, so an early NTP step or a small host/guest offset was
sufficient. Interrupt recovery and `runner stop` both failed because the drain
helper assumed a generation directory that a never-registered generation does
not have; the separately authorized provider stop, exact cleanup and cancellation
of the queued dispatch completed with empty final inventories and no runners.

The local repair removes every wall-clock read from the guest deadline path:
the watchdog measures the unarmed window from a persisted per-boot monotonic
anchor and an armed grant by accumulated running time, quarantining only on
in-boot monotonic regression; arm-grant judges expiry the same way and starts
each generation at zero running time, which also fixes a latent inheritance of
the previous generation's elapsed time; the job-start hook measures remaining
running time on the same basis; drain tolerates a missing generation
directory. The controller blocks instead of restarting when the provider reports
`stopped` while the journal believes the guest is up, records a reconciled
create as `stopped`, and records its own emitted stops so only those may
restart. Independent review and a simplify pass were applied, including the
review finding that a direct stop on an already-stopped VM must not be recorded
as the controller's own. The complete local policy passed; the QEMU boot oracle
passed on the pre-review watchdog and could not be rerun locally on the final
scripts because the host was under memory pressure from unrelated containers,
so the exact CI boot oracle is the acceptance for the guest change.

## Ninth live attempt result

The monotonic-watchdog candidate (`develop`
`83dd477beca75c13788580ae733ccaddbf7149f9`, whose boot oracle now arms a
grant after SSH readiness instead of racing the controller-loss window)
passed exact CI and CodeQL and received a bounded authorization for the
workloads generation only. Both hosted baselines passed in 37 and 45 seconds.
The controller created, started and armed the guest, the guest reached
`ready`, and `register-runner` completed for the first time: the runner
the generation-one runner appeared in the repository with the expected
labels. It stayed offline. The runner's own diagnostic log recorded the
cause: GitHub answered the listener's first message request with "Runner
version v2.328.0 is deprecated and cannot receive messages", and the
`--disableupdate` registration cannot self-upgrade. The state directory mode,
grant, watchdog, provisioning and registration repairs therefore all held;
the pinned runner archive was the remaining blocker.

SIGINT recovery drained the registered generation, removed the owned runner,
stopped the VM and returned `completed: true`; cleanup removed the exact VM and
disk and the queued dispatch was cancelled with zero steps executed. Final
reads showed empty inventories and no runners. One start and about ten
minutes of compute were consumed.

The repair pins Actions runner v2.337.0, the latest release, with the
SHA-256 published in its release notes and verified against the downloaded
linux-x64 archive; the runbook records that the pin must be compared with the
latest release before every live attempt. Queue-and-execute onward still
requires a new candidate-bound authorization.

## Tenth live attempt result

The re-pinned candidate (`develop` `79b5a58bc3082e362525cdf89198af1700872cd2`,
Actions runner v2.337.0) passed exact CI and CodeQL and received a bounded
authorization for the workloads generation only. Both hosted baselines passed
in 38 and 39 seconds. The controller created, started and armed the guest, the
guest reached `ready`, registration completed, the listener came online, and
GitHub assigned the queued self-hosted job to runner
the generation-one runner on the Nebius VM: the first self-hosted execution
of the pilot. The job failed in its "Set up runner" step before any fixture
step ran, because the Actions runner rejects a job-started hook whose path
does not end in `.sh`, `.ps1` or `.js`, and the bootstrap installed the hook
as `/opt/cirujano/job-start-hook`. The ephemeral runner deregistered after
the job as designed.

SIGINT recovery drained the generation, stopped the VM and returned
`completed: true`; cleanup removed the exact VM and disk. The dispatch had
already completed, so no cancellation was needed and the fourth dispatch was
not issued. Final reads showed empty inventories and no runners. One start and
about twelve minutes of compute were consumed.

The repair installs the hook as `/opt/cirujano/job-start-hook.sh` and points
`ACTIONS_RUNNER_HOOK_JOB_STARTED` at it, with a static test pinning both. The
queue-and-execute row remains failed at this candidate; sequential isolation,
normal idle, restart-and-failure and comparison remain not run. Another live
attempt requires a new candidate-bound authorization.

## Eleventh live attempt result and Phase 4 exit

The hook-path candidate (`develop` `5a86aab1646dd3ae98a537af6752f86e2d47fe6a`)
passed exact CI and CodeQL and received a bounded authorization for the
workloads generation only. Both hosted baselines passed in 38 and 40 seconds.
The controller created, started and armed the guest, registered the runner,
and GitHub assigned the first self-hosted job, which ran all sixteen fixture
steps green on the Nebius VM in 85 seconds. The controller drained four
seconds later, observed the five-minute idle grace and stopped the VM. The
second dispatch restarted the stopped VM as generation two with a fresh
registration and a fresh grant; the job proved the previous workspace and
sentinel absent and the fixed Docker port free, in 42 seconds. During that job
the controller process was killed by the host; the job finished on the guest,
one tick with failing GitHub reads produced no intent and no start, and the
restarted controller adopted the same VM, drained it and stopped it. Cleanup
resolved absent with empty instance, disk and allocation inventories and no
runners.

`runner report` over the collected evidence returned `complete: true`: R10
through R13 at the candidate's CI run, and every R14 row passed. The
sanitized report is `docs/research/2026-09-15-nebius-runner-pilot-r14.md`;
the raw evidence, report input and report stay under the ignored
`.cirujano/runner/r14-*`. Recorded limits: first-boot-failure and
watchdog-first were proven at the r9 candidate and the current monotonic
watchdog by the armed boot oracle in CI; the restart used SIGKILL rather than
SIGINT; the comparison is one fixture on one preset.

Phase 4 exit is met: nonzero passes, every required R14 row passing, candidate
and cleanup evidence present, all local gates and exact CI passing, and local
integration verified. No release, tag, npm publication or production migration
is included. Telemetry Phase 3 may start.
