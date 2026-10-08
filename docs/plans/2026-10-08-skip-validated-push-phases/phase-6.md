# Phase 6: push-cohort measurement, report, publication

## Cohort manifest (family variant of `decodeCohortManifest`, `measurement.ts:23`)

Entries are fixed before reading results:
- `baseline[3]`: `{prNumber, prRunId, pushRunId}` on the base workflow.
- `candidate[3]`: the same shape on the candidate workflow.
- `control[1]`: `{pushRunId}`, a direct push on the candidate workflow.
Each entry binds the exact head SHA and attempt.

## Comparison (`compareSkipMeasurement`)

```
@ compareSkipMeasurement(inputs) -> measurement
ctx: GitHub reads (measure.ts), billing.ts per-job rounding
pre: same provenance across input/proposal/sandbox; cohort decoded
do:
  1. read each run/attempt/jobs; compute rounded minutes per push run
  2. validate candidate pushes: classifier validated=true, guarded jobs skipped
  3. validate control push: classifier false, every guarded job ran and succeeded
  4. validate PR runs: job set + conclusions equal across baseline/candidate PRs
  5. compute per-push saving vs baseline median; status per plan § gate
fail: missing identity / failed sample / unequal PR job sets -> rejected | no-improvement
```

The artifact records per-push minutes, medians, classifier minutes, the overhead disclosure, the
modeled history projection (labeled), `limits` and `githubListSavingUsd` (0 for public).

## Report and publish

`report.ts` gets a family template. It covers: the rule in plain language; why it is safe (tree
identity + ancestor proof + green PR run); Sandbox matrix counts; before/after minutes per push;
the overhead; the measured vs. modeled split. Hash-bound as today. `publish.ts` is reused
unchanged: a PR only between authorized refs; idempotent marker.

## Tests (first)

`push-cohort-incomparable`, `push-gate-pass`, `push-gate-candidate-not-skipped`,
`push-gate-control-skipped` (must reject), `push-gate-pr-jobset-drift`, `push-report-golden`.
The existing publish and cache-measurement tests run unmodified.

## Acceptance

Automated: full gates. Manual: none.
