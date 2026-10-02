# Cirujano hackathon readiness assessment

Assessed: 2026-09-29. Baseline and current source: `develop` at `91b7908cb8ff1a23e115f346799a1208f4da342d`, working directory `/Users/juan/code/cirujano`.

## Decision

Cirujano is actively gathering real runner and usage evidence, but it is not feature-complete or submission-ready for the Nebius x NVIDIA hackathon. The largest blocker is the missing NVIDIA model runtime integration. The full advertised diagnose, propose, verify and PR loop also remains unimplemented. More runner activity alone cannot close these gaps.

Scope was assessment: source inspection, local evidence reads and read-only GitHub/official-rules requests. No implementation, remote publication, infrastructure change or new paid execution was authorized or performed. This document is the only repository change made by this assessment.

## Criteria and current implementation

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules), retrieved 2026-09-29, require a working application using Nebius and an NVIDIA open-source model. They also require public licensed source, setup instructions, a working demo/application/test-build URL, a public YouTube demonstration, track identification and platform/model feedback. The video should be under three minutes. Submission closes October 30 at 10:00 PDT. Judges must retain free access through the end of judging, December 15. Multiple entries must be substantially different.

| Capability or evidence | Assessment | Basis |
| --- | --- | --- |
| Billing estimator and reporting Action | Implemented | `packages/core/src/index.ts:3`; `packages/action/src/main.ts:7` |
| Runner control, enrollment and telemetry commands | Implemented and used | `packages/cli/src/args.ts:6`; current private snapshots, registry and controller journals |
| Historical live runner lifecycle pilot | Demonstrated, with candidate-specific limits | `docs/research/2026-09-15-nebius-runner-pilot-r14.md:1` |
| NVIDIA model diagnosis | Missing in inspected source | CLI dispatch at `packages/cli/src/cli.ts:51`; Action implementation at `packages/action/src/main.ts:7`; source search found no model API integration |
| Workflow patch proposal, safety verification and evidence-backed PR | Missing | `README.md:33`; existing CLI dispatch and Action implementation |
| Routine raw measurement | Active | September 29 snapshot and successful collector log; installed launchd schedule is 06:10 local time |
| Routine net savings reconciliation | Incomplete | Scheduled wrapper does not supply the registry: `scripts/collect-actions-telemetry.sh:56` |
| Submission package | Not established | No `docs/demo/` directory, no repository demo/submission/feedback artifact found, GitHub Releases API returned an empty list |

The last row does not establish that no private Devpost draft or external video exists. Those surfaces were not inspected. A package release is not itself a rule requirement; a usable test build can satisfy judge access.

## Current collection evidence

The latest successful raw collection completed at `2026-09-29T04:26:49.315Z`. The cumulative report since September 13 records 27 repositories, 18,492 jobs, 179 Cirujano jobs and 797 Cirujano minutes. It reports $4.73 gross avoided GitHub list cost, 739 jobs with unknown price and 1,214 jobs with incomplete timing. Gross avoided cost is not invoice savings.

Sixteen daily snapshot files exist from September 13 through September 29. September 23 has no daily file, but the September 24 window starts before the September 22 collection completed. The overlap covers that calendar gap; old retries and other completeness limits still apply (`docs/runbooks/fleet-telemetry.md:41`).

The launchd collector is loaded with a successful last exit. Controllers P2 through P10 are loaded and their journals were updating during this assessment. These observations establish ongoing operation, not that every workload succeeds. The registry contains nine cut-over enrollments and one historical reverted enrollment.

A September 29 private matched-workload record adds useful evidence beyond the morning snapshot: its GitHub job readback succeeded on `cirujano-p10-g1`. The record reports identical 9,762 passing tests and 95.67% coverage before and after moving the runner. It records $0.060 hosted list usage versus $0.028568 modeled provider cycle cost. The test/coverage and cycle-accounting details were read from that record, not independently replayed in this assessment. This small positive comparison is counterevidence to a blanket claim that runner relocation cannot save money; it does not prove fleet profitability or an invoice reduction.

Raw identities remain private in the local telemetry store. No private repository names or resource identifiers are included here.

## Open findings

### H1: Missing required model runtime and product loop

No NVIDIA model API integration is present in the inspected package source. `README.md:33` explicitly leaves proposal and verification for later. Implement a bounded, demonstrable model-driven operation with retained model identity, input/output, latency and usage evidence. To deliver the advertised product, complete at least one workflow diagnosis through a safe patch, unchanged required checks, before/after measurement and human-reviewable PR. The Coding and Agentic Engineering track wording specifically mentions writing, running and testing code in Token Factory Sandboxes; the final scope must address that fit rather than assume a VM controller is sufficient.

