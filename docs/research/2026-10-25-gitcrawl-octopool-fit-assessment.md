# Gitcrawl and Octopool fit assessment

Date: 2026-10-25. Status: assessment complete; adoption benefits unmeasured.

## Question and recommendation

Does the OpenClaw project described as “Git Glaw” address agent-driven GitHub rate limits, and should Cirujano use it?

The best match is **openclaw/gitcrawl**. This identity is an inference from the name, ownership and stated purpose; no original announcement was supplied. Gitcrawl is a local issue/PR archive and triage tool. Its former GitHub CLI compatibility cache moved to **openclaw/octopool**, which is the more direct rate-limit product.

Do not add either as a mandatory Cirujano dependency now. Gitcrawl is a plausible optional research tool for agents. Octopool merits a narrowly scoped public-repository read experiment only if measured duplicate traffic justifies its operating cost. Its public-only relay does not cover Cirujano's private-repository runner workload. Retain Cirujano's existing evidence collection and freshness contracts. CI cadence and routing remain Sutura-owned.

## Scope, identity and method

Authorized scope: read-only external research and repository assessment, plus this local assessment artifact. No installation, credential change, API proxy configuration, cloud deployment, runner operation or publication was performed.

Cirujano integration baseline: `develop` at `75dbd45aab719ac96ccc114de549fcea02751ca7`. Actual workspace: `/Users/juan/code/cirujano`, branch `chore/update-pins-2026-10-25`, HEAD `30d54716b5d122732ad0c965f95917c7799c5447`. The workspace was clean at entry. A focused diff confirmed that all Cirujano source files cited below, CLAUDE.md and AGENTS.md are identical to integration. The unrelated existing branch and its commits were preserved.

Graphify was queried first for the GitHub clients, polling and runner relationships; its October 25 generation supplied navigation only. Findings were confirmed in source. Public upstream repositories were shallow-cloned into `/tmp/cirujano-gitcrawl-assessment.BSeXap/` without executing their code:

- Gitcrawl main: `f1c40bc03f86cb3325e5820673b76cc0d0ccdc11`; latest changelog release heading is 0.17.0, dated October 23.
- Octopool main: `20adb9c8457fd8a811238e94aed1419236724fcb`; latest changelog release heading is 0.9.10, dated October 24, with additional unreleased changes.

These are inspected source identities, not claims that release binaries or deployed services match them. Documentation and primary sources were retrieved on October 25. No runtime compatibility test, traffic benchmark, production-state audit or comprehensive security audit was performed.

Criteria: data/endpoint coverage; private-repository access; freshness and completeness; CLI compatibility; credential boundaries; maintenance and operating cost; measurable benefit; migration risk.

## What the projects actually do

### Gitcrawl

