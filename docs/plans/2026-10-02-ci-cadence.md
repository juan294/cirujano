# Reduce private-fleet CI execution frequency

Date: 2026-10-02. Status: reviewed implementation specification; implementation and external activation are not authorized by this planning request.

## Objective and accepted scope

Replace repeated full remote validation of ordinary owner development with local full validation, one inexpensive remote gate, changed-code nightly suites and strict release validation. Roll out A/B/C first, then eligible D/E/F/G/H, as selected by the owner. I has no integration branch and minimal measured use; J is a manual proof repository with no measured execution. Leave I/J and public repositories unchanged.

Source assessment: [CI cadence assessment](../research/2026-10-02-ci-cadence-assessment.md). Private identity mapping, workflow inventory, source citations and command matrices are in ignored `docs/agents/2026-10-02-ci-cadence-plan/README.md`. Do not publish that directory or substitute private names into this public plan.

The assessed run cohort attributes 71.7% of identified private hosted runtime to A/B/C. This is a prioritization signal, not billed savings. October's included allowance was already exhausted during assessment. The plan cannot restore it or establish a zero invoice.

## Decisions and trade-offs

| Choice | Decision and consequence |
| --- | --- |
| Routine owner development | Full applicable validation locally; remote `CI Fast` scans introduced commits, validates workflow/policy/lockfile shape and runs cadence contract tests. No application install, build, full tests, coverage, DB/browser setup or automatic staging deployment in this gate. |
| Complete removal of PR CI | Rejected in favor of one small independent signal. Release and untrusted contribution validation remain separate. |
| Nightly | Resolve integration head once, pin its full SHA and run the full applicable suite if that identity has no successful matching suite, or an environment refresh is due. |
| Quiet repositories | Weekly full environment/security refresh; coverage freshness for opted-in repositories is eight days. Changed heads have a 36-hour pending deadline, independently of the old report's eight-day limit. |
| Release | Retain full existing required contexts and exact candidate/base evidence. Nightly or `CI Fast` success is never substituted for release-required tests. Preserve post-publication exact-SHA jobs used by deployment contracts. |
| Deployment | No automatic staging or Preview. B's required Preview smoke becomes a real `Release artifact smoke` against a production-mode local candidate. C's release smoke also probes its candidate locally. Platform/provider proof remains in separately authorized release procedures. |
| Activation | Install guarded definitions under legacy behavior, establish real `CI Fast`, migrate development required checks, then set lean. Changing rules or variables is an external action needing explicit authority. |
| Cirujano optimizer | Keep its cache-only authority intact. Cadence changes live in repository workflows and small local policy helpers. No optimizer/controller product expansion, runner migration or billable VM work. |
| Financial containment | Budget edits are outside this plan. Keep the existing cap unchanged; future owner decisions about a lower cap are separate. |

