# Skip-validated-push: a second verified optimization family

Date: 2026-10-08. Status: plan accepted for implementation planning only; no phase started.
Planning baseline: `develop` at `dcf6d0bfe4bcdc94e866b461e12e31d0d7cdb674`, `/Users/juan/code/cirujano`.
Source assessment: [hackathon readiness refresh](../research/2026-10-08-hackathon-readiness-refresh-assessment.md)
(Option B, approved by the owner 2026-10-08). Predecessor: [Nemotron workflow optimization](2026-09-29-nemotron-workflow-optimization.md),
whose design rules, gates and authority boundaries apply here unless this plan states otherwise.

## Objective and authority

The cache family completed a live chain on 2026-10-02 but measured **no-improvement**
(`docs/plans/2026-09-29-nemotron-workflow-optimization-notes.md`, "Outcome later on 2026-10-02"),
so H1's "measured improvement" criterion is still open. This plan adds one family whose saving is
counted in whole billable minutes:

> On a push to the integration branch whose exact tree was already tested green by the merged
> PR's CI, skip the duplicate run of the workflow's jobs. Any doubt runs the full suite.

Owner decisions (2026-10-08): Option B with the skip-validated-push family; live proof on the
**public proof repository** (labeled benchmark); measurement gate = **per-push gate** (below).
Separate small phases cover H2 (telemetry report) and the H5 truth fixes, as the request allowed.

This plan authorizes nothing external. Implementation needs an explicit go per phase. Paid and
outward actions in Phase 7 each need their own authorization: image build/import, model calls,
Sandbox runs, proof-repository workflow bootstrap, PR merges and pushes, and PR publication.
Release, Devpost and video (H6) are a separate later plan. Sutura stays independent.

## Source evidence and decisions

| Evidence | Consequence |
| --- | --- |
| `packages/core/src/optimization/contracts.ts:9,17,20,56,67` hard-code `enable-pnpm-cache`, `permittedDiff` and cache provenance (`stepIndex`, `lockfileHash`) | Add a `family` discriminator; artifacts without `family` keep today's validators unchanged |
| `packages/cli/src/optimization/diagnose.ts:8-16,30` fix the prompt, schema and the "exactly one cache operation" check | Per-family prompt, schema and prechecks; shared inference transport (`nebius.ts`) unchanged |
| `packages/core/src/optimization/workflow.ts:8-22` strict YAML parse (no aliases, tags, duplicate keys) | Reuse it for the new eligibility check and patch |
| `packages/core/src/optimization/patch.ts:20-66` AST-based insertion plus `validateCacheOnlyChange` inverse check | Same pattern: deterministic insertion plus an inverse "guard-only change" proof |
| `packages/cli/src/optimization/verify.ts:18-24` binds the trusted harness hash and image | A new harness mode means a new harness file and a new image (a Phase 7 authorization) |
| `packages/core/src/optimization/measurement.ts:60-118` encodes the cache gate (median 10%, total minutes) | A family-specific comparison; cache comparison untouched |
| Prior art: a fleet repository's reusable "validate merged PR" workflow (owner-authored, in production since 2026-08-18) checks `merge_commit_sha == GITHUB_SHA` plus green PR checks, and fails open | Adopt fail-open, and close its gap: it never proves the pushed tree equals the tested tree |
| Runner image readme `actions/runner-images` `images/ubuntu/Ubuntu2404-Readme.md`, image 20260927.320.1, retrieved 2026-10-08: Node.js 22.23.3, jq 1.7, GitHub CLI 2.101.0 preinstalled | The classifier is an inline Node script (no third-party action); it is testable offline in the Sandbox with a stubbed `fetch` |
| `packages/cli/src/telemetry.ts:368-384` rejects a duplicate job differing only in `createdAt` | H2 root cause (below) |

### Validation rule (single source of truth)

