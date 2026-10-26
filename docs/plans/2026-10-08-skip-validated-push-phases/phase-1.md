# Phase 1: telemetry report repair (H2) and truth fixes (H5)

Independent of the optimizer. It can start first and needs no external authority, except the
owner-run local bundle reinstall at the end.

## H2: visibility-flip duplicates

Root cause (VERIFIED 2026-10-08): the same job key appears in three snapshots. The first, from
2026-09-28, has `visibility:"public"` and cost `0`. A later snapshot from 2026-09-30, taken after
the repository was made private, has `visibility:"private"` and cost `0.006`.
`packages/cli/src/telemetry.ts:368-384` tolerates only `createdAt` drift and throws
`conflicting duplicate telemetry job`. Every scheduled report has failed since 2026-09-30
(`~/Library/Logs/cirujano/telemetry-error.log`), so `latest.md` is frozen at 2026-09-29. Another
repository changed visibility on 2026-10-08, so the same error will recur.

```
@ mergeJobObservation(existing, next) -> kept
pre: same job key
do:
  1. compute differing fields (excluding createdAt)
  2. if differing ⊆ {visibility, actualGithubListCostUsd, counterfactualHostedCostUsd} -> keep the EARLIER snapshot's record (historical visibility at run time)
  3. else keep existing createdAt rule
br: other drift -> throw naming key + differing field names
risk: wrong snapshot order -> sort snapshots by collectedAt before merging
```

The 2026-09-29 assessment rule ("do not retroactively price public baseline jobs as private")
dictates keeping the first observation.

Also: `scripts/collect-actions-telemetry.sh:56` passes `--registry "$REGISTRY_PATH"` when
`CIRUJANO_FLEET_REGISTRY` is set or the default registry exists. It also writes `fleet-latest.md`.
A report failure still exits non-zero, and the log names the failing key.

Tests (write first): `visibility-flip-keeps-first-observation`, `visibility-flip-order-independent`,
`conflict-names-fields`, `report-with-registry-from-wrapper` (shell test using a fixture store).

## H5: truth fixes (no new claims)

- `README.md:34-41`: the live chain completed on 2026-10-02 with a truthful **no-improvement**
  result. State that, and that no savings PR was opened.
- `docs/cirujano-savings-case-study.md:26,41,140`: one slot per enrollment; the live pilot is done;
  `$120` is labeled modeled; public-repository refusal behavior.
- `docs/demo/nemotron-optimization.md`: link the outcome section of the notes.
- Keep private repository names out (public repository).

## Acceptance

Automated: the full local gate set (plan § gates); new tests fail before the fix and pass after.
Run `node packages/cli/dist/bin.js telemetry report --store ~/.local/share/cirujano/telemetry --since 2026-09-13 --format markdown --registry ~/.local/share/cirujano/telemetry/fleet-registry.json`
**read-only** against the real store: it exits 0 and prints a window through the latest snapshot.

Manual (owner): reinstall the telemetry bundle (`~/.local/lib/cirujano/telemetry/cirujano.mjs`,
backup first) and the wrapper. The next 06:10 run updates `latest.md` and `fleet-latest.md`.
This is a local install and the auto-mode classifier blocks it, so the agent prepares the exact
commands and the owner runs them.

Batch: `[batch-eligible]` H2 unit (`telemetry.ts`, tests, wrapper) and H5 unit (docs only).
