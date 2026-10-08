# Phase 7: authorized live proof and family documentation

Every numbered action below is external. Each needs the owner's explicit authorization for that
concrete artifact before it runs, with the exact local artifact shown first. Run the full local
gate set on the final integrated candidate before step 1.

1. **Image**: build the context with both harnesses (`contree build`, about 2 min), import it,
   then read back the OCI digest/UUID and bind it to the execution profile. (Paid; retained-image cost recorded.)
2. **Proof repository bootstrap** (public, owner-controlled, labeled benchmark): a CI workflow
   with a `push`+`pull_request` trigger on `develop`, 3-4 real jobs (lint, test, build, coverage
   over the existing benchmark workload) and read-only permissions. Inventory every workflow,
   integration and trigger first. No deployment.
3. **Baseline cohort**: three owner-merged PRs into `develop` with the base workflow, recording
   PR run and push run identities.
4. **Collect + diagnose**: `optimize collect --family skip-validated-push` over the baseline
   history, then one held-out Nemotron diagnosis (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, exact
   ID) with an inference permit. Run the 6 new evaluation cases live (6 permits).
5. **Propose + Sandbox verify** with a Sandbox permit; provider readback of the operation.
6. **Candidate integration**: push the candidate workflow to `develop` (via PR), then three
   merged PRs (candidate cohort) and one direct control push.
7. **Measure + report**: `optimize measure` / `report` (local).
8. **Publish**: one unmerged PR carrying the report on the proof repository; `optimize status` readback.

Failed remote runs are evidence: stop the batch, diagnose locally, and get new authorization
after local repair. No rerun or fix-and-repush loop.

## Documentation

`docs/demo/nemotron-optimization.md` gets a family section (rule, safety, how to reproduce,
limits). `README.md` lists two families, with one measured live result each. Add a sanitized
proof under `docs/research/2026-10-2x-skip-validated-push-live-proof.md`, written only after the
chain passes. No private names.

## Acceptance

H1 closes only with: a real NVIDIA decision determining the operation; the Sandbox verifier
`sandbox-verified` with provider readback; the per-push gate `measured-improvement` on real
GitHub runs; and the PR read back. Otherwise record the truthful outcome and keep H1 open.
