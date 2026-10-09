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

### Phase 3

- **One classifier, three copies of its bytes.** Plan said: the TypeScript module imports the
  template and `classifierDigest = sha256(template bytes)`. Chose:
  - `push-classifier.template.mjs` is the only implementation; `push-classifier.template.d.mts`
    types it, and the core build copies both into `dist`.
  - `push-classifier-source.ts` holds the exact template text for the digest and the Phase 4
    embed. It is generated by `scripts/optimization/generate-classifier-source.mjs`, and
    `classifier-template-source-in-sync` fails if the two differ.
  - Why: the CLI bundle cannot read files beside it at run time, and tsc does not copy `.mjs`.
- **Entry guard.** The template runs `main()` only as the stdin or eval entry module, whose
  URL is Node's `[evalN]` pseudo-file. An `argv`-based guard was rejected: under `node -e`
  it also fires, so any `-e` script importing core in a job would have classified. Tested
  both ways (stdin entry writes outputs; an import from an eval entry writes nothing).
- **The Action imports `@cirujano/core/billing`.** Found: the CommonJS Action bundle parsed
  the template (esbuild warned about `import.meta`) and carried unused optimizer code.
  Chose: a `./billing` subpath export; `packages/action/src/main.ts` imports only that. The
  Action's behavior is unchanged and `dist/index.cjs` shrank from 917,903 to 733,394 bytes.
- **Environment the step reads.** Plan listed `GITHUB_API_URL`, `GITHUB_REPOSITORY`,
  `GITHUB_SHA`, `GITHUB_WORKFLOW_REF` and `GH_TOKEN`. Chose also `GITHUB_REPOSITORY_ID`,
  `GITHUB_EVENT_NAME`, `GITHUB_REF` and the push event's `forced` flag from
  `GITHUB_EVENT_PATH`. Why: one template serves every repository, so the branch comes from
  `GITHUB_REF`. Phase 4's classifier-job `if` must pin `refs/heads/<branch>`, and Phase 5
  needs a "push to another branch" cell.
- **Rule 2 reading.** "Exactly one PR" means exactly one listed PR that is merged, has
  `merge_commit_sha == sha` and `base.ref == branch`. Other PRs listed for the commit, such
  as an open release PR, are ignored by rule 2. A full page (100) is treated as paginated.
- **Added after independent review (each fails open with its own reason):**
  - `other-pr-at-head`: any other PR associated with the tested head commit refuses. Without
    it, a run from a second PR at the same head (say H→main) could stand in for the merged
    PR's missing run. The read is `commits/{head}/pulls`, not the reviewer's
    `pulls?head=owner:ref`, because it also catches PRs from other branches at the same
    commit. When the run lists its `pull_requests`, every entry must be the merged PR with
    the same base (`pr-run-identity`); an empty list is accepted, because GitHub may leave
    it empty. Residual: a PR GitHub does not associate with the commit, and whose run does
    not name it, is not seen.
  - `forced-push` and `push-event-unreadable`: only an explicit `forced: false` is
    accepted. A forced push can replace the tested tree, even on a fast-forward. Collection
    cannot see the flag (the runs API omits it), so history models every push as not forced.
    A force-push between the PR run and the merge remains undetectable in general. Make
    "force-push disabled on the integration branch" a Phase 7 precondition.
  - At most one job named `cirujano_validated_push`, and it must be `skipped`. Before this,
    a user job named that way was ignored.
- **More than one `pull_request` run** of the same workflow at the tested head refuses
  (`pr-run-ambiguous`), rather than picking the latest.
- **Verification profile.** It is required and hashed at collection, but only checked to
  be strict JSON. Phase 5 defines the `push-guard` profile schema.
- **No history.** An eligible workflow with no completed push runs becomes `unsupported`
  with reason `no-push-history`.
- **Collection reads.** A classifier read that fails during collection is recorded as an
  unvalidated push with reason `api-error`; `gh` hides the HTTP status. Billed minutes come
  from each run's latest attempt only, so re-run pushes are undercounted in the facts the
  model sees (disclosed; the measurement gate in Phase 6 reads its own runs).
