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
