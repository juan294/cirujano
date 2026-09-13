# Fleet telemetry and 45-day savings evidence

Date: 2026-09-13
Status: approved for implementation by the owner
Measurement window: 2026-09-13 through 2026-10-28

## Objective

Collect durable daily GitHub Actions evidence across every active repository
owned by the configured GitHub account. As repositories move to Cirujano,
measure usage, reliability and the hosted-runner cost avoided. Keep raw evidence
local and credential-free so the final hackathon report can be reproduced.

GitHub rounds each hosted job up to a whole minute. Standard hosted runners are
free for public repositories and self-hosted runners are free at GitHub; private
hosted usage draws from the account allowance before list-price charges.
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
The dated standard rates used by the first collector are Linux $0.006/minute,
Windows $0.010/minute and macOS $0.062/minute.
[GitHub Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)

## Scope and contract

`cirujano telemetry collect` discovers active, non-archived repositories owned
by one account through the authenticated GitHub CLI. It stores one atomic JSON
snapshot per UTC day under a private local directory. Each completed job records
repository visibility, workflow/run/attempt/job identity, event, timestamps,
conclusion, runner labels/name, rounded minutes, runner class and dated list
price. Jobs that never started or have incomplete timestamps keep their stable
identity without receiving invented minutes or cost. Each priced job retains
the exact GitHub SKU, per-minute rate and source. A stable key lets reports
deduplicate overlapping collection windows.

`cirujano telemetry report` reads snapshots, rejects malformed or conflicting
duplicates and emits JSON or Markdown. It reports repository/workflow/job counts,
success rate, hosted minutes and list cost, Cirujano job minutes, gross hosted
cost avoided, other self-hosted usage, jobs not run, incomplete timing and
unknown prices. Gross avoided cost is not called net savings until
candidate-bound Nebius accounting is present.

The local scheduled collector runs at login and daily, uses the existing `gh`
authentication without copying its token, serializes runs with an operating
system file lock, and writes a cumulative latest report. The installer copies a
tested CLI bundle outside the working tree and waits for a fresh snapshot,
report and zero launchd exit. A 48-hour overlap tolerates a missed day;
deduplication prevents double counting. Same-day retries reuse already persisted
completed runs and fetch only new ones. Failures remain in a local error log and
cannot replace the last valid snapshot. Data and log directories are owner-only,
and successful logs contain aggregate counts rather than repository names.

## Phases and acceptance

1. **Data contract and collector.** Add strict parsing, classification, pricing,
   stable identities, atomic persistence and injected GitHub execution tests.
   Acceptance: public hosted cost is zero, private hosted cost uses per-job
   rounding, overlapping windows deduplicate, incomplete jobs remain visible,
   and malformed, conflicting or provider-incomplete data fails closed. A
   Cirujano job receives avoided-cost credit only when its runner name and an
   enrolled baseline SKU label are both present.
2. **Report and scheduler.** Add JSON/Markdown aggregation, wrapper, launchd
   template and installer. Acceptance: deterministic fixture report, no token in
   artifacts or plist, one active installed job, successful first collection,
   readable latest report and fresh snapshot.
3. **Fleet migration evidence.** After the runner pilot passes, enroll projects
   through a declarative registry and retain the prior hosted runner class for
   each migrated job. The initial standard-Linux contract uses the exact
   `cirujano-baseline-actions_linux` runner label, while the current pilot uses
   the separately enrolled `cirujano-pilot-fixture` label. Other SKUs require
   their own dated enrollment. Acceptance: each enrollment has before/after exact workflow
   identity, Cirujano assignment evidence and Nebius accounting; the final
   45-day report separates gross avoided cost, provider cost and net savings.

Phase 3 depends on the live runner pilot and is not satisfied by installing the
collector. AWS infrastructure is deferred because a local catch-up collector
meets the current durability need without another credential or paid service.
Escalate to AWS only if freshness monitoring shows missed collection that the
overlap cannot recover.