- **Retained push operations** keep `source.json` (only top-level workflow files and the
  profile), `input.json` and a `collection-receipt.json` with `family`. Diagnose and status
  re-derive the input with the same `createPushInput` policy and refuse a classifier digest
  that differs from the running tool's.
- **Shared code.** `diagnosis-journal.ts` holds the intent and diagnose-state checks, moved
  unchanged from `propose.ts`, so the push status path reuses them. `diagnose.ts` keeps one
  transport and one decision parser with a policy per family. The cache request is pinned
  byte for byte (`cache-request-bytes-unchanged`, hash taken from the `b2801e6` code).
- **Evaluator.** The 6 push cases are reported under `families['skip-validated-push']`;
  `cases` and the cache denominators (6/8/7) are unchanged and `totalCases` is 27. The
  injection case also replays its non-injected twin as a control.
- **Deferred to Phase 7.** A live runner for the 6 push cases (6 permits, as step 4 needs)
  is not built here; Phase 7 must include building it before step 4.
- **Phase 7 preflight (INFERRED shapes, fail open if wrong).** Confirm with one read-only
  look that `commits/{sha}/pulls` lists the merged PR for a commit on the proof repository's
  integration branch (use the default branch), and that `run.path` has no suffix. If either
  is wrong, collection shows `validatedShare` 0.
- **`compare` size.** Comparison responses include file patches; a very large PR can exceed
  the 8 MB bound and fail open as `api-error`.

### Phase 4

- **Inverse proof direction.** Plan said: drop the classifier, unwrap the guards and compare
  with the base. Chose: `validateGuardOnlyChange` rebuilds the guarded tree from the base
  (classifier job, guard and appended need per job) and requires the candidate to parse to
  exactly it, and its bytes to equal the deterministic edit. Equivalent and stricter; the
  unwrap direction is also asserted in `push-patch-inverse`.
- **Scalar forms.** Each guard is written as a JSON double-quoted `${{ … }}` scalar (JSON is
  valid YAML 1.2), so any original condition text stays safe. `needs` is written as a flow
  list. A replaced block `needs` list loses its inline comments (it is a touched node); all
  untouched bytes are kept.
- **Placement.** The classifier is the first job, above comment lines that introduce the
  first job, nested two spaces below the jobs' own indentation. It has no `name:`, so the
  API job name is its id, and its `if` pins `refs/heads/<branch>` (Phase 3 entry
  conditions). Jobs without `needs` now wait for the classifier: its runtime is capped at
  2 minutes, but runner queue time is not, so latency can be longer. Guarded jobs bill
  nothing extra.
- **Added after independent review:**
  - Eligibility (shared with the Phase 5 matrix): a `${{ }}` condition with any character
    outside the braces, which GitHub evaluates as always true, is refused as
    `unparseable-condition` (before, the guard would have turned it into the real
    condition). Duplicate `needs` are refused. Workflow-level `defaults.run`
    (`workflow-run-defaults`) and workflow `env` that changes how bash or node start
    (`NODE_*`, `NPM_CONFIG_*`, `BASH_ENV`, `ENV`, `*_PROXY`; `workflow-runtime-env`) are
    refused, because the classifier job inherits them.
  - Patch: replaced values are written from the key's end, so a block list indented at the
    key's own column still yields valid YAML. The comment walk-back above the first job
    stops at a comment deeper than the job indentation. `validateGuardOnlyChange` checks
    the operation's branch against the workflow's literal push branch.
  - The actionlint gate fails when shellcheck is missing and passes `-shellcheck=` explicitly.
  - From the simplify pass: "eligible" now also means "renderable". Collection, the
    retained-input check and the evaluator use `inspectRenderablePushWorkflow`, which dry-runs
    the patch and refuses a workflow it cannot render (a flow-style job map, mixed newlines,
    tabs) as `unrenderable-workflow`, before any history read or inference. This changes a
    Phase 3 path; inputs collected before it re-derive the same way for every renderable
    workflow.
  - Re-review nit: explicit-key YAML (`? if` / `: …`) is refused in eligibility
    (`unsupported-workflow-shape`, read from the YAML tokens, not line text), because the
    key-end rewrite cannot express it; before, it failed only after inference.
  - `proposalFor`'s classifier-digest check cannot fail through the CLI, because
    `readRetainedPushContext` already refuses a digest that differs from the running tool's;
    it stays as an invariant assertion.
