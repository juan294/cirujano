# Fleet migration evidence: telemetry Phase 3 plan

Date: 2026-09-15
Status: accepted for implementation by the owner (decisions recorded below)
Base: `develop` `4312e10e3d59877151d3ad023a7f3d1e21174932`, `/Users/juan/code/cirujano`
Parent contract: [fleet telemetry plan](2026-09-13-fleet-telemetry.md), phase 3
Prerequisite met: the live R14 runner matrix passed on 2026-09-15
([report](../research/2026-09-15-nebius-runner-pilot-r14.md))
Phase files: [1](2026-09-15-fleet-migration-evidence-phases/phase-1.md),
[2](2026-09-15-fleet-migration-evidence-phases/phase-2.md),
[3](2026-09-15-fleet-migration-evidence-phases/phase-3.md),
[4](2026-09-15-fleet-migration-evidence-phases/phase-4.md)

## Objective

Move real hosted jobs from the owner's private repositories onto the on-demand
Nebius runner, record each enrollment and cutover with exact evidence, run the
controller continuously for the rest of the measurement window (through
2026-10-28), and produce the 45-day report that separates gross hosted cost
avoided, Nebius provider cost and net savings per repository and for the
fleet. The owner's stated goal is evidence volume: enough migrated runs to show
real cost impact, not a proof of one job.

## Scope

In scope: a private declarative fleet registry with locked exclusions;
enrollment, exclusion and cutover records with before/after workflow identity;
an operating permit shape and a per-repository launchd controller on the
owner's Mac; automatic recovery of an expired generation; one workflow edit
per enrolled repository (the only GitHub write, merged by the owner); report
joins that turn telemetry plus controller accounting into net savings.

Out of scope: multi-repository VM pooling or more than one VM per enrolled
repository (the runner plan defers four-slot scheduling); a remote controller
host (deferred until freshness evidence shows queued-job expiry); public
repositories (hosted minutes are free, so migration only adds provider cost);
the excluded projects; Nemotron diagnosis and workflow patch proposals.

## Decisions recorded

- D1 Controller host: launchd agents on the owner's Mac, one per enrolled
  repository, reusing the telemetry installer pattern
  (`scripts/install-telemetry-agent.sh:1-93`,
  `scripts/launchd/com.thecreativetoken.cirujano-telemetry.plist.in`). Jobs
  that target Cirujano wait while the Mac sleeps; GitHub fails a job queued for
  a self-hosted runner after 24 hours. Mitigation: enroll human-triggered jobs
  on repositories the owner pushes to daily; record queue latency in the
  report; escalate to a small always-on controller host only if the report
  shows expired queued jobs. Owner accepted this recommendation.
- D2 Enrollment order: P1 (private application repository whose single
  `check` job averages about 11.5 hosted minutes, 23 runs in the first two
  days), then P2 (private repository with two single-run jobs of about 6 and
  5 minutes), then P3 (private repository whose cost is four parallel coverage
  shards of about 5.5 minutes, which a single-slot runner serializes to about
  22 minutes per run; enrolled last and only with that caveat recorded). The
  largest-spend private repository with mostly automated runs is deferred to a
  controller-host follow-up. Private names live only in the private registry
  and the ignored `docs/agents/fleet-migration-targets.md`.
- D3 Operating permit bounds per enrolled repository: expiry
  `2026-10-28T23:59:59Z`, `maxStarts` 600, `maxRuntimeMs` 540,000,000 (150 h),
  `maxTotalCostUsd` 40, recovery allowed, operations create/start/register/
  stop/delete. Fleet ceiling across enrollments: USD 120. The controller's
  existing cumulative runtime and cost checks (`lifecycle.ts` `startBudget`)
  enforce them. Owner delegated these numbers.
- D4 Registry placement: private, owner-only, `fleet-registry.json` in the
  telemetry store (`~/.local/share/cirujano/telemetry/`), because it names
  private repositories. The repository tracks the schema, the validator and a
  fixture with placeholder names.
