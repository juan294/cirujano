# Phase 5: measured GitHub proof and reviewable PR delivery

Parent: [plan](../2026-09-29-nemotron-workflow-optimization.md). Entry: accepted Sandbox evidence contracts. Scope: read-only measurement, local reports and a separately gated publication adapter.

## Changes

Proposed core `optimization/measurement.ts`, `report.ts`; CLI `optimization/measure.ts`, `publish.ts` and their tests. Add an owned fixture reporter that emits normalized test/coverage evidence in a GitHub artifact. It must run unchanged in baseline/candidate workflows and carry tool/source/profile hashes. A missing reporter artifact produces incomplete verification; exit 0 alone is insufficient.

`optimize measure` consumes a predefined cohort manifest of three base and three candidate run IDs/attempts and performs only GitHub reads. Authenticate each run against repository ID, head SHA, selected workflow blob, exact job/step identities, runner/runtime versions and matching non-workflow source tree. Reject skipped/cancelled/failed jobs, missing required checks, unrelated reruns and incomplete timing. Read artifacts from those exact run IDs, validate size/hash/schema and reject unsafe ZIP members before extraction.

Preserve all six samples and cold/warm observations. Use `billableMinutesForJob` from `packages/core/src/billing.ts:40` for whole-job rounding, including cache overhead. A passing result requires the parent's unchanged quality checks, at least one fewer rounded minute in aggregate and at least 10 percent lower median elapsed job time. Baseline and candidate run cohorts must be fixed before inspecting results; a failed sample is retained and fails the comparison. No automatic dispatch or rerun. Public-repository time improvement never becomes a positive dollar saving.

The report includes diagnosis, exact two-input diff, real model identity/usage, Sandbox checks, paired GitHub links, raw sample table, inference/Sandbox cost status, claim limitations, cold/warm behavior and manual rollback patch. Derive text from validated typed evidence; model explanations are escaped prose, never privileged Markdown/HTML instructions. Private names and raw input are excluded from public exports.

`optimize publish` requires a reviewed report digest and permit bound to repository, existing head/base refs and SHAs, proposal/evidence hashes, expiry and one creation. It does not push a branch. Re-read both refs and diff, check all gates and query an exact idempotency marker before creating one unmerged PR. If a matching PR exists, return it without comment/update. A conflicting marker or uncertain POST response blocks new creation until read-only reconciliation finds a unique match or the owner renews authority. Read back final URL, refs and body hash. Never merge, enable auto-merge, dispatch, close another PR or mutate unrelated issues.

For this repository's operating policy, demonstration branches must be already-authorized documented integration refs. All local code gates and Sandbox verification happen before any request to push the completed candidate. A finalized candidate can be integrated to a non-production demonstration repository's `develop`, measured there, then proposed to its unchanged `main` without merging. Inspect every workflow/deployment trigger before that authorized push. No experimental working branches are published.

```text
@ publish(verifiedEvidence, report, permit) -> publicationReceipt
pre: measured-improvement and exact approved public or private destination
do:
  1. validate report digest and current base/head source identities
  2. lookup exact repository, refs and proposal marker
  3. emit one PR create only if no prior matching publication exists
  4. lookup and record the confirmed PR URL and body/ref hashes
br: lost response -> read-only reconciliation, never another blind create
fail: drift or missing authority -> local report retained with recovery command
```

## Work units and acceptance

U1 comparison engine and U2 report renderer are `[batch-eligible]` after the artifact schema freezes, with separate files. U3 GitHub artifact reader/publication orchestration follows those units; root owns dispatch integration.

Tests exercise real comparison/renderer/decoders against recorded external-response shapes. Mutants alter a SHA, run attempt, runner version, coverage denominator, check status, output cost unit, sample membership and job timestamp: every affected gate fails. Rounding edge cases at minute boundaries, cold cache regressions, unknown cost, private/public pricing and no-improvement outcomes have exact assertions. Malformed artifacts and ZIP traversal fail before filesystem writes.

Publication transport tests assert zero writes without matching permit or proof, exactly one POST for success, no duplicate POST after response loss, accurate conflict messages and successful status reconciliation. Public export contains no private fixtures or credential canaries. Run every parent local gate after independent review and simplify. No remote publication is performed to satisfy local tests.

## Exit

Local feature can now prepare a complete reviewable PR and execute an authorized publication, but H1 remains open until Phase 6 proves the real providers and outcome. Stop at phase acceptance.
