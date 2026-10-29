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

## Phases 2, 3 and 4

Authorization (owner, 2026-10-29): "go finish all phases and once it's all done, commit, merge to develop and prune your tree". No push. Phase 4 scratch repository (owner choice): a new private scratch repository, archived after the probe. Its name and run ids stay in the ignored agent report.

Commits on `feat/runner-routing-switch`: 9e9261a (phase 2), cc478e4 (phase 3 plus phase 2 review repairs), then the phase 3 review repairs and phase 4 re-run in the commit that follows these notes.

### Delivered

- Phase 2:
  - `packages/runner/src/routing.ts`: `serviceEnd`, `assessService`, `selectStrandedRuns`.
  - `GitHubAdapter.getVariable/deleteVariable/forceCancelRun`.
  - `fleet health`, `fleet release`.
  - Health step and notification in `scripts/collect-actions-telemetry.sh`.
- Phase 3:
  - `release-routing` permit operation; `validateReleasePermit`.
  - `routingSwitch` in runner configs, copied by `controller-config`.
  - Controller release step in `runner-service.ts`.
  - ADR 0002, runbooks, README.
- Phase 4:
  - Live probe (PASS).
  - `GitHubAdapter.rerunJob`; shared `cancelAndRerun`, used by `fleet release --cancel-stranded` and the controller.

### Deviations

| Plan said | Found | Chose | Why |
| --- | --- | --- | --- |
| `assessService` in phase 3 | Phase 2 health needs the same serviceability rule | Built in phase 2 and reused by the controller | One rule for health and release |
| Health `stranded` only for jobs queued over 15 minutes | `WorkflowJob` has no created-at time | Any job queued on the label while the switch is off or the runner cannot serve | Nothing will ever serve such a job; waiting adds no information |
| Stranded set "queued" | GitHub also reports `waiting`, `pending` and `requested` | Every unfinished status except `in_progress` | All of them wait for the label; `in_progress` means a runner took the job |
| Waiting runs labelled `waiting-for-other-jobs` | Shorter key reads the same | `waiting` | Naming only |
| Unserviceable row with stranded runs becomes `stranded` | Both are red | Stays `unserviceable`; recovery switches to `--cancel-stranded` | The reason is more useful than the symptom |
| Release readback must be `absent` | `other` also routes hosted | Any value but `on` counts as released | Routing is off either way |
| Release tests in `fleet-service.test.ts` | Health and release share fixtures | `fleet-health.test.ts` | Keeps fixtures in one file |
| `serving` health case in phase 2 | No valid permit could carry `release-routing` before phase 3 | Case added in phase 3 | Ordering |
| Throttle test with a fake clock | The controller runs one tick per process in tests | Test-only `CIRUJANO_RUNNER_TICKS` runs two ticks in one process | Exercises the real per-process state |
| "Owned VM still active" covered by a service test | The lifecycle fixture cannot hold a running VM without an accounting baseline | Pure `ownedRunnerMayTakeJobs` in `routing.ts`, unit-tested and called by the controller | Same guard, testable |
| Manual dry-run incident replay (phase 3) | Covered by automated tests | The routing boundary test (22:54:59.000Z serves, .001Z does not) and the dry-run service test | Same evidence, repeatable |
| Re-run fallback `rerun-failed-jobs` (phase 4 step 5) | Job-level re-run passed | Not run | Not needed |

### Review findings and dispositions

Phase 2 review (commit 9e9261a), CHANGES REQUESTED, no blocker. Resolved in cc478e4:

| ID | Finding | Disposition |
| --- | --- | --- |
| P2-1 | A crashed health check (exit 1, no report) read as red and replaced the last report | Resolved: valid only with the report header; test with exit 1 and empty output |
| P2-2 | `assessService` ignored starts, projected cost, identity and operations | Resolved: full start-budget parity; table test against `decideLifecycle` added in phase 3 repairs |
| P2-3 | Unreadable local files reported as GitHub failures | Resolved: `permit-invalid` and `controller-state-unreadable`; tests |
| P2-4 | Release lost its report on partial failure; no post-cancel readback | Resolved: report always printed, per-run failures, readback |
| P2-5 | Health skipped when an earlier step failed | Resolved: health runs before the owner lookup and collection; test |
| P2-6 | A 403 backoff on one row spilled into later rows | Resolved: a fresh GitHub client per row |
| P2-7 | Test gaps (serving, controller files, incomplete collection, misnamed test) | Resolved: tests added; test renamed |
| P2-8 | Stranded set broader than "queued"; possible duplicate runs | Accepted: see deviations; dedupe by run id is in `listActiveRuns` |
| P2-9 | Organization or environment variables with the same name | Accepted, documented in ADR 0002 (user-owned repositories have none) |

Phase 3 review (commit cc478e4), CHANGES REQUESTED, one blocker. Resolved in the following commit:

| ID | Finding | Disposition |
| --- | --- | --- |
| P3-1 (blocker) | Force-cancel could hit runs that a live or starting owned VM would serve | Resolved: cancel only when `ownedRunnerMayTakeJobs` is false; otherwise `routing-stranded-waiting`; unit test |
| P3-2 | `routing-check-incomplete` (S7) missing | Resolved: event for unreadable visibility or stranded listing; test |
| P3-3 | No start-budget parity test | Resolved: 12-case table against `decideLifecycle` |
| P3-4 | Throttle untested in-process | Resolved: two-tick test; a mutation removing the guard fails it |
| P3-5 | A mid-loop cancel failure lost earlier cancels | Resolved: shared `cancelAndRerun` records each run |
| P3-6 | No stored pre-change config hash | Resolved: hash `b42f6fb8…` computed with the 9e9261a parser and pinned |
| P3-7 | Release dropped its cancel list when the readback failed | Resolved: `stillActive: 'unknown'` keeps the list; test |
| P3-8 | Readback-still-on branch untested | Resolved: test with a delete that does not take effect |
| P3-9 | Runbook listed a mismatched permit as released automatically | Resolved: runbook corrected; the owner releases |
| P3-10 | Event nits (registry path, stranded failure after delete) | Resolved: recovery uses `CIRUJANO_FLEET_REGISTRY` when set; a stranded-listing failure is `routing-check-incomplete`. No event when the switch was already absent (kept quiet by design) |
| P3-11 | Unreadable controller files were red with the switch already off | Resolved: the switch is read first; released stays green; test |

