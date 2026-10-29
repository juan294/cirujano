# Real CI advisory baseline

Date: 2026-10-29. Repository: `/Users/juan/code/cirujano`. Branch: `develop`. Product source and research base: `7314da81d6241ed00e391df0a1f22966b4b3b162`.

## Question and result

What real historical information can the current advisory collector retain, and what effectiveness can its local rules/search baseline demonstrate before a live Jev pilot?

Collected 60 real completed public GitHub Actions jobs across three repositories. The current collector retained **45 partial metadata bundles, refused 13 jobs, and could not be invoked for two unresolved source-job selections**. None produced supported source mapping or searchable source excerpts. For the 45 retained bundles, duration and rounded-minute arithmetic matched independent annotations in **45/45 comparisons**. Search returned `no-match` for all 36 frozen questions. The pipeline answered **0/27 source-navigation tasks**, including **0/18 heldout tasks**, because no source inventory reached search. Conditional retrieval quality, semantic classification quality, reference integrity, native Jev performance and human time savings remain **UNMEASURED**, rather than successful empty-denominator scores. Evidence: local `docs/agents/real-ci-advisory-2026-10-29/baseline-summary.json:1`, `baseline-cases.json:1`, `baseline-queries.json:1` in the same directory.

This completed the bounded historical collection and local baseline stage. No live inference, CI execution, runner/provider changes, source changes or publication occurred. The work does not demonstrate Jev usefulness, cache misses, causal regressions, CI optimization or monetary savings.

## Scope and provenance

