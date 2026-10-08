# Phase 2: family contracts, eligibility, guard evaluator

## Contracts (`packages/core/src/optimization/contracts.ts` + new `push-contracts.ts`)

- `OptimizationFamily = 'pnpm-cache' | 'skip-validated-push'`. Artifacts **without** `family` decode
  through today's validators, unchanged. Artifacts with `family:'skip-validated-push'` use new
  validators.
- `PushProvenance`: `repositoryId, repository, baseSha, workflowBlobSha, workflowPath,
  workflowHash, integrationBranch, guardedJobIds (sorted, unique), classifierDigest,
  verificationProfileHash, toolSourceSha, bundleDigest`. There is no `stepIndex` or `lockfileHash`.
- `PushOperation { type:'skip-validated-push'; integrationBranch; guardedJobIds; classifierJobId:'cirujano_validated_push' }`.
- `PushHistoryEntry { pushRunId, attempt, headSha, billedMinutes, jobsBilled, prNumber|null, validated, reasonCode }`
  (≤ 30 entries).
- Family variants of `input`, `diagnosis`, `proposal`, `sandbox`, `measurement` and `report`;
  `inference` and `publication` are shared unchanged.

Golden oracle (write first): `cache-artifacts-decode-unchanged` decodes every existing
optimization fixture and test-helper artifact. It asserts the output is byte-identical to the
pre-change canonical JSON. Capture the snapshot before editing.

## Eligibility (`packages/core/src/optimization/push-workflow.ts`)

```
@ inspectPushWorkflow(source, evidence) -> {status, reason, operations, protectedDigest, structuralFacts}
ctx: parseWorkflowSource (workflow.ts:22), repo workflow inventory (workflow_run consumers)
pre: sha256(source) == provenance.workflowHash
do:
  1. parse strictly; read on.push.branches / on.pull_request.branches
  2. validate one shared literal branch; reject globs/ignores/pull_request_target
  3. validate every job against the v1 rules (plan § Eligible)
  4. compute guardedJobIds + structural facts
br: any rule fails -> unsupported(reason); classifier id present -> no-change
```

Reason-code fixtures, one per rule: `push-ineligible-reason-codes`.

## Guard expression (`packages/core/src/optimization/guard-expression.ts`)

A small, safe GitHub Actions expression parser and evaluator, with no `eval` or `vm`. It covers
literals, property access, `! == != && || ( )`, and the functions `success() failure() cancelled() always()`.
`&&` and `||` return operands. Comparisons follow the documented loose, case-insensitive rules.
The parser **detects** status functions in original `if`s (used by eligibility) and evaluates
the generated wrapper with the original condition as an opaque boolean.

Tests: documented examples from the GitHub expressions reference (cite the URL and retrieval date
in the test file), `guard-classifier-failure-runs-full`, and
`wrapper-equivalent-when-not-validated`, which enumerates classifier result
{skipped, success+true, success+false, failure, cancelled} × original need results
{success, failure, skipped, cancelled}ⁿ (n ≤ 2) × original condition {true, false}.

## Corpus

Add eligibility fixtures under `packages/core/src/optimization/fixtures/push/`: eligible
multi-job, matrix job, each ineligible rule, already-patched (`no-change`).

## Acceptance

Automated: full gates; the golden oracle passes unchanged; all fixture reason codes match.
Batch: `[batch-eligible]` evaluator unit (`guard-expression.ts` + tests) vs. contracts/eligibility
unit; one integration owner merges both.