### Phase 4 probe (PASS)

Evidence is in the ignored report `docs/agents/routing-switch-probe-2026-10-29.md`. Summary:

- Live `fleet enroll`, `runs-on`, `cutover` and `verify` worked against the scratch repository.
- With no variable, the dispatched job ran on `ubuntu-latest`.
- With the variable `on`, the job queued on the Cirujano labels, and `fleet health` was red (`permit-absent`).
- `fleet release --cancel-stranded` deleted the variable (readback 404) and force-cancelled the run. The cancel was still in progress at readback and completed seconds later.
- `POST /actions/jobs/<id>/rerun` returned 201, and the new attempt ran on `ubuntu-latest` and succeeded.
- The repository is archived with no active runs and no variable.

### Final review (commit 101a263, amended to 964cc7e) and dispositions

CHANGES REQUESTED, one blocker. Resolved in the final commit:

| ID | Finding | Disposition |
| --- | --- | --- |
| F-1 (blocker) | The notes named the private scratch repository | Resolved: line rewritten and the unpushed head commit amended; no commit on the branch contains the name (scan of every branch commit) |
| F-2 | The tick could start or create a VM while the release step, reading the pre-tick snapshot, cancelled its job | Resolved: `ownedRunnerMayTakeJobs` also counts the tick's own decided effect; unit test and a service test through the create path, which fails without the fix |
| F-3 | The controller call of the guard was untested | Resolved: same service test |
| F-4 | Missing tests "never re-runs while the switch is on" and "failed re-run" | Resolved: controller and release tests with queued jobs and a failing re-run |
| F-5 | A run that finished by itself (409) was re-run; several jobs per run unmeasured | Resolved: only accepted cancels are re-run (`alreadyCompleted` lists the others); only the first stranded job of a run is re-run (`notRerun` lists the rest for a push or dispatch) |
| F-6 | Plan's `routing-stranded-rerun` event | Deviation: re-run job ids ride on `routing-stranded-cancelled` (`rerunJobIds`, `notRerunJobIds`); no attempt number, since GitHub assigns it after the 201 |
| F-7 | `error` VM status missing from the table | Resolved: added; runbook says a stuck VM needs `fleet release --cancel-stranded` |
| F-8 | Stranded-listing failure untested | Resolved: test with a 502 run listing |
| F-9 | `CIRUJANO_RUNNER_TICKS` in production | Accepted: unset or non-numeric never matches; one shared test-only limit with `CIRUJANO_RUNNER_ONCE` |
| F-10 | ADR wording | Resolved: release cancels and re-runs only with `--cancel-stranded` |

Further deviations from the final repairs:

| Plan said | Found | Chose | Why |
| --- | --- | --- | --- |
| Serviceability matches the start decision exactly | The lifecycle can start a stopped VM with a permit that lacks `create`, or create with one that lacks `register` | `assessService` still requires `create`, `start` and `register`, so it releases routing early in those cases; the tick-decision guard stops any cancel | Early release only gives up savings; the parity table covers full-operation permits |
| Re-run every stranded job | The probe measured one job per run; a second job re-run in a just re-run run is likely refused | First job per run; the rest listed | Measured behaviour only |

Simplify pass over phases 2-4 (four angles), applied:
- `RoutingGitHub` as a `Pick` of `GitHubAdapter`;
- one `noEvidence` helper;
- health rows built in parallel, and the repository and switch read together;
- one `fields` object per row, with no cast;
- the release delete loop;
- empty outcome through `cancelAndRerun`;
- a typed report;
- shared `message`, `cancelOutcomeClean` and `claimReleaseCheck`/`ReleaseCheck`;
- `THIRTY_DAY_MONTH_MS` exported once from `cost.ts`;
- one tick-limit exit;
- the `health` handler extracted;
- the script's `FLEET_ENABLED` gate and a notify message set only when needed;
- test helpers (`variableCalls`, `readLines`, a shared identity), with the debug line removed;
- a cross-reference comment in `startBudget`.

Skipped, with reasons:
- Reusing `observe()`'s runs, jobs and repository read in the release step: needs `LifecycleInput` changes; at most one extra read every 10 minutes.
- Skipping the stranded scan in the steady released state: a behaviour change; one scan every 10 minutes.
- A wakeable wait or deferred re-run inside the controller: a behaviour change. The wait is bounded at about 30 s and runs only when no owned VM exists.
- Moving `strandedRuns` and `cancelAndRerun` into `@cirujano/runner`: a new module outside the reviewed set; owner choice.
- One adapter factory for fleet and controller: different limits; low value.
- A `repoEndpoint` helper: the pattern predates this work.
- `serviceEnd` through the private `safeCutoffMs`: the parity test pins them instead.

### Handoff

- All four phases are implemented and reviewed. Integration: full `pnpm run ci:fast`, then local merge into `develop` and worktree removal (authorized). No push.
- Pre-existing finding F-BASE-1 (flaky `sandbox.test.ts`) is unchanged and outside this plan.
