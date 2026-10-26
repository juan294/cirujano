# CI cadence and account cost assessment

Date: 2026-10-02. Decision: should the fleet replace full CI on routine changes with local validation, inexpensive development checks, nightly suites and release gates?

## Recommendation

Yes. Make execution frequency the first cost control. Retain full local verification, run only a small remote development gate, consolidate heavy remote suites into a changed-code nightly run and a mandatory pre-release run, and use Cirujano for the remaining jobs only where its reliability and total cost justify it. This preserves the test suites while accepting a longer interval before independent remote detection of development regressions.

Do not copy automatic staging deployments from the supplied tweet: the owner's current policy prohibits Vercel Previews. Do not remove all PR checks indiscriminately. Release PRs need full validation, and untrusted contributions need an isolated remote validation path.

The tweet is an anecdote supplied by the owner, not a verified savings forecast for this fleet. A near-zero Actions invoice is a target requiring a measured budget, not an outcome established here.

## Scope, baseline and evidence

This is an assessment, with local artifacts and read-only GitHub inspection. It authorizes no workflow edits, pushes, branch-rule changes, budget changes, CI dispatches, cloud starts or deployments.

- Repository: Cirujano, `/Users/juan/code/cirujano`, integration branch `develop`.
- Starting source commit: `a20eca6da52684466b3f6f8cf01a4bd1450d80c8`.
- Concurrent work advanced the checkout to `ff15dbb68ca4f481b12022159b84bf089ba665b6` during inspection. That commit changes two CLI test helpers and does not change the production sources cited below. It is unrelated work and remains untouched.
- GitHub inventory: 29 non-archived owned repositories, 10 private. One private repository had no runs in the window.
- Run cohort: all 593 runs returned across those private repositories, created from October 1 at 00:00 UTC through October 2 at 14:38:43 UTC. Job collection included all attempts and pagination, with zero API request failures. Jobs were read after the run cutoff.
- Billing REST returned HTTP 404 with an explicit missing `user` scope. Signed-in browser inspection succeeded without expanding credentials or requesting an emailed export.
- Graphify repository and global graphs were queried first. The relevant production source, workflow files and GitHub responses supply the actual evidence.

Private repository names, job records, current workflow blobs and account observations are retained in the gitignored directory `docs/agents/2026-10-02-ci-cadence/`. Its `README.md` supplies the private mapping and evidence references; `sha256-manifest.json` binds the captured data. This public document uses repository aliases.

## Current observations

### The allowance is exhausted

The supplied alert reports 2,703 of 3,000 included minutes used. During this assessment, the billing overview reached **3,000 of 3,000 included minutes used and $0.14 billable Actions usage**. The budget page separately showed a **$450 Actions budget with stop usage enabled**, with $0.06 spent at that earlier observation. These are successive observations of changing state, not simultaneous totals.

The gross-usage chart includes public repository usage that is discounted. It cannot be ranked as cash cost without visibility and SKU attribution. GitHub documents that standard hosted runners in public repositories and self-hosted runners have no Actions execution charge; private hosted usage consumes the account allowance. Cloud compute and storage remain separate costs. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), retrieved 2026-10-02.

### Most identified hosted time comes from pushes and PRs

| Private repository alias | Identified hosted job-minutes | Observed Cirujano job-minutes |
| --- | ---: | ---: |
| A | 838 | 195 |
| B | 724 | 85 |
| C | 695 | 40 |
| D | 360 | 236 |
| E | 305 | 90 |
| Remaining private repositories | 226 | 68 |
| Total | 3,148 | 714 |

These are reconstructed execution minutes, calculated as the ceiling of each timed, non-skipped job's duration. Hosted classification uses runner labels, excluding explicit self-hosted labels. They are not a reconciled billing total. There are 53 jobs with unknown runner classification and seven non-skipped jobs with incomplete timing. Unknown timestamps can include queue time and are excluded. Runs created before the cohort, even if they later executed during October, are excluded. Cirujano runtime does not prove an equal number of avoided hosted minutes or net savings.

