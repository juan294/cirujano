# Cirujano Savings Case Study

Living pitch narrative, measured economics, joint Sutura positioning, and
rollout evidence.

## Purpose

This document is the living source for explaining how Cirujano reduces GitHub
Actions spend and how Cirujano and Sutura create additional value together. It
separates verified facts, modeled savings, and pending claims so the pitch can
become more precise as both products are applied to real projects.

## Core Cirujano pitch

> Keep every check. Cut every wasted dollar.

I was spending about $386 every month on GitHub Actions. Cirujano found that
most of the billable minutes were concentrated in two heavy CI workflows.

It first identifies work that can be removed safely, such as duplicate runs,
redundant builds, unnecessary shards, and overly broad triggers. It then
verifies that proposed changes remain green and preserve test coverage.

For jobs that cannot be made smaller, Cirujano keeps GitHub Actions as the
control plane but runs the compute on Nebius. The runner starts only when work
is queued, handles concurrent jobs, and stops when the queue is empty.

On the measured workload, this is modeled to replace about $155 per month of
GitHub-hosted compute with approximately $30 of on-demand Nebius compute. That
is roughly $120 in monthly savings, or more than $1,400 per year, before
counting further workflow optimizations.

## Measured economics

- The first two verified full-month GitHub Actions bills were $370.64 and
  $401.78, averaging $386.21 per month.
- Approximately 70 percent of billable minutes were concentrated in two CI
  workflows.
- Those heavy workflows represented about 430 runner-hours per month and
  approximately $155 of GitHub-hosted compute.
- Four concurrent runner slots can consolidate that work into an estimated
  110 to 150 Nebius VM-hours.
- At current compute rates, the replacement compute is approximately $25 to
  $30 per month before persistent storage. A conservative target is about $120
  in net monthly savings.
- That equals roughly 31 percent of the recent average Actions bill and more
  than $1,400 per year.

## Why Cirujano saves money

- **Measure the real bill.** Cirujano calculates billable time per job using
  GitHub run history and the same whole-minute rounding model used for billing.
- **Remove verified waste.** It targets duplicate triggers, repeated setup and
  builds, oversized matrices, unnecessary shards, dead steps, and overly broad
  path filters.
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
it replaces. Cirujano creates the advantage by consolidating concurrent jobs
and turning the machine off when there is no eligible work.

## Joint pitch: Sutura and Cirujano

> Sutura heals CI when it breaks. Cirujano cuts the bill, not the coverage.
> Together, they maximize the value of every CI run while protecting the
> reliability of software delivery.

Most CI products address only one side of the operating problem. A failed
pipeline consumes developer time and delays delivery. A healthy but inefficient
pipeline silently consumes budget on every commit. Sutura addresses the first
problem; Cirujano addresses the second.

Sutura starts from a failed or timed-out GitHub Actions run. It reproduces the
failure in isolated Nebius ConTree sandboxes, distinguishes repairable failures
from flaky or unsafe cases, searches bounded repair candidates, audits the
selected patch, and opens an evidence-backed pull request for human review.

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
  bounded repair and audit. Cirujano uses Token Factory for workflow reasoning
  and AI Cloud for on-demand runners.
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

This loop is the joint product positioning. A direct automated handoff between
Sutura and Cirujano is not yet an implemented integration.

## Evidence status

- **Verified for Cirujano:** A measured account baseline, billable-minute
  calculation, workflow ranking, daily fleet telemetry, and an implemented
  on-demand runner controller.
- **Modeled for Cirujano:** Approximately $120 in monthly net savings from the
  first heavy-workload migration.
- **Pending for Cirujano:** A successful live self-hosted workload pilot and
  measured before-and-after savings from real project migrations. Automated
  workflow patch proposal and verification are also future work.
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
- [Cirujano product status and architecture](../README.md)
- [Sutura product overview and evidence](https://github.com/juan294/sutura/blob/develop/README.md)
- [GitHub Actions pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [Nebius compute pricing](https://docs.nebius.com/compute/resources/pricing)

## Working headline

> Sutura fixes what breaks. Cirujano cuts the bill, not the coverage. Together,
> they deliver maximum CI confidence for the minimum necessary spend.
