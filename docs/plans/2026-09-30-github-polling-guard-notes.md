# Polling guard implementation notes

## Scope and state

Base develop: 91b7908cb8ff1a23e115f346799a1208f4da342d. Worktree: /Users/juan/code/cirujano-worktrees/github-polling-guard; branch fix/github-polling-guard. Local repair and activation proposal only. Live services unchanged.

## Design review

Independent reviewer recommended bounded ETag revalidation, adapter-local reserve and normal lifecycle ticks. Parent queried Cirujano Graphify and confirmed adapter, watch, observation and identity consumers in source. Existing interval/config/permit schemas remain unchanged.

## TDD

CLI regression first encountered missing workspace build outputs; that setup failure is preserved in docs/agents/github-polling-guard/cli-red.log and does not count as behavioral red. After building dependencies, both new CLI cases failed because githubReadHold was missing (cli-red-ready.log). Adapter evidence is retained separately.

## Deviations

Plan said one-minute fallback for unusable rate headers. GitHub's current guidance requires increasing waits for repeated secondary limits. Chose exponential fallback capped at 15 minutes and reset after valid success. No automatic transport retry loop is added.

## Local acceptance

Independent implementation review approved after the repairs below. All full sequential gates passed. The activation proposal intentionally does not provide an unverified identity migration command.

## Independent review findings

- R1: quota headers were observed only after JSON parsing, so malformed 403/429 bodies could evade the hold. Split header parsing from body parsing and honor quota headers before rejecting malformed evidence. Add malformed 200 Core-reserve coverage too. Resolved with regressions and independently approved.
- R2: a nonempty JSON body on 304 was ignored and cached evidence accepted. Reject nonempty 304 bodies and test with an existing cache. Resolved with regressions and independently approved.
- R3: clarify rollback snapshot restoration is allowed only before durable writes as well as effects. Wording repaired in activation.md; accounting-only ticks require preserving latest state.

CLI focused green: two cases passed. Both assert incomplete queue, visible retry, no provider mutation, retained known-busy evidence and advancing disk accounting. The subsequent review repairs and full gates passed.

- R4: late reserve acquisition lacked a regression. Added an otherwise eligible absent-VM case whose final jobs response reaches the reserve. With the observation override removed, the test sees complete=true and eligibleQueuedJobs=1; with it restored, all three CLI cases pass. The mutation receipt is cli-late-reserve-mutation-final.log. The first exploratory mutation hit a fixture effect error and is retained separately, not used as the final oracle.

## Review and simplify

Independent reviewer approved all four source/test files and the activation proposal after R1-R4 closure, subject to full gates. Adapter TDD receipts: initial red 8 failures/25 passes; first green caught a pagination retry regression; fixed green 33 passes, expanded green 40 passes. Review regressions then produced 4 failures/40 passes and final 44 passes. All failures remain recorded under ignored docs/agents/github-polling-guard.

The Codex simplify pass reviewed the same four files through separate reuse, quality and efficiency lenses. Reuse: shared header parsing serves both transport and public response parsing; no duplicate cache path. Quality: cache and hold remain confined to the adapter, with one CLI queue override and existing lifecycle guards. Efficiency: fixed cache limits and conditional revalidation avoid unbounded retained bodies; no new timers or extra network probes. No further edits justified. No gate was invalidated by simplification. Existing independent review also found no additional simplification required.

## Remaining live boundaries

The reserve is 2000 observed Core units, with in-flight and unrelated-client overshoot possible. While held, new acquisition waits for eligible reads; provider/guest/accounting checks continue. No deployment, permit/state rewrite, launchd operation, cloud mutation or diagnostic API request was performed. Live savings and production rollout remain unmeasured. The next stage is a reviewed offline identity transition followed by separately authorized canary activation, not an automatic fleet replacement.

## Final verification and handoff

Local phase accepted on 2026-09-30. Sequential gates all exit 0: typecheck, lint, verify:bundle, and test. Full test totals: core 9, runner 371, action 6, CLI 214; 600 tests across 31 files. No tracked generated bundle changed. The tested CLI bundle SHA-256 is `72789ce149f92c311f0d20b6055a75728f14efd0f5bdf1bb3d81a11a5d5604c5`.

Exact tested source and lock hashes are in `docs/agents/github-polling-guard/tested-inputs.json`; gate exits and timing are in `gate-results.json`. These ignored receipts and a copy of the tested bundle are preserved in the main checkout before worktree removal. Local integration uses a fast-forward from the recorded base, preserving identical tested source. No remote action is authorized by this handoff. The associated gh-glance qualification remains incomplete until shared-quota headroom and the separate work-computer gates are demonstrated.

## Later canary continuation

The owner's next continuation authorized preparation and the first canary. See [canary validation](2026-09-30-github-polling-guard-phases/canary-validation.md). One controller is now active on the exact tested bundle; eight remain unchanged. Identity and quota-hold behavior were observed, but live 304 behavior, post-reset recovery and steady cadence remain unaccepted. Private operational helpers, backups and evidence are preserved outside the temporary directory under docs/agents/github-polling-canary-2026-09-30. No application source changed in this continuation; the existing source gates remain valid for their recorded runtime.
