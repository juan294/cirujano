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
export CIRUJANO_NETWORK_EGRESS_LIMIT_GIB=<owner-approved-conservative-bound>
export CIRUJANO_CANDIDATE_DIGEST="$(shasum -a 256 packages/cli/dist/bin.js | awk '{print $1}')"
```

The Actions runner release is machine-owned. `scripts/install-runner-agent.sh`
runs `scripts/resolve-actions-runner-release.mjs`, which reads the latest
`actions/runner` release and the SHA-256 digest GitHub publishes for its
linux-x64 archive, and records both in `actions-runner.env`; the controller
wrapper sources that file and the guest verifies the archive against the digest
before extracting it. Re-run the installer to move to a newer release. GitHub
refuses messages to runner versions it has deprecated, and the guest registers
with `--disableupdate`, so a stale release registers a runner that stays offline.
To pin a release deliberately (or to install offline), export both
`CIRUJANO_ACTIONS_RUNNER_VERSION` (exact version) and
`CIRUJANO_ACTIONS_RUNNER_SHA256` together; the resolver refuses a half pin.
`scripts/render-runner-cloud-init.mjs` resolves the release the same way.

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
- `.controller-lock.sqlite`: the persistent file used for the OS-backed exclusive
  lock, held until the controller releases it or exits. Keep the file in place;
  deleting it can let processes lock different files at the same path.
- `.controller.sock`: compatibility protection against an already-running older
  controller, removed on clean exit.

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

## Routing switch for enrolled jobs

Decision: [ADR 0002](../decisions/0002-runner-routing-switch.md). An enrolled job reaches a Cirujano runner only while the repository variable `CIRUJANO_RUNNER_<P#>` equals `on`. Otherwise it runs on `ubuntu-latest`.

1. `cirujano fleet runs-on --registry "$REGISTRY" --id P#` prints the exact `runs-on:` line for the job. Replace the job's line with it and merge. Then record the cutover with `cirujano fleet cutover`, which refuses any other shape.
2. `cirujano fleet controller-config` copies the switch into the controller's `config.json`. Propose the permit with `cirujano fleet permit-proposal`; operating proposals include `release-routing`.
3. Turn routing on only when the controller runs with that permit: `gh variable set CIRUJANO_RUNNER_P# --body on --repo <owner/repo>`.

Turning routing off:

- **Automatically.** Once the controller can no longer start a runner (permit expired or past its start cutoff, starts, runtime or cost exhausted, repository not private), it deletes the variable and confirms by readback. When no VM of its own is live or being created, it then force-cancels runs whose only unfinished jobs are queued on its label, waits up to 30 s for GitHub to finish the cancel, and re-runs those jobs, which then run on `ubuntu-latest`. Events: `routing-release`, `routing-release-failed`, `routing-release-unauthorized`, `routing-release-dry-run`, `routing-check-incomplete`, `routing-stranded-cancelled`, `routing-stranded-waiting`. The check runs at most every 10 minutes, and at once when the reason changes. A permit that no longer matches the controller (`routing-release-unauthorized`) needs the owner's release.
- **By the owner.** `cirujano fleet release --registry "$REGISTRY" --id P# [--cancel-stranded]` deletes the variable, confirms it, and notes the release in the registry. With `--cancel-stranded` it also cancels stranded runs and re-runs their jobs. Its report lists cancelled, re-run, still-active, failed and waiting runs. Use it when the controller has no permit, runs in dry-run, is stopped, holds a mismatched permit, or lacks `release-routing`.
- **Last resort.** `gh variable delete CIRUJANO_RUNNER_P# --repo <owner/repo>`.

A run whose cancel had not finished within the wait keeps its cancelled jobs; push or dispatch a new run for it. With the switch off it runs on `ubuntu-latest`. A re-run reads the current variable value (measured 2026-10-29 in a private scratch repository: the re-run attempt ran on `ubuntu-latest`).

