# Source admission and abstention implementation notes

Date: 2026-10-29. Approved objective: improve the separate local source-navigation path and rerun the frozen 60-case/36-question diagnostic with inference off. Base develop `04736fa53bdb07f5d54f7068b1370677d8cf9962`; implementation branch `feat/advisory-source-quality`, worktree `/Users/juan/code/cirujano-advisory-quality`. This follow-up includes local integration and owned cleanup, with no push, CI creation, model/provider action or paid runner.

## Implemented contract and review

Source V2 binds the exact `declared-source-benign-env-v1` policy to its digest. The strict core YAML parser supplies resolved data and exact AST mapping-key spans. Only approved plain env mappings at workflow/job/step locations receive a temporary validation view; full original bytes are stored and cited. All decoded keys/values and every remaining original byte retain credential checks. V1, execution and inference admission remain strict. Source-only search uses the explicit `declared-source-search-v2` relevance/abstention policy, with unchanged execution search, bounds and immutable references. README and advisory runbook document the exact limits.

Independent design review approved exact AST validation and rejected count-only matching. Independent implementation review identified escaped semantic credential-key admission and runtime cache/test requests returning declaration hits. Parent added failing regressions (11 failures), repaired decoded-key/value screening and runtime evidence recognition, and reran focused checks. Repair readback found plural cache hits still accepted; a failing plural regression preceded its correction. Final independent repair review passed. Full reports remain in `docs/agents/source-quality-2026-10-29/`.

Codex simplify used separate reuse, quality and efficiency passes. It retained the existing parser/acquisition/credential/tokenization helpers and lifted the declaration-location regex to module scope. No speculative abstraction or broad refactor was added.

## Verification evidence

RED receipts cover AST span extraction, V2 admission/legacy refusal, relevance, scope, decoded credential keys and runtime/plural requests. Focused GREEN passed 43 core tests and 166 CLI tests. An initial lint failure was an unused digest binding in the new test; replacing it with an explicit copy/delete preserved the tamper assertion. Repaired typecheck and lint passed before final gates.

Full sequential coverage passed 2,188 tests in 112 files: core581, runner420, Action6, CLI1,181. Coverage thresholds were unchanged. Core statement/branch/function/line coverage: 95.59/91.92/99.38/99.40%; runner86.52/82.83/96.86/95.05%; Action100/87.50/100/100%; CLI85.58/80.47/93.08/91.34%. Raw command exits, logs and candidate source/test identities are retained locally; earlier failures remain visible.

## Deviations

The plan's whole-file guard alone cannot detect every YAML-escaped semantic credential spelling. Review established that decoded keys and values also need the same checks. The V2 inspection now supplies both decoded data and spans from one parse; V1 and execution guards are unchanged. Search abstention tests were extended to plural cache outcomes after a concrete review finding. These are repairs within the approved admission/abstention scope.

The benchmark also runs the current search policy against the unchanged eleven V1 inputs. This isolates search-policy effects from new source admission. It uses only retained real GitHub API responses, with a fail-closed offline shim and no fresh requests. Both earlier evidence freezes passed validation before measurement; the new driver rechecks them afterward and preserves raw stdout/stderr for every CLI invocation. Diagnostic labels remain reused agent annotations, with no human time or native-model qualification implied.

The complete build succeeded. Its first bundle freshness check flagged the expected uncommitted push-guard harness change (optional inspection callback in the shared parser); the Action bundle was unchanged. The generated harness is committed with its source, then the full bundle gate is rerun against committed bytes. The cached local Linux harness gate passed on Node22.23.4 with networking disabled: 509 matrix cells, 60 classifier cases, tampered candidate detected; provider isolation remains explicitly unproven.
