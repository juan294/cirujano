# Cirujano: Devpost submission text

Updated 2026-10-27 for the Nebius x NVIDIA Global AI Hackathon (track: Coding and Agentic Engineering). Release and billing evidence refreshed on October 27; historical experiments retain their dates. Sources are in the table at the end. Private repository names stay out of this file.

## Project name

Cirujano

## Elevator pitch (200 characters max)

AI surgeon for your CI bill: NVIDIA Nemotron finds waste, Nebius Sandboxes verify supported cuts, and on-demand Nebius runners handle heavy jobs under explicit cost caps.

## Video

https://youtu.be/9c0nXuZfiOU

## Dated gallery caption

October 24 demo: -67% runner-minutes and 850 observed jobs. October 27 release and refreshed measurements are in the story.

## About the project

## Inspiration

I run more than twenty projects with AI coding agents. They push all day, and every push ran the full CI suite again. My GitHub Actions bill hit **$370 in July and $402 in August**. The agents made me faster, and CI made me pay for it twice.

Every team adopting coding agents is heading for the same wall: more pushes, the same checks run over and over, and a bill that grows with every commit. Deleting tests is not the answer. Cutting the waste is.

## What it does

**Cirujano** (Spanish for *surgeon*) operates on CI that works but costs too much. Its sibling entry, [Sutura](https://github.com/juan294/sutura), is the nurse for CI that breaks. The developer is the doctor who signs off on both.

1. **Diagnose.** Cirujano reads GitHub Actions billing and run history and ranks where the minutes go.
2. **Prescribe.** **NVIDIA Nemotron on Nebius Token Factory** proposes one bounded, supported cut, or abstains when nothing is safe.
3. **Prove.** Cirujano builds the patch itself, verifies it in **Nebius Token Factory Sandboxes** with the network off, then measures it on real runs.
4. **Ship.** It opens a pull request with before and after minutes. A developer approves it. Cirujano never auto-merges.
5. **Relocate.** Heavy work that can't be cut moves to on-demand **Nebius AI Cloud** VMs. The controller creates a VM when a job queues, then drains, stops and deletes it when idle, under explicit permits and cost caps. Startup and drain time count toward its runtime budget.

## The results so far

- **v0.1.0 is released.** The [tagged release](https://github.com/juan294/cirujano/releases/tag/v0.1.0) passed **1,801 automated tests**, typecheck, lint, build, CodeQL and an Ubuntu 24.04 boot test. Ten offline installed-CLI checks also passed.
- **−67% runner-minutes on merged pushes.** On the [public proof](https://github.com/juan294/cirujano-push-proof/pull/8), each eligible merge push dropped from 3 billed minutes to 1, and every pull request check was kept. A direct push still runs everything. This is runner-compute reduction on the recorded public benchmark, rather than a reduction in a GitHub invoice.
- **129 Sandbox scenarios, zero mismatches** before the guard ever touched a real run.
- **A whole optimization decision for $0.00012:** one Nemotron call, 1,115 tokens.
- **880 observed CI jobs on Nebius, with complete job timing.** The October 27 refresh records **3,660 job-minutes across 8 repositories** since September 13. Two gaps in overall snapshot coverage keep the full fleet study partial; complete net savings remain unmeasured. The October 24 video shows a real cycle: VM created, job run, VM deleted, 14 minutes end to end.
- **About 61% fewer private-repository CI minutes in the latest full week.** GitHub billing records show **833 minutes a day for October 20–26**, against **2,109 a day in July–August**. At the observed list prices, those usage rates correspond to about **$150 versus $380 over 30 days**. This is a fleet-wide observation across different workloads and CI changes, not a controlled estimate of Cirujano savings or net savings after Nebius costs.
- **It knows when to say no.** When an earlier idea, dependency caching, measured 3 minutes against 3, Cirujano opened no pull request. Every cut it ships has receipts.

## How I built it

- **TypeScript 6 / Node 22.13+ monorepo** with a core library, a CLI and a GitHub Action, tested with Vitest and bundled with esbuild.
- **NVIDIA Nemotron 3 Nano 30B A3B** through the OpenAI-compatible Nebius Token Factory API, with grammar-constrained JSON output. The model chooses from a closed set of operations. It never writes YAML.
- **A deterministic workflow classifier and patch builder** turn the model's choice into a minimal, reviewable diff that preserves what the workflow means.
- **Nebius Token Factory Sandboxes** run a push-guard harness in disposable, network-disabled images built server-side, across a 69-cell guard matrix and 60 classifier cases.
- **Billing truth from job timestamps.** GitHub's run timing endpoint reports zero, so Cirujano rebuilds billable minutes per job, rounded up the way GitHub bills.
- **On-demand runner controller.** A small control loop watches the queue, creates a Nebius AI Cloud VM with cloud-init, registers a one-job GitHub runner, then drains, stops and deletes it when idle. Every controller works under a signed permit with a cost cap. SQLite writer reservations keep controller ownership exclusive through crash recovery, and the controller enforces deadlines even when guest reports are missing.

## Challenges I ran into

- **The billing data lied.** `/actions/runs/{id}/timing` returns `total_ms: 0` on current GitHub, so I rebuilt cost from per-job start and end times.
- **Making a cheap change safe.** The merge-run guard skips work only when that exact tree already passed its pull request. Any missing proof, error or timeout means every job runs.
- **Constrained decoding quirks.** The Nemotron grammar rejected `uniqueItems`, and enum arrays could loop until `maxItems`, so I redesigned the schema around them.
- **Recovery and trustworthy evidence.** Simultaneous crash recovery exposed false lock conflicts from database readers. I fixed writer reservation, retained single-controller exclusion, and added regression tests. Reporting now refuses daily observation gaps and incomplete job inventories; SSH diagnostic matching also stays linear on repeated prefixes.
- **Real infrastructure edges.** The Sandboxes request limit (about 1 MiB), self-hosted runner versions that GitHub retires server-side, and a regional public-IP quota all shaped the design.

## Accomplishments that I'm proud of

- A published first release with independently reviewed fixes for concurrent recovery, controller deadlines, telemetry completeness and input validation.
- An optimizer that is allowed to say **no**, with abstention and no-improvement outcomes built in.
- A real cut with receipts, proven twice: first in Sandboxes, then on real billed runs.
- A real fleet: 880 observed CI jobs on on-demand Nebius runners across eight repositories.

## What I learned

- Most CI waste is re-verification, not slow tests.
- A model choosing among safe operations, plus a deterministic builder, beats a model writing config.
- Measure in billed, rounded minutes. Seconds saved don't always mean dollars saved.

## What's next for Cirujano

Every team shipping with AI agents should get CI that finds its own waste, proves every cut and runs heavy work only when it's needed: more software on the same budget.

- Make the released Action and CLI easier to adopt: a ranked waste report first, then explicitly permitted, verified pull requests.
- More cut families: path filters, right-sized test shards, and duplicate push and pull request runs.
- Pack heavy jobs onto shared Nebius VMs. My model shows about $120 a month net for my own fleet.
- Finish the runner study after its October 28 measurement window, reconcile controller costs and resolve or disclose the daily observation gaps before claiming complete net savings.
- Join up with Sutura: one loop that heals red CI and trims green CI, with the developer approving every change.

## Built with

typescript, node.js, pnpm, nvidia-nemotron, nebius-token-factory, nebius-token-factory-sandboxes, nebius-ai-cloud, github-actions, github-rest-api, github-cli, cloud-init, vitest, esbuild, yaml

## Try it out links

- https://github.com/juan294/cirujano/releases/tag/v0.1.0
- https://github.com/juan294/cirujano
- https://github.com/juan294/cirujano-push-proof/pull/8

## Judge-facing test build and refreshed answers

Test build: https://github.com/juan294/cirujano/releases/tag/v0.1.0

### Which Nebius platform capabilities were most valuable?

Three Nebius capabilities carry the product: 1. Token Factory API serves NVIDIA Nemotron 3 Nano through an OpenAI-compatible endpoint with constrained JSON decoding and usage metadata, so each decision has a model/token/cost receipt. 2. Token Factory Sandboxes provide disposable, network-disabled verification with server-built images and walkable lineage. The recorded public proof passed 69 guard cells and 60 classifier cases with zero mismatches. 3. Nebius AI Cloud CPU VMs (cpu-d3, 4 vCPU / 16 GiB) are created for queued work, registered as one-job GitHub runners through cloud-init, then stopped and deleted when idle, under explicit permits and cost caps. The October 27 refresh records 880 observed runner jobs and 3,660 measured job-minutes across 8 repositories since September 13. Overall snapshot coverage has two gaps, so complete fleet net savings remain unmeasured. v0.1.0 is published at https://github.com/juan294/cirujano/releases/tag/v0.1.0 and passed 1,801 tests, CodeQL and Ubuntu boot verification. The public proof and video remain linked in the project story.

### Experience running Nemotron inference on Nebius

8/10. No GPUs to manage and no local model setup: inference, verification Sandboxes and runner VMs came from one provider, which let a solo developer observe 880 real CI jobs across eight repositories as of October 27. The v0.1.0 release adds verified recovery, deadline, accounting and validation fixes. Points off for sharp edges I had to discover myself: the approximately 1 MiB Sandboxes request limit, digest-pinned images failing to import, and a quota of 3 public IPv4 addresses per project in eu-west1 during the recorded pilot. These are dated observations; the complete fleet net-savings study is still partial.

## Feedback on Nebius Token Factory, Nebius AI Cloud and NVIDIA tools

What worked: Token Factory's OpenAI-compatible API made Nemotron a drop-in. Sandboxes gave me exactly what a CI optimizer needs: disposable, network-disabled environments with walkable image lineage, so every verification is reproducible. Nebius AI Cloud CPU VMs started fast enough for queue-triggered runners. One Nemotron decision cost $0.00012.

What would help:

1. **Model IDs.** The console shows hyphens where the API uses underscores (for example "Nemotron-3.5-Lightning" in the console against `nvidia/Nemotron-3_5-Lightning` in the API). The hyphenated ID returns a 404 "model does not exist". Showing the exact API ID in the console, or accepting both, would save every newcomer an hour.
2. **Constrained decoding.** The Nemotron 3 Nano grammar rejects `uniqueItems` with a 400 but enforces `maxItems`, and enum arrays can repeat until they hit `maxItems`. A documented list of supported JSON Schema keywords would help.
3. **Sandboxes request size.** `POST /v1/instances` rejects bodies above about 1 MiB with a 413. The limit and the `/v1/files` plus `files` map workaround deserve a line in the docs.
4. **Sandboxes images.** Importing a Docker Hub image by digest returns 404 and `FROM image@sha256:` breaks `contree build`, while tags work. Digest pinning matters for reproducible verification.
5. **Sandboxes API shapes.** Running operations report `duration: -1` and clean exits report `signal: -1`. Documenting these sentinels would prevent fixture drift.
6. **AI Cloud quota.** eu-west1 has a hard quota of 3 public IPv4 addresses per project, which capped me at three concurrent runner VMs. Surfacing this in the VM create flow, or allowing egress without a public IP by default, would help CI-runner workloads.
7. **Reasoning models.** Nemotron 3.5 Lightning puts its chain of thought in `message.content` and bills it as reasoning tokens. A small `max_tokens` returns only preamble. A documented switch to suppress or separate the trace would help, like the `enable_thinking: false` template flag that works on Nano.

## Evidence for every number

| Claim | Source | Checked |
| --- | --- | --- |
| $370 July, $402 August | Billing usage API; `docs/research/2026-09-08-github-actions-cost-baseline.md` ($370.64, $401.78) | 2026-10-17 |
| 3 → 1 runner-minutes, every check kept | PR #8 on `juan294/cirujano-push-proof`; candidate runs 37920072110, 37920192411, 37920318553; control 37920425565; `cirujano estimate` | 2026-10-24 |
| 129 scenarios, zero mismatches | PR #8: 69 matrix cells and 60 classifier cases | 2026-10-17 |
| $0.00012, 1,115 tokens | PR #8 model record | 2026-10-17 |
| 880 observed jobs, 3,660 measured job-minutes, 8 repositories | Validated and deduplicated snapshots through 2026-10-27T05:17:42.970Z; all 880 runner jobs measured; overall coverage PARTIAL; `docs/research/2026-10-27-submission-measurement-refresh.md` | 2026-10-27 |
| Live cycle, 14 minutes | P5 controller log 2026-10-24: `create-vm` 06:39:38Z to `delete-vm` 06:53:33Z after dispatch at 06:39:08Z | 2026-10-24 |
| 2,109 → 833 minutes a day; about $380 → $150 per 30 days | Fresh billing API, consistent current private-repository scope: July–August against October 20–26; `docs/research/2026-10-27-submission-measurement-refresh.md` | 2026-10-27 |
| Cache idea saved nothing, no PR | `docs/demo/nemotron-optimization.md` (3 against 3 rounded minutes) | 2026-10-17 |
| About $120 a month modeled | Recording script "Time and money" table; assumes four runner slots per VM | Modeled, not measured |
| v0.1.0; 1,801 tests; CI and CodeQL passed | Published release at `e958e02501582b3b90afb5b7a2e48d9e080efaf4`; CI 40373845785, CodeQL 40373845679; local release smoke evidence | 2026-10-27 |
