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

## Later continuation: startup verification and scheduling drift

One further naturally absent controller completed the digest-only transition, with native identity validation, provider absence and preserved permit/counters. Its first readiness check failed: a completed observation reported incomplete GitHub evidence with synthetic HTTP 0, no reserve hold and a queue timestamp older than the 165-second acceptance bound. Fresh accounting alone did not satisfy readiness, so subsequent controller updates were held. The candidate remains installed; no stale journals were restored.

Local diagnosis found that this controller still used launchd `ProcessType=Background`. The current runner template specifies `Standard` at scripts/launchd/com.thecreativetoken.cirujano-runner.plist.in:38, and packages/cli/src/runner-scheduler.test.ts:23 asserts that policy. Five of nine installed controller plists retain Background; earlier successful observations do not establish sustained cadence under current host load.

A bounded local probe made no API calls. The same `gh --version` command completed in 0.103 seconds under a utility QoS clamp but exceeded ten seconds under a background clamp; the probe cleaned up its owned process group. A native sample of an actual delayed gh child was mostly unsymbolicated and does not identify a DNS, TLS or GitHub-side cause. The probe supports local scheduling delay as a contributor, without attributing every earlier timeout to it.

The next corrective step is limited to the failed controller: reconcile its ProcessType with the existing Standard template during a freshly verified absent/no-work gap. This is an explicit adjustment to the earlier original-plist preservation rule. The reviewed transaction must change only ProcessType, preserve the current bundle and all JSON journals byte for byte while stopped, and repeat post-start readiness. No broader policy correction or successful recovery is established by the probe alone.

The correction subsequently passed native before/after checks, fresh provider absence and the locked state comparison. Only ProcessType changed. Independent review accepted three distinct qualifying observations within 218.66 seconds of restart; queue age was 87.02 seconds and accounting age 0.34 seconds at assessment, both below the existing 165-second limit. The loaded spawn policy matched Standard peers. Configuration, permit limits and all active journal identities matched, and lifecycle counters did not regress. The earlier failed readiness remains preserved.

A concurrent local check found all four other Background controllers absent but with incomplete queue observations approximately 250 seconds old and no disclosed reserve hold. The same narrow correction is therefore prepared for those four, one at a time under the existing fresh absence, no-work and state-preservation checks. The generalized helper passed twelve offline fixtures and independent review, and requires the exact accepted policy-canary receipt before operation. This extends the explicit ProcessType adjustment; it does not alter controller configuration hashes, polling intervals, permit ceilings or the tested bundle. Raw receipts remain private.

## Completed fleet rollout and policy reconciliation

The remaining three bundle transitions completed during independently verified natural absence. All nine controllers now use the exact tested bundle. The four remaining scheduling corrections then completed one at a time using the accepted narrow transaction. Each changed only ProcessType, preserved the stopped JSON journals and bundle, and passed fresh post-start identity, permit, counter, queue-or-disclosed-hold and accounting checks. One attempted correction safely deferred when a child appeared; a separate private artifact-directory error occurred before any live operation. Both attempts are retained with the successful receipts.

Independent review of the readback helper found that future timestamps could satisfy its original age comparison. A failing offline regression reproduced this, and the repaired predicate now requires an age between zero and 165 seconds using one captured current time. All five boundary fixtures passed. Previously accepted observations had positive ages and remain within the repaired condition.

At 11:38:58 UTC, a local snapshot verified all nine exact bundle/permit identities, Standard plists and matching loaded launchd spawn policy. Queue timestamps were 9–32 seconds old and accounting ages were 8–29 seconds. All nine disclosed a GitHub reserve hold; this is fresh hold/accounting evidence, not complete queue evidence. Their recorded reset was 11:49:07 UTC. At the first post-reset readback, six had new complete queue observations while three still showed their preceding hold. These point-in-time readbacks do not establish sustained fleet cadence, a complete account ledger, busy-job recovery or measured savings.

Private per-controller transactions, prior failures, policy canary acceptance and final readbacks are preserved under the ignored qualification evidence directory. Normal controller operation continues. Polling intervals, configuration hashes, permit ceilings and counters were not reset to obtain acceptance. The separately bounded gh-glance single-pane trial started after the reset; its result belongs to gh-glance qualification and is not inferred here.

Independent final review recomputed all nine installed bundle hashes, Standard plist policies and current active/permit identities. It accepted the five policy transactions and remaining digest-only activations within the recorded scope, with no blockers. Its private review binds 188 evidence inputs. It does not convert the initial held snapshot into complete queue evidence or a sustained fleet acceptance window.
