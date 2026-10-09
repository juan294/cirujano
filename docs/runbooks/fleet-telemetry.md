# Fleet telemetry runbook

## Purpose

The collector keeps daily evidence for the 45-day measurement window that began
on 2026-09-13. It discovers active repositories owned by the authenticated
GitHub account, records completed workflow jobs, and produces a cumulative
report. The report includes every discovered active repository, including
projects with no Actions jobs in the window, followed by per-project usage and
cost figures. Raw data stays outside this public repository.

The report counts actual GitHub-hosted list cost and the hosted cost that a job
assigned to a Cirujano runner would otherwise have incurred. That second value
is gross avoided cost. It becomes net savings only after subtracting the
candidate-bound Nebius cost recorded by the runner controller.

## Install and schedule

```bash
./scripts/install-telemetry-agent.sh
```

The installer builds and copies a stable CLI bundle under
`~/.local/lib/cirujano/telemetry`, writes
`~/Library/LaunchAgents/com.thecreativetoken.cirujano-telemetry.plist`, loads one
launch agent, and waits up to 20 minutes for a verified first collection. The
job runs again daily at 06:10 local time and at login. It uses the existing `gh`
authentication; no GitHub token is copied into the plist or data files.
Telemetry directories use mode `0700`, log and snapshot files use mode `0600`,
and successful collection output does not list repository names.

The default locations are:

| Artifact | Path |
| --- | --- |
| Daily snapshots | `~/.local/share/cirujano/telemetry/YYYY-MM-DD.json` |
| Cumulative report | `~/.local/share/cirujano/telemetry/latest.md` |
| Fleet report (with a registry) | `~/.local/share/cirujano/telemetry/fleet-latest.md` |
| Standard log | `~/Library/Logs/cirujano/telemetry.log` |
| Error log | `~/Library/Logs/cirujano/telemetry-error.log` |

The wrapper accepts `CIRUJANO_TELEMETRY_OWNER`,
`CIRUJANO_TELEMETRY_STORE`, `CIRUJANO_TELEMETRY_SINCE`,
`CIRUJANO_TELEMETRY_LOOKBACK_HOURS`, and `CIRUJANO_FLEET_REGISTRY`. The defaults
use the current `gh` account, the paths above, a start date of 2026-09-13, a
48-hour overlap, and the registry at `fleet-registry.json` in the store. When
that registry exists, or `CIRUJANO_FLEET_REGISTRY` names one, the wrapper also
writes the fleet report; a `CIRUJANO_FLEET_REGISTRY` that names a missing file
fails every run after `latest.md` is written. A failed report exits non-zero, and the error log names
the conflicting job key and the fields that differ.

Collection is all or nothing: one failed GitHub read fails the day's snapshot.
Each read is therefore retried twice, after 2 and 8 seconds, when the failure is
transient (a timeout, a dropped or reset connection, a 5xx response, or truncated
output). Authorization and not-found errors fail at once. The timeout covers a
whole paginated read, and a retry starts again from page 1, so it is 2 minutes for
the first attempt and 4 minutes for each retry. The wrapper's owner lookup retries
the same way; setting `CIRUJANO_TELEMETRY_OWNER` skips it. A read that still fails
is logged with its endpoint and attempt count.

A job seen in several snapshots must match in every field. Two drifts are
accepted. A retry's `createdAt` can be corrected to the attempt's own time. A
repository whose visibility changed reprices its old jobs (`visibility` and the
two cost fields); the report keeps the earliest observation, which records the
visibility the job ran under.

GitHub lists runs by the workflow run's original creation time. A retry of an
older run can fall outside that overlap even when its jobs ran today. The
collector reads every attempt of each listed run and uses the attempt's own
creation time. GitHub can copy prior jobs into a retry with new job IDs; the
collector excludes jobs whose recorded start or completion preceded the retry.
For older retries, keep separately fetched, validated evidence in a private
`backfill-YYYY-MM-DD.json` snapshot beside the daily files. The
report includes backfill snapshots, but they do not establish daily coverage or
replace the daily snapshot used for collection reuse. Preserve the original
daily files and the GitHub attempt/job responses used for a backfill.

