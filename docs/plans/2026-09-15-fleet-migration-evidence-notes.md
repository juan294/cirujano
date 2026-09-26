# Fleet migration evidence: implementation notes

Plan: [2026-09-15-fleet-migration-evidence.md](2026-09-15-fleet-migration-evidence.md).
Worktree `/Users/juan/code/cirujano-fleet-migration`, branch
`feat/fleet-migration-evidence` from `develop` `c1dccb0` (plan commit on top of
`4312e10`). Phase commits: 1 `0b28e3b`, 2 `0e32b3f`, 4 `042736f`.

## Deviations

### D-15 Archived controller evidence and incomplete net savings (2026-09-26)

- Plan said: the fleet report joins controller assignments and cost to the
  45-day telemetry window.
- Found: controller bundle swaps archived earlier journals, but the report read
  only the current journal. It omitted earlier assignments and provider cost;
  the report also displayed net savings even when assignments were missing.
- Chose: read every direct controller journal archive, validate each archive's
  identity, reject repeated assignments or ambiguous duplicate counters, and
  sum cost at each archive's own dated rates. Report net savings only when the
  assignment coverage check is complete.
- Why: otherwise the trial appears cheaper merely because its earlier provider
  spend vanished from the report. The result remains an estimate from list
  prices and controller observations, not a cloud invoice or billed GitHub
  credit reconciliation.

### D-16 Delete idle stopped resources (2026-09-26)

- Plan said: normal idle handling stops the VM and retains its managed disk.
- Found: disk retention dominates the measured provider estimate while the
  controller is idle.
- Chose: new fleet configs opt into deletion after an ordinary stop and complete
  no-demand observation. Only an owned, stopped VM can be deleted. An active
  permit with delete authority or its explicit recovery authority may complete
  cleanup after expiry. Existing configs retain their behavior until migrated.
- Why: stopping compute alone leaves a continuing bill. The first live deletion
  must be checked against both instance and managed-disk inventory before any
  saved-disk claim.

### D-17 Scope expansion requested 2026-09-26

- Plan said: evaluate three selected private enrollments, with the remaining
  fleet outside the migration acceptance scope.
- Found: the owner requested deployment across the fleet today. Public
  repositories have free standard hosted minutes; private repositories differ
  in job duration, workflow needs and provider economics.
- Chose: retain the existing controller safety and verification gates while
  auditing every repository. A paid runner cutover needs a verified cost and
  workflow case for its target, a local workflow gate, and a live rollback.
- Why: enrollment counts alone do not prove savings or a working CI result.

### D-1 Enrollment record carries repository and workflow identity

- Plan said: enrollment `{ id, repository, workflowPath, jobName, sku, runnerLabel, status, before, after, controller, notes }`.
- Found: the controller config needs the numeric repository id and workflow id,
  the telemetry join needs the workflow display name, and a YAML job key is not
  always the display name GitHub reports (matrix jobs expand to several).
- Chose: additive fields `repositoryId`, `workflowId`, `workflowName`, `jobKey`
  (YAML key) and `jobNames[]` (display names; default the job `name:` or the
  key, or `--job-name` repeated). `fleet-registry.ts:41-57`.
- Why: every value is captured read-only at enrollment; without them phase 2
  would re-read GitHub to build the config and phase 4 could not join.

### D-2 `fleet verify` refreshes a stale `before`, fails on a stale `after`

- Plan said: "Both are refreshed by `fleet verify`, which fails if the live
  default branch no longer matches the recorded `after` state".
- Chose: a pre-cutover edit refreshes `before` with a note (nothing was cut
  over yet); after cutover, an edit that keeps the label exits 1 and leaves the
  record for review (`fleet cutover --commit <head>` re-records it on purpose);
  a lost label is recorded as `reverted` and exits 1. `fleet-service.ts` `verify`.
- Why: silently refreshing `after` would move the report's split point.

### D-3 Delete-vm state is `absent` with a pending effect, not `absent-pending`

