# CI cadence implementation notes

## Authority and preserved state

The owner invoked implementation, then authorized all-phase continuation with no phase-boundary stops, followed by a local merge to develop and worktree cleanup only when 100% of the plan is accepted. Exact external publication/settings, production, retry and paid-execution gates remain in the plan. No remote mutation is authorized or performed in this local preparation.

Cirujano base: `ff15dbb68ca4f481b12022159b84bf089ba665b6`, including the unrelated test-helper commit. Task branch: `feat/ci-cadence`. Task worktree: `/Users/juan/code/cirujano-worktrees/ci-cadence`. Existing untracked plan, phase and research documents were copied byte-for-byte into this isolated worktree; root checkout state remains preserved. Phase history is retained with the implementation. Develop integration and pruning are deferred until the owner's 100% condition is met.

## Phase 1

Phase 1 is accepted locally: implementation, independent review, repair, simplify and all required project/script gates passed. Phase 2 is the next authorized local phase. Native execution, activation, cost savings and invoice outcomes are unverified.

Added standalone helper/oracles and read-only measurement, shared synthetic fixtures, exact frozen manifest validator and [public contract](../ci-cadence-contract.md). Commands added to package.json: `pnpm run verify:ci-cadence` and `pnpm run validate:ci-cadence-fixtures`.

Source boundaries: `scripts/ci-cadence.mjs:21` validates policy; `:71` classifies events; `:154` validates full receipts; `:179` selects nightly disposition; `:201` checks supplied activation evidence; `:218` validates job graphs. `scripts/measure-ci-cadence.mjs:67` measures supplied records; `:251` collects only GET evidence; `:311` writes exclusive mode-0600 files. `scripts/validate-ci-cadence-fixtures.mjs:15` verifies frozen source/fixture bytes. No core optimizer/controller/cache/telemetry/registry contracts changed.

TDD evidence is retained in the ignored implementation evidence directory: initial policy RED/GREEN, measurement behavioral RED/GREEN, review regression RED/GREEN and frozen-validator RED/GREEN. All 75 new tests pass without skips on Node 22.23.3 and Node 24.21.0. Two independent scoped reviewers approved policy/oracles and measurement/validator; parent repair and simplify evidence remains separate from those approvals.

Review findings and dispositions:

| ID | Finding | Disposition |
| --- | --- | --- |
| R1 | Extra input metadata leaked through interval/target output | Resolved by output field selection and privacy regression |
| R2 | Push workflow count falsely represented publications | Resolved by explicit immutable publication ledger identity, owner aliases and unavailable rates when absent |
| R3 | Empty inventory and impossible dates could pass | Resolved by field validation; quiet declared repositories remain supported |
| R4 | Null/malformed fields threw generic exceptions | Resolved by shape and field diagnostics |
| R5 | Premature accounting could claim reconciled savings | Resolved by observations at/after accounting closure and recovery fixture |
| R6 | Multi-workflow jobs and delayed aggregate time could impersonate full fresh evidence | Resolved by unique job IDs, native per-workflow receipts and actual maximum completion time |
| R7 | Partial history could skip, retry known failure or exceed authorized retry bound | Resolved by complete-history reuse/bound checks and known-failure precedence |
| R8 | Legacy schedule ignored mode/helper guard | Resolved by disabling new nightly in legacy and initial installation |
| R9 | Fast graph accepted unknown application work or absent results | Resolved by exact bounded successful job/work inventory |
| R10 | Conflicting event fields and unbound activation identity affected authority | Resolved by native event shape, exact repository/context/definition and consumer/repair prerequisites |
| R11 | Native scheduled definition conflated with tested integration SHA | Resolved by separate native head and tested checkout identities, default-main/develop oracle |
| R12 | Frozen manifest could omit inventory and checksum code duplicated | Resolved by fixed sorted source inventory, mutation test and shared digest implementation |

Simplify: reuse consolidated checksum construction; quality retained explicit fail-closed states and typed shape guards; efficiency sorts each comparison side once. Further broad abstraction or style-only changes were rejected as unnecessary. Script tests, checksum and script lint are rerun after simplify; unchanged package inputs are bound separately to project gate evidence.

## Deviations

