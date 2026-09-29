# Nemotron optimization planning handoff

Date: 2026-09-29. Parent: [implementation plan](2026-09-29-nemotron-workflow-optimization.md).

## Objective, scope and identity

The user requested `/rpi-plan` to complete readiness item 1 and explicitly selected one safe optimization family end to end. The plan chooses pnpm store caching and covers a real NVIDIA diagnosis, constrained patch, Sandbox quality verification, GitHub measurement and authorized unmerged PR delivery. It preserves H2-H6 as separate work. No implementation or external execution was authorized in this planning request.

Planning began and ended on `develop` at `91b7908cb8ff1a23e115f346799a1208f4da342d`, `/Users/juan/code/cirujano`. The existing untracked readiness assessment was read and preserved. The only changes from planning are the master plan, these notes and six phase files. There were no code/configuration/dependency edits, credential reads, paid inference, Sandbox execution, pushes, dispatches or PR mutations.

## Accepted design decisions

- One operation family: add pnpm cache inputs to an existing eligible setup-node step; preserve all existing installation/test/check commands.
- Keep Coding and Agentic Engineering positioning with an actual Token Factory Sandbox backend.
- Use the documented NVIDIA Nano model as the configurable evaluation candidate, with no automatic fallback/escalation.
- Keep deterministic unsupported-input rejection before inference; separate policy and live-model evaluation denominators.
- Keep Sandbox quality evidence separate from GitHub cache performance evidence and from financial savings claims.
- Keep all working branches local; completed integration publication and final PR creation need their actual explicit authority.
- Require the full live evidence chain to close H1. Local code completion alone is a separate status.

## Investigations and resolved limits

The parent queried Graphify before source exploration, then inspected current CLI dispatch, billing arithmetic, GitHub read transport, YAML extraction, redaction/journal utilities, package/build setup, CI and the accepted assessment. A bounded read-only subagent verified model/API/track and Sandbox sources. Its investigation did not call either paid provider.

The Sandbox HTML operation page failed through the web reader. A direct read-only curl request to the official [operation Markdown](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/get-an-operation-status.md) succeeded. Its embedded OpenAPI established the effective `/sandboxes/v1/` prefix, six operation statuses, `metadata.result` output and nullable result image. This resolved the material API uncertainty before finalization. The plan avoids unspecified file-download/deletion APIs by using bounded stdin/stdout and disposable verification instances; retained base images remain explicit inventory. No unverified provider cost unit is treated as USD.

Account-level model availability, schema compatibility, image availability, Sandbox isolation and actual optimization benefit were not tested live. They are explicitly checkable Phase 6 execution criteria with failure behavior, not assumed successes.

## Independent review

Reviewer scope: read-only master and six phases plus bounded source checks; no edits or external effects. Initial review returned three findings:

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| PLAN-01 | P1 | Enabling caching changes action outputs even if later YAML is unchanged | Resolved: require idless target setup-node, reject direct/indirect/aggregate/dynamic output consumers before inference, add regression fixtures |
| PLAN-02 | P1 | Model-abstention requirement contradicted zero-call deterministic prefilter | Resolved: 21 policy cases, seven eligible live-model cases, eight-call live ceiling including held-out case; report each denominator separately |
| PLAN-03 | P2 | Provider image UUID required before authorized import | Resolved: approve recipe/context provisioning first; bind UUID/digest readback before execution authority; add gate transition test |

The independent reviewer reread the repaired plan and reported all three resolved, no remaining implementation-plan blockers, and no contradictions from the additional action identity, required-check inventory, permission or CLI contracts. No review finding was silently discarded or accepted as an architectural exception.

## Planning validation

- Confirmed all six linked phase files exist.
- Validated all cited local source paths and line numbers exist.
- Validated relative Markdown links and absence of unresolved clarification markers.
- Validated pseudocode blocks contain 5-12 lines in the prescribed notation.
- Ran `git diff --check`; no whitespace error reported. Because these are new untracked planning files, also inspected their text directly and ran the dedicated reference/structure validator over them.
- No implementation test suite was run: no production code changed. The plan explicitly requires sequential full local gates for every implementation phase and additional real-provider proof for Phase 6.

## Next phase and resume contract

The next step is explicit implementation authorization for Phase 1. Create an isolated task worktree from revalidated `develop`, preserve the plan/assessment, and follow its TDD/review/simplify/gate loop. Stop at phase acceptance unless continuation is explicitly authorized. Before any future external request, finish the concrete local artifacts and bind the requested action to exact candidate identities. Revalidate source, instructions and evidence after every resume; this handoff grants no external authority.

