# Runner routing switch implementation plan

Date: 2026-10-29. Repository `/Users/juan/code/cirujano`; integration branch `develop`; planning baseline `04736fa53bdb07f5d54f7068b1370677d8cf9962` (local `develop`, 3 commits ahead of `origin/develop` `39b2c72e181315321a6b886c852e449c393ef510` with unrelated advisory work). Status: plan written, not yet accepted. No implementation is authorized by this document.

## Objective

A Cirujano runner that can no longer serve must stop receiving jobs without a workflow push, and the owner must see the risk before it happens. Today an enrolled job asks for the Cirujano label unconditionally. When the controller cannot start a VM, the job queues with no runner, and through `cancel-in-progress` concurrency it blocks every newer run on the same ref until GitHub's 24-hour queue timeout.

## Incident that motivates the plan (2026-10-28/29)

- Every operating permit expired at `2026-10-28T23:59:59Z`, the planned end of the measurement window (`packages/runner/src/operating.ts:6`).
- From about 22:55Z the P3 controller logged `remaining permit runtime cannot fit one complete job and shutdown margin` (`packages/runner/src/lifecycle.ts:401`), and after 23:59:59Z it logged `permit is expired` (`packages/runner/src/lifecycle.ts:70`).
- Owner pushes at about 23:27Z (P2) and 23:32Z (P3) queued self-hosted jobs that no runner could take. They also held newer runs on the same ref.
- On 2026-10-29 the owner chose to end the study. All 10 enrollments returned to `ubuntu-latest`, the stuck runs were force-cancelled, and controllers P2 to P10 were retired. `fleet verify` recorded every enrollment as `reverted`.
- Verified in planning: `extractJobRunsOn` refuses any `${{ }}` runner selection (`packages/cli/src/fleet-service.ts:685`). The P3 workflow before the revert (a hand-written expression) throws there; after the revert it parses as `["ubuntu-latest"]`. The registry holds no `after` refresh after 2026-09-29. From about 2026-10-08, when expression forms reached enrolled jobs, `fleet verify` and `fleet cutover` could not read those enrollments.

The same stranding follows from every state in which the controller refuses to start: expired permit, the cannot-fit cutoff, exhausted runtime (`lifecycle.ts:398`), exhausted cost (`lifecycle.ts:399`), and a repository that is no longer private (`packages/runner/src/adapters/github.ts:227`, seen on P9 on 2026-10-08).

## Accepted decisions

- D1 (owner, 2026-10-29): when a controller cannot serve, the controller itself turns routing off, under a new permit operation `release-routing` that the owner approves with each permit. It then force-cancels runs whose only unfinished jobs are stranded on its label.
- D2 (owner, 2026-10-29): include a live probe on a Cirujano-owned scratch repository, gated by separate owner authorization, to learn whether re-running a job reads the current `vars` value. Until the probe passes, recovery is cancel-only and tells the user to push or dispatch a new run.
- D3 (owner, 2026-10-29): four phases as listed below, each stopping for acceptance.
- D4 (planner, from evidence): the switch is a repository variable `CIRUJANO_RUNNER_<P#>` (for example `CIRUJANO_RUNNER_P3`). Routing is on only when its value equals `on`; GitHub compares strings case-insensitively, so `ON` also enables it, and phase 2 health must read the value the same way. An unset or deleted variable sends the job to `ubuntu-latest`, so every failure of the switch falls back to hosted runners.
- D10 (owner, 2026-10-29, phase 1 review finding 1): the guard must also contain the exact owner clause `github.actor_id == '<owner numeric id>'` as a top-level conjunct. `fleet cutover` and `fleet verify` read the owner id with one read-only `GET /users/<owner>`.
- D5 (planner): Cirujano generates the gated `runs-on` value (`fleet runs-on`), and the fleet parser accepts only that exact shape. Hand-written expressions caused the blind period above.
- D6 (planner): release stays outside the lifecycle effect union. Variable deletion and force-cancel are idempotent, and readback (GET the variable, read the run status) confirms them. This keeps `LifecycleEffect` (`packages/runner/src/contracts.ts:208`), `LifecycleDecision.reasonCode` (`contracts.ts:224`) and the controller journal schema unchanged.
- D7 (planner): release authority uses recovery semantics, so it also works after the permit expires. The precedents are `validateRecoveryPermit` (`lifecycle.ts:371-378`), `validateCleanupPermit` (`lifecycle.ts:359-365`) and the recovery-operation exception in `pendingAuthorizationProblem` (`packages/runner/src/controller.ts:633`).
- D8 (planner): release fires on serviceability alone, with or without queued demand. The service end is `permit.expiresAtMs - maxJobMs - shutdownMarginMs`, the same cutoff as `safeCutoffMs` (`lifecycle.ts:341`). Releasing at that point keeps new jobs off the label, so nothing queues in the last 65 minutes.
- D9 (planner): the expiry warning lead time is 7 days, measured to the service end, not to the permit expiry.

