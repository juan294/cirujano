# Phase 2: Ubuntu boot oracle and serial diagnostics

**Depends on:** accepted phase 1

**External mutations:** dependency/image downloads only; no Nebius or GitHub mutation

**Stop condition:** owner review after the real unarmed poweroff is observed

## Outcome

The production cloud-config boots on the pinned Ubuntu 24.04 image with the
expected SSH identity and watchdog boundary. If SSH activation fails, the serial
log contains bounded, redacted evidence sufficient to identify the daemon
preflight error.

## Owned files

- `packages/runner/guest/diagnose-ssh.sh`
- `packages/runner/guest/bootstrap.sh`
- `packages/runner/src/adapters/cloud-init.ts`
- `packages/runner/src/adapters/cloud-init.test.ts`
- `packages/runner/src/adapters/guest.test.ts`
- `scripts/test-runner-cloud-init-boot.sh`
- `.github/workflows/ci.yml`
- `package.json` only if a script entry is required

## Test-first sequence

1. Add shell fixture tests that force `sshd -t`, `systemctl`, and `journalctl`
   failures containing credential and private-key patterns. Require fixed
   section markers, redaction, a 64 KiB aggregate cap, and preservation of the
   original nonzero restart result.
2. Add `diagnose-ssh.sh` to the exact guest file contract and install it during
   the safety bootstrap. Wrap only the SSH restart command so diagnostics run
   on failure and successful boot output remains quiet.
3. Add the QEMU harness using the dated Noble image and SHA-256 fixed in the
   main plan. Generate an ephemeral NoCloud seed from the production renderer,
   use an ephemeral SSH pair, capture serial output, and install traps before
   starting QEMU so every exit removes task-owned artifacts and process state.
4. During the live boot, prove the pinned host key before accepting SSH. Then
   prove `ssh.socket` is listening, `ssh.service` accepts the connection,
   `sshd -t` succeeds, `cloud-init status --wait` succeeds, the watchdog unit is
   active, and no grant exists.
5. Stop issuing guest commands and observe the unchanged production unarmed
   deadline. Require guest poweroff near 600 seconds and QEMU process exit
   within a bounded tolerance. Do not shorten the production deadline for the
   test.
6. Add a dedicated `ubuntu-24.04` CI job that installs QEMU tooling and runs the
   same script with `accel=kvm:tcg`. Keep it separate from the existing 15-minute
   checks job because this oracle needs at least 20 minutes.

## Behavioral oracles

```text
GIVEN the digest-pinned Noble cloud image and exact production cloud-config
WHEN QEMU boots the guest with no watchdog grant
THEN the SSH host fingerprint equals the generated pinned identity
AND ssh.socket is listening
AND ssh.service accepts the strict host-key connection
AND sshd -t and cloud-init status --wait succeed
AND cirujano-watchdog is active
AND the guest powers off at the real unarmed deadline
AND QEMU exits and all ephemeral artifacts are removed
```

```text
GIVEN SSH restart fails with sensitive-looking diagnostic content
WHEN the failure helper writes to the serial console
THEN its output is sectioned and useful
AND total output is at most 64 KiB
AND private-key and credential patterns are replaced
AND cloud-init retains a failing result
```

## Acceptance criteria

- Image checksum mismatch fails before QEMU starts.
- SSH verification uses strict known-host matching and never falls back to
  `StrictHostKeyChecking=no`.
- The boot oracle proves both the positive SSH path and the real unarmed
  shutdown path on the same production configuration.
- Forced failure tests prove diagnostics are bounded and secret-safe.
- The focused guest, renderer, diagnostic, and boot tests pass.
- `python3 .rpi/scripts/rpi-verify.py` passes sequentially.
- Independent review and `codex-simplify` produce no unresolved finding.

## Exit evidence

Record image URL and digest, QEMU version/acceleration, cloud-init version,
timestamps for boot/SSH/watchdog/poweroff, serial-log checksum, test results,
and cleanup proof. Keep raw serial logs out of git. Stop before phase 3 unless
continuous implementation was already authorized.
