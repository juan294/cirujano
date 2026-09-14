# Nebius runner bootstrap repair implementation notes

## Deviations

### Sequential workspace test scheduling

- Plan said: add the phase-specific schema script entry in `package.json` if required.
- Found: the unchanged root `pnpm -r test` ran package suites concurrently and repeatedly failed at different short timing boundaries, while the same runner and CLI suites passed independently.
- Chose: retain every package test but set `--workspace-concurrency=1` on the root test script.
- Why: the repository requires sequential, deterministic verification. This changes wall time only; it does not reduce package-local Vitest coverage or behavior.

### Boot-oracle environment repairs

- Found: QEMU user networking could reach Ubuntu HTTPS mirrors but not their HTTP endpoints, and the stock cloud image did not have enough root-disk capacity for the production package set.
- Chose: normalize Canonical mirror URLs to HTTPS in the production cloud-config and resize only the ephemeral QEMU overlay to 16 GiB. The pinned base image, package list, and production watchdog deadline remain unchanged.
- Found: `/opt/cirujano` was created mode 0700 even though controller helpers are invoked by the `runner` user.
- Chose: keep `/var/lib/cirujano` and `/opt/actions-runner` mode 0700 while making only `/opt/cirujano` mode 0755. Helpers retain their existing sudo and validation boundaries.

### Deterministic unrelated telemetry fixture

- Found: the existing prior-day overlap test used a hard-coded run timestamp with the real current clock. Later on 2026-09-14 it fell outside the moving 48-hour window and failed the complete repository gate.
- Chose: pin and restore the Vitest clock inside that test. Production telemetry code is unchanged.

### Phase 3 persistence and timing contracts

- Plan-owned files did not include `packages/runner/src/controller.ts`, `packages/runner/src/config.ts`, or their tests.
- Found: unresolved reconciliation readbacks were returned but not persisted, and the accepted configuration allowed poll intervals shorter than OpenSSH's one-second timeout granularity.
- Chose: persist bounded unresolved readbacks through the existing atomic controller journal, reject poll intervals below two seconds, and derive both SSH and wrapper timeouts from one tested helper. This implements the plan's persisted-reason and poll-sized-attempt requirements without provider replay.

### Phase 4 default-port host lookup repair

- Found: the first authorized live bootstrap exposed an OpenSSH interoperability error. The controller wrote `[IPv4]:22` to `known_hosts`, while OpenSSH's default-port lookup used the plain IPv4 host name. A direct fingerprint comparison proved the guest served the exact authorized Ed25519 key, but strict lookup still rejected the entry.
- Chose: render plain host names for port 22 and retain bracketed host-and-port entries for non-default ports. The regression test covers both forms. Strict host-key checking and the pinned fingerprint remain unchanged.
- Cleanup: cancelled exact Archy run `34846465666`, stopped and deleted only VM `computeinstance-e01j36rtq99fyam6n9` and its managed disk, then confirmed zero instances, disks, and public-IP allocations. The VM started once; no token, runner registration, or workload admission occurred.

### Post-push CI workflow identifier repair

- Found: exact-SHA CI run `34854470321` was rejected before job creation because job identifier `ubuntu-24.04` contained dots, which GitHub does not allow in job identifiers. CodeQL run `34854472096` passed for the same SHA.
- Chose: rename only the job identifier to `ubuntu_24_04`; retain `runs-on: ubuntu-24.04` and the complete boot-oracle job body unchanged.
- Regression: a repository test now fixes the valid job identifier and rejects the invalid dotted form. Local `actionlint` also accepts the repaired workflow.

### Linux schema mode-probe repair

- Found: exact-SHA CI run `34855699167` reached both jobs. The dedicated Ubuntu QEMU boot oracle passed in 12m47s, while the standard test job exposed that GNU `stat -f '%Lp'` succeeds with filesystem output instead of rejecting the BSD-only format. The schema harness therefore reported a false mode failure before exercising its intended disclosure boundary.
- Chose: try GNU `stat -c '%a'` first and fall back to BSD `stat -f '%Lp'`. The rendered file and required `0600` check remain unchanged.
- Regression: the disclosure-boundary test now supplies a GNU-compatible `stat` fixture that reproduces the Linux behavior and proves the schema failure remains redacted after the portable mode probe.

### Hosted QEMU topology and storage repair

