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
