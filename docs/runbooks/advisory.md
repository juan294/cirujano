# Retained CI evidence and optional Jev advisory

The advisory CLI collects immutable evidence for a selected GitHub Actions job, ranks local observations, searches retained source, and compares compatible cohorts. These commands do not change workflows, launch runners, open PRs or supply optimization authority. Sutura owns CI cadence and routing. An advisory hypothesis does not establish a cause or measured savings.

Build from the repository root with `pnpm run build`. Examples below use `node packages/cli/dist/bin.js`; an installed CLI uses `cirujano` instead. Retain operation directories outside version control, with local access restricted to their owner. New operations require fresh dedicated output directories; symlinks, active locks and existing outputs are refused.

## Collect and inspect

Authenticate the GitHub CLI with read access to the selected repository. Select the exact run attempt, workflow path, literal job key and API job ID. Collection uses bounded GETs and Git objects at the run's source SHA. It does not download provider logs or execute checked-out source.

```bash
node packages/cli/dist/bin.js advisory collect \
  --repository OWNER/REPOSITORY --run 123 --attempt 1 \
  --workflow .github/workflows/ci.yml --job-key check --job-id 456 \
  --source-file package.json --output ./.cirujano/advisory/job-123
node packages/cli/dist/bin.js advisory status \
  --operation ./.cirujano/advisory/job-123 --format json
node packages/cli/dist/bin.js advisory inbox \
  --input ./.cirujano/advisory/job-123 --sort duration --format markdown
```

`--source-file` is optional and repeatable. Whole selected files are retained with explicit line ranges and Git blob identity. The workflow counts toward the 20-file limit; each source is at most 256 KiB and the raw source total is at most 2 MiB. Credential assignments and literal environment data detected by the conservative guard are refused. This guard is not a confidentiality guarantee; review selected files yourself before collection or transmission.

Job duration and per-job rounded minutes are code-computed observations. Missing timing stays null. Known public hosted execution has zero GitHub execution charge; unknown prices and self-hosted costs stay unknown. Unsupported workflow mappings retain metadata with visible limitations. Expressions, matrix ambiguity and nonliteral source identity do not become guessed step attribution. Observations about repeated commands are not proof of redundant work.

`inbox` accepts repeatable `--input` and `--enrichment`, at most 20 retained bundles in total, and `--sort duration|minutes`. Its default output is Markdown. `--format json` emits the versioned report contract: `schemaVersion`, `status`, `reasonCodes`, `limitations`, `nextActions` and `payload`. Read-only local commands do not send inference requests.

## Search retained source

```bash
node packages/cli/dist/bin.js advisory ask \
  --input ./.cirujano/advisory/job-123 \
  --question 'Where are dependencies installed?' --format markdown
```

The default search is local lexical retrieval, including private evidence. Hits quote inert retained source and point to pinned run, attempt, job and source identities. A no-match result is valid; it does not invent an answer. Known credential-bearing questions are refused before being echoed. Requests to alter CI receive scope guidance. Use repeatable `--input` for a bounded inventory of at most 20 bundles.

Optional semantic search uses an explicitly prepared request and retained enrichment, described below. The exact original question must match. A Choice winner alone is insufficient: existence and relevance must also be supported. Omitted or uncertain candidates are not filled with plausible-looking results.

## Compare cohorts

```bash
node packages/cli/dist/bin.js advisory compare \
  --baseline ./.cirujano/advisory/baseline/cohort.json \
  --candidate ./.cirujano/advisory/candidate/cohort.json --format markdown
```

A cohort manifest has this shape; the checked-in [baseline example](../../packages/cli/fixtures/advisory/comparison/baseline/cohort.json) supplies concrete values and three complete samples:

```text
schemaVersion: 1
kind: advisory-cohort
repositoryId, workflowPath, jobKey, event, headSha, runnerLabels
samples: [{input, digest, runId, attempt, jobId}, ...]
```

Each `input` is a safe relative directory containing `evidence.json`. Require at least three independent successful, supported, completely timed runs per cohort, at most 20 bundles combined, one source identity within each cohort, matching repository/workflow/job/event/runner labels across cohorts, and the baseline window before the candidate. Retries, overlap, incomplete samples, mixed identities and incompatible runner pools are refused.

