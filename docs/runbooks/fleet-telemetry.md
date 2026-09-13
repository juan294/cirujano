# Fleet telemetry runbook

## Purpose

The collector keeps daily evidence for the 45-day measurement window that began
on 2026-09-13. It discovers active repositories owned by the authenticated
GitHub account, records completed workflow jobs, and produces a cumulative
report. Raw data stays outside this public repository.

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

## Verify freshness

```bash
launchctl print "gui/$(id -u)/com.thecreativetoken.cirujano-telemetry"
tail -50 "$HOME/Library/Logs/cirujano/telemetry-error.log"
test -s "$HOME/.local/share/cirujano/telemetry/latest.md"
find "$HOME/.local/share/cirujano/telemetry" -name '????-??-??.json' -mtime -2 -print
```

A healthy completed launch has `state = not running` and `last exit code = 0`.
The latest report must be readable and a snapshot must be newer than two days.
The 48-hour overlap recovers one missed daily run, and stable job identities
prevent double counting.

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