`classifyPush` in `packages/core/src/optimization/push-classifier.ts` is pure, with an injected
`get(path)`. The **exact inline script** in the candidate workflow is generated from the same
template file and pinned by digest. A push is `validated` only when all of these hold, and any
error, timeout, pagination ambiguity or unexpected shape yields `validated=false`:

1. The event is a push to `refs/heads/<integrationBranch>`.
2. `GET commits/{sha}/pulls` returns exactly one PR with `merged_at`, `base.ref == integrationBranch`,
   `merge_commit_sha == sha` and `head.repo.id == repository.id`.
3. `tree(sha) == tree(pr.head.sha)`.
4. `sha == pr.head.sha` (fast-forward), or `compare(firstParent(sha)...pr.head.sha).status` is
   `ahead` or `identical`. The base tip at merge time is then an ancestor of the tested head, so
   the merge ref GitHub tested has the same tree as the push. This closes the prior art's gap and
   the `base.sha` lag pitfall.
5. The latest attempt of a `pull_request` run of the **same workflow path** (from
   `GITHUB_WORKFLOW_REF`) at `head_sha == pr.head.sha` concluded `success`, and every job except the
   classifier concluded `success`. A skipped job counts as not validated.

The step writes `validated` and a fixed reason code to `$GITHUB_OUTPUT` and `$GITHUB_STEP_SUMMARY`,
and always exits 0.

### Patch shape

```
@ createSkipValidatedPushPatch(source, eligibility) -> {candidate, patch}
ctx: core YAML AST (workflow.ts parse), classifier template + digest
pre: eligibility.status == eligible; no job id `cirujano_validated_push`
do:
  1. emit classifier job (push-to-branch `if`, read-only perms, 2-min timeout, output `validated`)
  2. compute guard per job: !cancelled() && <each original need result == 'success'> && (classifier result != 'success' || validated != 'true') && (<original if>)
  3. write guard to job `if`; append classifier id to job `needs`
  4. validate inverse: drop classifier job + unwrap guards == base JSON (protected digest)
fail: inverse mismatch / actionlint error -> rejected, no patch
risk: GitHub status-function semantics modeled, not proven -> PR-run identity + control push in Phase 7
```

Eligible (v1, decided before any inference): `on.push.branches` and `on.pull_request.branches`
both contain one literal integration branch, with no globs or ignore lists. No `pull_request_target`.
The workflow is not consumed by any repository `workflow_run`. No job is reusable (`uses`), and no
job has an `environment` or write permissions. No references to `secrets.*` other than
`github.token`/`GITHUB_TOKEN`. No job `if` uses a status function. No string anywhere in the jobs
references `github.event_name`, `github.ref`, `github.event`, `github.head_ref`, `github.base_ref`,
`GITHUB_REF` or `GITHUB_EVENT`. At least one guarded job. Anything else returns `unsupported`
with a reason code and no inference.

### Measurement gate (owner-approved "per-push gate")

The cohort manifest is fixed before results are read. Three **baseline** merged-PR pushes (base
workflow), three **candidate** merged-PR pushes (candidate workflow) and one **control** direct push
(candidate workflow, not from a PR). `measured-improvement` requires all of the following:

- Every candidate push has classifier `validated=true` and every guarded job `skipped`.
- Each candidate push bills at least 1 rounded minute less than the median baseline push. Per-job
  rounding comes from `packages/core/src/billing.ts:40,56`.
- The control push runs every guarded job, with conclusions equal to its PR-less expectation
  (all `success`).
- For every cohort PR, the `pull_request` run's job set and conclusions equal the baseline PRs'
  (coverage unchanged).
- Any missing identity, failed sample or incomparable run gives `no-improvement` or `rejected`.

The report always discloses the classifier overhead (+1 rounded minute on each unvalidated push)
and the collected-history projection, labeled *modeled*. Public repositories report minutes, and
`githubListSavingUsd` stays 0.

## Phases