Of the 3,148 identified hosted minutes, PR events account for 1,603, pushes for 1,312 and schedules for 124. Other events account for 109. Thus 92.6% is associated with pushes or PRs, but this includes necessary release validation and is not an achievable savings percentage. Repositories A, B and C account for 71.7% of the identified hosted total and are the first candidates for detailed cadence changes. Evidence: private `summary.json`, `run-inventory.json` and `jobs.json`.

### Cirujano's current mechanisms do not implement this policy

The current optimization operation is `enable-pnpm-cache` (`packages/core/src/optimization/contracts.ts:9`). The patch validator removes only the inserted cache fields before requiring the rest of the parsed workflow and original bytes to remain unchanged (`packages/core/src/optimization/patch.ts:42`). This mechanism cannot change triggers, test frequency or release semantics. Broadening its authority would require a separate reviewed contract.

Fleet enrollment and cutover operate on a selected workflow/job and runner identity (`packages/cli/src/fleet-service.ts:152`, `packages/cli/src/fleet-service.ts:193`). That can reduce the cost of jobs still requested, but it does not eliminate repeated requests.

Repository A returned its checks and four coverage shards to hosted Ubuntu on October 2. The recorded release rationale is a blocked runner public-IP allocation, with a quota of three and a request for four. This provider incident is evidence from the existing release record, not a fresh cloud-quota inspection. Current workflow bytes verify the hosted placement; the local fleet registry still marks both corresponding enrollments as cut over. See private evidence references A1 and A2. Do not reverse this intentional release fallback without resolving reliability and obtaining the applicable authority.

The `fleet verify` implementation can record reverted labels (`packages/cli/src/fleet-service.ts:217`). It was inspected, not executed, because it writes the registry. The discrepancy is recorded for follow-up.

The local `fleet-latest.md` ends September 27, and `latest.md` ends September 29. A newer October 1 raw snapshot exists, but those summaries cannot prove October 2 fleet savings. No fresh provider-cost reconciliation was performed in this assessment.

### Reporting and branch rules constrain the change

One coverage workflow explicitly runs on every default-branch push because its consumer treats a coverage SHA behind the current head as a mismatch. The consumer promotes a prolonged mismatch to an error. A nightly schedule therefore needs a matching reporting contract: display the actual tested SHA and age; distinguish an untested new head from a failed test; keep release evidence strict. Never relabel yesterday's report as today's coverage. See private evidence D1 and F1.

Current effective rules require several expensive development checks in A and C. Production rules retain full checks. A uses rulesets despite the legacy branch-protection endpoint returning 404; both APIs were inspected. Removing a trigger without migrating the relevant rule can block merges. Conditional skips also must not impersonate a completed release test. GitHub documents pending checks for skipped workflows and different semantics for skipped jobs. [Required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks), retrieved 2026-10-02.

Repository B's default branch is `main`, unlike the integration branch used for development. Scheduled workflows run from the default branch. A nightly design must explicitly resolve and test the intended integration commit and retain that identity in its evidence. [Scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), retrieved 2026-10-02.

## Alternatives

| Option | Cost and maintenance | Correctness and operational trade-off | Assessment |
| --- | --- | --- | --- |
| Continue caching and runner migration alone | Pays for repeated work; requires runner reliability and provider accounting | Retains frequent remote feedback but can block on runner capacity | Useful after demand reduction; insufficient as the primary response |
| Literal removal of ordinary PR CI, with nightly and release suites | Largest reduction in development triggers | Depends heavily on local evidence; needs different rules for owner work and untrusted contributions | Feasible for owner-controlled private development after rule migration |
| Small development gate plus nightly and release suites | Small recurring cost, less dependence on local environment | Some regressions detected remotely later; preserves a quick independent signal | Recommended default |
| Changed-code nightly plus release-only remote execution | Lowest routine hosted use if development stays local | Longest remote feedback delay; scheduled execution can be delayed | Candidate for quiet, low-risk repositories after measuring their needs |
| Add hosted staging builds on every push | Adds build/deployment consumption | Conflicts with the current no-preview policy | Excluded |

## Proposed operating policy

