# Phase 1: Evidence sidecar and rules-only inbox

Parent: [accepted contract](../2026-10-28-jev-advisory.md). Source baseline and authority are inherited from the parent; revalidate on entry.

## Scope and files

Create `packages/cli/src/advisory/{contracts,collect,rules,render,arguments,service}.ts` with colocated tests and `packages/cli/fixtures/advisory/`. Wire `args.ts`, `cli.ts` and their tests. Use existing bounded GitHub GET, private storage and core hashes/arithmetic unchanged. Add schema/status reader at this phase so every collection outcome is inspectable. Do not change telemetry, runner or optimize schemas.

## Behavioral specification

Fixtures include supported literal jobs, misleading job names, synthetic matrix/reusable/PR unsupported mapping, duplicate names, malformed blobs, incomplete timing, zero-duration job, private metadata, malicious strings and stale source. Collector validates repository/run/attempt/path/head identity, reads workflow at exact SHA, validates selected job key/name and records step timing. Source-file opt-ins are relative regular blobs only, never symlinks/submodules; no package scripts execute. Unsupported mapping yields partial metadata with no source attribution. Public GitHub-hosted execution charge is zero; public self-hosted provider charges are not zero; without a price basis no monetary saving is computed.

Map executed steps using unique literal names and stable order, excluding synthetic setup/post-action steps. Duplicate names, expressions or composite/reusable expansion remain unmapped; never join by API ordinal alone. Test misleading post-action offsets and duplicate-name recovery/disclosure. Rules classify exact command tokens from validated source only; unknown wrappers remain unknown. Repeated commands are observations with both references. Render line links at pinned SHA and run/attempt/job links, escape Markdown/control characters, keep missing values explicit. Default inbox lists all supplied bundles ordered by duration, not estimated savings. Each card names supported/unsupported automation as advisory-only; no optimize invocation.

```text
@ collectSelectedJob(request) -> EvidenceBundleV1
ctx: bounded GitHub GET and private operation store
pre: validated explicit repository/run/attempt/job selection
do:
  1. validate exact run identity and completed job metadata
  2. lookup workflow and selected blobs at verified source SHA
  3. compute evidence digests and deterministic timing
  4. write immutable bundle and emit complete or partial status
fail: unsafe or contradictory identity -> visible refusal
```

## Oracles

`collect.test.ts`: altered blob/hash/attempt never binds; incomplete mapping never acquires an executed-source claim; repaired fixture succeeds. `rules.test.ts`: 60s install/120s job yields 50% and investigation flag; 5s/120s does not; missing time yields null. `render.test.ts`: exact pinned references, no executable untrusted command, stable sort and limits. `service.test.ts`: end-to-end fixture collection→inbox→status, no provider/network on inbox; legacy CLI snapshots unchanged. `contracts.test.ts`: strict required fields, size limits, duplicate evidence IDs and digest tampering.

## Work units

Sequential contract/schema freeze by integration owner. Then collector and tests [batch-eligible] own `collect*`; rules/render and tests [batch-eligible] own `rules*`, `render*`; integrator owns arguments/service/shared CLI and fixture index. No shared fixture file edits across workers. Merge locally and verify the combined candidate.

## Verification and acceptance

Run the main plan's full sequential local gates after review, repair and simplify; retain exact commit/tree and outcomes. No hosted runs, provider inference or publication occurs implicitly. Stop for phase acceptance. Manual criterion: optional owner inspection of the generated fixture report for clarity; all correctness/recovery criteria are automated. Proposed test/artifact paths below must be created in this phase, not treated as existing evidence.

## Implementation acceptance — 2026-10-28

- [x] Evidence contracts, immutable collection and rules-only inbox.
- [x] CLI integration, status and automated recovery coverage.
- [x] Independent review P1-R1–P1-R8 resolved; simplify complete.
- [x] Full local gates passed with retained failed-run history; 1,868 passing tests across all packages.

Exact candidate, deviations, review dispositions and evidence are recorded in [implementation notes](../2026-10-28-jev-advisory-notes.md). Owner authorized continuation to phase 2.
