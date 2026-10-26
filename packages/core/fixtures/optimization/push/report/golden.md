# Skip validated pushes: ready-to-publish

Repository: public-example/benchmark
Workflow: .github/workflows/ci.yml; integration branch: main.
Diagnosis: proposal; operation: skip-validated-push; guarded jobs: build, lint, test.
Evidence IDs: push-history, workflow-eligibility.

The rule: a push to main skips the guarded jobs only when it lands one merged pull request whose own run of this workflow already passed on the exact same tree. Every other push runs every job.
Why it is safe: the added cirujano_validated_push job proves the push was not forced, the pushed tree equals the tree of the PR head that passed, and the branch tip before the merge is an ancestor of that head. Any missing proof, error or timeout leaves validated false, so the jobs run.
Each guarded job keeps its original needs and condition; only the final operand reads the classifier output.
Classifier SHA-256: 1480df87d674a1ce1f1cd41a80b30c82d7e733805b72cb7288814e7836bae3d9
Patch SHA-256: db77a06e63e65b59a2e220cdc2b6390e661293467471acde97e4d5980122eba8

Model requested: nvidia/nemotron-3-super-120b-a12b; returned: nvidia/nemotron-3-super-120b-a12b; status: completed; finish: stop.
Tokens (prompt / completion / total): 10 / 20 / 30.
Inference cost: unavailable.
Sandbox: sandbox-verified; network disabled; cleanup: disposable-confirmed.
Sandbox guard matrix: 509 cells, 0 mismatches; classifier cases: 60.
Sandbox usage: unavailable.
Sandbox elapsed time is separate verification overhead; it is not a GitHub saving.

| Role | Push run / attempt | PR run | Validated | Guarded jobs | Billed min | Classifier min |
| --- | --- | --- | --- | --- | ---: | ---: |
| baseline | [1000 / 1](https://github.com/public-example/benchmark/actions/runs/1000/attempts/1) | [2000](https://github.com/public-example/benchmark/actions/runs/2000) | false | success | 11 | 0 |
| baseline | [1001 / 1](https://github.com/public-example/benchmark/actions/runs/1001/attempts/1) | [2001](https://github.com/public-example/benchmark/actions/runs/2001) | false | success | 12 | 0 |
| baseline | [1002 / 1](https://github.com/public-example/benchmark/actions/runs/1002/attempts/1) | [2002](https://github.com/public-example/benchmark/actions/runs/2002) | false | success | 13 | 0 |
| candidate | [1100 / 1](https://github.com/public-example/benchmark/actions/runs/1100/attempts/1) | [2100](https://github.com/public-example/benchmark/actions/runs/2100) | true | skipped | 1 | 1 |
| candidate | [1101 / 1](https://github.com/public-example/benchmark/actions/runs/1101/attempts/1) | [2101](https://github.com/public-example/benchmark/actions/runs/2101) | true | skipped | 1 | 1 |
| candidate | [1102 / 1](https://github.com/public-example/benchmark/actions/runs/1102/attempts/1) | [2102](https://github.com/public-example/benchmark/actions/runs/2102) | true | skipped | 1 | 1 |
| control | [1200 / 1](https://github.com/public-example/benchmark/actions/runs/1200/attempts/1) | none | false | success | 13 | 1 |

Baseline median billed minutes per push: 12; candidate pushes: 1, 1, 1.
Classifier overhead: 1 billed minute(s) on every push to main, measured on the direct control push, which ran every guarded job.
PR coverage: every sampled PR run passed the same 3 jobs.
Modeled, not measured: across the last 10 collected pushes, 8 would have validated, projecting 88 minute(s) saved and 2 minute(s) of classifier overhead on the rest.
GitHub list estimate: 0 USD; public repository list saving is zero.
Measured claims apply only to these seven sampled pushes. List estimates are not invoice savings. Provider and inference costs are not netted; no fleet, annual or net saving is established.
Comparison limitations: sample-execution-only, per-push-gate, classifier-overhead-disclosed, modeled-history-projection, list-price-estimate-not-invoice, provider-inference-costs-not-netted, public-github-list-saving-zero.

Manual rollback of the reviewed guard-only patch:
```sh
git apply --reverse workflow.patch
```
After rollback every push runs every job again. No rollback or merge is automatic.

<!-- cirujano-optimization:cff33c3674060350d79cf23b83cd46558bff8de79af86f3387f47e6df61f5e94:7ed117aa77b8f073b67808963d71b756297b2d9f4a125bcf8befe4b272c0dfac -->