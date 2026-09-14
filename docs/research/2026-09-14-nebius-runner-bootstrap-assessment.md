# Nebius runner bootstrap failure assessment

Date: 2026-09-14
Status: assessment complete; live pilot remains blocked
Baseline: `develop` at `bae7bbd49cbb0f9dfd17a757fe0f22b5e08ca4e4`

## Question and scope

Should the current on-demand runner continue with another live retry, receive a
focused repair, or be replaced by a different bootstrap architecture?

This assessment covers the repeated guest-readiness failure in the fifth and
sixth authorized attempts. It does not reopen the provider, queue, accounting,
or fixture repairs that already have separate evidence. It makes no code,
configuration, GitHub, or Nebius mutation.

The decision criteria are deterministic SSH readiness, watchdog-first safety,
single-slot compatibility, secret handling, local reproducibility, migration
risk, time to the hackathon deadline, and the cost of another live proof.

## Current-state evidence

The failures before the fifth attempt were different integration defects:
provider wire-shape mismatches, a fixture package-manager conflict, incorrect
start accounting, and a region with no CPU quota. Each produced a specific
repair and cleanup result
(`docs/research/2026-09-13-nebius-runner-pilot.md:62-133`). The fifth attempt
then reached a running VM but never obtained SSH, so no guest grant or runner
registration occurred (`docs/research/2026-09-13-nebius-runner-pilot.md:135-169`).
The sixth attempt reproduced that SSH symptom after the intended cloud-init
ordering repair. Another unchanged retry is therefore not justified.

The sixth attempt provides a narrower failure boundary than the fifth:

- The controller durably emitted one start and retained the pending operation;
  it did not register a runner
  (`.cirujano/runner/r6-g2-watchdog/events.jsonl:4-5`,
  `.cirujano/runner/r6-g2-watchdog/controller-state.json:1`).
- Nebius serial output shows the watchdog unit started at about 14 seconds
  (`.cirujano/runner/r6-g2-watchdog/provider-logs.json:1398`).