- Plan said: "effect delete-vm, state 'absent-pending'".
- Found: `LifecycleState` has no such value; the controller journals a pending
  effect until reconciliation, which already models "absent pending".
- Chose: decision state `absent`, effect `delete-vm`, reconciled when the
  provider reports the VM absent (`lifecycle.ts`, `runner-service.ts`
  `reconcileEffect`). `grantDeadlineMs` is persisted in the lifecycle journal
  when a start or adoption reconciles and is optional on read so pilot
  journals still parse.

### D-4 Nebius cost uses the 30-day month of the permit accounting

- Plan said: `diskUsd = diskRetainedMs / (730 h) * 80 GiB * diskUsdPerGibMonth`.
- Found: the controller's own accounting (`advanceObservedLifecycle`) and
  `estimateRunnerCost` use a 30-day (720 h) month; the permit ceiling is
  enforced on that basis.
- Chose: reuse `estimateRunnerCost` so the report's Nebius cost and the
  enforced accounting agree; the runbook says so. The difference is 1.4 % of
  the disk term.

### D-5 `fleet publish` subcommand instead of a shell script

- Plan allowed either. The subcommand reuses the report builder and the
  registry validator, and `assertPublishable` is unit-tested directly because
  the sanitized renderer has no path that could carry a private name.

### D-6 Controller eligibility excludes pull_request runs (resolved 2026-09-16)

- Plan said: change only the enrolled job's `runs-on`; the controller picks up
  every queued job that carries the label.
- Found: `packages/runner/src/adapters/github.ts` `buildQueueSnapshot` (now `runAdmitted`) admitted only `push`
  and `workflow_dispatch` runs on `allowedBranch` with zero associated pull
  requests (a pilot safety rule). P1's `check` job runs almost only on
  `pull_request` (PR-validated develop merges skip it, `ci.yml:100-105`), P2
  and P3 are push plus pull_request too. An unconditional cutover would leave
  every PR run queued until GitHub fails it after 24 hours.
- Why it matters: this invalidates the phase 3 procedure and the evidence
  volume goal. Options: (A) extend admission to `pull_request` runs whose head
  repository is the same private, non-fork repository, on any branch (a runner
  package change with its own tests and a config field); (B) a conditional
  `runs-on` expression that moves only default-branch pushes (tiny volume,
  and `extractJobRunsOn` refuses expressions by design). Owner decision
  2026-09-16: option A. Implemented as the runner config field
  `admission: 'default-branch-pushes' | 'same-repository'` (default the pilot
  rule; optional on input so pilot configs parse). `same-repository` admits
  `push`, `workflow_dispatch` and `pull_request` runs on any branch whose head
  repository is the enrolled private repository itself; forks were and remain
  refused by the head-repository identity check. `fleet controller-config`
  writes `same-repository`. Tests: `adapters/github.test.ts`,
  `config.test.ts`, `fleet-service.test.ts`. The P1 config was regenerated
  (new `configHash` `48ae01b6…`) and its dry-run journals archived under
  `P1/dry-run-reset-20260916/` because the controller refuses journals of
  another identity.

### D-7 `same-repository` also admits `schedule` runs (found live 2026-09-17)

- Found: P1's nightly `schedule` run (35178537656, 03:32Z) queued its `check`
  job on the self-hosted label while the controller ticked idle: D-6 listed
  `push`, `workflow_dispatch` and `pull_request` only, and the adapter test
  pinned the schedule exclusion. The targets table had recorded
  `schedule 2` events for P1; a cut-over cron would fail after GitHub's
  24-hour wait.
- Chose: `schedule` joins the `same-repository` list (`adapters/github.ts`
  `runAdmitted`); the head-repository identity check still applies and a
  schedule run is the enrolled repository's own default branch. The pilot
  rule is unchanged. Tests: `adapters/github.test.ts`.
- Cost: a bundle change re-identifies the live P1 controller (candidate
  digest), so the swap needs `runner cleanup` and a re-issued permit; the
  queued job is picked up by the fixed controller if the swap lands inside
  the 24-hour window.

