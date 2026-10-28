# Jev advisory features implementation plan

Date: 2026-10-28. Repository `/Users/juan/code/cirujano`; integration branch `develop`; baseline `37e7e33a0ba15d24eaa6433e9a4fa7f00613fb1f`. Status: reviewed local implementation specification; implementation has not started. The owner confirmed all five phases during planning. Each phase still ends at its acceptance gate unless continuation is explicitly authorized.

## Objective and accepted scope

Deliver a useful rules-only opportunity inbox, optional Jev enrichment, evidence search and regression investigation. Demonstrate incremental usefulness against simpler alternatives before recommending semantic mode for routine use. Preserve exact numerical evidence and existing optimization authority. Accepted inputs: [research](../research/2026-10-28-jev-capabilities-and-cirujano.md) and [assessment](../research/2026-10-28-jev-fit-assessment.md), both read and revalidated against unchanged HEAD. Those two untracked research documents were the only initial working-tree changes and must be preserved.

Scope decisions A1/A2: implement inbox and evidence navigator. A3: evaluate numerical decision alternatives offline/shadow only; do not replace diagnosis. A4: add source and step evidence before regression hypotheses. A5: keep proof, billing, runner lifecycle and authorization deterministic; CI routing belongs exclusively to Sutura. A6: no images, learned feature loops, autonomous memory, new patch families, new hosted UI or automatic publication.

## Options and selected design

1. Replace Nemotron: rejected for this plan; existing permits, receipts and journal replay enforce Nebius identity (`packages/cli/src/optimization/nebius.ts:25`, `packages/core/src/optimization/contracts.ts:116`, `packages/cli/src/optimization/diagnosis-journal.ts:35`). Numerical decisions may be better served by rules.
2. Enrich telemetry in place: rejected; changes persistence and broad consumers unnecessarily. Existing telemetry discards step and source details (`packages/cli/src/telemetry-service.ts:117`, `packages/cli/src/telemetry-service.ts:136`).
3. **Selected: separate CLI advisory module and versioned sidecar evidence.** Rules-only behavior works without TypeSafe. Existing telemetry and optimizer readers remain unchanged. Use native Node fetch for a small typed HTTP adapter: exact endpoint, zero retries and bounded IO, avoiding SDK defaults/dependency changes. Current runtime already supports fetch; existing transport provides the pattern (`packages/cli/src/optimization/nebius.ts:80`).

All new product logic lives in `packages/cli/src/advisory/`; reuse core hash/arithmetic/parser exports without changing them. Add argument dispatch in `args.ts` and append an optional injected advisory service to `runCli`, preserving existing positional arguments (`packages/cli/src/args.ts:173`, `packages/cli/src/cli.ts:34`). No shared telemetry schema migration or core bundle edits are planned. Default advisory service creation is lazy: help and unrelated commands neither validate TypeSafe credentials nor open network connections.

## Product commands and output contract

New namespace `cirujano advisory`:

- `collect --repository owner/name --run ID --attempt N --workflow PATH --job-key KEY --job-id ID --output DIR [--source-file PATH ...]`: bounded GitHub GETs for one selected job/run, workflow and explicitly selected source files at the verified SHA; no inference, source execution or automatic log download.
- `inbox --input DIR ... [--enrichment DIR ...] [--format json|markdown] [--sort duration|minutes]`: local ranking and evidence cards; default duration descending, stable identity tie-break. No network.
- `prepare --input DIR ... --task labels|search|compare [--question TEXT] --output DIR`: writes the exact sanitized inference body, preview and cost reservation; no network. Search uses at most 20 candidate excerpts; compare takes exactly two cohort manifests through `--baseline FILE --candidate FILE` rather than input directories.
- `enrich --request DIR --permit FILE --output DIR`: one explicit Jev POST; consumes single-use permission. Does not invoke optimizer or other provider.
- `ask --input DIR ... --question TEXT [--enrichment DIR] [--format json|markdown]`: local lexical retrieval by default; matching retained Jev search result optionally reranks. Never sends a query implicitly.
- `compare --baseline FILE --candidate FILE [--enrichment DIR] [--format json|markdown]`: exact cohort arithmetic and bounded evidence hypotheses; never declares causality or measured optimization success.
- `status --operation DIR [--format json|text]`: validates local evidence/receipt/intent; never sends requests or repairs remote state.