## Boundaries

- No change to any target repository workflow, `CI_CADENCE_MODE`, cadence routing or Sutura-owned trust guards. Nothing is enrolled today, so this plan changes only Cirujano. The canonical expression wraps the repository's trust guard and does not define it. A future enrollment edits its workflow under that repository's own authorization, with Sutura coordination where the repository's routing tests are involved.
- No new enrollment, permit, Nebius resource or controller install. `OPERATING_PERMIT_BOUNDS.expiresAtMs` stays at 2026-10-28 (`operating.ts:6`), so no permit proposal is possible until the owner sets new bounds. That decision is outside this plan.
- Fixtures in this public repository use placeholder repositories (`example-owner/example-app`) and never private names.
- `packages/action/dist/index.cjs` depends only on `@cirujano/core/billing` (`packages/action/src/main.ts:3`), and the plan changes no `packages/core` source, so no committed bundle needs a rebuild. `pnpm run verify:bundle` still runs in every phase.
- A sleeping owner Mac stops the controller entirely (fleet plan D1, `docs/plans/2026-09-15-fleet-migration-evidence.md:40-48`). The switch cannot release from a sleeping host. That accepted risk stays, and the runbook states it.

## Options considered

1. Renew permits on schedule only: rejected. It does not cover cost, runtime or visibility exhaustion, and it repeats the cliff at every expiry.
2. Owner-run release only: rejected by D1. Nobody was watching on 2026-10-28.
3. Fleet-side alerting with no switch: rejected. A warning still needs a push to every enrolled repository to act on it.
4. **Selected: gated `runs-on` plus controller release under the permit, with read-only health and an owner command for the states the controller cannot handle (no permit, dry-run, controller down).**

## Canonical gated runner selection

Generated by `cirujano fleet runs-on --registry <file> --id <P#>` for an enrollment with repository `<owner>/<repo>`, workflow `<path>`, owner account id `<uid>` and label `<label>`:

```text
${{ vars.CIRUJANO_RUNNER_<P#> == 'on' && (github.actor_id == '<uid>' && (github.event_name != 'pull_request' || (github.event.pull_request.user.id == <uid> && github.event.pull_request.head.repo.id == github.event.repository.id)) && github.workflow_ref == format('<owner>/<repo>/<path>@{0}', github.ref)) && fromJSON('["self-hosted","linux","x64","<label>"]') || 'ubuntu-latest' }}
```

The parser accepts any parenthesized guard if it is balanced, has no top-level `||`, contains no nested `${{` or `}}`, and has two exact top-level conjuncts: the owner clause `github.actor_id == '<uid>'` (D10) and `github.workflow_ref == format('<owner>/<repo>/<path>@{0}', github.ref)`. The workflow_ref clause matters because the controller admits only runs of the enrolled workflow; without it, a nightly `workflow_call` strands its jobs. A repository may therefore keep a stricter Sutura guard. Everything outside the guard must match byte for byte, after YAML unquoting of a plain, single-quoted or double-quoted scalar. A scalar that YAML would reject or cut short is refused, and so is a repository or workflow path containing `'`, `{` or `}`.

## Phases

