# Phase 4: authorized first-wave activation

Parent: [CI cadence plan](../2026-10-02-ci-cadence.md). Entry: all phase-3 local gates accepted; owner separately authorizes exact integration publications, consumer deployment, default-branch releases and required settings changes. This phase description is not that authorization.

## Preparation before authority gate

Prepare a concrete ledger with per-repository candidate/base SHA, workflow blob hashes, expected native contexts, old/new full rule payloads, app IDs/strictness, variable values and complete no-Preview trigger/deployment preflight. Inspect legacy protection and effective rulesets; a legacy 404 alone is not unprotected. Preserve unrelated rules. Show default-main installation operations and B's context replacement as separate production-authority actions. Do not weaken rules or use direct main pushes to avoid the release procedure.

Deploy phase-2 F consumer compatibility through its authorized release path and verify actual output supports selected policy/provenance. Its own heavy CI cadence remains legacy until phase 6. F publishing/deployment may execute existing CI; record those activation/release minutes. No producer enters lean before deployed consumer and all native definitions are verified.

## Agent-executed activation order

Before the first candidate push, explicitly authorized activation pauses each existing write-capable repair workflow that lacks a deployed default-off guard. Use the workflow API/CLI disable operation, record original state and read back disabled status; setting an unused variable cannot disable the old implementation. Keep it paused until the guarded definition exists on the actual default branch. Any later re-enable is within the explicitly approved operation list and the guard remains off. Test that an initial validation failure cannot launch repair publication during this transition.

1. Revalidate refs, locally integrate completed changes using each project's topology, inspect all triggers, then perform the single authorized integration push under legacy mode. Verify every expected workflow for its exact SHA. No experiment branches/PRs and no automatic failure rerun/re-push.
2. For B, prepare the separately authorized develop-to-main release PR and obtain actual successful Release artifact smoke for its exact candidate. With explicit settings authority, replace only main's old Preview context with the proven new context BEFORE merging this installation PR; otherwise the unavailable Preview gate deadlocks publication. Preserve all other main gates. Then complete authorized default-main release publication and verify nightly/repair definitions. Other required default-branch publications also use their documented release paths. No manual/schedule success impersonates a required PR test.
3. Confirm `CI Fast` exists and succeeded for the exact supported native candidate. Add it to development requirements, read back effective protection, remove only obsolete development full contexts, then set `CI_CADENCE_MODE=lean`. Preserve A/C production full requirements and B's remaining full gates. Verify repair stays default-off before natural validation events.
4. Observe the next already-authorized natural integration event/nightly/release. Assert complete context inventory, lane reason, child outcomes, pinned SHA, receipt and coverage provenance. No synthetic push, dispatch, failed-test commit or live paid probe for demonstration without separate authorization.
5. Observe 72 hours including at least one natural full nightly per active repository and all weekly-definition guards. Check zero unexpected ordinary full jobs, no Preview/repair publication and correct F health. A quiet repo without a due run remains pending native validation, not accepted based on local fixtures.

## Automated and manual acceptance

Read-only GitHub collection verifies exact pushed SHA and every expected workflow, app-bound required context, mode and immutable source/definition receipt. Deployed consumer readback verifies actual measured date/SHA plus pending/deadline, not stale relabeling. Run the cost tool on all attempts during observation; capture queued/unknown/timing gaps and activation minutes separately. Preserve real release gates and post-deployment behavior under native evidence.

Owner reviews candidate-bound first-wave evidence, production smoke replacement/platform gap and 72-hour outcome. Agent executes authorized operations. Record any absent natural release evidence as an activation acceptance gap; do not fabricate a release or claim full rollout validated. Later eligible release evidence can close it under separate release authority.

## Stuck states and rollback

Native failure: keep failed result and logs, reproduce/fix locally, complete all invalidated gates, request new specific remote authority. No automatic fix-and-push/retry loop. If a setting migration blocks development, restore legacy mode first, then restore saved development rules after old contexts are available. Rollback itself is an external operation with explicit authority; preauthorize its exact payload with activation when possible.

Missing context/default definition, unavailable runner, budget stop, failed smoke or incompatible deployed consumer leaves repo on legacy and ledger names the blocker and recovery. Local fixtures prove staged rollback and blocked→available context recovery; read-only native readback proves actual state. Never restore unavailable self-hosted placement or start a VM as automatic recovery.

Handoff includes authorized operation list, resulting remote heads/blobs/rules, run IDs/attempts, deployed identity, cost window, failures and excluded evidence. Phase 5 requires accepted first-wave evidence; no later publication authority is implied.
