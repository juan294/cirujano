# Nebius runner pilot evidence

Date: 2026-09-13
Status: blocked before live resource creation

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
and 302 tests across all packages. These are local preparation checks. They do
not count as R14: all nine live R14 rows remain
`not-run`, with zero live passes, because the authenticated Nebius tenant is
suspended.

No VM, disk, public IP, GitHub runner registration, GitHub workflow publication
or workflow dispatch was created during this attempt. The prepared fixture now
includes a materialized `workflow_dispatch` workflow for later publication to
`.github/workflows/runner-pilot.yml` under an approved live scope. Provider
inventory readback returned zero VM instances before the live boundary.

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

Read-only CLI calls authenticated successfully, but the tenant and every listed
regional project reported `suspension_state: SUSPENDED`. Browser automation was
also attempted after the CLI path and could not attach to the Nebius console.
The plan forbids an automatic project or region fallback. Resource creation,
watchdog certification, workload dispatch, sequential isolation, idle stop and
cleanup evidence therefore did not run.

R14 remains failed, with all nine rows `not-run`. Activating the existing Nebius
tenant is the required external state change. After activation, rerun the exact
read-only preflight, bind the permit to the then-current config and candidate
hashes, and execute the four-dispatch harness once. Any failed live attempt
requires a new authorized receipt before another dispatch or replacement.