The report separates Observations from Hypotheses. Code computes medians, rounded minutes, deltas and matched non-overlapping command-step categories. A zero baseline yields an undefined relative percentage. Unmatched steps remain explicit; action-only steps with no command identity cannot become matched category evidence. A regression flag requires both at least 10% and 10 seconds. It is an investigation threshold, not a causal conclusion. Optional Jev hypotheses retain probabilities, references, alternative explanations and missing facts. They never change the arithmetic.

## Prepare, review and authorize one request

Only public or explicitly synthetic evidence can be projected to Jev. Private inference is disabled. Preparation is local and creates the exact `body.json`, `prepared.json`, retained bundle snapshots, `preview.md`, and a deliberately invalid permit template. It sends nothing and grants no permission.

```bash
node packages/cli/dist/bin.js advisory prepare \
  --input ./.cirujano/advisory/job-123 --task labels \
  --output ./.cirujano/advisory/labels-request
node packages/cli/dist/bin.js advisory prepare \
  --input ./.cirujano/advisory/job-123 --task search \
  --question 'Where are dependencies installed?' \
  --output ./.cirujano/advisory/search-request
node packages/cli/dist/bin.js advisory prepare --task compare \
  --baseline ./.cirujano/advisory/baseline/cohort.json \
  --candidate ./.cirujano/advisory/candidate/cohort.json \
  --output ./.cirujano/advisory/compare-request
```

Review the entire exact `body.json`, selected excerpt mapping, question versions, model, endpoint, byte count, hash and price estimate in `preview.md` and `prepared.json`. Names and paths are sanitized for the projection; regex sanitization cannot prove confidentiality. Do not send secrets or rely on preparation as authorization. Questions are typed and bounded; labels are independent Nouls, and search adds an existence Noul and exact-ID Choice.

The owner must explicitly authorize the disclosed payload and estimated spend, then provide a separate matching permit with `kind: jev-advisory-permit` and `payloadReviewed: true`, a fresh unique permit ID, future expiry, exact request hash/model/endpoint, `maxRequests: 1`, sufficient request-byte and estimated-spend allowances, and the displayed price source/date. The generated template has `kind: jev-advisory-permit-template` and `payloadReviewed: false`; it is rejected as authority. Do not automatically convert it into approval.

Set `TYPESAFE_API_KEY` through your existing secret manager or a silent terminal prompt. Do not put its literal value in shell history, arguments, evidence files or reports. For an interactive local shell, `read -s TYPESAFE_API_KEY` followed by `export TYPESAFE_API_KEY` keeps the value out of command history; clear it with `unset TYPESAFE_API_KEY` when finished. The key must be nonempty, at most 2048 characters and contain no whitespace. Key preflight precedes authority reservation.

After that explicit authorization, execute exactly once:

```bash
node packages/cli/dist/bin.js advisory enrich \
  --request ./.cirujano/advisory/labels-request \
  --permit ./.cirujano/advisory/owner-permit.json \
  --output ./.cirujano/advisory/labels-result
node packages/cli/dist/bin.js advisory inbox \
  --input ./.cirujano/advisory/job-123 \
  --enrichment ./.cirujano/advisory/labels-result --format markdown
```

For search, supply the resulting directory as `ask --enrichment` with the original inputs and question. For comparison, supply it as `compare --enrichment` with the original manifests. These readbacks perform no network calls. Changed inputs, query, model, versions, mapping, hashes or receipt chain are refused.

