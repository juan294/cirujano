# Nemotron workflow optimization: one verified pnpm-cache change

Date: 2026-09-29. Status: implementation in progress; Phases 1-5 accepted locally; Phase 6 source verified, bounded external proof authorized and public benchmark bootstrap confirmed; image provisioning and native proof pending. Planning baseline: `develop`, `91b7908cb8ff1a23e115f346799a1208f4da342d`, `/Users/juan/code/cirujano`. Review and validation evidence: [notes](2026-09-29-nemotron-workflow-optimization-notes.md).

## Objective and authority

Complete item 1 / H1 from the [readiness assessment](../research/2026-09-29-hackathon-readiness-assessment.md): a real NVIDIA model diagnoses CI waste, proposes one supported workflow change, verifies preserved checks in Token Factory Sandboxes, measures the change in GitHub Actions, and prepares an evidence-backed PR for explicitly authorized publication. The user selected **one safe optimization family, end to end**. This plan chooses adding pnpm store caching to an existing `actions/setup-node` step.

This request authorizes planning only. Implementation uses isolated local worktrees, integrates locally into `develop`, and stops after each accepted phase unless continuation is explicitly authorized. Live inference, Sandbox operations, GitHub pushes/dispatches/PR creation and production publication remain separate external actions. Completing the plan does not authorize any of them. Model/Sandbox credentials never enter artifacts or child processes that execute project code.

H2-H6 remain separate work: fleet accounting repair, multi-slot runners, fleet rollout, general performance remediation, complete submission assets and Devpost submission are excluded. This feature records its own inference/Sandbox costs and measured workflow minutes without changing fleet schemas or claiming invoice savings. Documentation updates describe this bounded feature only. Sutura remains an independent product.

## Source evidence and decisions

| Evidence | Consequence |
| --- | --- |
| `README.md:25` and `README.md:33` distinguish existing measurement/runner features from future patching | Add a new opt-in CLI capability; do not change existing reporting Action behavior |
| `packages/cli/src/cli.ts:33`, `packages/cli/src/args.ts:160` | Extend dispatch with an appended optional optimization service, preserving existing positional injections and exit conventions |
| `packages/core/src/billing.ts:40`, `packages/core/src/billing.ts:56` | Reuse per-job rounding; never substitute summed step duration or `/timing` |
| `packages/cli/src/github-api.ts:13`, `packages/cli/src/github-api.ts:24` | Reuse the injected CLI transport for read-only GitHub requests; keep mutation paths separate |
| `packages/cli/src/fleet-service.ts:635` | Existing line-based `runs-on` extraction is not a general YAML editor; leave it unchanged |
| `packages/runner/src/journal.ts:11`, `packages/runner/src/journal.ts:23`, `packages/runner/src/journal.ts:44` | Reuse existing secret scrubbers and atomic private writes without changing their public contract |
| `.github/workflows/ci.yml:21`, `vitest.config.ts:1`, `scripts/verify-bundle.mjs:3` | Preserve all current checks; rebuild the committed Action bundle when core changes affect it |
| `docs/decisions/0001-separate-project-from-sutura.md:15` | No runtime dependency on Sutura; its adapter was inspected only as a comparison |

Primary sources retrieved September 29:

- [Hackathon rules](https://nebiusglobalaihackathon.devpost.com/rules): requires NVIDIA model use and Nebius; the selected Coding track explicitly names Sandboxes. Keep this track and implement the actual Sandbox backend.
- [Nebius completion API](https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion), [structured output](https://docs.tokenfactory.nebius.com/ai-models-inference/json), [Nano cookbook](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/nemotron3-nano-30b.md): use configurable exact NVIDIA model identity, non-streaming JSON schema output and independent local validation.
- [Sandbox create](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/instances/spawn-a-new-container-instance), [operation schema](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/get-an-operation-status.md), [cancel](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/cancel-an-operation): use explicit IAM/project context, disposable execution, bounded polling and terminal readback. The operation Markdown was retrieved with curl after the browser reader failed. Its embedded OpenAPI sets `{baseUrl}/v1`, so the complete default REST prefix is `https://api.tokenfactory.nebius.com/sandboxes/v1/`.
- [setup-node](https://github.com/actions/setup-node): pnpm caching is opt-in, requires pnpm already installed, uses dependency-file hashing and does not cache `node_modules`. Preserve frozen installation and all checks.
- [yaml v2](https://eemeli.org/yaml/): use the document AST, strict errors and node ranges; add a direct locked `yaml` v2 dependency instead of relying on a transitive peer.
- [GitHub runs](https://docs.github.com/en/rest/actions/workflow-runs) and [jobs](https://docs.github.com/en/rest/actions/workflow-jobs): read exact attempts, SHAs, conclusions, step identities and job timestamps.

Options considered: diagnosis-only is smaller but leaves the user-visible loop incomplete; unrestricted model-written YAML has a much larger safety/verification surface; model selection of a constrained cache operation completes one useful case with a testable invariant. Select the constrained operation. Native Node `fetch` avoids adding a general agent framework or SDK. No automatic model escalation or repair loop.

## Supported behavior

The initial target is a single, non-matrix, GitHub-hosted Linux pnpm job in a repository controlled by its owner. It has an explicit checkout, explicit pnpm setup before setup-node, one supported setup-node reference, a root `pnpm-lock.yaml`, frozen dependency installation, and an owner-authored verification profile. Node/pnpm versions, actions, lockfile and repository content are fixed for comparison. First live proof uses public, non-production code and no deployment workflow.

The only permitted workflow change is adding `cache: pnpm` and `cache-dependency-path: pnpm-lock.yaml` to that existing setup-node step's `with` mapping. No step removal, install skipping, trigger changes, permission changes, changed conditions, action upgrades, scripts, paths, tests, coverage thresholds or `runs-on` edits. Existing cache settings, explicit cache-disable intent, private-registry credentials, writable-token jobs, `pull_request_target`, containers, services, reusable jobs, matrices, YAML aliases/custom tags/duplicate keys, expressions in relevant setup fields and non-root lockfiles are unsupported in v1. Existing unsupported jobs elsewhere remain untouched.

The first supported action is the official setup-node v7 implementation, pinned to an immutable commit and checked against a locally recorded official release/action-input receipt. Checkout and pnpm setup in the live fixture are also SHA-pinned; Node/pnpm use exact versions. A mutable action tag can be diagnosed but cannot enter verified publication until its execution identity is independently established. Reject alternate checkout repositories/refs, explicit disabled cache, and a target without effective explicit read-only GitHub permissions. Record full required job/check inventory at collection, not just the optimized job; publication requires those checks for the candidate too. Resolving the pinned official action/image/dependency versions during implementation is an evidence-producing setup task, not permission to upgrade a target workflow.

Adding caching changes observable action outputs even when all later YAML stays identical. Therefore v1 requires the selected setup-node step to have no explicit `id` and rejects aggregate/dynamic access to the selected job's `steps` context, including `toJSON(steps)` and computed step indexing. A target with an ID or any direct/indirect cache-output consumer in commands, conditions, env, job outputs or dependent jobs is unsupported before inference. This intentionally conservative rule avoids attempting general expression equivalence. Warm/cold live checks must also prove the executed/skipped test set is unchanged.

Reject an unsafe or ambiguous target before inference when deterministic checks can decide it. The model receives stable evidence IDs, normalized structural facts and bounded job/step metrics, not raw logs, environment values or arbitrary workflow comments. It selects a supported operation or abstains, explains the selected evidence and uncertainty, and cannot provide executable code or arbitrary patch text. Validate evidence IDs, job/step identity and prerequisites independently. No accepted model response means no patch; deterministic code never invents a substitute model decision.

An already-cached workflow returns `no-change`, including Cirujano's current CI. The demonstration must not remove a real cache to manufacture an apparent real-project improvement. An intentionally uncached benchmark may be used if labeled as a benchmark and never presented as fleet savings.

## Proposed module and artifact contracts

New modules below are proposed paths, not claims of existing files. Put pure types, strict decoders, eligibility, YAML editing and comparison logic under `packages/core/src/optimization/`. Put external adapters and command orchestration under `packages/cli/src/optimization/`. Add narrow exports through the core index. Retain Node 22 compatibility and existing service-injection patterns.

Version every artifact with `schemaVersion: 1`. Strictly validate on every read; hashes identify canonical JSON with sorted keys and exact UTF-8 file bytes. All stages bind repository ID, base SHA, workflow blob/path/hash, selected job/step, lockfile hash, source-tree digest excluding the selected workflow, verification-profile hash, tool source SHA and bundle digest. Candidate evidence adds exact candidate SHA and patch hash. Unknown versions, input drift or incomplete provenance invalidate downstream success.

| Artifact | Required additional fields |
| --- | --- |
| `input.json` | Completed baseline run/attempt/job IDs, job and selected install-step timing, runner labels/image version when available, redacted structural facts, evidence ID map, supported operation inventory |
| `diagnosis.json` | `proposal` or `abstain`; reason and uncertainty; evidence references; only `enable-pnpm-cache` operation with exact target IDs; prompt/schema version; inference receipt digest |
| `inference.json` | Requested/returned model, approved endpoint host, completion ID if returned, request/response hashes, start/end/latency, finish reason, prompt/completion/total usage or explicit unavailable, quote identity and cost status; no credentials or reasoning trace |
| `proposal.json` plus `candidate.patch` | Validated operation, before/after structural digests, exact permitted diff, preconditions, verification profile, lifecycle status |
| `sandbox.json` | Approved image UUID/digest and manifest hashes, operation IDs/statuses, network policy, base/candidate command identity, actual test IDs/outcomes and per-file coverage counters, time/usage, truncation and cleanup state |
| `measurement.json` | Exact GitHub baseline/candidate attempts and jobs, all required check outcomes, cold/warm cache observations, individual rounded minutes and elapsed times, sample totals/medians, limits and claim level |
| `pr.md`, `publication.json` | Evidence-derived text and hash; exact repo/base/head and authorization binding; idempotency marker; confirmed URL/number or `outcome-unknown` |

Private artifacts default outside the repository under `~/.local/share/cirujano/optimization/`, directories 0700/files 0600. Reuse atomic writes, lock each operation directory, and reject symlink/path escape. Public export is a separate allowlist renderer; never copy raw model output, private names, raw prompts or environment values into a public report. New token-count fields must not be erased by a generic secret-key-name scrubber: scrub explicit secret values and text fields, retain typed usage counters. No shared journal/redaction refactor is required.

## CLI and state transitions

Add `optimize collect`, `diagnose`, `propose`, `verify`, `measure`, `report`, `publish`, `status` and `cancel` subcommands. Each consumes validated artifacts from the preceding stage. `collect` reads exact GitHub source/run evidence. `diagnose` requires an explicit live-inference permit to send data; without it, emit a local request preview with `not-run`. `propose` writes a local patch only. `verify` requires a Sandbox execution permit. `measure` reads existing run IDs and never dispatches. `report` is local. `publish` only creates a PR between already-published, authorized refs and never pushes, merges or dispatches. `status` is read-only; `cancel` is limited to recorded owned Sandbox operations.

Exit 0 means the command completed as represented, including a valid `abstain`/`no-change`; JSON status distinguishes that from success. Exit 1 means operational failure, incomplete verification or blocked publication. Exit 2 means usage/configuration error. Human and JSON output always give a stable reason code and an actionable next command. No background retry/daemon, automatic fallback model, or silent re-use of prior success.

Required flags are fixed as follows: `collect --repository --ref --workflow --job --run` (repeatable) `--output`; `diagnose --input --config --output` with optional `--permit` (absent means preview); `propose --input --diagnosis --output`; `verify --proposal --profile --permit --output`; `measure --proposal --sandbox --cohort --output`; `report --proposal --sandbox --measurement --output`; `publish --report --permit`; `status --operation`; `cancel --operation --permit`. Artifact-valued flags take local paths, run flags take numeric IDs plus an explicit attempt in the collected record, and the job flag is the literal YAML job key. Add `--format json|text` to commands that emit status; reject duplicate singular/unknown flags. Permit schemas distinguish inference, Sandbox and PR authority so none can authorize another operation class.

State progression: `collected -> diagnosed -> proposed -> sandbox-verified -> measured-improvement -> ready-to-publish -> published`. Terminal alternatives are `no-change`, `unsupported`, `rejected`, `no-improvement`, `failed` and `outcome-unknown`. Only the latter needs reconciliation before new side effects. Never infer publication or cleanup from an accepted HTTP request.

## Model and Sandbox boundaries

Default evaluation model: `nvidia/nvidia-nemotron-3-nano-30b-a3b`; exact model and approved Nebius hostname are explicit configuration. Default inference endpoint is `https://api.tokenfactory.nebius.com/v1/chat/completions`. Check model availability read-only before the live batch. A regional endpoint may be selected explicitly after that check; no silent regional/model switching. Use `store:false`, non-streaming `response_format` JSON schema, `additionalProperties:false`, `temperature:0`, `max_completion_tokens:2048`, a 60-second deadline and at most 64 KiB serialized request. One POST per attempt, no automatic retries. Refusal, truncation, returned-model mismatch, invalid JSON or unknown evidence yields no patch. Missing usage yields unavailable cost and blocks an economical-success claim.

Sandbox transport uses its own bearer credential plus `Project` header. Do not assume inference API-key entitlement. Use `POST /instances`, `shell:false`, `preserve_env:false`, explicit minimal environment, `networking:{enabled:false}`, `disposable:true`, 600-second operation timeout, and 1 MiB output cap. A trusted Node harness receives a bounded base64 stdin payload containing the approved public source/profile, validates its digest and paths, then executes the fixed profile. No persistent upload or download endpoint is needed for v1.

An approved execution image contains pinned Node/pnpm, the trusted harness and an offline dependency store. Phase 4 supplies a manifest-only image build context: dependency preparation has no project source, hooks, credentials or `.pnpmfile` code; original repository commands execute only inside the offline disposable verification instance. Image preparation/import and retained image cost are explicit live-proof prerequisites, separately bounded and recorded. An unavailable image produces instructions to prepare the generated context and register its resolved UUID; it does not fall back to running project code on the host. Tests needing network/native preparation outside this profile are unsupported, not weakened.

Image authority has two gates when no approved image exists: approve provisioning against the reviewed context/recipe digest, project, resource limits and retention policy; then read back the produced OCI digest/provider UUID and bind the execution permit to them. No provider UUID is required before import. An existing approved image may skip provisioning after readback. Execution cannot begin with a recipe digest alone.

Follow only same-origin `Location` values within `/sandboxes/v1/operations/`. The operation enum is `PENDING`, `ASSIGNED`, `EXECUTING`, `SUCCESS`, `FAILED`, `CANCELLED`; successful instance output is `metadata.result`, with process state and encoded stdout/stderr. `SUCCESS` alone is insufficient without exit 0, no signal/timeout/truncation and a valid harness report. Poll with a bounded interval and deadline; cancellation uses DELETE on the same operation and requires terminal readback. Unknown terminal state remains unresolved, with a visible reconciliation command. Disposable runs avoid persisted result images; the approved base image is retained inventory, not claimed deleted. Record provider cost only when units/currency are established; never treat an undocumented numeric `resources.cost` as USD.

## Verification and claims

Sandbox verification checks identical commands, test identities/counts/outcomes, skipped tests and per-file coverage denominators/counters on the same source. A cache-only change must preserve all of them. It validates behavior; it does not emulate GitHub's cache service or prove faster CI.

GitHub measurement requires three baseline and three candidate successful attempts on the same source-tree digest, lockfile, workflow job contract, runner OS/architecture/image and runtime versions, with no other changes except the allowed workflow patch. An authorized comparison manifest fixes the run cohort before results are inspected. Include the first cold candidate run and subsequent cache observations; no hidden warm-up or omitted failures. All required checks pass, executed/skipped test sets match, and coverage counters do not regress. Require total rounded job minutes to fall by at least one minute across the three samples and median job elapsed time to fall by at least 10 percent. Compare full job time, including cache save/restore overhead, and disclose maximum queue/end-to-end time. Missing identities, unequal denominators or a failed sample block `measured-improvement`.

A supported patch with no measured benefit ends `no-improvement`, retains evidence and cannot produce a savings PR. Performance claims apply only to these samples. For public code, actual GitHub list saving is zero; report reduced rounded execution minutes and elapsed time, not money saved. Private financial claims require known pricing/allowance context and all provider/inference costs; this plan does not certify invoice reduction or fix H3.

## Phases and work units

| Phase | Deliverable | Acceptance |
| --- | --- | --- |
| [1](2026-09-29-nemotron-workflow-optimization-phases/phase-1.md) | Immutable contracts, safe workflow parser and evaluation corpus | Strict provenance and eligibility; unsafe fixtures rejected |
| [2](2026-09-29-nemotron-workflow-optimization-phases/phase-2.md) | Read-only evidence collection and real Nemotron diagnosis adapter | Provider contract/error tests; no model decision means no proposal |
| [3](2026-09-29-nemotron-workflow-optimization-phases/phase-3.md) | Deterministic cache patch and local evidence lifecycle | Only two permitted inputs change; all protected semantics equal |
| [4](2026-09-29-nemotron-workflow-optimization-phases/phase-4.md) | Real Sandbox verifier, harness and recovery | Offline isolated execution, paired quality evidence and terminal accounting |
| [5](2026-09-29-nemotron-workflow-optimization-phases/phase-5.md) | GitHub comparison, report and gated idempotent PR delivery | No unsupported claim/publication; exact-run proof and recovery tests |
| [6](2026-09-29-nemotron-workflow-optimization-phases/phase-6.md) | Bounded live proof and feature documentation | Real NVIDIA decision, Sandbox proof, measured improvement and PR readback |

Phase execution and acceptance are sequential. Independent units are identified in phase files; shared dispatch/export/package changes belong to one integration owner. `[batch-eligible]` never means remote branch publication. Every phase follows TDD, independent review, repair, simplify and sequential verification. Do not advance with unresolved review findings.

Current local acceptance: Phase 1 at `23a8cf7145a060fbbba0641e5de104e11f82ac27`; Phase 2 at `0d3d7023ab0daa766e5450e57a260033de19b41c`. Phase 3 at `8ddc1fb10040292f9f1d29b310474c06f9f862f3`. Phase 4 at `fe114c9980a6b5c39732dc4dbf7b0a3be301d26a`. Phase 5 at `a1e38d775b0799064eac0d28c97d2db780ad053f`. All five passed their complete local gates. Phase 6 source and bootstrap decision preparation passed the complete 16-command local gate on `33d82a92188b2df6accb2bf7fe49d7f83d1603e6`, including 1,253 repository tests and 13 benchmark tests. On September 30 the owner approved all named bounded proof actions. The public benchmark's exact baseline is confirmed on `main`; full preparation and native acceptance remain pending actual image and credential access. Production publication and scope expansion remain unauthorized. The companion notes retain exact authority, evidence and unresolved live proof.

## Required local gates

Run every phase's focused tests first, then all of: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run test:coverage`, `pnpm run build`, `node scripts/verify-bundle.mjs`, and `git diff --check`, sequentially with aggregated exit statuses. Stage/commit the rebuilt Action bundle with source before the parity check when it changed; never weaken the check to ignore a stale bundle. Capture source SHA and any uncommitted diff digest, command, exit and log path. Do not run gates that require an external permit as though they were local checks. Existing runner boot/provider code is untouched; any discovery requiring that scope adds its applicable boot/schema gates before implementation.

From Phase 4 onward, also run `pnpm run verify:optimization-harness-linux`: the actual trusted harness against owned inert fixtures on the existing cached local Linux Docker image, without image pull or account calls. This proves the tested local UID/process boundary, not Token Factory isolation.

From Phase 3 onward, also run the pinned `pnpm run verify:optimization-actionlint` gate after build. It checks all eligible generated fixture patches with actionlint 1.7.12. Phase 6 runs the same local gates on the final integrated candidate before any authorized external proof. Failed remote runs are evidence: diagnose locally, stop the live batch and seek new authorization only after all local repairs pass. No remote rerun/fix-and-repush loop. A prior phase's passing result cannot cover changed inputs.

## Consumer sweep

Search commands executed: `rg -n 'runCli\(|rankWorkflowUsage|billableMinutesForJob|summarizeBillableMinutes|redactSecrets|redactCredentialShapes' packages --glob '!**/dist/**' --glob '!**/node_modules/**'`; `rg -n '^export|^function|^async function' packages/cli/src/{args,cli,telemetry,fleet-service}.ts`; Graphify queries preceded source inspection.

| Consumer/writer | Disposition |
| --- | --- |
| `packages/cli/src/bin.ts:5`, `packages/cli/src/cli.test.ts:1`, `packages/cli/src/runner-service.test.ts:119`, `packages/cli/src/fleet-service.test.ts:326` | Phases 2-5 preserve runCli injection compatibility; new service appended, all suites run |
| `packages/cli/src/args.ts:160` and argument tests | Phases 2-5 extend discriminated union and help; cover every command, duplicate flag and usage failure |
| `packages/core/src/index.ts:3`, `packages/core/src/index.test.ts:1` | Phases 1/3 export new contracts; preserve billing API and test it |
| `packages/action/src/main.ts:19`, `packages/cli/src/cli.ts:99`, `packages/cli/src/telemetry.ts:732`, billing tests | Existing billing output unchanged; full regression gate and bundle parity |
| `packages/runner/src/adapters/process.ts:74`, `packages/runner/src/adapters/github.ts:545`, `packages/cli/src/runner-service.ts:915`, journal/report tests | Existing redaction API unchanged; new artifacts use typed scrubbing and test usage counters survive |
| `packages/cli/src/telemetry-store.ts:27`, `packages/cli/src/fleet-service.ts:617`, telemetry fixtures/scheduler | Explicitly excluded from format changes; no optimizer state stored in telemetry/registry files |
| New optimization fixtures, evaluation runner, private artifact writer, report renderer, Sandbox harness and image-context builder | Phases 1-6 must all use the same versioned decoders and digest contract; malformed fixtures are explicit negative tests |
| `packages/cli/scripts/bundle.mjs:5`, `packages/action/dist/index.cjs` | Build/smoke/parity gates; no optimizer credential requirement for existing CLI or Action |

## Stuck states and recovery

| State | User-visible result and recovery | Required test |
| --- | --- | --- |
| Unsupported/already cached/insufficient evidence | Reason, missing prerequisites and collect/diagnose command; no edits or inference | `unsupported-no-effects`, `already-cached-no-change`, `collect-more-evidence` |
| Missing credential, model unavailable or entitlement absent | Name the source-specific setting and retry command after configuration; never print value | `credential-recovery`, `model-unavailable`, `sandbox-entitlement` |
| Inference 429/5xx/timeout/refusal/invalid schema | Failed attempt and uncertain usage; no automatic retry; a new authorized attempt is explicit | `provider-errors`, `timeout-unknown-spend`, `invalid-model-output` |
| Stale input or modified local output | Recollect/repropose with new digest; retain old evidence, do not overwrite success | `base-drift`, `artifact-tamper`, `profile-drift` |
| Held lock/crash between artifact writes | Show operation ID; status recovers from journal; complete atomic artifacts only | `lock-contention`, `interrupted-stage-resume` |
| Missing image/offline dependency or unsupported verification | Show generated preparation context/profile limitation; no host or network-enabled test fallback | `image-unavailable`, `offline-dependency-disclosure` |
| Sandbox pending, deadline or interrupted POST | Journal known operation; status/cancel reconcile; unknown creation outcome stops new creation | `sandbox-cancel-readback`, `spawn-outcome-unknown`, `crash-after-create` |
| Truncated report, weaker quality or failing check | Explicit rejected/incomplete result; retain evidence, rerun only under new bounded authority | `truncated-result`, `coverage-denominator-loss`, `test-removal` |
| Insufficient/no improvement or incomparable GitHub runs | Explain missing cohort/identity or measured regression; report stays available, publication blocked | `incomparable-cohort`, `no-improvement`, `failed-sample` |
| Missing publication permit/base drift | Show exact reviewed PR artifact/ref changes needing approval; no remote write | `publish-unapproved`, `publish-ref-drift` |
| PR timeout or existing marker | Query exact repo/base/head/marker; return same PR or remain outcome-unknown; never duplicate | `publish-response-lost`, `publish-idempotent`, `duplicate-marker-conflict` |

## Final acceptance and durable handoff

Local completion and live completion are separate statuses. H1 closes only after all six phases pass, including a real NVIDIA response that determines the accepted operation, actual Sandbox executions, matched GitHub evidence, and readback of one authorized unmerged PR. A model receipt alone, mock-only verification or a prepared PR file does not close H1.

Implementation authorization, live account availability, a prepared image UUID and publication permissions are execution prerequisites with explicit failure behavior, not unresolved architecture choices. The completion design and first optimization family are decided. Failed live compatibility or no-improvement outcomes keep H1 open; do not change model, target or patch family silently to manufacture success.

At planning start the assessment was untracked and preserved. No code, dependency, runtime, registry or remote mutation was made by planning. A bounded independent investigation verified primary-source model/Sandbox contracts; the root resolved the operation schema via official Markdown. Plan review results and final reference checks are recorded in the companion notes. On resume revalidate source/ref state, instruction files, assessment scope, provider contracts and all evidence identities. Next action is authorized Phase 1 implementation, not a live proof or publication.
