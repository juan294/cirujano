# GitHub polling guard

## Objective and authority

Repair repeated charged GitHub reads locally, preserving controller identity, freshness and lifecycle safety. The owner authorized local repair and an activation plan. Running controllers, permits, fleet configuration, cloud resources and other consumers are outside implementation authority. No authenticated diagnostic traffic, push or deployment is part of this phase.

Base: develop at 91b7908cb8ff1a23e115f346799a1208f4da342d. Implementation: fix/github-polling-guard in /Users/juan/code/cirujano-worktrees/github-polling-guard. Independent design review recommends adapter-local conditional revalidation and quota holds, retaining normal controller ticks.

## Evidence and alternatives

The adapter dispatches five active-status scans and has no response cache or enforced backoff (packages/runner/src/adapters/github.ts:458). The watch loop ticks at the configured interval (packages/cli/src/runner-service.ts:238). Observation concurrently reads repository, runs and runners (packages/cli/src/runner-service.ts:433). Config hash participates in permit, saved-state and VM identity. Changing the polling interval requires identity migration; sleeping the whole controller postpones accounting. A filesystem account-wide governor adds cross-process identity and lock semantics beyond this repair.

GitHub documents that authenticated conditional requests returning 304 do not debit primary quota, and requires waiting for Retry-After or quota reset: [REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api), [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api). Savings depend on actual responses and remain unmeasured until activation.

## Phase 1: local repair

See [phase specification](2026-09-30-github-polling-guard-phases/phase-1.md). Implement, independently review, repair, simplify and run all local gates. Integrate locally after acceptance. Prepare an activation procedure requiring separate authorization and exact executable/permit identities.

## Risks and bounds

This is an adapter-local reserve, not a hard shared-account budget. Existing concurrent requests can finish after the hold starts; other clients can spend quota. Process restart discards cache and hold. A reserve of 2000 Core requests protects headroom after an observed response, with a conservative one-minute fallback if reset information is missing. No reserve applies to unrelated quota resources. Cache is limited to 128 entries and 8 MiB total serialized representation bytes; oversized entries are not retained. New process instances bootstrap unconditionally.

## Acceptance

- [x] Conditional reads and quota hold contract tested.
- [x] CLI exposes incomplete observation and retry timing without delaying provider accounting.
- [x] Independent review approved and simplify completed.
- [x] Sequential typecheck, lint, bundle verification and all tests pass.
- [x] Activation plan documents identity, rollback, quota evidence and remaining live gates.
