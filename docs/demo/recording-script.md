# Cirujano recording script (final)

Final version, 2026-10-17. Audience: hackathon judges and developers who pay for private GitHub Actions minutes. Target **2:50**, hard stop before 3:00. Read only the blockquotes aloud; everything else is screen direction or evidence. The narration is about 360 words, so at 140-150 words per minute the tables have time to register.

## The story

**More software for the same engineering budget.** Open on that future, make the pain personal, show one verified cut working end to end, show Nebius carrying the work that cannot be cut, connect it to Sutura, and finish on what it has saved so far. The headline result is the controlled proof (3 runner-minutes to 1, every pull request check unchanged). The account-wide drop is supporting evidence, spoken as early and still being measured.

Every product shot is real: the CLI, the generated evidence PR, its diff and the GitHub runs. Provider results are recorded evidence and are labeled that way. Rehearsal and recording need no new inference, Sandbox execution, workflow dispatch, runner start, publication or merge.

## Prepare the screen once

Use a clean browser profile, Do Not Disturb, a large terminal font and 125-150% browser zoom. Hide bookmarks, account menus and unrelated tabs. **Private repository names never appear on camera**, and the GitHub billing page stays closed because it lists them.

Open in this order:

1. [Recording cards](recording-cards.html), opened locally in the browser (`open docs/demo/recording-cards.html`). Press `f` for full screen, arrow keys or click to move, `h` to hide the card counter. Keep this script on a second display, outside the capture.
2. [Cost baseline](../research/2026-09-08-github-actions-cost-baseline.md), rendered on GitHub, at **Monthly bill**.
3. [Evidence PR #8](https://github.com/juan294/cirujano-push-proof/pull/8), body near **Model requested** and **Sandbox**. Read back as OPEN on 2026-10-17, base `d5dc444`, head `b359f3b`.
4. [PR #8 Files changed](https://github.com/juan294/cirujano-push-proof/pull/8/files). Find the `cirujano_validated_push` job and one added job condition beforehand. Do not scroll the embedded classifier while speaking.
5. Runs: [PR run, three checks green](https://github.com/juan294/cirujano-push-proof/actions/runs/37920229570), [baseline push](https://github.com/juan294/cirujano-push-proof/actions/runs/37919235519), [optimized push](https://github.com/juan294/cirujano-push-proof/actions/runs/37920318553), [direct-push control](https://github.com/juan294/cirujano-push-proof/actions/runs/37920425565).
6. [Runner pilot](../research/2026-09-15-nebius-runner-pilot-r14.md) at **R14 rows at the final candidate**. Recorded September evidence, not a live dashboard.
7. [Cirujano Actions](https://github.com/juan294/cirujano/actions), showing the Sutura rows "Repair requested: CI #110 (failure)" and "No repair needed: CI #114 (success)".

Terminal, in the repository root. Stage the two API reads before recording; run only the two `estimate` commands on camera:

```sh
gh api repos/juan294/cirujano-push-proof/actions/runs/37919235519/jobs > /tmp/cirujano-demo-baseline-jobs.json
gh api repos/juan294/cirujano-push-proof/actions/runs/37920318553/jobs > /tmp/cirujano-demo-candidate-jobs.json
node packages/cli/dist/bin.js estimate --jobs /tmp/cirujano-demo-baseline-jobs.json
node packages/cli/dist/bin.js estimate --jobs /tmp/cirujano-demo-candidate-jobs.json
```

Expected: `Billable minutes: 3` with 0 skipped jobs, then `Billable minutes: 1` with 3 skipped jobs (re-checked 2026-10-17). If `packages/cli/dist` is missing, run `pnpm run build` first. Never fake terminal output.

## Timed narration and screen choreography

### 0:00-0:16 | The future

**Show:** card 1, Opening. Hold it for a beat before speaking. No code, no logo animation.

> Imagine every development team shipping more software on the same budget, because their CI removes its own waste, with proof. That's Cirujano: verified CI cost surgery, built on NVIDIA Nemotron and Nebius.

### 0:16-0:32 | Why I needed it

**Show:** the cost baseline page. Point at $370.64 and $401.78, then scroll to **Where the minutes go**.

> It started with my own bill. My AI agents push all day, and GitHub Actions cost me 386 dollars a month. Two workflows used about 70 percent, and every push ran the full suite.

### 0:32-0:51 | How it works on Nebius

**Show:** card 2, Reason, verify, execute. Then PR #8 body: the model line, token counts and the Sandbox line. Small caption: "Recorded live proof, 2026-10-09".

> Cirujano reads billing and run history to find where the minutes go. NVIDIA Nemotron, on Nebius Token Factory, proposes one bounded cut, or abstains. Cirujano builds the patch itself, verifies it in Nebius Sandboxes, and opens a pull request. A human decides.

### 0:51-1:09 | The actual change

**Show:** PR #8 Files changed. Point at `cirujano_validated_push`, then one job's added condition. Switch to the PR run with lint, test and build green.

> Here is a live cut on a public proof repository. Each merge was re-testing code its pull request had already passed. Cirujano added a guard: skip the merge run only when that exact tree already passed.

### 1:09-1:31 | The result, with receipts

**Show:** run both `estimate` commands (3, then 1). Then the PR body measurement table, pausing on baseline 3 and candidate 1. Then the direct-push control run with every job green. End on card 3, Evidence.

> Sandboxes checked the guard with the network off: 129 scenarios, zero mismatches. Then GitHub measured it. Each merged push used one runner-minute instead of three, and a direct push still ran everything. When an earlier idea saved nothing, Cirujano opened no pull request.

### 1:31-1:50 | Heavy work moves to Nebius

**Show:** card 4, On-demand runners. Then the runner pilot table: queue and execute, idle stop, restart and failure. Do not present the card's lifecycle as live provider footage.

> Work that can't be cut, like databases and end-to-end tests, moves to Nebius AI Cloud. A VM starts when a job queues and stops when the queue empties. 800 of my real CI jobs have already run this way.

### 1:50-2:08 | Better together with Sutura

**Show:** card 5, Together. Then the Cirujano Actions tab with the two Sutura rows. Do not start a Sutura walkthrough.

> Cirujano's sibling, Sutura, is my other entry. Cirujano's audit recommended fast checks on every push and the full suite nightly. Sutura now owns that cadence and requests a repair when a run fails. Less CI, without trusting it less.

### 2:08-2:38 | What it saved me

**Show:** card 6, Results. Point at the proof line first, then the early account line, then the feedback line. Keep the card's "early, not an invoice" label in frame.

> What has it saved me? On the proof, two of every three runner-minutes on merged pushes. Across my private repositories, the first days on the new cadence used 164 CI minutes a day instead of about 2,100. At list price, that's about 30 dollars a month instead of 380. It's early and activity varies, so I keep measuring. Routine feedback now arrives in about 20 seconds; the full suite runs nightly.

### 2:38-2:50 | Close

**Show:** card 7, Closing. Slow down for the last line.

> We've shown verified waste removal on real pipelines. Next: every development team, continuously. Cirujano. Keep every check. Cut every wasted dollar.

## Practice three passes

1. **Screen only.** Move through the surfaces on the timestamps. Keep the pointer still except to highlight the named evidence.
2. **Voice and screen.** Read the nine blocks at 140-150 words per minute. If a section runs long, move on at its next timestamp. Never rush the results segment.
3. **One full take.** Start the timer on the first word. Check that the diff, the green PR run, the optimized push, the control and the results card were readable. Finish by 2:50; cut dead time before cutting proof.

If a page loads slowly mid-take, stop and redo that segment. Prefer clean cuts to typing credentials, waiting for cloud boot or triggering paid operations on camera.

## Recording checklist

- Record the voice-over separately from the screen capture, 1080p or higher, so beats can be re-timed without re-recording audio.
- Say "Nebius Token Factory", "NVIDIA Nemotron" and "Nebius AI Cloud" clearly. Pick one pronunciation of Cirujano (see-roo-HAH-no) and keep it.
- **Refresh the account numbers the morning you record.** The results line uses October 14-16. Ask Claude to re-read the billing API; if the new window differs, update the card and the narration together.
- **Runner footage:** use the recorded pilot. A fresh push to start a VM on camera is not covered by this script: confirm that the operating permit covers it before trying.
- No music unless you own the track. Upload to YouTube as public, with captions; an `.srt` can be generated once the narration is locked.

## What we used

The narration names the runtime platforms. Use the rest for judge questions.

| Technology | Role | Evidence |
| --- | --- | --- |
| NVIDIA Nemotron 3 Nano 30B A3B | Proposes one supported operation or abstains; live model `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | PR #8 model and token record |
| Nebius Token Factory inference API | Hosts the model call through an OpenAI-compatible API | PR #8, [live chain](../research/2026-10-09-skip-validated-push-live-proof.md#chain) |
| Nebius Token Factory Sandboxes | Runs the push-guard verification harness in disposable, network-disabled isolation | PR #8: 69 matrix cells, 60 classifier cases |
| Nebius AI Cloud | CPU VMs and disks for one-job-at-a-time on-demand runners | [Runner pilot](../research/2026-09-15-nebius-runner-pilot-r14.md) |
| GitHub Actions, REST API and GitHub CLI | Run and job evidence, rounded-minute estimates, PR identity and readback | Runs, `gh api`, `cirujano estimate` |
| TypeScript 6, Node 22, pnpm | Product runtime and workspace | [Stack](../../CLAUDE.md#stack) |
| YAML parser, deterministic classifier, bounded patch builder | Keep the model to supported edits and preserve workflow meaning | PR diff, [guard description](nemotron-optimization.md#skip-validated-pushes) |
| Docker/OCI images, cloud-init, Actions runner | Sandbox images and cloud runner bootstrap | [Technical demo](nemotron-optimization.md), [runner pilot](../research/2026-09-15-nebius-runner-pilot-r14.md) |
| Vitest, V8 coverage, ESLint, TypeScript, esbuild | Product verification, quality comparisons, bundles | [Contributor setup](../../README.md#contributor-setup) |
| Daily telemetry, macOS launchd controller | Fleet usage collection and the owner-hosted runner control loop | [Telemetry runbook](../runbooks/fleet-telemetry.md) |

The Cirujano proof did not use Sutura's Nemotron Super and Ultra roles, Tavily, GPU runners, Kubernetes, fine-tuning or an automatic Sutura-Cirujano hand-off.

## Every spoken claim and its source

| Spoken claim | Evidence | Status |
| --- | --- | --- |
| $386 a month | Billing page: July $370.64, August $401.78 ([baseline](../research/2026-09-08-github-actions-cost-baseline.md#monthly-bill)); same totals from the billing usage API, read 2026-10-17 | VERIFIED |
| Two workflows used about 70 percent | Baseline, "Where the minutes go" | VERIFIED sample, INFERRED total |
| Every push ran the full suite | [Cadence assessment](../research/2026-10-02-ci-cadence-assessment.md): full CI on routine changes before the lean cadence | VERIFIED |
| Nemotron proposes or abstains | PR #8 model record; six live push cases passed, including two abstentions and an injection case ([live proof](../research/2026-10-09-skip-validated-push-live-proof.md#live-model-evaluation)) | VERIFIED, small labeled corpus |
| 129 scenarios, zero mismatches, network off | PR #8: 69 guard-matrix cells plus 60 classifier cases | VERIFIED |
| One runner-minute instead of three; direct push ran everything | Candidates 37920072110, 37920192411, 37920318553 billed 1; baselines billed 3; control 37920425565 ran all jobs and billed 4 ([measured runs](../research/2026-10-09-skip-validated-push-live-proof.md#measured-runs)); `cirujano estimate` re-checked 2026-10-17 | VERIFIED |
| An earlier idea saved nothing, no PR opened | Cache family, 3 against 3 rounded minutes ([live outcome](nemotron-optimization.md#live-outcome)) | VERIFIED |
| VM starts on queue, stops when idle | [Runner pilot](../research/2026-09-15-nebius-runner-pilot-r14.md), 2026-09-15 | VERIFIED |
| 800 real CI jobs on Nebius | Scheduled fleet telemetry, 2026-09-13 to 2026-10-17T04:17Z: 800 Cirujano jobs, 3,297 minutes | VERIFIED usage; not a savings claim |
| Cirujano's audit recommended the cadence | [Cadence assessment](../research/2026-10-02-ci-cadence-assessment.md), 2026-10-02 | VERIFIED |
| Sutura owns the cadence, requests repairs | Owner decision 2026-10-16; public Cirujano Actions: "Repair requested: CI #110 (failure)", 2026-10-14 | VERIFIED request; a request is not a completed repair |
| 164 instead of about 2,100 CI minutes a day; $30 instead of $380 at list price | Billing usage API, private repositories: 2,109 min and $12.66 list a day (July-August) against 164 min and $0.98 a day (October 14-16), times 30 | VERIFIED observation; NOT attributed (see below) |
| Routine feedback in about 20 seconds; full suite nightly | `gh run list`, three private repositories, successful runs October 9-17: fast-lane median 0.3 min wall clock; the full suite runs separately | VERIFIED; a different amount of verification, not a faster full suite |

### Answers to keep precise when judges ask

| Question | Safe answer |
| --- | --- |
| "Is 92 percent your saving?" | No. It is an observed usage drop over three days after the cadence switch. Releases in the heaviest repository were paused and activity was not normalized, so part of it may be lower activity. The causal result is the controlled proof. |
| "What did it save you in dollars?" | The public proof saves $0 on an invoice (public minutes are free); it proves compute reduction. The private account observation is list price, before included minutes, Nebius, inference and Sandbox costs. A matched 45-day runner study closes 2026-10-28. |
| "Do the runners save money?" | Not yet established. The latest report has $18.84 gross hosted cost avoided against $19.87 controller-accounted Nebius cost, with incomplete accounting and net savings unavailable. Packing four jobs per VM is modeled at about $30 a month instead of $155; it is not built. |
| "Is the 67 percent faster delivery?" | No. It is 66.7% fewer rounded runner-minutes on three sampled eligible merge pushes. Jobs ran concurrently, so it is not six minutes of human waiting. |
| "What about direct pushes?" | They run every check plus the one-minute classifier (four minutes in the control). One-minute workflows cannot benefit, and the model is expected to abstain. |
| "Do the two products hand off automatically?" | No. Sutura owns cadence coordination and requests repairs; Cirujano supplies cost evidence and verified optimizations. A direct automated hand-off is not built. |
| "Did you save developer hours?" | Not measured. Routine feedback is earlier; full verification still runs nightly and before release. |

### What was not claimed, and why

- **"$386 to $81."** September billed $81.16, but the heaviest repository's minutes fell to about 10 a day from 2026-08-22, before any Cirujano change shipped.
- **$4,000+ a year.** An annualized gross projection on a three-day window is too thin to say aloud.
- **Runner break-even or net savings.** Accounting is incomplete.

### Evidence refresh, 2026-10-17

Prepared on Cirujano `develop` `6e63d5f`. The live optimizer result stays bound to tool `49c934d` and proof candidate `b359f3b`. GitHub readback confirmed PR #8 open with its base and head, and the baseline, candidate and control jobs. The CLI returned 3 and 1 billable minutes on the fetched public jobs. The offline evaluation passed 27 synthetic cases with zero inference calls. Billing figures come from the GitHub billing usage API, read 2026-10-17; private repository names and raw rows stay outside this public repository. No proof workflow or paid provider operation was rerun.
