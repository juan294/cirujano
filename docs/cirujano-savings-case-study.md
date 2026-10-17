# Cirujano Savings Case Study

Living pitch narrative, measured economics, joint Sutura positioning, and
rollout evidence.

Updated: 2026-10-17. For the recording, follow the
[2:50 script with screen cues](demo/recording-script.md) and
[presentation cards](demo/recording-cards.html).

## Purpose

This document is the living source for explaining how Cirujano reduces GitHub
Actions spend and how Cirujano and Sutura create additional value together. It
separates verified facts, modeled savings, and pending claims so the pitch can
become more precise as both products are applied to real projects.

## Core Cirujano pitch

> More software for the same engineering budget. Keep every check. Cut every wasted dollar.

Imagine developers spending more of their time building, with infrastructure
that continuously improves the economics of verifying their work. Cirujano is
an early step toward that future, using NVIDIA Nemotron on Nebius Token Factory,
isolated Token Factory Sandboxes and on-demand Nebius AI Cloud CPU runners.

My first two measured monthly GitHub Actions bills averaged $386.21. An audit
estimated that about 70 percent of billable minutes came from two heavy CI
workflows. That was the pain: each additional project meant more pipelines to
understand, maintain and fund.

The implemented optimizer supports two bounded families: pnpm caching and
skipping a duplicate merge push when the pull request already passed the same
workflow on the exact tree. On 2026-10-09, the latter cut each of three sampled
merge pushes from three rounded runner-minutes to one, while a direct push still
ran every check. That is a 67 percent reduction on those pushes and six
runner-minutes avoided across three candidates. The proof repository is public,
so it establishes no GitHub invoice saving. Personal developer hours saved
remain unmeasured. [Exact runs and limits](research/2026-10-09-skip-validated-push-live-proof.md).

For jobs that cannot be made smaller, Cirujano keeps GitHub Actions as the
control plane but runs the compute on Nebius. The runner starts only when work
is queued, runs one job at a time for each enrollment, and stops when the queue
is empty.

On the historical measured workload, this is modeled to replace about $155 per month of
GitHub-hosted compute with approximately $30 of on-demand Nebius compute. That
is a modeled saving of roughly $120 per month, or more than $1,400 per year,
before counting further workflow optimizations. The model assumes four
concurrent runner slots; the implemented runner has one slot per enrollment,
so the figure is a projection, not a measured result.

## Measured and modeled economics

- Measured: the first two verified full-month GitHub Actions bills were $370.64 and
  $401.78, averaging $386.21 per month.
- Estimated from sampled runs: approximately 70 percent of billable minutes were concentrated in two CI
  workflows.
- Inferred from sampled runs: those heavy workflows represented about 430 runner-hours per month and
  approximately $155 of GitHub-hosted compute.
- Modeled: four concurrent runner slots could consolidate that work into an
  estimated 110 to 150 Nebius VM-hours. The implemented runner has one slot per
  enrollment, so this consolidation is not built.
- Modeled: at the baseline's dated compute rates, the replacement compute is approximately
  $25 to $30 per month before persistent storage. A conservative modeled target
  is about $120 in net monthly savings.
- Modeled: that equals roughly 31 percent of the recent average Actions bill
  and more than $1,400 per year.

## Why Cirujano saves money

- **Measure the real bill.** Cirujano calculates billable time per job using
  GitHub run history and the same whole-minute rounding model used for billing.
- **Remove verified waste.** The implemented families cover pnpm caching and
  proven duplicate post-merge work. Redundant builds, matrix resizing, dead
  steps and broader path-filter changes remain future opportunities.
- **Relocate irreducible work.** Docker, emulator, end-to-end, and full-build
  jobs can move to an on-demand Nebius runner.
- **Pay only for demand.** The runner starts for eligible queued jobs and stops
  after the queue drains and the idle grace period passes.
- **Preserve confidence.** A lower bill is not accepted as a saving if it comes
  from deleted tests, weakened coverage, or a failed workflow.