### D-8 P2 enrolls two jobs under one enrollment via `--job-name` (2026-09-17)

- Plan said (D2): P2's two single-run jobs are "both enrolled so a run
  serializes them on one VM".
- Found: an enrollment carries one `jobKey`, and `controller-config` writes
  `eligibleJobNames` from that enrollment alone; a second enrollment would be
  a second controller and VM. Extending `--job` to repeat is a bundle change,
  which re-identifies every live controller (P1 permit v4).
- Chose: `fleet enroll --job test --job-name test --job-name "<contract
  display name>"`; `--job-name` is free-form for a non-matrix job. `cutover`
  and `verify` track the `test` job's `runs-on` and the whole-file blob SHA;
  the contract job's `runs-on` is part of the same commit and is checked by
  hand at cutover. The telemetry join and the report attribute both jobs to
  P2 as intended. The workflow edit also carries the P1 Supabase CLI split
  (`runner.environment`), a known guest-parity need, rather than a second
  round trip.
- Recorded for later: a repeatable `--job` with per-job `runsOn` capture.

### D-9 Two VMs in one project blinded both controllers (found live 2026-09-17)

- Found: 13 min after P2's `create-vm`, P2 ticked `pending` with every
  provider readback `complete: false`, and P1 flipped to
  `blocked: resource ownership is unknown` at the same moment. The parser
  accepted the live listing; the cause was `runProcess`'s 64 KiB default
  output cap (`adapters/process.ts`): the project listing is ~33 KiB per VM,
  the second VM pushed it to 65,863 bytes, the truncated JSON failed to parse
  and `observeProvider` swallowed the error into an incomplete readback.
- Chose: the runtime context passes `maxOutputBytes` 64 MiB to both CLI
  process runners (`CLI_OUTPUT_LIMIT_BYTES`, `runner-service.ts`); test
  `runner-service.test.ts` "exceeds 64 KiB" pads the fake listing with 300
  unrelated instances and asserts `inspect` still observes the provider.