- D5 One controller per enrolled repository, one VM at a time, the pilot's
  `cpu-d3` `4vcpu-16gb` preset and 80 GiB disk, runner label
  `cirujano-baseline-actions_linux` (already priced as `actions_linux` in
  `packages/cli/src/telemetry.ts:17-21`).
- D6 Generation lifetime for operation: `lifetimeMs` 4 h, `maxJobMs` 60 min,
  `shutdownMarginMs` 5 min, `idleGraceMs` 5 min, `pollIntervalMs` 30 s. When a
  grant expires while the guest is busy, the guest powers itself off; the
  controller must then delete and recreate under the operating permit instead
  of blocking forever (today it blocks by design, lifecycle.ts guard added
  2026-09-15).

### Budget decision update (2026-09-26)

The owner authorized a larger fleet spending cap to collect evidence beyond the
initial pilot. The fleet ceiling is USD 320, enough for eight private-repository
operating permits at the existing USD 40 per-enrollment maximum. This is a
maximum committed liability through the measurement window, not a spending
target or a savings claim. The per-enrollment start, runtime, cost, and expiry
bounds in D3 remain unchanged. Enrollment and workflow cutover still require
their own compatibility and exact-run verification; public repositories remain
telemetry-only because their standard hosted minutes have no list cost.

## Baseline and evidence

- Telemetry contract and credit rule: `packages/cli/src/telemetry.ts:6-21`
  (rates, enrolled labels), `:396-403` (classification: runner name prefix
  `cirujano-` and an enrolled label), `:266-332` (aggregation),
  `:334-372` (Markdown). Report shape `:106-140`.
- Telemetry CLI: `packages/cli/src/args.ts:99-169`;
  service `packages/cli/src/telemetry-service.ts`.
- Runner controller: config `packages/runner/src/config.ts`, permit
  `packages/runner/src/lifecycle.ts:23-71`, decision `:73-200`, self-stop guard
  `:155-159`, budget `startBudget`; CLI `packages/cli/src/runner-service.ts`
  (`observe` `:401-`, `assignments.json` `:198,:429-450,:920-946`,
  `accounting-state.json`, `helper-diagnostics.jsonl`), poll limit
  `DEFAULT_POLL_LIMIT` `:60`.
- Pilot permit bounds and quote: `packages/runner/src/pilot.ts:370-444`.
- Live evidence: r14 report (`docs/research/2026-09-15-nebius-runner-pilot-r14.md`):
  dispatch to job start about 4.5 minutes cold, about 1.5 minutes from a
  stopped VM, drain 4 seconds after job completion, stop within one poll after
  the 5-minute grace, controller accounting USD 0.083 for 46 VM minutes.
- Fleet data (private local snapshot 2026-09-15): 26 repositories, 5,981
  hosted minutes and USD 17.60 list cost in two days; only private
  repositories carry list cost.

## Design

### Registry (`fleet-registry.json`, private)

```
{
  schemaVersion: 1,
  owner: "<github login>",
  measurementWindow: { since: "2026-09-13", through: "2026-10-28" },
  exclusions: [ { repository, reason, lockedBy: "fleet-telemetry plan 2026-09-13" } ],
  enrollments: [ {
    id: "P1", repository, workflowPath, jobName, sku: "actions_linux",
    runnerLabel: "cirujano-baseline-actions_linux",
    status: "proposed" | "cut-over" | "reverted",
    before: { commit, workflowBlobSha, runsOn: [...], recordedAt },
    after:  { commit, workflowBlobSha, runsOn: [...], recordedAt } | null,
    controller: { stateDirectory, controllerId, resourcePrefix, permitId } | null,
    notes: [...]
  } ]
}
```

The validator hard-codes the five named exclusions from the parent plan (the
two frozen products with their CLI, Alexa and uptime companions, and the
three named repositories); a registry that enrolls any of them, or omits them
from `exclusions`, fails validation. Enrollment requires `sku` to be a key of
`TELEMETRY_RATES.skus` and `runnerLabel` to be an enrolled label for that SKU.

### Records