## Implementation authorization and working identity

On September 29 the owner authorized `/rpi-implement` for all six phases, followed by local integration into `develop` and task-worktree cleanup. The implementation uses `/Users/juan/code/cirujano-worktrees/nemotron-workflow-optimization`, branch `feat/nemotron-workflow-optimization`, from `91b7908cb8ff1a23e115f346799a1208f4da342d`. The original untracked plan and assessment were copied without changing the primary checkout; their hashes are preserved privately under `~/.local/share/cirujano/optimization/implementation-2026-09-29/planning-input-hashes.json`. No external execution or publication authority is inferred from implementation continuation.

## Deviations

### DEV-01: candidate identity before a Git commit exists

Plan said: proposed artifacts include the exact candidate SHA. Found: proposal generation precedes applying the local patch or creating that commit. Chose: `proposal.candidateSha` may be null while uncommitted; downstream Sandbox, measurement and publication artifacts require a complete SHA. Why: a file digest or fabricated SHA must not stand in for an actual candidate commit. Later binding must independently validate the exact allowed workflow change and unchanged source.

### DEV-02: immutable source snapshot and file modes

Plan said: bind exact file bytes and the source-tree digest; reject unsafe modes and symlinks. Found: collection has no profile-path flag and later stages need a complete retained source snapshot. Chose: owner profile path `.cirujano/optimization-profile.json` and a strict companion `source.json` manifest; its digest covers sorted path, safe Git file mode and exact byte hash, excluding only the selected workflow. Why: this preserves executable-mode identity, supports offline execution and keeps the fixed CLI contract. Limits are 5,000 files, 4 MiB per file and 16 MiB aggregate; sensitive filenames are rejected.

### DEV-03: CLI ESM bundle compatibility

Plan said: retain the existing CLI/build behavior with a direct YAML v2 dependency. Found: `yaml@2.9.0` exports CommonJS for Node and the existing ESM bundle fails during CLI smoke with a dynamic `require("process")`. Chose: repair the CLI bundle boundary with Node's supported `createRequire` API and exercise the actual bundled CLI outside its repository. Why: the installed CLI must carry its dependencies and continue to work without optimizer credentials. The first build failed and is retained as a failed local result; its repair must pass the full gate.

## Phase 1 review and simplify record

The bounded implementation owner wrote the strict core contracts, canonicalization, workflow parser and evaluation corpus. The parent independently reviewed their complete source and tests. Review repaired sparse-array/cycle canonicalization, control-character paths, source/provenance timing, explicit candidate identity timing, paired Sandbox quality, official action identity, inherited working directories, literal credential keys and existing-cache handling. The source manifest additionally binds Git blob identity and safe modes and uses a stable codepoint sort.

The parent performed separate reuse, quality and efficiency simplify passes. SIM-01 found that importing provenance from `contracts.test.ts` registered that suite twice. The owner moved the shared fixture into `optimization.test-helper.ts`, preserving every assertion. The focused suite now has 80 unique tests. No additional behavior-preserving simplification was justified by the other lenses. Full repository acceptance remains pending the repaired packaging gate.

## Phase 1 accepted local handoff

Accepted September 29 against source commit `23a8cf7145a060fbbba0641e5de104e11f82ac27`, clean `feat/nemotron-workflow-optimization` worktree at the path recorded above. The parent independent review and three simplify lenses are complete; all confirmed findings were repaired. The CLI CommonJS/ESM regression has an actual failing bundled reproduction and a passing standalone-bundle regression. No source finding remains open in this phase.

All seven required repository gates passed sequentially under a privately installed, official-checksum-verified Node 22.20.0 runtime: typecheck, lint, 654 tests, coverage, build, committed Action bundle parity and whitespace validation. Coverage by package (statements / branches / functions / lines): core 88.46 / 89.15 / 98.83 / 98.34; runner 83.49 / 79.38 / 95.04 / 92.54; Action 100 / 87.5 / 100 / 100; CLI 77.48 / 70.20 / 89.88 / 83.46 percent. No threshold or exclusion changed. The exact command/exit/source/runtime receipts and logs are outside the repository at `~/.local/share/cirujano/optimization/implementation-2026-09-29/phase1/results.json`. The initial failed CLI build remains in the RED packaging log; its successful repair does not erase that result.

The following documentation-only acceptance update preserves the tested code inputs. The next authorized phase is Phase 2, using these strict decoders and the fixed profile/source-manifest contract. Actual model availability, live inference, Sandbox execution, GitHub comparison and PR publication remain unproven and unperformed.

