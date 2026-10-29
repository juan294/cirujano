# Runner routing switch implementation notes

Plan: [2026-10-29-runner-routing-switch.md](2026-10-29-runner-routing-switch.md).

## Phase 1: gated routing in the fleet

Authorization (owner, 2026-10-29): plan accepted; implement phase 1. No local integration into `develop`, no push and no GitHub write are authorized.

Worktree `/Users/juan/code/cirujano-routing-switch`, branch `feat/runner-routing-switch`, base `04736fa53bdb07f5d54f7068b1370677d8cf9962`. The plan files were moved from the main checkout into this branch.

### Delivered

- `packages/cli/src/fleet-routing.ts` (new): `renderGatedRunsOn`, `parseGatedRunsOn`, `yamlScalar`, `FleetRoutingError`.
- `packages/cli/src/fleet-registry.ts`: `switchVariableFor`; optional `routingSwitch` on an enrollment, refused on proposed entries and checked against the id.
- `packages/cli/src/fleet-service.ts`:
  - `extractJobRunsOn` takes an optional gate;
  - `cutover` refuses an ungated selection and records the switch;
  - `verify` reports each enrollment separately and skips a reverted enrollment that has a successor before reading it;
  - new `runs-on` action; `GitHubFleetSource.userId`.
- `packages/cli/src/args.ts`: `fleet runs-on --registry <file> --id <P#>`.
- Tests:
  - `fleet-routing.test.ts` (new);
  - additions to `fleet-service.test.ts`, `fleet-registry.test.ts` and `args.test.ts`;
  - the existing cutover and verify cases now use the gated selection, because an ungated cutover is refused by design.

### Deviations

| Plan said | Found | Chose | Why |
| --- | --- | --- | --- |
| Fixtures use `example-owner/example-app` | The existing fleet-service harness fakes `juan294/app` | `fleet-routing.test.ts` uses `example-owner/example-app`; service tests keep `juan294/app` | Reuses the existing fake GitHub; neither is a private repository |
| `parseGatedRunsOn` returns `{labels, switchVariable} \| {refused}` | A thrown error carries the rule more simply | Returns `{runsOn, routingSwitch}` and throws `FleetRoutingError(rule)`; `extractJobRunsOn` wraps it with the `fleet runs-on` remedy | Same behaviour as the spec; a named rule reaches the user |
| `switchVariableFor` in `fleet-routing.ts` | The registry parser needs it, and `fleet-routing.ts` imports from the registry (circular) | Lives in `fleet-registry.ts` | No import cycle |
| Guard needs only the workflow_ref clause | Review finding 1 | Also requires the exact owner clause (plan D10, owner decision) | A run started by another account cannot reach the label |
| `fleet runs-on` refuses duplicate flags "like the other fleet actions" | No fleet action refuses duplicates; the last value wins (`args.ts`) | Same parser as the other actions; no duplicate refusal added | Spec wording was wrong; no fleet action changes behaviour |
| Manual check: `fleet runs-on --id P3` on the registry copy | All 10 enrollments are `reverted`, and `runs-on` refuses reverted entries by design | Ran it on a scratchpad copy with a synthetic proposed enrollment `P11` derived from P3; also confirmed that P3 is refused | Exercises the real registry data without changing it |
| `verify` behaviour on GitHub read failures was not specified | Per-enrollment isolation catches them too | A failed read becomes `<P#>: cannot read the runner selection: <message>`, exit 1, and the other enrollments still verify | Same rule as for parse errors; tested |

### Review findings and dispositions

Independent review (fresh context) verdict: CHANGES REQUESTED, no blockers.

