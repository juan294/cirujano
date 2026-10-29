# Phase 3: Natural-language evidence search

Parent: [accepted contract](../2026-10-28-jev-advisory.md). Source baseline and authority are inherited from the parent; revalidate on entry.

## Scope and files

Add `advisory/{search,search-questions}.ts` and tests; extend prepare/service/arguments and result union. No agent execution framework or general shell tools. Operate only on retained bundles.

## Behavioral specification

Tokenized case-insensitive lexical retrieval with deterministic stable scoring is the baseline. Up to 20 bounded evidence candidates, deduplicated by digest/reference, then optional retained Jev result ranks them. Query lives in exact request hash and undergoes projection validation. Supported intents are find-install, find-build, find-tests, find-cache-evidence and generic-evidence-search; numbers and filters are computed in code. No parsed intent executes a command or creates spend. Use independent existence Noul, per-candidate relevance Nouls, and Choice over supplied IDs; probability alone cannot invent evidence or citations. Rank by Choice probabilities, display semantic hits only when existence and candidate relevance both reach 0.8; 0.2–0.8 values are uncertain, existence <=0.2 is no-match, and never fill a top-three list with unsupported hits. No relevant lexical candidate gives no-match; optional semantic search can prepare a bounded set from supplied bundles but does not fetch arbitrary remote data.

All output is evidence cards and deterministic sentences, not generated answers. A request to delete checks or change routing produces advisory-only scope guidance. `ask` without matching enrichment is an honest lexical result; wrong query/input/version result is rejected with an omit-enrichment/reprepare action.

```text
@ searchEvidence(bundles, query, retainedResult) -> SearchReportV1
ctx: local immutable evidence
pre: bounded validated query and bundles
do:
  1. compute deterministic candidate shortlist
  2. validate retained semantic result against exact request identity
  3. compute supported ranks or explicit uncertain/no-match outcome
  4. emit selected verbatim excerpts and pinned references
fail: stale enrichment -> explain mismatch and local-only path
```

## Oracles

`search.test.ts`: install paraphrase, mixed intent, negative/no evidence, misleading names, duplicate snippets, option permutation and injected instructions; exact candidate IDs only. `service.test.ts`: ask performs zero network calls; prepare does not spend; enrich performs one authorized call; following ask uses matching receipt. Assert changing query invalidates semantic result, no-match suppresses forced Choice and uncertainty is visible. Snapshot three concise user-facing examples in `fixtures/advisory/search/`.

## Work units

Search/retrieval and its private fixtures [batch-eligible]; search question/response mapping and distinct fixtures [batch-eligible], after existing phase-2 contracts are frozen. Integrator owns grammar, service and shared snapshots. Sequential integration and acceptance.

## Verification and acceptance

Run the main plan's full sequential local gates after review, repair and simplify; retain exact commit/tree and outcomes. No hosted runs, provider inference or publication occurs implicitly. Stop for phase acceptance. Manual criterion: optional owner inspection of the generated fixture report for clarity; all correctness/recovery criteria are automated. Proposed test/artifact paths below must be created in this phase, not treated as existing evidence.

## Implementation acceptance — 2026-10-28

- [x] Private/local lexical search and bounded public/synthetic semantic preparation.
- [x] Exact retained identity, independent existence/relevance gates, inert pinned excerpts and zero implicit sends.
- [x] Independent review P3-R1–P3-R7 resolved; simplify complete; three actual CLI examples checked.
- [x] Full sequential local gates passed, 1,992 passing tests across all packages.

Exact candidate/check identity and dispositions are in [implementation notes](../2026-10-28-jev-advisory-notes.md). Native semantic qualification remains UNMEASURED. Owner authorized continuation to phase 4.