The fixed provider is `jev-1.14.0` at `https://api.typesafe.ai/v1/systemone`. Limits are 32 KiB per request, 256 KiB per response and a 15-second total deadline. Redirects and retries are disabled. The dated [public price quote](https://docs.typesafe.ai/models) is $0.042 per million input tokens and free output on 2026-10-28. Byte-based reservations are conservative estimates; observed usage determines quoted cost, and neither is a provider invoice or guaranteed billing cap. A required hard ceiling needs a verified provider-side cap or fresh owner acceptance of the disclosed uncertainty.

## Recover without replay

Run `advisory status --operation DIRECTORY --format json` and inspect retained intent/receipt artifacts. Exit 0 means a valid local report, including partial, uncertain and no-match results; exit 1 means unavailable/invalid evidence or unsuccessful enrichment; exit 2 means invalid command syntax. Status defaults to text; other read reports default to Markdown.

| State | Next action |
| --- | --- |
| `complete`, `prepared-not-sent` | Review the exact request. Preparation grants no inference authority. |
| `complete`, completed receipt | Reuse the validated retained result; no resend is needed. |
| `partial` or unsupported mapping | Inspect the missing facts. Keep metadata/local evidence; collect a separate corrected selection into a fresh directory if needed. |
| `uncertain` | Keep the abstention and source references; investigate additional evidence. |
| `no-match` | Refine the local question or collect relevant evidence. |
| `unavailable` | Inspect the safe reason and affected path. Correct key, permit, source or manifest preconditions; use the printed local fallback. A consumed permit cannot be renewed by changing directories or metadata. |
| `outcome-unknown` | A request may have reached the provider and may have incurred a charge. Retain intent and receipts, reconcile externally, and do not replay. Any later send needs a fresh explicit owner permit and fresh output directory. |

The permit ledger is fixed under `~/.local/share/cirujano/advisory/permits`. Do not remove it to regain permission. Crashes after reservation, intent, response or receipt do not authorize retries. Missing usage/cost stays unknown. If a retained semantic result fails validation or the provider is unavailable, omit `--enrichment` and use the same local `inbox`, `ask` or `compare` command. An enrichment directory also retains local bundle snapshots that `inbox --input DIRECTORY` can open. The refusal report supplies shell-quoted recovery commands where applicable.

## Reproducible examples and evaluation

These public synthetic reports were generated by the real local CLI; they are not provider evidence:

- [Complete observation](../../packages/cli/fixtures/advisory/complete/report.md).
- [Partial timing](../../packages/cli/fixtures/advisory/partial/report.md).
- [No search match](../../packages/cli/fixtures/advisory/search/no-match.md).
- [Cohort regression](../../packages/cli/fixtures/advisory/comparison/regression.md).

The frozen [evaluation corpus](../../packages/cli/fixtures/advisory/evaluation/) includes 60 label cases (24 development, 36 held-out), 36 search queries (12 development, 24 held-out), a human-readable rubric and source/label/split hashes. Held-out labels receive an independent blind audit before scoring. Synthetic coverage does not establish production accuracy.

After building, generate a complete local dry run in a fresh output directory:

```bash
mkdir -p ./.cirujano/advisory
pnpm run advisory:evaluate --output ./.cirujano/advisory/evaluation
```

Use `--corpus DIRECTORY` only to select a separately frozen corpus. The evaluator invokes the built CLI, checks hashes, records local rules/lexical metrics and a 20-bundle benchmark, and prepares a future experiment manifest. The benchmark records one first-process run and five warm repetitions for inbox/search/compare plus the existing estimator. It does not flush operating-system caches or measure hosted CI speed.

The future execution grammar is shown for review, not as permission to run it:

```text
node scripts/advisory/evaluate.mjs --experiment DRY_RUN/experiment.json \
  --output FRESH_OUTPUT --live --authorization OWNER_AUTH.json \
  --permits OWNER_PERMIT_BATCH.json
```

An owner must separately authorize that exact manifest, estimate and billing uncertainty, and supply all matching single-use per-request permits. Generated authorization and permit templates are deliberately invalid. Execution stops on the first unknown outcome without retrying or sending remaining requests. `--replay RESPONSES.json` replaces `--live` for explicit injected-transport replay; it is permanently non-native and cannot qualify a feature. Preserve all dry-run artifacts, frozen corpus identity, authorizations and receipts together.

If the lexical baseline already exceeds 90% precision at three results, native search also requires a separately measured blinded paired developer review. Supply `--blinded-review FILE` during evaluation execution, with `blinded:true`, `paired:true`, `reviewer`, `recordedAt`, and `pairs:[{taskId,baselineMs,candidateMs}]` for exactly the 18 answerable held-out task IDs. The evaluator computes medians and the required 20% reduction from the timing pairs; aggregate-only assertions do not pass. Label and search qualification remain independent. Status agreement and abstention correctness are reported alongside the fixed precision/recall gates.

Native semantic usefulness, latency and cost remain **UNMEASURED / NOT QUALIFIED** until a separately authorized native experiment passes the per-feature gates. The evaluation dry run prepares public/synthetic payloads and invalid permit templates for a future proposal of at most 200 one-attempt requests across providers and an estimated $1 allowance. It grants no spend. Replay validates software behavior only. Numerical shadow rules and existing optimizer seed evaluations do not replace production diagnosis, native receipts, verification or authorization. A simulated cascade is a projection, not an executed provider chain. No advisory evaluation creates hosted CI, paid runners, provider settings or CI-routing authority.
