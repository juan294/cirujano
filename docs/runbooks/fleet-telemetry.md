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
| Standard log | `~/Library/Logs/cirujano/telemetry.log` |
| Error log | `~/Library/Logs/cirujano/telemetry-error.log` |

The wrapper accepts `CIRUJANO_TELEMETRY_OWNER`,
`CIRUJANO_TELEMETRY_STORE`, `CIRUJANO_TELEMETRY_SINCE`, and
`CIRUJANO_TELEMETRY_LOOKBACK_HOURS`. The defaults use the current `gh` account,
the paths above, a start date of 2026-09-13, and a 48-hour overlap.

## Fleet boundaries

The collector is read-only and may retain baseline records for every discovered
repository. Migration is a separate write operation. Chapa, Chapa CLI, Spoken
Letter, Spoken Letter Alexa and their uptime repositories are excluded from
migration and all GitHub writes while their code freezes remain active. The
same exclusion applies to `frivas/contribution-dashboard`,
`behboud/opencode-rpi` and `juan294/home-network` until the owner changes it.

## Fleet registry and enrollment records

Migration evidence lives in a private, owner-only registry
(`~/.local/share/cirujano/telemetry/fleet-registry.json`, mode `0600`) that
names real repositories and therefore never enters this repository. The
schema, validator and a placeholder fixture
(`packages/cli/fixtures/fleet-registry.example.json`) are tracked. Every
`fleet` command is read-only against GitHub: it reads the default branch head,
the workflow's git blob SHA and the job's literal `runs-on`, and writes only
the local registry.

```bash
cirujano fleet init --registry ~/.local/share/cirujano/telemetry/fleet-registry.json --owner "$(gh api user --jq .login)"
cirujano fleet enroll --registry <registry> --repository <owner/name> --workflow .github/workflows/ci.yml --job <job key>
cirujano fleet cutover --registry <registry> --id P1 --commit <merged 40-character sha>
cirujano fleet verify --registry <registry>
cirujano fleet show --registry <registry>
cirujano telemetry report --store <store> --since 2026-09-13 --registry <registry>
```

- `init` writes the locked exclusions from the fleet telemetry plan. The
  validator refuses a registry that omits any of them or that enrolls an
  excluded repository or a frozen product's `-cli`, `-alexa` or `-upptime`
  companion.
- `enroll` records `before`: the commit, blob SHA and hosted `runs-on` at the
  default branch head. It refuses public repositories, jobs that already run
  self-hosted, matrix or expression `runs-on` values, and jobs priced under a
  SKU other than `--sku` (default `actions_linux`, whose enrolled label is
  `cirujano-baseline-actions_linux`). Pass `--job-name` once per display name
  when the YAML job name differs from the key or expands a matrix.
- `cutover` records `after` only when the merged commit is on the default
  branch and the job's `runs-on` contains `self-hosted` and the enrolled
  label. The record's `recordedAt` is the split point the report uses.
- `verify` re-reads every enrollment. A pre-cutover workflow edit refreshes
  `before` with a note. After cutover, an unrelated edit that keeps the label
  exits 1 and leaves the record for review; a workflow that lost the label is
  recorded as `reverted`, never silently, and also exits 1.
- `telemetry report --registry` adds `enrollments[]` to the JSON and an
  "Enrollments" table to the Markdown: hosted jobs, minutes and list cost
  before the cutover; hosted stragglers, Cirujano jobs, minutes, gross avoided
  cost and queue latency (job start minus run creation, p50 and p95) after it.
  Without `--registry` the output is unchanged.

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
  runner whose name starts with `cirujano-` and carries an enrolled baseline SKU
  label such as `cirujano-baseline-actions_linux`. A queued or cancelled job
  with only a Cirujano target label receives no savings credit.
- `Jobs with unknown price` preserves jobs whose runner labels cannot establish
  a hosted platform. Investigate this count before publishing a cost claim.
- `Other self-hosted jobs` are visible but receive no Cirujano savings credit.
- `Jobs not run` preserves skipped and pre-start cancellations at zero minutes.
  `Jobs with incomplete timing` stays unpriced until GitHub supplies both
  timestamps.
- `Success rate` is successful jobs divided by recorded execution attempts;
  jobs that never started are excluded.

AWS is not part of the first deployment. Add a remote collector only if launchd
freshness failures exceed the 48-hour recovery window.
