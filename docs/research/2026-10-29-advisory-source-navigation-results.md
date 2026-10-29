# Declared-source navigation: implementation and real-CI rerun

2026-10-29. Repository: Cirujano. Integration branch: `develop`. Base: `7314da81d6241ed00e391df0a1f22966b4b3b162`. Measured implementation: `6b7ff7ef5e6e7370d89d0cf74d3805ee68f78fab`. Runtime: Node 24.22.1, esbuild 0.28.2. This follows the [original real-CI baseline](2026-10-29-real-ci-advisory-baseline.md) and [approved follow-up scope](../plans/2026-10-29-advisory-source-navigation.md).

## Result

Added a separate local-only path for browsing workflow declarations at an API run head. **11/60 job-associated workflow observations are now admitted for source navigation, compared with zero searchable execution-source observations previously. Five of 27 navigation questions receive at least one relevant cited match, all five in the 18-question heldout partition.** This is a source-availability and retrieval-location gain, not proof of complete answers or Jev benefit.

The unchanged whole-file guard still refuses 49/60 workflow observations. Lexical relevance remains limited: only 12/63 returned hits overlap an independently annotated relevant range, and two of nine missing-evidence questions receive lexical hits. All 63 citations point to exact retained source bytes, so citation integrity and relevance are demonstrably different measures here. Existing execution collection, timing and search results remain unchanged. Native model quality, latency/cost, human agreement and investigation-time benefit remain **UNMEASURED**.

## What changed

`advisory collect-source` verifies repository/run/attempt/workflow/head-repository identity and reuses immutable Git commit/tree/blob acquisition. It saves complete safe original text, blob hash, ranges, scope, API version and acquisition/tool identity in a distinct `source-evidence.json` contract. It needs no source-job selection and makes no source-to-execution mapping: `packages/cli/src/advisory/collect.ts:61`, `packages/cli/src/advisory/collect.ts:70`, `packages/cli/src/advisory/source-evidence.ts:6`.

`advisory ask-source` searches those declarations locally using the existing lexical token/synonym policy. It returns at most three non-overlapping line excerpts from a 20-candidate shortlist, with immutable head/path/blob/range references and explicit declaration-only limitations. The payload contains no executed-job timing, cost, category or semantic probability: `packages/cli/src/advisory/source-search.ts:6`, `packages/cli/src/advisory/source-search.ts:17`, `packages/cli/src/advisory/source-search.ts:38`; shared scoring at `packages/cli/src/advisory/search-candidates.ts:17`.

The source decoder validates exact kind/version/fields, original blob/ranges, digest, per-file byte/line bounds and the unchanged whole-file guard on every read. Collection uses the existing fresh private operation store. Source-only input is rejected by execution/inference readers, and source recovery directs users to source commands rather than inference preparation. Existing execution EvidenceBundleV1 still forbids sources on unsupported mappings: `packages/cli/src/advisory/source-evidence.ts:15`, `packages/cli/src/advisory/service.ts:49`, `packages/cli/src/advisory/storage.ts:22`, `packages/cli/src/advisory/contracts.ts:97`.

Accepted text is never sanitized or truncated under its original blob identity. Non-roundtripping UTF-8 BOM input is refused; Unicode and CRLF roundtrip are tested. Source admission and inference scope were not expanded to environment-bearing files. A refusal does not prove an actual secret was present: `packages/cli/src/advisory/source-evidence.ts:25`, `packages/cli/src/advisory/source-collection.test.ts:37`.

## Actual CLI rerun

The measured CLI bundle SHA-256 is `4f2a2115ae19dec42df62e6b6d0301d21c8cbeca3392adf1b0d3de1562f6ab05`. The rerun ran `2026-10-29T08:31:26.548966Z`–`08:33:01.398695Z`. It used the same 60 cases, source identities, 60 independent agent annotations and 36 questions; no failed case was replaced or relabeled. Original input/corpus/completed-evidence freezes remain unchanged. This is diagnostic reuse of a previously inspected purposive corpus, not a fresh unseen or human-reviewed qualification set.

| Repository | Original observations | Admitted declarations | Guard refusals | Navigation tasks with a relevant hit | Valid citations / returned hits |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cirujano, development | 20 | 6 | 14 | 0/9 | 17/17 |
| gh-glance, holdout | 20 | 2 | 18 | 0/9 | 16/16 |
| cc-rpi, holdout | 20 | 3 | 17 | 5/9 | 30/30 |
| Total | 60 | 11 | 49 | 5/27 | 63/63 |

The 11 admitted head/path documents contain seven distinct workflow blobs. All five matched tasks concern cc-rpi, and repeated workflow versions contribute multiple hits; these are not independent workflow families. The same repository/run and source-head independence limits from the original pilot still apply.

