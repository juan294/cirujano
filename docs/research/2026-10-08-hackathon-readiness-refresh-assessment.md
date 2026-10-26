# Cirujano hackathon readiness: refresh assessment

Assessed: 2026-10-08. Baseline: `develop` at `dcf6d0bfe4bcdc94e866b461e12e31d0d7cdb674`
(50 commits after the previous assessment's `91b7908`); `main` at `293c935` (2026-09-08,
137 commits behind `develop`). Working directory `/Users/juan/code/cirujano`. Supersedes the
open-finding status in `docs/research/2026-09-29-hackathon-readiness-assessment.md`; that
document's evidence remains valid for its own date.

Scope: read-only assessment. Source, plan notes, local controller and telemetry state, GitHub
read APIs and the official rules page were read. No implementation, paid execution, remote
mutation or publication was performed. This file is the only repository change.

## Question

What separates Cirujano from a competitive submission to the Nebius x NVIDIA Global AI
Hackathon (Coding and Agentic Engineering track) by the 2026-10-30 10:00 PDT deadline, and
which direction gives the best expected score for the remaining 22 days?

## Criteria (official rules, re-read 2026-10-08)

Source: <https://nebiusglobalaihackathon.devpost.com/rules>, retrieved 2026-10-08 via HTTP GET
(WebFetch was refused with HTTP 403; the page was fetched with curl and converted to text).
Observations, quoted:

- Deadline "Oct 30, 2026 @ 10:00am PDT"; judging period December 1-15, 2026.
- What to create: "a working software application that runs on either Nebius Token Factory or
  Nebius AI Cloud and uses at least one NVIDIA open source model".
- Track: "Build coding agents and developer tools: agents that write, run, and test code in
  Token Factory."
- Stage One is pass/fail on fit: "a genuine attempt at the track's stated goal, not a
  superficial rebrand of an unrelated idea."
- Stage Two, **equally weighted**: Technological Implementation (how well built; how
  effectively it uses Token Factory/AI Cloud and Nemotron); **Design** ("a complete, coherent
  product experience not just a technical proof of concept"); Potential Impact ("a credible,
  specific case for solving a real problem for a real audience and does the solution actually
  address it based on what's demonstrated"); Quality of the Idea (creative, non-obvious use;
  genuine understanding of the problem space).
- Submission: working demo/hosted app/test-build URL; public repo with a detectable OSI
  license; highlight Nemotron and Token Factory use; public YouTube video under three minutes;
  track identification; feedback on Token Factory, AI Cloud and NVIDIA tools; English.
- Multiple submissions must be "unique and substantially different".
- Prizes: one Overall **or** one Track award, plus one Bonus. Bonus awards include "Best Use of
  Tavily" ($3,000) for "a functional, runtime call to the Tavily API" and "Most Valuable
  Feedback" ($100 + swag, 10 awards) judged on completeness, viability and impact.

## Current state (evidence)

### H1: model runtime and product loop: implemented and proven live; the one prescription does not pay

- The optimization loop merged to `develop` in `51f734c` (2026-10-02): collect → Nemotron
  diagnosis → constrained patch → paired offline Token Factory Sandbox verification → candidate
  cohort → measurement → report → authorized publication. Sources:
  `packages/cli/src/optimization/{diagnose,propose,sandbox,verify,measure,publish}.ts`;
  artifact contracts `packages/core/src/optimization/contracts.ts:64-71`, including the retained
  inference receipt (model, latency, usage, hashes) at `:66`.
- The live chain completed on real infrastructure on 2026-10-02 (run6): Nemotron Nano held-out
  diagnosis proposed the cache, `propose` produced the two-line patch, the Sandbox ended
  `sandbox-verified` with identical tests and coverage, three candidate runs followed, and
  `measure` returned **no-improvement** (median 24 s vs 24 s; rounded minutes 3 vs 3). No savings
  PR was opened by design. Source: `docs/plans/2026-09-29-nemotron-workflow-optimization-notes.md`
  (section "Outcome later on 2026-10-02", added in `07cb1f3`).
