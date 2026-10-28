# Jev fit assessment for Cirujano

Date: 2026-10-28. Repository: `/Users/juan/code/cirujano`; integration branch `develop`; source baseline `37e7e33a0ba15d24eaa6433e9a4fa7f00613fb1f`. Read with [current-state research](2026-10-28-jev-capabilities-and-cirujano.md). This is the evaluative continuation explicitly requested by the user, not an implementation plan.

## Recommendation

**Yes: Jev is a plausible way to make Cirujano more useful through evidence-backed semantic discovery. Its performance benefit is UNMEASURED.** Prioritize a read-only optimization opportunity inbox, then a natural-language evidence navigator. Compare numerical decision rules against both Nemotron and Jev before replacing current inference. Keep exact proof, cost arithmetic, permissions and lifecycle control in code.

The important product distinction is between finding opportunities and proving an optimization. Jev could help developers discover costly work that Cirujano's current narrow optimizer cannot prescribe. It cannot make an unsupported workflow supported, prove test equivalence, or establish savings without measurements. Sutura remains the sole coordinator for CI routing; no recommendation here authorizes selecting/skipping checks, changing cadence or toggling modes.

## Criteria and present constraints

Evaluate developer usefulness, evidence correctness, end-to-end latency, absolute operating cost, privacy, maintenance burden and compatibility with existing authorization. Current diagnosis chooses proposal/abstention for exactly one operation and judges numeric timing/share materiality (`packages/cli/src/optimization/diagnose.ts:40`, `:44`, `:55`, `:59`). The Action's entry point only measures jobs (`packages/action/src/main.ts:7`); adding Jev there would add a network dependency rather than accelerate existing arithmetic. Telemetry already caches reusable completed runs and processes repositories with concurrency four (`packages/cli/src/telemetry.ts:239`, `:257`, `:305`).

## Opportunities ranked by expected value, not measured benefit

| Direction | Developer outcome | Jev's bounded job | Cost and limits | Disposition |
| --- | --- | --- | --- | --- |
| Optimization opportunity inbox | Understand which expensive jobs warrant investigation and why | Classify step purpose; judge candidate evidence relevance; label possible repeated setup/build/artifact work | Requires workflow/script/step evidence; false positives need review; no automatic removal | **First experiment** |
| Natural-language evidence navigator | Ask “Where is dependency setup consuming time?” and receive linked rows/excerpts | Select read-only intent and rank known evidence candidates | Exact filtering, aggregation and numbers remain code; retrieval adds latency | **Second feature** |
| Cost-regression investigation | Investigate “Why did this workflow get slower?” | Label symptoms in comparable logs/diffs; rank possible explanations | Present hypotheses, not causal proof; needs more evidence than current telemetry retains | **After evidence expansion** |
| Typed diagnosis provider | Reduce generated JSON/prose and get uncertainty distributions | Answer atomic semantic predicates, map to a permitted operation in code | Current numerical predicates may need no model; provider migration is substantial | **Benchmark, do not presume replacement** |
| Claim/evidence assistant | Flag prose that overstates supplied evidence | Classify support/contradiction/insufficient evidence | Current public reports use fixed templates; another model could be unnecessary overhead | **Conditional on richer prose features** |
| Semantic runbook lookup | Find relevant recovery guidance from unfamiliar log text | Rank known instructions | Existing reason codes should resolve through templates without inference | **Lower priority** |
| Learned prioritization | Rank likely useful opportunities from past accepted/rejected suggestions | Produce semantic features for a downstream predictor | Requires sufficient labeled outcomes, versioning and drift monitoring | **Later, data-dependent** |
| Screenshot/visual CI triage | Interpret screenshots or locate UI failures | Experimental image/Box judgment | Weak match for cost optimization; immature API/model behavior | **Defer** |

