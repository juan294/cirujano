# Activation proposal: GitHub polling guard

Status: bounded canary accepted; six of nine controllers updated under the owner's conditional rollout authorization. The remaining three await natural absence and fresh identity/provider checks. See [canary validation](canary-validation.md). Local gates passed. Tested bundle SHA-256: `72789ce149f92c311f0d20b6055a75728f14efd0f5bdf1bb3d81a11a5d5604c5`.

## Entry conditions

The local implementation, independent review and complete verification must pass. Record the source commit and SHA-256 of the built CLI bytes. Archive the old installed executable and its hash. Keep fleet identities and private paths in ignored operational receipts. Review the exact canary enrollment, permitted restart window and retained permit ceilings with the owner before any service operation.

A source change changes candidateDigest even though pollIntervalMs and configHash stay unchanged (packages/cli/src/runner-service.ts:173). Every saved identity and permit must agree. The controller rejects a different candidate in its journal (packages/runner/src/controller.ts:60); assignment, accounting and active-job journals also bind candidate identity (packages/cli/src/runner-service.ts:979). Replacing just a bundle or permit is insufficient.

## Prepare one canary while controllers continue running

1. Read the selected controller's current executable hash, full config hash, permit, journals, launchd definition and current process identity. Store a private manifest of every file and mode. Never record credentials.
2. Identify all identity-bearing files, including controller-state, accounting-state, active-job-state, assignments and direct-action-state. Discover additional files instead of assuming the list is exhaustive.
3. Wait for complete natural idle evidence: no busy job or unresolved assignment, no pending controller effect, no unresolved direct action, and provider/guest state agreeing with the journal. Waiting alone does not change launchd; the controller can acquire again before it is stopped. Recheck after the approved unload and lock release. A running guest or ambiguous ownership requires a separate owner-reviewed drain/recovery operation; do not kill a job to finish this rollout.
4. Prepare an offline identity transition that validates the old complete identity on every journal and permit, changes only candidateDigest to the reviewed bundle hash, and preserves every counter, grant deadline, pending history and ceiling. No config, VM label, resource prefix or configHash changes. Reject pending effects and unresolved direct actions. This repair does not add or validate a migration executable; review the concrete transition diff before live use.

## Authorized canary activation

1. Under explicit service-change authorization, unload only the named canary controller and prove it exited and released its lock. SIGINT invokes drain/recovery (packages/cli/src/runner-service.ts:254); do not treat it as a harmless pause. Re-read quiescence and identity after exit. If they changed, retain the old executable and state and stop activation.
2. Take an immutable private snapshot after quiescence. Stage the new executable and transitioned journals/permit separately. Validate the exact old-to-new diff: only candidateDigest changes, with no reset of starts, runtime, cost or assignments. Reissued authority keeps the remaining limits and expiry; a fresh full budget is not implied.
3. With launchd still unloaded, install the complete reviewed set atomically per file, validating the manifest before restarting. A partial failure leaves the service unloaded. Never let KeepAlive run against a partially transitioned set.
4. Restart only the canary under the approved permit. Verify executable hash, process identity, matching journal/permit identity and fresh tick output. A hold is visible as githubReadHold with retryAtMs and queue.complete=false. Provider/guest/accounting ticks must continue. Verify known busy evidence is retained.
5. Observe a bounded canary window with a separately reviewed request receipt method. Count actual 200/304 responses and GitHub primary quota headers, retaining concurrent-account usage as unattributed. Do not infer charged savings from subprocess counts. Stop expansion on malformed revalidation, missing retry disclosure, stale queue acceptance, mutation during incomplete evidence, identity mismatch, accounting regression or unexpected request growth.
6. After canary acceptance and owner authorization, apply the same process one enrollment at a time. Never replace a shared bundle while other controllers retain old permits. Resume gh-glance qualification only after enough measured shared quota remains; use its bounded one-pane gate before any multi-pane window.

## Rollback

Keep the old bytes, file manifest and pre-transition state private. Before the new controller makes any durable writes or emits effects, rollback may restore the complete original executable/identity set while unloaded. After it records observations, accounting or effects, restoring old journals would lose history and could replay mutations: first quiesce and reconcile the new controller, then review a reverse digest-only transition of the latest journals preserving counters and history. Unknown state blocks rollback mutation and requires recovery with the executable and authority that own the outstanding effect.

## Unproven outcomes

Local fixtures do not measure production ETag coverage, charged savings, fleet reserve enforcement or live migration. Per-process cache/hold resets on restart; other clients and in-flight requests can cross the reserve. Primary quota and secondary limits are distinct. This proposal does not change Upptime authentication, Sutura schedules, running controller intervals, cloud resources or the separate work-computer qualification gate.