Parser rejects duplicate scalar options, unknown flags, unsafe paths, nonpositive IDs and action-incompatible arguments. Default format is markdown except status text. JSON uses `schemaVersion:1`, `status`, `reasonCodes`, `limitations`, `nextActions` and typed payload. Exit 0 means a valid complete, partial, no-match or uncertain advisory report; exit 1 means invalid evidence or requested enrichment unavailable/failed/unknown; exit 2 means usage error. Empty valid input inventory renders no opportunities with an explanation. Existing CLI outputs remain unchanged.

## Evidence and inference contracts

`EvidenceBundleV1`: repository ID and local name/visibility, run ID/attempt/head SHA/event, workflow path/blob SHA, selected job ID/key/name/labels/conclusion/timing, ordered step number/name/timing/conclusion, source excerpts with blob hash/path/line range, fetchedAt, tool source SHA and content digest. Every optional datum carries present/missing/ambiguous status; null is never zero. No credentials or environment values. Maximum 20 bundles per invocation, 20 source files per bundle, 256 KiB per source and 2 MiB total source; at most 200 steps. Reject oversize rather than silently truncate evidence. Safe snippets select line ranges explicitly and preserve source references. Source commands are data only. Retain API version `2022-11-28` for the new JSON adapter and record it in each bundle; do not silently upgrade existing readers. Check run and job head SHA agree. For workflow_dispatch, unresolved workflow-version semantics produce partial evidence rather than an executed-source claim.

Collector requires exact repository/run/attempt/workflow path identity and reads source at the verified head SHA. Initially accept push and workflow_dispatch runs with literal workflow job key and unambiguous matching job name; PR/merge-group/reusable/matrix mapping that cannot establish executed-source identity is `unsupported-mapping`, with metadata-only evidence. Do not label source as executed when it is merely a candidate. Compare only compatible supported bundles. Executed-step mapping requires a unique ordered match of literal workflow step names after excluding known synthetic setup/post-action steps; duplicate names, expressions, composite/reusable expansion or inconsistent ordering remain unmapped. Never use an API step number as a workflow array index. Only mapped steps may receive command-derived timing shares. Immutable files use a verified Git blob SHA and path lookup at the exact commit; no recursive repository checkout. Existing bounded JSON GET helper forbids logs (`packages/cli/src/optimization/github-read.ts:35`); retain that restriction.

`AdvisoryResultV1`: input digests, rules/question/policy versions, observed metrics, evidence references, optional independent semantic labels, support probabilities, uncertainty and next actions. It is neither an optimization diagnosis nor proof. Code derives numbers using existing billable-minute functions (`packages/core/src/billing.ts:40`); known public hosted cost remains zero, unknown pricing remains unknown. Ranking by duration/minutes does not claim dollars saved. Initial rules: classify exact known install/build/test commands; flag install share >=20% and >=30 seconds as investigation-worthy; flag byte-identical repeated commands as repeated-command observations, not redundant work. Unknown commands remain unclassified. Steps cannot be summed as total job duration without validating non-overlap; use selected step duration divided by job duration only where bounded and consistent.

`PreparedRequestV1`: exact outbound UTF-8 body/hash/bytes, input digests, task, model `jev-1.14.0`, question-set version, policy version, sanitized local-ID-to-source mapping retained locally, quoted price basis and estimated reservation. Outbound fields are allowlisted task text, pseudonymous excerpt IDs and necessary snippets/measurements; omit repository names, URLs, absolute paths, environment, credentials and account identifiers. Reject detected secret shapes in keys and values, require payload review authorization, and do not claim regex redaction proves confidentiality. Initial remote scope is public or explicitly synthetic evidence only; private evidence remains usable locally but returns `private-inference-disabled` for preparation. An explicit data-scope expansion requires a later plan.

