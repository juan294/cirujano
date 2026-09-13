# Nebius runner pilot evidence

Date: 2026-09-13
Status: third live attempt failed before first boot; cleanup verified Nebius empty

## Candidate and local evidence

The implementation candidate adds the single-slot runner lifecycle, provider
adapters, deterministic cloud-init, guest watchdog and ephemeral registration,
durable controller journal, command surface, evidence report and pilot analyzer.
The precommit preparation tree was based on commit
`36a23e6be67b3722a8aa5cdbc1552d009902b02d`. Excluding this self-referential
report, `.rpi/scripts/rpi-candidate.py` measured 283 candidate files with SHA-256
`4344bbf5cdc31ebedc9eb6da1602a91cbb6f970f725a045fad96af2db76111a3`.
Reproduce that identity by importing the helper and calling `identity(repo,
excluded={report.absolute()})` against the unchanged precommit tree.

The focused local preparation check ran 28 tests in `src/pilot.test.ts`: all 28
passed, including local execution of the two-test deterministic fixture. The
runner package typecheck and focused pilot lint also passed. The combined local
candidate then passed typecheck, lint, build, CLI smoke, Action bundle verification
and 302 tests across all packages.

After the first live provider-contract failure, the repaired candidate passed
the full local policy again: typecheck, lint, build, Action bundle verification
and 307 tests. These local checks do not count as an R14 pass.

The approved private fixture workflow was published at an exact commit that
passed both expected CI workflows. One self-hosted fixture dispatch was queued.
The controller created one stopped VM, then failed closed while parsing the
provider's async operation response. It did not start the VM, register a runner
or execute the workload. Recovery cancelled that dispatch, deleted the VM and
managed disk, and verified empty instance, disk and allocation inventories.

## Read-only preflight

The authenticated project is in `eu-north1`. It has one ready default subnet
with private and public address pools. The selected immutable image is the ready
AMD64 Ubuntu 24.04 driverless image recommended for `cpu-d3`. Private provider
and repository identifiers remain in the ignored `.cirujano/runner/` evidence
directory and are omitted here.

The intended resource remains one regular `cpu-d3` `4vcpu-16gb` VM with one
80 GiB Network SSD disk and recovery policy `FAIL`. Nebius documents `cpu-d3`
as AMD EPYC Genoa and available in `eu-north1`.
[VM types](https://docs.nebius.com/compute/virtual-machines/types)

The dated public rate is USD 0.012 per vCPU-hour plus USD 0.0032 per GiB-hour.
The 4 vCPU and 16 GiB preset therefore costs USD 0.0992 per running hour. The
80 GiB Network SSD costs USD 0.071 per GiB per 730 hours, or about USD 0.0078
per retained hour. Public IP and network ingress/egress are currently listed as
free. The proposal explicitly bounds retained disk and public IP exposure at 24
hours and network egress at 10 GiB. Six compute hours cost USD 0.5952 and 24
retained disk hours cost about USD 0.18674. The conservative total is therefore
about USD 0.78194 before tax and provider rounding, below the proposed USD 5
ceiling. Proposal validation recomputes this total from the dated rates and
bounds, and rejects stale dates, incomplete exposure bounds and inconsistent
caller-supplied totals.
[Compute pricing](https://docs.nebius.com/compute/resources/pricing)
[Public pricing](https://nebius.com/prices)

## Blocking evidence and disposition

After activation, read-only CLI calls confirmed the tenant and selected project
were active. The provider-contract scenario then failed on observed schema
differences: the GitHub queued-job response used zero and empty-string runner
sentinels; the Nebius CLI returned the async operation ID as plain text, used an
`operations` collection, encoded disk size as a string and returned addresses
with CIDR suffixes. A valid generated OpenSSH host key also exposed an incorrect
local assumption that padding is always present.

The local candidate now normalizes those exact captured shapes while retaining
strict identity, state and ownership checks. R14 remains failed: provider
contract failed, cleanup passed, and the seven scenarios between them plus the
final comparison were not run. The cleaned provider state and cancelled job make
another attempt safe, but the plan requires a fresh candidate-bound authorization
before any new dispatch or resource creation.

The next authorized attempt reached hosted fixture setup. Its first dispatch
failed because the workflow duplicated a pnpm version that disagreed with the
exact fixture commit's `packageManager`. No Nebius resources were created and
the other three dispatches were not issued. The local repair removes the
duplicate action input, checks the installed pnpm against the fixture commit,
and adds a repository regression test. The repaired fixture must be published
at a new exact commit and receive another candidate-bound authorization before
R14 can resume.

The third authorized attempt used the repaired published fixture. Its two hosted
dispatches passed the shared workload, including the exact pnpm assertion,
deterministic tests, fixed Docker port and sequential sentinel checks. The first
self-hosted dispatch was queued and caused creation of one correctly identified
stopped VM. The controller then blocked the actual start because it had counted
the create reservation as a completed start under the one-start generation
permit.

The provider never entered a running state, so compute runtime was zero. No guest
booted, no runner registered and no workload began. Raw accounting measured
69.179 seconds of retained disk exposure and an estimated USD 0.000122. Recovery
cancelled the queued dispatch, deleted the stopped VM and managed disk, and live
readbacks returned empty instance, disk and allocation inventories. The second
self-hosted dispatch was not issued.

The local repair separates a create reservation from a running interval:
`startCount` now advances only when `start-vm` is journaled, and controller
invariants require a pending create reservation to name exactly the next start
generation. A regression test covers the live create, stopped readback and first
start sequence under a one-start permit. The repaired tree passed typecheck,
lint, build, bundle verification and 345 tests. The macOS launchd integration
tests remain executable on macOS and are skipped on Linux, where their required
system tools do not exist. This repair changes the candidate, so a fresh bounded
authorization is required before R14 can resume.
