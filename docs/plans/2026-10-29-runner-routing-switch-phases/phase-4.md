# Phase 4: Live probe and conditional re-run

Parent: [runner routing switch plan](../2026-10-29-runner-routing-switch.md). Entry: phase 3 accepted, and a separate owner authorization naming the scratch repository, the probe workflow commit, the variable writes, at most 3 dispatches and at most 5 hosted minutes. Without that authorization this phase does not start, and recovery stays cancel-only (decision D2).

## Goal

Measure against real GitHub what phases 2 and 3 tested only with fakes: variable get and delete, force-cancel of a job queued on a label with no runner, and whether re-running that job reads the current `vars` value. Turn on automatic re-run only if the measurement shows it routes to `ubuntu-latest`.

## Probe (outward-facing; runs only after authorization)

Scratch repository: a Cirujano-owned repository that the owner names at the gate. It must have no self-hosted runner registered, so a job asking for `cirujano-baseline-actions_linux` stays queued. No Nebius resource is involved.

1. Build a synthetic enrollment `P1` for the scratch repository in a scratchpad registry copy, then generate its selection with `cirujano fleet runs-on`. Commit one probe workflow (`workflow_dispatch` only, one job that echoes `${{ runner.environment }}` and its labels) under that line. This also proves the generated line works as written.
2. `gh variable set CIRUJANO_RUNNER_P1 --body on`; dispatch once; confirm through the jobs API that the job is `queued` with labels `["self-hosted","linux","x64","cirujano-baseline-actions_linux"]`.
3. Run `cirujano fleet release --registry <scratch copy> --id P1 --cancel-stranded`. Expect the variable to be absent by readback and the run `completed/cancelled`.
4. Re-run the cancelled job: `POST /repos/<scratch>/actions/jobs/<job_id>/rerun`. Read the new attempt's job labels.
   - Labels `["ubuntu-latest"]` and the job succeeds: **PASS** (re-run reads current `vars`).
   - Self-hosted labels again: **FAIL**. Force-cancel that attempt.
5. If step 4 fails or errors, repeat once with `POST /actions/runs/<run_id>/rerun-failed-jobs` and record the result separately.
6. Clean up: confirm the variable is absent, leave no queued run, and keep the probe workflow file only if the owner wants it.

Record every run id, attempt, job id, label list, HTTP status and response body in the ignored agent report `docs/agents/routing-switch-probe-<date>.md`. Committed docs carry only the outcome, with no repository name.

## Changes if PASS

- `packages/runner/src/adapters/github.ts`: `rerunJob(owner, repo, jobId)` (201 accepted; 403 or 422 kept with status and body).
- `packages/runner/src/routing.ts`: `selectStrandedRuns` also returns the stranded job ids per cancellable run.
- `fleet release --cancel-stranded` and the phase 3 release step re-run each stranded job after the cancel readback shows `completed`, and only when the switch readback is absent. The step emits `routing-stranded-rerun` with the new attempt number and drops the "push or dispatch" text for re-run jobs.
- Tests: adapter status mapping; "re-runs only after cancel readback and switch absent"; "never re-runs while the switch is on"; "reports a failed re-run with the push-or-dispatch step".

## Changes if FAIL

- No code change. ADR 0002 and `docs/runbooks/nebius-runner.md` record the measured result. The push-or-dispatch step stays permanent.

## Acceptance

Automated (PASS path): new tests red, then green; `pnpm run ci:fast` exits 0.

Manual:
- The probe report exists with every identifier listed above, and the PASS or FAIL decision follows the rule in step 4.
- ADR 0002 records the outcome and the date.

## Stop

Stop for acceptance. The plan is complete after this phase. Local integration into `develop` and any push need their own authorization.
