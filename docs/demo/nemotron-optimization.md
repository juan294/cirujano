# Nemotron workflow optimization

Cirujano implements one bounded optimization: enable pnpm store caching on an existing immutable `actions/setup-node` step. It collects GitHub evidence, obtains a structured NVIDIA model decision through Nebius Token Factory, constructs the two-field patch, verifies quality in paired Sandboxes, measures a predefined GitHub cohort, and prepares an authorized unmerged PR. Local implementation and replay checks do not establish a live improvement or close H1.

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

The read-only validator rereads retained product evidence and rejects missing or altered model decisions, paired Sandbox quality, six-run measurements and confirmed PR identities. Injected transports remain explicit replay with `live: false` and cannot qualify as a native proof. Exit zero means the retained structure is complete; the result still reports `passed: false`, `live: false`, `h1Closed: false` and the required native gates. Final acceptance requires actual provider readback of the Sandbox boundary operations and current GitHub publication readback. Refresh the actual PR through `optimize status` before a public claim; a local manifest does not establish current remote state. Save a sanitized feature proof in `docs/research/` only after the live chain passes. Until then, H1 remains open, no workflow saving or hackathon proof is claimed, and broader optimization families, fleet savings and H2-H6 remain future work.
