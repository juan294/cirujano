# Skip-validated-push: implementation notes

Plan: [2026-10-08-skip-validated-push.md](2026-10-08-skip-validated-push.md).

## Deviations

### Phase 1

- **README scope.** Plan said: fix `README.md:34-41`. Found: line 33 ("Fleet enrollment
  and the 45-day savings evidence come next") was stale as well; the private
  registry shows cut-over enrollments and a measurement window through 2026-10-28.
  Chose: rewrite the whole paragraph, with no numbers beyond the window date. Why:
  leaving a stale claim in the paragraph being corrected would defeat H5.
- **Case study scope.** Plan said: lines 26, 41 and 140. Found: "The key economic
  insight" (line 69-70) also credited concurrent-job consolidation, and the evidence
  status called automated patch proposal future work. Chose: correct both. Why: the
  same single-slot and live-chain facts make them false.
- **Runbook.** Plan did not list `docs/runbooks/fleet-telemetry.md`. Chose: document
  `CIRUJANO_FLEET_REGISTRY`, `fleet-latest.md` and the drift rule there. Why: it is the
  operator reference for the wrapper this phase changes.
- **Wrapper order and explicit registry.** Plan said: pass `--registry` when
  `CIRUJANO_FLEET_REGISTRY` is set or the default registry exists. Chose: write
  `latest.md` first, then `fleet-latest.md`; a set but missing `CIRUJANO_FLEET_REGISTRY`
  fails the run instead of skipping. Why: the cumulative report never depends on the
  registry, and an explicit setting that cannot be honored must be visible.
- **Field-wise comparison.** The old merge compared whole-object JSON, so a key-order
  difference alone counted as drift. The new merge compares field values. Snapshots
  are normalized on read with canonical key order, so no stored data changes outcome.
- **Visibility must differ.** Plan said: keep the earlier record when the differing
  fields are a subset of {visibility, actualGithubListCostUsd,
  counterfactualHostedCostUsd}. Chose: also require `visibility` among them, so a
  cost-only drift throws. Why: two independent simplify reviewers flagged it; the rule
  then does only what it describes, and snapshot validation makes a legitimate
  cost-only drift impossible (`telemetry-store.ts:177-193` rebuilds costs from source).

### Phase 2

- **Fixture location.** Plan said: `packages/core/src/optimization/fixtures/push/`. Chose:
  `packages/core/fixtures/optimization/push/`, beside the existing cache corpus. Why: one
  corpus location; a routine path correction.
- **Eligibility evidence.** Plan said: `inspectPushWorkflow(source, evidence)` checks
  `sha256(source)` against `provenance.workflowHash`. Chose: evidence is `{workflowHash,
  workflowPath, integrationBranch, inventory}`. Why: `guardedJobIds` and `classifierDigest`
  in the push provenance are outputs of eligibility and the patch, so the collector (P3)
  builds the provenance after this check.
- **Stricter refusals than plan § Eligible.** Chose, each with a fixture or test:
  - Absent token permissions are refused (`permissions-not-read-only`): the default token
    can be write.
  - A job with `continue-on-error` is refused: its effect on `needs.<id>.result` is not
    modeled.
  - The scan for event references also covers workflow-level `env` and `defaults`, which
    flow into every job. Workflow-level `concurrency` stays allowed.
  - The scan also refuses the whole `github` context inside an expression, such as
    `toJSON(github)`.
  - `workflow_run` consumer names are matched case-insensitively.
  - Added after independent review:
    - `on.workflow_call` is refused (`workflow-call`). When called, `github.*` describes the
      caller, and the caller's `with:` inputs are never scanned.
    - Local `uses: ./` actions are refused (`local-action`), because their sources are not
      scanned.
    - `pull_request.types` beyond the defaults `opened`, `reopened` and `synchronize` are
      refused (`pull-request-types`).
    - Job ids outside GitHub's grammar are refused.
    - The event scan also matches `GITHUB_HEAD_REF`, `GITHUB_BASE_REF`,
      `GITHUB_WORKFLOW_REF`, `github.workflow_ref` and `github.*`, and it reads every bare
      job or step `if:` as an expression.
- **Remaining eligibility risk.** A third-party action can read `GITHUB_EVENT_PATH` or
  `GITHUB_EVENT_NAME` from its own code and behave differently on a push. The workflow text
  never shows this, so the scan cannot see it. Path filters such as `dorny/paths-filter` are
  the known case. The Phase 7 control push and the PR-run identity check remain the
  backstop. Add an action allowlist before any wider release.
- **Refused inputs and guarded ids.** The push provenance may carry an empty
  `guardedJobIds` only on an `unsupported` or `no-change` input, so a refusal such as
  `no-guarded-jobs` can still be recorded truthfully. Every other push artifact requires at
  least one guarded job.
- **Measurement invariants in the decoder.** The decoder enforces the whole per-push gate's
  shape:
  - cohort counts;
  - candidate pushes validated and every guarded job skipped;
  - the control push not validated, with every guarded job a success;
  - `baselineMedianMinutes` equals the median of the baseline pushes;
  - every candidate push bills at least 1 minute less than that median;
  - the overhead equals the control push's classifier minutes;
  - PR job sets and conclusions are equal across baseline and candidate, and every PR job
    is a success.

  `prJobs` never lists the classifier. On a pull_request run the classifier's `if` is false,
  so the run reports it as a skipped job; Phase 6 must strip it before comparing. That the
  jobs API lists skipped jobs is INFERRED and must be confirmed in Phase 6.
  Phase 6's `compareSkipMeasurement` computes the same values from GitHub reads, so the
  decoder is a second, independent check.
  Why: each is fail-closed; an unsupported answer costs one ineligible workflow, a wrong
  eligible answer could skip a test that must run.
- **Family contracts ahead of their phases.** The plan lists family variants of every
  artifact in P2, while P4-P6 define their details. Chose: shapes taken from the P4-P6 text.
  The push proposal has no `verificationProfile` object yet, because P4 declares the
  push-guard profile schema. The sandbox carries `firstMismatch`, from the plan's stuck-state
  table. The measurement records per-push samples, a `modeled` projection block and
  decoder-level gate invariants. Later phases may refine these shapes: no push artifact has
  been written anywhere yet.
- **Shared stages.** Plan said: `inference` and `publication` are shared unchanged. Chose:
  their push variants reuse the cache field sets and checks, but carry `family` and the
  push provenance. Why: provenance is family-specific, and a family-less artifact must keep
  decoding as cache.
- **Golden oracle, both directions.** Plan said: decode every existing artifact
  byte-identically. Found (review): `decodeArtifact` returns its input, so that check alone
  catches only a decoder that has become stricter. Chose: also pin the `7bfc9fd` decoder's
  accept or reject verdict, with its message, for 1,942 field-level mutations of the same
  33 artifacts (`golden-decode-rejections.json`, captured from a `git archive 7bfc9fd`
  extraction).
- **Golden oracle helper.** The eight cache artifacts in `contracts.test.ts` moved, unchanged,
  into `contracts.test-helper.ts`, so the oracle decodes the same values the decoder tests use.

## Phase 1 handoff (2026-10-08)

- **Objective and scope:** H2 telemetry report repair and H5 truth fixes, as in
  [phase-1](2026-10-08-skip-validated-push-phases/phase-1.md). No optimizer code changed.
- **Identity:** base `develop` `dcf6d0b`; branch `feat/skip-validated-push-p1` in
  `../cirujano-worktrees/svp-p1`; plan docs commit `ee40738`, then the Phase 1 commit.
- **Delivered:** `aggregateTelemetry` merges snapshots in `collectedAt` order and keeps
  the earliest observation when only `visibility` and the two cost fields differ;
  other drift throws with the key and the sorted differing fields. The wrapper also
  writes `fleet-latest.md` when a registry exists or `CIRUJANO_FLEET_REGISTRY` is set.
  README, case study, demo and runbook corrected.
- **TDD:** the four named tests (IDs in the test titles) and a no-registry case failed
  6/7 before the fix (the no-registry case already passed) and pass after.
- **Gate (final candidate, before the commit):** typecheck, lint, test, test:coverage,
  build, `node scripts/verify-bundle.mjs`, `git diff --check`: all exit 0; 1,329 tests
  (278 + 393 + 6 + 652). `packages/action/dist/index.cjs` unchanged (no core change).
- **Real-store acceptance (read-only):** the built CLI (`dist/bin.js` sha256
  `6a14f6ca…7fcbff`) ran `telemetry report` with and without `--registry` against
  `~/.local/share/cirujano/telemetry`: both exit 0, window through
  2026-10-08T04:21:04.989Z, the latest snapshot. 159 visibility-drift duplicates in
  one repository are now resolved. Store files were not written.
- **Review:** an independent reviewer APPROVED. Findings: 1 (combined
  createdAt+visibility drift still throws) no change, the real-store run exits 0;
  2 adopted via simplify (visibility must differ); 3 accepted, unit test plus
  `cli.ts:73` cover the message; 4 documented in the runbook; 5 test IDs added;
  6 fixture clears `CIRUJANO_TELEMETRY_SINCE`/`_LOOKBACK_HOURS`; 7 reworded to
  "Most enrolled private repositories".
- **Simplify:** adopted the identical-duplicate fast path, `visibility` required, and
  `keyof TelemetryJob` typing. Skipped: a shell `write_report` helper (two uses; an
  existing test pins the `mv` line), redundant-looking `latestSnapshot` scan (keeps
  first-of-tie semantics), computing `throughMs` once, merging the two flip tests
  (separate plan IDs), and collapsing the wrapper `it.each` cases.
- **Pending (owner, manual):** reinstall the telemetry bundle and wrapper (commands in
  the phase report). The next 06:10 run then updates `latest.md` and `fleet-latest.md`.
- **Next phase entry:** Phase 2 needs an explicit owner go; revalidate `develop` HEAD.

## Phase 2 handoff (2026-10-08)

- **Objective and scope:** family contracts, eligibility, the guard-expression evaluator
  and the corpus, as in [phase-2](2026-10-08-skip-validated-push-phases/phase-2.md). No CLI,
  optimizer runtime, workflow or remote change.
- **Identity:** base `develop` `7bfc9fd`; branch `feat/skip-validated-push-p2` in
  `../cirujano-worktrees/svp-p2`.
- **Delivered (all in `packages/core`):**
  - `src/optimization/contracts.ts`: the field validators and the shared inference, report,
    publication and sandbox-operation rules are now named exports. Cache behavior is
    unchanged.
  - `src/optimization/push-contracts.ts`: `OptimizationFamily`, the push provenance,
    operation and history entry, and the eight family artifact variants. Also
    `decodePushArtifact`, `decodeFamilyArtifact`, `artifactFamily`,
    `assertSamePushProvenance` and `validatePushDiagnosisEvidence`.
  - `src/optimization/guard-expression.ts`: the expression parser, the evaluator and status
    function detection.
  - `src/optimization/push-guard.ts`: `CLASSIFIER_JOB_ID`, the job-id grammar,
    `isGuardedJobSet` and `guardExpression`.
  - `src/optimization/push-workflow.ts`: `inspectPushWorkflow`.
  - `fixtures/optimization/push/`: 27 eligibility cases with their manifest.
  - `fixtures/optimization/golden-decode.json` and `golden-decode-rejections.json`.
  - Narrow new exports in `src/index.ts`; existing exports are unchanged.
- **TDD:** the golden snapshot was captured with the `7bfc9fd` decoder before
  `contracts.ts` changed. The contract, guard and eligibility suites failed (module
  missing) before each module existed. Every review finding got a failing test first:
  11 red, then green. The one exception was the run-cancellation axis, whose wrapper was
  already correct. A mutation check on `guardExpression` showed that dropping
  `!cancelled()`, dropping the need-success clauses, inverting the classifier clause or
  dropping the original condition each fails `wrapper-equivalent-when-not-validated`.
- **Gate:** these runs are sequential, with every exit status kept.
  - **First run** (typecheck, lint, test, test:coverage, build, `verify-bundle`,
    `git diff --check`): test and test:coverage failed with 3 + 16 failures, and
    `verify-bundle` failed; the rest passed.
    - The failing CLI and scripts tests spawn or bundle `@cirujano/core` from its `dist`,
      which this new worktree did not have until build ran last. The errors are "Could not
      resolve @cirujano/core" and a child exiting 1 where 17 was expected. That this was the
      cause is INFERRED: the same tests pass on unchanged inputs once `dist` exists.
    - `verify-bundle` failed because the rebuilt `packages/action/dist/index.cjs` was not
      yet committed.
  - **Rerun, build first** (build, typecheck, lint, test, test:coverage,
    `git diff --check`): all exit 0. Tests: 1,436 (385 + 393 + 6 + 652).
  - **After the commit:** `verify-bundle` (recorded in the phase report). The rebuilt
    Action bundle is committed with the core change, as `CLAUDE.md` requires.
- **Review:** an independent reviewer requested changes:
  - 1 blocker: event references slipped past the scan.
  - 6 should-fix: `workflow_call`; local actions; the measurement gate's holes; empty
    guarded ids on refused inputs; the unanchored job id; the coupled cancellation axis.
  - 4 nits: oracle direction; evaluator limits; PR types and the inventory digest; the
    `pnpm-cache` doc comment.

  All 11 were fixed. The re-review APPROVED, with one should-fix (exclude the classifier
  from `prJobs`) and one nit (PR jobs must be green); both are fixed.
- **Simplify (4 angles):**
  - Adopted:
    - one bounded job-id rule and one guarded-set predicate, in `push-guard.ts`;
    - the classifier policy moved out of the parser module;
    - named exports instead of the `sharedContract` bundle;
    - `record` and `allStrings` reused from `workflow.ts`;
    - `triggerBranch` returns its reason instead of throwing it;
    - an `isMap` guard;
    - shared sandbox-operation and usage validators;
    - a PR-jobs key helper;
    - test helper reuse.
  - Skipped:
    - Sharing the provenance and evidence assertions with the cache path, and sharing
      `median`: low value, and they would touch cache code.
    - Running job checks before the inventory parse: it changes the precedence of reason
      codes.
    - The micro-efficiency findings: negligible at these input sizes.
    - Inlining `upper`: used six times.
    - Dropping the evaluator: Phase 5 needs it.
- **Risks carried forward:** third-party actions that read the event file (see the
  deviations). The shapes of the push artifacts may be refined in P4-P6, because no push
  artifact has been written yet. The claim that the jobs API lists skipped jobs is
  INFERRED; confirm it in Phase 6.
- **Next phase entry:** Phase 3 needs an explicit owner go; revalidate `develop` HEAD.