Plan said: tests/coverage precede build. Found: fresh-worktree process tests import runner dist and CLI standalone-bundle tests resolve the core default dist export. Initial test exited 1 with 16 controller failures; initial coverage exited 1 with three CLI tests and one suite failing on missing built exports. Chose: complete the required build successfully, then rerun full tests and coverage sequentially with original failures retained. Why: establish actual cold-worktree prerequisites without changing unrelated controller/optimizer source or weakening assertions.

Plan said: add standalone measurement and fixture definitions. Chose: place the actual reusable policy oracle in `scripts/ci-cadence.mjs` during phase 1 so fixtures exercise real classifier/graph results, then add a frozen validator with exact inventory and portable digest. Why: later repository copies need an executable common contract, and YAML presence alone cannot prove child results.

## Pending acceptance and next entry

Phase 1 tested code identity: `base:ff15dbb68ca4f481b12022159b84bf089ba665b6;contract:3c6a2a44caa1cfbfda2a4ffd2c5e3ad56e0814c5def7aedc717fa16fecf93b57;package:95fca910d3873adaa72e6d32792c8c752aa1c485cda84e593711af0853106b63`. Full project tests and coverage each executed 1,322 tests successfully; the new contract/tool suite executed 75 tests with zero skips. Native/platform evidence remains outside this phase. Frozen checksum: `3c6a2a44caa1cfbfda2a4ffd2c5e3ad56e0814c5def7aedc717fa16fecf93b57`. Phase 2 will start against F's reconciled integration inputs, preserving its unrelated local report commit and remote workflow/quality updates. It requires all provenance consumers, real task-owned local Supabase tests and desktop/mobile output review. Phase 3 depends on accepted phase 2. Phases 4/6 require concrete external operation authority and native observation; phase 5 depends on actual first-wave acceptance; phase 7 requires seven complete days after final accepted activation. These requirements remain acceptance work, not completed code-only gates.

Private identity/ref/status mapping, raw checks and rollout ledger are retained under ignored `docs/agents/2026-10-02-ci-cadence-implementation/`. They must remain local and be preserved before cleanup. Cost allocation is unmeasured, net savings is unavailable and zero monthly invoice is unverified.

## Phase 2 local candidate verified, acceptance unresolved

Consumer work remains isolated in F. Public provenance retains measured SHA/time and explicitly discloses unavailable observed-head evidence until the owner resolves the scope conflict. Phase 2 is not accepted.

### Discovered contract conflict

Plan said: no SQL additions, plus exact observed-head relation on all public metrics surfaces. Found: F public queries use the anon capability boundary; verified head and change time are service-only, with no existing public provenance RPC. Chose: preserve that boundary and request an owner decision between a narrowly scoped visibility-safe public RPC and an explicit public unavailable-head disposition. Why: service-role escalation or an inferred head from the append-only activity ledger would misrepresent evidence. No SQL or privilege changes have been made.

### Publisher activation compatibility

Plan said: compatible consumers deploy before reduced producers activate, and native cadence publication requires immutable successful-suite provenance. Found: the existing every-head native writer has no cadence receipt projection. Chose: consumer enrollment and writer activation are separate; the existing every-head writer remains legacy until the adapter supplies an explicit cadence action. Full/reuse actions enforce receipt fields, failed-count withholding, and original completion time; skip publishes nothing. Why: consumer-first deployment must not break the installed writer or silently pretend its legacy environment authenticates a cadence receipt. Native receipt authentication remains a phase-3/5 adapter obligation.

### Phase-2 local implementation and review

Ready consumer paths now share exact measured identity/time and bounded cadence states through `F/src/lib/coverage-cadence.ts:31` and `F/src/lib/health.ts:183`. Selected status remains independent of transport/reconciliation failure. Admin latest-source activity uses row identity; public anon queries carry actual measured fields and disclose unavailable head. Artifact/CLI/alert output carries reason, deadline, recovery and unavailable next-run time until an actual native definition is installed and activated. Strict release comparison remains the default at `F/scripts/compare-production-metrics.ts:81`; operational policy requires the explicit mode.

Publisher projection at `F/scripts/report-coverage.sh:23` separates enrollment from activation. Full/reuse preserve successful-suite completion and run/workflow/attempt fields; skip has no transport; parsed failure counts veto selected active publication. `F/scripts/batch-report-coverage.sh:8` reads the sole canonical registry, then enforces actual default checkout, clean tracked/nonignored inputs and unchanged identity around the successful test command. Native adapters must supply authenticated immutable receipt fields and the complete registry dependency; environment strings and text auditing alone do not prove receipt authority.