- The only permitted diff is `cache: pnpm` with `cacheDependencyPath: pnpm-lock.yaml`
  (`packages/core/src/optimization/contracts.ts:67`). The notes conclude: "The family of
  optimization proven end to end does not pay off for this workload on GitHub-hosted runners."
- Track fit is now strong and verifiable: the agent writes a workflow patch and runs and tests
  it in Token Factory Sandboxes, which is the track's literal wording.

Disposition: the model-runtime half of H1 is **resolved**; the "measured improvement" half stays
**open**, because no implemented prescription family produces billable savings.

### Cadence: the largest real saving was built outside the product

- The lean-cadence rollout (CI Fast on routine pushes, full suite nightly and on release; plan
  `docs/plans/2026-10-02-ci-cadence.md`, untracked in this checkout) is live on six private
  repositories as of 2026-10-08, with two more pending. It was implemented per repository by
  agents following that plan, not by Cirujano's code: `grep -ril cadence packages/*/src` returns
  nothing.
- Indicative scale (owner's rollout notes, not re-measured here): one private repository's full
  legacy PR CI billed about 64 minutes, while a lean routine push runs only the CI Fast job. No
  before/after lean window exists yet; most repositories switched on 2026-10-07/08.

INFERRED: cadence prescriptions (skip the push run already validated by the PR; fast lane on
routine pushes; full suite on schedule and release) carry orders of magnitude more billable
minutes than caching on these workloads, so they are the natural second family for the loop.

### H2: scheduled evidence: regressed

- Daily raw collection continues (`~/.local/share/cirujano/telemetry/2026-10-0{1,2,5,6,7,8}.json`;
  no files for 10-03 and 10-04), but every report since 2026-09-30 fails with
  `telemetry report failed: conflicting duplicate telemetry job <public repo>:36386900705:1:108814061316`
  (`~/Library/Logs/cirujano/telemetry-error.log`). `latest.md` is frozen at the 2026-09-29 window
  and `fleet-latest.md` at 2026-09-27. The launchd agent's last exit code is 1.
- The original H2 gap (no `--registry` on the scheduled report,
  `scripts/collect-actions-telemetry.sh:56`) still applies.

Disposition: **open, worse**: no current savings figure can be produced from the pipeline.

### H3: net savings and runner economics: still not defensible, cost driver removed

- Controller-modeled provider cost across P2-P10, read from each `controller-state.json`
  (`lifecycle.cumulativeCostUsd`) on 2026-10-08: **$12.63** total over 72 controller runtime
  hours (P2 $2.57, P9 $2.55, P6 $1.77, P8 $1.60, P10 $1.29, P4 $1.05, P3 $1.04, P7 $0.39,
  P5 $0.37). Gross avoided cost was $4.73 at the last good report (2026-09-29); no later figure
  exists (H2).
- All nine controllers now run `idleResourcePolicy: delete-after-stop` and are `absent` between
  jobs. The 2026-09-22 net-negative driver (80 GiB retained disk per controller, about
  $5.68/month each) no longer applies. INFERRED: monthly economics have improved, but this is
  unmeasured.
- The $120/month headline remains a projection (`docs/cirujano-savings-case-study.md:30`, `:138`).

Disposition: **open**.

### Runner safety: public-repository refusal works in production

- On 2026-10-08 one enrolled repository was made public by its owner. Its controller has
  refused every tick since (`repository must be private, have private visibility, and not be a
  fork`, `packages/runner/src/adapters/github.ts:227`; config guard
  `packages/runner/src/config.ts:33`) and started no VM. The repository's self-hosted jobs then
  queued indefinitely until its workflow was re-routed to hosted runners. Hosted minutes are free
  for public repositories, so relocating them would only add cost.
- This is real, demonstrable evidence of "refuses to spend where it cannot save". It also exposed
  a gap: nothing tells the operator that the enrolled workflow is now stranded.

### H4: performance and coverage matched comparisons: unchanged

There are no new matched windows. The optimizer's measurement contract (`contracts.ts:69`) now
records median, queue and end-to-end maxima per cohort, but that covers the optimizer only, not
the runner fleet. **Open.**

### H5: public narrative: partly updated, now stale in a new way

- `README.md:34-40` describes the optimizer as "implemented locally" and says the "complete live
  model-to-Sandbox-to-GitHub-to-PR proof remains pending". The live chain has since completed
  with a truthful no-improvement result.
- The case study still describes concurrent jobs and four-slot consolidation
  (`docs/cirujano-savings-case-study.md:26`, `:41`) against single-slot enrollments, and calls the
  live pilot pending (`:140`). **Open.**

### H6: judge-facing delivery: mostly missing

- Present: public MIT repository (GitHub API: `visibility: public`, `license: MIT`),
  `docs/demo/nemotron-optimization.md`.
- Missing: any GitHub release (`gh release list` is empty); an up-to-date `main` (137 commits
  behind); a pinned test build; a judge path that works without the owner's Token Factory key
  (the model loop needs a key, while the billing estimator Action does not); video; Devpost text;
  feedback write-up. Devpost drafts and external video were not inspected. **Open.**

### Separation from Sutura

ADR `docs/decisions/0001-separate-project-from-sutura.md` holds: repair of red CI versus cost of
green CI. Both entries are coding agents in the same track. The "substantially different" judgment
is the sponsor's, so the submissions must show different inputs (billing and run history versus
failure logs), outputs (cost patch with minute evidence versus repair patch) and users.

