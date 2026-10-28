# Phase 4: Regression investigation

Parent: [accepted contract](../2026-10-28-jev-advisory.md). Source baseline and authority are inherited from the parent; revalidate on entry.

## Scope and files

Add `advisory/{compare,compare-questions}.ts`, cohort schema and tests/fixtures; extend prepare/service/arguments. No automatic logs endpoint; optionally ingest user-supplied sanitized excerpt files through collection with explicit evidence provenance `user-supplied`, never label them as provider-verified logs. Missing logs remain visible and do not block observed timing comparison.

## Behavioral specification

Each cohort manifest lists 3–20 complete supported bundle identities, exactly one workflow path/job key/event/runner-label set and source SHA per cohort. Baseline and candidate source SHA may differ; within each cohort they cannot. Reject duplicate/overlapping run-attempt-job IDs, mixed conclusions, matrix/unknown mapping, missing or inconsistent timing and differing runner labels. Require successful jobs and non-overlapping time windows with baseline before candidate. This establishes observational comparability, not experimental causality. Display sample counts, medians, absolute/relative duration and rounded-minute deltas; baseline zero produces undefined percentage. Flag regression when median duration rises >=10% and >=10 seconds; zero-baseline positive change is shown as absolute-only, not a ratio-derived regression.

Match steps only when source key/ordinal/name/command mapping is unambiguous; otherwise show unmatched evidence. Explain observed category deltas through exact arithmetic. Optional compare request supplies bounded source changes and existing step evidence; Nouls label possible dependency setup, compilation or artifact-transfer symptoms. Templates say hypothesis and list evidence, alternatives and missing facts. No root-cause certainty, invoice claim or optimization-proof status. User-supplied excerpts require explicit source label and remain excluded from verified timing arithmetic.

```text
@ compareCohorts(base, candidate) -> ComparisonReportV1
ctx: local cohort manifests and immutable bundles
pre: complete comparable disjoint successful executions
do:
  1. validate cohort identity and source/timing completeness
  2. compute medians and deltas without semantic inference
  3. lookup compatible step evidence and optional retained hypotheses
  4. emit observations separately from hypotheses and limitations
fail: incompatible evidence -> exact missing requirement and recollection path
```

## Oracles

`compare.test.ts`: known 100/110/120 versus 130/140/150 seconds yields 110→140 median, +30 seconds; rounded minutes computed per job; missing/zero/incomparable cohorts do not fabricate percentages. Include runner change, retry attempt, overlapping run, unaligned step, elapsed inconsistency, changed workflow SHA and missing source. Recovery test replaces incompatible cohort and obtains valid report. Semantic injection cannot change arithmetic or remove comparison limitations. `service.test.ts`: complete local compare path with and without optional result; stdout separates observations/hypotheses.

## Work units

Pure cohort validator/arithmetic and tests [batch-eligible]; compare question projection/rubric tests [batch-eligible] after schema freeze, with separate fixture files. Integrator owns render/CLI/schema union and full recovery matrix.

## Verification and acceptance

Run the main plan's full sequential local gates after review, repair and simplify; retain exact commit/tree and outcomes. No hosted runs, provider inference or publication occurs implicitly. Stop for phase acceptance. Manual criterion: optional owner inspection of the generated fixture report for clarity; all correctness/recovery criteria are automated. Proposed test/artifact paths below must be created in this phase, not treated as existing evidence.

## Implementation acceptance — 2026-10-28

- [x] Strict complete comparable cohorts and exact per-job/median arithmetic.
- [x] Unambiguous command-step matching, bounded optional hypotheses and explicit missing facts/causal limits.
- [x] Independent review P4-R1–P4-R3 resolved; simplify complete; generated regression example and recovery checks pass.
- [x] Full sequential local gates pass, 2,025 passing tests across all packages.

Exact candidate/check identity and dispositions are in [implementation notes](../2026-10-28-jev-advisory-notes.md). Owner authorized continuation to phase 5; native provider budget remains ungranted.
