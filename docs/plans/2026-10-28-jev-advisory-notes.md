# Jev advisory implementation notes

Owner authorized all five sequential phases, local integration into `develop`, one completed integration push, and removal of the task worktree on 2026-10-28. No live inference or paid runner budget is granted. Base: `37e7e33a0ba15d24eaa6433e9a4fa7f00613fb1f`. Implementation branch: `feat/jev-advisory`; worktree: `/Users/juan/code/cirujano-jev-advisory`. Research and approved plans copied intact from the original checkout and will be preserved with implementation.

## Deviations

- Phase 1 source ranges: plan said explicit safe line ranges with immutable Git blob validation; found the approved collect grammar accepts source paths only, and validating retained attribution requires the complete original workflow. Chose explicit whole-file ranges for selected files, bounded by original byte limits, with exact Git blob validation and refusal of detected credential/literal environment data. Inference projection will select command excerpts separately. Why: preserves original source bytes and provenance without inventing an unapproved range grammar or relabeling a snippet hash as a Git blob.

- Phase 2 module organization: plan named a separate recovery module; found status recovery is the journal inspector itself. Kept recovery in `enrich.ts` and shared local IO in `storage.ts`, with separate `recovery.test.ts`. Shared provider types live in `inference-contracts.ts` to keep evidence contracts provider-independent. Behavior and phase acceptance remain unchanged; no empty forwarding module was added.

## Phase 1 accepted

TDD evidence: initial CLI grammar/rules/render RED and service RED are retained in ignored `docs/agents/jev-advisory/phase-1-*-red.log`; collector/contract RED captured before their production modules existed. Independent review findings P1-R1 through P1-R8 are being resolved before acceptance. Initial typecheck/lint passed. Initial coverage failed because compiled runner subprocess prerequisites were absent; bundle verification then passed. The next full run passed core (575 tests), runner (420 tests) and Action (6 tests), and 866/867 CLI tests. The sole CLI failure was an assertion expecting an unescaped path in escaped Markdown; corrected to assert the displayed path, with the five service tests passing. Corrected CLI full coverage passed: 867/867 tests; 85.92% statements, 80.85% branches, 93.61% functions, 91.63% lines. Core/runner/Action passing coverage is reused unchanged, making 1,868 passing tests across the complete gate. Typecheck/lint repair checks and bundle verification passed. No acceptance blocker remains. Both failed runs remain in raw evidence.

Independent reviewer approved implementation tree `ba5e510f6c660f4fe32e8e4aea3387ba7c2f4e67`; later changes only correct the test expectation and add generated synthetic fixtures/these notes. Finding dispositions:

| ID | Disposition and evidence |
| --- | --- |
| P1-R1 | Resolved: retained mapping is recomputed using the collector's strict literal-name/order mapping (`packages/cli/src/advisory/contracts.ts:98`). |
| P1-R2 | Resolved: every nullable datum has validated present/missing/ambiguous status (`packages/cli/src/advisory/contracts.ts:106`). |
| P1-R3 | Resolved: known public hosted labels have zero GitHub execution charge; self-hosted and unknown prices remain null (`packages/cli/src/advisory/rules.ts:36`). |
| P1-R4 | Resolved: real CLI collect→inbox→status, safe affected input/GET stage, lock/output/symlink refusal and fresh-directory recovery (`packages/cli/src/advisory/service.test.ts:44`, `packages/cli/src/advisory/service.ts:59`). |
| P1-R5 | Resolved: shared completeness derives from mapping, reasons and nullable timing/conclusions (`packages/cli/src/advisory/rules.ts:39`). |
| P1-R6 | Resolved: explicit whole-file ranges and immutable hash checks; conservative unsafe-source refusal plus visible recovery reason (`packages/cli/src/advisory/contracts.ts:49`, `packages/cli/src/advisory/service.ts:29`). Range interpretation recorded above. |
| P1-R7 | Resolved: separate canonical pinned attempt/job/source links; exact URL assertions (`packages/cli/src/advisory/render.ts:11`). |
| P1-R8 | Resolved: known install flags only; help/dry-run/lockfile-only commands unclassified (`packages/cli/src/advisory/rules.ts:13`). |

