# Phase 4: candidate-bound live bootstrap proof

**Depends on:** accepted phase 3, exact candidate commit, complete local gates

**External mutations:** one authorized GitHub fixture dispatch and one authorized Nebius VM lifecycle

**Stop condition:** validated receipt and exact cleanup, or immediate fail-closed cleanup

## Outcome

One live Ubuntu guest proves pinned SSH readiness and watchdog shutdown without
runner registration or workload admission. This phase does not resume full R14.

## Preflight and approval packet

Before requesting authorization, prepare a concrete packet containing:

- Exact candidate commit, clean-worktree proof, configuration hash, rendered
  cloud-config hash, guest-file hashes, runner archive identity, and permit hash.
- Passed local verification and Ubuntu boot evidence tied to those unchanged
  inputs.
- Read-only current Nebius identity, quota, price estimate, and proof that the
  exact owned resource prefix is absent.
- Read-only current GitHub proof that no owned runner or prior fixture remains.
- One fixture workflow/ref, one VM identity, approved create/start/stop/delete
  operations, maximum runtime, maximum estimated cost, and observation window.
- The explicit boundaries: no registration token, no runner registration, no
  workload admission, no second VM, no rerun, and no replacement dispatch.

Do not dispatch or create anything until the owner authorizes that exact packet.
Any candidate/config/permit change invalidates the authorization.

## Execution sequence

1. Recheck candidate identity, absence, permit validity, and read-only provider
   and GitHub state immediately before mutation.
2. Dispatch one minimal fixture only to establish queued demand. Record its run
   ID and confirm it has not started on a self-hosted runner.
3. Advance the existing controller in bounded one-step mode through create,
   start, transient SSH readiness, and the single grant arm. Stop controller
   execution immediately when the pending `start-vm` resolves.
4. Prove the strict pinned SSH fingerprint and record guest evidence: successful
   `sshd -t`, listening `ssh.socket`, usable `ssh.service`, active watchdog,
   exact short grant generation/deadline, no runner process, and no registration
   marker.
5. Cancel the queued fixture before any further controller tick. Confirm no
   owned runner exists and no workload started.
6. Stop sending controller or guest commands. Observe guest poweroff, then poll
   until Nebius reports the exact VM `Stopped` within the approved bound.
7. Continue read-only observation for the approved no-restart window. Require
   the exact VM to remain stopped and start count to remain one.
8. Use the approved exact cleanup path to delete only the candidate-owned VM and
   disk. Confirm absence from Nebius and no owned runner/fixture from GitHub.
9. Write the redacted live receipt under `docs/agents/` according to repository
   visibility policy. Keep raw provider logs and private identifiers in ignored
   local evidence storage.

## Behavioral oracle

```text
GIVEN an exact approved candidate, one queued fixture, and no pre-existing owned resources
WHEN the controller creates and starts one VM
THEN transient SSH readiness is retried against that same VM
AND strict SSH proves the pinned host identity
AND one short watchdog grant is armed
AND no registration token, runner registration, or workload admission occurs

WHEN controller and guest commands stop
THEN the guest powers off before the approved deadline
AND Nebius reports the exact VM Stopped
AND it remains stopped for the observation window
AND final exact cleanup leaves no owned VM, disk, runner, or fixture
```

## Acceptance criteria

- Provider create count and start count are exactly one.
- SSH fingerprint equals the candidate-bound public host key.
- Guest timestamps prove SSH readiness and watchdog grant before poweroff.
- Fixture remains unstarted and is cancelled; GitHub shows no owned runner.
- Provider reaches `Stopped`, stays stopped for the approved observation window,
  and reports no automatic restart.
- Cleanup removes only the exact candidate-owned VM and disk and final reads are
  complete.
- The receipt includes command versions, hashes, timestamps, IDs in redacted
  form, and links/checksums for local evidence.

## Fail-closed handling

On any mismatch, incomplete read, timeout, unexpected runner, workload start,
or second mutation attempt:

1. Stop advancing the controller.
2. Cancel only the proof fixture if it still exists.
3. Use only the approved recovery operations against the exact owned resource.
4. Preserve bounded diagnostics and complete final readbacks.
5. Report failure. Do not create another VM or restart the proof under the same
   authorization.

Passing this phase permits planning the remaining workload-dependent R14 rows;
it does not itself authorize them.
