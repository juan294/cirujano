# Nebius runner pilot runbook

The pilot controller runs in the foreground on one macOS host. Keep that host
awake and keep a second terminal available for provider readback and emergency
stop during the attended first boot. Do not install it as a background service.

Store the validated configuration, permit, journal and event log under the
ignored `.cirujano/runner/` directory. The directory must have mode `0700`; its
files must have mode `0600`. Inspect the intended identity and quote before any
watch command:

The controller requires these absolute local paths and pinned build inputs:

```sh
export CIRUJANO_GH_PATH=/opt/homebrew/bin/gh
export CIRUJANO_NEBIUS_PATH="$HOME/.nebius/bin/nebius"
export CIRUJANO_SSH_PATH=/usr/bin/ssh
export CIRUJANO_SSH_KEY_PATH="$PWD/.cirujano/runner/controller_ed25519"
export CIRUJANO_GUEST_DIR="$PWD/packages/runner/guest"
export CIRUJANO_HOST_PRIVATE_KEY_PATH="$PWD/.cirujano/runner/ssh_host_ed25519_key"
export CIRUJANO_LOGIN_PUBLIC_KEY_PATH="$PWD/.cirujano/runner/controller_ed25519.pub"
export CIRUJANO_ACTIONS_RUNNER_VERSION=2.337.0
export CIRUJANO_ACTIONS_RUNNER_SHA256=<verified-linux-x64-archive-sha256>
export CIRUJANO_NETWORK_EGRESS_LIMIT_GIB=<owner-approved-conservative-bound>
export CIRUJANO_CANDIDATE_DIGEST="$(shasum -a 256 packages/cli/dist/bin.js | awk '{print $1}')"
```

GitHub refuses messages to runner versions it has deprecated, and the guest
registers with `--disableupdate`, so a stale pin registers a runner that stays
offline. Before each live attempt compare the pinned version with the latest
`actions/runner` release and take the SHA-256 from that release's notes,
verified against the downloaded archive.

Create the controller login key and a separate per-VM Ed25519 host-key pair
before rendering cloud-init. The public half of the host key and its SHA-256
fingerprint belong in `config.json`; the login public key authorizes the
`runner` account. Set `.cirujano/runner/` to `0700`, private keys and JSON state
to `0600`, and public keys to `0644`. Do not put GitHub or Nebius credentials,
registration tokens, or cloud-init user data in the config, permit, journal,
events, or command arguments. Authenticate `gh` and the named Nebius profile
through their normal private credential stores before starting the controller.

```sh
cirujano runner inspect --config .cirujano/runner/config.json --format json
cirujano runner watch --config .cirujano/runner/config.json --dry-run
```

A mutating watch requires the owner-approved permit bound to the exact config
hash and candidate digest. Start it in the foreground and retain its JSONL
output. On SIGINT, wait for the bounded drain result and inspect any unresolved
resource identities before closing the recovery terminal.

The permit must repeat the `identity` object printed by `runner inspect`,
including `configHash` and `candidateDigest`. It must also name the exact
repository ID, Nebius project ID, controller ID, resource prefix, permitted
operations, expiry, start count, runtime ceiling and total cost ceiling. Refresh
the dated compute, 80 GiB disk, network-egress and hosted-runner rates in the
config before approval. A changed bundle, config or quote requires a new permit.

```sh
cirujano runner watch --config .cirujano/runner/config.json \
  --permit .cirujano/runner/permit.json
```

Use `runner stop` to drain an owned listener and stop its owned VM. Use cleanup
only after quiescence and only with a permit that includes delete recovery. It
must remove the journaled runner, VM, managed disk and task-owned IP and then
record absence readbacks. Never delete the project, subnet, SSH keys, shared
network objects or unrelated runners.

```sh
cirujano runner stop --config .cirujano/runner/config.json \
  --permit .cirujano/runner/permit.json
cirujano runner cleanup --config .cirujano/runner/config.json \
  --permit .cirujano/runner/permit.json
cirujano runner report --state .cirujano/runner/report-input.json --format json
```

If the controller exits after journaling an intent, restart it with the same
config, permit and state directory. It reconciles the recorded operation and
owned resource before another mutation. Do not erase the journal or change the
resource prefix. An expired retained guest grant powers off and cannot be
rearmed; delete that owned VM under recovery authority and create a fresh
generation. Provider or GitHub read failure blocks starts and ordinary stops.

The private state directory contains:

- `controller-state.json`: lifecycle state, pending mutation and bounded provider readbacks.
- `accounting-state.json`: monotonic runtime, retained-disk interval and observed network egress.
- `active-job-state.json`: a remembered active assignment until runner and guest readbacks prove it idle.
- `direct-action-state.json`: intent, emission and terminal readback for `stop`, `cleanup` and SIGINT recovery.
- `events.jsonl`: redacted controller decisions and effect outcomes.
- `helper-diagnostics.jsonl`: bounded, redacted stderr and stdout tails for guest
  helper and fatal SSH failures (transient boot refusals stay in the journal readbacks).
- `known_hosts`: the exact controller-generated VM host key for the current IP.
- `.controller.sock`: the local single-controller lock, removed on clean exit.

After an interrupted `stop` or `cleanup`, inspect `direct-action-state.json`.
Restart the same command with the same permit and paths. An `intent` stage means
provider I/O was not confirmed; an `emitting` stage requires provider
reconciliation before another mutation; `resolved` includes the terminal
`stopped` or `absent` readback. Keep the state files when provider authentication,
rate limiting, SSH identity, guest status or operation polling fails. Repair the
read path and rerun the same command. Never delete state to bypass reconciliation.