Simplify: reuse pass consolidated completeness in `evidenceStatus` for collect/status/inbox; quality pass kept explicit token allowlists and fixed recovery reasons; efficiency pass confirmed bounded inventories, identity deduplication and reused Git-tree reads. No broader refactor was justified. Scope: advisory sources and additive CLI dispatch only; all changed implementation inputs are covered by the final local gate. Existing Action and push-harness bundles were rebuilt and remain byte-identical.

Phase 1 tested source manifest: `sha256:f585057a8cfab0d5b0a70fbae46c9f62551e5e4a8bf2ce3819160a2c9e83beac` (all CLI source/test inputs); raw file manifest and individual logs remain under ignored `docs/agents/jev-advisory/`. Local base remains the stated baseline until this phase commit. Next: phase 2, exact prepared payloads, explicit owner permits, bounded transport and recovery. Live integration remains unmeasured; all tests use injected external transports.

## Phase 2 accepted

Entry commit: `d417d64` (accepted phase 1). Scope: exact public/synthetic prepared requests, owner-provided single-use permits, bounded Jev POST, retained results, local status and recovery. Projection/questions and transport were independent bounded assignments; the parent integrated permit/store/service logic. Both implementers returned scoped RED/GREEN/lint evidence; independent compliance review is separate.

Primary documentation refreshed on 2026-10-28: [HTTP API](https://docs.typesafe.ai/api/system-one), [models and pricing](https://docs.typesafe.ai/models), [Noul](https://docs.typesafe.ai/primitives/noul), [Choice](https://docs.typesafe.ai/primitives/choice), and OpenAPI 0.2.0 SHA256 `3ca93b6e6b9aa8d7820531b78c66ed7a9798b11e6e163ad96b140fb3d75fbcf4`. Synthetic fixtures record that provenance; they are not native responses. Required native usage fields are validated strictly: missing/null usage produces unavailable enrichment with null receipt usage/cost, never free inference. Completed receipt cost is derived from observed token usage and the dated public quote; it is not a provider invoice or hard billing cap.

The deliberate authorization template has `kind: jev-advisory-permit-template` and `payloadReviewed:false`; it cannot be consumed. Fixed-ledger identity is namespaced by permit ID, so editing metadata or changing output directory cannot renew it. Keys are validated before reserving permission. Original telemetry/optimizer/runner formats and numerical metrics remain unchanged.

Independent reviewer approved staged tree `1cfe70f71f6f46b307057dc768256b930a9477c7`. Review dispositions:

| ID | Disposition and evidence |
| --- | --- |
| P2-R1 | Resolved: hash and validate the same retained response bytes; no second response-file read for decoded answers (`packages/cli/src/advisory/enrich.ts:72`). |
| P2-R2 | Resolved: one shared key preflight before authority reservation and transport; oversized-key refusal followed by corrected-key use of the same permit (`packages/cli/src/advisory/enrich.test.ts:29`). |
| P2-R3 | Resolved: exact shell-quoted local inbox recovery reads retained snapshots; crash tests execute the real CLI fallback and refuse cross-directory resend (`packages/cli/src/advisory/recovery.test.ts:13`). Missing key/permit reports include exact safe paths and authorization requirements (`packages/cli/src/advisory/service.ts:91`). |
| P2-R4 | Resolved: Markdown semantic observations carry probability/support and exact pinned selected-source links (`packages/cli/src/advisory/render.ts:17`). |
| P2-R5 | Resolved: evidence and projection share conservative raw credential-assignment refusal including camelCase fields, with failing then corrected-input tests (`packages/cli/src/advisory/contracts.ts:48`, `packages/cli/src/advisory/projection.test.ts:29`). |

Simplify: reuse pass consolidated key validation, raw credential detection and retained-bundle loading; quality pass checked refusal/uncertainty distinctions and exact permit/request/intent/receipt/result bindings; efficiency pass removed the duplicate response read. No wider rewrite was needed. Initial full gate passed: all 1,963 tests across four packages; CLI coverage 86.24% statements, 81.23% branches, 93.64% functions, 92.12% lines, with typecheck/lint/bundle passing. A final reporting refinement P2-R6 was then independently approved at tree `11283384cb308209774444c0ea7ab96b493c9f95`; 163 scoped advisory tests pass. Affected CLI checks/coverage/bundle passed, with unchanged core/runner/Action evidence retained. Final accepted aggregate: 1,964 passing tests; CLI 963/963, coverage 86.24% statements, 81.23% branches, 93.64% functions and 92.12% lines. All P2-R1–R6 are resolved; no local acceptance blocker remains. No live provider calls or provider credentials were used by the agent.

P2-R6 resolved: central report construction adds explicit possible-charge/no-replay wording to every actual outcome-unknown state (`packages/cli/src/advisory/rules.ts:8`). A failing disconnect-receipt regression preceded the repair; its GREEN check also opens the real CLI inbox on retained operation snapshots (`packages/cli/src/advisory/enrich.test.ts:34`). The earlier missing-intent-specific duplicate sentence was removed during simplify. This change invalidated only CLI checks/bundle inputs; no other package source changed.

Phase 2 tested source manifest: `sha256:cb867a15ab6c6d22f56229c2f8f10768dc1209a45113fcafdc5dc36835f0dbbc`; branch/worktree remain as above. Final tests cover the exact implementation inputs, with only these curated acceptance notes changing afterward. Next entry: phase 3 local lexical search and explicitly prepared/retained semantic reranking; no implicit query transmission or new spend authority.

## Phase 3 accepted

Entry commit `8a7c4f4`; same isolated branch/worktree. Implemented local lexical search and explicit prepared/retained Jev reranking, with no network from `ask`. The graph generation predates advisory code, so the phase's Graphify query was insufficient and source reads supplied the dependency evidence. Local private evidence remains usable; remote projection retains the public/synthetic boundary. Search bodies include separate existence/relevance Nouls and exact-ID Choice; Choice alone never creates a supported hit. Unsupported action requests receive Sutura/advisory scope guidance. Selected output cards retain metrics and references without duplicating entire source inventories.

Independent reviewer approved staged tree `8beca1ef8bdaae6b5a37bdf651d74fa53c8fb563`. All 191 advisory tests pass; complete/no-match/scope JSON and Markdown examples were generated by the actual built CLI and are checked against real `runCli` output. Full sequential gates passed: typecheck, lint, all 1,992 tests and existing coverage thresholds, and bundle verification. CLI 991/991 tests; coverage 86.44% statements, 81.39% branches, 93.77% functions and 92.23% lines. No local acceptance blocker remains.

| ID | Disposition and evidence |
| --- | --- |
| P3-R1 | Resolved: safe search reason codes, correct affected enrichment path, exact quoted omit-enrichment `ask` and fresh `prepare` commands (`packages/cli/src/advisory/service.ts:66`, `packages/cli/src/advisory/service.ts:103`). |
| P3-R2 | Resolved: a supplied retained result cannot silently attach to a changed action-scope query (`packages/cli/src/advisory/search.ts:25`). |
| P3-R3 | Resolved: source line breaks/tabs are preserved inside inert fences longer than any supplied delimiter; terminal controls are visibly escaped (`packages/cli/src/advisory/render.ts:24`). |
| P3-R4 | Resolved: three real local CLI snapshots and automated readback under `packages/cli/fixtures/advisory/search/`, exercised by `packages/cli/src/advisory/search-examples.test.ts:6`. |
| P3-R5 | Resolved: known secret-bearing local queries are refused before output or enrichment reads; actual CLI refusal does not echo the canary and corrected query succeeds (`packages/cli/src/advisory/search-candidates.ts:8`, `packages/cli/src/advisory/service.ts:64`). |
| P3-R6 | Resolved: label projection retains its per-excerpt repository sanitization, preserving phase-2 payload bytes when an unrelated repository name matches a command token (`packages/cli/src/advisory/projection.ts:59`). |
| P3-R7 | Resolved: search rendering explicitly identifies job duration, preventing confusion with the cited step's duration (`packages/cli/src/advisory/render.ts:33`). |

Simplify: reuse pass split local candidate enumeration from remote projection without broadening transmission authority; quality pass preserved exact retained identity and inert verbatim display; efficiency pass memoized lightweight card metadata and reduced delimiter scans without spreading a large argument list. No numerical/proof/authorization formats changed. No live requests or inferred usefulness claims. Next phase is comparable-cohort arithmetic and bounded regression hypotheses after the full local gate passes.

Phase 3 tested source manifest: `sha256:17b33f6595b13a1ab1fb8ca5ef6a1cfd39b7e71a6beb3978dd4179590adbe575`. Raw independent review/TDD/full-gate logs remain under ignored `docs/agents/jev-advisory/`; generated public examples are tracked. Owner-authorized continuation now enters phase 4; comparison must remain observational and cannot authorize optimization or establish causality.

## Phase 4 accepted

Entry commit `af10834`; same isolated branch/worktree. Cohort manifests bind repository/workflow/job/event/source/runner labels and exact sample IDs/digests to relative safe retained directories. Cohorts require independent completed successful supported executions, complete bounded timing and non-overlapping windows, baseline before candidate. The main plan's global 20-bundle invocation limit applies across both cohorts in addition to each cohort's 3–20 schema limit; the CLI reserves the other cohort's minimum three samples before loading. This is a conjunctive reading of the two existing bounds, not permission for 40 bundles.

Observed arithmetic uses per-job rounded minutes and exact medians. Zero baseline yields null relative change and an absolute-only observation. Category totals cover matched non-overlapping command steps only. Optional hypotheses retain independent probabilities, pinned source evidence, alternatives and missing facts; they cannot change arithmetic, declare causality, establish invoice savings or authorize an optimization. User-supplied log ingestion was optional and was not added; missing provider-verified logs remain visible.

Independent reviewer approved staged tree `7eca87bb14f9b1a456deb4634dd22c009f353f02`. All 224 advisory tests passed; typecheck/lint passed. The actual built CLI generated the regression JSON/Markdown fixture, checked by `packages/cli/src/advisory/comparison-examples.test.ts:5`. Full sequential gates passed: typecheck, lint, all 2,025 tests and existing coverage thresholds, and bundle verification. CLI 1,024/1,024 tests; coverage 86.71% statements, 81.75% branches, 94.07% functions and 92.35% lines. No local acceptance blocker remains.

| ID | Disposition and evidence |
| --- | --- |
| P4-R1 | Resolved: action-only steps with null command identity remain unmatched on both sides, even if names/ordinals match or action versions change; they cannot enter category totals (`packages/cli/src/advisory/compare-cohorts.ts:62`). |
| P4-R2 | Resolved: safe `comparison-no-excerpts` refusal stays visible and the concrete local compare recovery remains usable for all-action cohorts (`packages/cli/src/advisory/service.ts:30`, `packages/cli/src/advisory/service.test.ts:118`). |
| P4-R3 | Resolved: comparison-context normalization sorts copies; altered stored membership order cannot be silently normalized before digest validation. RED/GREEN regression covers actual retained-file mutation (`packages/cli/src/advisory/prepare.ts:26`, `packages/cli/src/advisory/prepare.test.ts:35`). |

Simplify: reuse pass shares cohort validation/stats between projection and observed comparison; quality pass retains optional compare-only context so old label/search artifact shapes stay unchanged; efficiency pass uses bounded lean run/source references and avoids mutating caller arrays. Known numerical examples, zero baseline, incompatible/retried/overlapping/mixed-source cohorts, step mismatch and corrected manifest recovery are automated. No native provider calls, new logs endpoint, workflow edits or paid runners were used.

Phase 4 tested source manifest: `sha256:ff66f43eced031248f1365f46bd7cd8e8f58070fd98ad5b8a3a8eeddb018793d`. Next: frozen independently reviewed synthetic evaluation splits, local benchmark and developer runbook. Native calls remain separately authorized; phase 5 must deliver the complete dry-run proposal and explicitly unmeasured qualification without spending.