These feature directions draw on [semantic search](https://docs.typesafe.ai/cookbooks/semantic_find), [passage classification](https://docs.typesafe.ai/cookbooks/classifying_rag_passages), [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring), [intent routing](https://docs.typesafe.ai/patterns/intent-routing), [citation checks](https://docs.typesafe.ai/cookbooks/citation_check), and [feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery). They are adaptations, not vendor demonstrations on Cirujano.

## What the first feature could do

A developer receives a ranked list of expensive jobs, with observed timing, evidence excerpts, semantic work labels, uncertainty and the available next action. For example, “This job spends substantial observed time installing dependencies; inspect these setup and install steps.” Code calculates the timing share. Jev only judges what the bounded command/script excerpt means and which evidence supports that interpretation. A suspected repeated build is a review candidate, never permission to delete it: two similar commands can have different flags, inputs, artifacts or consumers.

The initial candidate set should come from deterministic cost/duration ranking. Retrieve only the source and relevant snippets for those candidates. Ask independent questions such as “Does this step install project dependencies?”, “Does this command compile application source?”, and “Does this excerpt explicitly report a cache miss?”. Multiple labels can be true, so use separate Nouls rather than forcing one exclusive category. Use Choice for mutually exclusive read-only intents or selecting an existing evidence identifier. Use Score for a defined relevance rubric, not estimated dollars or milliseconds.

A compact decision table keeps behavior reviewable:

| Evidence/result | Application behavior |
| --- | --- |
| Missing source identity, incomplete measurements or no relevant excerpt | Show missing evidence; no causal conclusion |
| Supported semantic label and relevant source | Display advisory label with exact source link |
| Ambiguous or contradictory probabilities | Mark uncertain; retain raw evidence for inspection |
| No candidate fits | Return no matching evidence; never force the nearest candidate as an answer |
| Provider error or unknown request outcome | Show unavailable/unknown; retain deterministic report; no automatic resubmission |
| Developer selects an executable optimization | Enter existing eligibility/proof/permit workflow; semantic result grants no authority |

The [search cookbook](https://docs.typesafe.ai/cookbooks/semantic_find) demonstrates why a Choice needs a separate existence check: it always ranks something. Questions sharing state can be bundled; questions requiring newly retrieved evidence need a later request. Treat thresholds as evaluation parameters, not universal correctness guarantees.

## The material data gap

Current telemetry stores run/job identity, names, timing, labels and cost but not head SHA, workflow source, step timings or logs (`packages/cli/src/telemetry.ts:45`, `:78`; `packages/cli/src/telemetry-service.ts:117`, `:136`). Names alone cannot explain a bottleneck. A useful semantic feature therefore needs bounded evidence collection tied to source commit and run attempt, with sanitization before transmission. The optimizer's existing immutable collection offers a narrower starting point (`packages/cli/src/optimization/github-read.ts:129`, `:155`).

This gap changes the prioritization: begin with public/synthetic workflow and step examples plus existing optimizer inputs, rather than promising fleet-wide causal explanations immediately. Evidence browsing can still expose existing exact totals without claiming causes.

## Improving decisions and performance

For the existing numerical judgments, compare four options:

| Option | Strength | Tradeoff |
| --- | --- | --- |
| Explicit deterministic materiality rules | No inference cost/network latency; transparent numerical policy | Owner must define materiality; limited semantic flexibility |
| Current Nemotron | Existing receipt/proof integration and historical evaluation | Generates bounded prose/JSON; current provider dependence |
| Jev typed judgments | Closed-set answers and useful uncertainty for semantic tasks | New provider contracts and domain calibration; no free-form explanation |
| Jev followed by Nemotron when needed | Could reduce expensive reasoning on easy semantic cases | Adds a serial call; may worsen latency/cost if most cases escalate |

Replacing the existing numerical model call with rules is a credible improvement independently of Jev, but requires an explicit policy and contract change, not pretending a rule produced a model receipt. Jev should earn its place on semantic tasks where a parser or threshold is insufficient.

[Parallel-question results](https://docs.typesafe.ai/cookbooks/parallel_questions) compare batching with repeated Jev calls on a particular document, not Jev with Cirujano's already-single diagnosis call. Do not promise that cookbook's speedup here. Similarly, the [extraction cascade](https://docs.typesafe.ai/cookbooks/sde_cascade) demonstrates a different workload and models.

Illustrative arithmetic using the published input price: a complete 4,000-input-token request costs $0.000168; 10,000 such requests cost $1.68 before retries or extra calls. This is a hypothetical budget calculation, not a measured Cirujano payload. The historical Nemotron diagnosis was already about $0.00012 (`docs/research/2026-10-09-skip-validated-push-live-proof.md:96`). Lower inference expense alone is unlikely to justify the engineering; more useful recommendations might. [Price source](https://docs.typesafe.ai/models).

For a cascade, expected request cost is Jev cost plus escalation fraction times downstream cost. End-to-end latency also includes evidence collection and serial escalation. Measure both. Jev does not directly reduce GitHub API pagination, VM boot, dependency installation or test runtime; only a subsequently implemented and verified optimization can do that.

## Integration implications

A TypeSafe SDK fits the Node/TypeScript stack, but Jev is not a config-only replacement. Current config accepts only Nebius and `nvidia/` (`packages/cli/src/optimization/nebius.ts:25`). Completed receipts enforce provider/model identity (`packages/core/src/optimization/contracts.ts:116`); downstream journals reconstruct the old request (`packages/cli/src/optimization/diagnosis-journal.ts:35`); report rendering accepts NVIDIA identities (`packages/core/src/optimization/report.ts:10`). Current diagnosis also requires analysis/uncertainty strings (`packages/cli/src/optimization/diagnose.ts:13`) that Jev does not generate.

Prefer a separate advisory result initially. If diagnosis migration later proves worthwhile, define a narrowly versioned provider/result contract, explicit endpoint allowlist, pinned model, question/criteria version, exact state/request hashes, raw typed answers, policy version and input/output receipt bindings. Generate explanations with deterministic templates or separately authorized generative work. Preserve old receipt readers; do not loosen all existing validation or manufacture chat completion fields for Jev.

Disable SDK retries for one-attempt permits (`maxRetries: 0`), impose a total deadline, and distinguish failure from abstention. Default SDK retries include uncertain connection/timeout outcomes, conflicting with current one-request authority and unknown-outcome behavior (`packages/cli/src/optimization/nebius.ts:10`, `:128`; [SDK retry reference](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy)). Avoid unredacted request logging. A fallback call also needs its own authorization/budget; it is not implicitly covered by a failed Jev attempt.

Keep input excerpts small, relevant and untrusted. Never send tokens, private repository identities or raw private fleet logs merely because a public report is sanitized later. No-training is not zero retention; account terms remain unverified. Model confidence cannot authorize changes, prove equivalence or neutralize prompt injection. Experimental [images/Box](https://docs.typesafe.ai/images) are unnecessary for the proposed first feature.

## Evidence needed to accept or reverse the recommendation

A bounded future evaluation should compare rules-only, current Nemotron, Jev and the cascade on the same independently labeled public/synthetic cases. Existing seeds include cache and push model evaluations (`scripts/optimization/evaluate.mjs:36`, `:50`) and telemetry evidence reuse/conflict tests (`packages/cli/src/telemetry.test.ts:137`, `:224`). These test contracts, not semantic quality on unfamiliar scripts; add held-out repositories, misleading names, varied commands, missing context, adversarial text, mixed intents, and no-match cases. Do not tune and report on the same cases.

Measure useful recommendation precision/recall, top-k evidence relevance, citation accuracy, abstention and unsupported-claim rates; p50/p95 latency including retrieval; requests/tokens and cost per accepted useful suggestion. Repeat option-order variants and pinned-model runs. Preserve byte-identical numerical cost and authority outcomes. Evaluate cold and reused evidence separately. Report confidence intervals/sample counts and actual human review time rather than a percentage from a tiny convenience set.

Proceed only if Jev improves a declared usefulness or latency objective over simpler alternatives without weakening evidence boundaries. If rules/keyword retrieval perform similarly, omit Jev. If evidence collection dominates latency, optimize that path before claiming model speed matters. Real CI improvements require separately authorized verification and measured runs; this investigation provides none.

## Dispositions and handoff

- A1 semantic opportunity inbox: recommended for a bounded evaluation; benefit UNMEASURED.
- A2 evidence navigator: recommended after evidence retrieval scope is defined.
- A3 numeric decision replacement: compare deterministic policy first; no provider swap accepted.
- A4 causal explanations: blocked by missing source/step/log evidence until collected.
- A5 semantic proof/authorization/CI-routing control: rejected; exact contracts and Sutura ownership remain.
- A6 images, autonomous memory and learned feature loops: deferred; insufficient task fit or outcome data. No Graphify memory writes.

Completed locally: research and assessment documents only. No code/config changes, paid inference, tests, provider writes, hosted runs or publication. Console access was UNAVAILABLE because the browser host could not connect; account limits and terms remain unknown. A future planning phase must revalidate branch/SHA, evidence, model/SDK versions and choose the bounded feature and success criteria. Live experimentation requires a specified data scope and spending authorization. This assessment stops before planning or implementation.
