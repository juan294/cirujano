# On-demand Nebius runner: implementation plan

Date: 2026-09-13
Status: reviewed plan, ready for owner acceptance; implementation and live pilot are not authorized.
Base: `189f5f163a9e4745cd9b6d5848b81aa231909505`, `develop`.
Workspace: `/Users/juan/code/cirujano`.

## Outcome and scope

Build a CLI-controlled pilot that detects eligible queued GitHub Actions jobs,
starts one Nebius VM, executes one job at a time with ephemeral runner
registrations, and stops compute when idle. Survive controller restart without
duplicate resources and produce evidence of queue latency, job completion,
shutdown and estimated cost. A later authorized pilot must prove the provider
seams; local simulation alone does not establish working infrastructure.

The user authorized planning after reviewing the runner-first recommendation.
Single-slot scope is the planning default presented for feedback. It deliberately
reduces the original four-slot design to establish lifecycle correctness first.
No fleet audit, Nemotron integration, patch proposal, automatic workflow edits,
production migration, public/untrusted workloads, multi-repository pooling,
Kubernetes, webhook hosting or four-slot scheduling is included. This increment
alone is not a complete hackathon entry. It does not claim the projected
four-slot monthly savings.

## Baseline and evidence

All repository locations below refer to the base commit; proposed paths in the
phase files are future deliverables, not claims of existing implementation.

| Evidence | Consequence |
| --- | --- |
| `README.md:25` and `README.md:46` | Measurement bootstrap exists; the three movements remain strategy. |
| `docs/research/2026-09-08-github-actions-cost-baseline.md:75` | Runner-first is stated explicitly; savings assume four concurrent slots. |
| `docs/research/2026-09-08-github-actions-cost-baseline.md:87` | Fixed ports and shared pnpm installation constrain concurrency; required production checks stay hosted. |
| `packages/core/src/billing.ts:14` and `docs/research/2026-09-08-github-actions-cost-baseline.md:20` | Existing default USD rate differs from measured baseline; new reports require explicit dated rates. |
| `packages/core/src/billing.ts:33` and `packages/core/src/billing.ts:137` | Reuse job-minute arithmetic and explicit-rate USD conversion. |
| `packages/cli/src/args.ts:3` and `packages/cli/src/cli.ts:17` | Extend existing CLI dispatch and preserve exit codes 0/1/2. |
| `packages/action/src/main.ts:13` | Existing Action paginates one run's jobs; no runner controller exists. |
| `docs/research/nebius-runner-cloud-init.draft.yaml:15` | Draft shares one privileged user and persistent registrations; do not ship it unchanged. |
| `.rpi/policy.json:7`, `package.json:18`, `.github/workflows/ci.yml:17` | Existing sequential local gates cover typecheck, lint, build, bundle and tests; hosted CI stays hosted. |
| `CLAUDE.md:67` and `CLAUDE.md:83` | Implementation isolation and owner authorization for paid VM operations apply. |
| `docs/release/e2e-pro-playbook.md:3` and `docs/release/e2e-pro-playbook.md:223` | Wave A is adopted but executable release reporting is absent; this plan delivers pilot reporting, not an npm release. |

Local `develop` matched GitHub when inspected. Product source history still ends
at bootstrap `293c935`. No implementation tests were run during planning.
A read-only Nebius inventory attempt in the preceding status check timed out at
authentication; VM inventory, capacity and live permissions remain unverified.

Primary provider references, inspected 2026-09-13:

- [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners): ephemeral registrations accept one job; persistent autoscaling is discouraged; queued jobs can wait up to 24 hours. Preserve diagnostic logs outside the guest.
- [GitHub jobs API](https://docs.github.com/en/rest/actions/workflow-jobs) and [runs API](https://docs.github.com/en/rest/actions/workflow-runs): discover runs and jobs, with labels, status and runner identity. Pagination and attempts matter.
- [GitHub runner API](https://docs.github.com/en/rest/actions/self-hosted-runners): repository registration tokens expire after one hour; runner administration is separate from Actions read access.
- [Nebius create](https://docs.nebius.com/cli/reference/compute/instance/create), [stop](https://docs.nebius.com/cli/reference/compute/instance/stop) and [lifecycle](https://docs.nebius.com/compute/virtual-machines/lifecycle): create/get/start/stop are explicit operations; transitional states are not completion evidence.
- [Nebius instance resource](https://docs.nebius.com/terraform-provider/reference/resources/compute_v1_instance): guest shutdown interacts with recovery policy; use `FAIL`, with a live readback test of the watchdog path.
- [Nebius pricing](https://docs.nebius.com/compute/resources/pricing): stopped compute does not incur compute charges; retained disks still incur storage charges. Use a refreshed quote in a pilot receipt.
- [Hackathon rules](https://nebiusglobalaihackathon.devpost.com/rules): Token Factory or AI Cloud plus an NVIDIA open-source model meets the platform/model requirement; deadline October 30. Runner infrastructure alone is insufficient.

## Options and decisions

| Choice | Trade-off | Decision |
| --- | --- | --- |
| Mac controller polling vs hosted webhook service | Polling adds latency and depends on the Mac staying awake; avoids hosting and webhook credentials. | Foreground Mac controller for pilot, no automatic launchd installation. |
| One slot vs four isolated slots | One slot avoids cross-job port/pnpm collisions but does not validate four-slot economics. | One slot, one trusted private repository, one VM. |
| Ephemeral registration vs persistent service | Re-registration adds work; avoids idle persistent-runner scheduling ambiguity. | One ephemeral registration per job, explicitly supervised guest process. |
| Retained VM vs VM per job | Retention reduces boot setup; does not provide a clean security boundary between jobs. | Retain one VM within an authorized pilot, clean job state; delete pilot-owned resources at pilot end. |
| Nebius CLI vs a new SDK | CLI adds a subprocess dependency; already installed and documented in `CLAUDE.md:30`. | Isolated CLI adapter with structured JSON and no shell interpolation. |

Trust is at the repository boundary. Labels and queue filters are routing, not
access control. Reject public repositories and fork/PR workloads in this pilot;
all code and collaborators with access to the selected private repository must
be trusted by its owner. A privileged Docker job can compromise the guest;
workspace cleanup is not a security sandbox. Never attach Nebius credentials or
a cloud service account to that guest. No other repository shares its disk.

## Architecture and contracts

Keep pure lifecycle/configuration/report types in a new internal
`packages/runner` workspace. Keep GitHub, Nebius, filesystem, subprocess and SSH
adapters there behind explicit interfaces; the CLI imports its public entry.
Do not put infrastructure orchestration into the measurement core or Action.

Controller support: Node 22 on macOS; guest: Ubuntu 24.04 x86_64, Docker,
Node 22 and pnpm 11.22.0. Pilot preset: regular `cpu-d3`, `4vcpu-16gb`, one
80 GiB network SSD; no GPU, spot capacity, resizing or fallback preset.
Phase 4 resolves the actual image ID, network and pricing via read-only queries
before producing an approval receipt. Unavailable capacity blocks the pilot.

Local configuration is versioned JSON under ignored `.cirujano/runner/`, mode
0600 inside a mode 0700 directory. Fields: repository, workflow IDs, allowed
branch, explicit eligible job names, unique runner label, Nebius profile/project,
subnet, immutable image ID, SSH public key/fingerprint, preset/disk specification,
poll/idle/boot limits and dated cost rates. Runtime private identifiers never go
into public plan examples. Schema rejects unknown fields and invalid bounds.
Repository validation also verifies allowlisted workflows use bounded job
timeouts and that production-required checks remain on hosted runners.

Credentials stay on the controller: GitHub Actions read and repository runner
administration permissions; existing Nebius authentication; SSH private key.
Use `gh api` with existing authentication for GitHub and `nebius` with explicit
profile/project, JSON output, no interactive browser and bounded timeouts.
Do not obtain or print long-lived token values. Pass registration tokens only
through encrypted SSH stdin into a guest helper and its private temporary file;
never through cloud-init, local command arguments, evidence or debug logs.
Guest registration consumes the token and removes the file. A short-lived token
may exist in the guest registration process arguments; no long-lived token does.

Pin the guest SSH host key through controller-generated per-VM host-key material
in the private creation request, then use StrictHostKeyChecking with that public
key. Protect and remove the temporary creation request; never trust ssh-keyscan
alone. Refresh dynamic IP addresses from the owned VM on every connection.
Bootstrap content is secret-free except this guest host key, which is not a
GitHub/cloud credential. Never store provider user-data in public diagnostics.
Pin the runner release and checksum in the candidate manifest, verify downloads,
and test archive logs, workspace cleanup and fresh registration between jobs.

### Command surface

| Command | Contract |
| --- | --- |
| `cirujano runner inspect --config PATH [--format json]` | Read-only preflight, identity, drift, quote inputs and intended resources; never register or create. |
| `cirujano runner watch --config PATH [--permit PATH] [--dry-run]` | Without a valid permit, read-only decisions; valid permit enables bounded reconciliation. Dry-run always suppresses writes. |
| `cirujano runner stop --config PATH --permit PATH` | Drain owned registration, preserve active job, stop owned VM; no forced stop before the approved deadline. |
| `cirujano runner cleanup --config PATH --permit PATH` | Remove only recorded pilot-owned runner/VM/disk resources after quiescence and explicit cleanup authorization. |
| `cirujano runner report --state PATH --format json` | Local evidence summary; incomplete provider observations remain unknown. |

Maintain existing estimate/help/version behavior. Exit 0 means completed command,
1 runtime/precondition/evidence failure, 2 invalid invocation. JSON stdout is one
versioned result for finite commands; watch emits versioned JSONL events;
diagnostics go to stderr. SIGINT drains and records state, with a bounded exit
and explicit unresolved-resource report when providers are unavailable.

A permit is an operator-created local record of actual approval, not something
the agent invents. Bind it to config hash, candidate digest, repository/project,
owned resource names, allowed create/start/register/stop/delete operations,
expiry, maximum starts, cumulative runtime and quoted total spending envelope.
Validate before each mutation; revocation/expiry forbids new starts, while the
receipt's explicit recovery clause permits stop/cleanup of already-owned
resources. Candidate/config changes require a new receipt. A receipt is a CLI
accident guard, not cryptographic proof of human identity.

### Reconciliation and failure behavior

Poll every 30 seconds; idle grace 5 minutes; boot readiness deadline 10 minutes;
maximum job timeout 60 minutes. Each start has a non-extendable 90-minute guest
watchdog and an independent controller deadline. Never admit a new registration
unless a full 60-minute job plus 5-minute shutdown margin fits before both the
90-minute start deadline and permit expiry. Retire an unassigned listener at the
latest safe assignment time. A bounded guest job-start hook checks the budget
again before user steps; late assignment fails explicitly without running user
code. GitHub documents this [hook failure contract](https://docs.github.com/en/enterprise-cloud%40latest/actions/how-tos/manage-runners/self-hosted-runners/run-scripts).

Journal a unique start generation and absolute deadline before every API start.
A root-owned guest boot service starts unarmed with a ten-minute shutdown timer
and no runner. After SSH readiness the controller sends the generation and its
original deadline, never a fresh deadline on retry. The guest persists the grant
and enforces absolute time and monotonic elapsed limits; clock rollback cannot
extend a running grant. Controller restart reuses it. Guest reboot with an active
grant preserves its deadline; an expired grant powers off immediately. No job
service starts automatically at boot.

Normal drain retires job admission only after workers exit, retaining a fallback
deadline of `min(original deadline, now + 10 minutes)` through API stop. Never
extend that deadline by clearing a grant. Only a confirmed normal provider stop
followed by a separately journaled authorized start can arm a new generation;
retain the previous grant/tombstone to reject replay and unexpected reboot.
Emergency shutdown leaves its
expired grant in place: quarantine that VM for approved cleanup, do not repeatedly
restart it or mint a new generation to bypass the deadline. Test normal second
start separately from reboot during an active grant.

Use an exclusive OS-held lock per project/controller state scope; run only one
controller on one host. Journal intent atomically before remote mutation, then
record operation/resource IDs and reconcile by a unique ownership label after
timeout or restart. Discovery with zero/one/multiple matches must respectively
permit initial creation/adopt the proven owned resource/block for review. After
an ambiguous create timeout, zero matches alone does not prove failure; block
until the operation is conclusively resolved before retrying. A stale local
PID alone never authorizes a second controller. Distributed controllers are out
of scope. Never blindly repeat create after a timeout.

Queue collection fully paginates active runs (queued, in_progress, waiting,
requested and pending where the API supports those filters) and current-attempt
jobs, unions by run/attempt/job ID, and rechecks known nonterminal jobs. Any
truncation, unknown status, API error or rate limit makes the snapshot incomplete.
No start or idle-stop decision may use an incomplete snapshot. Rate-limit reset
and Retry-After control backoff; do not turn an error into an empty queue.

Eligible jobs must satisfy repository, workflow, branch, event, name and complete
label matching. Default events are trusted push and workflow_dispatch only.
Read live run identity before registration. A job may be taken by another
matching runner; never assume the observed queued job was the one assigned.
Record actual runner/job/run-attempt mapping from GitHub after assignment.

```text
@ reconcile(snapshot, journal, permit) -> decision
ctx: complete provider reads, monotonic clock, exclusive lock
pre: config and ownership validated
do:
  1. validate permit and snapshot freshness
  2. lookup owned operations and current runner assignment
  3. compute one lifecycle transition
  4. write intent before emitting a mutation
br: unknown state -> block new work; expired lifetime -> emergency shutdown
fail: mutation timeout -> reconcile existing operation before retry
```

Lifecycle states: absent, stopped, starting, ready, busy, draining, stopping,
blocked. Provider Error does not trigger an automatic replacement VM. A failed
bootstrap stops the owned VM and reports failure. Startup cannot be called ready
until bootstrap, watchdog, SSH identity and ephemeral registration pass.

Normal idle stop requires: admission disabled, guest runner process terminated
or already exited, no worker process, GitHub reports no owned busy runner/job,
and two complete queue observations spanning the idle grace. If assignment races
with drain, return to busy and wait for completion; preserve logs. Recheck guest
and GitHub immediately before API stop. New jobs arriving after drain remain
queued for the next authorized start. Never stop because a single busy flag is
false or a controller poll failed.

After watchdog readiness, controller loss leaves the guest enforcing its existing
start lifetime even if a job is stuck; the permit must authorize interruption. Guest
`poweroff` with recovery policy FAIL is a fallback, not proof of provider state:
Phase 4 must demonstrate Stopped readback and no automatic restart. Ordinary idle
shutdown uses the Nebius stop API. No new live job is admitted before this test
passes. If the fallback fails, the pilot is blocked and uses authorized API
cleanup. First boot before watchdog installation is a separate uncovered window.
This is an attended pilot: keep the Mac awake and use an independent operator
recovery session to observe first boot. If readiness is absent after ten minutes,
that session executes the permit-authorized API stop and records readback even
if the controller died. Phase 4 tests this fault before jobs. Simultaneous loss
of the operator host and an unready guest is not bounded by the watchdog;
unattended deployment is excluded. A preinstalled watchdog image is required in
a later plan before claiming unattended startup safety.
Provider outage can prevent a strict dollar cap; report this residual
risk and do not claim a hard billing guarantee.

### Evidence and costs

Persist an atomic state file plus redacted append-only events locally. Record
candidate/config hashes, permit ID, operation IDs, VM and runner identities,
run/attempt/job IDs, queue/start/end times, boot/idle intervals, observed provider
states and cleanup readbacks. Copy runner diagnostics to local private storage
before re-registration or deletion; cleanup failures are visible failures.

Report actual observed compute duration separately from job-rounded hosted
minutes. Require explicit dated hosted, compute, disk and network rates, with
source and currency. An uncertain interval uses a conservative upper bound or
unknown value, never zero. Include stopped-disk retention. Do not silently reuse
the core's $0.008 default. A pilot comparison uses the same fixture commit,
commands, workload and result assertions on hosted and self-hosted runners;
queue/boot/idle costs are included. Label estimated costs and sample limits;
never extrapolate single-slot results to four-slot monthly savings.

## Phases and acceptance

1. [Contracts and lifecycle](2026-09-13-on-demand-nebius-runner-phases/phase-1.md).
2. [Provider adapters and guest bootstrap](2026-09-13-on-demand-nebius-runner-phases/phase-2.md).
3. [Controller, CLI and local end-to-end verification](2026-09-13-on-demand-nebius-runner-phases/phase-3.md).
4. [Authorized live pilot and evidence](2026-09-13-on-demand-nebius-runner-phases/phase-4.md).

Each implementation phase uses an isolated worktree based on accepted develop,
TDD, independent review, repair, codex-simplify and sequential verification.
Integrate locally only after checks pass. Stop for acceptance after each phase;
no working-branch push, PR, release, workflow dispatch or paid resource operation
is authorized by this plan. Phase 4 includes a concrete live-approval boundary.

Automated final acceptance requires every scenario R01–R14 in the phase files,
all existing repository gates and the real provider evidence in Phase 4. Missing
credentials do not turn required live tests into successful skips. No mandatory
manual visual tests apply; owner approval is a decision, not manual execution.

## Review and durable handoff

Independent planning review completed on 2026-09-13. F07, F09 and F10 were
repaired and rechecked; F08 has an explicit attended-pilot disposition and live
recovery oracle. No reviewer result remains outstanding. A local document check
passed for all five files: relative links, source file/line existence, nonblank
citations, pseudocode shape, whitespace, balanced fences and R01–R14 coverage.
`git diff --check` passed. These are documentation checks, not implementation
test results. Files are saved locally on develop and are not committed or pushed.

Planning scope: runner-first specification only. Defaults above are design
choices ready for owner review, not authorization to spend or implement.
No unresolved design placeholders remain. Live identity, exact quote and fixture
selection are deterministic Phase 4 preflight inputs bound to the receipt, not
assumed current facts. Four-slot operation is a separate future plan.

Known findings: F01 historical cost discrepancy is resolved by explicit-rate
reporting; F02 unsafe draft reuse is resolved by replacement bootstrap; F03 no
live auth/VM evidence remains a mandatory Phase 4 prerequisite; F04 four-slot
savings do not apply to this single-slot scope; F05 controller-loss shutdown
requires a live no-restart probe; F06 current release template is not an
implemented release gate, so release remains outside scope. Review findings F07
per-start deadlines and F09 delayed assignment are resolved by persisted grants,
listener retirement and a job-start guard. Follow-up F10 prevents deadline
extension during drain using the original-deadline cap and a regression oracle.
F08 bootstrap-before-watchdog exposure
is limited to an attended pilot with tested independent recovery; unattended
first-boot safety is not claimed.

At handoff the baseline is the SHA above; candidate implementation does not yet
exist. Planning checks cover document structure, references and review only.
Next entry is explicit authorization for `/rpi-implement` Phase 1. Revalidate
branch, status, controlling instructions, source references and current plan
before implementation. Record each phase's candidate SHA, checks, findings,
deviations, local integration result and next acceptance gate in its phase file.
