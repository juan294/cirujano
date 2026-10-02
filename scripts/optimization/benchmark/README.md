# Public pnpm cache benchmark

This is a labeled benchmark of per-job minute aggregation. It is not a production workload or a measured saving. It installs real, pinned Vitest dependencies and executes 13 tests with V8 coverage. There are no sleeps, padded dependencies or substituted timers. A short install can legitimately produce `no-improvement` under the product's whole-job thresholds.

Use Node 22.20.0 and pnpm 10.11.0. From this directory:

```sh
pnpm install --frozen-lockfile --ignore-workspace
pnpm test
```

The template `ci.yml.template` belongs at `.github/workflows/ci.yml` only in the separately approved proof repository. The baseline lacks a pnpm cache. The pinned setup-node implementation auto-detects only npm, as shown in [its exact source](https://github.com/actions/setup-node/blob/820762786026740c76f36085b0efc47a31fe5020/src/main.ts#L144); this package's `pnpm@10.11.0` field does not enable implicit caching. Explicit cache-disable intent is unsupported by the optimizer and must not be introduced. The accepted model decision can add only `cache: pnpm` and `cache-dependency-path: pnpm-lock.yaml` to the existing pinned setup-node step. All other bytes, commands, runtime pins, test IDs and coverage counters remain fixed.

The proof checkout must also contain the unchanged built `reporter.mjs` and `controller.mjs` from the accepted Cirujano source, a generated `reporter.json`, and `.cirujano/optimization-profile.json` copied from `optimization-profile.json`. Bind the reporter configuration to the actual Cirujano tool commit, controller bundle SHA-256 and absolute pnpm executable path. Pinned pnpm/action-setup v4 defaults to `/home/runner/setup-pnpm/node_modules/.bin/pnpm` on the selected hosted runner. Its approved Sandbox image must expose that same path as a trusted read-only alias of its pinned `/usr/local/bin/pnpm`; do not mutate the source configuration or command list between environments. The reporter brackets the existing coverage command and writes `quality.json` for the pinned artifact upload. Read its actual schema in `packages/cli/src/optimization/quality-reporter-entry.ts`; never invent a tool SHA or repository ID.

Only push to the proof repository's documented `develop` integration ref after the local and Sandbox gates and explicit publication authority. Its template triggers one test job on `develop` pushes and manual dispatch, with read-only contents permission and no deployment, PR or `main` trigger. Fix the six-attempt cohort before reading results: three baseline, then the first cold candidate and two subsequent candidate attempts. Include cache overhead and failed attempts. A failure stops the batch.

Delete local generated reports before a fresh reporter bracket. Preserve prior receipts privately first. Both variants use the same reporter and profile. An isolated offline Sandbox uses a trusted pre-fetched dependency store prepared from package metadata and lockfile only; it does not supply GitHub cache timing evidence.