### H2: Scheduled evidence stops at gross usage

Both the installed collector wrapper and repository script invoke the report without `--registry`. Consequently `latest.md` is fresh but has no controller-cost or enrollment reconciliation. `fleet-latest.md` stops on September 27. Generate and retain the registry-backed report on the collection schedule, including failures and freshness status, while keeping private identities out of publishable outputs.

### H3: Net savings and attribution are not yet defensible

An on-demand report from the existing CLI bundle, morning snapshots and live journals returned `fleet.complete=false`, `netSavingsUsd=null`, $4.092 enrolled gross avoided list cost and $8.938357 controller-modeled provider cost. Seven credited jobs lacked assignments: P1 one, P2 three and P3 three. These figures do not support a positive fleet savings claim. The broad $4.73 telemetry total has a different scope from the $4.092 enrollment total.

There is also a time-alignment limitation: the job report stops at the morning collection, while the controller evidence reader loads live cumulative journals. Cost computation sums those generations without clipping them to the job collection cutoff (`packages/cli/src/telemetry.ts:493`). Newly completed workloads and later costs therefore need a consistent cutoff before comparison. One new enrollment still appears public in the morning snapshot although a live GitHub readback is private and its successful migrated job happened later. Preserve historical visibility and align collection, cutover and billing evidence; do not retroactively price public baseline jobs as private.

Resolve assignment gaps or explicitly exclude unsupported credit. Reconcile GitHub allowance/actual charges and provider charges before claiming invoice savings. The current $120/month headline remains a projection (`docs/cirujano-savings-case-study.md:138`).

### H4: Performance and coverage evidence need matched comparisons

Historical queue p95 values in the recomputed report are about 78 minutes for P2 and 363 minutes for P3. They include more than VM boot time and do not establish current latency after recent fixes. The runbook explains single-slot serialization and the queue measurement limitations. Preserve failures, cancellations, queue latency, unchanged checks and coverage in comparable before/after windows. A loaded controller and aggregate success rate cannot establish no regression.

### H5: Public product narrative is inconsistent

`README.md:33` still describes enrollment as future work. The case study calls the live pilot pending (`docs/cirujano-savings-case-study.md:140`) and describes concurrent jobs (`docs/cirujano-savings-case-study.md:26`) although current fleet accounting documents one slot per enrollment. Update these claims after selecting the submission scope; distinguish working features, single-slot operation, historical pilot proof and four-slot economic projections.

### H6: Judge-facing delivery remains unverified

Prepare a repeatable demonstration, pinned runnable build and setup path, public video, English submission text, platform/model feedback and an anonymized evidence summary. Bind claims to exact source and run identities. Preserve Cirujano's separate value from Sutura. Confirm judge access through December 15 and final Devpost receipt when submission is authorized.

## Options and recommendation

| Option | Advantage | Limitation |
| --- | --- | --- |
| Continue collecting runner data only | Lowest implementation cost; grows real operational evidence | Leaves H1 unresolved and does not complete the advertised AI product |
| Deliver one bounded diagnosis-to-verified-change path while repairing evidence | Meets a concrete user need and connects model reasoning to measured results | Requires implementation, evaluation and authorized live proof |
| Pursue broad optimization and multi-slot scheduling before submission | Could improve longer-term economics | Larger blast radius and verification burden; not necessary to prove one complete use case |

Recommend the bounded end-to-end path plus evidence reconciliation first. Keep routine collection running. Choose further fleet expansion or concurrency only from reconciled workload economics. A currently implemented, independently evidenced model workflow would reverse H1; aligned complete accounting and repeated matched outcomes would reverse H3/H4.

## Verification limits and handoff

Source and official rules were read; graph orientation preceded package inspection. The existing CLI successfully recomputed a report without collecting new remote jobs. No local full test, lint, typecheck, coverage or build gate was rerun because this was an assessment, and the report bundle is not claimed as freshly rebuilt from the baseline SHA. GitHub CI and CodeQL for the preceding commit `b59d48068795a7a4425edc866651601239c33798` were successful. Current-head runs were in progress when first inspected. This is not a release-readiness certification.

All H1-H6 findings remain open; no code repair or accepted architectural exception is implied. The next step is a phased completion plan with explicit model-loop, accounting, regression and judge-delivery acceptance criteria. Revalidate the branch, source, live registry, telemetry cutoff and controller accounting before using these numbers. Publication, workflow execution and paid resources retain their separate authorization boundaries.
