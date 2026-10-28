# Phase 2: Bounded Jev enrichment

Parent: [accepted contract](../2026-10-28-jev-advisory.md). Source baseline and authority are inherited from the parent; revalidate on entry.

## Scope and files

Add `advisory/{questions,projection,prepare,permit,jev,enrich,recovery}.ts` and tests; extend contracts/arguments/service/status. No SDK or dependency changes. Existing optimizer receipts remain valid and unchanged. Read live API schema before implementing validators and pin observed model/schema identity in test fixtures.

## Behavioral specification

Label question set has separate Nouls for dependency install, application compilation, tests, artifact transfer and explicit cache-miss evidence per selected excerpt. Labels may coexist. Batch maximum 20 excerpts; respect 32 KiB complete request bound and split only through separately prepared explicit requests, never hidden paid fan-out. Keep question text/criteria and thresholds in `questions.ts`. Projection uses pseudonymous keys, strips repository identity/URLs and checks keys and values for known credentials; raw snippets are still subject to exact-payload authorization. Private input preparation is disabled. Preview and result maps retain exact local source correspondence.

Write prepared body and preview with 0600 permissions. Reuse existing `consumePermit` with `kind: inference` and namespaced advisory permit digest in one fixed per-user ledger at `~/.local/share/cirujano/advisory/permits` across all output directories (override injectable only in tests); preserve helper semantics. Intent is durable before POST, maxRequests=1. Native fetch supplies bearer key only to the fixed API endpoint, rejects redirects, bounds decoded response and total deadline. No credential/body logging. Known HTTP failure and invalid output are unavailable; post-send transport uncertainty and incomplete intent are outcome-unknown. Status reconstructs hashes/versions; it never replays. No synthetic model response is represented as live.

```text
@ enrich(prepared, permit) -> AdvisoryReceiptV1
ctx: private journal and fixed-origin HTTP POST
pre: exact payload authorization and public/synthetic reviewed projection
do:
  1. validate hashes, expiry, budget and credentials
  2. write single-use reservation and durable intent
  3. emit one bounded request and validate typed answers
  4. write receipt and semantic result bound to exact input
br: uncertain probabilities -> uncertain labels
fail: post-send ambiguity -> outcome-unknown with local-only recovery
```

## Oracles

`projection.test.ts`: secret in key/value, URL, private identifier, hostile text and oversized body rejected/removed before hash; private evidence causes zero sends. `permit.test.ts`: expiry/digest/model/budget/duplicate permit refusal across different output directories plus corrected-permit recovery. `jev.test.ts`: captured exact body/schema; bounded stream, redirect, malformed probability, wrong IDs/model, 401/429/529, null usage and deadline all retain explicit states. `recovery.test.ts`: crash before/after intent and response, restart, output collision and lock; no replay; rendered recovery action actually reaches local inbox or fresh-request path. `enrich.test.ts`: valid injected response attaches labels without altering numerical metrics, unsupported status or original bundles. Tests prove no optimize/runner/publication call.

## Work units

Owner freezes contracts and command grammar. Projection/questions tests [batch-eligible] and transport validator tests [batch-eligible] have disjoint files. Integrator owns permit/store orchestration and cross-module recovery tests. Live provider smoke is a later separately authorized gate; local mock coverage alone is explicitly PARTIAL for native integration.

## Verification and acceptance

Run the main plan's full sequential local gates after review, repair and simplify; retain exact commit/tree and outcomes. No hosted runs, provider inference or publication occurs implicitly. Stop for phase acceptance. Manual criterion: optional owner inspection of the generated fixture report for clarity; all correctness/recovery criteria are automated. Proposed test/artifact paths below must be created in this phase, not treated as existing evidence.

## Implementation acceptance — 2026-10-28

- [x] Sanitized exact prepared bodies, invalid authorization template and fixed single-use permit ledger.
- [x] Bounded one-shot transport, strict native schema validation, local result readback and crash recovery.
- [x] Independent review P2-R1–P2-R6 resolved; simplify complete.
- [x] Full applicable local gates pass, 1,964 passing tests across all packages.

Native provider qualification remains UNMEASURED; mock transport tests do not prove native quality/latency. Exact candidate, deviations and check history are in [implementation notes](../2026-10-28-jev-advisory-notes.md). Owner authorized continuation to phase 3.
