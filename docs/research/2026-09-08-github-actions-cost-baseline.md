# GitHub Actions cost baseline

Date: 2026-09-08
Scope: one personal GitHub account with six private repositories that bill
Actions minutes and several public ones that do not. Repository names are
withheld; the numbers are the measured starting point Cirujano exists to cut.

Each claim is marked VERIFIED (read from the billing page or computed from the
Actions API in the session that produced this note) or INFERRED (derived from
verified numbers and a stated assumption).

## Monthly bill

| Month | Gross | Billed | Source |
| --- | --- | --- | --- |
| July 2026 | $442.75 | $370.64 | VERIFIED, billing page |
| August 2026 | $546.90 | $401.78 | VERIFIED, billing page |
| September 1 to 8, 2026 | $105.76 | $6.15 | VERIFIED, billing page |

Nearly all billed usage is the "Actions Linux" SKU, shown at $0.006 per
minute after the plan's included minutes (VERIFIED, billing page grouped by
SKU: 17,483 minutes and $104.90 gross for September 1 to 8). Public
repositories, including four status-page repositories with about 17,000
scheduled runs in 30 days, bill $0 (VERIFIED, repository visibility and the
$0 billed rows).

## Where the minutes go

Method: for every active workflow with at least ten runs in the trailing 30
days, sample the six most recent completed runs, sum each job's wall-clock
minutes rounded up per job, and multiply the average by the run count. This
is the arithmetic GitHub applies. The `/actions/runs/{id}/timing` endpoint
was checked first and returns `total_ms: 0` for every job, so job
`started_at` and `completed_at` timestamps are the only usable source
(VERIFIED). The script is `scripts/gh-actions-cost-audit.sh`.

| Workflow | Runs in 30 days | Minutes per run | Estimated minutes | Status |
| --- | --- | --- | --- | --- |
| Repo A, CI | 401 | about 48 | about 19,200 | VERIFIED sample, INFERRED total |
| Repo B, CI | 207 | about 46 | about 9,600 | VERIFIED sample, INFERRED total |
| All other workflows in six private repos | | | about 11,300 | INFERRED |
| Total | | | about 40,000 | INFERRED |

Two CI workflows are roughly 70 percent of all billable minutes. Repo A's CI
fans out to 17 jobs; Repo B's to 16, led by end-to-end and local-database
contract suites of 16 to 18 minutes each (VERIFIED from job listings).

## What was already true

- Both heavy repositories already skip the push-to-integration run when the
  exact tree was validated by a green pull request (VERIFIED, workflow files).
  In Repo A the gate existed locally and had never run; in Repo B it has run
  since 2026-08-25 and the remaining duplicate-SHA case measures near zero.
- Merging coverage shards would save about $3 to $14 per month per repository
  because the shards are CPU-bound on two-core hosted runners, so one merged
  job bills nearly as many minutes (INFERRED from shard durations).
- The free levers were therefore close to exhausted before any tool existed.
  The remaining cost is in jobs that need Docker, emulators, or full builds.

## Nebius compute pricing

VERIFIED from docs.nebius.com/compute/resources/pricing on 2026-09-08:

- Non-GPU AMD EPYC Genoa (`cpu-d3`, all regions) and Intel Ice Lake
  (`cpu-e2`, eu-north1 only): $0.012 per vCPU-hour plus $0.0032 per GiB-hour.
- Presets are fixed 1:4 ratios: `4vcpu-16gb` about $0.099 per hour,
  `8vcpu-32gb` about $0.198 per hour, `16vcpu-64gb` about $0.397 per hour.
- Non-replicated network SSD $0.053 per GiB-month.

An `8vcpu-32gb` VM running around the clock costs about $145 per month
(INFERRED: $0.198 times 730 hours), which roughly equals the hosted minutes
it would absorb from the two heavy repositories (about 26,000 minutes at
$0.006, about $155). A 24/7 VM does not pay.

## The on-demand runner case

INFERRED from the verified numbers above:

- The two heavy repositories need about 26,000 runner-minutes per month,
  about 430 runner-hours.
- With four concurrent runner slots on one `8vcpu-32gb` VM that starts when
  a job queues and stops when idle, that is roughly 110 to 150 VM-hours per
  month, about $25 to $30.
- Against about $155 of hosted minutes, the on-demand runner is the lever
  that changes the bill. It is Cirujano's first feature.

## Constraints learned

- Job containers or a serializing runner label are needed for jobs with
  fixed ports (local databases, emulators, a dev server on one port), or two
  concurrent runs on one VM collide (VERIFIED from workflow files).
- `pnpm/action-setup` wipes and reinstalls its tool directory in `$HOME`, so
  concurrent runner instances need separate OS users or a per-runner
  destination (VERIFIED from the action source).
- Required status checks that gate the production branch must stay on hosted
  runners so a dead VM cannot block releases.
