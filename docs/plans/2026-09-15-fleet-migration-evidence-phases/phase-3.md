# Phase 3: first cutover (P1), then P2 and P3 as repeats

Parent: [plan](../2026-09-15-fleet-migration-evidence.md). Entry: phase 2
accepted; the target repository's default branch green; the registry holds the
enrollment as `proposed`.

## Steps per enrollment

1. `fleet controller-config <id>` writes the state directory, config and host
   key; `runner inspect` prints the identity.
2. Owner issues the operating permit (`buildOperatingPermitProposal` output,
   owner-confirmed in session, written as `permit.json` mode 0600).
3. Workflow edit in the target repository, on a branch, changing only the
   enrolled job's `runs-on` to
   `[self-hosted, linux, x64, cirujano-baseline-actions_linux]`; the pull
   request body names the enrollment id and the before blob SHA. The owner
   merges it (the only GitHub write; no other workflow line changes).
4. `fleet cutover <id> --commit <merged sha>` records `after`.
5. `install-runner-agent.sh <id>` loads the launchd controller; verify one
   tick, then let it run.
6. First real job: confirm in the telemetry snapshot of the next day that the
   job carries the enrolled label and a `cirujano-` runner name; confirm the
   controller journal shows create/start/register/drain/stop and the
   accounting advanced.
7. `fleet verify` and `telemetry report --registry` show the enrollment row
   with after-window jobs and queue latency.

## Order and caveats

- P1 first: single job, about 11.5 hosted minutes, human-triggered.
- P2 second: two single-run jobs on the same workflow; both enrolled so a run
  serializes them (about 11 minutes total) on one VM.
- P3 third: four coverage shards serialize to about 22 minutes; the owner
  accepts or declines this one after seeing P1 and P2 latency in the report.

## Acceptance (per enrollment)

Automated: registry `verify` green; the next daily telemetry snapshot contains
at least one job with the enrolled label and a `cirujano-` runner name; the
controller journal for the enrollment shows a full lifecycle; no `blocked`
decision persists for more than one poll interval without a recorded reason.
Manual: the owner merged the workflow edit, issued the permit and approved the
agent. External state: one workflow edit per repository; Nebius resources under
D3.

## Exit

Record the enrollment id, merged commit, before/after blob SHAs (private
record), first job identities, and the controller state directory in the
private `docs/agents/fleet-migration-targets.md`; stop for acceptance before the
next enrollment.
