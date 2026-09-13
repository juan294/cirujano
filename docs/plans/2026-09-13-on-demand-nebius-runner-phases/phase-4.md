# Phase 4: authorized live pilot and evidence

Parent: [runner plan](../2026-09-13-on-demand-nebius-runner.md).
Status: local preparation complete and independently approved; live R14 blocked by suspended Nebius tenant on 2026-09-13.
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