- **Patch shape.** The diff reuses `patch.ts`'s single-hunk helper, as the plan asked; with
  edits in several jobs, the hunk shows the region between the first and last edit as
  removed and re-added. It applies with `git apply` (tested); a multi-hunk diff for the
  Phase 6 report is optional.
- **File names.** Retained proposal files are `candidate.yml` and `workflow.patch`, as in the
  cache family (the phase text says `candidate.patch`).
- **Profile.** The push proposal carries no verification profile (the Phase 2 contract has
  none); Phase 5 defines the `push-guard` profile and binds it at verify time.
- **Extra tests.** A shapes fixture (`push/patch/shapes.yml`) covers `needs` absent, string,
  flow and block, and `if` absent, plain, quoted and folded. Goldens store the embedded
  script as one token line. One test runs the generated step under `bash -eo pipefail`.
  actionlint 1.7.12 (with shellcheck) checks the 3 guarded fixtures.

### Phase 5

- **A separate push-guard image.** Plan said: one image whose manifest lists both harnesses.
  Chose: its own minimal image (`generatePushGuardImageContext`, `image-context.mjs
  --push-guard`): the base node image plus the bundled harness at the same
  `/opt/cirujano/harness.mjs` path, with an `image.json` of kind `push-guard-image`. Why:
  the verifier needs no repository source, dependencies or store, so none enter the image;
  the cache image and its harness bytes stay unchanged; and the Sandbox client (request
  command, image readback paths) is reused unchanged.
- **The harness is a committed bundle.** `scripts/optimization/push-guard-harness.mjs` is
  built by `packages/cli/scripts/bundle.mjs` from `push-guard-harness-entry.ts` (yaml and
  the core verifier inlined, 328 KB, under the 512 KiB image readback cap, byte-identical
  across builds, repo-relative paths only). `verify-bundle` now checks it like the Action
  bundle, and the CLI binds its hash at build time (`CIRUJANO_PUSH_HARNESS_HASH`).
- **The Phase 3 table as data.** The classifier cases moved from the test into
  `push-classifier-cases.ts` (`failOpenCases`, `classifierCases()`): the unit tests and the
  Sandbox fixtures are one table (60 cases), and a test checks every data case gives the
  same verdict through the workflow step.
- **Matrix model.** A condition without a status function gets GitHub's implicit
  `success()` (so dropping `!cancelled()` shows as guarded jobs skipped on pull requests).
  The base condition is opaque and substituted only where it is exactly the guard's last
  `&&` operand; otherwise the guard is evaluated as written. Needs combine fully up to five
  needs; beyond that, all-success plus each need failing alone. The classifier job's `if` is
  checked per event and ref, including a push to another branch.
- **Verify journal.** A single-operation `push-guard-run` journal (`push-verify.ts`) reuses
  the Sandbox client, permit decoding and ledger, polling, cancel and readback unchanged;
  the cache pair journal in `verify.ts` is untouched. `decodeSandboxPermit` now takes the
  fields both profiles share (type-only change).
- **Profile binding.** The push-guard profile binds the proposal digest, the trusted harness
  hash and a local candidate commit that descends from the base, changes only the workflow
  file, and holds exactly `candidate.yml`.
- **Disclosure.** The sandbox artifact's `mismatches` counts matrix and classifier-case
  mismatches together; `firstMismatch` is the first of either; the operation's reason code
  names the verifier's failure (`push-guard-matrix-mismatch`, `push-guard-inverse-mismatch`,
  ...). An unreadable image gives `push-guard-image-unavailable` with the context command.
- **Local Linux proof.** `check-harness-linux.mjs` also runs the bundled push harness in the
  cached `node:22-bookworm` image with no network on an owned guarded fixture, and requires a
  tampered candidate to fail. The image had been pruned locally; it was re-pulled (public,
  read-only) before the gate.
