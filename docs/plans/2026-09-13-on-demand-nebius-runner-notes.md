# On-demand Nebius runner implementation notes

## Deviations

### Live R14 could not start

- Plan said: run the authorized live provider matrix after local preparation.
- Found: the authenticated Nebius tenant and every listed regional project
  reported `suspension_state: SUSPENDED`; inventory showed zero VMs.
- Chose: stop before resource, runner, workflow or dispatch mutation and record
  every live R14 row as `not-run`.
- Why: the plan forbids project or region fallback and requires real provider
  evidence. A suspended tenant cannot produce valid watchdog, lifecycle,
  workload or cleanup evidence.

### Nebius CLI command shape

- Plan said: isolate provider commands behind the Nebius CLI adapter.
- Found: the installed CLI exposes `compute instance`, limits list page size to
  999 and returns `{}` for an empty inventory.
- Chose: use the installed command shape and parse its empty response strictly.
- Why: this is a routine provider-interface correction and preserves the
  planned adapter boundary and ownership rules.

### First live provider-contract failure

- Plan said: prove the real provider contract before watchdog certification or
  workload admission, then stop and recover if that contract fails.
- Found: the current GitHub jobs API uses zero and empty-string sentinels for an
  unassigned queued job; a valid `ssh-keygen` Ed25519 host key can have an
  exactly aligned private block with no padding; and the current Nebius CLI
  returns a plain async operation ID, an `operations` collection, string-encoded
  disk size and CIDR-suffixed addresses.
- Chose: fail closed, cancel the single queued fixture dispatch, delete the
  stopped VM and disk, verify empty instance/disk/allocation inventories, then
  repair the parsers locally against the captured shapes.
- Why: the live contract contradicted the prepared fixtures. No start,
  registration or workload execution was safe until the parser boundary was
  corrected. The plan requires a new authorization before another live attempt.

### Second live fixture failure

- Plan said: run the same deterministic workload twice on hosted Linux and
  twice on the Nebius runner at one exact fixture commit.
- Found: the first hosted dispatch failed in `pnpm/action-setup` before the
  workload because the workflow requested pnpm 11.22.0 while the fixture
  commit pinned pnpm 10.29.2 in `packageManager`.
- Chose: stop the remaining three dispatches, keep Nebius empty, remove the
  workflow's duplicate pnpm version and verify the installed pnpm against the
  exact fixture commit's `packageManager`. Add a fixture-repository regression
  test for this contract.
- Why: the fixed fixture commit is the source of truth for its package manager.
  A second version in the workflow can drift and fails before any pilot
  assertion. The failed dispatch consumes the approved four-dispatch attempt;
  publishing the repaired fixture and starting another attempt need fresh
  authorization.

### Third live stopped-VM start failure

- Plan said: run two hosted baselines, then use the first queued self-hosted
  workload to trigger the attended first-boot scenario.
- Found: both hosted workloads passed at the exact fixture commit. The
  controller then created one correctly shaped stopped VM, reserved generation
  one during creation, and rejected the subsequent start because the one-start
  permit appeared exhausted. The VM never entered a running state.
- Chose: stop the controller, cancel the queued self-hosted workload, delete the
  exact owned stopped VM and managed disk, and verify empty instance, disk and
  allocation inventories. Keep the second self-hosted dispatch unused.
- Why: creating a stopped resource is not a running interval. Start accounting
  now advances only when `start-vm` is journaled, while the create intent keeps
  a separately validated reservation for the next generation. R14 requires a
  fresh candidate-bound authorization before another live attempt.

### Fourth live regional quota failure

- Plan said: start the exact owned VM only after the provider contract passed.
- Found: the selected `eu-north1` project had a zero non-GPU vCPU allowance,
  while the same tenant had an active `eu-west1` allowance and project.
- Chose: cancel the queued workload, remove the stopped VM and disk, repair the
  omitted protobuf-boolean parser case and bind the next proposal to `eu-west1`.
- Why: region fallback was outside the receipt, and provider payloads must parse
  before recovery can rely on ownership readback.

### Fifth live bootstrap-order failure

- Plan said: arm the five-minute watchdog grant before disconnecting the
  controller, and admit no workload until the watchdog-only stop passed.
- Found: both hosted baselines passed and first-boot recovery passed, but the
  watchdog VM kept SSH closed for more than eleven minutes. Cloud-init processed
  `package_update` and `packages` before `runcmd`, which contained the watchdog
  installation and SSH restart. The five-minute grant expired before arming.
- Chose: cancel the still-queued self-hosted run, leave the fourth dispatch
  unused, stop and delete the exact VM and disk, and verify empty R5 instance,
  disk and allocation inventories. Move package provisioning behind a
  safety-only bootstrap that installs the watchdog helpers and opens SSH first.
- Why: widening or replacing the expired receipt would hide a required R14
  failure. The corrected ordering preserves single-slot scope and requires a
  fresh candidate-bound authorization for the next live attempt.
