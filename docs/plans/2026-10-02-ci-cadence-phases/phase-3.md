# Phase 3: first three repositories, local workflow preparation

Parent: [CI cadence plan](../2026-10-02-ci-cadence.md). Entry: phases 1/2 accepted, explicit local implementation authority. A/B/C are separate `[batch-eligible]` worktrees, one owner each, one integration owner. No push, PR, rule/variable edit, provider execution or deployment.

## Owned changes

Implement frozen policy/helper fixtures and CI Fast/nightly/full routing in each repository. CI Fast avoids application dependencies and completes in at most five hosted minutes including setup, with a six-minute protective timeout. Full lanes keep all applicable existing checks and artifacts. Run fixture tests against actual classifier and job dependency graph. Do not change legacy behavior until variable activation; new nightly is disabled under legacy to avoid duplicate scheduled suites.

| Alias | Existing files owned by this phase |
| --- | --- |
| A | ci.yml, secret-scan.yml, sutura.yml; CLAUDE/AGENTS and release-gate documentation. Integrated checks/coverage/Firebase/browser/exhaustive suite retain production invariants. |
| B | ci.yml, e2e.yml, coverage.yml, lighthouse.yml, bundle-size.yml, knip.yml, license-check.yml, security.yml, e2e-stripe-integration.yml, preview-smoke.yml, validate-merged-pr.yml, sutura.yml; release checklist/CLAUDE/AGENTS. |
| C | ci.yml, coverage.yml, bundle-size.yml, knip.yml, lighthouse.yml, gitleaks.yml, security.yml, codeql.yml, validate-merged-pr.yml, sutura.yml; release playbook/checklist/CLAUDE/AGENTS. |

Add new helper/policy/fixtures and fast/nightly files. Existing sources are cited in the parent matrix and ignored annex. Where reusable full-suite implementation is extracted, preserve original job/context names at event entrypoints and manifest every applicable child. Avoid loading contributor helper code in privileged classifier jobs. Workflow predicates and checked-out helper must agree even when PR modifies policy.

Load classifier helper/policy from immutable protected base/default separately from candidate checkout. Mandatory production/untrusted predicates are independent of candidate outputs. Missing trusted helper during first installation forces existing full behavior. Tests alter candidate helper, allowlist, production branch and contexts and prove no fast/privileged escape. Trusted review is required for contributor workflow-definition changes; candidate-controlled YAML is not claimed to enforce an adversarial boundary.

Release/full aggregators require actual successful applicable children and valid evidence. No pass for intentionally omitted coverage. Full PR reuse checks remain allowlisted full contexts and exact source/base identity; CI Fast cannot satisfy them. Docs/path shortcuts do not remove mandatory release test graph. Route duplicate audits/builds/browser/Lighthouse to release/nightly; introduced-commit secret scan remains fast, periodic full-history scan retained. Live Stripe/provider suites retain existing authorized schedule/release scope and never execute for untrusted code.

## Candidate smoke and deployment boundary

B replaces Preview-smoke implementation with planned `Release artifact smoke` under release PR event. Build immutable PR candidate, start production server on loopback with isolated local Supabase/test providers and assert manifest commit/build identity, health readiness, homepage/hydration and required local release behavior. Keep authenticated/local release probe fixtures concrete; real provider acceptance is a separate disclosed requirement. C release smoke similarly uses local candidate environment and fails if candidate identity is unavailable. Main-push deployed smoke remains separately candidate-bound.

```
@ smokeCandidate(candidate, artifact, manifest) -> gate result
ctx: loopback production server and task-owned synthetic services
pre: candidate/base identity and build manifest validated
do:
  1. validate server-reported identity against artifact manifest
  2. lookup health readiness and expected rendered route behavior
  3. compute required local release-probe outcomes
fail: missing identity, readiness or required behavior -> failed context
fx: emit eligible PR check and immutable local smoke evidence
```

B default-main workflow publication must follow its release procedure later; develop installation cannot activate main schedule/workflow_run. B/C automatic repair defaults off, without enabling scheduled paid model/provider calls. Keep all unrelated production probes/ledgers and manual baselines unchanged. Preserve A's hosted fallback and Firebase main-push prerequisite graph, C production migration admission and B post-deploy/provider proof.

## Automated acceptance

Each repo executes all phase-1 event oracles plus its repository-specific release/full graph fixtures. Release child skip/cancel/failure must fail aggregates. Nightly resolves integration once; artifact SHA, report SHA and branch match that checkout. B main coverage remains main; develop nightly never overwrites it. Untrusted jobs get no secrets/self-hosted labels. CI Fast has no build, deployment or full-suite step. Legacy predicates still produce every existing required context.

Run exact full local command matrices and environment preparations in the ignored annex, sequentially. A needs configured emulator/browser/ffmpeg fixtures and exhaustive local release suite. B local authenticated fixtures use isolated test services, not QA production secrets. C requires task-owned Supabase/Redis and synthetic fixture prepare/restore; preserve current release playbook's complete local scenario inventory and zero-skip proof. Native CodeQL/platform-only proof is deferred to authorized native observation, explicitly recorded as unavailable locally. Mandatory local gates cannot be replaced by a green wrapper.

## Manual acceptance and recovery

Review workflow event diff, all old/new required context maps, smoke evidence, no-Preview trigger preflight and rollback payloads before publication. Record B's reduced prepublication platform evidence explicitly. Missing identity/synthetic fixtures block smoke with repair steps; corrected fixtures recover. Missing default-branch definitions block activation visibly; exact published definition readback later clears it. Record base/current candidates, complete verification and review/simplify findings. Stop after all three local units are accepted.
