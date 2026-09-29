# Phase 2: GitHub evidence and actual Nemotron diagnosis

Parent: [plan](../2026-09-29-nemotron-workflow-optimization.md). Entry: accepted Phase 1 contracts. No live inference is authorized by this phase's implementation work.

## Changes and ownership

Create proposed CLI modules `optimization/github-read.ts`, `nebius.ts`, `diagnose.ts`, `store.ts`, and their contract/integration tests. Add optimization argument/service interfaces through `packages/cli/src/args.ts:160` and `packages/cli/src/cli.ts:33`; append the service parameter so existing runner/fleet injections remain valid. Use the existing `packages/cli/src/github-api.ts:13` process boundary. A new optimized read path must choose `gh` from explicit configuration or PATH, while leaving existing command defaults unchanged.

`optimize collect` takes repository, exact base SHA, workflow path, job ID and explicit completed baseline run IDs. Retrieve repository/source/job-attempt metadata from GitHub, reject fork/source/SHA mismatches, pending or incomplete runs, and retain source/run receipts. Read source without checkout hooks, executing scripts or modifying any remote. Stage comparisons require the exact selected job and step sequence. Bound all pages, files and output; do not ingest raw logs by default.

`optimize diagnose` renders a bounded request from the validated input and supported operation inventory. Dry invocation creates a request preview only. An explicit local permit names allowed repository/input digest, model, endpoint, expiry, request count, token cap and price basis if a monetary ceiling is claimed. Use `NEBIUS_API_KEY` only for inference. No private source leaves the host unless its source/input digest is covered by that permit.

POST once to the configured approved Nebius completion endpoint. Use the exact model `nvidia/nvidia-nemotron-3-nano-30b-a3b`, unless an explicitly configured evaluated NVIDIA model is selected. Request non-streaming strict JSON schema, `store:false`, temperature 0 and output/deadline/byte bounds from the parent. Validate the HTTP envelope, finish reason, optional refusal, requested versus returned model, JSON payload and evidence references. A valid abstention is an expected product result, not an error to repair automatically. No hidden reasoning trace is requested or stored.

Record both a stable logical attempt ID and each observed provider receipt. Persist an intent before the request, then a sanitized receipt afterward. If response/usage is missing or the process dies after send, record `outcome-unknown` or unavailable spend and do not repeat the call automatically. Error messages never echo authorization headers, prompt text or arbitrary provider bodies. Typed token counts remain visible even though their names contain `tokens`.

```text
@ diagnose(input, permit, provider) -> diagnosis
pre: supported immutable input and explicit live authority
do:
  1. validate permit, model availability and request bounds
  2. write request intent and sanitized input digest
  3. emit one bounded provider request
  4. validate response identity, schema and evidence references
  5. write receipt and proposal or abstention atomically
fail: uncertain request outcome -> disclose and require new explicit attempt
```

## Work units

After Phase 1, U1 GitHub reader and U2 Nebius adapter are `[batch-eligible]` with separate files and external-boundary tests. U3 artifact store and dispatch integration is owned by the root and follows those accepted contracts. No simultaneous edits to args, CLI, exports or package files.

## Automated acceptance

Use a real loopback HTTP test server or injected external transport, not mocks of owned decoders/policy. Test correct request fields/auth destination, strict JSON success, abstention, refusal, truncation, model mismatch, missing/negative usage, oversized body, 401/403/429/5xx, timeout, redirect rejection and malformed JSON. Every failure produces a stable reason and exact recovery command, without a candidate patch. Timeout makes exactly one POST. Provider response injection cannot request commands, extra files or unknown evidence IDs.

Temporary-filesystem integration tests exercise collection -> diagnosis -> persisted reread using real owned modules. Test 0700/0600 modes, output symlink refusal, lock contention/crash recovery and credential-shaped output redaction. Existing CLI help/version/estimate/runner/telemetry/fleet paths work without model credentials. Run every parent local gate after focused tests and review/simplify.

## Manual acceptance and exit

No paid call in this phase. Live model/schema compatibility is an explicit Phase 6 criterion; mocks do not count as that proof. Stop after local phase acceptance.
