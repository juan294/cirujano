# Phase 4: actual Token Factory Sandbox verification

Parent: [plan](../2026-09-29-nemotron-workflow-optimization.md). Entry: accepted exact cache patch. Scope: implement the REST backend, trusted harness, execution-profile validator and recovery. Live execution waits for Phase 6 authority.

## Changes and contract

Proposed files: CLI `optimization/sandbox.ts`, `verify.ts`, `execution-profile.ts`; trusted harness and image-context assets under `scripts/optimization/`; real transport/filesystem integration tests under the CLI package. Reference the parent's official create/operation/cancel sources. Do not copy Sutura's runtime or its assumptions about persistent result images.

An owner-authored execution profile fixes image UUID, OCI digest, Node/pnpm versions, dependency-store/lockfile hash, harness digest, safe source manifest, allowed commands and expected quality output. Generate a reviewable manifest-only image-build context that installs dependencies without lifecycle hooks or pnpmfile execution and includes no repository code or credentials. Its pre-provisioning request binds the context/recipe digest, account/project, resource limits and retention policy without inventing a provider UUID. After authorized preparation/import, read back UUID/digest/harness identity and bind the execution profile/permit. An existing approved image skips provisioning after equivalent readback. Image build/import is an explicitly approved provisioning action, not an implicit step of verification.

The trusted harness receives a bounded stdin JSON payload; reject more than 16 MiB, over 5,000 files, unsafe modes, symlinks, duplicate/absolute/parent paths and sensitive filenames. It writes only below its empty workspace. Execute explicit Node/pnpm argv from the profile, never a model command or host shell. Source and candidate use the same image and non-workflow tree. Original frozen installation and checks run with network disabled inside the disposable instance. Native/lifecycle requirements that cannot work offline give an unsupported-profile result, never skipped checks.

Use the exact REST prefix `/sandboxes/v1/`, source-specific IAM bearer plus Project, and no credential forwarding to the guest. POST `/instances` with `shell:false`, `networking.enabled:false`, `preserve_env:false`, `disposable:true`, timeout 600, truncate_output_at 1048576 and a minimal explicit environment. Pin source image UUID; tags are insufficient. Source and candidate are separate runs with identical command contracts. Machine-readable stdout contains tool/profile/source hashes, test identities and outcomes, skip set, per-file coverage counters and exit statuses. All command stdout is captured within the harness rather than allowed to spoof the final envelope.

Persist intent before POST and operation URL immediately after creation. Follow same-origin in-prefix Locations only. Poll PENDING/ASSIGNED/EXECUTING with bounded Retry-After/backoff to a fixed deadline; terminal SUCCESS/FAILED/CANCELLED is decoded from the official schema. SUCCESS still requires process exit 0, no timeout/signal, complete decoded streams and valid quality evidence. Disposable execution need not produce a result-image UUID.

On deadline/interruption, cancel only owned recorded operations with DELETE and poll for terminal state. 202 is acceptance, not cleanup. Unknown POST outcome or missing terminal readback remains `outcome-unknown`; `optimize status` reconciles a known ID and `optimize cancel` gives a visible recovery path. If no remote ID was returned, disclose that provider inspection is required before a new create; do not invent a lookup/idempotency guarantee. Base-image retention is recorded separately and is not reported as disposable cleanup.

```text
@ verifyPair(proposal, profile, permit) -> sandboxEvidence
pre: exact immutable inputs and approved image/operation limits
do:
  1. validate source manifests and offline execution profile
  2. write intents and execute base then candidate disposable instances
  3. poll terminal results and decode bounded harness envelopes
  4. compare commands, test identities and per-file coverage evidence
  5. write results, operation accounting and unresolved cleanup state
fail: incomplete terminal or weaker quality -> block measured-improvement stage
```

## Work units and tests

U1 REST transport/state recovery and U2 trusted harness/image-context generator are `[batch-eligible]` once the profile/envelope schema is frozen, with disjoint files. U3 paired verifier/CLI integration follows both. One integration owner changes shared exports/dispatch.

Use fixture HTTP servers grounded in the captured official schema. Prove no credentials reach stdin/env, networking is false, output limits are enforced, and a disposable success with no result image works. Prove execution is blocked with only a provisioning recipe and becomes eligible only after UUID/digest readback plus execution authority. Cover 201 plus Location, pending transitions, failed/cancelled, exit nonzero, missing state, malformed encodings, timeout, truncation, cross-origin redirects, changed UUID, crash after create, lost create response, cancellation 202 without terminal, eventual terminal reconciliation and exhausted permit. Replay must never start a second instance for an uncertain first operation.

Run the real harness locally only against owned inert test fixtures, with subprocess boundaries inspected. Mutants delete a test, skip a test, shrink coverage denominator, tamper with a source/profile hash and write forged output: each must fail. Network-isolation proof itself is a Phase 6 live test, not established by an HTTP request assertion. Sandbox elapsed time must never be labeled GitHub cache savings. Run all parent local gates after review/simplify.

## Exit

No paid execution during local implementation. Record all local gates and the concrete public proof/image-preparation request for Phase 6. Stop at acceptance; live entitlement/isolation/cleanup remain unproven until exercised.

## Accepted local implementation

Accepted source `fe114c9980a6b5c39732dc4dbf7b0a3be301d26a`. All nine review findings, paired verifier, installed CLI dispatch, actual Git candidate binding, immutable image/import readback and owned recovery are implemented. The parent completed independent review, repair, three simplify lenses and all nine sequential local gates. Full suite: 960 tests. Actual trusted-harness Linux checks pass with child UID/GID 65534, parent stdout and trusted asset writes denied, and a writable dependency-store clone. Native Token Factory entitlement, import, network denial, execution and cleanup remain unproven. See the companion notes for source identity, evidence and limitations.
