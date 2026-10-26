# Changelog

## [Unreleased]

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
