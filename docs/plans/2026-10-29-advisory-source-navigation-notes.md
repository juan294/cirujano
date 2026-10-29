# Source navigation implementation notes

2026-10-29. Base `develop` at `7314da81d6241ed00e391df0a1f22966b4b3b162`; implementation worktree `/Users/juan/code/cirujano-advisory-source`, branch `feat/advisory-source-navigation`. Approved objective: separate local declaration collection/search and unchanged frozen-pilot rerun. No native requests, CI execution, routing changes, provider/runner changes or remote publication are authorized by this phase.

## Implementation and review

Added source-only collection/search, a strict original-byte sidecar, private storage, exact source citations and source-specific recovery. Original execution EvidenceBundleV1, source guard and inference/cohort contracts remain unchanged. Repository/run selection and immutable acquisition are shared; lexical scoring is shared without changing its policy. Original curated baseline report is preserved byte-for-byte.

Collection RED: 23 failing cases before the new collector/codec existed (`collection-red.log`); GREEN: new and original collection tests passed 46/46 (`collection-green.log`). Search CLI RED: six cases failed before new command support (`search-red.log`); first GREEN attempt exposed a JSON-format test/command mismatch, repaired by explicit optional JSON output for collect-source. Focused GREEN then passed 74/74 (`focused.log`).

Independent implementation finding F1: conflicting head/event snapshots of one repository/run/attempt/path were admitted before immutable-source deduplication. Two new behavioral regressions failed as expected (`snapshot-red.log`). Added snapshot identity validation before deduplication; focused suite passed 76/76 (`snapshot-green.log`). Reviewer independently probed both repaired cases and distinct-run deduplication and returned PASS. Full design/review evidence remains local under `/Users/juan/code/cirujano/docs/agents/source-navigation-2026-10-29/` and `source-navigation-design-review.md`.

The codex-simplify reuse, quality and efficiency passes made no changes or invalidated checks (`simplify.md`). Typecheck, lint, complete test coverage (2,100 tests across 109 files), build/smoke and tracked-bundle verification all passed for implementation commit `6b7ff7ef5e6e7370d89d0cf74d3805ee68f78fab`. Per-package line coverage: core 99.39%, runner 95.05%, Action 100%, CLI 91.21%. Raw logs retain individual command exits; local gate summary is `gates.json`.

## Real-corpus acceptance

The actual built CLI at implementation 6b7ff7e (bundle SHA-256 `4f2a2115ae19dec42df62e6b6d0301d21c8cbeca3392adf1b0d3de1562f6ab05`) ran all 60 original cases and 36 original questions in separate output. Declaration admission was 11/60 (six Cirujano, two gh-glance, three cc-rpi; seven distinct blobs); 49 whole-file guard refusals remained. Five of 27 navigation tasks had a relevant cited hit, all five in the 18-task heldout partition. This is a source-location proxy, not a complete answer score. Only 12/63 returned hits overlapped gold source ranges; two of nine missing-evidence questions returned lexical noise. All 63 citations matched original bytes and identities. These measured limits are retained, not qualified as semantic usefulness.

All 60 execution outcomes matched the original: 45 partial, 13 refused, two unresolved selections. Actual CLI inbox duration/rounded-minute values matched 45/45 annotations (29/29 heldout), and the original execution ask still returned no-match for all 36 questions. Seventy-six new successful scoped GitHub GETs supplied missing objects/one attempt response; historical plus new fresh reads totaled 268. There were 674 transport reads including caches and 193 actual CLI invocations. No logs, new CI, model calls or publication occurred. Original input, label and completed-evidence freezes continued to verify. Source summary SHA-256: `a476e1e368c8bae4c2d58dc0728f9e75d8b57570d574681a7380b8ac8e8d0d5a`.

Independent data/prose audit passed (`rerun-audit.md`) after verifying the freezes, source Git chains, identities, numeric values, citations and every summary denominator. The final [results report](../research/2026-10-29-advisory-source-navigation-results.md) preserves the JSON stdout-serialization limitation: canonicalized values are retained, while only 58 execution stdout reports are verbatim. Original annotations remain audited agent judgments, not human truth. No confirmed actionable implementation or provenance finding remains; admission limits and lexical noise are explicit limits of this narrow declared-source/lexical contract. Native quality, full answers and human time benefit remain unmeasured.

## Local integration handoff

Source candidate 6b7ff7e and its reviewed results/notes are complete for local integration into develop; only documentation changed after the measured implementation commit. All phase work is preserved in Git and the root checkout's ignored `docs/agents/source-navigation-2026-10-29/` directory. The measured CLI is archived there before cleanup. The integration owner will fast-forward develop, verify the integrated build and retained-source CLI smoke, then remove only the owned worktree/branch. Actual final branch/head, smoke/bundle results and cleanup receipt are saved in `integration-state.json` and bound by the final evidence manifest. No remote push or new hosted check is performed.

During isolated work, develop advanced to release-ancestry merge `39b2c72e181315321a6b886c852e449c393ef510`. Its tree equals base7314da8 exactly; no source or dependency input changed. Preserve that ancestry by merging it into the owned branch before the local fast-forward. The existing source/test gate evidence remains valid; integrated build and source smoke verify the final checkout. No foreign history or worktree is removed.

## Deviations

Plan said preserve complete original bytes. Found: the existing shared fatal TextDecoder strips a UTF-8 BOM. Chose the design review's explicitly allowed refusal rather than changing shared execution decoding; the new decoder refuses the changed blob hash. Every accepted document still preserves exact original bytes; Unicode/CRLF roundtrip and BOM refusal are tested. No raw source was transformed into an accepted blob identity.

The original 60-job pilot and agent labels remain diagnostic inputs, not a fresh unseen or human-reviewed qualification set. Whole-file guards remain unchanged; accepted declaration coverage is measured rather than promised. Model quality, human investigation time and causal savings remain unmeasured.
