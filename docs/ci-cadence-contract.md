# CI cadence contract, version 1

This local contract defines the shared policy and measurement oracles for the private-fleet plan. It changes no repository workflow, check rule, optimizer, registry, runner, telemetry format or deployed consumer. Fixtures contain synthetic `example/*` identities and aliases only.

Run `pnpm run verify:ci-cadence` for the Node tests and frozen fixture validator. Run `pnpm run validate:ci-cadence-fixtures` to validate the frozen inventory alone. `tests/fixtures/ci-cadence/contract.json` records the SHA-256 of sorted relative filenames followed by NUL, exact file bytes and NUL. Frozen contract checksum: `3c6a2a44caa1cfbfda2a4ffd2c5e3ad56e0814c5def7aedc717fa16fecf93b57`. It also records the helper's separate SHA-256: `9f2da9ab55525a3ca4acc311feaf5426fc86d83258c5dda7754dc05405c9a7ab`. Copies in subsequent repository adapters must pin that helper digest and run the common oracles against their actual rendered job graphs. Review any contract change before changing the manifest.

## Routing and immutable inputs

`scripts/ci-cadence.mjs` exports policy validation, event classification, receipt validation, nightly selection, activation checks and graph validation. Native adapters must load the helper/policy separately from an immutable protected PR base or default definition, pass actual read-only API data and independently enforce production/untrusted predicates. A pure function cannot authenticate its supplied trusted-definition object or contributor-controlled YAML. These fixture results do not establish that native acquisition is secure.

| Native event | Required result |
| --- | --- |
| Owner integration push or same-repository owner PR, validated lean | CI Fast with successful commit secret scan, policy validation, lockfile validation and cadence contracts; zero application/full-suite jobs |
| Docs-only owner development | Same required CI Fast; no workflow-wide path omission |
| Missing, invalid or legacy mode | Existing full lane; new cadence nightly disabled |
| First installation without protected helper | Existing full lane; new cadence nightly disabled |
| Production main/master push or PR | Exact candidate/base full validation; release evidence never cancelled by fast or nightly |
| Fork, bot or other author | Hosted read-only full lane; no privileged runner, deployment or credentials; authenticated/provider acceptance explicitly blocked |
| Authorized diagnostic manual validation | Full diagnostic lane; cannot substitute for release admission |
| Lean nightly | Default definition plus integration head resolved once and pinned; history chooses full, unchanged skip or linked known-failure block |
| Exact owner-controlled integration release marker | Full eligible native integration check; ordinary fast cannot emit the full release context |

Policy includes exact repository, integration/default/production branches, human owners, installed workflow blobs, workflow-qualified unique job IDs, dependency graphs and required contexts. Default must be integration or production. Refresh is seven days (168 hours), coverage freshness eight days (192 hours), changed-head deadline 36 hours. The later coverage consumer phase implements the deadline fold; this phase does not claim it is deployed.

## Full receipts and history

A receipt binds source SHA, PR base when applicable, definition SHA, policy/lockfile/runtime fingerprints, installed measuring workflow blob, native event/head/branch/ref, actual tested checkout SHA, run ID/attempt/link, completion time and all successful applicable child/context results. Multiple workflows require separate native receipts under `suites[workflowPath]`; aggregate completion equals the latest actual suite completion, never delivery time. Missing, skipped, failed or cancelled children cannot establish success.

Scheduled native head is the default-definition SHA; tested checkout is the resolved integration SHA. These can differ. PR refs remain PR provenance and cannot become default-branch coverage. Subsequent publishers must enforce actual default-branch measuring provenance before ingestion.

Only complete available history can reuse success or establish the remaining bound for an authorized retry. Observed matching failures/cancellations block automatic execution even when a later page is missing. Unknown/API-failed history conservatively requests full validation with disclosure. Recent matching success skips without publication or refreshed timestamps; seven-day expiry requests an environment refresh. Changed source identity clears a prior-identity block. The helper never dispatches or retries anything itself.