## Alternatives

| Option | Technological Implementation | Design | Potential Impact | Quality of Idea | Cost / risk in 22 days |
| --- | --- | --- | --- | --- | --- |
| A. Package what exists: cache loop plus runners, honest no-improvement | Strong: live Nemotron plus Sandbox chain with receipts | Weak: one-patch PoC, no saving shown | Weak: the demo shows no money saved | Medium | Low: docs, release, video |
| B. Add one high-yield prescription family to the existing loop (recommended), then package | Strong: same chain, second family | Better: diagnose, prescribe, verify and measure with a real saving | Strong if a measured billable-minute cut is shown | Strong: "measures before it cuts", refuses where it doesn't pay | Medium: TDD family, one authorized live proof, paid Sandbox and inference |
| C. Present the hand-built cadence rollout as the product | Weak: no product code does it | Medium | Strong numbers, but not produced by the submission | Risky: Stage One "superficial rebrand" exposure | Low effort, high credibility risk |
| D. Broaden runners (multi-slot, more repositories) | Infrastructure, not agentic | Unchanged | Unproven economics | Low for this track | High |

## Recommendation

**Option B**, bounded to one new family. The best candidate is **skip the develop push run that
re-tests a tree already validated by its PR** (the `develop_push_source` / `validated_by_pr`
pattern already hand-built in the fleet), or its cadence generalization (fast lane on routine
pushes, full suite on schedule and release). Reasons:

- It reuses the proven chain (`collect → diagnose → propose → sandbox → measure → publish`). Only
  a new operation, permitted diff, verification profile and evaluation cases are added. The
  contract already supports this kind of extension (`operation`, `permittedDiff`,
  `verificationProfile`).
- It targets whole duplicate runs, so the measured saving is in **rounded billable minutes**,
  which the owner's measurement gate requires (10% faster median, no minute increase). Caching
  cannot pass that gate on sub-minute jobs.
- The track's "write, run, and test code in Token Factory" fit is preserved: the Sandbox must
  prove the required checks still run for every trusted path. The fleet's cadence review findings
  (skipped required checks count as passing, `base.sha` lag, `workflow_call` identity changes) are
  exactly the safety properties a judge can see verified.