`before` is captured read-only through `gh api` at enrollment time: the
workflow file's git blob SHA and `runs-on` at the default branch head.
`after` is captured at cutover: the merged commit, the new blob SHA and the
new `runs-on` containing the enrolled label. Both are refreshed by
`fleet verify`, which fails if the live default branch no longer matches the
recorded `after` state (a revert is recorded as `reverted`, never silently).

### Operating controller

Per enrolled repository: a state directory
`~/.local/share/cirujano/runner/<enrollment id>/` with `config.json` (the
pilot config shape with the repository, workflow id, job name, label, D6
timing and dated rates), `permit.json` (D3 bounds, owner-issued), the
controller login key and a per-enrollment host key, and the journals the
controller already writes. A launchd agent
`com.thecreativetoken.cirujano-runner-<id>` runs `cirujano runner watch` with
`KeepAlive` and restarts it when the bounded poll limit exits. Logs go to
`~/Library/Logs/cirujano/runner-<id>.log`; the wrapper never prints tokens.

### Expired-generation recovery

When the provider reports `stopped` while the journal believes the guest was
up (the 2026-09-15 guard) *and* the journaled grant deadline has passed, the
controller treats the stop as the expected end of the immutable lifetime: it
emits `delete-vm` and, on the next eligible demand, `create-vm` for a fresh
generation, both under the operating permit. A stop before the deadline
(quarantine, provider fault) still blocks and stays manual.

### Report joins

`telemetry report --registry <file>` adds, per enrollment: the before window
(hosted jobs of that workflow/job before the cutover date), the after window
(Cirujano jobs after it), queue latency (job `startedAt` minus run
`createdAt`), Cirujano assignment evidence (runner name and id per job from the
controller's `assignments.json`), Nebius cost from the controller's
`accounting-state.json` and lifecycle journal (runtime × compute rate plus
retained disk × disk rate, at the dated rates in the config), gross avoided
cost from telemetry, and `net = gross avoided − Nebius cost`. Fleet totals
sum the enrollments. A job that carries the label but no `cirujano-` runner
name still receives no credit.

## Phases and acceptance

1. Registry, enrollment records and report section. No GitHub writes.
   `[batch-eligible]`: (a) registry module + validator + fixture;
   (b) `fleet` CLI subcommands over the read-only GitHub source. One
   integration owner.
2. Operating controller: operating permit shape, per-enrollment config
   generator, expired-generation recovery, launchd agent, installer and
   runbook. Local fixtures only; the live check is one launchd start against
   a dry-run config.
3. First cutover (P1): owner-merged workflow edit, operating permit issued,
   launchd controller live, first real jobs, records and report verified.
   Repeat the phase for P2 and P3 as separate acceptance gates.
4. Net savings report: joins, fixture test, the 45-day report generator and
   the sanitized publication procedure.

Automated acceptance is listed per phase file; manual acceptance is limited to
the owner merging each workflow edit, issuing each operating permit and
approving each launchd installation.

## Risks and limits

- Mac sleep and single-slot serialization are recorded in the report, not
  hidden; the report's queue-latency column is the evidence for escalating to
  a controller host.
- Gross avoided cost uses list prices and per-job rounded minutes exactly as
  GitHub bills; the private-account allowance is not subtracted, and the
  report says so.
- The registry and all enrollment records contain private names and never
  enter the public repository; the publishable report uses the P-handles.
- Provider or GitHub read failures block the controller (fail closed); the
  telemetry collector is independent and keeps measuring.

## Durable handoff

Objective and scope above; base `develop` `4312e10`. No code exists for this
plan yet. Decisions D1–D6 are owner-resolved in this session (D1 and D3
delegated to the planner with the recorded rationale). Next action after
acceptance: `/rpi-implement` phase 1 in a fresh session, test first, in an
isolated worktree. Phase 3 needs three owner actions per enrollment (merge,
permit, launchd approval) and consumes Nebius budget under D3. On resume,
revalidate `develop`, the private registry file if present, and the telemetry
store freshness before relying on this document.
