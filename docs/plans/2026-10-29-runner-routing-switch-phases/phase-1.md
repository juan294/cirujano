# Phase 1: Gated routing in the fleet

Parent: [runner routing switch plan](../2026-10-29-runner-routing-switch.md). Entry: plan accepted; worktree from `develop` at or after `04736fa`; `pnpm run ci:fast` green on that base before any edit.

## Goal

Cirujano owns the shape of an enrolled job's runner selection. The fleet can generate it, read it back, and record its switch. A hand-written or ungated selection is refused at cutover and reported, not crashed on, by verify.

## Changes

### New module `packages/cli/src/fleet-routing.ts`

```
@ switchVariableFor(enrollmentId) -> string
do:
  1. validate id matches ENROLLMENT_ID_PATTERN (fleet-registry.ts:72)
  2. emit `CIRUJANO_RUNNER_${id}`
```

```
@ renderGatedRunsOn(enrollment, ownerUserId) -> string
pre: enrollment.status != reverted; ownerUserId positive integer
do:
  1. compute guard (owner actor, same-repo PR, exact workflow_ref clause)
  2. compute labels = requiredSelfHostedLabels(runnerLabel) (fleet-registry.ts:91)
  3. emit canonical text from the parent plan, one line
```

```
@ parseGatedRunsOn(scalar, enrollment) -> {labels, switchVariable} | {refused: reason}
pre: scalar is the YAML value after `runs-on:` on one line
do:
  1. parse YAML plain, single- or double-quoted scalar (unescape \" and \\)
  2. validate prefix `${{ vars.<switchVariableFor(id)> == 'on' && (`
  3. scan guard with balanced parens; refuse a top-level `||`
  4. validate guard contains the exact workflow_ref clause for repo/path
  5. validate suffix `) && fromJSON('<json>') || 'ubuntu-latest' }}`; labels == required labels
fail: any mismatch -> refused with the first failing rule named
```

### `packages/cli/src/fleet-service.ts`

- `extractJobRunsOn` (`:635-688`) gains an optional `enrollment` argument. With it, a `${{` value goes to `parseGatedRunsOn`. A recognized value returns `{ runsOn: labels, routingSwitch, name, matrix }`. A refused value throws `job <key> runs-on is not the Cirujano gated selection (<rule>); generate it with cirujano fleet runs-on --id <P#>`. Without `enrollment` (the `enroll` path, `:140`) behaviour is unchanged: expressions are refused.
- `readLiveIdentity` (`:596-600`) passes the enrollment and returns the switch with the identity.
- `cutover` (`:175-215`): refuse a live selection without a switch (`ungated self-hosted selection; generate it with cirujano fleet runs-on --id <P#>`), and record `routingSwitch` on the enrollment.
- `verify` (`:217-263`): wrap each enrollment's read in its own try/catch. An error becomes a problem line `<P#>: cannot read the runner selection at <head>: <message>`, and the loop continues. A cut-over enrollment without `routingSwitch` adds the problem `<P#>: ungated enrollment; the runner cannot be released without a workflow push`. The existing revert detection (`:251-256`) still works because a gated selection still carries the label.
- New action `runs-on`: read the registry, look up the owner's numeric id through a new read-only `GitHubFleetSource.userId(login)` (`GET /users/<login>`), and print the canonical line plus the `gh variable set CIRUJANO_RUNNER_<P#> --body on --repo <owner>/<repo>` command, labelled as an owner action for later.

### `packages/cli/src/fleet-registry.ts`

- Enrollment gains optional `routingSwitch: string`, parsed through `strictObject` optional keys (`:146`). It must equal `switchVariableFor(id)`. A cut-over enrollment may omit it (legacy history); a new cutover always writes it.

### `packages/cli/src/args.ts`

- Add `fleet runs-on --registry <file> --id <P#>` to the usage text (`:37-45`) and the parser (`:294-330`), with the same duplicate and unknown-flag refusals as the other fleet actions.

## Tests (write first, see them fail)

- `packages/cli/src/fleet-routing.test.ts`:
  - round trip: `parseGatedRunsOn(renderGatedRunsOn(e))` returns the labels and switch, for plain, single- and double-quoted YAML forms;
  - each of these mutants is refused, and the message names the rule: missing `vars` gate, wrong variable name, `!= 'on'`, guard without the workflow_ref clause, workflow_ref for another path, top-level `||` in the guard, unbalanced parentheses, a missing label, an extra label, a fallback other than `'ubuntu-latest'`;
  - a stricter guard (extra sender and full_name clauses, like the two-repository guard variant) is accepted.
- `packages/cli/src/fleet-service.test.ts`:
  - "cutover refuses an ungated selection" (literal self-hosted labels);
  - "cutover records the routing switch";
  - "verify reports an unrecognized expression without aborting": three enrollments, the middle one with a hand-written expression; the first and third still verify and the exit code is 1;
  - "enroll still refuses any expression".
- `packages/cli/src/fleet-registry.test.ts`: accepts a matching `routingSwitch`, refuses a mismatched one, and parses the unchanged `packages/cli/fixtures/fleet-registry.example.json`.
- `packages/cli/src/args.test.ts`: `fleet runs-on` parse, refusals and usage line.

Every fixture uses `example-owner/example-app`.

## Acceptance

Automated:
- The new tests fail on the base and pass after the change (record both runs).
- `pnpm run ci:fast` exits 0.

Manual (local, read-only, no writes to any registry):
- `node packages/cli/dist/bin.js fleet runs-on --registry <copy of the private registry in the scratchpad> --id P3` prints one line that `parseGatedRunsOn` accepts. The copy stays in the session scratchpad and is never committed.
- `fleet verify` against a scratchpad copy of the registry exits with the existing `reverted` summary and no exception.

## Stop

Stop for acceptance. Record in the plan's handoff: commits, the red and green test evidence, and any deviation.
