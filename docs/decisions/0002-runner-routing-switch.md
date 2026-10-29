# 0002: Gate enrolled runner selections behind a routing switch

Date: 2026-10-29
Status: Accepted

## Context

On 2026-10-28 every operating permit of the runner fleet expired at 23:59:59Z, the planned end of the measurement window. Enrolled jobs still asked for their Cirujano label without condition. From the start cutoff (one maximum job plus the shutdown margin before expiry) the controllers refused to start a VM. Jobs from owner pushes queued with no runner, and through `cancel-in-progress` concurrency they held every newer run on the same ref. Recovery needed a workflow push to every enrolled repository and a force-cancel of each stuck run.

The same stranding follows from every state in which a controller refuses to start: an expired or exhausted permit, a repository that is no longer private, a mismatched permit, and a stopped controller. The fleet could not see the risk either. The runner-selection parser refused any `${{ }}` expression, so from about 2026-10-08 `fleet verify` and `fleet cutover` could not read enrolled jobs that used hand-written expressions.

Plan: [2026-10-29-runner-routing-switch](../plans/2026-10-29-runner-routing-switch.md).

## Decision

- An enrolled job's `runs-on` is the canonical expression that `cirujano fleet runs-on` generates: `vars.CIRUJANO_RUNNER_<P#> == 'on' && (<owner clause> && ... && <workflow_ref clause>) && fromJSON('<labels>') || 'ubuntu-latest'`. An unset or deleted variable routes the job to `ubuntu-latest`, so every failure of the switch falls back to hosted runners.
- The fleet parser accepts only that shape. The guard must hold the exact owner and workflow_ref clauses as top-level conjuncts; it may be stricter. `cutover` refuses an ungated selection, and `verify` reports each enrollment on its own.
- `cirujano fleet health` (read-only) reports each cut-over enrollment as serving, expiring, no-auto-release, unserviceable, released, stranded, ungated or unknown, with the exact recovery command. The daily telemetry agent writes `fleet-health.md` and notifies the owner when it is red or the check fails.
- A permit may grant `release-routing`. Once a controller can no longer serve, it deletes its switch (confirmed by readback), then force-cancels runs whose only unfinished jobs are stranded on its label. Like cleanup, this authority survives permit expiry when the permit allows recovery. The step never creates a lifecycle effect, so the controller journal and its effect union stay unchanged.
- `cirujano fleet release --id <P#> [--cancel-stranded]` is the owner's command for the states the controller cannot handle: no permit, dry-run, or a stopped controller.
- Serviceability (`assessService`) uses the same limits as the lifecycle start budget: identity, operations, starts, runtime, projected start cost and the start cutoff. Routing is therefore released no later than starts stop.

## Consequences

- Turning a runner on becomes an owner action after cutover: `gh variable set CIRUJANO_RUNNER_<P#> --body on`. Turning it off needs no push.
- GitHub compares strings case-insensitively, so `ON` also enables routing. Health reads the value the same way.
- Jobs that were already queued when the switch went off keep their label. The controller, and `fleet release --cancel-stranded`, force-cancel their runs, then re-run the first stranded job of each run; any further stranded jobs of the same run, and runs that had already finished on their own, are reported for a push or dispatch instead. A live probe on 2026-10-29 measured that a re-run reads the current variable value: with the switch deleted, the re-run attempt ran on `ubuntu-latest`. Force-cancel is asynchronous, so a run that has not finished cancelling within the bounded wait is reported for a push or dispatch instead.
- The controller cancels only when no VM of its own is live or being created or started, because such a VM may still take the queued job.
- A variable with the same name at organization or environment level would keep routing on. Enrolled repositories are user-owned private repositories, which have no organization variables.
- A sleeping owner Mac stops the controller entirely, so it cannot release. This remains the accepted risk of the fleet plan (D1). `fleet health` and `fleet release` work from any machine with the owner's `gh` login.
- Operating permits take their expiry from `fleet permit-proposal --expires`, capped by the registry's measurement window end (changed 2026-10-29; the window recorded for the study still ends 2026-10-28). A new enrollment needs the owner to extend that window first.

## Rejected options

- Renewing permits on schedule: it does not cover cost, runtime or visibility exhaustion, and the cliff returns at every expiry.
- Owner-run release only: nobody was watching on 2026-10-28.
- Alerting without a switch: acting on the alert would still need a push to every enrolled repository.