The observation window is run creation from `2026-09-29T00:00:00Z` through `2026-10-29T06:48:33.877004Z`. Each selected job had completed before that endpoint. Public repository metadata, completed run listings, attempt-specific jobs, and immutable workflow bytes were fetched on 2026-10-29. All selected attempts are 1. Repository IDs are Cirujano `1361548133`, gh-glance `1320091829`, and cc-rpi `1162865792`. Primary repository metadata: [Cirujano](https://api.github.com/repos/juan294/cirujano), [gh-glance](https://api.github.com/repos/juan294/gh-glance), [cc-rpi](https://api.github.com/repos/juan294/cc-rpi). Historical copies and exact retrieval times are retained locally; current API responses can subsequently change.

| Repository | In-window listed runs | Versioned non-repair runs | Sampled runs | Candidate jobs | Selected jobs | Distinct selected runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| juan294/cirujano | 329 | 198 | 20 | 32 | 20 | 15 |
| juan294/gh-glance | 330 | 232 | 20 | 44 | 20 | 10 |
| juan294/cc-rpi | 55 | 46 | 20 | 20 | 20 | 20 |
| Total | 714 | 476 | 60 | 96 | 60 | 45 |

This is a deterministic **two-stage purposive sample**, enriched first for non-success runs and workflow diversity, then for non-success/skipped jobs, long/short durations within the sampled runs, and workflow/job diversity, followed by a seeded hash remainder. It excludes 160 repair-coordination workflow runs and 78 dynamic/non-versioned runs. It is not an unbiased fleet prevalence estimate. Jobs share runs, owners and source conventions; 60 jobs are not 60 independent workflow families. The longest/shortest strata are relative to the 96-job candidate pool, not all historical jobs. Sampling implementation: `docs/agents/real-ci-advisory-2026-10-29/gather.py:43`, `gather.py:54`, `gather.py:77`, `gather.py:86`, `gather.py:95`.

Selected conclusions are 41 success, seven failure, five cancelled, five skipped and two action_required. Events are 22 pull_request, 18 push, 19 schedule and one release. These describe this sample only. Development consists of the 20 Cirujano jobs; holdout consists of 40 gh-glance/cc-rpi jobs. There are 32 retained workflow files with 18 distinct Git blobs, nine in each split and no exact cross-split source duplicate. Similar CI conventions remain possible. Source bytes at a run head are **repository-source observations**, not proof of the workflow revision, checkout or expansion actually executed. Evidence: local `observations.json:1`, `sampling-summary.json:1`; collection source handling at `gather.py:99` and `gather.py:109`.

The read ledger records **192 successful unique GitHub GETs**, fixed host `github.com`, API version `2022-11-28`, restricted to these three repositories. The original sampling freeze covers 104 requests; collector capture added 88 fresh requests. The collector made 254 transport reads including cache hits, which is not 254 additional network requests. No logs were downloaded and no retrieved workflow/helper was executed. The complete ledger retains endpoint, URL, retrieval time, response hash and local file; it contains no authorization headers. Evidence: local `github-requests.jsonl:1`, `collector-results.json:1`, `artifact-validation.json:1`.

## Observed collector coverage

| Repository | Selected | Complete | Partial metadata | Refused | Selection unavailable | Numeric pairs matching |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cirujano, development | 20 | 0 | 16 | 3 | 1 | 16/16 |
| gh-glance, holdout | 20 | 0 | 12 | 7 | 1 | 12/12 |
| cc-rpi, holdout | 20 | 0 | 17 | 3 | 0 | 17/17 |
| Total | 60 | 0 | 45 | 13 | 2 | 45/45 |

The observed paths are distinct:

- **42 non-push jobs** retained metadata with `unsupported-mapping`. The current collector fetches candidate source only for `push`, so these were never evaluated for supported source mapping during collection: `packages/cli/src/advisory/collect.ts:72`.
- Of **18 push jobs**, **13** stopped at the whole-source guard with `unsafe-source-credential-or-environment`, **three** retained metadata after mapping failed, and **two** had no unambiguous selected source job key. Those two were not submitted with invented keys. Source validation rejects environment mappings, uppercase shell assignments and credential shapes, among other patterns; a refusal is not evidence that a real secret was present: `packages/cli/src/advisory/collect.ts:49`, `packages/cli/src/advisory/contracts.ts:53`.
- Supported mapping currently requires a literal matching job identity, no matrix/reusable job, explicit unique literal step names, no step expressions, an allowlist for action references, and compatible API step ordering. Unmapped candidate source is discarded rather than relabeled as accepted evidence: `packages/cli/src/advisory/contracts.ts:34`, `packages/cli/src/advisory/collect.ts:74`.

All 45 retained bundles decode with their original sealed digest and exact repository/run/attempt/head/job identity. All have `unsupported-mapping`, zero sources and zero enumerated excerpts. One also has `missing-steps`. All three repository inboxes report `partial`. Raw-source diagnostics separately found guard refusals in 49/60 source observations. All 58 attempted mapping diagnostics returned no mapping; two unresolved source-job selections were not mapped. These diagnostics overlap collection paths and are not additional mutually exclusive failure counts. They did not bypass the collector. Evidence: local `collector-results.json:1`, `baseline-summary.json:1`; diagnostic-only orchestration at `capture-collector.mjs:25`.

Examples of retained metadata observations: [Cirujano CodeQL failure](https://github.com/juan294/cirujano/actions/runs/38361803328/job/115177502719), [gh-glance coverage](https://github.com/juan294/gh-glance/actions/runs/36811815126/job/110208306377), [cc-rpi coverage](https://github.com/juan294/cc-rpi/actions/runs/38202541932/job/114658860014). Their retained workflow head/blob identities and source URLs are in each corresponding observation; these links alone do not establish source-to-execution mapping.

## Independent annotations and frozen questions

A separate agent authored a rubric, 60 case annotations and 36 questions from the raw observations and retained source, without product code, collector predictions, model output or baseline scores. A fresh blind auditor checked all 60 numeric/identity/reference cases, all 40 heldout semantic cases and all 24 heldout questions. The annotations contain 433 source-reference entries with valid immutable blob and line identities. These are **independently audited agent judgments, not human-reviewed truth**. Questions were authored from real source facts; they are not captured user investigation sessions. Evidence: local `annotation-notes.md:1`, `gold-audit.md:1`.

Each repository has nine supported source-navigation questions and three missing-evidence no-match questions. This gives nine development and 18 heldout answerable questions, plus three development and six heldout no-match questions. Locating `pnpm run build` is a source-navigation fact; it does not establish hidden compilation semantics. The strict source-operation rubric therefore marks build semantics uncertain where package/helper implementations are unretained. The cc-rpi navigation questions cover facts in only two distinct workflow blobs, limiting diversity. All 60 cache-miss labels are uncertain because executed-source identity and runtime cache evidence are absent. Evidence: local `questions.json:1`, `annotations.json:1`, `rubric.md:1`.

Before baseline scoring, two valid equal start/end intervals were corrected from null to zero. The blind audit also found **G-001**, an ambiguity in the rubric's cache-absence exception. The author clarified that observed-runtime absence requires established execution identity and complete relevant evidence. All 60 case judgments and all 36 questions remained unchanged by G-001; only rubric text and linked metadata changed. Original drafts/freezes remain preserved. The auditor independently verified the unchanged annotations and questions, closed G-001 and passed revision 2 before scoring began. Protocol findings **RP-1** (sampling interpretation), **RP-2** (head source versus execution) and **RP-3** (verifiable pre-score freeze) are resolved by the disclosed limits and frozen provenance; they do not constitute native effectiveness evidence. Evidence: local `gold-audit.md:1`, `pilot-protocol-review.md:1`, `collector-corpus-compatibility.json:1`.

## Local baseline measurements

The baseline invoked the actual archived `decodeEvidence`, `observeBundle`, `buildInbox`, `enumerateEvidenceExcerpts` and `searchEvidence` methods, using genuine collector bundles. Only the external GitHub transport was supplied by the retained/live GET cache during collection. No owned parser, classifier, validator or search method was mocked. No raw workflow was manufactured into an accepted EvidenceBundle. Each repository inventory remained within the product limit of 20 bundles: `packages/cli/src/advisory/rules.ts:45`; local harness `baseline.mjs:6`, `baseline.mjs:36`, `baseline.mjs:52`, `baseline.mjs:62`.

| Measure | Observed result | Interpretation |
| --- | --- | --- |
| Metadata availability | 45/60 jobs, 75% | Coverage in this purposive sample |
| Supported source mapping | 0/60 jobs | Collection prerequisite absent |
| Retained-bundle timing arithmetic | 45/45 duration and rounded-minute pairs match | Numeric correctness on available metadata |
| Holdout timing arithmetic | 29/29 pairs match | Conditional on retained metadata |
| Searchable source excerpts | 0 across all three inventories | Retrieval has no admitted source evidence |
| Mechanical search outputs | 36/36 `no-match`, zero hits/candidates | Output observation, not successful question answering |
| Answerable task completion | 0/27 overall; 0/18 heldout | End-to-end source-answer availability |
| Conditional retrieval precision/recall, reference integrity | UNMEASURED | No usable source inventory or returned citations |
| No-match correctness/false-answer rate | UNMEASURED | Nine empty-inventory outputs do not validate rejection quality |
| Semantic-label quality, native latency/cost, human time saved | UNMEASURED | No native calls or timed human investigation |
| Regression/CI savings | UNMEASURED | No complete supported comparison cohorts |

The raw API timestamps have 55 positive intervals, two zero intervals and three reversed one-second intervals. Independent annotation preserves reversed intervals as null. Of the retained 45, 44 have positive and one has zero elapsed duration. The other 15 cases remain not evaluated by product metrics; absent/refused results were not filled with zero. Rounded minutes here are per-job elapsed-time ceiling arithmetic, not invoice measurements. Product timing behavior: `packages/cli/src/advisory/rules.ts:22`, `packages/cli/src/advisory/rules.ts:26`. Evidence: local `artifact-validation.json:1`, `baseline-cases.json:1`.

The 434 API steps in retained bundles all receive the rules category `unknown` because their command mapping is absent. Source-strict gold judgments and package-script command-intent categories have different scopes; no unsupported direct semantic accuracy comparison was forced. The rules explicitly require supported mapping before classification: `packages/cli/src/advisory/rules.ts:32`.

Excerpt enumeration requires mapped command references or explicitly retained non-workflow source files; metadata names alone do not become searchable source. Default search is lexical and returns no-match when it has no candidates. Thus the zero answer completion is an observed pipeline availability result; it does not isolate lexical ranking quality or predict a Jev improvement: `packages/cli/src/advisory/projection.ts:42`, `packages/cli/src/advisory/search.ts:22`.

No valid regression comparison is available. Current cohorts require at least three distinct complete successful supported runs each, consistent source/runner identity within a cohort, at most 20 combined inputs, and baseline preceding candidate. This sample has no supported bundle, so commits/retry attempts were not mixed to manufacture cohorts: `packages/cli/src/advisory/compare-cohorts.ts:19`, `packages/cli/src/advisory/compare-cohorts.ts:26`, `packages/cli/src/advisory/compare-cohorts.ts:38`.

## Current user-visible recovery and remaining uncertainty

Partial bundles remain usable in the local inbox, with status, reason codes, limitations and next actions. Collection failures become an `unavailable` report with the safe reason, operation/input reference and guidance to inspect status, reuse valid local inputs, and select a fresh dedicated output directory. These are existing user-visible recovery paths; they neither repair unsupported mapping nor grant inference authority: `packages/cli/src/advisory/rules.ts:8`, `packages/cli/src/advisory/rules.ts:42`, `packages/cli/src/advisory/service.ts:110`.

The existing evaluation harness expects a particular frozen 60-case corpus with **36 heldout cases**, specific question partitions and preparable inputs. This pilot has **40 heldout cases** and no preparable source excerpts; it is not a drop-in replacement or a native qualification run. The separate local research harness records that difference: `scripts/advisory/evaluate.mjs:76`, `scripts/advisory/evaluate.mjs:82`.

Unresolved practical questions are source coverage under the existing collector contract, actual model quality on accepted source, human agreement with the agent rubric, investigation-time benefit, and compatible repeated-run evidence for regression analysis. They remain outside what this historical baseline can answer. Live inference would require a separately reviewed exact payload and single-use permit; no permit or spend was created here: `packages/cli/src/advisory/service.ts:128`.

## Verification and durable handoff

All research code/data are local under ignored `docs/agents/real-ci-advisory-2026-10-29/`. This curated report is the sole new reviewable repository artifact; product source, configuration and dependencies remain unchanged. The product source was archived from the exact base SHA; independent review compared all 855 regular archived files to Git blobs. The private module used Node `v24.22.1`, esbuild `0.28.2`, target node22 and installed workspace dependencies. This identifies the environment, not a separately hermetic dependency installation. It exported no native provider entrypoint. Primary pinned source: [Cirujano at the measured SHA](https://github.com/juan294/cirujano/tree/7314da81d6241ed00e391df0a1f22966b4b3b162).

Frozen identities:

- Initial 140-file input freeze: `2a6780f7ce8fdf3d3ab2c848ed869c8b22176abe87d49976edc7ec83b03794b8`.
- Final labeled corpus freeze, revision 2: `07a22fb5dfdbef4c1428d1232223b6e81923a159735cd4f5bee4f165ccb1e6b3`.
- Product module SHA-256: `2915c81998fa5ec08c59e97404720e52561dd2edcdbd31dbd9c7d106090c8603`.
- Collector output SHA-256: `ad2d44c9dd7a9a3b534b5be3e305b941d558d4e3464150a161bc3d80270a61be`.
- Baseline summary SHA-256: `f49750df38c550cad558bf8808cae972a7b79b5147497f90119d6146f15fb1b8`.

Baseline ran locally at `2026-10-29T07:31:40.321Z`–`07:31:40.702Z`; that wall interval is not a CLI benchmark, model latency or human investigation time. `node docs/agents/real-ci-advisory-2026-10-29/baseline.mjs` exited 0 after validating the input/label/tool/capture identities. Independent Python arithmetic/provenance validation, `python3 docs/agents/real-ci-advisory-2026-10-29/validate.py`, passed all 60 timestamp pairs, retained blob identities, 45 sealed bundle digests, 45 numeric comparisons, 36 query outputs, all 192 successful GET response hashes and explicit missing/unmeasured denominators. Protocol and blind label audits passed within their documented scopes. These checks validate this artifact and unchanged product methods; no new application test-suite or hosted-CI claim is made.

Raw manifests, scripts, per-query outputs, annotations, audits and complete response provenance remain local. The final `docs/agents/real-ci-advisory-2026-10-29/evidence-freeze.json` manifest binds their completed bytes; the report is linked by its separately recorded hash to avoid a self-referential digest. Verify it without rewriting measured artifacts with `python3 docs/agents/real-ci-advisory-2026-10-29/freeze.py --verify`. Re-running the baseline overwrites its local timestamped outputs and invalidates that final manifest, so preserve the original and use a separate output copy for a new measurement.

On resume, verify actual branch, SHA, report and raw manifests before reusing results. The approved stage is complete; there is no remaining implementation branch/worktree to merge or prune for this research. Further collector changes, dataset integration, human evaluation or native inference require their own scoped work. This report grants no push, routing, provider, runner or publication authority.