| Phase | Deliverable | Entry condition |
| --- | --- | --- |
| [1](2026-10-29-runner-routing-switch-phases/phase-1.md) | Gated routing in the fleet: generator, parser, registry switch, cutover refusal, per-enrollment verify | Accepted plan; isolated worktree from `develop` |
| [2](2026-10-29-runner-routing-switch-phases/phase-2.md) | Read-only `fleet health`, daily report section and notification, owner-run `fleet release` | Accepted phase 1 |
| [3](2026-10-29-runner-routing-switch-phases/phase-3.md) | Controller auto-release under `release-routing`; runbooks and ADR 0002 | Accepted phase 2 |
| [4](2026-10-29-runner-routing-switch-phases/phase-4.md) | Gated live probe; re-run enabled only if the probe proves it | Accepted phase 3 and separate owner authorization for the probe |

Execution is sequential. No unit is `[batch-eligible]`. Phases 1 and 2 both edit `packages/cli/src/fleet-service.ts` and `args.ts`. Phase 3 edits `contracts.ts`, `config.ts` and `runner-service.ts`, which phase 2's release code reads. Every phase follows implement, independent review, repair, simplify, verify. No working branch is pushed and no PR is opened. Integration into `develop` is local, and any push needs its own authorization.

Verification for every phase, run sequentially: `pnpm run ci:fast` (typecheck, lint, `verify:bundle`, all workspace tests), plus the phase's named tests run first in red, then green.

## Stuck states and recovery

| State | Who sees it, and what they see | How it ends | Proving test |
| --- | --- | --- | --- |
| S1 Switch `on`, controller cannot serve (expired, past service end, runtime or cost exhausted, repository not private), permit grants `release-routing` | Controller event `routing-release` with the reason; `fleet health` shows `released` | Automatic: variable deleted, readback absent, new jobs go hosted | phase 3 `routing.test.ts` "releases at the service end with no demand", `runner-service.test.ts` "deletes the switch and confirms by readback" |
| S2 Switch `on`, permit absent or expired with the controller in dry-run or stopped | `fleet health` red row `unserviceable` naming the exact `cirujano fleet release --registry ... --id P#` command; daily `fleet-health.md`; macOS notification | Owner runs the printed command | phase 2 `fleet-health.test.ts` "prints the release command for each unserviceable reason"; `telemetry-scheduler.test.ts` "notifies on a red health exit and keeps the report" |
| S2a Switch `on`, valid permit without `release-routing` | `fleet health` amber row `no-auto-release` with the service end date | Owner reissues the permit with the operation, or releases by hand before the printed date | phase 2 `fleet-health.test.ts` `no-auto-release` case |
| S3 Variable DELETE or readback fails (403 scope, 5xx, network) | Controller event `routing-release-failed` with status and body; `fleet health` still shows `on` and red | Retried on the next eligible check, at most every 10 minutes; a 403 also tells the owner to run `fleet release` | phase 3 `runner-service.test.ts` "retries a failed delete and reports a 403 with the owner command" |
| S4 Stranded run that still has other unfinished jobs | Health lists the run as `waiting-for-other-jobs` | Cancelled on the first check after its other jobs finish | phase 2 `stranded.test.ts` "waits while another job runs, then selects the run" |
| S5 Run cancelled, re-run not yet proven (phase 4 not passed) | Event and `fleet release` output: "cancelled run <id>; push or dispatch a new run" | User pushes or dispatches; the switch being off routes it hosted | phase 2 `fleet-service.test.ts` "release prints the push-or-dispatch step"; phase 3 event test |
| S6 Enrollment with an ungated or hand-written runner selection | `fleet cutover` refuses and names `fleet runs-on`; `fleet verify` and `fleet health` report that one enrollment and continue with the others | Owner applies the generated line and re-runs cutover | phase 1 `fleet-service.test.ts` "cutover refuses an ungated selection" and "verify reports an unrecognized expression without aborting" |
| S7 GitHub read incomplete when checking the switch or queue | Health row `unknown` (exit 1); controller event `routing-check-incomplete` | Next check, at most 10 minutes later | phase 2 and 3 tests with an incomplete page |
| S8 Owner Mac asleep or controller host down | Nobody automatically; jobs wait up to GitHub's 24-hour timeout | Accepted risk (fleet plan D1); runbook states it and names `fleet release` from any machine with the owner's `gh` | Runbook text check in phase 3 (`docs/runbooks/nebius-runner.md` names the risk and the command) |