Independent fold, admin, public, consumer and writer review results are preserved privately. Later integration review accounts for all changed units and retained ingestion/RPC/first-release/anon boundaries; it approved ready portions with the public-head decision explicitly unaccepted. Its repair addenda cover configuration relocation, actual transition-time propagation and typed status reuse. Simplify passes for reuse, quality and efficiency completed; confirmed duplication was removed, with no speculative rewrite.

Task-owned local DB proof executed all four required coverage/health-sync/metrics-integrity/RLS suites: 114 tests, zero skips, exit 0. Seeded public provenance passed desktop and mobile after a real missing-measured-SHA RED. Authenticated admin fixtures passed all four current/pending/overdue/missing states on both viewports, with eight screenshots inspected for full SHA/time/age/head/deadline/recovery/next-run text. Fixture rows were scoped to acquired IDs and cleaned up. These results prove local rendering and DB contracts, not native receipt, deployed consumer or fleet activation. Public current/pending/overdue head comparison remains pending the owner decision.

### Phase-2 discovered configuration boundary

Plan said: share the existing checked-in producer registry. Found: F's architecture gate rejects application imports from the operator `scripts/` tree. Chose: relocate the sole registry to `F/src/lib/coverage-producers.json:1` and update all live operator/test/config/playbook references. Why: preserve one policy source and the existing dependency direction without a duplicate registry or a symlink. The approved historical plans retain captured source paths; use this relocation note on resume. Native writers copied without a full checkout must package the registry at its resolved relative path.

The first full local pass retained actual failures: generated HTML coverage JavaScript under the ignored evidence folder caused three lint warnings; the import boundary caused architecture and one full-test failure; coverage measured 100 percent statements/lines/functions and 99.87 percent branches, failing the existing 100 percent branch threshold. Generated reports were preserved outside the linted checkout, without weakening lint. Boundary tests and shared typed status/policy access resolve the missing branches. An intermediate cleanup introduced two TypeScript errors; its run was stopped with driver exit 130 and remains incomplete. Corrected typecheck and focused fold/email coverage pass with independent review. The final complete sequential candidate gate passed after repair on unchanged inputs. Original failures remain retained. This establishes the ready local portions; whole-phase acceptance remains unresolved because the public-head contract needs an owner decision.

### Phase-2 verification and durable handoff

Phase 1 commit: `05eea61565f7afd54fbf815b0f7c5f1cf56a66fc`. F task base after preserving and reconciling existing inputs: `626634c0b249eb5b73b7a5ea3f072d23d0bfd883`. F task commit: `88e0b060a81e880156bc8f96145ce88ceba09ae8`. Full tested input SHA-256: `58d88c22ece9126489a3c55420a91d751fd09f39cb13e00d1938ee9d8aa81cba`; after-commit readback matches, with a clean task branch. Runtime: Node 24.21.0, pnpm 10.29.2. Both develop checkouts remain unchanged.

All final sequential gates exited 0: targeted tests, typecheck, lint, architecture, capability/cadence/combination/environment checks, full tests, full coverage, build, bundle budgets, canonical browser runner and diff check. Full tests and coverage each ran 315 files and 5,038 tests, with zero skips. Coverage is 100 percent for statements, branches, functions and lines. Bundle checks measured 730.18 kB Brotli against 760 kB and the home client entry at 209.52 kB against 240 kB. The canonical browser lane passed 14 tests and skipped 62 seeded-lane cases by its existing configuration; the required public/admin seeded provenance checks ran separately and passed four desktop/mobile tests. Required local DB suites were rerun on the final candidate: four files, 114 tests, zero skips. Commit hooks reran typecheck and lint successfully.

Resume by verifying actual refs, worktree state and recorded input hash before reusing this evidence. The required owner decision is a narrow visibility-safe public provenance RPC, with new SQL/type/query/privilege/browser tests, or an explicitly accepted unavailable-head exception. No exception is accepted yet. An approved RPC changes tested inputs and requires independent review and all invalidated local gates again. No remote migration is implied. Phase 3 remains dependent on accepted phase 2; later native activation, 72-hour observation and seven complete final observation days remain outstanding. Merge to develop and worktree pruning are withheld because the owner's 100 percent condition is unmet. Private evidence and the decision proposal remain preserved under the implementation evidence directory.