- Found: exact-SHA CI run `34857555243` passed the complete standard job, including all 381 tests, but its QEMU job closed the SSH connection before cloud-init completed. The preceding hosted QEMU run `34855699167` had passed with cloud-init ready 411 seconds after boot and the unarmed watchdog powering off 609 seconds after SSH readiness, so the failure was timing variance under software emulation rather than a production cloud-config regression.
- First correction: set `CIRUJANO_QEMU_CPUS=2` only on the dedicated Ubuntu boot-oracle job to under-subscribe the four-CPU standard runner that GitHub documents for public repositories. A local exact oracle passed in 696 seconds, but exact-SHA CI run `34861723361` still reached the same 600-second shutdown boundary before cloud-init completed. The CPU-only hypothesis was therefore disproved. [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- Chose: retain the conservative two-vCPU guest topology, replace QEMU's all-features `max` model with the bounded generic `qemu64` model, and use `cache=unsafe` only for the task-owned disposable qcow2 overlay. QEMU documents that mode as suppressing persistence flushes when host-failure durability is irrelevant; the pinned base image and NoCloud seed do not use it, and the overlay is trapped and deleted on every exit. The production cloud-config, package set, and 600-second unarmed watchdog deadline remain unchanged. [QEMU drive cache documentation](https://www.qemu.org/docs/master/system/qemu-manpage.html)
- Regression: separate harness tests fix the CPU model and confine non-durable caching to the ephemeral overlay; the workflow test fixes the CPU setting to the QEMU job. The final local exact oracle reached strict SSH in 70 seconds, completed the watchdog proof 436 seconds after boot, powered off 611 seconds after SSH readiness, exited after 681 seconds total, recorded serial checksum `aeb0fb9e49ee9a1e724292ccfd0a67be1ef721ff7a8fead6987754025516b403`, and confirmed ephemeral cleanup.

## Phase 1 handoff

- Scope: complete native Ed25519 host-key ownership, console suppression, deterministic renderer harness, and exact cloud-init 26.1 schema oracle.
- Base: `c1acd9116859792724ee427cb5e95a060599e0c9` on local branch `feat-nebius-bootstrap-repair` in `/Users/juan/code/cirujano-nebius-bootstrap-repair`.
- Implementation commit: `e7cc9834606c04be245243497974bc92940039ab`.
- Fixed inputs: cloud-init source commit `8bf3567532b07e2cc15aa4c76c36ebed65ccfaec`; tool version 26.1.
- TDD: the focused renderer test failed because `ed25519_private` and console-suppression fields were absent. After implementation, `pnpm --filter @cirujano/runner exec vitest run src/adapters/cloud-init.test.ts` passed 17 tests.
- Schema: `bash scripts/verify-runner-cloud-init-schema.sh` passed and printed cloud-init 26.1, the fixed source commit, and `valid without annotations`. The harness removed its rendered config and ephemeral keys.
- Review: independent review found missing disclosure-path tests, then temporary-fixture cleanup and timeout headroom gaps. All were repaired. Final review approved with no remaining finding.
- Simplify: reuse, quality, and efficiency passes consolidated imports, added failure-safe fixture cleanup, and kept the schema failure seam local. No check was dropped.
- Complete gate: `python3 .rpi/scripts/rpi-verify.py` passed all five checks against the stable candidate before commit: typecheck, lint, build, bundle verification, and 349 tests across core, runner, action, and CLI.
- External state: no GitHub or Nebius mutation occurred. Local Docker downloaded and built the pinned validator image.
- Next entry condition: phase 2 may start from `e7cc9834606c04be245243497974bc92940039ab`; its Linux boot oracle and diagnostics remain unimplemented.

## Phase 2 handoff

- Scope: failure-only SSH diagnostics, exact guest helper access, pinned Noble boot oracle, and dedicated Ubuntu CI gate.
- Base: `e7cc9834606c04be245243497974bc92940039ab`.
- Implementation commit: `34504059ef004328540074479dd8c3159d8a2779`.
- Fixed inputs: Noble image `https://cloud-images.ubuntu.com/noble/20260911/noble-server-cloudimg-amd64.img`, SHA-256 `612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354`, Actions runner 2.328.0, SHA-256 `01066fad3a2893e63e6ca880ae3a1fad5bf9329d60e77ee15f2b97c148c3cd4e`.
- TDD: forced diagnostic failures proved original exit preservation, fixed section markers, a 64 KiB cap, private-key removal, and whitespace-tolerant credential redaction. A separate regression proved the controller user can traverse the installed helper directory.
- Boot oracle: QEMU 11.1.1 with `accel=kvm:tcg` reached strict SSH in 60 seconds, proved the generated fingerprint, root-owned `sshd -t` readiness marker, active SSH socket/service/watchdog, cloud-init 26.1 completion, and no grant. It powered off 612 seconds after readiness, exited cleanly after 672 seconds total, recorded serial checksum `eaeaa0618e19451e6bf793d3c026c272de92154e10dfaffa4e0db1e92dcf5ff3`, and confirmed ephemeral cleanup.
- Review: independent review found whitespace credential leaks, a discarded QEMU status, missing exit evidence, and an unauthorized direct `sshd -t` probe. All were repaired; final review approved the marker-based preflight and timing boundary with no finding.
- Simplify: reuse, quality, and efficiency review retained the explicit shell phases and compatibility fallbacks because consolidating them would obscure failure ownership. No behavior or check was dropped.
- Complete gate: after the clock-fixture correction, `python3 .rpi/scripts/rpi-verify.py` passed typecheck, lint, build, bundle verification, and 352 tests across core, runner, action, and CLI.
- External state: no Nebius or GitHub mutation occurred. QEMU, the pinned image, Ubuntu packages, and runner archive were local dependency/test inputs only.
- Next entry condition: phase 3 may start from `34504059ef004328540074479dd8c3159d8a2779`.

## Phase 3 handoff

- Scope: pure SSH readiness classification, bounded per-attempt timing, pending start reconciliation, fixed boot expiry, and safe diagnostic persistence.
- Base: `34504059ef004328540074479dd8c3159d8a2779`.
- Implementation commit: `b40ddc66ab1240ae2d63d2048be56f9e1a0aa69d`.
- TDD: 15 classifier cases first failed because no classifier existed. Five controller scenarios then failed on the prior terminal behavior. Reviewer-driven RED cases additionally proved that exit-255 helper text cannot collide with transient phrases and that sub-two-second polling is rejected.
- Matrix: only complete OpenSSH connection-stage lines for refused, reset, timed out, no route, and the two supported pre-banner reset forms are transient. Host-key, authentication, identity-file, configuration, wrapper timeout, non-255 helper, and unknown results are fatal.
- Controller evidence: refusal and pre-banner reset each kept the same pending effect, lifecycle generation, and boot deadline; one provider start and two SSH arm attempts occurred; success armed one grant. Fatal and expired cases kept provider start count one. No registration token or runner-registration call occurred.
- Timing: production polling gives OpenSSH 29 seconds inside a 30-second process cap. All accepted configurations require at least two seconds, and the process cap never exceeds the poll interval or 60 seconds.
- Review: independent review found exit-255 helper collisions, an OpenSSH/wrapper timeout race, and accepted sub-second polling. Anchored messages, timing headroom, and configuration validation repaired all three; final review approved with no finding.
- Simplify: one `sshAttemptTiming` function now owns both timeout values, and one `SshInvocationError` owns stable non-secret process failure transport. No duplicate retry loop or provider action was introduced.
- Complete gate: `python3 .rpi/scripts/rpi-verify.py` passed typecheck, lint, build, bundle verification, and 380 tests across core, runner, action, and CLI.
- External state: no Nebius or GitHub mutation occurred.
- Next entry condition: phase 4 requires an exact candidate/configuration/permit packet and fresh owner authorization before any mutation.

## Phase 4 handoff

- Scope: one candidate-bound live bootstrap, strict SSH and watchdog evidence, five-minute no-restart observation, and exact cleanup.
- Candidate: `20d039fa63168df6092bb355c18de46aa7bc4e2a`; CLI SHA-256 `2bed8d81bdb5895f8a7564f92ed765e832c8866db740d3c3386d64879341e813`.
- Authorization: exact `r8` packet approved with config SHA-256 `cefb57749413a41a3e29fabf0b9e86376a283732b78e271cb22a762a45908b22` and permit SHA-256 `84085acf607b415a1e23566f492814ace2e0c17dc05f29516b7f6cca965b481b`.
- Fixture: Archy run `34848109183` stayed queued, executed zero steps, and was cancelled before any additional controller tick.
- Guest: strict SSH accepted the candidate-bound Ed25519 fingerprint. The ready snapshot proved active watchdog, generation 1 grant, no runner process, no worker process, and no registration.
- Shutdown: grant ran from `2026-09-14T13:17:37.510Z` to deadline `2026-09-14T13:21:18.375Z`; provider `STOPPED` was first observed at `2026-09-14T13:23:38.064Z` without further controller or guest commands.
- Observation: the exact VM remained stopped through `2026-09-14T13:28:42.164Z`; controller start count remained one.
- Cleanup: the permit-bound cleanup removed only the exact `r8` VM and managed disk. Final complete reads showed zero instances, disks, public-IP allocations, repository runners, owned runners, or eligible fixture demand.
- Receipt: local ignored `docs/agents/nebius-runner-bootstrap-proof-2026-09-14.md`; controller artifacts, transcript-preserved observations, final readbacks, and keys remain ignored under `.cirujano/runner/bootstrap-proof-r8/`.
