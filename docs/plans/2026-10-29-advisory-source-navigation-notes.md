# Source navigation implementation notes

2026-10-29. Base `develop` at `7314da81d6241ed00e391df0a1f22966b4b3b162`; implementation worktree `/Users/juan/code/cirujano-advisory-source`, branch `feat/advisory-source-navigation`. Approved objective: separate local declaration collection/search and unchanged frozen-pilot rerun. No native requests, CI execution, routing changes, provider/runner changes or remote publication are authorized by this phase.

## Implementation and review

Added source-only collection/search, a strict original-byte sidecar, private storage, exact source citations and source-specific recovery. Original execution EvidenceBundleV1, source guard and inference/cohort contracts remain unchanged. Repository/run selection and immutable acquisition are shared; lexical scoring is shared without changing its policy. Original curated baseline report is preserved byte-for-byte.

Collection RED: 23 failing cases before the new collector/codec existed (`collection-red.log`); GREEN: new and original collection tests passed 46/46 (`collection-green.log`). Search CLI RED: six cases failed before new command support (`search-red.log`); first GREEN attempt exposed a JSON-format test/command mismatch, repaired by explicit optional JSON output for collect-source. Focused GREEN then passed 74/74 (`focused.log`).

Independent implementation finding F1: conflicting head/event snapshots of one repository/run/attempt/path were admitted before immutable-source deduplication. Two new behavioral regressions failed as expected (`snapshot-red.log`). Added snapshot identity validation before deduplication; focused suite passed 76/76 (`snapshot-green.log`). Reviewer independently probed both repaired cases and distinct-run deduplication and returned PASS. Full design/review evidence remains local under `/Users/juan/code/cirujano/docs/agents/source-navigation-2026-10-29/` and `source-navigation-design-review.md`.

The codex-simplify reuse, quality and efficiency passes made no changes or invalidated checks (`simplify.md`). Final implementation typecheck and lint passed. Full coverage/build/bundle gates and the real-corpus rerun are still in progress; those observations will be recorded here before phase acceptance.

## Deviations

Plan said preserve complete original bytes. Found: the existing shared fatal TextDecoder strips a UTF-8 BOM. Chose the design review's explicitly allowed refusal rather than changing shared execution decoding; the new decoder refuses the changed blob hash. Every accepted document still preserves exact original bytes; Unicode/CRLF roundtrip and BOM refusal are tested. No raw source was transformed into an accepted blob identity.

The original 60-job pilot and agent labels remain diagnostic inputs, not a fresh unseen or human-reviewed qualification set. Whole-file guards remain unchanged; accepted declaration coverage is measured rather than promised. Model quality, human investigation time and causal savings remain unmeasured.
