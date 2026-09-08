# Changelog

## [Unreleased]

### Added

- Bootstrap the repository from the cc-rpi blueprint with the same layout, CI, CodeQL, dependency review, and rules as Sutura.
- Add `@cirujano/core` billing arithmetic: per-job billable minutes rounded up like GitHub, a fail-closed parser for the Actions jobs payload, workflow ranking, and USD estimation.
- Add the `cirujano estimate --jobs <file>` CLI command.
- Add a GitHub Action that reports the billable minutes of a workflow run from its job timings.
- Record the anonymized GitHub Actions cost baseline measured on 2026-09-08 and the decision to keep Cirujano separate from Sutura.