| ID | Finding | Disposition |
| --- | --- | --- |
| R1 | The guard could drop the owner clause | Resolved: owner clause required (D10); tests "a guard without the owner clause", "a guard with only the workflow_ref clause", "an owner clause for another account" |
| R2 | Invalid YAML scalars, `}} ... ${{` and ` #` were accepted | Resolved: strict `yamlScalar`; `nested expression` rule; tests in `fleet-routing.test.ts` and `fleet-service.test.ts` |
| R3 | `'`, `{` or `}` in the repository or path broke the expression | Resolved: `unsafe workflow path` refusal in render and parse; test added |
| R4 | GitHub compares `==` case-insensitively | Resolved in documentation: D4 reworded, module comment updated; phase 2 health must read the value the same way |
| R5 | Usage-line test missing; duplicate-flag claim | Resolved: usage test added; duplicate-flag claim recorded as a spec error (deviations) |
| R6 | No test for a GitHub read failure in verify | Resolved: test added; a mutation (rethrow in the catch) makes it fail |
| R7 | A proposed enrollment with literal labels was told to run cutover | Resolved: message names `fleet runs-on`; test added |
| R8 | `runs-on` on a reverted enrollment untested | Resolved: test added |

Simplify pass (reuse, simplification, efficiency, altitude reviewers). Applied:
- one `gateFor` test helper;
- shared `--id` parsing for `runs-on`;
- `switchVariableFor` imported from the registry only;
- `validateGate` uses `refuse` with one regex;
- literal masking in `topLevelConjuncts`;
- one full-match regex for double-quoted escapes;
- a lazy `ownerUserId` in verify (no `/users` read when every entry is skipped);
- the verify read assigned through one variable;
- merged `labelled` branches;
- the expected switch computed once.

Skipped, with reasons:
- Moving the `FleetRoutingError` wrap from `extractJobRunsOn` to `readLiveIdentity`: it changes the tested error contract of `extractJobRunsOn`.
- A gated/ungated/unlabelled classification type: worth doing when phase 2 health needs a fifth check, so it is deferred to phase 2.
- Replacing `unquote` with `yamlScalar` for literal selections: it changes refusals on existing literal input outside this phase.
- Memoizing repository and branch reads in verify: an existing pattern, outside this diff.
- Starting the owner-id read in parallel: it changes the error order for one round trip.
- Reusing `positiveInteger` in `validateGate`: the error class matters to the wrap.

### Evidence (candidate: this branch's phase 1 commit)

- Red before implementation: 5 failed assertions plus 2 suites failing to import the missing module (`phase1-red.log`). Red for the review fixes: 10 failed (`phase1-red-review.log`). The two remaining failures there were test-fixture errors, fixed in the tests.
- Green: 136 tests in `fleet-routing`, `fleet-registry`, `fleet-service` and `args`; `pnpm run typecheck` 0; `pnpm run lint` 0.
- Manual, read-only, on scratchpad copies of the private registry:
  - `fleet runs-on` on a synthetic proposed P11 generated a line that the shipped parser reads as the four labels plus `CIRUJANO_RUNNER_P11`;
  - P3 is refused as reverted;
  - `fleet verify` exits 0 with all 10 entries `reverted`, and the copy is unchanged.
- Full gate: `pnpm run ci:fast` exit 0 on the final working tree, which is the phase 1 implementation commit's content (typecheck, lint, `verify:bundle`, tests: core 575, runner 420, action 6, cli 1135). F-BASE-1 did not fire in this run.

### Pre-existing finding

- F-BASE-1: `packages/cli/src/optimization/sandbox.test.ts` "journals trusted Location before reading malformed response body" is flaky on the unchanged base `04736fa`.
  - It failed in the first base `ci:fast` run (1099 tests, 1 failed) and in 1 of 5 isolated runs.
  - Cause: a 50 ms whole-create deadline races the local test server under load; production uses 660 s.
  - Not touched by this plan. It needs its own fix and owner decision.

### Handoff

- Next: owner acceptance of phase 1, then phase 2 (entry: phase 1 accepted; `ci:fast` green at the phase 1 commit).
- Phase 2 must read the switch value case-insensitively (R4) and may introduce the selection classification deferred above.