- **Keep human control.** Evidence-backed changes remain subject to review and
  are never auto-merged.

## The key economic insight

A permanently running self-hosted machine does not solve the problem. An
8-vCPU, 32-GiB VM running continuously costs close to the GitHub-hosted workload
it replaces. Cirujano creates the advantage by turning the machine off when
there is no eligible work. Consolidating concurrent jobs onto one machine is
part of the savings model, not of the implemented one-slot runner.

## Joint pitch: Sutura and Cirujano

> Sutura heals CI when it breaks. Cirujano cuts the bill, not the coverage.
> Together, they maximize the value of every CI run while protecting the
> reliability of software delivery.

Most CI products address only one side of the operating problem. A failed
pipeline consumes developer time and delays delivery. A healthy but inefficient
pipeline silently consumes budget on every commit. Sutura addresses the first
problem; Cirujano addresses the second.

Sutura's repair engine starts from a failed or timed-out GitHub Actions run. It reproduces the
failure in isolated Nebius ConTree sandboxes, distinguishes repairable failures
from flaky or unsafe cases, searches bounded repair candidates, audits the
selected patch, and opens an evidence-backed pull request for human review.

Under the owner's 2026-10-16 decision, Sutura also owns CI cadence and automatic
routing coordination. This positioning does not claim that prepared local
routing is activated on hosted repositories, or authorize a routing change.

Cirujano starts from billing and run history. It ranks where the minutes go,
identifies removable waste, verifies cheaper workflow configurations, and
moves heavy jobs that cannot be reduced onto on-demand Nebius infrastructure.

## The combined value proposition

- **Continuous CI care.** Sutura reacts to red CI; Cirujano examines green CI.
  Together they cover the complete operating cycle.
- **Faster recovery with lower recurring cost.** Sutura reduces the manual work
  of diagnosis and repair, while Cirujano reduces the infrastructure cost of
  repeatedly running the repaired pipeline.
- **One evidence standard.** Both products bind claims to real runs, exact
  commits, deterministic checks, and human-reviewed pull requests.
- **Safe automation.** Neither product treats a green check as sufficient.
  Sutura rejects green-wash repairs, and Cirujano rejects savings that weaken
  test coverage.
- **Complementary Nebius use.** Sutura uses Token Factory and ConTree for
  bounded repair and audit. Cirujano uses Token Factory for workflow reasoning,
  Token Factory Sandboxes for verification, and AI Cloud for on-demand runners.
- **Independent products, stronger together.** Each product solves a complete
  problem alone. Their joint story is an operating system for CI health, not a
  forced bundle or a single oversized agent.

## Joint pitch, short version

Every CI pipeline has two failure modes: it can break, or it can keep working
while quietly wasting money. Sutura repairs broken CI with verified,
evidence-backed patches. Cirujano preserves the checks developers trust while
eliminating waste and moving irreducible workloads to on-demand Nebius runners.
Together, they deliver maximum CI confidence for the minimum necessary spend,
without removing human approval.

## Joint product loop

1. A workflow fails or times out.
2. Sutura reproduces, classifies, repairs, verifies, and proposes the fix.
3. The workflow returns to a verified green state.
4. Cirujano measures the repaired pipeline and finds its highest-cost work.
5. Cirujano verifies safe workflow reductions or relocates irreducible jobs.
6. Fleet telemetry records before-and-after reliability, hosted cost, provider
   cost, and net savings.

This loop is proposed joint product positioning. Sutura remains the coordinator;
Cirujano supplies cost evidence and reviewed optimizations. A direct automated
handoff between them is not implemented, and combined developer-time or net-cost
benefits have not been measured.

## Evidence status

