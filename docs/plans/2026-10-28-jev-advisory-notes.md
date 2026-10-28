# Jev advisory implementation notes

Owner authorized all five sequential phases, local integration into `develop`, one completed integration push, and removal of the task worktree on 2026-10-28. No live inference or paid runner budget is granted. Base: `37e7e33a0ba15d24eaa6433e9a4fa7f00613fb1f`. Implementation branch: `feat/jev-advisory`; worktree: `/Users/juan/code/cirujano-jev-advisory`. Research and approved plans copied intact from the original checkout and will be preserved with implementation.

## Deviations

- Phase 1 source ranges: plan said explicit safe line ranges with immutable Git blob validation; found the approved collect grammar accepts source paths only, and validating retained attribution requires the complete original workflow. Chose explicit whole-file ranges for selected files, bounded by original byte limits, with exact Git blob validation and refusal of detected credential/literal environment data. Inference projection will select command excerpts separately. Why: preserves original source bytes and provenance without inventing an unapproved range grammar or relabeling a snippet hash as a Git blob.

## Phase 1 accepted

TDD evidence: initial CLI grammar/rules/render RED and service RED are retained in ignored `docs/agents/jev-advisory/phase-1-*-red.log`; collector/contract RED captured before their production modules existed. Independent review findings P1-R1 through P1-R8 are being resolved before acceptance. Initial typecheck/lint passed. Initial coverage failed because compiled runner subprocess prerequisites were absent; bundle verification then passed. The next full run passed core (575 tests), runner (420 tests) and Action (6 tests), and 866/867 CLI tests. The sole CLI failure was an assertion expecting an unescaped path in escaped Markdown; corrected to assert the displayed path, with the five service tests passing. Corrected CLI full coverage passed: 867/867 tests; 85.92% statements, 80.85% branches, 93.61% functions, 91.63% lines. Core/runner/Action passing coverage is reused unchanged, making 1,868 passing tests across the complete gate. Typecheck/lint repair checks and bundle verification passed. No acceptance blocker remains. Both failed runs remain in raw evidence.

Independent reviewer approved implementation tree `ba5e510f6c660f4fe32e8e4aea3387ba7c2f4e67`; later changes only correct the test expectation and add generated synthetic fixtures/these notes. Finding dispositions:

| ID | Disposition and evidence |
| --- | --- |
| P1-R1 | Resolved: retained mapping is recomputed using the collector's strict literal-name/order mapping (`packages/cli/src/advisory/contracts.ts:98`). |
| P1-R2 | Resolved: every nullable datum has validated present/missing/ambiguous status (`packages/cli/src/advisory/contracts.ts:106`). |
| P1-R3 | Resolved: known public hosted labels have zero GitHub execution charge; self-hosted and unknown prices remain null (`packages/cli/src/advisory/rules.ts:36`). |
| P1-R4 | Resolved: real CLI collect→inbox→status, safe affected input/GET stage, lock/output/symlink refusal and fresh-directory recovery (`packages/cli/src/advisory/service.test.ts:44`, `packages/cli/src/advisory/service.ts:59`). |
| P1-R5 | Resolved: shared completeness derives from mapping, reasons and nullable timing/conclusions (`packages/cli/src/advisory/rules.ts:39`). |
| P1-R6 | Resolved: explicit whole-file ranges and immutable hash checks; conservative unsafe-source refusal plus visible recovery reason (`packages/cli/src/advisory/contracts.ts:49`, `packages/cli/src/advisory/service.ts:29`). Range interpretation recorded above. |
| P1-R7 | Resolved: separate canonical pinned attempt/job/source links; exact URL assertions (`packages/cli/src/advisory/render.ts:11`). |
| P1-R8 | Resolved: known install flags only; help/dry-run/lockfile-only commands unclassified (`packages/cli/src/advisory/rules.ts:13`). |

Simplify: reuse pass consolidated completeness in `evidenceStatus` for collect/status/inbox; quality pass kept explicit token allowlists and fixed recovery reasons; efficiency pass confirmed bounded inventories, identity deduplication and reused Git-tree reads. No broader refactor was justified. Scope: advisory sources and additive CLI dispatch only; all changed implementation inputs are covered by the final local gate. Existing Action and push-harness bundles were rebuilt and remain byte-identical.

Phase 1 tested source manifest: `sha256:f585057a8cfab0d5b0a70fbae46c9f62551e5e4a8bf2ce3819160a2c9e83beac` (all CLI source/test inputs); raw file manifest and individual logs remain under ignored `docs/agents/jev-advisory/`. Local base remains the stated baseline until this phase commit. Next: phase 2, exact prepared payloads, explicit owner permits, bounded transport and recovery. Live integration remains unmeasured; all tests use injected external transports.