`cirujano fleet health --registry "$REGISTRY" [--format markdown] [--now <ISO>]` is read-only. It exits 1 when a row is red and prints each row's recovery command. A sleeping or stopped controller host cannot release anything, so jobs wait until GitHub's 24-hour queue limit. Run `fleet health` or `fleet release` from any machine with the owner's `gh` login.

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
  and D6: `cpu-d3` `4vcpu-16gb`, 80 GiB `network-ssd`, the enrollment's
  `runnerLabel` (baseline for a repository's first active enrollment, owned
  by enrollment ID for later ones), `lifetimeMs` 4 h, `maxJobMs` 60 min,
  `shutdownMarginMs` 5 min, `idleGraceMs` 5 min, `pollIntervalMs` 30 s, the
  enrollment's repository id, workflow id and job names, and
  `admission: same-repository`: unlike the pilot's default-branch-push rule,
  an enrolled controller also serves `pull_request` runs, pushes on any
  branch and `schedule` runs (the enrolled repository's own default branch;
  a cut-over nightly check would otherwise queue until GitHub fails it),
  provided the head repository is the enrolled private repository itself.
  Fork heads are never admitted. The trust boundary is therefore
  "anyone who can push a branch to the enrolled private repository": such a
  push can rewrite the enrolled job's steps and they run on the VM, whose
  only credential is the job's own `GITHUB_TOKEN` (ephemeral runner,
  cloud-init refuses credential material). The guest mirrors GitHub's hosted
  Ubuntu image where enrolled workloads need it: `postgresql-client`, `zstd`
  and passwordless `sudo` for the `runner` user (Playwright `--with-deps`,
  `apt-get` steps), and checks out under `/home/runner/work/<repo>/<repo>`
  like GitHub's runners (a root such as `/var/lib/cirujano/...` leaked the
  `lib` segment into a workload's absolute-path coverage globs, P2
  2026-09-17), decided 2026-09-16 after the first P1 runs failed on a
  missing `psql`. Sudo adds no privilege the job did not already have: the
  runner user is root-equivalent through its `docker` group membership. The online
  controller enforces its locally persisted generation deadline even when guest
  status is unavailable or changed, under the permit's recovery/stop authority.
  Runtime accounting uses the controller's recorded start-intent time. Legacy
  journals without that timestamp use deadline minus configured maximum lifetime
  as a conservative bound (shortened grants can be overcounted); a journal with
  neither timestamp reserves a full lifetime, never a guest-supplied start time.
  This does not provide independent shutdown while the controller is offline:
  a root job can disable the guest watchdog, leaving owner recovery necessary.
  Regenerating a config changes its
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

The installer records the current Node executable in the launch agent so a
non-interactive launch uses the same runtime. Set `CIRUJANO_NODE_PATH` to an
absolute executable path when installing if a different Node is required.
The controller uses launchd's Standard process type so its polls receive
normal scheduling priority.

The template supplies the Nebius project, subnet, image and dated rates; the
generator refuses anything but the pilot preset. `permit-proposal` binds the
proposal to the installed bundle digest and the config hash, applies the D3
bounds (expiry `2026-10-28T23:59:59Z`, 600 starts, 150 h, USD 40, fleet
ceiling USD 440 across other enrollments' issued permits or pending proposals)
and refuses a quote whose conservative maximum exceeds the ceiling. The owner reviews
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
poll interval needs its recorded reason resolved. The controller does not retry
an uncertain provider mutation blindly. After permit expiry, stale drain,
registration and resume-admission intents can be cleared under matching recovery
authority. A stale dispatched start can also be cleared under that authority
when complete provider evidence proves the same generation's owned VM is running
with no operation in flight; the next tick can enforce its deadline. Other
expired-authorization intents remain blocked. An idle guest that did not drain receives a new
attempt while its grant and permit allow it.

Expired-generation recovery: when the provider reports the owned VM `stopped`
while the journal believed the guest was up, and the journaled grant deadline
(`grantDeadlineMs`, persisted with the start intent before provider I/O) has passed, the
controller treats the stop as the expected end of the immutable lifetime. It
removes the offline runner registration, emits `delete-vm` under the permit's
`delete` authority (including an expired permit with recovery enabled),
reconciles the absence, and creates a fresh generation on the next eligible
demand once a renewed active permit authorizes it; start count and accounting
continue monotonically.
If a VM stops before its first start reconciles, the controller waits until the
boot window ends. With a terminal provider start operation, complete idle
GitHub and guest observations, and cleanup authority, it journals a delete,
reconciles VM absence, then creates a fresh generation for eligible demand.
An incomplete provider operation or GitHub observation leaves the start pending.
After a start reconciles, a stop before its grant deadline still blocks and
stays manual (quarantine or a provider fault).

Provider capacity wait: Nebius allocates the public IPv4 address at start, so
an exhausted `vpc.ipv4-address.public.count` quota fails the start operation
with `RESOURCE_EXHAUSTED` (`QuotaFailure`). The controller keeps the stopped VM
and its disk, hands the refused start generation back, and records
`lifecycle.capacityWait` (reason code `provider-capacity-wait`) in
`controller-state.json` plus a `provider-capacity-refused` event. Ticks report
`"status":"waiting"` while the queued job stays queued. After a 2, 4, 8, then
16-minute backoff it retries only the start, reusing the refused generation.
A refused create waits and retries the create. A successful start or a delete
clears the wait. If the queued work goes away, `delete-after-stop` removes the
waiting VM and its disk.

Rollback: a bundle older than the capacity wait rejects a journal that holds
`lifecycle.capacityWait`. Before installing such a bundle, stop the agent and
remove that key from `controller-state.json`. The VM then stays stopped until
the next eligible demand starts it.

Stop and remove an agent:

```sh
./scripts/install-runner-agent.sh P1 --remove   # unloads the agent, keeps the state directory
cirujano runner stop --config ~/.local/share/cirujano/runner/P1/config.json --permit .../P1/permit.json
cirujano runner cleanup --config ~/.local/share/cirujano/runner/P1/config.json --permit .../P1/permit.json
```

Run `stop` and `cleanup` through the installed bundle
(`~/.local/lib/cirujano/runner/cirujano.mjs`) with the wrapper's path
variables (see the script) so the candidate digest matches the permit.
