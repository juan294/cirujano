# Source admission and abstention: frozen-case results

Date: 2026-10-29. Measured source commit `69fe231fc77addd82d54361c124fbf4f3f35c0ab`; CLI SHA-256 `5ee2d0e22f7411e5afd623550b2aa62ce3e1c4801553cc748e67bffc7625665e`; Node 24.22.1. Model inference remained off.

Source coverage improved and missing-evidence abstention improved, with a measurable recall trade-off. The combined candidate retrieves a relevant location for 11/27 navigation questions, up from 5/27. However, applying its search policy to the unchanged V1 inputs drops relevant locations from 5/27 to 2/27. This is a completed diagnostic, not a search-quality or rollout qualification. Keep the admission gain; review the search policy's missed declarations before promoting it as a general retrieval improvement.

## What changed

Source collection now emits schema V2 with digest-bound policy `declared-source-benign-env-v1`, while preserving strict V1 reads. A narrow allowlist admits benign env declarations only at supported workflow/job/step mapping locations. It checks both decoded semantic keys/values and complete original source; only exact approved AST key spans receive a temporary validation view. Stored bytes, Git blob hashes and line references are never sanitized. Execution collection and inference admission retain their original guards: `packages/cli/src/advisory/source-admission.ts:12`, `packages/cli/src/advisory/source-admission.ts:23`, `packages/cli/src/advisory/source-admission.ts:32`, `packages/core/src/optimization/workflow.ts:27`, `packages/cli/src/advisory/source-evidence.ts:18`, `packages/cli/src/advisory/collect.ts:71`.

Source search now identifies its deterministic policy as `declared-source-search-v2`. Operational questions require operation/configuration signals; comments and step labels alone cannot establish them. Requests for unavailable runtime records or external implementation bodies receive explicit no-match reasons. Mixed declaration-location questions can return a location without answering their runtime/implementation portion. Bounds, exact citations, sensitive-query checks and the execution search policy remain intact: `packages/cli/src/advisory/source-relevance.ts:8`, `packages/cli/src/advisory/source-relevance.ts:24`, `packages/cli/src/advisory/source-search.ts:14`, `packages/cli/src/advisory/source-search.ts:20`, `packages/cli/src/advisory/search-candidates.ts:17`.