| Event | Validation policy |
| --- | --- |
| Local development and owner working branches | Full applicable tests, coverage, lint, types, build and deployment preflight locally; batch dependency work and completed changes before publication |
| Owner feature PR or approved `develop` publication | One inexpensive policy/secret check plus bounded fast checks appropriate to that repository; avoid routine full coverage, database setup, browser matrices and Lighthouse |
| Nightly | Full suite once for a changed integration commit, with actual tested identity; retry known failures only under the applicable authority; retain a bounded periodic environment/dependency check even without code changes |
| Release PR into `main` | Full required suite before merge, against the exact candidate/integration result; preserve database, browser, security and platform contracts; rerun invalidated evidence when the candidate or base changes |
| After authorized production publication | Required artifact/platform verification and production smoke, with full reruns only where the documented release contract requires them |
| External/untrusted contribution | Isolated remote validation without privileged self-hosted credentials; use a repository-specific rule rather than the owner's local-evidence assumption |

The full suite may share implementation between nightly and release events, but the release check must actually run under an event that can satisfy its rules. A passing scheduled or manual workflow is not automatically interchangeable with a required PR check. See the GitHub status-check source above.

Keep existing production monitoring unless measurements show it is a material cost target. Here schedules account for only 3.9% of the identified hosted runtime. Consolidate duplicate coverage publication with a suite that already ran, and retain cancellation of superseded development jobs without cancelling release evidence.

## Cost target and counterevidence

3,000 included minutes over a 31-day cycle allow about 96.8 hosted minutes per day across the entire account. Nightly does not mean free: a hypothetical ten repositories at 30 hosted minutes each per night would consume 9,300 minutes before builds or releases.

A proposed future-cycle budget is at most 80 routine hosted minutes per day plus 500 minutes reserved for releases, or 2,980 minutes over 31 days. This is an allocation to test, not a forecast. October's allowance is already consumed. Full nightly suites may need Cirujano, local scheduled execution or a lower cadence to meet such a target; each has reliability and cost trade-offs.

The $450 account cap permits substantial spending after the allowance. A lower owner-approved cap is a separate containment decision. A $0 hard stop can also stop hosted release gates once included minutes are exhausted; a small nonzero reserve trades strict zero spend for release availability. GitHub budgets act on billable usage after discounts and credits. [Budgets and alerts](https://docs.github.com/en/billing/concepts/budgets-and-alerts), retrieved 2026-10-02.

Evidence that could reverse or narrow the recommendation includes: release events dominating a longer sample, local suites failing to reproduce remote results, unacceptable nightly detection delays, or provider costs exceeding hosted savings. The current cohort does not separate all closed release PRs from ordinary PRs because run responses omit some PR associations. No numeric savings promise is justified from it.

## Findings and handoff

| ID | Finding | Disposition |
| --- | --- | --- |
| C1 | Included allowance consumed; current spending cap is $450 | Confirmed; owner decision needed for a new cap |
| C2 | Most identified hosted time is attached to push/PR events | Confirmed; prioritize A, B and C, then D and E |
| C3 | Two enrollment records no longer match A's live hosted workflow | Confirmed; reconcile records and runner reliability in later authorized work |
| C4 | Cache-only optimizer cannot change cadence | Confirmed; implement reviewed workflow policy separately before extending automation |
| C5 | Per-head coverage reporting conflicts with nightly-only coverage | Confirmed; reporting semantics and producers need coordinated changes |
| C6 | Development and release required checks differ across repositories | Confirmed; migrate workflow and rule contracts together while retaining release gates |
| C7 | Current net fleet savings and precise future savings are unmeasured | Open evidence gap; collect fresh provider accounting and post-change billing |

Completed: read-only inventory, all-attempt job collection, signed-in billing and budget readback, nine workflow blob captures checked against local files, top-three legacy/effective branch-rule inspection, source review and local artifact consistency checks. These validate the assessment inputs, not a proposed implementation. No application tests or remote validation runs were requested or executed.

Next step: a repository-specific implementation plan for the proposed cadence, reporting compatibility and rule migration, starting with A/B/C. Before implementation, revalidate branch heads and workflows, enumerate release/deployment triggers and trusted/untrusted callers, and define measurable acceptance for event routing, check outcomes, coverage provenance and minute budgets. Before external activation, prepare and verify the complete local changes. Pushes, rule changes, budget changes and any paid runner work need their respective owner authorization.

No changes were made to workflows, controllers, registry, budgets, rulesets or production. This assessment remains local; the public artifact contains no private repository names or billing screenshots.
