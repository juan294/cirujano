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