Gitcrawl mirrors issues and PRs into SQLite, with local keyword search, JSON output, a terminal browser, optional summaries/embeddings and related-thread clustering. It supports incremental sync, portable snapshots and optional remote archives. Normal sync/search does not require an LLM; summary and embedding operations add an inference dependency. Both upstream projects use MIT licenses. See the [Gitcrawl README](https://github.com/openclaw/gitcrawl/blob/f1c40bc03f86cb3325e5820673b76cc0d0ccdc11/README.md).

Its quota benefit comes from acquiring information once and querying the retained archive repeatedly. Sync still consumes GitHub quota. Deep hydration can fetch comments, reviews, files, commits, checks and workflow runs; full PR details and reviews are fetched again on selected syncs because parent timestamps alone do not prove they are unchanged. It exposes coverage and partial failures rather than treating all retained data as current. See the [sync contract](https://github.com/openclaw/gitcrawl/blob/f1c40bc03f86cb3325e5820673b76cc0d0ccdc11/docs/sync.md).

This is more capable than an issue-only cache, but the reviewed PR hydration path fetches workflow runs by PR head SHA, not Cirujano's complete attempt/job cost history: upstream `internal/syncer/pull_details.go:58`, `internal/syncer/pull_details.go:82`. Its workflow-run table is keyed by repository and run, not a cost ledger keyed by run attempt and job: upstream `internal/store/schema.go:331`. No equivalent replacement for Cirujano's runner registration, ownership or accounting contracts was established.

The old `gitcrawl gh` command now exits with a migration notice. The current [migration document](https://github.com/openclaw/gitcrawl/blob/f1c40bc03f86cb3325e5820673b76cc0d0ccdc11/docs/gh-shim.md) explicitly assigns the shared read relay and CLI cache to Octopool. Older skill examples recommending `gitcrawl gh --live` should not guide a new integration.

### Octopool

Octopool is a self-hosted GitHub read relay with a Go CLI/shim and Cloudflare Worker, D1 cache and Durable Object coordination. It shares cached responses, coalesces identical misses, uses token-free public transports where supported, and selects among eligible PAT/App identities for other reads. Writes and unsupported/private reads retain local native-GitHub-CLI handling. Deployment requires an organization membership boundary, identities and Cloudflare infrastructure; its README calls for the Workers Paid plan. See the [pinned README](https://github.com/openclaw/octopool/blob/20adb9c8457fd8a811238e94aed1419236724fcb/README.md).

The relay's public-only restriction is explicit code, not just a deployment default: upstream `src/public-repos.ts:258` rejects a repository that is not explicitly public, and `src/public-repos.ts:557` emits `repo_not_public`. Self-hosting does not remove this restriction.

Counterevidence to dismissing it entirely: it supports Actions run lists, exact attempts, and attempt-specific jobs (`src/route-manifest.ts:279`). Public cost-history reads therefore have real endpoint overlap with Cirujano. However, `/user/repos` inventory remains native, runner-management routes are absent from the reviewed route manifest, and caller conditional headers bypass shared response caching. See [relay documentation](https://docs.octopool.dev/relay.html) and [cache semantics](https://docs.octopool.dev/cache.html).

## Rate-limit qualification

These tools reduce or distribute requests; they do not remove GitHub's limits. Five PATs belonging to one user do not provide five independent personal quotas. GitHub documents that PAT and user-authorized app traffic shares the user's budget, while installation tokens use installation budgets. Independent eligible identities matter, not raw token count. Secondary limits still apply. This qualifies Octopool's simplified pooled-headroom example. See [GitHub's primary and secondary limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

Authenticated conditional reads returning 304 do not consume primary quota. They still involve an upstream request; the benefit depends on actual 304 responses. See [GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).

## Current Cirujano evidence

| Concern | Verified source behavior | Implication |
| --- | --- | --- |
| Purpose | Cost evidence, verified workflow optimization and on-demand runners: `CLAUDE.md:3` | Issue/PR triage is adjacent to the product, not its central data model. |
| Fleet telemetry | Enumerates owned repositories, completed runs, each retry attempt and attempt-specific jobs: `packages/cli/src/telemetry-service.ts:77` | Needs broader coverage than PR-linked workflow summaries. |
| Existing historical reuse | Loads a prior snapshot and reuses jobs only for matching reusable run evidence: `packages/cli/src/telemetry-service.ts:50`, `packages/cli/src/telemetry.ts:243` | Avoids some repeat job acquisition already; do not assume every collection refetches every job. |
| Private runner scope | Requires a private, non-fork repository: `packages/runner/src/adapters/github.ts:224` | Octopool's relay rejects the exact repository class used here. |
| Existing polling protection | ETag conditional reads, matching-304 reuse, bounded cache, 403/429 backoff and a 2,000-Core-request reserve: `packages/runner/src/adapters/github.ts:4`, `packages/runner/src/adapters/github.ts:572`, `packages/runner/src/adapters/github.ts:631` | This is an adapter-local guard, not a shared account budget. Cache and holds are in-memory. |
| Freshness and identity | Joins run attempts, head SHAs, repository identity and runner ownership; incomplete inputs remain incomplete: `packages/runner/src/adapters/github.ts:434` | An archive or bounded stale response must not silently become current lifecycle evidence. |
| Executable selection | Defaults to an absolute gh path; runner allows an explicit absolute override: `packages/cli/src/github-api.ts:20`, `packages/cli/src/runner-service.ts:185` | Installing a PATH shim alone would not transparently integrate these callers. |

The source guard's presence does not establish its live deployment, current hit rate or saved quota. Those remain unmeasured here.

## Options and disposition

| Option | Fit | Disposition |
| --- | --- | --- |
| Gitcrawl as Cirujano's API backend | Poor: issue/PR-centric archive, different output contracts, no verified cost/runner replacement | Reject for current core integration. |
| Gitcrawl for agent research | Useful when many agents repeatedly read the same discussions; adds sync/storage maintenance and optional model cost | Conditional candidate; validate repeated-read demand first. Keep final decisions tied to current source state. |
| Octopool for the private runner fleet | Poor: public-only relay, native fallback retains original quota pressure | Reject for this use case in current upstream form. |
| Octopool for repeated public Actions/PR reads | Plausible endpoint overlap and cross-client deduplication; adds cloud operations, credential custody and compatibility work | Conditional experiment, not adoption. |
| Retain existing collectors and assess shared private-safe read coordination | Closest match to current scope; existing guard/reuse helps, but cross-process coordination requires design | Preferred direction if measurement confirms a remaining common quota bottleneck. No implementation selected. |

A private-capable shared service would need authorization-aware cache isolation, revocation, account/resource budget coordination and explicit freshness/provenance contracts. Removing Octopool's public guard would be a substantial security/architecture fork, not a configuration tweak. No recommendation to do that is made.

## What could reverse the recommendation

First establish a representative request inventory: caller, endpoint family, public/private scope, repeat frequency, upstream requests, 304/cache outcomes, throttles and required freshness. No private payloads are needed for this measurement. A public-read pilot becomes attractive if most avoidable requests are supported public endpoints and measured saved quota/latency exceeds sync, proof, cloud and maintenance overhead.

Compatibility evidence would need to cover Cirujano's `--include` header parsing, `--paginate --slurp`, exact run attempts, complete pagination, quota-header identity, expiry/deletion, stale denial and native fallback. Compare returned job identities/timestamps and completeness before accepting savings. Count visibility and membership probes as upstream work; cache-hit counts alone are not saved-request counts.

Private-runner adoption would require a genuinely private-capable upstream design plus qualification against Cirujano's lifecycle contracts. More stars or more pooled tokens would not resolve the current incompatibility.

## Durable handoff

Findings: F1 project identity resolved to the best-supported Gitcrawl interpretation, subject to an original-link correction; F2 shim migration verified; F3 private-runner incompatibility confirmed and core adoption rejected; F4 public Actions overlap confirmed and retained as conditional; F5 existing Cirujano reuse/guard verified in integration-equivalent source; F6 live traffic benefit and runtime compatibility remain unmeasured, not blockers to this assessment.

Checks: public source retrieval and exact commit capture completed; Graphify orientation followed by source reads completed; relevant source equality with develop confirmed. No application behavior changed, so application test/build gates were not run. Only this research document was added; no commit or push was performed. No original plan existed or was changed. The workspace was on a pre-existing non-integration branch, so integration-equivalent source was verified without switching branches.

Final workspace check found concurrent edits outside this assessment: `.github/workflows/ci.yml`, runner scheduler tests, runner installation/render/boot scripts, and new runner-release fixtures, tests and resolver. These were not made or altered by this assessment. The cited implementation files remain unchanged; the final workspace is not clean. The assessment's local file references and whitespace were checked.

Next phase, if requested: design a bounded traffic measurement and optional tool trial. Revalidate local refs, upstream versions and endpoint contracts first. Any CI cadence/routing work must be coordinated in Sutura. Deployment, identity/provider changes and publication require their own authorization. The assessment itself requires no pending owner decision.