## Fleet boundaries

The collector is read-only and may retain baseline records for every discovered
repository. Migration is a separate write operation. The owner lifted the
Chapa and Spoken Letter code freezes on 2026-09-26. New registries no longer
lock those products or their companion repositories out of enrollment. Existing
registries keep their explicit exclusions until edited locally. Enrollment
still refuses public repositories: Chapa's standard hosted minutes cost $0 at
GitHub and moving them to Nebius would add provider cost. The named exclusions
for `frivas/contribution-dashboard`, `behboud/opencode-rpi` and
`juan294/home-network` remain locked until the owner changes them.

## Fleet registry and enrollment records

Migration evidence lives in a private, owner-only registry
(`~/.local/share/cirujano/telemetry/fleet-registry.json`, mode `0600`) that
names real repositories and therefore never enters this repository. The
schema, validator and a placeholder fixture
(`packages/cli/fixtures/fleet-registry.example.json`) are tracked. Every
`fleet` command is read-only against GitHub: it reads the enrollment branch head,
the workflow's git blob SHA and the job's literal `runs-on`, and writes only
the local registry.

```bash
cirujano fleet init --registry ~/.local/share/cirujano/telemetry/fleet-registry.json --owner "$(gh api user --jq .login)"
cirujano fleet enroll --registry <registry> --repository <owner/name> --workflow .github/workflows/ci.yml --job <job key>
cirujano fleet enroll --registry <registry> --repository <owner/name> --workflow .github/workflows/ci.yml --job <job key> --branch develop
cirujano fleet cutover --registry <registry> --id P1 --commit <merged 40-character sha>
cirujano fleet verify --registry <registry>
cirujano fleet show --registry <registry>
cirujano telemetry report --store <store> --since 2026-09-13 --registry <registry>
```

- `init` writes the remaining named exclusions from the fleet telemetry plan.
  The validator refuses a registry that omits any of them or that enrolls an
  explicitly excluded repository. It does not remove entries from a registry
  created while the product freezes were active.
- `enroll` records `before`: the commit, blob SHA and hosted `runs-on` at the
  default branch head, or at `--branch` when a repository uses a separate
  integration branch. The optional target branch is stored on that enrollment;
  existing records continue to use the repository's default branch. It
  refuses public repositories, jobs that already run self-hosted, matrix or
  expression `runs-on` values, and jobs priced under a SKU other than `--sku`
  (default `actions_linux`, whose enrolled label is
  `cirujano-baseline-actions_linux`). Pass `--job-name` once per display name
  when the YAML job name differs from the key or expands a matrix.
  A second active enrollment in the same repository receives its own label,
  such as `cirujano-p7-actions_linux`. The registry rejects two active
  enrollments in one repository with the same label.
- `cutover` records `after` only when the merged commit is on the enrollment
  branch and the job's `runs-on` contains `self-hosted` and the enrolled
  label. The record's `recordedAt` is the split point the report uses.
- `verify` re-reads every enrollment. A pre-cutover workflow edit refreshes
  `before` with a note. After cutover, an unrelated edit that keeps the label
  exits 1 and leaves the record for review. After reviewing an intended edit,
  run `fleet cutover --commit <current enrollment-branch SHA>` again to record the
  new blob; the original cutover time remains the reporting split point and a
  note records the previous blob. A workflow that lost the label is recorded as
  `reverted`, never silently, and also exits 1.
- `telemetry report --registry` adds `enrollments[]` to the JSON and an
  "Enrollments" table to the Markdown: hosted jobs, minutes and list cost
  before the cutover; hosted stragglers, Cirujano jobs, minutes, gross avoided
  cost and queue latency (job start minus attempt creation, p50 and p95) after it.
  Without `--registry` the output is unchanged.

## Net savings and the 45-day report

