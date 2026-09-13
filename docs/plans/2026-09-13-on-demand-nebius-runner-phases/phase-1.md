# Phase 1: contracts and lifecycle

Parent: [runner plan](../2026-09-13-on-demand-nebius-runner.md).
Status: complete and independently approved on 2026-09-13.
Entry: owner accepts parent scope and authorizes Phase 1; revalidate base and instructions.

## Deliverables

Create `packages/runner/package.json`, TypeScript build configuration and public
`src/index.ts`. Add `src/config.ts`, `src/lifecycle.ts`, `src/contracts.ts`,
`src/cost.ts`, and colocated tests. No external IO in lifecycle decisions.
Use the existing strict workspace conventions (`tsconfig.json:2`,
`packages/core/package.json:7`, `pnpm-workspace.yaml:1`).

Specify typed snapshots, permitted effects, ownership, journal records, guest
status and rate inputs. Make unknown provider fields/statuses fail closed.
Freeze schema version 1; reject unknown config keys, nonfinite rates, invalid
bounds, multiple slots, public repository classification and missing ownership.
Keep network-resolved fields distinct from locally supplied configuration.

## Behavioral oracles to implement before behavior

| ID | Required tests and exact outcome |
| --- | --- |
| R01 | Invalid schema, public repo, wrong identity, expired/mismatched permit or absent approval: zero mutation effects; explanatory blocked result. |
| R02 | Eligible queued job + stopped VM: one start intent; replay with outstanding operation: no additional start/create. Busy job: no ordinary stop. |
| R03 | Idle grace requires complete observations and drained guest; queue arrival during drain returns to work; unknown busy state blocks ordinary stop; drain near the original deadline followed by controller loss cannot extend that deadline. |
| R04 | Clock advance to lifetime deadline emits emergency stop; insufficient remaining job budget forbids registration; expired permit cannot start again; delayed assignment after the safe cutoff fails before user steps. |
| R05 | Explicit rates reproduce hand-calculated compute + disk + network totals; missing intervals/rates never yield a zero-cost success; hosted baseline requires explicit rate. |

Use table-driven transition tests and generated event sequences with fixed seeds.
Exercise invariants across replay, failed mutation and restart, not just named
happy-path states. Explain which behavior mutation each assertion would catch.

```text
@ decide(observed, policy, elapsed) -> effect
pre: validated versioned values
do:
  1. validate observation completeness and remaining lifetime
  2. lookup lifecycle transition and outstanding intent
  3. compute at most one effect with reason
br: ordinary uncertainty -> blocked; emergency deadline -> stop owned VM
fail: invalid ownership -> no remote effect
```

## Work units and verification

One owner handles contracts, state machine and package setup; these are coupled,
so no batch units in this phase. Independent review is read-only after completion.
Run red tests first; implement; review/repair; simplify; run `.rpi/policy.json:7`
checks sequentially: typecheck, lint, build, bundle verification, test. Each must
pass; report test counts and any uncovered behavior without inventing a coverage
threshold. No live provider or manual test is needed for this pure contract phase.

Exit: R01–R05 pass, existing behavior unchanged, local integration verified,
check evidence and candidate SHA added here. Stop for Phase 1 acceptance.

## Implementation handoff

Implemented on `feat/on-demand-nebius-runner` in
`/Users/juan/code/cirujano-runner`, based on plan commit `5c8089c`. The owner
authorized all phases without intermediate stops. The implementation added the
internal runner package, strict pilot configuration, runtime permit parsing,
explicit-rate cost accounting, and replay-safe lifecycle decisions.

TDD evidence: the initial RED run failed three suites because production modules
did not exist. Review repairs produced RED runs with 3, then 15, then 5 expected
safety failures. The final GREEN candidate passed 74 tests in three files plus
runner typecheck, lint, and build. Independent review approved the candidate
after verifying absent-VM creation, permit envelopes, generation-bound idle
evidence, strict recovery activation, stale queue rejection, exact pilot shape,
and conservative create adoption. Findings H1–H4, M5–M6 and the final adoption
blocker are resolved. No live provider operation occurred in this phase.

The accepted candidate will be fixed by the phase commit recorded in Git history.
Phase 2 must reuse the separate `cpu-d3` platform and `4vcpu-16gb` preset fields,
and must not weaken the complete-snapshot or guest-readiness invariants.
