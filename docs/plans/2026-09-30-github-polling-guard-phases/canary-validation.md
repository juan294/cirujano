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
