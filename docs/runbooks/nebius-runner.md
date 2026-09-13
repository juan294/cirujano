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
export CIRUJANO_ACTIONS_RUNNER_VERSION=2.328.0
export CIRUJANO_ACTIONS_RUNNER_SHA256=<verified-linux-x64-archive-sha256>
export CIRUJANO_NETWORK_EGRESS_LIMIT_GIB=<owner-approved-conservative-bound>
export CIRUJANO_CANDIDATE_DIGEST="$(shasum -a 256 packages/cli/dist/bin.js | awk '{print $1}')"
```

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
During first boot, stop via the separately observed Nebius API if watchdog
readiness is absent after ten minutes. Record all provider state and cleanup
readbacks under `.cirujano/runner/`; sanitize only the final report intended for
the repository.