The [runbook](../runbooks/advisory.md#browse-workflow-declarations) lists exact allowed values, version behavior and commands. Policy IDs and limitations are visible in JSON. Retrieval scores are not model probabilities.

## Measurement and results

The corpus is unchanged: 60 selected job observations from three public repositories, 32 distinct repository/head/workflow paths and 18 distinct Git blobs. Cirujano supplies 20 development cases; gh-glance and cc-rpi supply 40 historically held-out cases. All 36 original questions remain: 27 navigation and 9 missing-evidence questions, split 9+3 development and 18+6 holdout. The annotations were independently produced by agents in the earlier pilot. Their reuse makes this a diagnostic comparison, not fresh unseen or human-reviewed qualification.

The actual built CLI ran 229 commands: 60 source collections, 58 execution collections, 3 inboxes, 36 execution searches, 36 V2 source searches and 36 searches against the exact unchanged eleven V1 inputs. Raw stdout and stderr, argument vectors, exits and hashes were retained for every call. GitHub transport replayed 674 reads from 211 distinct previously retained endpoints; the shim has no network fallback. During the replay, no fresh GitHub API request, CI run, model request, provider/runner action or publication occurred. Replay exercises current collection, decoding, storage, arithmetic and retrieval against real retained responses; it is not evidence of current hosted behavior.

| Diagnostic | Previous V1 | Same V1 inputs, new search | V2 admission and new search |
| --- | --- | --- | --- |
| Admitted case-associated sources |11/60|11/60|26/60|
| Admitted head/path identities |11/32|11/32|18/32|
| Admitted distinct Git blobs |7/18|7/18|10/18|
| Navigation questions with relevant source available |6/27|6/27|17/27|
| Navigation questions with a relevant hit |5/27|2/27|11/27|
| Relevant hit when relevant source is available |5/6|2/6|11/17|
| Hits despite unavailable relevant source |15/21|2/21|4/10|
| Missing-evidence questions incorrectly receiving hits |2/9|0/9|0/9|
| Relevant returned hits, annotation-overlap proxy |12/63(19.0%)|6/12(50.0%)|28/46(60.9%)|
| Exact valid source references |63/63|12/12|46/46|

The coverage gain is 15 case-associated sources across 7 additional head/path identities and 3 additional blobs, not 15 independent workflow samples. Cirujano admission rises 6→16/20; gh-glance 2→7/20; cc-rpi stays 3/20. The remaining 34 cases stay refused. No credential-bearing source was partially retained to manufacture coverage.

For the historical holdout alone, relevant-source availability rises 6→11/18 navigation questions and relevant hits 5→6/18. Returned-hit relevance changes 12/46→13/25, and missing-evidence false hits 2/6→0/6. On unchanged holdout V1 inputs, new search finds 2/18 navigation locations, with 6/6 returned hits overlapping annotations. Development relevant hits rise 0→5/9, with 15/21 relevant returned hits. Coverage expansion drives most of the overall gain; the paired V1 result prevents attributing it solely to better ranking.

All 60 legacy execution dispositions remain unchanged: 45 partial, 13 refused, 2 selection-unavailable. All 45 code-computed duration/rounded-minute pairs match the original annotations and actual inbox output. Execution source searches still return no-match for all 36 questions. No missing duration was filled, and no declaration became execution attribution.

## What the misses tell us

The candidate gains nine previously missed navigation tasks and loses three previously found tasks. All three losses are cc-rpi declarations with retained relevant source: a delegated verification entrypoint, an artifact upload including hidden files, and workflow triggers. The filter overweights named operation families or literal overlap for these forms. Three further available-source misses remain in the combined candidate, for six available-source misses total: the six are a chained operating-system installation, inline smoke assertions, delegated verification, artifact upload, runtime-version declarations and triggers. The other ten navigation misses lack relevant admitted source; four still receive unrelated declaration hits.

These are explicit limitations of this measured candidate, not resolved retrieval successes. No rules were tuned against these outcomes after the frozen rerun. The local disposition is to retain the diagnostic evidence and withhold general search-quality acceptance. A subsequent iteration should establish independent development fixtures for declaration structure and command boundaries, select the intended precision/recall trade-off, then evaluate on a newly frozen unseen set. Preserve the admission safety boundary; do not admit the remaining credential-bearing workflows merely to raise coverage. A blinded paired investigation trial is still needed to measure time saved after retrieval behavior is acceptable.

Partial line-range overlap is only a location-retrieval proxy. It does not establish complete answers, human relevance, hidden package/helper implementations, successful execution, actual cache hits/misses, causal bottlenecks or savings. Native model quality, latency and cost, human investigation time and production effectiveness remain unmeasured. The original question labels and repository split do not remove this limitation.

## Verification and reproducibility

Independent review found and repaired escaped semantic credential names and runtime-record requests; a later plural cache-hit regression was repaired too. All fixes had failing regressions before repair. Separate simplify passes covered reuse, quality and efficiency. Final sequential typecheck, lint, full coverage and build/bundle verification passed. Coverage ran 2,188 tests in 112 files with unchanged thresholds. The generated push-guard harness was rebuilt and committed with its shared parser source; the Action bundle was unchanged. The cached offline Linux harness passed 509 matrix cells and 60 classifier cases and detected tampering; provider isolation remains unproven. Initial lint and uncommitted-bundle freshness failures are retained alongside their passing repair receipts.

Raw local evidence is at `docs/agents/source-quality-2026-10-29/`: measured CLI, invocation/transport ledgers, V2 and unchanged-V1 outputs, complete summaries, paired analysis, source/test identities, review reports and gate logs. `rerun-summary.json` and `paired-analysis.json` preserve all denominators and per-task misses. The former completed freezes remain unchanged: original `cb02937ab1d2b6652a90584f2c173836890533a3ba93a136846e50c8be740a88` (1,206 files), preceding source stage `93f4b3ca2034b09fd7c521ce4a335c74670c46004fcf3bf311940287cc0a2b7d` (485 files). Both passed before and after the rerun.

Verify the completed evidence locally without recollecting, inferring or overwriting results:

```bash
python3 docs/agents/source-quality-2026-10-29/freeze.py --verify
```

The final freeze binds this report, the plan/notes, exact measured binary and all retained authoritative raw artifacts to the recorded local integration state. Integration and owned-tree cleanup receipts are preserved there. [Implementation notes](../plans/2026-10-29-advisory-source-quality-notes.md) record decisions, deviations, test identity and publication boundaries.
