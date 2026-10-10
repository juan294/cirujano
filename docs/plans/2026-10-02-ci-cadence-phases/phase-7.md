# Phase 7: measured cost and reliability acceptance

Parent: [CI cadence plan](../2026-10-02-ci-cadence.md). Entry: final activation accepted and at least 84 elapsed observation hours. Read-only collection/reporting; no automatic remedial remote action.

## Measurement

Use phase-1 tool with exact activation ledger and complete all-attempt jobs. Capture earlier-created jobs that executed inside observation. Separate fast, nightly, release, activation, production monitoring, public discounted and self-hosted execution. Report per-job rounded full duration and execution-window overlap as different estimates. Report unknown labels, incomplete timestamps, pages/errors and coverage completeness; incomplete billing reconciliation cannot pass net-cost acceptance.

Obtain billing/SKU/discount evidence through existing authenticated CLI scope, then signed-in browser if CLI lacks scope. No automatic scope expansion, emailed export or paid operation. Capture observation timestamps; moving totals are not simultaneous. Provider accounting is read-only existing ledger/export/API, with exact same allocation window and amortized compute/storage/network. Absent accounting means net savings unmeasured. Do not credit self-hosted time as avoided hosted cost.

Normalize complete observed-window rounded weighted routine job totals by elapsed hours / 24 and disclose partial calendar-day buckets separately rather than counting them as full days. Compute daily hosted routine totals, publication count and minutes per publication, full-nightly/job counts, release and monitoring costs, unknown runtime and 31-day projection. Preserve the short original assessment baseline as descriptive evidence; changes in publication/release activity mean it is not a causal controlled comparator. Show absolute costs even when a comparator is unavailable.

## Automated success criteria

1. Ordinary owner lean events executed zero full-suite jobs; CI Fast performed its real bounded work and no per-job run exceeded five hosted minutes without a reported fast-gate target failure.
2. No release accepted skipped/failed/cancelled/old-SHA full children or wrong branch/definition evidence. All required native contexts were covered; missing natural release cases remain gaps.
3. Changed heads received full suite evidence within 36 hours or visible overdue state; quiet weekly refresh and eight-day report freshness remain honest. No failed/skip refreshed successful coverage time.
4. No new Preview, unapproved automated repair publication, privileged untrusted execution or cadence-induced mutation loop.
5. Routine mean over at least 84 elapsed hours at most 80 private hosted minutes/day; 31-day projection plus 500-minute release reserve at most 2,980. Include account private monitoring and I/J actual usage in allocation even though their policies did not change. Report release reserve adequacy separately from routine mean.
6. Billing reconciliation and provider costs are available before any cash/net-savings claim. A closed-month zero invoice requires that month's final billing, not an observation-window extrapolation.

Run measurement and immutable-report validators on recorded fixtures/evidence sequentially, plus `git diff --check` for report edits. No application full rerun merely to measure cost. Write named account evidence in ignored annex, public artifact aliases only.

## Manual acceptance and failed target recovery

Owner reviews absolute spend, coverage/detection delays and platform/provider evidence limitations. Report correctness acceptance and cost acceptance separately. A missed allocation is a failed cost goal, not hidden behind percentage improvement. Identify actual remaining cost sources and prepare a separately scoped revision: lower quiet/active cadence where justified, measured reliable existing runner use, or owner-selected cap. This plan does not authorize those changes automatically.

Measurement fixtures prove absent billing/provider data cannot emit a numeric net saving; incomplete→complete evidence resolves unavailable reporting; an over-budget→under-budget fixture changes target status while preserving counts. Real resolution requires new observed data or separately authorized policy action. Never relabel delayed/queued/unknown work as savings.

## Final handoff

Record exact observation windows, account/provider inputs, run completeness, native release evidence, per-repo policy and heads, consumer deployment identity, all findings/dispositions and remaining operational limits. Preserve artifacts before worktree cleanup. The final report must state whether future-cycle allocation passed, whether net savings is measured and whether a zero monthly invoice is proven. No tags, release, push or issue/message publication belongs to this reporting phase.

Owner revision, 2026-10-03: the observation window is halved. Collect existing natural events read-only; do not dispatch extra runs to fill the shorter window. Weekly refresh and coverage deadlines remain unchanged; unobserved weekly or release behavior remains an explicit evidence gap.