- `ssh.service` then failed repeatedly
  (`.cirujano/runner/r6-g2-watchdog/provider-logs.json:1400-1455`). Ubuntu 24.04
  uses socket-activated OpenSSH, where a connection to `ssh.socket` activates
  `ssh.service`; the serial sequence is consistent with the controller's TCP
  attempts reaching the socket and the daemon failing its start preflight.
  [Ubuntu 24.04 release notes](https://discourse.ubuntu.com/t/ubuntu-24-04-lts-noble-numbat-release-notes/39890)
- Cloud-init 26.1 completed at about 72 seconds, including packages and the
  runner archive (`.cirujano/runner/r6-g2-watchdog/provider-logs.json:1957`).
  Slow package installation was not the sixth attempt's blocking condition.
- The watchdog powered the guest off at about 616 seconds
  (`.cirujano/runner/r6-g2-watchdog/provider-logs.json:2103-2160`). The earlier
  external `RUNNING` observation was provider-state lag, not proof that the
  watchdog failed. The plan correctly requires a later provider `Stopped`
  readback because guest poweroff alone is insufficient
  (`docs/plans/2026-09-13-on-demand-nebius-runner.md:223-236`).
- Recovery cancelled the only queued self-hosted run, issued no second
  self-hosted dispatch, removed the exact VM and disk, and ended with no active
  fixture run or owned runner
  (`.cirujano/runner/r6-g2-watchdog/github-snapshot.json:1`). The local evidence
  directory is ignored because it contains private provider and repository
  identifiers; it must not be committed.

The rendered cloud config declares only `ed25519_public` in the native
`ssh_keys` object, then writes the private and public host-key files later with
`write_files` (`packages/runner/src/adapters/cloud-init.ts:37-79`). Cloud-init's
SSH module contract says `ssh_keys` entries use matching `<type>_private` and
`<type>_public` keys, and that specifying `ssh_keys` suppresses automatic key
generation. This makes the partial native declaration the leading cause of the
`sshd -t` or daemon-start failure, although the deleted guest prevents retrieval
of the exact `ssh.service` journal message.
[cloud-init SSH module](https://docs.cloud-init.io/en/latest/reference/modules.html?highlight=power_state)

The local tests prove deterministic text and relative ordering only. They do not
validate the rendered document with cloud-init 26.1 or boot it with Ubuntu's
OpenSSH systemd units (`packages/runner/src/adapters/cloud-init.test.ts:79-135`).
The controller also exits when the first SSH reconciliation throws instead of
classifying connection refusal or reset as a pending boot observation within the
authorized deadline (`packages/cli/src/runner-service.ts:587-598`). This second
defect forced manual controller restarts in both recent attempts and should be
fixed even after SSH startup is repaired.

Primary-source behavior checked on 2026-09-14:

- `runcmd` executes in cloud-init's final stage; `bootcmd` is the supported
  earlier stage. The sixth attempt proves final-stage timing is now fast enough,
  so moving everything to `bootcmd` would not address the observed SSH daemon
  failure by itself.
  [cloud-init boot commands](https://docs.cloud-init.io/en/25.1/reference/yaml_examples/boot_cmds.html)
- `cloud-init schema -c ... --annotate` validates an arbitrary rendered config,
  and `collect-logs` includes cloud-init and journal evidence needed for later
  diagnosis.
  [cloud-init CLI](https://docs.cloud-init.io/en/latest/reference/cli.html)
- Nebius supports versioned custom images and a Packer workflow for preinstalled
  dependencies. That remains available if the standard-image bootstrap cannot
  meet the proof threshold.
  [Nebius custom images](https://docs.nebius.com/compute/storage/custom-disk-images),
  [Nebius Packer workflow](https://docs.nebius.com/compute/storage/packer)

## Alternatives

| Option | Correctness and safety | Cost and time | Disposition |
| --- | --- | --- | --- |
| Retry the current candidate | Repeats a confirmed `ssh.service` failure and cannot reach grant or registration. | Consumes another authorization, VM interval, and fixture dispatch without new evidence. | Reject. |
| Focused standard-image repair | Declare the complete native Ed25519 host-key pair, remove the competing late host-key path, validate with cloud-init 26.1, boot the rendered config locally, and make controller SSH readiness retry until its deadline. | Smallest change and preserves the current provider/controller design. One minimal live proof remains necessary. | Recommend first. |
| Move safety setup to `bootcmd` | Starts earlier, but introduces ordering constraints with embedded files and does not explain the confirmed SSH daemon failure. | Moderate change with new early-boot test needs. | Keep only as a fallback if a boot trace shows final-stage ordering is still material. |
| Build a custom Nebius image | Preinstalls watchdog, runner prerequisites, and diagnostic services, reducing boot variance. Per-VM host identity and image provenance still need a design. | Strongest unattended path but adds image build, storage, patching, and provenance work. | Plan after the pilot, or adopt now only if the focused repair fails local boot proof. |
| Depend only on controller/API cleanup | Can bound an attended test while the Mac is healthy but does not provide the required guest safety boundary. | Simple but violates the accepted watchdog-first contract. | Reject. |

## Recommendation

Stop live R14 retries and run a focused RPI repair cycle. Do not restart the
entire runner design. The provider lifecycle, watchdog process, and cleanup path
all produced useful evidence; the unresolved scope is the SSH bootstrap boundary
and controller treatment of transient SSH readiness.

The repair plan should require, before another paid VM:

1. A cloud-init 26.1 schema pass for the exact rendered document.
2. An Ubuntu 24.04 boot test that proves `ssh.socket`, `ssh.service`, the pinned
   host key, watchdog readiness, and the unarmed deadline with the production
   guest files.
3. A test that connection refusal and reset before `bootTimeoutMs` remain
   pending and retry without another provider start, while expiry still fails
   closed.
4. Serial diagnostics that emit `sshd -t`, `systemctl status ssh.service`, and
   the relevant journal on bootstrap failure without exposing credentials or
   private host-key material.
5. A minimal live bootstrap proof with one VM and no workload admission. It must
   show the expected pinned SSH identity, an armed short grant, guest poweroff,
   provider `Stopped`, no automatic restart during the observation window, and
   exact cleanup. Full R14 dispatches resume only after that proof passes.

The leading host-key diagnosis has high confidence because the native config
does not satisfy cloud-init's documented pair contract and the serial log places
the failure at `ssh.service`. It is not yet conclusive because the deleted VM's
`journalctl -u ssh.service` output was not preserved. Evidence that shows a
different `sshd -t` error would reverse that specific diagnosis, but not the
decision to require a local boot proof and bounded transient retry.

## Durable handoff

Objective: restore deterministic SSH readiness and retain watchdog-first safety
without spending another full R14 attempt on diagnosis. Approved external work
is exhausted for this candidate; another GitHub dispatch or Nebius create/start
requires a new exact candidate-bound authorization.

Branch and worktree: `develop` in `/Users/juan/code/cirujano`, current and remote
commit `bae7bbd49cbb0f9dfd17a757fe0f22b5e08ca4e4`. The sixth receipt bound candidate
digest `7679c4881d59c400f93cc3dbef7aee6d3490c7771429f57e6624a5ed692ec0f8`.
The candidate's exact CI and CodeQL runs passed before R14. Those checks remain
valid for that commit but do not prove the live bootstrap.

Resolved findings: provider creation/start and exact-prefix cleanup worked;
cloud-init completed; the guest watchdog started and powered off; the queued job
was cancelled; no second self-hosted job was dispatched; final provider and
GitHub reads showed no owned live resource. Unresolved findings: exact
`ssh.service` error, native host-key contract repair, controller transient SSH
reconciliation, local Ubuntu boot proof, and every workload-dependent R14 row.

Deviation: the operator initially interpreted a lagging provider `RUNNING`
readback as a watchdog failure. Retrospective serial logs proved guest poweroff;
future evidence must record guest and provider timelines separately. The next
workflow is a focused `rpi-plan` for the five repair gates above, followed by
implementation and validation. This assessment authorizes no live resource or
remote mutation.
