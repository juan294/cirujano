# Phase 5: Comparative evaluation and documentation

Parent: [accepted contract](../2026-10-28-jev-advisory.md). Source baseline and authority are inherited from the parent; revalidate on entry.

## Scope and files

Create `scripts/advisory/evaluate.mjs`, `packages/cli/fixtures/advisory/evaluation/`, `packages/cli/src/advisory/evaluate.test.ts`, and `docs/runbooks/advisory.md`; update README/CLI examples and package command only if needed. Evaluation invokes built CLI subprocesses against fixture files; use their JSON contract and do not add test-only public exports. Existing optimize evaluation is consumed as seed data, never relabeled Jev proof.

## Fixed evaluation design

Create 60 independently labeled public/synthetic cases before tuning: 24 development and 36 held-out, split by repository/template family, balanced across install/build/test/artifact/mixed/unknown, with at least six adversarial/missing/no-match cases in holdout. Add a separate search set of 12 development and 24 held-out queries, split by template/repository: 18 held-out answerable queries with at least three independently labeled relevant candidate IDs each, and six no-match queries. Labels include acceptable evidence IDs, expected supported/uncertain/no-match result and permitted numerical outputs. Keep a human-readable rubric and frozen manifest hashes. Independent reviewer audits all holdout labels without seeing model answers. Report denominators and 95% bootstrap intervals; small corpus remains a limitation.

Compare rules/lexical-only with Jev on semantic tasks. Evaluate current Nemotron and Jev versus explicit numerical materiality rules on the existing cache/push seed inputs in shadow mode, not by changing production diagnosis. A generative semantic comparator may use a separate evaluation-only fixed prompt and allowlisted evidence IDs; never reuse or forge optimization receipts. Cascade is simulated from separately recorded per-case outcomes/costs; label projected latency/cost rather than native execution. Initial numeric rules: cache install median >=30 seconds and median install/job share >=20%; push projected validated billed minutes minus one minute per push >0 and validated share >=20%. These are experimental policy values, not accepted replacements.

Automated local acceptance: evaluator detects every fixture authority/numeric invariant violation; replay/live status cannot be confused; all result hashes and versions validated; seed labels and split reproducible; no live request without per-request permits. End-to-end local rules/search/compare benchmark on 20 retained bundles after build, five warm runs and one cold run; record hardware/runtime and baseline alongside new output, no unsupported CI-runtime speed claim.

Native semantic qualification: at least 90% precision for displayed supported labels, at least 80% recall on answerable cases, evidence reference integrity 100%, zero unauthorized effects, at least 10 percentage-point relevance precision@3 improvement over lexical baseline on the 18 answerable search holdouts (denominator 54 result slots; omitted slots count incorrect). If lexical precision@3 already exceeds 90%, require no precision loss and a separately measured >=20% reduction in median evidence-finding time on the same tasks in a blinded paired developer review; without that evidence do not qualify semantic search. Report each feature independently rather than rejecting good labels because search does not qualify, and no more than 5% false-answer rate on no-match cases. Jev request p95 <=5 seconds and cost <=$0.001 per useful displayed card on measured corpus; disclose failures, unknown costs and retrieval time separately. If any gate fails or native calls are unavailable, semantic mode remains opt-in and explicitly UNMEASURED/NOT QUALIFIED; rules-only features remain accepted if their gates pass. Do not tune on holdout to rescue a result; create a new version and fresh held-out set for a later evaluation.

Prepare a live experiment manifest with exact public/synthetic payload hashes and a estimated $1 total spend allowance, at most 200 one-attempt inference requests across all providers, plus endpoint/model/price/request bounds. This is a future approval proposal, not granted spend. Dry-run computes dated cost estimates and refuses if they exceed the allowance. These are not a guaranteed provider billing cap: before execution, the owner must authorize the disclosed estimate/uncertainty, or a verified provider-side cap must bound a required hard ceiling. Absent that authorization, native evaluation remains unavailable. Label and search evaluations fit under the combined 200-request cap; perform an exact dry-run request count before approval, with no retries or extra tuning calls included implicitly. No private data, new hosted CI or billable runner. Only after explicit approval execute, stop at first unknown outcome, reconcile report without retry, and retain exact native receipts. Without approval, produce the complete dry-run package and report qualification unavailable; do not call the task empirically proven.

## Oracles and developer docs

`evaluate.test.ts` proves wrong labels fail precision/recall, fabricated references fail integrity, replay cannot pass native gates, budget and request caps stop execution, missing usage blocks cost qualification, input/model drift invalidates results, and crash/unknown outcome prevents remaining sends. Runbook explains each command, exact payload review, key setup without exposing keys, all recovery states, local-only fallback and Sutura boundaries. Include representative complete/partial/no-match/regression reports generated by real local code. Optional owner review checks that reports suggest a clear next step; do not require manual testing for CLI correctness.

## Work units

Evaluator implementation/tests [batch-eligible] and runbook/examples [batch-eligible] only after CLI contract freeze; distinct files. A separate read-only reviewer owns label audit and receives no model outputs. Integration owner owns root package command/README and full final gates. No parallel model experiments or external publication.

## Verification and acceptance

Run the main plan's full sequential local gates after review, repair and simplify; retain exact commit/tree and outcomes. No hosted runs, provider inference or publication occurs implicitly. Stop for phase acceptance. Manual criterion: optional owner inspection of the generated fixture report for clarity; all correctness/recovery criteria are automated. Proposed test/artifact paths below must be created in this phase, not treated as existing evidence.

## Implementation acceptance — 2026-10-28

- [x] Frozen 60-case label and 36-query search corpus; independent blind audit passed before scoring.
- [x] Real CLI evaluation, invariant/refusal oracles, numerical shadow comparison and explicitly projected cascade.
- [x] Complete 121-request future experiment proposal, estimated $0.0564190258 within the proposed $1 allowance; no live authorization or native calls.
- [x] Local 20-bundle benchmark with estimator baseline, one first-process observation and five warm repeats per command; hardware/runtime and cache limits recorded.
- [x] Developer runbook, generated complete/partial/no-match/regression reports, independent review P5-R1–P5-R6 resolved and simplify complete.
- [x] Full sequential local gates pass, 2,065 passing tests across all packages; native qualification remains UNMEASURED.

Exact candidate/check identity and dispositions are in [implementation notes](../2026-10-28-jev-advisory-notes.md). All five phases are complete; the owner's integration/push/cleanup instruction governs the remaining git operations. Live inference still requires separate authorization.