- **Other differences from the phase text.** `ExecutionProfile` did not gain a `push-guard`
  kind; a separate `PushGuardProfile` exists. Family dispatch for `verify`, `status` and
  `cancel` sits in `service.ts`; `verify.ts` stays the cache pair verifier. Phase 7 step 1
  therefore builds the push-guard image context (`image-context.mjs --push-guard`), not one
  context with both harnesses. `verify-bundle` fails on the new harness until it is committed.
- **Added after independent review:**
  - The matrix also models a classifier that wrote `validated=true` and then failed or was
    cancelled (it must run the full suite), and a fifth mutation (dropping the classifier
    result check) is detected. The Phase 2 `guard-classifier-failure-runs-full` test covers
    the same two states.
  - Eligibility refuses `needs` read other than as `needs.<declared need>` anywhere in a job's
    expressions (`needs-context-reference`): the patch adds the classifier to `needs`, so
    `toJSON(needs)`, an index or the classifier itself would change meaning.
  - The harness runs a case only when the extracted script's digest matches the payload; under
    root each case runs as uid/gid 65534; a hung case is killed with SIGKILL; the output read is
    capped at 4 KiB.
  - Results carry `classifierMismatchCount`; the artifact counts every mismatch. A `passed`
    result must carry the payload's script digest, and the artifact records the result's digest.
  - Recovery decodes the receipt with the cache path's `decodeReceipt` (exported, type
    widened), checks the intent and record as the cache pair journal does, and binds
    `image-readback.json` to the profile.
  - The matrix also checks the candidate's `needs` are the original needs plus the classifier.
  - Only a missing image (404) or mismatched image bytes give `push-guard-image-unavailable`;
    other read-back failures report the client's reason code.
  - Re-review nits: a non-`if` string containing `${{` is scanned whole for `needs` (a `'}}'`
    inside a literal would end a lazy match); `classifierCases` counts the cases actually run
    (0 when the digest gate refuses the script). Kept as is: `status` on a run whose image could
    not be read back reports `sandbox-recovery-rejected` (no readback file), as the cache
    family does.
  - New tests: a six-need job, the classifier-mismatch count, an existing intent,
    reconcile after a lost result, cancel on a verified run, drifted journal, readback and
    artifact, and an unconfirmed create (`outcome-unknown`, inspection required).

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

## Phase 3 handoff (2026-10-09)

- **Objective and scope:** the classifier rule, push-history collection and Nemotron diagnosis
  for the family, as in [phase-3](2026-10-08-skip-validated-push-phases/phase-3.md). No
  workflow patch, Sandbox, measurement, remote write or model call.
- **Identity:** base `develop` `b2801e6` (pushed; CI and CodeQL green); branch
  `feat/skip-validated-push-p3` in `../cirujano-worktrees/svp-p3`.
- **Delivered:**
  - Core `src/optimization/`:
    - `push-classifier.template.mjs`: rules 1-5, side-effect free, and the step's `main`.
      Its `.d.mts` gives the types.
    - `push-classifier-source.ts`: the generated step script, which is the template plus
      `await main();`. `CLASSIFIER_DIGEST` is its sha256.
    - `push-classifier.ts`: `classifyPush`, `runClassifierStep`.
    - `push-input.ts`: `summarizePushHistory`, `createPushInput`.
    - `push-contracts.ts`: `PushSourceManifest` and its decoder, plus `isLiteralBranch`,
      `isTopLevelWorkflowPath`, `isLiteralWorkflowPath`, `pushSourceText`.
    - `measurement.ts` exports `median`.
    - Core gets a `./billing` subpath export, and the Action imports it.
  - CLI `src/optimization/`:
    - `optimize collect --family skip-validated-push --branch`, implemented in
      `collectPushInput` and `readPushHistory`.
    - Family policies in `diagnose.ts`, using prompt `skip-validated-push-v1` and schema
      `skip-validated-push-decision-v1`.
    - `push-context.ts`: the retained push context and the diagnosis context.
    - `diagnosis-journal.ts`: one bound diagnosis reader for both families.
    - Family dispatch in `store.ts` and `service.ts`.
    - A shared `retainTreeFiles` in `github-read.ts`.
  - Evaluator: 6 push cases (`packages/core/fixtures/optimization/push/evaluation.json`),
    27 cases in total.