| Phase | Deliverable | Acceptance (short) |
| --- | --- | --- |
| [1](2026-10-08-skip-validated-push-phases/phase-1.md) | H2 report fix plus H5 truth fixes | Report regenerates from the real store; no stale claims |
| [2](2026-10-08-skip-validated-push-phases/phase-2.md) | Family contracts, eligibility, guard-expression evaluator, corpus | Cache artifacts decode byte-identically; eligibility fixtures pass |
| [3](2026-10-08-skip-validated-push-phases/phase-3.md) | `classifyPush`, collection of push/PR history, Nemotron diagnosis for the family | Rule tests; prompt/schema/evaluation corpus; no decision means no proposal |
| [4](2026-10-08-skip-validated-push-phases/phase-4.md) | Deterministic patch, classifier script generation, actionlint | Inverse proof; generated fixtures pass actionlint 1.7.12 |
| [5](2026-10-08-skip-validated-push-phases/phase-5.md) | Sandbox verifier mode (decision matrix plus exact classifier script) | Local Linux harness gate; mutation-killing matrix |
| [6](2026-10-08-skip-validated-push-phases/phase-6.md) | Push-cohort measurement, report, publication reuse | Gate fixtures; idempotent publish unchanged |
| [7](2026-10-08-skip-validated-push-phases/phase-7.md) | Authorized live proof on the public proof repo plus family docs | Real NVIDIA decision, Sandbox proof, measured improvement, PR readback |

Phases execute and are accepted sequentially, each with TDD, then implement, independent
review, repair, simplify and verify. The owner's machine constraint applies: at most **one** heavy
agent or test lane at a time (`sequential-workload`). Units marked `[batch-eligible]` may use
separate local worktrees with one integration owner, but never run heavy gates concurrently.
Nothing is pushed or opened as a PR as part of a phase.

Target dates (deadline 2026-10-30 17:00 UTC): P1 10-09/10, P2 10-10/11, P3 10-12/13, P4 10-13/14,
P5 10-15/16, P6 10-17/18, P7 10-19→21. The judge package (H6) follows in a separate plan from 10-22.

## Required local gates (every phase)

Run focused tests first, then sequentially with aggregated exit statuses: `pnpm run typecheck`,
`pnpm run lint`, `pnpm run test`, `pnpm run test:coverage`, `pnpm run build`,
`node scripts/verify-bundle.mjs`, `git diff --check`. From Phase 4 also run
`pnpm run verify:optimization-actionlint`; from Phase 5 also `pnpm run verify:optimization-harness-linux`.
Commit the rebuilt `packages/action/dist/index.cjs` with any `packages/core` change
(`CLAUDE.md`, Git Workflow). Check `uptime` before heavy gates. Gates that need an external permit
are never run as local checks.

## Consumer sweep

Commands run on 2026-10-08 at the baseline:
`rg -n "decodeArtifact\(" packages scripts --glob '!**/dist/**' --glob '!**/*.test.ts'` and
`rg -n "CacheOperation|enable-pnpm-cache|permittedDiff|cacheObservation|DIAGNOSIS_PROMPT_VERSION|inspectWorkflow\(|createPnpmCachePatch|compareMeasurement\(|compareQuality\(" packages scripts --glob '!**/dist/**' --glob '!**/*.test.ts'`.