- The public-repository refusal and the truthful cache no-improvement result become design
  strengths: an agent that declines when the numbers say no.

Optional, only if B lands early: a Tavily runtime call that fits the problem (for example,
resolving an action's deprecation or a pricing page for evidence) would qualify for the $3,000
bonus. Prefer depth over a bolt-on.

## Dated gap list to submission (deadline 2026-10-30 17:00 UTC)

| By | Gap | Finding | Type |
| --- | --- | --- | --- |
| 10-09 | Morning check of the first lean nightlies (fleet evidence) | cadence | read-only |
| 10-10 | Fix the telemetry report duplicate-job failure; add `--registry` to the scheduled report; regenerate `latest.md` and `fleet-latest.md` | H2 | code + local |
| 10-10 | Correct README and case study: live chain completed (no-improvement), single slot, $120 is a projection | H5 | docs |
| 10-11 | RPI plan for the second family (operation, permitted diff, Sandbox verification profile, evaluation cases, measurement gate) | H1 | plan |
| 10-12 → 10-18 | Implement the family test-first; offline evaluation; review | H1 | code |
| 10-15 | Measure the first full lean week (before/after billable minutes per private repository, via `scripts/gh-actions-cost-audit.sh`) | H3 | read-only |
| 10-19 → 10-21 | One authorized live proof on the proof repository: diagnose, propose, Sandbox-verify, cohort, measure, evidence PR | H1/H3 | **paid, needs owner authorization** |
| 10-21 | Stranded-workflow signal when an enrollment's repository changes visibility (small; strengthens the refusal story) | runner | code |
| 10-22 → 10-24 | Release from `main` (bring `main` up to `develop`), pinned test build, setup instructions, a judge path that works without the owner's key (estimator Action on any repo plus recorded, hash-bound receipts for the model loop) | H6 | release, **needs authorization** |
| 10-25 → 10-27 | Video under 3 minutes, Devpost text (Nemotron and Token Factory use called out), feedback write-up (Sandboxes 1 MiB request limit, Nano decoding faults, model-ID underscore trap, public-IP quota) | H6 | content |
| 10-28 | Anonymized evidence summary bound to exact run and commit identities; check Sutura separation in copy | H3/H6 | docs |
| 10-29 | Buffer; submit (with authorization) at least a day early | H6 | publish |

## Counterevidence and what would change the recommendation

- If the second family cannot pass the Sandbox safety profile with high confidence (required
  checks provably still enforced), fall back to Option A plus the lean-week measurement presented
  as fleet context, clearly labeled as not produced by the tool.
- If the lean-week measurement shows small savings, the Impact case weakens for B as well; the
  pitch then leans on verification rigor and refusal behavior.
- The judging weights are equal, so if video and packaging slip, Design and Impact fall together.
  The 10-22 → 10-27 block is not compressible below about four days.

## Uncertainties

- Gross avoided cost after 2026-09-29 is unknown until H2 is fixed.
- Not inspected: Devpost draft state, external video, Sutura's own submission copy.
- The rules page was read via a curl text conversion; the visible text was consistent with the
  2026-09-29 reading, plus the judging criteria and prizes quoted above.

## Handoff

- Objective: decide the submission direction; no implementation authorized.
- Base `develop` `dcf6d0b`; `main` `293c935`; no worktree used. The CI cadence plan files in
  `docs/plans/2026-10-02-ci-cadence*` and `docs/research/2026-10-02-ci-cadence-assessment.md` are
  untracked in this checkout (pre-existing).
- Findings: H1 split (runtime resolved, measured improvement open); H2 open and regressed;
  H3-H6 open. New: cadence lives outside the product; the public-repository refusal works but has
  no stranded-workflow signal.
- Checks: no build, test or lint gates were run (assessment only).
- Decision needed from the owner: approve Option B and which family (skip-validated-push or the
  broader cadence fast lane), then run `rpi-plan`. Paid live proof and release need separate
  authorization.