- **TDD:**
  - Every new suite failed first because its module or export was missing. Each review
    finding got a failing test before its fix.
  - The cache request was pinned from the unmodified `b2801e6` code before `diagnose.ts`
    changed: `requestHash 3e91a66f…37ed4`, 2131 bytes.
  - Mutation check on the template (scratch script, not committed): removing any of 61
    clauses fails at least one behavior test.
- **Gate:** first full run, on the final tree (load average 17 at start, peaking near 130):
  `build`, `typecheck`, `lint`, `test` (core 481, runner 393, action 6, CLI 706),
  `evaluate.mjs --offline` (27 cases, passed) and `git diff --check` all exited 0.
  `test:coverage` exited 1: two CLI tests timed out (`publish-lifecycle` "emits exactly one
  POST…" at 30 s, and `harness` "reports command timeout…" hitting the total timeout
  first). Phase 3 does not touch either area; both passed in the plain `test` lane of the
  same run. Cause INFERRED: coverage instrumentation under machine load. After commit
  `1b54e5a` (the same tree), `verify-bundle` passed and a `test:coverage` rerun at load
  average 34 exited 0 (all 706 CLI tests; core 481, runner 393, action 6).
- **Review:** an independent reviewer first requested changes (no blocker):
  - should-fix: F1, the PR run was not tied to the merged PR; F2, forced pushes; F4, a test
    passing for the wrong reason, plus unpinned reason codes; F5, deviations not recorded.
  - nits: F3, the classifier-named job; F6, a vacuous evaluator check; F7, response
    shapes; F8, latest attempt only; F9, no `outcome-unknown` test.

  All were fixed or recorded (see the Phase 3 deviations). The re-review was APPROVED with
  one nit, the run's `pull_requests` binding, which is now fixed and tested.
- **Simplify (4 angles):**
  - Adopted:
    - The template has no side effects; the entry call is appended in the generated script,
      so the `[evalN]` URL guard and `import.meta` are gone.
    - Shared bound diagnosis reader for both families.
    - Shared `retainTreeFiles` (push collection now also has the 16 MiB running cap).
    - The redundant push collection-receipt decoder is gone; exact equality is the check.
    - `record`/`exactKeys` exported once; `pushSourceText` and `isLiteralWorkflowPath` in
      core; `median` reused; classifier types aliased from the `.d.mts`.
    - An `unvalidated()` helper in the template.
    - One receipt branch in the service collect; an evaluator `modelGroup` helper; cast-free
      test rows; a stale test name fixed.
  - Skipped:
    - Generic typing of `nebius.ts`: the plan pins the transport unchanged.
    - A CLI family registry for `service.ts`: do it with the Phase 4 propose branch.
    - Concurrent GitHub reads in collection: rate budget, deterministic refusal order and
      the machine constraint.
    - `assertRun` identity dedupe and the `validateTree` O(k²) insert: cache code outside
      this diff.
    - Argv-based family detection: a flag value can never start with `-`, so `--family`
      cannot be a value.
    - Cross-package test-helper consolidation.
    - Collection uses `gh api` while the step uses `fetch`: the Phase 6 measurement should
      compare the step's real `reason` with the history verdict for the same pushes.
- **Risks carried forward:** the residuals in the Phase 3 deviations: unassociated PRs; a
  force-push between the PR run and the merge; assumed response shapes (Phase 7 preflight);
  the latest-attempt undercount. Plus the Phase 2 third-party event-file risk.
  `CLASSIFIER_DIGEST` is fixed only once Phase 4 embeds it; any template change invalidates
  every retained push input (by design).
- **Next phase entry:** Phase 4 needs an explicit owner go; revalidate `develop` HEAD. Phase 4
  must give the classifier job no `name:` (the rule matches the job id) and pin
  `refs/heads/<branch>` in its `if`.

## Phase 4 handoff (2026-10-09)

- **Objective and scope:** deterministic guard patch, classifier job generation, actionlint,
  and `propose` for the family, as in [phase-4](2026-10-08-skip-validated-push-phases/phase-4.md).
  No Sandbox, measurement, remote write or model call.
