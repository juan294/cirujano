# Phase 2: coverage consumers and provenance

Parent: [CI cadence plan](../2026-10-02-ci-cadence.md). Entry: phase 1 accepted and explicit local phase-2 authority. Scope: F, one isolated worktree. No schema migration, remote ingestion, generated-artifact publication or deployment.

## Implementation

Add exact selected-repository cadence policy to existing producer registry/config. Keep legacy repositories strict. Implement policy-aware coverage fold using actual source SHA/time. For mismatching valid evidence, `pendingAnchor = min(sourceReportedAt, verifiedHeadChangedAt ?? sourceReportedAt)` and deadline is that anchor plus 36 hours. Repeated newer transitions cannot renew it. A first change after a quiet week may immediately be overdue; disclose next scheduled run. Quiet source freshness is eight days. No SQL addition. Missing valid source provenance earns no grace. Include deadline/reason and recovery text in output.

Shared reported metrics carry measured SHA/date/age. Operational comparison uses explicit operational mode; release/default mode remains strict. Update all rendered and generated metrics, including missing provenance, without claiming historical coverage validates current head. Latest-ingestion liveness stays separate from per-repo freshness. Admin aggregate selects newest row's repo identity plus timestamp: eight days only if enrolled, otherwise existing seven days. Add mixed-policy tests and correct misleading CLI text.

Producer audit accepts scheduled full-suite writers for enrolled repos and resolved tested SHA, while retaining fatal publication, authoritative command, exact branch/identity, secret transport and replay checks. Native publisher gets successful full suite artifacts once; batch reporter asserts default checkout before test and unchanged tested identity afterward. Preserve ingestion API, RPC and first-release strict SQL.

Artifact publisher sets `COVERAGE_REPORTED_AT` from immutable successful suite completion, never delivery time. Missing receipt time blocks. Delayed/reused output retains actual source SHA/run ID/workflow ref/attempt; unchanged skip does not publish and duplicate delivery retains replay/newer-only no-op behavior. Legacy producer defaults outside selected scope remain unchanged. Add delayed-delivery/reuse/no-op tests and old-quiet-report first-change/repeated-head timestamp recovery tests.

## Consumer sweep and dispositions

Exact parent search commands and expanded file:line inventory are in the ignored annex. All these units are owned by this phase:

| Unit | Existing source and fixture coverage |
| --- | --- |
| Fold/loaders/provenance/global health | `F/src/lib/health.ts:96`, `:262`, `:405`, `:478`, `:678`; health.test.ts and health-repositories.test.ts boundary fixtures. |
| Admin query/types/table | `F/src/lib/queries/admin-health.ts:55`, `:155`; `F/src/lib/types/admin-health.ts:11`; `F/src/components/admin/repository-health-table.tsx:12`; admin page and table/query fixtures. |
| Public grid | `F/src/lib/queries/projects.ts:64`, `:110`; `F/src/lib/types/projects.ts:6`; `F/src/components/projects/repo-card.tsx:149`; project/card fixtures. |
| Public detail | `F/src/lib/queries/project-detail.ts:81`, `:125`; `F/src/lib/types/project-detail.ts:32`; `F/src/components/projects/detail/test-health-card.tsx:57`; detail page at `:290` and corresponding page/query/card fixtures. |
| Artifacts | `F/scripts/generate-artifacts.ts:198`; `F/scripts/lib/build-context.ts:17`, `:62`; context tests; fixture-only generation, no publish. |
| Health API/cron/CLI | `F/src/app/api/health/route.ts:27`; cron health route `:54`; `F/scripts/check-freshness.ts:79`; `F/scripts/lib/health-output.ts:9`; boundary/output tests. |
| Comparison/release callers | `F/scripts/compare-production-metrics.ts:94`, `:500`, `:548`; comparison strict and operational fixtures; production release-health evaluator unchanged at `:25`. |
| Writers/auditor | `F/scripts/report-coverage.sh:9`; batch-report-coverage.sh `:85`; audit-coverage-producers.ts `:46`, `:61`; registry plus report/audit tests; native workflows coordinated by phases 3/5. |
| Test/DB/E2E fixtures | Coverage and health-sync contract fixtures, github-metrics-integrity and rls-behavior fixtures; `F/e2e/seed.ts:73` adds true reported provenance on task-owned local data; public/admin browser assertions. |

Explicitly unchanged: test-metrics-state's report-presence meaning (`F/src/lib/test-metrics-state.ts:3`); repo-list-row and public project metrics API have no coverage contract. Keep nonreported stats-grid/project-grid/header fixtures compatible. Ingestion writer `F/src/app/api/coverage/route.ts:330`, generated Supabase fields at `F/src/lib/types/supabase.ts:527`, central provenance names and Roots caller stay backward compatible. Initial-release SQL equality and signed/replay/newer-only behavior remain regression tested.

## Automated acceptance

Oracles: true old SHA pending; exact boundary overdue; repeated pushes do not postpone; quiet eighth-day stale; failed/cancelled/skipped suites do not refresh time; successful head clears state; missing/invalid/future timestamp disclosed; older/out-of-order report cannot replace newer; default/integration branch mismatch rejected; strict release comparison still rejects an operationally pending report. All public/admin/artifact paths preserve measured identity/time. API reconciliation failure remains independently degraded.

Run the annex's targeted Vitest list, then all F local required gates sequentially: typecheck, lint, check:architecture, quality:capabilities, quality:cadence, quality:combinations, quality:environments, test, test:coverage, build, size and test:e2e. Use task-owned local Supabase with local status-derived credentials; run coverage/health-sync/metrics-integrity/RLS contract tests explicitly and prove nonzero execution. A self-skipped DB suite is blocked. `git diff --check` last. Production/paid probes excluded from local gates.

## Manual acceptance, recovery and handoff

Review desktop/mobile screenshots showing current, pending, overdue and missing with actual measured date/commit and repair/next-run guidance. Tests show missing→fresh, pending→current and stale→fresh recovery, plus pending→overdue disclosure. Batch wrong-branch error names intended/actual branch and tells operator to use the actual default checkout; corrected fixture passes. Record all caller dispositions, candidate identity and gate evidence. Phase 4 must deploy this compatible consumer under separate publication authority before reduced producers activate; local tests alone do not prove deployed behavior.