- Cost: bundle change, so both live controllers were re-identified (P1
  permit v4, P2 permit v2) after `runner cleanup` of their stopped VMs. The
  installed bundle could not run that cleanup ("direct action requires
  complete provider and queue observations" is the same defect), so the
  owner-authorized cleanups ran the fixed bundle with
  `CIRUJANO_CANDIDATE_DIGEST` set to the old digest to satisfy the old
  permits' binding; the wrapper still never sets it.

### D-10 Guest work directory gets hosted path parity (found live 2026-09-17, P2)

- Found: P2's first run passed the contract job on the runner but failed
  `@archy/web` coverage thresholds (98.87 % lines) with all 2254 tests
  green; hosted measures 100 % for the same commit and turbo task hash.
  vitest matches `coverage.include` globs against the absolute path with
  `contains: true`; the workload's `lib/**/*.ts` matched every file under
  `/var/lib/cirujano/runner-1/_work/...`, so files hosted never measures
  (its `app/(dashboard)/**` globs match nothing because of the parentheses)
  entered the report with real gaps. Verified with the installed picomatch
  against both roots; a clean Linux x64 / Node 24.21.0 container run of the
  same commit measured 100 %.
- Chose: `register-runner.sh` registers with `--work /home/runner/work`
  (`CIRUJANO_RUNNER_WORK`), so `GITHUB_WORKSPACE` is
  `/home/runner/work/<repo>/<repo>` exactly as on GitHub-hosted runners;
  test in `guest.test.ts`. The workload's latent coverage bug is the
  workload owner's to decide; the runner must not be the thing that
  changes a measurement.
- Cost: bundle change (guest files are embedded in cloud-init), so both
  controllers were re-identified a third time on 2026-09-17.

### D-11 A stale pending effect deadlocked the controller (found live 2026-09-22, P1)

`pendingAuthorizationProblem` treated a pending effect whose own deadline had
passed as an authorization failure. Every tick therefore re-entered
`blockPendingAuthorization`, wrote `status: 'blocked'` and returned, and
nothing ever cleared `pendingEffect`, so the controller could never reach
`decideLifecycle` again -- not even to drain, stop or delete. The deadlock was
terminal, and it is the "controller-side deadline backstop" follow-up recorded
after D-10.

P1 entered it at 2026-09-18T06:42:08Z on a `register-runner` effect
(`cirujano-p1-20260915:1789703469772:register-runner`, stage `emitting`).
Consequences over the next 108.5 hours, all verified on 2026-09-22:

- Instance `computeinstance-e01mak1fprhndzffqy` stayed `vmStatus: running`
  with `runnerActive: false` and `runnerOwnership: absent` -- idle and
  billing. The guest watchdog's grant deadline (2026-09-18T07:47:08Z) passed
  without the poweroff firing, because the controller never issued the stop.
- Accounting froze: `cumulativeCostUsd` read `0.00147` and
  `runtimeBaselineMs` `0` while roughly 108.5 h of compute accrued. The
  permit's `maxTotalCostUsd: 40` could not catch it, because the budget check
  runs at start and this VM was already started. `cleanup` deleted the
  instance but did not reconcile the journal, so the runtime was never
  journalled and the report still cannot see it.
- `juan294/portfolio` `check` jobs queued against a runner that never
  registered: the 09-19, 09-20 and 09-21 nightly `schedule` runs and three
  Dependabot PRs on 09-21 were all cancelled at GitHub's 24-hour self-hosted
  timeout, and the 09-22 run was still queued when this was found.

Fix `86ea6e6`: staleness moves out of `pendingAuthorizationProblem` into
`pendingEffectIsStale`, and a stale effect is abandoned -- `pendingEffect` and
`outstandingIntent` cleared, an `effect-abandoned` event journalled, and the
next tick decides from the observed provider, guest and queue readings.
Clearing is safe because `decideLifecycle` reads observed state rather than
replaying the journal. Genuine authorization failures (identity mismatch,
revoked or mismatched permit, unauthorized operation, expired permit) still
fail closed and still block; `stop` and `delete` stay exempt from the
staleness check so recovery can run late.

Remediation: the P1 VM was deleted, P1's launchd agent was booted out, and
`juan294/portfolio` PR #1122 returns the `check` job to `ubuntu-latest`. P2
and P3 ran the bundle that carries this defect until the 2026-09-23 swap onto
`86ea6e6` and later (see D-12 to D-14).

Lesson: a permit bounds what the controller may do, not what it will do when
it stops deciding. Every state that returns without clearing `pendingEffect`
needs an exit, and the budget ceiling cannot bound a VM that is already
running while accounting is frozen.

### D-12 Work arriving mid-drain forced a VM restart (found live 2026-09-23, P2)

The observe step zeroed `eligibleQueuedJobs` whenever the journal said
`draining`, so the R03 rule "queue arrival during drain returns to work"
(`lifecycle.ts`, `resume-admission`) never fired. A job queued mid-drain cost
a full stop and start: 2 min 16 s on P2 plus one permit start. Removing the
override exposed two more gaps. A resume near the grant deadline would idle
until the watchdog fired, and a second drain in the same generation reused
the first drain's idle evidence. A latent defect sat alongside: the idle
observation append stopped at 100 entries, after which idle grace could never
pass and a drained VM would idle until its watchdog deadline. P2's archived
journal reached 67 entries in 8 generations.

Fix `813b3f7`: pass the real queue; resume only when the VM is running, the
guest is drained and the job fits the grant and permit cutoff; mark a
generation leaving idle with one `complete: false` observation and count grace
only after it; append without the cap (the controller merge already keeps the
latest 100). Verified live 2026-09-24: P2 went `begin-drain` →
`resume-admission` → `register-runner` on one generation.

### D-13 A lost grant update wedged a controller in draining (found live 2026-09-23, P2)

P2 sat in `draining` with its VM running: journal `startCount 4`, guest still
enforcing generation 3's exact grant. Idle observations need the two to match,
so grace could never pass, and the guest was enforcing the old deadline. Root
cause, reproduced against the old scripts: the watchdog rewrote `grant.env`
every tick (`source` → update → write back) without a lock, so an `arm-grant`
landing between its read and write-back was silently undone (generation 2
armed, generation 1 restored). The controller then marked the start resolved
because `arm-grant` exited 0. An earlier diagnosis blamed Nebius operation
parsing; `mapInstanceState` reads the real `status.state` and was not at fault.

Fix `3243628`: `arm-grant` and the watchdog share `grant.lock` (`arm-grant`
exits 4 when busy); a start reconciles only once the guest reports the armed
generation, re-arming otherwise; a guest grant that lags the journal is a named
`blocked` decision instead of a silent idle-grace loop. Guest scripts reach
only VMs created after a deploy, so the swap's `cleanup` is what rolls them
out. Verified 2026-09-25: two restarts of an existing P2 VM, grant equal to
`startCount` each time, no mismatch decisions on P2 or P3.

### D-14 Direct-stop recovery blocked forever and replayed stale results (found live 2026-09-23, P2)

Recovering P2 by hand exposed two defects in `runner stop`. With no journalled
operation id, `recoverDirectEmission` treated every operation ever run on the
instance, including hours-old `SUCCEEDED` ones, as in flight and blocked on
every run. And `mutateOwned` answered "done" from any `resolved` record
without reading the provider: once a later generation restarted the VM,
`runner stop` reported stopped in 0.6 s while it was running, and `cleanup`
then refused to delete a running instance.

Fix `3243628`: only `PENDING`/`RUNNING` operations block; a `stopping` VM
waits; a VM still running after finished operations gets the one-shot retry;
a resolved record replays only while the provider still agrees.

## Phase 3 state

Local, read-only preparation done on 2026-09-15 with the phase 4 bundle:
`fleet init` wrote the private registry; `fleet enroll` recorded P1
(`juan294/portfolio` is private and stays out of this repository; the handle
mapping lives in the ignored `docs/agents/fleet-migration-targets.md`) with
its default-branch commit and blob SHA; `fleet verify` is green;
`telemetry report --registry` shows 26 hosted `check` jobs, 276 minutes and
USD 1.656 in the before window; `fleet controller-config` wrote
`~/.local/share/cirujano/runner/P1/{config.json,ssh_host_ed25519_key}` with
identity `controllerId cirujano-p1-20260915`, `resourcePrefix cirujano-p1`.
Done 2026-09-16: D-6 decided and implemented (`f5ddeea`, reviewed APPROVED);
launchd dry-run agent installed and ticking `absent`; Nebius service account
`cirujano-controller` and its auth key created (the group membership and
project permit need the owner because the auto-mode classifier denies
permission grants); P1 workflow edit committed on `cirujano/p1-check-runner`
in a portfolio worktree. Owner-executed steps still pending: push `develop`,
the IAM group/membership/permit commands, push the P1 branch and open its PR,
issue the operating permit, merge, first real jobs.

## Independent reviews and dispositions

Reviewers ran in fresh contexts against the phase commits; fixes landed in the
review-fix commit that follows `042736f`.

### Phase 1 (`0b28e3b`): CHANGES REQUIRED, no blockers

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | `stripComment` cut a `#` inside quotes (`name: "build #1"`) | resolved: quote-aware comment stripping; test with a quoted `#` |
| 2 | block `runs-on` sequence at the key's own indentation refused | resolved: items accepted at indent `>= body`; test |
| 3 | cutover checked `self-hosted` + label, plan requires `linux`, `x64` too | resolved: `requiredSelfHostedLabels`; validator, cutover and verify use it; tests |
| 4 | matrix job silently enrolled under the job key | resolved: `enroll` refuses a `strategy:` job without `--job-name`; test |
| 5 | "enroll it afresh" after a revert was impossible | resolved: reverted entries no longer block uniqueness; registry and service tests |
| 6 | added enrollment fields undocumented | resolved: D-1 above; phase-1 handoff |
| 7 | block scalar `runs-on: >` persisted `[">"]` on refresh | resolved: block scalars refused; test |
| 8 | fake page runner only rejected `--method` | resolved: fake asserts the exact `api --paginate --slurp <endpoint>` argv |
| 9 | `FLEET_SKUS` duplicates the rate table keys | rejected: `args.ts` stays free of the telemetry import; the registry validator is the authority and rejects an unpriced SKU |
| 10 | queue latency uses the run's first `created_at` | resolved: footer says so |
| 11 | `usd()` renders 3 decimals | rejected: sub-cent per-enrollment values would round to `$0.00`; the fleet table keeps 2 |
| 12 | verify refresh does not re-check the SKU | rejected: `writeFleetRegistry` re-validates and fails closed with the validator's message |
| 13 | test title overclaimed | resolved |
| could not verify | `--slurp` on single-object endpoints returns one page | verified live: `fleet enroll` P1 ran the four endpoints against GitHub and recorded the blob SHA |

### Phase 2 (`0e32b3f`): APPROVED

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | stale `grantDeadlineMs` survived delete/create reconcile | resolved: cleared on create-vm and delete-vm reconcile; recovery test asserts `null` after both |
| 2 | fleet ceiling ignored other enrollments' unissued proposals | resolved: `permit.json`, else `permit-proposal.json` count (the draft carries the same ceiling); service test refuses the fourth USD 40 proposal |
| 3 | installer smoke used a mock CLI | resolved: `run-cirujano-controller.sh` is exercised against the built bundle with the fixture endpoints (`runner-service.test.ts`); the installer test keeps the mock for launchctl orchestration |
| 4 | template rate equal to the SKU rate | resolved: template uses 0.062 |
| 5 | `startCount` 0 could emit `delete-vm` generation 0 | resolved: guard |
| 6 | `launchctl print` failure under `set -e`; sed escaping | resolved |
| 7 | node resolved through the plist PATH | resolved: `CIRUJANO_NODE_PATH` honoured and the version logged; the runbook keeps Node 22 as the expectation |
| 8 | one error text for every absolute path option | resolved |
| 9 | `network_ssd` vs `network-ssd` cosmetic | rejected: mirrors the pilot proposal shape |
| 10 | supplied `estimatedMaximumUsd` overwritten | resolved: a supplied value is validated, an omitted one derived |
| 11 | controller-side deadline before the guest watchdog (observation) | accepted as a phase 3 note: the guest window is shorter by boot time; watch for a pending `start-vm` after an expired generation |

### Phase 4 (`042736f`): CHANGES REQUIRED, no blockers

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | documented `fleet publish --output` relative path was refused | resolved: the output path is resolved against the working directory; the runbook uses `$PWD`; publish test runs with a relative path |
| 2 | a lazily written `assignments.json` hid real Nebius spend | resolved: absent `assignments.json` means no assignments yet; controller-state and accounting stay required; test |
| 3 | regenerated config next to old journals was costed at new rates | resolved: `configHash` and `repositoryId` checked across config, state and the enrollment; tests |
| 4 | guard case-sensitive and full-name only | resolved: case-insensitive, bare repository segment matched; tests |
| 5 | reverted enrollments counted as "cut-over" in totals | resolved: documented in `fleetSavings`; they keep their evidence |
| 6 | `measurementWindow.through` never applied | resolved: a registry report is bounded by the window end; test |
| 7 | 30-day month deviation not in the phase file | resolved: D-4 and the phase-4 handoff |
| 8 | no end-to-end `complete: true` publish case | resolved: publish test journals match the fixture jobs and assert `complete: true`, USD 0.293 / -0.257 |

## Simplify pass (reuse, simplification, efficiency, altitude)

Applied: shared `requiredSelfHostedLabels`, `findActiveEnrollment` and
`SHA_PATTERN` in `fleet-registry.ts`; `runnerConfigHash` exported from the
runner `config.ts` and used by the runner service, the fleet service and the
tests; `finitePositive`/`validRecentQuoteDate` exported from `pilot.ts` for
`operating.ts`; `HOSTED_SKUS` as the single SKU list (args, registry,
telemetry); `absolutePath`/`expandHome`/`readOptionalJson`/`nonnegativeNumber`
in `github-api.ts` replacing four path normalisers and three ENOENT readers;
`validIsoDate` reused by the registry; shared Markdown row cells and footnotes
between the private and sanitized renderers; `compactDate`; the compare read
asks for one commit per page; the wrapper no longer overrides the CLI's
self-measured candidate digest; a plain whole-word scan replaces regex
construction in the publication guard; the fleet ceiling reads `permit.json`
or `permit-proposal.json` (the draft carries the same ceiling); one
`removeOwnedRegistration` serves drain and delete.

Recorded for later (architectural, not drive-by): a `PublishableFleetReport`
projection so the sanitized renderer structurally cannot leak; a registry
`controller.permit` record instead of state-directory archaeology for the
fleet ceiling; a YAML dependency or a narrower `runs-on` contract for
`extractJobRunsOn`; journaling the whole `StartGrant` with invariants in
`assertStateInvariants`; a shared identity comparator exported from the
runner; moving `readRegistry` and the evidence readers out of the fleet
command module; a shared validator module parameterised by error class; the
two launchd installers sharing a sourced library; parallel GitHub reads in
`verify` once enrollments exceed a handful.

### Fix commit (`b4e50a1`): APPROVED

Every disposition above was confirmed against the code. Low notes accepted as
is: an apostrophe inside an unquoted job `name:` keeps a trailing comment in
the captured display name (`--job-name` overrides it); the bare-segment guard
refuses a publish whose private repository name coincides with a word of the
report template (fail closed and loud).

### Guest parity (`da6983d`): APPROVED, one deferred finding

Review of the hosted-parity change (postgresql-client, zstd, passwordless sudo
for `runner`): the sudo grant adds no privilege because the runner user was
already root-equivalent through the `docker` group, and the old helper-only
sudoers rule already let a job re-arm the grant through `arm-grant`'s stdin.

Deferred, architectural (owner-visible, not resolved here): the controller's
emergency stop (`lifecycle.ts` immutable-deadline branch) compares `nowMs`
against the guest-reported `grant.deadlineMs`, and runtime accrual uses the
guest-reported `startedAtMs`, so a root job that forges `/opt/cirujano/status`
can keep a VM running past `lifetimeMs` and past the permit's runtime and cost
ceilings until the owner stops it; the permit expiry still blocks every new
start. Proposed fix: emergency-stop once `nowMs >= journal.grantDeadlineMs`
regardless of the guest, and accrue runtime from the journaled start. Bounded
today by the owner's own project cost and the report's controller evidence.

## Phase 3, P1: cut over 2026-09-16

- Owner-executed: `develop` pushed (CI #34 and CodeQL green at `f04e02a`), P1
  branch pushed, PR opened and squash-merged at 18:41Z; permit v1 then v2
  confirmed in session; Nebius IAM group and permit created after the owner
  allowed the classifier-denied grant.
- Automated: `fleet cutover --id P1 --commit <merge>` recorded `after`
  (`verify` green); `telemetry collect` + `report --registry` run over the real
  store with `complete: true` (phase 4 live acceptance).
- Live findings, each fixed before the next run: (1) `supabase/setup-cli`
  restores a hosted-runner bun cache that is unusable on the VM (workflow-side
  fix in the target repository: pinned CLI from npm when self-hosted);
  (2) `psql` absent on the guest, then Playwright `--with-deps` needs sudo
  (guest parity change `da6983d`, reviewed APPROVED); (3) under launchd every
  gh and nebius CLI read takes 10-15 s so the 30 s timeout tied to
  `pollIntervalMs` failed every `watch` tick (`780307a`: 120 s floor and gh
  stderr surfaced); (4) the Nebius federation token lives ~12 h, so the
  controller runs on a dedicated service-account profile.
- Evidence: three Cirujano jobs on P1 (two failures on the old image, one
  16-minute success on the parity image), assignments journaled with runner
  ids 21, 22, 23; generation costs USD 0.087 (archived, old bundle) and
  USD 0.060 (live).
- Follow-ups recorded: sum archived generations into the report; a controller
  restart after a >120 s read hang paused ticks for minutes (KeepAlive
  recovered); the deferred controller-side deadline backstop.
- Next: P2 and P3 are separate acceptance gates; the after-window evidence for
  P1 accrues from the next post-merge `check` run.

## Phase 3, P2 and P3: cut over 2026-09-17

- P1 after-window: the first post-cutover nightly `schedule` run succeeded on
  the runner after D-7 (8 min on the runner, 56 min queued while the
  admission fix shipped).
- P2 (two single-run jobs, one enrollment per D-8): the PR run passed the
  Docker-backed contract job on the guest first time (6.8 min); the test job
  failed its 100 % coverage thresholds until D-10 (path parity), then passed
  (2.4 min). Merged and cut over; the post-merge run serialized both jobs on
  one generation and was green.
- P3 (four coverage shards, matrix enrollment): the PR run serialized the
  shards on one slot, about 2.5 min each on the 4-vCPU guest plus about
  1 min of ephemeral re-registration between them; stage 17.5 min including
  a 4 min cold boot against about 6 min hosted in parallel. The hosted
  coverage-merge accepted the guest blobs. The owner accepted the added
  PR latency for the hosted minutes saved; merged and cut over.
- Three live defects found and fixed the same day (D-7, D-9, D-10), each
  paid for with a controller swap; guest-only changes keep the CLI digest
  and the permits (D-10).
- Owner decision 2026-09-17: the cc-rpi bash guard is removed from this
  repository (`e7488e9`); remote steps run from the session with the
  committed ask rules.
- 2026-09-22: P1 found deadlocked since 2026-09-18 (D-11); VM deleted, agent
  booted out, portfolio reverted to hosted by PR #1122. P2 and P3 verified
  healthy the same day -- `cirujano-p2-vm` RUNNING and serving a real job,
  `cirujano-p3-vm` STOPPED.
- Measured 2026-09-13 to 2026-09-22: gross hosted cost avoided USD 0.73 (31
  jobs, 122 min) against P2 + P3 `cumulativeCostUsd` of USD 2.23, plus P1's
  unjournalled leak. The fleet is net negative so far. Retained disk is the
  driver: 80 GiB at USD 0.071/GiB-month is USD 5.68 per controller per month
  whether or not the VM runs, and measured retention was 107.8 h (P1),
  129.4 h (P2) and 126.5 h (P3) against about 75 min of VM runtime.
- Next: after-window evidence accrues for P2 and P3; `telemetry report
  --registry` and `fleet publish` once the windows carry enough runs. Open
  follow-ups: archived generations in the report, reconciling the journal
  after `cleanup` so an abandoned generation's runtime is still counted,
  right-sizing or releasing retained disk between runs, a second runner slot
  or larger preset for P3, and re-cutting P1 once the D-11 fix is deployed.
- 2026-09-23/24: P2 and P3 swapped three times, onto `86ea6e6` (D-11),
  `813b3f7` (D-12) and `3243628` (D-13, D-14), each with cleanup, archived
  journals and owner-issued permits; the live bundle is `ab45ac4c` under
  permits `P#-operating-20260924` (USD 80 of the USD 120 ceiling). P1's
  permit is retired, its registry entry recorded `reverted` by `fleet verify`,
  and its launchd agent removed. A fourth candidate was declined: each of its
  workflows alone spends less than one controller's retained-disk floor.
- Operating lesson 2026-09-23: another operator (an owner-authorized release
  session) recovered P2 by hand while a swap was waiting for an idle window.
  Swaps now check for other active operators before touching a controller.
