# Cirujano: Devpost submission text

Prepared 2026-10-24 for the Nebius x NVIDIA Global AI Hackathon (track: Coding and Agentic Engineering). Evidence refreshed the same day; sources are in the table at the end. Private repository names stay out of this file.

## Project name

Cirujano

## Elevator pitch (200 characters max)

AI surgeon for your CI bill: NVIDIA Nemotron finds the waste, Nebius Sandboxes prove every cut keeps every check, and heavy jobs run on Nebius VMs that exist only while they work.

## Video

https://youtu.be/9c0nXuZfiOU

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
5. **Relocate.** Heavy work that can't be cut moves to **Nebius AI Cloud** VMs that are created when a job queues and deleted when the queue is empty. You pay only while work runs.

## The results so far

- **−67% runner-minutes on merged pushes.** On the [public proof](https://github.com/juan294/cirujano-push-proof/pull/8), each eligible merge push dropped from 3 billed minutes to 1, and every pull request check was kept. A direct push still runs everything.
- **129 Sandbox scenarios, zero mismatches** before the guard ever touched a real run.
- **A whole optimization decision for $0.00012:** one Nemotron call, 1,115 tokens.
- **850 real CI jobs on Nebius.** About 3,500 job-minutes from 8 repositories have run on on-demand Nebius VMs since September 13. The video shows a live cycle: VM created, job run, VM deleted, 14 minutes end to end.
- **From about 2,100 to under 800 CI minutes a day.** Since my private repositories moved to the cadence Cirujano recommended, CI fell from a July-August average of 2,109 minutes a day to 778 (October 17-23). That's roughly **$380 down to $140 a month** at list price.
- **It knows when to say no.** When an earlier idea, dependency caching, measured 3 minutes against 3, Cirujano opened no pull request. Every cut it ships has receipts.

## How I built it

- **TypeScript 6 / Node 22 monorepo** with a core library, a CLI and a GitHub Action, tested with Vitest and bundled with esbuild.
- **NVIDIA Nemotron 3 Nano 30B A3B** through the OpenAI-compatible Nebius Token Factory API, with grammar-constrained JSON output. The model chooses from a closed set of operations. It never writes YAML.
- **A deterministic workflow classifier and patch builder** turn the model's choice into a minimal, reviewable diff that preserves what the workflow means.
- **Nebius Token Factory Sandboxes** run a push-guard harness in disposable, network-disabled images built server-side, across a 69-cell guard matrix and 60 classifier cases.
- **Billing truth from job timestamps.** GitHub's run timing endpoint reports zero, so Cirujano rebuilds billable minutes per job, rounded up the way GitHub bills.
- **On-demand runner controller.** A small control loop watches the queue, creates a Nebius AI Cloud VM with cloud-init, registers a one-job GitHub runner, then drains, stops and deletes it when idle. Every controller works under a signed permit with a cost cap.

## Challenges I ran into

- **The billing data lied.** `/actions/runs/{id}/timing` returns `total_ms: 0` on current GitHub, so I rebuilt cost from per-job start and end times.
- **Making a cheap change safe.** The merge-run guard skips work only when that exact tree already passed its pull request. Any missing proof, error or timeout means every job runs.
- **Constrained decoding quirks.** The Nemotron grammar rejected `uniqueItems`, and enum arrays could loop until `maxItems`, so I redesigned the schema around them.
- **Real infrastructure edges.** The Sandboxes request limit (about 1 MiB), self-hosted runner versions that GitHub retires server-side, and a regional public-IP quota all shaped the design.

## Accomplishments that I'm proud of

- An optimizer that is allowed to say **no**, with abstention and no-improvement outcomes built in.
- A real cut with receipts, proven twice: first in Sandboxes, then on real billed runs.
- A real fleet: 850 production CI jobs on Nebius, not a toy demo.

## What I learned

- Most CI waste is re-verification, not slow tests.
- A model choosing among safe operations, plus a deterministic builder, beats a model writing config.
- Measure in billed, rounded minutes. Seconds saved don't always mean dollars saved.

## What's next for Cirujano

Every team shipping with AI agents should get CI that finds its own waste, proves every cut and runs heavy work only when it's needed: more software on the same budget.

- Ship Cirujano as an install-and-go GitHub Action: a ranked waste report on day one and verified pull requests after.
- More cut families: path filters, right-sized test shards, and duplicate push and pull request runs.
- Pack heavy jobs onto shared Nebius VMs. My model shows about $120 a month net for my own fleet.
- Close the 45-day runner study on October 28 with full net cost.
- Join up with Sutura: one loop that heals red CI and trims green CI, with the developer approving every change.

## Built with

typescript, node.js, pnpm, nvidia-nemotron, nebius-token-factory, nebius-token-factory-sandboxes, nebius-ai-cloud, github-actions, github-rest-api, github-cli, cloud-init, vitest, esbuild, yaml

## Try it out links

- https://github.com/juan294/cirujano
- https://github.com/juan294/cirujano-push-proof/pull/8

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
| 850 jobs, about 3,500 minutes, 8 repositories | Fleet telemetry 2026-09-13 to 2026-10-24T04:24Z: 849 Cirujano jobs, 3,518 minutes; plus run 40071041431 on 2026-10-24 | 2026-10-24 |
| Live cycle, 14 minutes | P5 controller log 2026-10-24: `create-vm` 06:39:38Z to `delete-vm` 06:53:33Z after dispatch at 06:39:08Z | 2026-10-24 |
| 2,109 → 778 minutes a day; about $380 → $140 a month | Billing usage API, private repositories: July-August average against October 17-23, list price | 2026-10-24 |
| Cache idea saved nothing, no PR | `docs/demo/nemotron-optimization.md` (3 against 3 rounded minutes) | 2026-10-17 |
| About $120 a month modeled | Recording script "Time and money" table; assumes four runner slots per VM | Modeled, not measured |
