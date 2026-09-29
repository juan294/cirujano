# Phase 3: deterministic pnpm cache patch

Parent: [plan](../2026-09-29-nemotron-workflow-optimization.md). Entry: accepted contracts and diagnosis service. Scope: local patch artifacts only.

## Changes and ownership

Create proposed core `optimization/patch.ts` and CLI `optimization/propose.ts`, plus tests. Expose `optimize propose` through the accepted optimization service. A diagnosis must carry a valid NVIDIA inference receipt, exact input digest, supported operation and matching evidence IDs; fixture injection exists only at the test transport boundary.

The editor adds precisely `cache: pnpm` and `cache-dependency-path: pnpm-lock.yaml` to the selected existing setup-node mapping. Preserve existing field values, order of jobs/steps and comments outside edited ranges. Use AST source ranges for localized edits; reparse and compare complete normalized trees afterward. If the editor cannot produce the exact two-field semantic change, reject it. Re-running against an already-patched workflow returns `no-change` without duplicating fields.

The source worktree is never changed by proposal generation. Emit a patch and versioned proposal with the protected semantic digest, base/candidate file hashes, evidence/provenance and verification requirements. A separate operator can review/apply it in an isolated worktree. Before applying or verifying, reread the base and refuse drift. The model cannot select another file, action version, runner, dependency, shell command, permission or trigger.

```text
@ propose(input, diagnosis) -> patchArtifact
pre: accepted model receipt bound to this input
do:
  1. validate diagnosis operation and all evidence references
  2. compute localized changes for two allowed mapping keys
  3. parse candidate and compare protected semantics
  4. write patch, candidate hashes and verification contract
fail: ambiguous target or any other semantic change -> rejected with no patch
```

## Work units

U1 core editor then U2 CLI integration are sequential because the CLI consumes the accepted patch contract. Adversarial fixture expansion is `[batch-eligible]` only in separate new fixture files with no schema changes; the root integrates exports/dispatch.

## Automated acceptance

Golden tests prove exact patch output and equivalent protected structure for all eligible cases. Negative tests cover step deletion, `continue-on-error`, changed permissions/conditions/triggers, removed install/test commands, coverage-threshold edits, dependency changes, nested lockfiles, duplicate cache keys, explicit disable, path escape and stale source. Reject setup-node targets with an explicit step ID, direct/indirect cache-output consumers and aggregate/dynamic steps-context expressions before inference; prove that an unchanged downstream cache-hit condition cannot enter the patch path. Reject a tampered inference receipt or arbitrary model diff. A comment containing a fake setup-node block cannot become the target.

Validate the generated YAML with both the strict AST and actionlint on the supported fixture. Add a pinned local actionlint invocation to the phase gate; if it is unavailable, install it locally through the approved package manager rather than skipping validation. Existing fleet YAML extraction remains unchanged and its tests pass. Run all parent gates sequentially after independent review and simplify.

## Manual acceptance and exit

No remote branch, PR or workflow execution. The reviewable result is the exact local patch with its evidence and guard verdict. Stop after phase acceptance; it is still unverified for behavior and performance.