## Phase 2 accepted local handoff

Accepted against source `0d3d7023ab0daa766e5450e57a260033de19b41c`, with the same task branch/worktree and unchanged `develop`. Collection uses fixed-origin GET requests and retains exact Git tree/blob/file modes, baseline attempts, literal step timings, all job/check identities and the independently verified setup-node receipt (`packages/cli/src/optimization/github-read.ts:115`). Diagnosis independently checks retained source/profile/action/input identities before it previews or emits one permitted NVIDIA request (`packages/cli/src/optimization/service.ts:41`). Private source and collection receipts are copied through diagnosis so status can validate the original bindings. API credentials come only from `NEBIUS_API_KEY` or the explicit test transport boundary; no live call was made.

The Phase 1 owner served as independent Phase 2 reviewer and approved the final source after R2-1 through R2-8 were repaired. Findings covered large-source JSON bounds, provider finish-reason redaction, timed baseline/operation prerequisites, intent deadlines, original-input status binding, strict preview/config reread, supported help recovery, and collection receipt anchoring. Each has a regression; actual failing and passing results are preserved privately. Root also covered appended CLI service dispatch, usage failures, global permit consumption, symlink/private modes and crash status. All 105 focused CLI optimization tests and 83 core optimization tests passed.

Three separate simplify lenses were completed. Reuse removed the duplicated optimization argument interface in favor of the shared parser type. Quality and efficiency found no additional justified behavior-preserving change. The exact assignment, TDD, review and simplify record passed `rpi-dispatch.py` validation for this source; structural validation did not replace the root's source and log inspection.

All seven repository gates passed sequentially on the clean committed candidate under the verified Node 22.20.0 runtime: typecheck, lint, 762 tests, coverage, build, Action bundle parity and whitespace. Coverage (statements / branches / functions / lines): core 89.23 / 89.89 / 98.86 / 98.37; runner 83.49 / 79.38 / 95.04 / 92.54; Action 100 / 87.5 / 100 / 100; CLI 80.51 / 74.03 / 91.08 / 86.65 percent. No thresholds or exclusions changed. Receipts and logs are under `~/.local/share/cirujano/optimization/implementation-2026-09-29/phase2/results.json`; GitHub unit logs were also copied there before eventual worktree cleanup.

The following acceptance update is documentation only. Phase 3 can now build the deterministic patch editor from the accepted collection/diagnosis contracts. Model entitlement and actual strict-schema compatibility remain unproven until authorized Phase 6 execution.

## Phase 3 accepted local handoff

Accepted source `8ddc1fb10040292f9f1d29b310474c06f9f862f3` on the recorded task branch/worktree. The deterministic editor preserves original bytes outside its AST insertion, emits an applicable localized patch, and independently verifies the complete two-input semantic change (`packages/core/src/optimization/patch.ts:1`). Proposal and status independently validate the original retained collection, model request/receipt, terminal diagnosis digest, candidate bytes, exact patch, profile and patch receipt (`packages/cli/src/optimization/propose.ts:20`). Proposal generation makes no source checkout edit and emits no provider request. Candidate commit identity remains null until an actual commit is independently bound, as DEV-01 specifies.

Independent reviewer `phase1` approved the final source after four findings were repaired. R3-1 added a literal workflow-path allowlist. R3-2 moved an ambient external-tool unit check into the explicit pinned actionlint phase gate; unit suites stay hermetic and all 11 eligible generated patches receive the required real validation. R3-3 separated copied diagnosis intents from the current local-stage journal so interrupted local proposal writes do not imply new paid activity. R3-4 bound the actual validated diagnosis content digest in the terminal inference intent; a schema-valid rewritten decision now fails downstream validation. Failing and passing regression evidence is retained privately. No finding remains unresolved.

Three separate simplify lenses completed: reuse extracted shared retained-input/diagnosis validation and private byte/text IO; quality preserved distinct local/model journals and exact decision anchoring; efficiency avoids a duplicate retained source read for the same input path and retains explicit source/output bounds. Shared synthetic provenance lives in the fixture manifest rather than an unavailable compiled test helper. The first actionlint script attempt failed on that unavailable helper import; the repaired shared-data implementation passed. That failed result is not presented as a success. The structured assignment/TDD/review/simplify record passed `rpi-dispatch.py` for this candidate.