`AdvisoryPermitV1`: kind `jev-advisory-permit`, permitId, exact request hash, model, fixed endpoint `https://api.typesafe.ai/v1/systemone`, expiry, maxRequests=1, maxRequestBytes, approved estimated spend allowance and price source/date. A permit is owner authorization, not something the model or prepare command silently grants. Preview prints the exact file and a concrete authorization template; the agent completes approved operations without asking the user to perform routine setup. Display a conservative local estimate from body bytes and the dated quote, explicitly not a proven bound on provider token accounting or charges; initial max body 32 KiB, response 256 KiB, 15-second total deadline, redirects rejected. No aliases, images or long-context headers. Refresh primary-source model/schema/price evidence before first live probe; account availability is not assumed.

Receipt records request/response hashes, returned model, latency, nullable token usage/cost, completion state and validated answers; no fabricated chat completion fields. Verify exact question IDs, finite probabilities in [0,1], Choice probability keys/sum and selected option, and required output shape from the pinned API. Null usage means cost unavailable, not free. Label probabilities >=0.8 display supported, <=0.2 absent, otherwise uncertain; thresholds are versioned advisory display policy. For search rank candidate IDs by Choice probability, but require answer-exists >=0.8 and a separate per-candidate relevance Noul >=0.8 before displaying a semantic hit. Intermediate existence/relevance values yield uncertain evidence, not an answered result; existence <=0.2 yields no-match. A high Choice probability by itself never establishes relevance. Do not use confidence as authorization.

No automatic fallback provider, retry, workflow edit, issue, PR or runner call. Failed enrichment retains local rules-only access. Completed results are reusable only for identical task, input digests, request body, model and versions; no time-based stale-result reuse. An old completed result never grants authority to send again.

## Sequential phases

| Phase | Deliverable | Entry condition |
| --- | --- | --- |
| [1](2026-10-28-jev-advisory-phases/phase-1.md) | Evidence sidecar and rules-only inbox | Accepted plan and isolated local worktree |
| [2](2026-10-28-jev-advisory-phases/phase-2.md) | Prepared requests, single-use Jev enrichment and recovery | Accepted phase 1 |
| [3](2026-10-28-jev-advisory-phases/phase-3.md) | Local evidence search with optional semantic reranking | Accepted phase 2 |
| [4](2026-10-28-jev-advisory-phases/phase-4.md) | Comparable-cohort regression investigation | Accepted phase 3 |
| [5](2026-10-28-jev-advisory-phases/phase-5.md) | Comparative evaluation and developer documentation | Accepted phase 4 |

No parallel phase execution. Each phase specifies disjoint optional work units; one integration owner owns shared dispatch/tests and merges locally. No branch push/PR. Follow implement → independent review → repair → simplify → verify; read the applicable implementation skill on entry.

## Stuck states and recovery

All states appear in both machine output and human reports with concrete file/command actions; never print credentials or provider bodies. `recovery.test.ts` is a table-driven behavioral oracle asserting both refusal and the visible exit path.

| State | User sees | Exit path and required proof |
| --- | --- | --- |
| Invalid/missing/oversized input or path/symlink | Exact safe reason and affected input | Correct input or select a fresh dedicated directory; test corrected input succeeds |
| Existing output/active lock | Inspect-existing or wait-for-active-process message | Status command; fresh output permitted; never steal live lock; test no overwrite and fresh path succeeds |
| Incomplete run/step/source or unsupported mapping | Partial card, missing fields, no semantic/causal claim | Recollect completed exact attempt or choose supported run/job; test missing→complete transition |
| Auth/network/404/rate limit on GitHub GET | Read unavailable with collection command and failed stage | Restore access or select available evidence, rerun collection into fresh output; test deterministic report still works on prior bundle |
| Unknown/contradictory measurements | Explicit unavailable metric and reason | Correct evidence or select compatible bundle; test no conversion to zero |
| Private/secret-bearing payload | Inference disabled with local-only command | Use public/synthetic reviewed input; test no POST and local inbox remains usable |
| No permit/expired/mismatched permit or missing key | Prepared request path, exact authorization/key requirement | Owner-authorized fresh matching permit/key; test zero sends then exactly one send |
| Already consumed permit | Single-use authority exhausted | Inspect status; fresh explicit permit/request operation required; test same permit never resends |
| 429/529/HTTP error or malformed/model-mismatched response | Enrichment unavailable; HTTP category only | Rules-only command; later separately authorized fresh attempt; test no implicit retry |
| Timeout/disconnect/crash after intent | Outcome unknown, possible charge, retained intent | Status discloses uncertainty; no replay; new attempt needs new authority; crash-injection test |
| Missing final artifact after successful response | Incomplete result/unknown | Never infer success; retain journal and use rules-only view; test restart remains explicit |
| Mutated/stale request, result, source or versions | Digest mismatch; result ignored/rejected | Prepare fresh request or omit enrichment; test old result cannot attach to new inputs |
| Low probability/no relevant evidence | Uncertain/no-match with candidate excerpts | Narrow query or collect evidence; test no forced Choice answer |
| Incompatible/too-small cohort | Comparison unavailable, required cohort fields/count | Select compatible completed runs; test corrected cohort produces arithmetic |
| Live evaluation not authorized or quality gate fails | UNMEASURED or NOT QUALIFIED with reasons | Keep semantic mode opt-in; prepare bounded benchmark or improve using training split; test no activation from replay |

