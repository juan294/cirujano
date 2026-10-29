# Changelog

## [Unreleased]

## [0.3.0] - 2026-10-29

### Added

- Add local `advisory collect-source` and `advisory ask-source` commands for immutable workflow declarations at the recorded run head, independently of executed-job mapping. Excerpts retain exact source bytes and pinned Git references.
- Add versioned source admission for a narrow set of benign workflow/job/step environment declarations, with strict YAML and decoded credential checks. Existing V1 sidecars retain their original admission rules.

### Changed

- Filter local source searches by declared operations and abstain on unavailable runtime records or external implementation bodies. Report the admission/search policy IDs and evidence limits explicitly.
- Document real-source diagnostic results, including refusal coverage, retrieval losses and the rejected experimental v3 search candidate. That candidate is excluded from this release.

### Compatibility

- Additive release; Node 22.13 or newer remains required. Existing execution evidence, numeric arithmetic and inference permit contracts are unchanged.
- Jev remains off by default; no native usefulness, latency, cost or developer-time improvement is claimed. Source declarations do not establish execution or savings.
- No npm publication, provider activation, paid runner operation or CI-routing change is included.

## [0.2.0] - 2026-10-29

### Added

- Add the `cirujano advisory` command group: `collect`, `status`, `inbox`, `ask`, `compare`, `prepare` and `enrich`. It retains immutable evidence for an exact GitHub Actions job selection, ranks code-computed observations, searches retained source with local lexical retrieval and compares compatible baseline/candidate cohorts. Local commands send no inference requests and do not change workflows, launch runners or open pull requests.
- Add optional, bounded Jev enrichment for labels, search ranking and regression hypotheses. Only public or explicitly synthetic evidence can be projected. Each request needs a reviewed exact payload and a separate single-use owner permit; the fixed provider limits are 32 KiB per request, 256 KiB per response and a 15-second deadline, with no redirects or retries. Unknown outcomes are retained and never replayed.
- Add a frozen advisory evaluation corpus (60 label cases, 36 search queries), the `pnpm run advisory:evaluate` local dry run with a 20-bundle benchmark and reproducible public synthetic example reports.
- Add the advisory operations runbook (`docs/runbooks/advisory.md`) and a README section for the local advisory commands.

### Changed

- Run the CLI package tests through the shared serial Vitest configuration.
- Refresh the Devpost submission text with the published release and measured evidence.

### Fixed

- Include child process stderr in runner controller test failures so startup failures are diagnosable.

### Compatibility

- Additive release; no migration from 0.1.0 is required. APIs and configuration may change before 1.0.
- Node 22.13 or newer is required. Local development uses Node 24 and pnpm 11.
- Native semantic usefulness, latency and cost of the Jev enrichment remain unmeasured and not qualified. Advisory output is a hypothesis, not a cause or a measured saving, and it grants no CI-routing authority; Sutura owns CI cadence and routing.
- Enrichment requires `TYPESAFE_API_KEY` and an explicit owner permit. Paid provider operations and pull-request publication still require explicit permits. This release does not publish to npm.

## [0.1.0] - 2026-10-26

### Added

- Bootstrap the repository from the cc-rpi blueprint with the same layout, CI, CodeQL, dependency review, and rules as Sutura.
- Add `@cirujano/core` billing arithmetic: per-job billable minutes rounded up like GitHub, a fail-closed parser for the Actions jobs payload, workflow ranking, and USD estimation.
- Add the `cirujano estimate --jobs <file>` CLI command.
- Add a GitHub Action that reports the billable minutes of a workflow run from its job timings.
- Record the anonymized GitHub Actions cost baseline measured on 2026-09-08 and the decision to keep Cirujano separate from Sutura.
- Add the on-demand Nebius runner controller, guest watchdog, bounded permits, durable recovery and per-enrollment operation.
- Add fleet enrollment, daily Actions telemetry, controller-cost attribution and sanitized savings reports.
- Add bounded Nemotron workflow optimization: pnpm-cache and skip-validated-push proposals, paired Sandbox verification, measured cohorts and permitted unmerged PR delivery.
- Add offline/live evaluation tools, a public benchmark, cadence policy oracles and read-only event/branch measurement lanes.

### Changed

- Require Node 22.13 or newer; use Node 24 for the workspace and update pnpm, Vitest and other dependencies.
- Resolve the Actions runner release and archive digest at installation/render time, while retaining paired explicit version/digest overrides.
- Update Sutura integration, repository-scoped App authentication and native verification receipts. CI routing remains Sutura-owned.

### Fixed

- Avoid false controller-lock conflicts from concurrent database readers while preserving single-controller ownership.
- Keep SSH diagnostic classification linear for repeated prefixes and simplify literal GitHub endpoint matching.
- Serialize concurrent controller crash recovery with an OS-backed lock and preserve exclusion through release.
- Enforce controller-owned runtime deadlines and accounting when guest evidence is missing or changed, including bounded recovery of expired pending starts.
- Reject telemetry reports with gaps in daily observation coverage; accept validated missing-timing completion while preserving original visibility pricing and strict conflict checks.
- Reject estimator inputs whose declared job count differs from the complete inventory, and document pagination.
- Resolve interactive telemetry/fleet `gh` commands through PATH unless explicitly overridden.
- Locate setup-node by its actual workflow step instead of a stale positional test fixture.
- Repair runner bootstrap, registration, drain/restart recovery, provider-capacity backoff and GitHub polling headroom.
- Correct retry-attempt attribution, skipped-job measurement and transient telemetry reads.
- Repair Sandbox payload/install handling, image provenance, operation polling and hosted evidence parsing.

### Compatibility

- First release; no previously published version requires migration. APIs and configuration may change before 1.0.
- Node 22.13 or newer is required. Local development uses Node 24 and pnpm 11.
- Runner workloads must be trusted: jobs have root-equivalent guest privileges. The controller must remain online to enforce its own deadlines independently of guest reports.
- Paid provider operations and pull-request publication require explicit permits. Measured results apply to the recorded workload and do not guarantee savings for other repositories.