| Consumer/writer | Disposition |
| --- | --- |
| `packages/core/src/optimization/contracts.ts` (validators, `decodeArtifact`, `validateDiagnosisEvidence`) | P2: family dispatch; no-`family` path unchanged; golden-decode oracle over all existing fixtures |
| `packages/core/src/index.ts` | P2-P4: narrow new exports; existing exports unchanged |
| `packages/core/src/optimization/workflow.ts`, `patch.ts` | P2/P4: untouched cache functions; new sibling modules reuse `parseWorkflowSource` |
| `packages/core/src/optimization/measurement.ts`, `report.ts` | P6: dispatch by family; cache paths unchanged (their tests run unmodified) |
| `packages/cli/src/optimization/diagnose.ts`, `nebius.ts` | P3: per-family request builder; `nebius.ts` transport and permits unchanged |
| `packages/cli/src/optimization/github-read.ts`, `input-context.ts`, `arguments.ts`, `service.ts` | P3: `collect --family skip-validated-push --branch` (cache flags unchanged when `--family` is absent) |
| `packages/cli/src/optimization/propose.ts` | P4: dispatch by diagnosis family |
| `packages/cli/src/optimization/verify.ts`, `execution-profile.ts`, `sandbox.ts`, `scripts/optimization/harness.mjs`, `image-context.mjs`, `check-harness-linux.mjs` | P5: new `push-guard` profile kind and harness file; existing harness bytes unchanged; image context gains the second harness |
| `packages/cli/src/optimization/measure.ts`, `publish.ts`, `store.ts` | P6: family cohort reader; publish and store unchanged except decode dispatch |
| `scripts/optimization/evaluate.mjs`, `check-actionlint.mjs` | P3/P4: add family cases; existing 21 cases unchanged |
| Test helpers `measure.test-helper.ts`, `nebius.test-helper.ts`, `verify.test-helper.ts`, `measurement.test-helper.ts` (8 test files reference cache types) | Each phase keeps the existing helpers; new family helpers are separate files |
| `packages/cli/src/telemetry.ts:368-384`, `telemetry.test.ts`, `scripts/collect-actions-telemetry.sh:56`, installed `~/.local/lib/cirujano/telemetry/` | P1 |
| `README.md`, `docs/cirujano-savings-case-study.md`, `docs/demo/nemotron-optimization.md` | P1 truth fixes; P7 family docs |
| Fleet runner, registry and telemetry formats | Excluded: no format change; optimizer state never enters telemetry or the registry |

## Stuck states and recovery

| State | Who sees what; how it ends | Recovery or disclosure test |
| --- | --- | --- |
| Workflow ineligible | CLI `unsupported` + reason code + "what would make it eligible"; no inference | `push-ineligible-reason-codes` (P2) |
| Collected history shows too few validated pushes | `collected` with facts; model may abstain; CLI says to collect more runs | `push-abstain-low-share` (P3) |
| Classifier cannot decide on GitHub (API error, ambiguity, timeout) | Push runs the **full suite**; step summary shows the reason code; nothing to clear | `classifier-fail-open-*` matrix (P3/P5) |
| Classifier job itself fails or times out | Guarded jobs run (guard checks `result != 'success'`); the workflow shows the failed classifier; the summary names it | `guard-classifier-failure-runs-full` (P2/P5) |
| Sandbox verifier mismatch | `sandbox` status `failed` with the first mismatching matrix cell; no measurement possible; re-propose after fixing | `push-guard-mismatch-disclosed` (P5) |
| Missing image or harness for the new mode | `verify` returns `image-unavailable` with the generated context path and the provisioning command | `push-guard-image-unavailable` (P5) |
| Cohort incomplete or incomparable | `measure` names the missing or extra identity; publication blocked | `push-cohort-incomparable` (P6) |
| Telemetry report conflict | P1 replaces the throw with a deterministic first-observation rule; any remaining conflict names the key and the differing fields | `visibility-flip-keeps-first-observation`, `conflict-names-fields` (P1) |

Existing cache-family stuck states keep their tests, which run unmodified.

## Final acceptance and durable handoff

Local completion (P1-P6) and live completion (P7) are separate statuses. H1 closes only when
P7 shows a real NVIDIA decision that determines the accepted operation, a provider-read-back
Sandbox verification, the per-push gate passing on GitHub, and one authorized unmerged PR read
back. A no-improvement or failed live result keeps H1 open. Never switch target, model or family
silently.

Planning made no code, runtime, registry or remote change. Assessment and plan files are
uncommitted on `develop`. On resume, revalidate the base SHA, worktree state, the classifier
template digest, the runner-image facts and provider contracts before relying on this plan. Next
action: owner go for Phase 1.
