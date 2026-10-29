# Cirujano submission measurements — October 27, 2026

Source release: [v0.1.0](https://github.com/juan294/cirujano/releases/tag/v0.1.0), commit `e958e02501582b3b90afb5b7a2e48d9e080efaf4`. This refresh reads existing GitHub billing and telemetry records. It starts no workflows, model requests, Sandboxes or provider resources. Raw billing, repository metadata and snapshots stay private; this document contains aggregate results only.

## Billing comparison

Fresh authenticated reads of GitHub's [billing usage API](https://docs.github.com/en/rest/billing/usage#get-billing-usage-report-for-a-user) returned July, August and October usage. Repository names in the billing response are normalized to the account's current repository inventory. The same current-private scope is applied to every comparison period. All billing rows match the inventory. Actions minute rows are separated from storage, and decimals are summed before rounding. October 27 is excluded from comparative windows because it is incomplete.

| Window (UTC calendar days, inclusive) | Days | Private Actions minutes | Minutes/day | List cost | List-cost equivalent per 30 days |
| --- | ---: | ---: | ---: | ---: | ---: |
| July–August | 62 | 130,783.971283167 | 2,109.419 | $784.703827699 | $379.695 |
| October 17–23 (previous submission window) | 7 | 5,448 | 778.286 | $32.688 | $140.091 |
| October 20–26 (latest complete seven days) | 7 | 5,830 | 832.857 | $34.980 | $149.914 |
| October 24–26 (recent three-day context) | 3 | 3,337 | 1,112.333 | $20.022 | $200.220 |

The latest complete seven days are **60.517% below the July–August minutes/day baseline**, and about 7.0% above the previous seven-day submission window. The new week is reported even though its result is less favorable. The periods overlap; they are not independent experiments. Workload, repository visibility history and other CI changes differ across periods. Current visibility defines this comparison scope and does not reconstruct historical visibility.

The 30-day figures scale measured daily list cost; they are neither a monthly invoice nor a net-savings result. Public usage, included minutes, discounts, storage and Nebius costs must not be silently combined with them. Separate all-Actions usage sums including storage reproduce the historical July and August billed totals, $370.64 and $401.78. Sutura owns current CI routing; the fleet-wide billing change is not attributed solely to Cirujano.

## Runner evidence

Validated snapshots through **2026-10-27T05:17:42.970Z** contain **880 distinct Cirujano runner jobs**, all with measured timing, **3,660 rounded job-minutes**, across **8 repositories** since September 13. This is an observed count, not a claim of a complete continuous study. The recent continuously covered October 24-to-observation window contains 31 of those jobs and 142 minutes; the earlier 849-job snapshot plus those 31 gives the same 880 total. The separately narrated October 24 demo job must not be added again.

**PARTIAL:** the full v0.1.0 report correctly refused two daily observation gaps:

- October 2 04:17:10.824Z to October 3 04:10:06.524Z.
- October 21 04:15:11.638Z to October 22 04:10:06.972Z.

Backfill snapshots do not establish daily observation coverage. Observed-job aggregation preserves duplicate checks and validated timing completion, but cannot repair that coverage gap or establish complete controller-cost attribution. Complete fleet net savings are **unmeasured**. The $120/month four-slot projection remains a model.

## Controlled optimization evidence

The [recorded public benchmark](https://github.com/juan294/cirujano-push-proof/pull/8) remains the controlled evidence: sampled eligible merge pushes fell from 3 to 1 rounded runner-minute, while PR checks and the direct-push control retained their checks. That is about 67% runner-compute reduction on that workload. Public hosted minutes have no GitHub invoice savings. The historical Sandbox proof is 69 guard cells plus 60 classifier cases, not the larger later local-only matrix.

No new controlled run was launched in this refresh. Release repairs strengthened recovery, accounting and validation; they do not justify claiming a larger optimization effect. A repetition would add evidence of repeatability, not permission to report a better percentage without comparable controls.

## Release verification

The released source passed 1,801 tests with coverage, typecheck, lint, build and bundle checks. Ten offline installed-CLI checks passed. Exact-main [CI 40373845785](https://github.com/juan294/cirujano/actions/runs/40373845785) and [CodeQL 40373845679](https://github.com/juan294/cirujano/actions/runs/40373845679) passed, including the Ubuntu 24.04 boot test. These are verification results, not a new live-provider savings measurement.

## Before the deadline

Use the latest full-week billing result and dated runner count now. After the October 28 study window, refresh existing records again and reconcile the coverage and controller-cost limitations before any complete net-savings claim. The submission deadline remains October 30 at 10:00 PDT (17:00 UTC), per the [official rules](https://nebiusglobalaihackathon.devpost.com/rules). Further billable execution needs explicit bounded authorization; this refresh used existing records only.