| Measure | Observation |
| --- | --- |
| Overall navigation tasks with at least one relevant hit | 5/27 (18.5%) |
| Heldout navigation tasks with at least one relevant hit | 5/18 (27.8%) |
| Pooled relevant returned-hit proxy | 12/63 (19.0%) |
| Heldout relevant returned-hit proxy | 12/46 (26.1%) |
| Missing-evidence questions with lexical hits | 2/9 overall; 2/6 heldout |
| Exact retained-source citations | 63/63 |
| Existing execution outcomes | 45 partial, 13 refused, two unresolved selections; all 60 unchanged |
| Product-computed duration/rounded-minute pairs | 45/45 match; heldout 29/29 |
| Existing execution `ask` results | All 36 remain no-match, with zero hits |
| Native quality/latency/cost and human investigation time | UNMEASURED; zero inference calls |

Relevance is a deliberately limited proxy: a returned line range overlaps an independently annotated range at the same immutable path/blob and associated inventory case. It is not a human judgment, full answer coverage or evidence that an opaque helper actually implements a build/test. The two missing-evidence questions with hits are `real-q-gh-glance-11` and `real-q-cc-rpi-12`. Their lexical source matches do not supply the requested trace or missing implementation. The source report explicitly disclaims execution/implementation proof; these hits remain recorded as retrieval noise. No ranking policy was tuned to improve these heldout results.

The before/after source inventories and result types differ. The original search operated only on execution-bound bundles; the new command browses declaration-only documents. Therefore the five relevant task matches do not isolate a ranking improvement or establish a semantic-model comparison. The useful present capability is inspection of admissible declarations with reliable locations. The measured limits are whole-file admission and lexical relevance.

Evidence is local in ignored `docs/agents/source-navigation-2026-10-29/`: `rerun-summary.json:1`, `rerun-cases.json:1`, `rerun-queries.json:1`, `inbox-*.json`, the 36 source-query reports and the 36 execution-query reports. Summary SHA-256: `a476e1e368c8bae4c2d58dc0728f9e75d8b57570d574681a7380b8ac8e8d0d5a`.

## Transport and provenance

The actual built CLI executed 193 commands: 60 source collections, 58 selected-job collections, three inboxes, 36 source searches and 36 execution searches. Two unresolved source-job selections were not invented for execution collection. The external GitHub transport used historical cached responses plus additional real GETs for missing immutable objects/one run-attempt response; no owned collector, parser, decoder, store, arithmetic or search method was mocked.

There were 674 transport reads: 552 original-cache reads, 46 follow-up-cache reads and **76 successful fresh GETs** (20 commits, 43 trees, 12 blobs and one run attempt). All requests were fixed-host GitHub API version `2022-11-28`, scoped to the same three public repositories; no logs, source execution, new CI runs, provider/model sends or publication occurred. The 76 fresh reads were within the 300-read follow-up budget; original plus follow-up fresh reads total 268. Every returned source's Git head/tree/blob chain and original bytes were independently checked. Primary historical case links and repository/source URLs remain in the original report and frozen observations.

JSON CLI reports retain canonicalized JSON values, not original stdout serialization. The invocation ledger's raw stdout formatting hashes therefore cannot be reconstructed from those reserialized JSON files alone; 58 execution reports do retain verbatim stdout. Artifact hashes, source references, identities and values were independently validated. This is local transport/data evidence, not native provider telemetry. Evidence: local `fetch.py:16`, `rerun.py:26`, request/transport/invocation ledgers and `rerun-audit.md`.

## Verification and use

Sequential gates passed for implementation `6b7ff7e`: typecheck, lint, complete coverage suite (**2,100 tests in 109 files**), build/smoke and tracked-bundle verification. Line coverage was core 99.39%, runner 95.05%, Action 100% and CLI 91.21%; all configured thresholds passed. The independent implementation review found F1 (contradictory run snapshots), confirmed two failing regressions, and approved the repair. The simplify reuse/quality/efficiency passes made no changes. Independent rerun audit verified all freezes, 60 cases, 36 questions, 45 actual inbox numeric pairs, 63 citations, request provenance and all summary arithmetic. Detailed receipts remain local; see [phase notes](../plans/2026-10-29-advisory-source-navigation-notes.md).

The [runbook](../runbooks/advisory.md#browse-workflow-declarations) documents both commands and recovery. With this checkout's retained pilot data, this command performs local source inspection without inference:

```bash
node packages/cli/dist/bin.js advisory ask-source \
  --input docs/agents/source-navigation-2026-10-29/source/real-cc-rpi-121512012018 \
  --question 'Where is dependency installation declared?' --format markdown
```

Local integration and owned-worktree preservation/cleanup are recorded in the phase notes and final local state record. The completed raw evidence manifest binds outputs, audits, the measured CLI and curated report hashes; `python3 docs/agents/source-navigation-2026-10-29/freeze.py --verify` verifies it without rewriting measured artifacts. Re-running the measured collector writes new timestamps and requires a separate output/evidence identity. No push or native model experiment is part of this follow-up. Future work has a concrete baseline: source availability 11/60, relevant task matches 5/27, and explicit refusal/noise cases; model usefulness and human time savings remain separate unmeasured questions.