- **Verified for Cirujano:** A measured account baseline, billable-minute
  calculation, workflow ranking, daily fleet telemetry, and an on-demand runner
  controller that passed its live pilot on 2026-09-15. Most enrolled private
  repositories have cut over to it, one slot per enrollment. Enrollment refuses
  a public repository, because its hosted minutes are free and migration would
  only add provider cost, and the fleet report flags an enrolled repository that
  later becomes public. The workflow optimizer completed its live chain on
  2026-10-02 (NVIDIA decision, Sandbox verification and GitHub measurement) and
  measured no improvement, so no cache savings pull request was opened. The
  skip-validated-push family then passed its live chain on 2026-10-09, with
  three candidate merge pushes each billing one minute against a three-minute
  baseline median. All sampled PRs passed the same three jobs; the direct-push
  control ran all jobs plus the classifier and billed four minutes. Evidence
  PR #8 was read back as open and unmerged on 2026-10-17.
- **Modeled for Cirujano:** Approximately $120 in monthly net savings from the
  first heavy-workload migration, assuming four concurrent runner slots.
- **Fleet snapshot, not a net saving:** The scheduled report through
  2026-10-17T04:17:26.096Z records $18.840 gross hosted list cost avoided and
  $19.872 controller-accounted Nebius cost. Accounting is incomplete and net
  savings are unavailable. These values cannot support a positive net-saving
  claim. The [recording evidence note](demo/recording-script.md#evidence-refresh-2026-10-17)
  records the window and limitations without exposing private repositories.
- **Observed, not attributed:** Cirujano's 2026-10-02 cadence assessment
  recommended fast checks on routine pushes and the full suite nightly and at
  release. In the first days with every private repository on that cadence
  (2026-10-14 to 2026-10-16), private-repository CI used 164 minutes a day
  against a July-August average of 2,109 (about $30 against $380 a month at
  list price, before included minutes and provider costs). Release activity in
  the heaviest repository was paused and activity is not normalized, so this is
  an observed usage drop, not a measured Cirujano saving.
- **Pending for Cirujano:** Complete matched before-and-after net savings from
  the enrolled migrations, whose 45-day window closes on 2026-10-28; measured
  developer hours recovered; and outcomes on larger private workflows.
- **Verified for Sutura:** Public dogfood evidence shows a seeded CI failure, a
  Sutura-authored repair pull request, human merge, and a green repaired commit.
- **Pending for the joint story:** Real projects operating with both products,
  measured developer-time recovery, avoided reruns, provider costs, and
  combined reliability and savings trends.

## Per-project rollout record

Add one record for each project and evaluation window:

- Project and repository
- Baseline window and exact source runs
- GitHub-hosted minutes and billed or list cost
- Primary cost drivers
- Sutura failures observed and outcome counts
- Sutura inference and sandbox cost
- Developer diagnosis or recovery time before and after
- Cirujano optimization or runner migration applied
- Before-and-after workflow duration and billable minutes
- Nebius compute, disk, network, and inference cost
- Gross hosted cost avoided
- Net monthly saving and percentage reduction
- Exact commits, workflow run IDs, and evidence links
- Known limitations, unknown-price jobs, and confidence level

## Rules for updating this document

- Label every number as measured, modeled, or pending.
- Do not call gross hosted cost avoided a saving until Nebius and inference
  costs are subtracted.
- Bind every result to exact commits and workflow run IDs.
- Do not combine evidence collected from different candidates into one success
  claim.
- Keep failed pilots and negative results visible.
- Update the headline only after the underlying evidence record is complete.

## Sources

- [Cirujano measured baseline](research/2026-09-08-github-actions-cost-baseline.md)
- [Measured skip-validated-push proof](research/2026-10-09-skip-validated-push-live-proof.md)
- [Recording script and current readback](demo/recording-script.md)
- [Cirujano product status and architecture](../README.md)
- [Sutura product overview and evidence](https://github.com/juan294/sutura/blob/develop/README.md)
- [GitHub Actions pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [Nebius compute pricing](https://docs.nebius.com/compute/resources/pricing)

## Working headline

> Sutura fixes what breaks. Cirujano cuts the bill, not the coverage. Together,
> they deliver maximum CI confidence for the minimum necessary spend.