Activation requires the exact repository/default branch, installed definition, native successful CI Fast identity, migrated development rules, deployed compatible consumer and default-off repair guards. These supplied evidence checks require actual API/deployment readback in activation phases. They are not activation authority.

## Measurement input and output

`scripts/measure-ci-cadence.mjs` accepts captured schema-1 JSON:

- `interval`: accounting start/end UTC, end exclusive.
- `collection`: wider created-cohort start/end, fetch time, completeness, errors, per-repository run pages and every run-attempt job page receipt. `earlierCreatedCoverage` and `accountScopeComplete` are explicit collector/ledger attestations, not properties inferred from an arbitrary lookback.
- `repositories`: nonempty public-safe alias and private/public visibility inventory. Quiet repositories use complete zero-count run receipts.
- `runs`: native ID, event, created timestamp, latest attempt, explicit lane and all attempts' jobs. Jobs include ID/attempt, labels, SKU, conclusion and actual start/completion timestamps. Queue time is not execution.
- `rates`: separately supplied timestamped source and effective interval, SKU label inventory, runner kind, list price, weight and public discount. No default prices or weights.
- Optional `billing`, `provider`, `baseline`: independently sourced cash accounting, exact covered interval, observations at/after interval closure and explicit reconciliation/comparability. A zero baseline has unavailable percentage savings.
- Optional `run.publication`: immutable push-event identity and public-safe owner alias from the rollout ledger. Workflow run count alone cannot identify unique publications; without this input publication rates remain unavailable.

Report fields are explicitly selected. Extra input metadata never enters the public summary. Output includes rounded full-job hosted minutes, clipped execution overlap, self-hosted execution without avoided-cost credit, all-attempt counts, event/lane/alias totals, unknown timing/labels/SKUs, scope/page gaps, target status, cash reconciliation and net savings. Full duration for intersecting jobs and clipped overlap are distinct estimates; neither reconstructs the invoice. Private routine totals include monitoring. Activation and release costs remain separately attributed.

The 80-minute routine daily allocation plus 500-minute release reserve over 31 days is a future-cycle target, not a cap or forecast. Missing collection/rate evidence leaves target unavailable. Missing cash/provider/comparator evidence leaves `netSavings` null. A seven-day extrapolation cannot prove a zero monthly invoice; the report retains `zeroMonthlyInvoice: "unverified"`.

## CLI and read-only collection

```sh
node scripts/measure-ci-cadence.mjs --source /absolute/capture.json
node scripts/measure-ci-cadence.mjs --source /absolute/capture.json --output /absolute/new-summary.json
node scripts/measure-ci-cadence.mjs --collect /absolute/private-collection-config.json
```

Collection config supplies repository aliases/names/visibility, accounting interval and wider `start`/`end`, explicit scope attestations, optional dated rate/accounting inputs, `skuByRunner`, `laneByWorkflow`, `ownerAliases` and `publicationByRun`. Unknown mappings stay unknown. The collector calls only `gh api --method GET` for created-filtered run pages and each attempt's job pages. The GitHub 1,000-run created-filter cap blocks completeness with an instruction to split the interval. Job pagination is bounded; changed totals, missing pages and failed requests remain incomplete. There is no workflow rerun, dispatch, cancel, branch write, publication, provider or budget command. [Run API](https://docs.github.com/en/rest/actions/workflow-runs), [attempt job API](https://docs.github.com/en/rest/actions/workflow-jobs).

Live captures default to ignored `docs/agents/ci-cadence/capture-*.json`; override with `--evidence-output` only to a private local evidence destination. New directories use mode 0700, new evidence/summary files use exclusive creation and mode 0600. Existing files or input/output collisions fail. Correct malformed fields locally and use a new output path; a corrected capture fixture proves incomplete-to-complete recovery without rerunning a remote job.

## Phase boundary

Phase 1 supplies local oracles and the tool. Native helpers/workflows, coverage consumers, production smoke, settings migration and observed cost acceptance belong to subsequent phases. Local fixtures cannot replace real DB/browser tests, actual required contexts, deployed readback, the 72-hour activation windows or seven complete observation days.