## Consumer sweep

Commands run on 2026-10-29 at the planning baseline:

- `git grep -n -E "PermitOperation|'create', 'start', 'register', 'stop', 'delete'" -- packages scripts docs/runbooks ':!**/dist/**' ':!*.cjs'`
- `git grep -n "extractJobRunsOn\|readLiveIdentity\|requiredSelfHostedLabels" -- packages`
- `grep -n "OPTIONAL_ROOT_KEYS\|exactKeys" packages/runner/src/config.ts`
- `git grep -n "collect-actions-telemetry" -- '*.test.*'`

| Consumer | Location | Disposition |
| --- | --- | --- |
| `PermitOperation` union | `packages/runner/src/contracts.ts:13` | Phase 3 adds `release-routing` |
| Permit parse and validate list | `packages/runner/src/lifecycle.ts:17,39,73` | Phase 3 accepts `release-routing` |
| Operating proposal operations | `packages/runner/src/operating.ts:13`; test `operating.test.ts:61` | Phase 3 includes `release-routing` in new proposals |
| Pending authorization operation list | `packages/runner/src/controller.ts:388` | Excluded: release never creates a pending lifecycle effect (D6). Phase 3 adds a test that a pending effect can never carry `release-routing` |
| `requiredPermitOperation` | `controller.ts:578`; test `controller.test.ts:345-351` | Unchanged: no new lifecycle effect type |
| Pilot permit operations | `packages/runner/src/pilot.ts:432` | Excluded: pilot permits never route enrolled jobs |
| Permit fixtures in tests | `packages/cli/src/runner-service.test.ts:1025,1121`; `packages/runner/src/lifecycle.test.ts:20`; `controller.test.ts:650` | Unchanged, still valid; phase 3 adds fixtures with the new operation |
| `RunnerConfig` optional keys and hash | `packages/runner/src/config.ts:14,25`; `runnerConfigHash` | Phase 3 adds optional `routingSwitch`, omitted when null so existing config hashes and archived journals stay valid |
| `extractJobRunsOn` callers | `fleet-service.ts:140` (enroll), `:598` (`readLiveIdentity`, used by cutover and verify) | Phase 1: enroll still refuses expressions; cutover and verify accept the canonical form |
| Registry enrollment schema | `packages/cli/src/fleet-registry.ts:74-77,145-205`; private registry file; fixture `packages/cli/fixtures/` registry used by `fleet-registry.test.ts` | Phase 1 adds optional `routingSwitch`; existing entries parse unchanged |
| Controller config writer | `fleet-service.ts:288-304` (`controller-config`) | Phase 3 copies the enrollment's switch into the config |
| Telemetry agent script | `scripts/collect-actions-telemetry.sh`; test `packages/cli/src/telemetry-scheduler.test.ts` | Phase 2 adds the health section and notification |
| Installed copies | `~/.local/lib/cirujano/telemetry/` and `~/.local/lib/cirujano/runner/` | Excluded: no reinstall in this plan; installing is a separate owner action |

## Handoff

- Objective and approved scope: above. Authorized so far: planning only. Implementation, local integration, any push and the phase 4 probe each need their own approval.
- Base: `develop` at `04736fa53bdb07f5d54f7068b1370677d8cf9962`, working tree clean at planning time. Implementation goes in a worktree such as `/Users/juan/code/cirujano-routing-switch` on a local branch `feat/runner-routing-switch`.
- Evidence limits: the parser blind period is VERIFIED for P3 by running the parser on the pre- and post-revert workflow. The 2026-10-08 start date is INFERRED from when the expression forms were committed. Whether GitHub re-runs read current `vars` is UNKNOWN; the docs say nothing ([variables reference](https://docs.github.com/actions/reference/variables-reference)), and phase 4 measures it.
- On resume: compare `git rev-parse develop` and `git status` with the base above. Re-read changed fleet or runner files before relying on the cited line numbers.
- Next action: owner acceptance of this plan, then phase 1.