Weekly unchanged-code execution reduces quiet-repository cost while accepting slower detection of environmental regressions. A changed integration head receives independent full validation on the next scheduled pass. Scheduled execution can be delayed, so deadline misses are visible and never described as a pass. GitHub schedules execute the default-branch definition; B must explicitly resolve integration head from its default production branch. [GitHub scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Current evidence and implementation boundaries

Cirujano is on `develop` at `ff15dbb68ca4f481b12022159b84bf089ba665b6`, ahead of origin by an unrelated test-helper commit. Preserve it. Assessment source began at `a20eca6da52684466b3f6f8cf01a4bd1450d80c8`; cited optimizer and controller sources are unchanged. `packages/core/src/optimization/contracts.ts:9` defines cache-only operations; `packages/core/src/optimization/patch.ts:42` validates that limited patch. Do not change those contracts. `packages/cli/src/fleet-service.ts:217` writes verification results; do not call it as a read-only planning or cost gate.

Fresh private repository metadata, integration heads and complete local workflow inventories were captured in `inventory.json`. These separate observations are not an atomic fleet snapshot. A/B/C workflow captures in the assessment byte-matched their local definitions. F's investigator inspected a newer clean local integration SHA; both identities are recorded in the private annex. Revalidate changed files and refs on implementation entry. Hosted Graphify was unavailable for A/D; exact known workflow reads supplied fallback evidence. Local Graphify provided navigation for Cirujano, B/C/E/F/G/H; source is authoritative.

The two independent planning investigations found:

| Finding | Evidence | Disposition |
| --- | --- | --- |
| C1, C2 | Assessment allowance, cap and event attribution | Prioritize A/B/C; measure remaining spend; do not edit cap. |
| C3 | A hosted fallback and stale enrollment records | Preserve hosted placement. Record runner discrepancy; reconciliation and provider recovery are excluded from this cadence implementation. |
| C4 | Cache-only optimization contract | Direct reviewed workflow changes, not broadened optimizer powers. |
| C5 / P1 | F compares coverage SHA to current default head and escalates after 180 minutes: `F/src/lib/health.ts:262` | Phase 2 makes selected operational health cadence-aware and displays true provenance. |
| P2 | F producer auditor requires every-head push and `github.sha`: `F/scripts/audit-coverage-producers.ts:46`, `:61` | Policy-specific audit rules; preserve exact resolved SHA and branch checks. |
| P3 | Public cards and generated context discard provenance: `F/src/lib/queries/projects.ts:110`, `F/scripts/generate-artifacts.ts:198` | Carry actual measured SHA/time through all consumers. |
| C6 / P4 | Required contexts and skipped-leaf aggregators differ: `A/.github/workflows/ci.yml:637`, `B/.github/workflows/ci.yml:215`, `C/.github/workflows/ci.yml:484` | Route aggregates and leaves together; full lanes require successful applicable children. |
| P5 | B Preview gate waits for deployment: `B/.github/workflows/preview-smoke.yml:52`; C PR smoke can skip: `C/.github/workflows/ci.yml:505` | Real candidate artifact smoke; explicit B main-context replacement, candidate-bound post-publication checks preserved. |
| P6 | Write-capable repair triggers lack opt-in: `B/.github/workflows/sutura.yml:22`, `C/.github/workflows/sutura.yml:22` | Default-off repair opt-in installed on actual default branch before activation; no automatic retry or repair publication. |
| P7 | E requires exact full `check` from integration; G production is `master`: `E/.github/workflows/ci.yml:4`, `G/CLAUDE.md:33` | Preserve E fast-forward release topology and G master contexts; repository adapters below. |
| C7 | Net savings and billing reconciliation unmeasured | Phase 7 measures billing and provider costs with honest missing-data states. |

## Shared policy contract

New planned files in each enrolled repository: `scripts/ci-cadence.mjs`, `scripts/ci-cadence.test.mjs`, `.github/ci-cadence.json`, event/history fixtures and `ci-fast.yml`/`ci-nightly.yml`. G may use the same small Node helper with explicit setup-node rather than invent a second semantic implementation. Reuse existing repository helpers where they already enforce the same identity contract. Each copy is versioned and tested with the same fixture contract; no mutable remote script download.

The JSON policy records schema version, integration/default/production branches, allowed owner identity, full-suite workflow identities, applicable job/context inventory, security refresh interval and coverage deadlines. Only validated `CI_CADENCE_MODE=lean` enables reduced cadence. Missing, legacy or invalid values retain existing full behavior and explain the selected mode. Policy parse failure blocks with a concrete repair message, never silently skips tests. `CI Fast` runs on every supported PR and integration push, including docs-only changes; remove workflow-wide path filters that would suppress a required check.

Routing uses helper/policy loaded separately from an immutable protected PR base or default-branch definition, never from the contributor candidate. Mandatory production-base and untrusted predicates apply independently of helper outputs. Initial installation without a base helper conservatively forces the existing full lane. Candidate changes to helper, owner allowlist, branch names or context inventory cannot select fast or privileged execution. Candidate workflow-definition changes themselves require trusted review before integration; contributor-controlled YAML is not an adversarial security boundary. Receipt reuse checks the measuring workflow blob against the installed trusted definition inventory.

Trusted development means an owner-authored PR from the same repository into integration, or an authorized owner integration push. Dependabot, forks and other authors enter the untrusted lane. That lane uses standard hosted isolation, read-only token and no privileged secrets/self-hosted runner. Execute all tests possible with local test services and synthetic providers; explicitly block acceptance on withheld authenticated/live-provider proof until vetted integration obtains that evidence. Never use `pull_request_target` to execute contributor code with secrets. [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use).

Full lane predicates include production PR/push, untrusted PR, changed/periodic nightly and an approved manual validation. Manual validation is diagnostic only unless the repository's existing release contract explicitly accepts that exact event. Main/master publication jobs that already deploy or verify production are preserved, including A's Firebase prerequisite graph.

```
@ classifyEvent(event, policy, mode) -> lane and immutable identity
ctx: trusted event payload, versioned policy, read-only GitHub API
pre: policy schema and branch topology validated
do:
  1. parse owner, author, base, ref and event kind
  2. validate release candidate and base identity
  3. compute full or fast lane without trusting contributor inputs
br: release or untrusted -> full; valid lean owner development -> fast; legacy -> existing full
fail: invalid policy -> blocked check with repair instruction
fx: emit lane, tested SHA, definition SHA and reason
```

Nightly history lookup is bounded and paginated. A reusable success must belong to the allowlisted repository/workflow, integration branch and exact source SHA, with matching policy, lockfile and runtime fingerprints and complete full-suite receipt. Failed, skipped, partial, expired or absent evidence is not reusable. API failure falls back to full execution and explains the increased cost. A successful receipt is created only after all applicable suite children pass; it includes run ID/attempt, actual test completion time and workflow-definition SHA. No branch-writing dedup marker or PR-writable cache.

Do not automatically rerun a known failed identity on subsequent nights. Emit `blocked: previous full suite failed`, link its run, and state that a changed/fixed commit or specifically authorized retry is required. Periodic refresh applies to the latest successful identity after seven days. Unchanged skips preserve the original coverage timestamp. Release always executes its own required suite; cancellation groups isolate fast development from nightly and release and never cancel release evidence.

```
@ chooseNightly(head, history, now) -> run or visible disposition
ctx: default-branch definition, read-only run/artifact lookup
pre: integration head resolved once and pinned before checkout
do:
  1. validate receipt identities and full child results
  2. lookup newest matching success and failed attempts
  3. compute changed-code need and seven-day refresh deadline
br: known failure -> blocked disclosure; valid recent success -> unchanged skip; else -> full
fail: history unavailable -> full with warning; checkout identity mismatch -> blocked
fx: emit receipt or explicit skip/block reason without refreshing coverage
```

## Coverage reporting contract

Phase 2 adds an exact-repository allowlist to F's checked-in producer policy. Unenrolled repos keep current behavior. Operational states distinguish `current`, `pending`, `overdue`, `stale`, `missing`, `invalid` and actual failed suite evidence when available. For valid mismatching evidence, freeze the no-SQL rule: `pendingAnchor = min(sourceReportedAt, verifiedHeadChangedAt ?? sourceReportedAt)` and `pendingDeadline = pendingAnchor + 36 hours`. Repeated pushes cannot reset it. A first change after a quiet week may be immediately overdue until the next actual successful report; show its next scheduled run. Independently, a successful report older than eight days is stale. Missing measurement/transition provenance cannot grant a new grace period. A successful report for the observed head clears pending.

Show measured SHA, measurement date/age and whether current head is tested on public cards, detail cards, admin rows, health output and generated context. Global ingestion liveness is a separate measure, not proof that every repo is fresh. Keep its 48-hour check where existing central ingestion provides that signal; describe it as latest ingestion, and retain per-repo deadlines separately. For the admin data-source aggregate, fetch the newest row's repository identity with its timestamp: eight days only for an enrolled identity, otherwise retain seven days. This remains latest source activity, not fleet-wide freshness; mixed-policy fixtures prove selection.

The ingestion API remains unchanged in authority: exact tracked identity, default target branch, producer/workflow branch, signed transport, replay handling and strictly newer timestamps. No SQL migration. Existing first-public-release DB coverage equality remains strict (`F/supabase/migrations/20260715140000_github_metrics_integrity.sql:200`). Production comparison gets explicit `operational` mode; its default/release mode still requires exact SHA. No release caller switches modes accidentally.

B's nightly integration report remains a workflow artifact. F continues receiving actual default-main coverage after a successful default-main full suite and weekly default-main refresh; never store develop coverage as main. Each branch receipt and coverage output is distinct. Native publishers consume resolved `SOURCE_COMMIT_SHA`, `SOURCE_TARGET_BRANCH` and actual suite completion time. F's batch publisher verifies default-branch checkout before testing and unchanged tested tree afterward; it never infers main coverage from a develop checkout.

Enrolled artifact publishers explicitly set `COVERAGE_REPORTED_AT` from the immutable successful suite completion receipt; missing receipt time blocks publication. Delayed/reused evidence retains original tested SHA, source run ID, workflow ref and attempt, not the transport run's measuring identity or delivery clock. Unchanged skips do not publish. Duplicate delivery follows existing replay/newer-only no-op semantics. Add delayed/reused artifact tests; leave legacy timestamp defaults unchanged outside enrolled scope (`F/scripts/report-coverage.sh:20`).

Only a successful actual default-branch suite with valid native branch workflow provenance may publish to F. PR/merge-ref and integration-nondefault suites retain coverage as artifacts only; they cannot relabel their workflow ref as a default-branch measuring run. The branch/provenance fixture matrix tests this distinction.

```
@ foldCoverage(report, observedHead, policy, now) -> operational state
ctx: stored source SHA/time and existing reconciliation state
pre: selected repository policy validated; source fields remain immutable
do:
  1. validate report identity and measurement timestamp
  2. compute report age and oldest uncovered-head deadline
  3. compute head relation and explicit recovery instruction
br: exact fresh -> current; bounded lag -> pending; deadline missed -> overdue or stale
fail: missing or invalid provenance -> disclose missing or invalid without pass
fx: emit measured SHA/time and current-head relation to every consumer
```

## Repository implementation matrix

| Alias | Local owned units and full-suite invariants |
| --- | --- |
| A | Route integrated checks/coverage, Firebase rules, mobile/WebKit, applicable visual/journey and exhaustive release predicates. Preserve production contexts `verify`, `firebase-rules`, `worker-skew-guard`, `release-suite`, `index-deploy-guard`, `assertion-inversion-guard`; preserve main-push Firebase deploy prerequisites. Consolidate routine duplicate secret scan. Keep hosted fallback. |
| B | Route CI, E2E/visual, Lighthouse, bundle, Knip, licenses, security and applicable Stripe suite. Main retains actual Lint & Typecheck, Test, Build and Playwright E2E. Replace Preview context with Release artifact smoke only after that new context passes under an eligible release PR. Default-main nightly definitions explicitly test develop; default-main coverage remains separately identified. |
| C | Route CI/coverage, bundle, Knip, Lighthouse, Gitleaks, security and CodeQL. Retain real DB, E2E, pending-migrations release admission and candidate smoke. Local DB/Redis fixtures remain run-scoped. Development legacy contexts migrate to CI Fast; production contexts stay full. |
| D | Route CI quality/test/build/DB contract/audit and CodeQL; consolidate duplicate coverage publication. Preserve production `check`, release-evidence collector and main migration ledger. Existing production probe remains. |
| E | Preserve integration-only full `check` and immutable fast-forward release contract. Add trusted owner variable `CI_RELEASE_CANDIDATE_SHA`: an exact matching integration push forces full execution regardless of lean mode. The documented release controller sets it only with publication authority before the single candidate push, verifies the full native `check`, and clears it as part of that authorized operation. Ordinary fast gates never emit `check`. Keep post-deployment release smoke and all full security/DB/browser jobs. |
| F | Phase 2 consumer changes first; phase 5 routes heavy CI and integrated coverage once per full suite. Preserve main `check`, production release-health separation and existing production monitoring. Central Roots coverage stays outside this private rollout. |
| G | Production is master, not main. Preserve all nine currently required contexts including three Python versions, release-required subset, Docker and wheel smoke, audit/types/lint. Stop routine feature-branch full pushes. Consolidate canonical coverage plus scheduled-coverage-agent's duplicate suite into one full run, retaining its report output without new report commits. Keep dormant model agents disabled, heartbeat and existing authorized probes. |
| H | Route test.yml full suite/build and duplicate integrated/standalone coverage. Preserve full production validation and maintenance safety. Existing shared production DB is not a local test fixture: use synthetic/test services and guarded wrappers, never reset or write it as part of local CI qualification. |

All opted-in write-capable automatic repair monitors become explicit default-off. A retains its existing opt-in. Other existing monitoring, accounting ledgers and manual baseline/proof workflows are preserved. Automatic model review workflows are excluded from Actions-minute cadence changes and recorded separately as potential model cost. No new messages/issues or report-writing remote jobs are introduced.

## Phase sequence and acceptance

| Phase | Deliverable | Entry/exit gate |
| --- | --- | --- |
| [1](2026-10-02-ci-cadence-phases/phase-1.md) | Shared behavioral fixtures, read-only cost measurement tool and rollout ledger | Local implementation authority; all local contract/tool gates pass. |
| [2](2026-10-02-ci-cadence-phases/phase-2.md) | F coverage consumer/provenance compatibility | Phase 1 accepted; consumer sweep, real local DB and UI contracts pass. |
| [3](2026-10-02-ci-cadence-phases/phase-3.md) | A/B/C local workflow definitions and release smoke replacement | Phase 2 accepted; repository full local gates and event matrix pass. |
| [4](2026-10-02-ci-cadence-phases/phase-4.md) | Authorized reporting/first-wave activation | Explicit exact publication/rule/variable authority; native check and identity evidence, no Preview and 72-hour observation pass. |
| [5](2026-10-02-ci-cadence-phases/phase-5.md) | D/E/F/G/H local adapters | First-wave acceptance; existing release topology, all local gates and coverage audit pass. |
| [6](2026-10-02-ci-cadence-phases/phase-6.md) | Authorized remaining-fleet activation | Separate publication/settings authority; same staged migration and native evidence per repo. |
| [7](2026-10-02-ci-cadence-phases/phase-7.md) | Cost, reliability and detection acceptance | At least seven complete days after final activation; reconciled evidence and explicit limits. |

One integration owner maintains the private rollout ledger and plan notes. Phase 3's A/B/C repositories are independent `[batch-eligible]` local worktrees. Phase 5's repositories are independent after the shared contract is frozen; use at most three implementers and one owner per repository/file set. F's coverage consumers are a single coordinated unit, not overlapping batches. Phase execution and acceptance remain sequential. No working-branch push or experiment PR.

Every implementation unit follows TDD, independent review, repair, simplify and sequential full required verification. Run commands from the annex and current controlling repository docs; capture each exit code and candidate identity. Missing browser/emulator/container prerequisites are blocked checks, never self-skip evidence. Production/paid probes stay separately authorized. Stop after each phase unless the owner explicitly authorizes continuation.

## Behavioral oracles

Phase 1 creates versioned fixture inputs and expected outputs, then each adapter executes them against its actual policy/helper and rendered workflow predicates. Fixtures cover legacy/invalid mode, owner push/PR, fork/Dependabot, docs-only change, production PR/base movement, production push, changed and unchanged schedule, periodic refresh, matching/expired receipts, history API failure and known failure. Test complete job dependency/results graphs, not only text presence in YAML.

Required invariants: CI Fast performs real bounded work; routine lean owner events have zero full-suite jobs; all production contexts require actual successful applicable children; no green reuse from a fast-only PR; scheduled checkout/report identity equals pinned target; default and integration coverage cannot cross labels; no deployment/privileged repair on fast/nightly/untrusted events; cancellation cannot terminate release evidence. Mutation tests that force a release child to skipped, point coverage at definition SHA or permit a routine full shard must make an oracle fail.

Coverage tests cover deadline boundaries, repeated-head changes, stale unchanged reports, successful recovery, failed suite preserving old time, old/out-of-order writes, invalid/missing provenance, strict release comparison and public/admin/artifact rendering. Existing signed transport/replay/partial-write tests remain. Cost fixtures cover per-job rounding, all attempts, time-window clipping, unknown runner/timing, public discounts, provider-cost absence and denominator zero.

Automated acceptance is local fixture/full-gate success plus read-only native assertions after authorized publication. Human acceptance is reviewing the concrete production-context replacement, detection-delay trade-off, screenshots and financial evidence; the agent executes all CLI/browser operations once authorized. A review is not a request for the owner to run commands.

## Stuck states and recovery

| State | Who sees what | Recovery and proving test |
| --- | --- | --- |
| Missing/invalid mode | Check summary says legacy full and names invalid setting | Set validated lean only after staged activation; fixture proves corrected mode enters fast and release stays full. |
| Invalid policy/unknown topology | Failing CI Fast names invalid field/branch | Repair policy locally and complete gates; test corrected policy clears block. |
| Missing/API-failed history | Nightly says full fallback and lookup reason | Full run makes fresh immutable receipt; API recovery fixture proves next valid success is reused. |
| Known failed full identity | Linked blocked nightly summary, no repeat paid execution | Publish fixed candidate with authority or authorize one retry; fixtures prove changed SHA proceeds and explicit retry is bounded. |
| SHA/check/receipt mismatch | Release remains blocked; summary names expected/actual identity | Rebuild evidence for exact candidate/base; mismatch-to-match test clears block without accepting skipped children. |
| Pending or overdue coverage | Cards/admin show measured commit/time and next due deadline | Successful actual-head report clears pending/overdue; boundary and recovery tests prove it. |
| Invalid/missing/expired coverage | Explicit missing/invalid/stale, no current-pass claim | Valid fresh report restores state; invalid-to-valid and unchanged timestamp tests. |
| Untrusted withheld credentials | Check names missing authenticated/provider acceptance | Vetted integration/full release obtains required proof; test public isolated checks alone cannot clear that blocker. |
| Missing default-branch definitions | Activation ledger says installed locally/integration only | Complete separately authorized default-branch release; API definition/branch fixture proves activation remains blocked until then. |
| Required check not produced | Merge stays blocked; ledger names obsolete/missing context | Install compatible workflow under legacy, verify new context, then migrate rules; rollback fixture restores legacy before old contexts. |
| E missing release candidate marker | Release controller says full integration check required | Authorized release operation sets exact candidate, then single push yields full check; marker mismatch/match fixtures. |
| Runner unavailable or platform budget stopped | Native job queues/fails; report names cause and missing evidence | Diagnose existing logs; separate authority for fallback, retry or budget/VM work. Test unavailable-runner receipt cannot pass release or be counted as savings. |
| Cost target missed/accounting unavailable | Report says target failed or net savings unmeasured with missing inputs | Keep correctness gates; narrow activation or request a separately scoped cadence/runner revision. Measurement tests cannot emit net savings with absent billing/provider evidence. |

## Consumer sweep

F's exact search commands and complete caller/writer/fixture inventory are recorded in the private annex. Search again on phase entry for new consumers:

```sh
rg -n 'coverageStatus|sourceCommitSha|verifiedHeadSha|sourceReportedAt|getRepositoryHealthCheck|foldRepositoryHealth|checkCoverage|test_metrics' src scripts e2e .github config
rg -n 'test_metrics.*(insert|upsert)|upsert_test_metrics_if_newer|INSERT INTO public.test_metrics|UPDATE public.test_metrics' src scripts e2e supabase .github
rg -n 'reported.*metrics|testMetrics:|coverageStatus:|coverage_provenance_mismatch|missing_default_branch_push' src scripts e2e .github --glob '*.test.*' --glob '*.spec.*' --glob 'seed.ts'
```

Phase 2 covers health fold/loaders/types, admin/public queries/cards, detail page, generated artifact context, API/cron/CLI output, production comparison, producer registry/audit, batch reporter and all fixtures/E2E writers listed in its phase file. Existing ingestion RPC/schema, first-release SQL and unrelated list/API surfaces are explicitly unchanged, with regression proof for retained strict contracts. Phase 3/5 cover every native coverage writer and full-job aggregate; central external coverage and dormant model jobs are excluded with the reasons above. Phase 1's new measurement tool has no existing shared type consumers; its contract is fixtures, CLI output and the local rollout ledger.

## Cost acceptance and evidence limits

Target for a future 31-day cycle: at most 80 routine private hosted minutes/day plus 500 release minutes, totaling 2,980. This is a fleet/account allocation to test, not a configured hard cap or forecast. Keep a separately reported unchanged monitoring allowance inside routine totals; never omit it to pass. Observe absolute totals and per-owner publication rates, full nightly costs, release costs and unknown jobs. Report pre/post event mix; the original short baseline does not establish causal savings under changed activity.

At seven full post-activation days, require ordinary owner full-suite execution count zero in lean mode, no invalid release admission, coverage within policy or visibly overdue, no extra auto-repair publication and projected routine usage at/below allocation. Use job sum, not workflow wall time. Count every job attempt and documented SKU weights; do not confuse self-hosted duration with avoided hosted time. Source-window gaps, unavailable cash billing or provider accounting block a net-savings claim. Actual monthly zero invoice remains unverified until billing closes. Missing the target is failed cost acceptance, even if workflow correctness passed.

## Durable handoff and next entry

Completed here: assessment readback; integration checkout validation; workflow/branch metadata inspection; graph navigation and direct-source checks; two bounded independent planning investigations; plan review and structural/privacy checks recorded in private notes. No application tests or native CI runs were initiated, and no implementation candidate exists. Artifact validation proves this plan's consistency only.

Approved decision: A/B/C first, then D/E/F/G/H. Architectural decisions above are resolved. C3 runner/provider recovery, lower financial cap and publication permissions are excluded actions, not unresolved implementation choices. B's default-main installation and smoke context replacement remain explicit future authorization gates. C's full product release scenario inventory is preserved by its current release playbook, not claimed to have been independently executed here.

Next: explicitly invoke implementation for phase 1. Read its contract and applicable instructions fully, inspect actual branch/status/HEAD, preserve unrelated changes, create an isolated worktree from integration and record tested candidate identities. Subsequent phase acceptance never implies publication, production, retry or paid execution authority.