Before a live workload, prove the watchdog-only stop and `Stopped` readback.
Cloud-init must install and start the watchdog helpers and restart the pinned SSH
listener before package installation. Keep slow package and runner provisioning
after that control path so the controller can arm the immutable grant while the
guest is still booting.
During first boot, stop via the separately observed Nebius API if watchdog
readiness is absent after ten minutes. Record all provider state and cleanup
readbacks under `.cirujano/runner/`; sanitize only the final report intended for
the repository.

## Operating controllers for enrolled repositories

The pilot ran attended in the foreground. Enrolled repositories (fleet
migration plan, 2026-09-15) run one unattended launchd controller per
enrollment on the owner's Mac, each with its own state directory, host key,
config and operating permit. Jobs that target Cirujano wait while the Mac
sleeps; GitHub fails a job queued for a self-hosted runner after 24 hours, so
the report's queue-latency column is the evidence for moving to an always-on
controller host.

Per-enrollment layout under `~/.local/share/cirujano/runner/` (mode `0700`):

- `controller_ed25519[.pub]`: the shared controller login key, generated by the
  installer when absent.
- `<P#>/config.json`: written by `cirujano fleet controller-config`. Plan D5
  and D6: `cpu-d3` `4vcpu-16gb`, 80 GiB `network-ssd`, label
  `cirujano-baseline-actions_linux`, `lifetimeMs` 4 h, `maxJobMs` 60 min,
  `shutdownMarginMs` 5 min, `idleGraceMs` 5 min, `pollIntervalMs` 30 s, the
  enrollment's repository id, workflow id and job names, and
  `admission: same-repository`: unlike the pilot's default-branch-push rule,
  an enrolled controller also serves `pull_request` runs and pushes on any
  branch, provided the head repository is the enrolled private repository
  itself. Fork heads are never admitted. Regenerating a config changes its
  hash; the controller then refuses the old journals, so archive a dry-run
  state directory before restarting and never regenerate under a live permit.
- `<P#>/ssh_host_ed25519_key[.pub]`: the per-enrollment VM host key.
- `<P#>/actions-runner.env`: the pinned Actions runner version and SHA-256.
- `<P#>/permit-proposal.json` and `permit.draft.json`: unapproved output of
  `cirujano fleet permit-proposal`.
- `<P#>/permit.json`: the owner-issued operating permit (mode `0600`).
- The journals the controller already writes (`controller-state.json`,
  `accounting-state.json`, `assignments.json`, `events.jsonl`, ...).

```sh
REGISTRY=~/.local/share/cirujano/telemetry/fleet-registry.json
cirujano fleet controller-config --registry "$REGISTRY" --id P1 \
  --state-root ~/.local/share/cirujano/runner --template <pilot config.json>
./scripts/install-runner-agent.sh P1            # dry-run smoke: no permit yet
cirujano fleet permit-proposal --registry "$REGISTRY" --id P1 \
  --candidate-digest "$(shasum -a 256 ~/.local/lib/cirujano/runner/cirujano.mjs | awk '{print $1}')" \
  --quote <quote.json>
```

The template supplies the Nebius project, subnet, image and dated rates; the
generator refuses anything but the pilot preset. `permit-proposal` binds the
proposal to the installed bundle digest and the config hash, applies the D3
bounds (expiry `2026-10-28T23:59:59Z`, 600 starts, 150 h, USD 40, fleet
ceiling USD 120 across the other enrollments' `permit.json` files) and refuses
a quote whose conservative maximum exceeds the ceiling. The owner reviews
`permit-proposal.json`, then copies `permit.draft.json` to `permit.json` with
mode `0600` and restarts the agent:

```sh
launchctl kickstart -k "gui/$(id -u)/com.thecreativetoken.cirujano-runner-P1"
```

The CLI hashes the bundle it runs from as its candidate digest (the wrapper
`scripts/run-cirujano-controller.sh` never overrides it), so a rebuilt bundle
no longer matches the permit and the controller fails closed. Without `permit.json` it runs
`--dry-run`, which is the installer's smoke test. Installing a new bundle
changes the shared digest and the installer lists the other agents whose
permits then need reissuing.

Verify freshness:

```sh
launchctl print "gui/$(id -u)/com.thecreativetoken.cirujano-runner-P1"
tail -20 ~/Library/Logs/cirujano/runner-P1.log
tail -5 ~/.local/share/cirujano/runner/P1/events.jsonl
```

A healthy agent shows `state = running` (KeepAlive restarts it after the
bounded poll limit exits) and a recent `decision`, `dry-run` or
`effect-reconciled` event. A `blocked` decision that persists for more than one
poll interval needs its recorded reason resolved; the controller never
retries a mutation on its own.

Expired-generation recovery: when the provider reports the owned VM `stopped`
while the journal believed the guest was up, and the journaled grant deadline
(`grantDeadlineMs`, persisted when the start reconciles) has passed, the
controller treats the stop as the expected end of the immutable lifetime. It
removes the offline runner registration, emits `delete-vm` under the permit's
`delete` authority, reconciles the absence, and creates a fresh generation on
the next eligible demand; start count and accounting continue monotonically.
A stop before the deadline still blocks and stays manual (quarantine or a
provider fault).

Stop and remove an agent:

```sh
./scripts/install-runner-agent.sh P1 --remove   # unloads the agent, keeps the state directory
cirujano runner stop --config ~/.local/share/cirujano/runner/P1/config.json --permit .../P1/permit.json
cirujano runner cleanup --config ~/.local/share/cirujano/runner/P1/config.json --permit .../P1/permit.json
```

Run `stop` and `cleanup` through the installed bundle
(`~/.local/lib/cirujano/runner/cirujano.mjs`) with the wrapper's path
variables (see the script) so the candidate digest matches the permit.
