# Single-controller canary validation

Date: 2026-09-30. Source: local develop `61f60b01301665328162b3a00be8a703b0a66db6`. Installed candidate SHA-256: `72789ce149f92c311f0d20b6055a75728f14efd0f5bdf1bb3d81a11a5d5604c5`.

## Scope and authority

The owner's continuation authorized the first canary under the reviewed activation procedure. One naturally absent controller was selected; no fleet expansion, release or push was performed. The other eight installed bundles retain the prior digest. Private enrollment identity, provider readbacks, helper sources, manifests and receipts are preserved under ignored `docs/agents/github-polling-canary-2026-09-30/`.

## Preparation and installation

A staging-only helper changed candidateDigest in four active JSON files. Native configuration, controller-state and permit parsers validated both copies. Configuration, historical proposal/draft, starts, runtime, cost, limits and expiry were preserved. Seven offline transition tests passed after failing regressions. Ten relay fixture tests passed; an initial 100 ms timeout fixture failed before printing its PID, so its timeout was increased to three seconds while retaining child-reaping assertions. Failed receipts were preserved.

Independent review approved the preparation and transaction. After unloading only the canary, the transaction proved old-process exit, acquired the native controller lock, took a fresh snapshot, repeated native validation and confirmed provider absence. It compared source file hashes and modes before replacing the active state, private bundle and canary plist. The shared wrapper and guest assets were unchanged. Once bootstrap was attempted, the transaction could not restore stale journals automatically.

The installed runtime is Node 26.10.0 and Python 3.14. Native CLI help and identity validation passed on that Node runtime. The prior 600-test, typecheck, lint and bundle gates still cover the unchanged candidate under their recorded local runtime; they were not relabeled as a full Node 26 suite.

## Observed result

The 300-second receipt window began at 08:14:30 UTC. Three successful GET receipts were captured. Repository and Actions-runs responses showed Core remaining values of 1989 and 1988; the guard held later reads until 08:48:40 UTC. The runners response reported a different reset epoch, so these counters must not be combined into a shared-account debit calculation.

Five ticks within the window reported incomplete queue evidence, zero eligible jobs and no lifecycle effect. The controller remained absent. All active state contents, apart from candidateDigest, matched the pre-transition snapshot at the comparison. The bounded receipt file did not gain further records during the hold. The relay can omit a receipt if measurement fails, so this is an observed count, not proof of complete request accounting.

A late-window tick/accounting gap prevented steady-cadence acceptance. A local process inspection during the gap showed a Nebius subprocess under the canary; this supports a provider-read delay, but does not establish a remote cause. Fresh ticks resumed afterward: the retained post-window readback had eight ticks, its latest input was three seconds old and its accounting file one second old.

## Acceptance and next gate

Independent evidence review accepted partial validation: the identity transition and visible quota hold worked. No 304 response, live conditional-read saving, complete request ledger or full cadence pass was demonstrated. Production savings remain unmeasured. Fleet expansion is not accepted by this result.

The canary remains active on the candidate. After the five-minute measurement deadline, its relay transparently executes the normal gh command. It will retry eligible reads after the hold expires, subject to normal polling and provider availability. The next gate is post-reset recovery and a bounded conditional-read window before expanding to other naturally quiescent controllers. gh-glance's personal multi-pane and separate work-computer qualification gates remain open.

## Second bounded window and post-reset preparation

The owner's next continuation authorized another bounded canary check and, only after acceptance, one-at-a-time updates of naturally absent controllers. The diagnostic restart retained the same executable, journals, permit and counters. It changed only private measurement helpers and the canary's launchd environment.

Review found that the old measurement helper waited longer than the caller's 250 ms termination escalation. The replacement kills its owned child process group and reaps the direct child immediately on termination. Eleven GitHub relay fixtures passed. Four Nebius fixtures passed, including an installed-filename regression after review caught an import mismatch. These are operational helper checks, not new application-source test results.

The second 300-second window began at 09:20:12.963 UTC. It captured six unconditional GitHub 200 responses and four successful provider commands, with measured durations from 946 to 9177 ms. Core remaining reached 1981 before bootstrap polling completed, so the candidate disclosed a hold until 09:48:48 UTC. Four completed ticks retained an absent lifecycle and unchanged counters. No conditional 304 was captured.

The window did not pass cadence acceptance. The last sample had accounting age 151.51 seconds. A later native process sample found the pending helper still initializing Python, before the relay program or Nebius command ran; a concurrent host snapshot recorded load average above 260. This establishes a local startup delay during the diagnostic, not a remote provider cause. Earlier delays remain unattributed. After the measurement expired, the provider helper was replaced with a direct shell exec to remove Python startup from subsequent provider reads.

A separately tested GitHub entrypoint arms observation only from 09:48:48 through 09:53:48 UTC. Six boundary/forwarding fixtures passed after two new assertions failed against the previous entrypoint. Installing this helper did not restart the controller or discard its cache. The future window is not acceptance evidence yet.

Fleet preparation now covers optional accounting, assignment, active-job and direct-action schemas, preserves explicitly reviewed historical files byte for byte, and rejects unknown files. Ten transition fixtures passed. Offline before/after validation passed for five locally absent enrollments. Local eligibility can change; every activation still requires fresh provider and journal checks. Private evidence is under ignored `docs/agents/github-polling-qualification-2026-09-30/`. No other controller has been updated by this preparation.

## Completed post-reset window

The 09:48:48–09:53:48 UTC window completed without restarting the canary. It captured 26 conditional 304 responses and one 200 response, four fresh complete queue observations with no hold, and four successful provider commands lasting 1.773, 4.466, 9.679 and 5.794 seconds. Native before/after validation passed; process ID and birth time matched. Configuration, permit, assignments, lifecycle and counters were preserved. The largest sampled accounting age was 63.28 seconds.

The observational cadence limit of 165 seconds was declared before this window, from the existing 120-second read timeout, 30-second polling interval and 15-second scheduling allowance. It is not a product timing guarantee. All mechanical checks passed, including sample coverage, advancing accounting, conditional response correlation within a completed controller cycle, and start/end freshness. Independent review accepted the window at 09:59:09 UTC. Its private `canary-acceptance.json` binds the exact bundle, observation window and evidence hashes; a raw 304 alone does not satisfy the gate.

The earlier failed window remains failed. These captured responses do not establish a complete request ledger, account-wide debit or fleet savings. The canary was absent throughout, so this evidence does not cover busy-job recovery. After the window, both diagnostic paths were returned to direct shell exec and the on-disk launchd plist restored for its next service load, without restarting the running candidate or changing its journals.

## Conditional fleet rollout

Following acceptance, five additional controllers were updated one at a time during natural absent states. Together with the canary, six of nine controllers now use the exact tested bundle. Each completed transaction retained the latest journals, configuration and permit limits, validated native identities before and after transition, proved provider absence, and verified fresh post-start observations with no accounting regression. Private per-controller manifests and readbacks are retained under `docs/agents/github-polling-qualification-2026-09-30/fleet/`.

Three controllers still have normal work or lifecycle transitions. Brief earlier absent observations did not authorize a later update after new work arrived. No busy job was interrupted and no permit ceiling was increased. The rollout remains incomplete until those controllers independently meet the same fresh absence and identity checks.
