# Skip-validated-push: implementation notes

Plan: [2026-10-08-skip-validated-push.md](2026-10-08-skip-validated-push.md).

## Deviations

### Phase 1

- **README scope.** Plan said: fix `README.md:34-41`. Found: line 33 ("Fleet enrollment
  and the 45-day savings evidence come next") was stale as well; the private
  registry shows cut-over enrollments and a measurement window through 2026-10-28.
  Chose: rewrite the whole paragraph, with no numbers beyond the window date. Why:
  leaving a stale claim in the paragraph being corrected would defeat H5.
- **Case study scope.** Plan said: lines 26, 41 and 140. Found: "The key economic
  insight" (line 69-70) also credited concurrent-job consolidation, and the evidence
  status called automated patch proposal future work. Chose: correct both. Why: the
  same single-slot and live-chain facts make them false.
- **Runbook.** Plan did not list `docs/runbooks/fleet-telemetry.md`. Chose: document
  `CIRUJANO_FLEET_REGISTRY`, `fleet-latest.md` and the drift rule there. Why: it is the
  operator reference for the wrapper this phase changes.
- **Wrapper order and explicit registry.** Plan said: pass `--registry` when
  `CIRUJANO_FLEET_REGISTRY` is set or the default registry exists. Chose: write
  `latest.md` first, then `fleet-latest.md`; a set but missing `CIRUJANO_FLEET_REGISTRY`
  fails the run instead of skipping. Why: the cumulative report never depends on the
  registry, and an explicit setting that cannot be honored must be visible.
- **Field-wise comparison.** The old merge compared whole-object JSON, so a key-order
  difference alone counted as drift. The new merge compares field values. Snapshots
  are normalized on read with canonical key order, so no stored data changes outcome.
- **Visibility must differ.** Plan said: keep the earlier record when the differing
  fields are a subset of {visibility, actualGithubListCostUsd,
  counterfactualHostedCostUsd}. Chose: also require `visibility` among them, so a
  cost-only drift throws. Why: two independent simplify reviewers flagged it; the rule
  then does only what it describes, and snapshot validation makes a legitimate
  cost-only drift impossible (`telemetry-store.ts:177-193` rebuilds costs from source).

## Phase 1 handoff (2026-10-08)

- **Objective and scope:** H2 telemetry report repair and H5 truth fixes, as in
  [phase-1](2026-10-08-skip-validated-push-phases/phase-1.md). No optimizer code changed.
- **Identity:** base `develop` `dcf6d0b`; branch `feat/skip-validated-push-p1` in
  `../cirujano-worktrees/svp-p1`; plan docs commit `ee40738`, then the Phase 1 commit.
- **Delivered:** `aggregateTelemetry` merges snapshots in `collectedAt` order and keeps
  the earliest observation when only `visibility` and the two cost fields differ;
  other drift throws with the key and the sorted differing fields. The wrapper also
  writes `fleet-latest.md` when a registry exists or `CIRUJANO_FLEET_REGISTRY` is set.
  README, case study, demo and runbook corrected.
- **TDD:** the four named tests (IDs in the test titles) and a no-registry case failed
  6/7 before the fix (the no-registry case already passed) and pass after.
- **Gate (final candidate, before the commit):** typecheck, lint, test, test:coverage,
  build, `node scripts/verify-bundle.mjs`, `git diff --check`: all exit 0; 1,329 tests
  (278 + 393 + 6 + 652). `packages/action/dist/index.cjs` unchanged (no core change).
- **Real-store acceptance (read-only):** the built CLI (`dist/bin.js` sha256
  `6a14f6ca…7fcbff`) ran `telemetry report` with and without `--registry` against
  `~/.local/share/cirujano/telemetry`: both exit 0, window through
  2026-10-08T04:21:04.989Z, the latest snapshot. 159 visibility-drift duplicates in
  one repository are now resolved. Store files were not written.
- **Review:** an independent reviewer APPROVED. Findings: 1 (combined
  createdAt+visibility drift still throws) no change, the real-store run exits 0;
  2 adopted via simplify (visibility must differ); 3 accepted, unit test plus
  `cli.ts:73` cover the message; 4 documented in the runbook; 5 test IDs added;
  6 fixture clears `CIRUJANO_TELEMETRY_SINCE`/`_LOOKBACK_HOURS`; 7 reworded to
  "Most enrolled private repositories".
- **Simplify:** adopted the identical-duplicate fast path, `visibility` required, and
  `keyof TelemetryJob` typing. Skipped: a shell `write_report` helper (two uses; an
  existing test pins the `mv` line), redundant-looking `latestSnapshot` scan (keeps
  first-of-tie semantics), computing `throughMs` once, merging the two flip tests
  (separate plan IDs), and collapsing the wrapper `it.each` cases.
- **Pending (owner, manual):** reinstall the telemetry bundle and wrapper (commands in
  the phase report). The next 06:10 run then updates `latest.md` and `fleet-latest.md`.
- **Next phase entry:** Phase 2 needs an explicit owner go; revalidate `develop` HEAD.
