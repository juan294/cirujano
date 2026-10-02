# Phase 5: remaining eligible private repositories, local adapters

Parent: [CI cadence plan](../2026-10-02-ci-cadence.md). Entry: phase 4 accepted and explicit local phase-5 authority. D/E/F/G/H are repository-isolated `[batch-eligible]` worktrees, at most three implementers, one integration owner. No publication. I/J excluded as stated in parent.

## Repository adapters

| Alias | Owned changes and preserved contract |
| --- | --- |
| D | ci.yml, coverage.yml, codeql.yml, sutura.yml; policy/helper/fast/nightly and docs. Keep production check, contract/owner journey, main release-evidence/migration ledger and existing nightly production probe. Remove duplicate coverage computation/publication only in lean. |
| E | ci.yml, coverage.yml, sutura.yml; classifier, release controller/operations, local receipt/check workflow fixtures and release docs. Preserve immutable fast-forward topology, full integration check and release-smoke.yml. Fast check never supplies full `check`. |
| F | ci.yml, sutura.yml and policy/fast/nightly; reuse phase-2 consumer contract. Full test artifacts feed one authoritative coverage publication. Preserve main full check and production health evaluator. roots-coverage.yml and config/production monitoring remain outside cadence changes. |
| G | ci.yml, coverage.yml, scheduled-coverage-agent.yml, sutura.yml plus policy/fast/nightly and workflow/coverage tests. Production branch master retains nine contexts and native matrix. Consolidate duplicate suite/report computation without adding report-writing commits. Do not activate dormant model agents or change launchd jobs. |
| H | test.yml, coverage.yml, sutura.yml plus policy/fast/nightly and script tests/docs. Full production checks and maintenance.yml retain safe behavior. No resetting shared production DB or live resource verification as a local test. |

Revalidate complete workflow inventory and effective integration/production rules, including G master. Original main-only inspection for G was insufficient; the planning annex now captures master rules and nine required contexts. No generic main predicate in G. Update project instructions so future agents retain local full validation and one authorized integration push.

## E release admission

E's existing release controller relies on an exact full check produced by integration push. Add owner-controlled `CI_RELEASE_CANDIDATE_SHA` strict full-SHA variable. When it exactly equals native integration push SHA, run all applicable existing full jobs independent of lean mode. Missing/mismatched marker routes ordinary fast and explicitly cannot qualify a release. Candidate/base movement invalidates full evidence and local receipt.

The release operation prepares local complete gates and receipt, requests publication/variable authority, sets marker to immutable candidate, publishes once, inspects exact full native graph and clears marker as part of that authorized scope. No workflow_dispatch or fast-only success is substituted. Do not turn scheduled success into integration-push `check`. Existing post-production smoke/provider authority remains separate.

Preflight remote integration SHA before freezing candidate. If already published without full eligible evidence, a no-op push cannot produce a new full check: block with an explicit instruction to prepare and locally qualify a new release-metadata candidate before one separately authorized marked publication. An admission-contract change is separate scope. Test no-op push, candidate movement, interrupted operation and idempotent marker cleanup. Never implicitly rerun old CI or claim setting a variable creates a push event.

```
@ qualifyIntegrationPush(sha, marker, policy) -> full or fast
ctx: native push payload and owner-controlled repository variable
pre: release topology and strict SHA format validated
do:
  1. validate event repository, integration ref and candidate marker
  2. compute candidate equality independent of lean preference
  3. emit full check only from actual complete native suite
br: exact marked candidate -> full; ordinary lean owner push -> CI Fast only
fail: release controller lacks full exact check -> block with publication instruction
```

## Automated acceptance

All common event/history/graph tests plus D release collector, E marker/controller/fast-forward identity and G master contexts. Full-suite thresholds, environments and security do not weaken. G canonical coverage floors remain statements/branches/modules from the same JSON; dormant green skips are not execution evidence. H tested default provenance is true, not inferred from main integration confusion. Default-off repair guards are in actual default definitions when eventually published.

Sequential full local gates from annex/current project docs: D knowledge/payload matrix plus types/lint/test/coverage/build/DB/browser; E current full contract, launch-risk coverage, workflows/controller and synthetic local release suites; F all phase-2 gates plus native workflow contracts; G ruff/type/import/security, multi-Python tests, canonical coverage and wheel/Docker smoke; H npm quality plus coverage/E2E/synthetic DB prerequisites. Contract tests must execute on isolated local stacks, not silently skip. Document native platform gates unavailable locally; those remain phase-6 obligations.

## Manual acceptance, recovery and handoff

Review five old/new context maps, no-Preview preflight, per-repo rollback payloads and F producer auditor success. Rejected marker fails release with exact instruction; matching native full receipt clears it in fixtures. G wrong-main policy blocks with master correction; corrected policy passes. No source report is refreshed on unchanged skip. Missing local fixture/prerequisite is blocked with provision step, never routed to production. Record candidate/tree identities, review/repair/simplify, check exits and complete authority-free local integration state before phase 6.