All eight local gates passed sequentially under verified Node 22.20.0: typecheck, lint, 813 tests, coverage, build, actionlint 1.7.12 across all 11 eligible patches, committed Action bundle parity and whitespace. Coverage (statements / branches / functions / lines): core 90.09 / 89.54 / 98.95 / 98.63; runner 83.49 / 79.38 / 95.04 / 92.54; Action 100 / 87.5 / 100 / 100; CLI 80.8 / 74.86 / 91.45 / 86.94 percent. No thresholds or exclusions changed. Full receipts/logs are under `~/.local/share/cirujano/optimization/implementation-2026-09-29/phase3/results.json`; focused review/RED/GREEN/dispatch evidence is preserved beside them. The worktree was clean at the tested source.

The following acceptance update changes only plan documentation. The next authorized phase is Phase 4. Official Sandbox inspection exposes no resolved OCI digest or harness labels; image execution must use an independently approved immutable import receipt and bounded readback of trusted image files. Request assertions alone will not establish live isolation or cleanup. Those remain unperformed Phase 6 criteria.

## Phase 4 accepted local handoff

Accepted source `fe114c9980a6b5c39732dc4dbf7b0a3be301d26a` on the recorded branch/worktree, with unchanged primary `develop`. The real REST adapter independently binds the complete provider request, image/import receipt, permit authority and operation identity before accepting output or cancelling (`packages/cli/src/optimization/sandbox.ts:1`). The paired verifier validates the actual committed candidate Git objects with replacements disabled, exact allowed patch, original checks, image and harness bytes, complete process state and fresh test/coverage reports (`packages/cli/src/optimization/verify.ts:1`). Status recomputes the artifact from retained validated evidence; it does not trust a success string. Lost create responses never cause a second create; a missing operation ID explicitly requires provider inspection.

The source-free image context rejects credential-bearing lockfile URLs and code-bearing Git/local/patch dependencies before output (`scripts/optimization/image-context.mjs:1`). This includes the pnpm ignore-scripts Git prepare advisory: unsupported dependencies are rejected without changing the original pnpm version. The deployed Linux harness runs source commands as UID/GID 65534 below an empty workspace, clones the trusted dependency store for writable use, captures child streams and emits only its own bound envelope (`scripts/optimization/harness.mjs:1`). Source files at either configured quality report path are rejected before execution, so no-op checks cannot reuse committed reports. The host rejects the same known unsupported payload before paid creation. SourcePaths currently identify individual files, not directories.

Independent reviewer `phase1` approved all nine repaired findings and transferred approval to the committed simplified source. R4-1 disabled Git replacement objects; R4-2 bound the complete request and authority digest; R4-3 rejected credential/code-bearing image inputs; R4-4 restored artifact/image validation in status; R4-5 required fresh ownership readback before DELETE; R4-6 isolated source UID from the trusted parent and explicitly requested provider UID 0; R4-7 disclosed no-ID provider inspection; R4-8 retained actual nullable truncation flags; R4-9 rejected preseeded quality reports. Actual RED/GREEN results, including the real Linux parent-stdout exploit and its repair, remain private. No finding is unresolved. Final focused optimizer suite has 264 tests; affected simplify rerun has 48.

Three independent parent simplify lenses completed. Reuse shares artifact/image validation between status and downstream readers; quality rejected style-only churn; efficiency uses a Map for source lookups and builds command inventory once per envelope. The bounded assignment/TDD/review/simplify record passed `rpi-dispatch.py` against this exact source.

All nine local gates passed sequentially on the clean source under verified Node 22.20.0: typecheck, lint, 960 tests, coverage, build, pinned actionlint for all 11 eligible patches, actual Linux harness, committed Action bundle parity and whitespace. Coverage (statements / branches / functions / lines): core 90.09 / 89.54 / 98.95 / 98.63; runner 83.49 / 79.38 / 95.04 / 92.54; Action 100 / 87.5 / 100 / 100; CLI 82.66 / 77.45 / 92.81 / 88.49 percent. No thresholds or exclusions changed. Receipts are `~/.local/share/cirujano/optimization/implementation-2026-09-29/phase4/results.json`; review, dispatch and focused logs are beside them. The Linux gate used the existing cached image `sha256:dd5847a04b0deee391fa145f1f4c6d214196668b6bcc7988ebed67249f226844`, Node 22.23.2 and explicitly synthetic inert pnpm. It proves that local process boundary only. No image download/build/import, paid request or account mutation occurred.

The acceptance documentation preserves tested source inputs. Phase 5 may now implement exact-cohort GitHub reads, comparison, reporting and separately permitted publication. Token Factory import, entitlement, network isolation, native output/cleanup, invoice cost units and GitHub performance remain unmeasured until the authorized Phase 6 live chain.
