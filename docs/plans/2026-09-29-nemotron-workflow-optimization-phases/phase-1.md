# Phase 1: immutable evidence and one supported workflow shape

Parent: [plan](../2026-09-29-nemotron-workflow-optimization.md). Entry: explicit implementation authorization, current `develop` revalidated against planning SHA, clean isolated task worktree. Scope is local pure logic and fixtures.

## Changes and ownership

Create proposed `packages/core/src/optimization/contracts.ts`, `workflow.ts`, `canonical.ts`, corresponding tests and `packages/core/fixtures/optimization/`. Add the direct `yaml` v2 dependency, lockfile entry and core exports through one integration owner. Do not modify fleet extraction or telemetry schemas. Existing entry points are `packages/core/src/index.ts:3` and `packages/cli/src/fleet-service.ts:635`.

Define strict versioned decoders for the parent artifact contracts and lifecycle statuses. Validate IDs, timestamps, full SHA/digest shapes, bounded UTF-8 strings, finite nonnegative metrics, unique evidence/test IDs and complete provenance. Canonicalize recursively sorted JSON without accepting duplicate keys or prototype-bearing records. File hashes cover exact bytes. Unknown/extra operation fields fail closed.

Parse YAML 1.2 through the document AST. Reject parse errors, duplicate keys, aliases, custom tags, multi-doc input and source-range ambiguity. Enumerate an exact selected job/step and assess the parent's v1 prerequisites. Freeze all workflow semantics outside the two allowlisted setup-node inputs; eligibility does not imply a model diagnosis or a verified saving.

Create 21 named evaluation cases with a machine-readable expected disposition and gate: six eligible pnpm cache opportunities, one structurally eligible case with negligible install cost and evidence supporting model abstention, six prefilter no-change/unsupported cases (already cached, disabled cache, no timed baseline, unknown dependency path, setup order, matrix), and eight adversarial cases (prompt injection, unknown evidence ID, changed test command, changed permission, YAML alias, duplicate key, path traversal, secret-bearing configuration). Mark prefilter cases as requiring zero provider calls and model evaluation not applicable. Response attacks enter only at the external transport test boundary. Add separate mutation fixtures for cache-output consumers, aggregate/dynamic steps-context access, missing checks, coverage-file loss and altered immutable inputs. Fixtures contain no real private identities or credentials.

```text
@ inspectWorkflow(bytes, evidence) -> eligibility
pre: immutable source identities and bounded input
do:
  1. validate artifact schema and exact content digests
  2. parse one YAML document with strict node checks
  3. compute target prerequisites and protected structural digest
  4. emit eligible operation inventory or named refusal
fail: unsupported syntax or missing evidence -> no executable operation
```

## Work units

- U1 contracts/canonicalization and U2 workflow parsing are sequential until shared types settle; use one owner for this small core.
- U3 fixture catalog/review rubric can be `[batch-eligible]` after contract acceptance, owns only fixture data and its manifest. It must not redefine schemas. One integration owner handles exports, dependency and lockfile changes.

## Automated acceptance

Write failing tests before each behavior. Every fixture has exact expected reason/status. Valid eligible input survives canonical round-trip; changing one protected byte/field invalidates its digest. `on` remains a YAML string key. Unsupported/secret inputs yield no patch or provider capability. Tampered evidence IDs, absolute/parent/symlink paths and duplicate keys fail. Existing billing/core tests remain unchanged and pass.

Run focused core optimization tests, then every parent local gate sequentially. Record the tested SHA/diff identity and rebuilt bundle parity. Coverage must include failure/recovery paths without new exclusions.

## Manual acceptance and exit

No manual operation is required. Independent review verifies the invariant and fixture expectations; resolve findings, run simplify, then final gates. Preserve notes and stop for phase acceptance. Phase 2 starts only after the strict contracts and corpus are accepted.

## Accepted implementation evidence

- [x] Immutable schemas, exact byte/Git blob hashes and source manifest.
- [x] Strict YAML eligibility and protected semantic digest.
- [x] 21-case corpus and separate mutation fixtures.
- [x] TDD, independent review, repaired findings and simplify.
- [x] All seven local gates on `23a8cf7145a060fbbba0641e5de104e11f82ac27`, Node 22.20.0.

Full receipts, deviations and next-phase boundaries are in the parent notes.
