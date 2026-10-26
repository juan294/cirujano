# Phase 1: cloud-init host-key contract and schema oracle

**Depends on:** accepted repair plan

**External mutations:** none

**Stop condition:** owner review after all acceptance criteria pass

## Outcome

The exact cloud-config emitted by the production renderer contains one complete
native Ed25519 host-key pair, cannot leak that private key through ordinary
output paths, and passes cloud-init 26.1 schema validation.

## Owned files

- `packages/runner/src/adapters/cloud-init.ts`
- `packages/runner/src/adapters/cloud-init.test.ts`
- `scripts/render-runner-cloud-init.mjs`
- `scripts/verify-runner-cloud-init-schema.sh`
- `packages/runner/test/cloud-init-26.1/Dockerfile`
- `package.json` only if a script entry is required

## Test-first sequence

1. Extend the renderer test to require both `ed25519_private` and
   `ed25519_public`, reject `/etc/ssh/ssh_host_ed25519_key*` under
   `write_files`, and require serial key/fingerprint suppression.
2. Add assertions that neither renderer errors nor schema harness logs contain
   the private fixture key or its base64 encoding.
3. Add the deterministic renderer harness. It must import the production
   `renderCloudInit`, read the production guest file set, generate an ephemeral
   matching host pair and login key, and write only to a caller-supplied
   mode-0600 output file.
4. Add the schema verifier pinned to cloud-init 26.1 commit
   `8bf3567532b07e2cc15aa4c76c36ebed65ccfaec`. It must run
   `cloud-init schema -c <file> --annotate`, fail on annotations or nonzero
   status, and delete the rendered file and keys on every exit.
5. Change the renderer only after the focused tests fail for the old partial
   declaration.

## Behavioral oracle

```text
GIVEN matching ephemeral Ed25519 host and login keys
WHEN the production renderer creates cloud-config
THEN ssh_keys contains the complete host private/public pair
AND write_files contains no host-key path
AND console key and fingerprint emission are disabled
AND cloud-init 26.1 schema validation exits zero without annotations
AND captured stdout/stderr contains neither private material nor its base64 form
```

## Acceptance criteria

- Repeated rendering from the same inputs is byte-for-byte deterministic.
- The production validator still rejects malformed, encrypted, non-Ed25519, or
  mismatched host keys before rendering.
- The schema tool version and pinned upstream commit are printed; rendered
  user-data and keys are not printed.
- The focused renderer and schema tests pass.
- `python3 .rpi/scripts/rpi-verify.py` passes sequentially.
- Independent review and `codex-simplify` produce no unresolved finding.

## Exit evidence

Record the implementation commit, the pinned cloud-init commit, exact commands,
exit statuses, and cleanup proof. Stop before phase 2 until the owner accepts
this phase or has already authorized continuous implementation across it.