## Verification and acceptance policy

Each phase adds failing behavioral tests first and uses real owned parsers/stores with injected external transports/clock only. Required local gates, sequentially with recorded individual exits: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:coverage`, `pnpm run verify:bundle`. Coverage runs the complete tests; do not duplicate test runs merely for ceremony. Existing thresholds in `vitest.config.ts:7` remain. Rebuild tracked Action/harness bundles if any core/action source changes become necessary; this plan intends no such changes. Read workflow requirements before implementation and add applicable native checks only if affected. A preexisting failed gate remains an explicit acceptance blocker until repaired or an owner disposition is recorded; no green claim from inspection.

Document-only plan validation: links/source references, all phase files, no unresolved markers, complete review and `git diff --check`. No runtime tests were run in planning. Product usability is validated with CLI fixture output and end-to-end local command tests; optional owner review of a report is not a substitute for automation. Native Jev accuracy/latency requires separately authorized live inference; deterministic tests/replays cannot certify that gate.

## Durable handoff and authorization

Independent planning review is required before final presentation; corrections are recorded below with the consumer sweep. Worktree remains `/Users/juan/code/cirujano`, source unchanged at the stated baseline. Research documents and this plan are curated local artifacts; no remote publication. Next step is an explicitly invoked implementation phase in an isolated worktree, revalidating source/dirty state and accepted artifacts. No live provider budget has been granted. Phase 5 specifies a bounded benchmark request, not permission to spend. Local implementation can proceed once authorized without changing hosted settings; phase completion does not authorize push, deploy, billable runner or live inference. Current console availability and Jev benefit remain UNAVAILABLE/UNMEASURED, respectively.

## Consumer sweep

The following inventory was obtained by read-only planning investigations. CLI integration is phase 1; existing regression preservation is required in every phase and finally phase 5. All existing telemetry writers/readers retain their formats. New sidecar writers/readers are enumerated after the existing consumers.


Commands executed:

```sh
rg -n --glob '!pnpm-lock.yaml' --glob '!packages/action/dist/**' --glob '!scripts/optimization/push-guard-harness.mjs' 'TelemetrySnapshot|TelemetryReport|collectTelemetry|writeTelemetrySnapshot|aggregateTelemetry|buildStoreReport|readLatestSnapshot|readSnapshots|renderTelemetryMarkdown|renderFleetSavingsMarkdown' packages scripts
rg -l --hidden --glob '!.git/**' --glob '!node_modules/**' --glob '!**/node_modules/**' --glob '!.rpi/baselines/**' --glob '!docs/**' --glob '!packages/action/dist/**' --glob '!scripts/optimization/push-guard-harness.mjs' 'TelemetrySnapshot|TelemetryReport|collectTelemetry|writeTelemetrySnapshot|aggregateTelemetry|buildStoreReport|readLatestSnapshot|readSnapshots|renderTelemetryMarkdown|renderFleetSavingsMarkdown|telemetry-snapshot.fixture|telemetry-report.expected|backfill-' .
rg -n 'telemetry|snapshot' scripts packages/cli/scripts packages/cli/README.md README.md
rg -l 'parseArguments|runCli|ParsedArguments|TelemetryArguments' packages scripts --glob '!packages/action/dist/**' --glob '!scripts/optimization/push-guard-harness.mjs'
```

Source/consumer dispositions (proposed phases: CLI/additive integration; regression preservation; excluded unchanged):

- `packages/cli/src/args.ts:173,179,225`: CLI integration; preserve existing telemetry grammar and union members.
- `packages/cli/src/cli.ts:34,53`: CLI integration; append service injection, add dispatch and sanitized advisory runtime error mapping.
- `packages/cli/src/bin.ts:5`: unchanged entry-point consumer; CLI smoke coverage.
- `packages/cli/src/telemetry.ts:106,200,225,369,380,605,719`: unchanged types, sole production daily snapshot writer, aggregation/renderers. Regression preservation; sidecar MUST NOT call writeTelemetrySnapshot.
- `packages/cli/src/telemetry-store.ts:28,68,83,87,104,183`: unchanged validated readers/report builder; advisory may consume readSnapshots but cannot relax validators or coverage checks. New advisory filenames never enter daily/backfill matcher at line 88.
- `packages/cli/src/telemetry-service.ts:50,51,57,68,73`: unchanged writer/reader command orchestration; regression preservation.
- `packages/cli/src/fleet-service.ts:563,564`: unchanged report consumer/local public report writer; regression preservation.
- `packages/cli/src/fleet-registry.ts:5,215`: imports rates/SKU helpers and analogous atomic writer, not semantic data; excluded unchanged.
- `packages/cli/src/telemetry.test.ts:50,190,282,351,383`: synthetic snapshot writers/builders and roundtrip tests; regression preservation.
- `packages/cli/src/telemetry-service.test.ts:14,19,212,213,291,319,348,363,367,375,399,407`: direct daily/backfill fixture writers and parser tests; unchanged, retain invalid-input cases.
- `packages/cli/src/telemetry-enrollments.test.ts:19,58,196`: fixture loader, aggregation consumer, pinned JSON/Markdown byte equality; unchanged.
- `packages/cli/src/fleet-service.test.ts:625,626`: snapshot fixture copied to dated store; unchanged.
- `packages/cli/fixtures/telemetry-snapshot.fixture.json:1`, `telemetry-report.expected.json:1`, `telemetry-report.expected.md:1`: unchanged fixtures, not expanded with advisory fields. New synthetic fixtures live under advisory.
- `scripts/collect-actions-telemetry.sh:65,69,78`: existing scheduled CLI callers/writers of derived report files; excluded from advisory activation. Do not make scheduled jobs invoke Jev by default.
- `scripts/install-telemetry-agent.sh:89` and `scripts/launchd/com.thecreativetoken.cirujano-telemetry.plist.in:6`: installation check and invocation scheduling; unchanged, no reinstall during local implementation.
- `packages/cli/src/telemetry-scheduler.test.ts:21,30,41,138,146,182,243`: wrapper/installer consumers and mock writer harness; unchanged regression preservation.
- `packages/cli/src/args.test.ts:65,139` and `packages/cli/src/cli.test.ts:1`: extend CLI integration tests while retaining all old assertions.
- `packages/cli/src/runner-service.test.ts:155`, `packages/cli/src/fleet-service.test.ts:1`, `packages/cli/src/optimization/dispatch.test.ts:8`, `packages/cli/src/optimization/arguments.test.ts:6`: existing parse/dispatch consumers, excluded behavior change; full CLI regression gate.
- `packages/cli/scripts/bundle.mjs:20`: bundles CLI entry automatically. No new entry point needed; note current bundle script also rebuilds committed push harness at line 17, so implementation must inspect resulting diff and preserve exact unchanged harness when no source change.
- `packages/cli/package.json:41,45`: build and help/version smoke include new surface; use normal gates.
- `packages/action/src/main.ts:19,21`: billing-only Action excluded; no new credential requirement or model dependency there.

The symbol sweep excludes immutable historical baselines, generated bundles, dependencies and prose. A separate shell/README search covered indirect CLI callers. No repository script writing additional telemetry snapshots was found; test helpers above do. This is repository source scope, not an inventory of external installed launchd copies.


### Private store and permit helper consumers


Commands:
`rg -l 'withOperationStore|consumePermit|scrubOptimizationValue|readPrivateJson|readPrivateText' packages scripts --glob '!**/dist/**' --glob '!**/push-guard-harness.mjs'`
`rg -l 'consumePermit' packages scripts --glob '!**/dist/**' --glob '!**/push-guard-harness.mjs'`
`rg -l 'withOperationStore' packages scripts --glob '!**/dist/**' --glob '!**/push-guard-harness.mjs'`

Found union (all excluded from format changes; reuse behavior unchanged; existing tests remain regression coverage): `scripts/optimization/evaluate.mjs`; under `packages/cli/src/optimization/`: store.ts, store.test.ts, service.ts, service.test.ts, service-push.test.ts, propose.ts, propose.test.ts, push-propose.ts, push-propose.test.ts, diagnosis-journal.ts, input-context.ts, push-context.ts, verify.ts, verify.test.ts, verify.test-helper.ts, push-verify.ts, push-verify.test.ts, push-verify.test-helper.ts, measure.ts, measure.test.ts, push-measure.ts, push-measure.test.ts, push-measure.test-helper.ts, report-service.ts, push-report-service.ts, publish.ts, publish-lifecycle.test.ts.

`consumePermit` direct consumers specifically: service.ts, verify.ts, push-verify.ts, publish.ts, store.test.ts and scripts/optimization/evaluate.mjs. `withOperationStore` direct consumers specifically: service.ts, service.test.ts, propose.ts, push-propose.ts, verify.ts, push-verify.ts, measure.ts, push-measure.ts, report-service.ts, push-report-service.ts, publish.ts, store.test.ts. New advisory service adds consumers only; no existing caller/writer format changes. If implementation unexpectedly changes helpers, re-open consumer review and expand regression evidence rather than silently broadening this plan. Generated bundles excluded from search are existing build outputs; follow repository bundle verification if shared core/runner changes unexpectedly occur (not planned).

### New sidecar consumers and writers

- Phase 1 `collect.ts` writes EvidenceBundleV1; `contracts.ts`, `rules.ts`, `render.ts`, `service.ts` read it; fixtures/tests write synthetic bundles.
- Phase 2 `prepare.ts` writes request/preview; `permit.ts` validates owner-provided permits; `enrich.ts` writes intent/receipt/result; `status` in service validates the chain; questions/projection consume evidence. Test helpers write malformed and crash-state artifacts.
- Phase 3 `search.ts` consumes evidence and matching search results; `search-questions.ts` feeds prepare; search fixtures supply exact labels and candidates.
- Phase 4 `compare.ts` reads cohort manifests/bundles; compare question projection consumes comparable evidence; CLI tests/fixtures write cohorts.
- Phase 5 evaluator reads immutable evidence and provider receipts, writes private evaluation reports; public fixture generator writes only synthetic data. Runbook examples are generated from those fixtures.

No E2E helper or scheduled script writes the new format before implementation. Add every new consumer to this list if implementation changes the graph. Generated CLI bundles are rebuilt by existing build; inspect any committed push harness diff even when no core changes were intended.

## Planning review disposition

Independent reviewer inspected the parent and all five phases. Resolved before final presentation: use CLI subprocess evaluation instead of nonexistent built-module exports; define per-candidate semantic relevance; define a separate search holdout and ceiling-aware baseline gate; scope zero charges to public GitHub-hosted execution; require explicit executed-step/source correspondence; fix one per-user permit ledger and cross-directory replay test. Budget estimates are expressly not provider billing guarantees. Consumer investigations completed and incorporated; no required reviewer result remains missing. Remaining live account/quality uncertainty is an explicit execution gate, not an unresolved design choice. Plan artifacts passed link/phase/reference checks and whitespace validation; implementation and native inference remain unexecuted.
