# Nemotron workflow optimization

Cirujano implements two bounded optimizations. The first, described in the sections below, enables pnpm store caching on an existing immutable `actions/setup-node` step. The second, [skip validated pushes](#skip-validated-pushes), is described at the end. The cache family collects GitHub evidence, obtains a structured NVIDIA model decision through Nebius Token Factory, constructs the two-field patch, verifies quality in paired Sandboxes, measures a predefined GitHub cohort, and prepares an authorized unmerged PR. Local implementation and replay checks do not establish a live improvement or close H1.

## Live outcome

On 2026-10-02 the complete live chain ran on the proof repository: an NVIDIA Nemotron decision proposed the cache, Sandbox verification passed with identical tests and coverage, and the six-run GitHub measurement returned **no-improvement** (3 rounded minutes against 3). No savings PR was opened, and H1 stays open on the measurement criterion. The run and the fixes it required are recorded in [the plan notes](../plans/2026-09-29-nemotron-workflow-optimization-notes.md#outcome-later-on-2026-10-02-complete-live-chain-truthful-no-improvement).

## Try the local evaluation

Requires Node 22 and the installed workspace dependencies:

```sh
pnpm run build
node scripts/optimization/evaluate.mjs --offline
```

The evaluator calls the actual product modules. Its 21 cases have separate denominators: six deterministic prefilters with zero inference calls; eight adversarial cases with zero accepted unsafe operations; and seven model cases replayed with synthetic external responses. Model accuracy is not assessed by offline replay. The seven eligible live cases contain six opportunities and one negligible-install abstention. Actual live acceptance requires at least five correct opportunities, the abstention, and valid evidence references for every proposal. Non-improving elapsed time, insufficient rounded-minute savings, missing cold samples, failed attempts and changed quality cannot pass the measurement probes.

## Reproduce the public workload

[The benchmark](../../scripts/optimization/benchmark/README.md) installs pinned pnpm/Vitest dependencies and runs real tests and coverage. It is a labeled benchmark, with no artificial delay. Current Cirujano CI already enables pnpm caching and is a no-change case. The benchmark may return no improvement; do not change the target, model or optimization family to force a saving.

The owner-controlled proof repository must be approved before bootstrap or publication. Read back its actual repository ID and documented `main`/`develop` refs, then inventory every workflow, deployment integration and trigger before any workflow attempt. The prepared template has only `develop` push and manual triggers, one read-only job and no deployment. Keep implementation branches local.

## Credentials and permits

Use `NEBIUS_API_KEY` for the exact NVIDIA model `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` at `https://api.tokenfactory.nebius.com/v1/chat/completions`. Model identifiers are case-sensitive; this spelling was confirmed in the authenticated catalog on October 1. Inference performs an account-level model availability GET before its single permitted completion POST. No automatic retry or model substitution occurs. Limits per inference are 64 KiB serialized request, 2,048 completion tokens, 256 KiB response and a 60-second deadline.

Sandbox requests use separate `NEBIUS_IAM_TOKEN` credentials and the approved execution profile's `Project` header. Read back the correct Token Factory project and entitlement; an AI Cloud project login does not prove Sandbox access. The exact image UUID, OCI digest, import operation, recipe, dependency store and trusted harness are bound to the execution permit. Paired verification disables networking, uses one concurrent disposable instance, preserves the retained image, and compares actual commands, passed/skipped test IDs and per-file coverage denominators and counters. Local Docker checks do not prove provider network isolation.

Every paid or outward action requires the concrete local artifact and its applicable owner authority. Image preparation/import/retention, model calls, Sandbox executions, proof-repository bootstrap/baseline publication, candidate integration push/workflow attempts and final PR creation have separate scope. The implementation request alone does not authorize that batch. Keep raw receipts and account identifiers private; do not copy credentials into files in this public repository.

## Live evaluation after approval

The offline output includes each eligible case's exact input and request preview. Prepare seven ordered one-use inference permits using the product's `InferencePermit` schema and bind each input digest, model, endpoint, expiry and dated price basis. The permit batch has `schemaVersion: 1`, `kind: "model-evaluation-permits"`, the fixed `model`, and seven ordered `{name, permit}` entries. The harness persists intents and results before/after each actual call, consumes the shared permit ledger and stops at a failed transport. Remaining cases stay `not-run`.

```sh
node scripts/optimization/evaluate.mjs --live-models permit-batch.json /absolute/new-private-evaluation-directory
```

The full proposed ceiling is eight inference calls: seven corpus calls plus one held-out actual-source diagnosis through `cirujano optimize diagnose`. Corpus source identities are explicitly synthetic public evaluation data; their live responses measure model selection, and cannot authorize repository publication. The held-out response must determine the exact accepted patch. Run collection, diagnosis, proposal, paired verification, measurement, report and publication through `node packages/cli/dist/bin.js optimize`; `--help` lists each command's required paths. Preserve every attempt and use fresh exact permits for any subsequent batch.

Measure three baseline and three candidate attempts from a predefined cohort, including the first cold candidate. The source tree, lockfile, protected workflow contract, runtime, runner OS/architecture/image, checks, test inventory and coverage must match. Require at least one aggregate rounded job minute saved and at least ten percent lower median whole-job time. Include queue and end-to-end maxima. Public GitHub jobs have zero list-price USD savings. Sandbox usage without documented currency remains an unavailable dollar cost. These results cannot establish fleet net savings.

## Check a completed proof

After the measured report and approved product publication/readback, create a private JSON manifest with exact keys: `schemaVersion: 1`, `kind: "optimization-live-proof"`, `provider: "nebius-token-factory"`, `live: true`, fixed `model`, and absolute `reportPath`, `publicationDirectory`, `modelEvaluationPath`, `sandboxBoundaryPath`. The last file holds three native owned-fixture receipts for network denial, output bounds and cancellation with terminal readback, bound to the paired execution profile, project, image, trusted harness, tool and source hashes. Missing, failed or mismatched boundary receipts are rejected. The evaluator exports the exact owned requests and receipt validator; the agent collects their actual provider results only after bounded Sandbox authority.

```sh
node scripts/optimization/evaluate.mjs --validate-proof live-proof.json
```

The read-only validator rereads retained product evidence and rejects missing or altered model decisions, paired Sandbox quality, six-run measurements and confirmed PR identities. Injected transports remain explicit replay with `live: false` and cannot qualify as a native proof. Exit zero means the retained structure is complete; the result still reports `passed: false`, `live: false`, `h1Closed: false` and the required native gates. Final acceptance requires actual provider readback of the Sandbox boundary operations and current GitHub publication readback. Refresh the actual PR through `optimize status` before a public claim; a local manifest does not establish current remote state. Save a sanitized feature proof in `docs/research/` only after the live chain passes. For the cache family, H1 remains open until then, and no cache saving is claimed. The skip-validated-push family's live result is in [its section](#skip-validated-pushes). Fleet savings, further optimization families and H2-H6 remain future work.

## Skip validated pushes

**The rule.** A push to the integration branch skips the workflow's jobs only when it lands one merged pull request whose own run of the same workflow already passed on the exact same tree. Every other push (a direct push, a forced push, a merge of a red or stale pull request, or any case the classifier cannot decide) runs every job.

**How it stays safe.** The patch adds one job, `cirujano_validated_push`, and one operand to each guarded job's `if`. Nothing else in the workflow changes, and an inverse proof checks that removing the operand restores the original. The classifier job reads GitHub with read-only permissions. Among its checks, it proves the push was not forced, the pushed tree equals the tree of the pull request head whose run passed, the branch tip before the merge is an ancestor of that head, no other pull request claims the head, the pull request is not from a fork, and its run of this workflow passed every job. Any error, timeout or ambiguity sets `validated=false`, so the jobs run. Eligibility refuses workflows the guard could change in meaning: status functions, `continue-on-error`, environments, reusable jobs, secrets, event-context reads, workflow-level run defaults and `needs` reads beyond the declared needs. A Sandbox verifier evaluates the guarded and original workflows over a decision matrix of events, classifier outcomes and need results, and runs the exact embedded classifier script on 60 scripted GitHub API scenarios.

**Measurement.** The cohort is fixed before reading results: three merged-PR pushes on the original workflow, three on the guarded one, and one direct push as the control. Each candidate must be validated with every guarded job skipped and bill at least one minute below the baseline median. The control must run every job, and every pull request run must pass the same job set. The report always discloses the classifier's one-minute overhead, and labels the history projection as modeled.

**Live result.** On 2026-10-09 the chain passed on the public proof repository [`juan294/cirujano-push-proof`](https://github.com/juan294/cirujano-push-proof). Merged-PR pushes billed 1 minute instead of 3, and the direct push ran every job. The evidence pull request #8 is open and unmerged. The runs and limits are in [the live proof](../research/2026-10-09-skip-validated-push-live-proof.md).

**Reproduce.** The CLI takes `--family skip-validated-push` at collection. The rest of the chain uses the same commands as the cache family.

```sh
cirujano optimize collect --family skip-validated-push --repository <owner/repo> --ref <sha> --workflow .github/workflows/ci.yml --branch develop --output <dir>
cirujano optimize diagnose --input <dir>/input.json --config config.json --permit permit.json --output <diagnosis>
cirujano optimize propose --input <dir>/input.json --diagnosis <diagnosis>/diagnosis.json --output <proposal>
cirujano optimize verify --proposal <proposal>/proposal.json --profile push-guard-profile.json --permit sandbox-permit.json --output <verify>
cirujano optimize measure --proposal <proposal>/proposal.json --sandbox <verify>/sandbox.json --cohort cohort.json --output <measure>
cirujano optimize report --proposal <proposal>/proposal.json --sandbox <verify>/sandbox.json --measurement <measure>/measurement.json --output <report> --base-ref <base-branch> --head-ref <head-branch>
```

- **Image:** the push-guard Sandbox image comes from `node scripts/optimization/image-context.mjs --push-guard <recipe.json> <new-context-directory>`, and carries only the base Node image and the committed harness bundle.
- **Publication branches:** publication needs two branches that never move, one at the collected base and one at the candidate commit, because the measured pushes have already moved the integration branch.
- **Live model cases:** `node scripts/optimization/evaluate.mjs --live-push-models <permit-batch.json> <new-private-directory>` runs the six push evaluation cases against the live model, with one single-use permit each.

**Limits.**

- **Fixed overhead:** the classifier adds one billed minute to every push, so a workflow whose push already bills about one minute saves nothing, and the model is expected to abstain.
- **Coverage moves to the pull request:** the guarded jobs no longer run on validated pushes, so the pull request run is the only run of them for that tree.
- **What is measured:** the saving is measured per sampled push, not per month, and provider inference and Sandbox costs are not netted.