With `--registry`, the report joins each cut-over enrollment to its controller
journals (`config.json`, `controller-state.json`, `accounting-state.json`,
`assignments.json` under the enrollment's state directory). Every journal must
carry the enrollment's controller identity. Per enrollment the JSON gains
`nebiusComputeUsd`, `nebiusDiskUsd`, `nebiusNetworkUsd`, `nebiusTotalUsd`
(controller runtime, retained boot disk and observed egress at the dated
config rates, on the same 30-day-month basis the permit accounting uses),
`netSavingsUsd = grossHostedCostAvoidedUsd - nebiusTotalUsd`, `vmStarts`,
`assignments` (runner id and name per Cirujano job, matched against
`assignments.json`) and `unmatchedCirujanoJobs`. A credited job that no
controller journal assigned marks the enrollment `complete: false` with the
reason; so does a cut-over enrollment whose journals are absent. `fleet`
totals sum the cut-over enrollments and are `complete` only when every one is.

Produce the 45-day report on 2026-10-28 (or on demand for the submission):

```bash
STORE=~/.local/share/cirujano/telemetry
cirujano telemetry report --store "$STORE" --since 2026-09-13 --registry "$STORE/fleet-registry.json" --format markdown > "$STORE/fleet-latest.md"
cirujano fleet publish --registry "$STORE/fleet-registry.json" --store "$STORE" --since 2026-09-13 \
  --output "$PWD/docs/research/2026-10-28-fleet-migration-net-savings.md"
```

The private Markdown keeps repository names and belongs in the store. `fleet
publish` renders the publishable version: fleet-wide usage, one row per
enrollment keyed by its P-handle (status, before/after windows, queue latency,
VM starts, Nebius cost, net savings, completeness), the fleet totals line and
the limits paragraph. It refuses to write if the output contains any
enrollment or exclusion repository name, the owner prefix, a controller id,
resource prefix or state path, or a Nebius resource id, so a renderer change
cannot leak a private name (matching is case-insensitive and also catches a
bare repository name). With a registry the report is bounded by its
`measurementWindow.through`, so a report produced after 2026-10-28 stops
there. Read the first real net-savings figure and the
limits paragraph before quoting either; a public-repository enrollment shows
zero gross avoided cost and negative net savings by construction.

## Verify freshness

```bash
launchctl print "gui/$(id -u)/com.thecreativetoken.cirujano-telemetry"
tail -50 "$HOME/Library/Logs/cirujano/telemetry-error.log"
test -s "$HOME/.local/share/cirujano/telemetry/latest.md"
find "$HOME/.local/share/cirujano/telemetry" -name '????-??-??.json' -mtime -2 -print
```

A healthy completed launch has `state = not running` and `last exit code = 0`.
The latest report must be readable and a snapshot must be newer than two days.
The 48-hour overlap recovers one missed daily run. Each collection reuses
conclusive completed runs from the latest prior snapshot, including runs with
zero jobs. Runs with incomplete job timing are fetched again, and stable job
identities prevent double counting.

## Interpret the report

- `GitHub-hosted list cost` uses dated public list prices. Private-account
  allowances and discounts are not subtracted.
- `Gross hosted cost avoided` includes only jobs that actually acquired a
  runner whose name starts with `cirujano-` and carries a supported Linux SKU
  label, either `cirujano-baseline-actions_linux` or an enrollment-owned label
  such as `cirujano-p7-actions_linux`. A queued or cancelled job
  with only a Cirujano target label receives no savings credit.
- `Jobs with unknown price` preserves jobs whose runner labels cannot establish
  a hosted platform. Investigate this count before publishing a cost claim.
- `Other self-hosted jobs` are visible but receive no Cirujano savings credit.
- `Jobs not run` preserves skipped and pre-start cancellations at zero minutes.
  `Jobs with incomplete timing` stays unpriced until GitHub supplies both
  timestamps and a conclusion.
- `Success rate` is successful jobs divided by recorded execution attempts;
  jobs that never started are excluded.

AWS is not part of the first deployment. Add a remote collector only if launchd
freshness failures exceed the 48-hour recovery window.