- **Identity:** base `develop` `5338a71` (pushed; CI, CodeQL and Dependabot green, Sutura
  skipped); branch `feat/skip-validated-push-p4` in `../cirujano-worktrees/svp-p4`, commit
  `b860cbf`.
- **Delivered:**
  - Core:
    - `push-patch.ts`: `createSkipValidatedPushPatch`, `validateGuardOnlyChange`,
      `extractClassifierScript`, `classifierJob`, `inspectRenderablePushWorkflow`.
    - `patch.ts` exports `unifiedPatch`.
    - `guard-expression.ts` adds `conditionText` (exact `${{ }}` wrapper).
    - `push-workflow.ts` gains new refusals and exports `list` and `triggerBranch`.
  - CLI:
    - `push-propose.ts`, with family dispatch in `propose.ts` (`retainedFamily`).
    - `push-context.ts` adds `pushWorkflowEvidence`.
    - `stage-output.ts` holds the shared `shellQuote` and `emitStage`.
    - Collection and retained re-derivation use renderable eligibility.
  - Fixtures:
    - `push/patch/shapes.yml`, with goldens for 3 fixtures;
    - `workflow-run-defaults.yml` and `workflow-runtime-env.yml`, added to the push manifest.
  - Gate: `check-actionlint.mjs` lints 3 guarded workflows and requires shellcheck.
- **TDD:**
  - The patch, propose and new eligibility tests each failed first because the module or
    rule was missing.
  - Goldens were generated from the implementation and reviewed line by line before being
    pinned. The one later golden change, `needs` moved onto the key line, was reviewed as a
    diff.
- **Gate (final tree, first run, load average about 22):** `build`, `typecheck`, `lint`,
  `test`, `test:coverage`, `verify:optimization-actionlint` (11 cache plus 3 push
  workflows), `evaluate.mjs --offline` (27 cases) and `git diff --check` all exited 0.
  Test counts: core 518, runner 393, action 6, CLI 715. After the commit, `verify-bundle`
  passed (the Action bundle is unchanged).
- **Review:**
  - First pass, CHANGES REQUESTED:
    - B1 blocker: a `${{ }}` condition with surrounding characters (GitHub always-true) was
      turned into the real condition.
    - Should-fix: S1, a key-indented block `needs` gave invalid YAML; S2, inherited workflow
      `defaults.run`/`env`; S3, shellcheck not enforced.
    - Nits: N1 duplicate needs; N2 branch binding; N3 deep comment; N4 latency wording;
      N5 test independence and an unreachable digest check.
  - All were fixed or recorded, and the re-review was APPROVED.
  - Its one nit, explicit-key YAML, is now refused in eligibility using YAML tokens.
- **Simplify (3 reviewers: reuse, simplification, efficiency plus altitude):**
  - Adopted:
    - Renderable eligibility (the altitude finding: unrenderable workflows used to pass
      eligibility and fail after inference).
    - The create path renders once and proves the tree once.
    - The redundant re-validation in `readPushProposalContext` is dropped.
    - `list` and `triggerBranch` are reused.
    - `pushWorkflowEvidence` is shared.
    - One family probe.
    - Shared `shellQuote`/`emitStage`; the disposition logic is simplified.
    - The actionlint `lint` helper.
  - Skipped:
    - One copier for both families, and shared newline/indent helpers: both touch
      cache-family code and bytes.
    - A single strict parse returning document and tree: millisecond-scale under the 256 KiB
      cap.
    - Passing validated contexts through `readBoundDiagnosis`: a shared signature change.
    - A family table in `service.ts`: do it in Phase 5 with the verify branch.
    - Pinning the shellcheck version: the gate is local only.
    - Test-helper consolidation in `push-patch.test.ts`: test-only churn.
- **Risks carried forward:** the Phase 3 residuals; touched block `needs` lose inline
  comments; one large diff hunk for multi-edit workflows; GitHub runtime semantics of the
  guard are modeled, not observed (the Phase 7 control push).
- **Next phase entry:** Phase 5 needs an explicit owner go; revalidate `develop` HEAD. Phase 5
  must define the `push-guard` profile, bind it at verify time, and dispatch `verify` (and
  the later `measure`/`report`) by family; `extractClassifierScript` and
  `validateGuardOnlyChange` are its inputs.
