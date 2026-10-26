# Phase 3: bounded SSH readiness reconciliation

**Depends on:** accepted phase 2

**External mutations:** none

**Stop condition:** owner review after full local verification

## Outcome

A pending `start-vm` tolerates only recognized transient SSH readiness failures
inside its original boot window. It retries the same guest without another
provider start and still fails closed on identity, authentication, helper, or
deadline failures.

## Owned files

- `packages/runner/src/adapters/ssh.ts`
- `packages/runner/src/adapters/ssh.test.ts`
- `packages/runner/src/index.ts` if the classifier needs a public export
- `packages/cli/src/runner-service.ts`
- `packages/cli/src/runner-service.test.ts`

## Test-first sequence

1. Add table tests for a pure SSH readiness classifier. The transient set is
   limited to exit 255 with connection refused, connection reset, connection
   timeout, no route to host, or pre-banner key-exchange reset. Test OpenSSH
   wording variants observed on the supported platform.
2. Require fatal classification for host-key mismatch, changed-host warnings,
   permission denied, missing identity files, invalid arguments, helper exit
   after connection, non-255 exits, and unknown stderr.
3. Add controller fixture tests for refusal then success and reset then success.
   Require one Nebius start call, multiple SSH attempts, the same pending effect
   ID/generation/deadline, one grant arm, no token request, and no runner
   registration.
4. Add a fixed-clock expiry test based on
   `pending.createdAtMs + config.timing.bootTimeoutMs`. At or after the deadline,
   the same transient process result must become fatal without a second start.
5. Limit each process execution timeout to the single attempt derived from
   `pollIntervalMs`; do not reuse the full boot timeout for each SSH process.
6. Update `reconcileEffect` so only transient readiness returns unresolved
   readback. Preserve all other failure and ownership paths.

## Behavioral oracle

```text
GIVEN one durably pending start effect and a provider RUNNING readback
WHEN strict SSH returns a recognized transient result before the fixed deadline
THEN reconciliation remains pending with diagnostic readback
AND the next controller tick retries SSH against the same owned instance
AND Nebius start count remains one
AND generation and deadline do not change
AND no GitHub token or runner registration is requested

WHEN SSH succeeds before the deadline
THEN the original grant is armed once and the start effect resolves

WHEN identity/authentication/helper failure occurs OR the deadline expires
THEN reconciliation fails closed and does not start a replacement VM
```

## Acceptance criteria

- The transient set is explicit, unit-tested, and cannot match host-key or
  authentication errors.
- Error messages and persisted readback contain a stable reason code and no raw
  secrets.
- One SSH attempt cannot block longer than its poll-sized attempt timeout.
- Existing guest-loss, ownership, interrupt, and lifecycle tests continue to
  pass.
- Focused SSH and runner-service tests pass.
- `python3 .rpi/scripts/rpi-verify.py` passes sequentially.
- Independent review and `codex-simplify` produce no unresolved finding.

## Exit evidence

Record the implementation commit, transient/fatal matrix, fixed-clock boundary,
provider/SSH/token/registration call counts, and complete verification output.
Stop before phase 4. Phase 4 always needs a fresh exact live authorization.
