# Skip-validated-push live proof (2026-10-09)

**Result: measured improvement.** On the public proof repository, pushes that land a pull
request whose own CI run already passed on the same tree billed **1 minute instead of 3**.
A direct push still ran every job. The evidence pull request is open and unmerged:
[juan294/cirujano-push-proof#8](https://github.com/juan294/cirujano-push-proof/pull/8).

Every number below was measured on the runs it names. The claim covers these seven sampled
pushes only; no fleet, annual or invoice saving is established. The repository is public,
so the GitHub list-price saving is zero.

## Setup

- **Tool:** Cirujano `49c934d` (the Phase 6 tip of `develop`), on Node 22.20.0.
- **Proof repository:** [`juan294/cirujano-push-proof`](https://github.com/juan294/cirujano-push-proof),
  a public, non-production benchmark.
  - It installs about 1,850 pinned packages in each job.
  - The `Push proof` workflow has three jobs, `lint`, `test` and `build`. Each runs about 20 s,
    which bills as 1 minute.
  - The workflow runs on pull requests into `develop` and on pushes to `develop`, with
    read-only permissions.
  - Force pushes and deletion of `develop` are blocked.
  - The publication branches are locked: `cirujano/base` at the collected base `d5dc444`, and
    `cirujano/skip-validated-push` at the candidate `b359f3b`.
- **Model:** `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` through Nebius Token Factory.
- **Sandbox:** Nebius Token Factory Sandboxes, running a push-guard image built from the
  committed harness bundle.

## Chain

1. **Collect.** The push history read 4 pushes. The classifier, running against real GitHub,
   validated the three merged-PR pushes and refused the seed push as `no-merged-pr`.
2. **Diagnose.** One held-out Nemotron call returned a `proposal` (1,115 tokens, finish
   `stop`). It cited the 75% validated share and a 3-minute median push against a 1-minute
   classifier.
3. **Propose.** Cirujano produced the deterministic guard-only patch. It adds the
   `cirujano_validated_push` job and adds one guard operand to each of the three jobs.
4. **Sandbox verify.** One disposable operation with networking disabled returned
   `sandbox-verified`, confirmed by provider readback. It checked 69 guard-matrix cells and
   60 classifier cases, with 0 mismatches, in 6.7 s.
5. **Integrate.** PR #4 landed the candidate on `develop`.
   - Its PR run skipped the classifier and still ran all three jobs.
   - Its merge push validated and skipped them.
6. **Measure.** The per-push gate returned `measured-improvement`.
7. **Report and publish.** The bound report was opened as PR #8 between the locked branches,
   and `optimize status` read it back as open and unmerged.

## Measured runs

| Role | Push run | PR | Billed minutes | Classifier | Guarded jobs |
| --- | --- | --- | ---: | --- | --- |
| baseline | [37918926836](https://github.com/juan294/cirujano-push-proof/actions/runs/37918926836) | #1 | 3 | none | ran, green |
| baseline | [37919073767](https://github.com/juan294/cirujano-push-proof/actions/runs/37919073767) | #2 | 3 | none | ran, green |
| baseline | [37919235519](https://github.com/juan294/cirujano-push-proof/actions/runs/37919235519) | #3 | 3 | none | ran, green |
| candidate | [37920072110](https://github.com/juan294/cirujano-push-proof/actions/runs/37920072110) | #5 | 1 | validated | skipped |
| candidate | [37920192411](https://github.com/juan294/cirujano-push-proof/actions/runs/37920192411) | #6 | 1 | validated | skipped |
| candidate | [37920318553](https://github.com/juan294/cirujano-push-proof/actions/runs/37920318553) | #7 | 1 | validated | skipped |
| control | [37920425565](https://github.com/juan294/cirujano-push-proof/actions/runs/37920425565) | none | 4 | `no-merged-pr` | ran, green |

- Every sampled PR run passed the same three jobs.
- The classifier costs 1 billed minute on every push. The control shows that a push it cannot
  validate pays that minute on top of the full suite.
- The modeled projection over the 4 collected pushes is 6 minutes saved and 1 minute of
  overhead. It is labeled modeled, not measured.

## Live model evaluation

The six push evaluation cases ran once each against the live model, each under a single-use
permit, and all six passed:

- **Proposal expected:** three high- or medium-share workflows. All three proposed.
- **Abstention expected:** one low-share history and one one-minute workflow. Both abstained.
- **Injection:** evidence that tried to dictate a wider operation. The model proposed only
  the collected operation, and no unsafe operation was accepted.

## Facts this run established

These were modeled or inferred before this run:

- **Skipped jobs are listed.** The jobs API lists a job skipped by its `if` with conclusion
  `skipped`, and its `completed_at` can fall a second before its `started_at`. The gate bills
  skipped jobs as zero, and a regression test now pins that timing.
- **The guard runs jobs on pull requests.** With the classifier skipped on a pull request,
  the `!cancelled()` guard still runs every guarded job.
- **The classifier is fast.** It finished in 3-9 s per push.

## Limits

- **Small sample:** three samples per role on one small benchmark. Larger workflows save
  more minutes per push; one-minute workflows save nothing, and the model abstains on them.
- **Fixed overhead:** the classifier adds 1 billed minute to every push it cannot validate.
- **Not netted:** provider inference and Sandbox costs are not netted against the saving.
  They were 0.0001 USD for the diagnosis, and the Sandbox usage was reported in an
  undocumented provider unit.
