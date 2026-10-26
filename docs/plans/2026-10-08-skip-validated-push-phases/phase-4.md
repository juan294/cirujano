# Phase 4: deterministic patch and classifier job

## Patch (`packages/core/src/optimization/push-patch.ts`)

Implements plan § Patch shape. Inputs: base source plus eligibility. Outputs: candidate source,
unified patch (reuse `patch.ts` diff helper), and before/after structural digests.

Generated classifier job (exact shape; tests assert the bytes):

```yaml
  cirujano_validated_push:
    if: github.event_name == 'push' && github.ref == 'refs/heads/<branch>'
    runs-on: ubuntu-latest
    timeout-minutes: 2
    permissions:
      actions: read
      contents: read
      pull-requests: read
    outputs:
      validated: ${{ steps.classify.outputs.validated }}
    steps:
      - name: Check whether this push was already validated by its PR (Cirujano)
        id: classify
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          node --input-type=module <<'CIRUJANO_CLASSIFIER'
          <template bytes, indented>
          CIRUJANO_CLASSIFIER
```

Guard (per guarded job): `${{ !cancelled() && <needs.X.result == 'success' …> && (needs.cirujano_validated_push.result != 'success' || needs.cirujano_validated_push.outputs.validated != 'true') && (<original>) }}`.
Insertion preserves comments and ordering for untouched nodes, as the cache patch does.

`validateGuardOnlyChange(base, candidate, operation)`: parse both, remove the classifier job,
unwrap each guard back to the original `if` (absent if none) and remove the appended need, then
require `jsonDigest` equality with the base. Any other difference is rejected.

## Propose (`propose.ts` family branch)

Same lifecycle as the cache path: diagnosis with the same provenance, a local patch only,
`proposal.json` + `candidate.patch`, and status `proposed | no-change | rejected`. The
verification profile is the `push-guard` profile (Phase 5 schema, declared here).

## Actionlint

Extend `scripts/optimization/check-actionlint.mjs` to lint every eligible generated push fixture
with the pinned actionlint 1.7.12. This includes `shellcheck` on the heredoc `run:` block.

## Tests (first)

`push-patch-golden` (exact bytes per fixture), `push-patch-inverse`, `push-patch-rejects-extra-edit`
(a mutated candidate with one extra change fails), `push-patch-idempotent-no-change`,
`push-patch-matrix-job`, `classifier-template-embedded-verbatim` (extracted script bytes digest ==
`classifierDigest`).

## Acceptance

Automated: full gates plus `verify:optimization-actionlint`.
