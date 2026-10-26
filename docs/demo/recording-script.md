# Cirujano demo video: recording script

Final version, 2026-10-18. Record this for the hackathon. Target **2:55**, export below **3:00** including the intro card and the end card. Track: Coding and Agentic Engineering.

This version follows the production playbook learned on the Sutura video (2026-10-17 and 2026-10-18): numbered beats with **Show** and **Say** blocks, one clip per beat, a live run on camera, still cards rendered at 4K, and a fitted ElevenLabs voice-over. The **Say** blocks are the only lines the narrator reads and the only text the voice step consumes; everything else stays out of quote syntax inside the Script section.

## The pitch to remember

**Every development team ships more software on the same budget, because CI removes its own waste and proves every cut. Nebius makes it practical.**

Metaphor rule (owner decision 2026-10-18): Cirujano (Spanish for surgeon) is the **surgeon**, who operates on CI that works but costs too much. Sutura is the **nurse**, who triages and stitches CI that breaks. The developer is the **doctor** who signs off on both. Never call Sutura a surgeon.

Open big, then make it tangible: one real cut, proven twice (Sandboxes, then real runs); one live on-demand runner on Nebius AI Cloud; then close on what is measured today and on the next measurement. Be ambitious about the future and exact about the numbers.

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) and [organizer video guidance](https://nebiusglobalaihackathon.devpost.com/updates/46205-how-to-build-a-winning-project) ask for functioning software, public YouTube, under three minutes, a pitch and not a tutorial, and audible Nebius and NVIDIA callouts. Use plain-text sponsor names and your own visuals. GitHub is named only as the platform Cirujano measures; no other third-party marks, no copyrighted music.

## Set up before rehearsing

**Recording method.** Each beat is its own clip, `~/Desktop/Cirujano Demo/split-N.mp4`, assembled in the editor, so any beat can be retaken or replaced (beat 8 after the October 28 measurement). Claude drives the browser tab through the extension: you say "prep N", Claude parks the tab at the beat's first view and answers "ready"; you start recording and say "go N"; Claude runs the beat and answers "done". "go N again" repeats it. Claude can only control tabs it opened, not incognito windows, and acting on a background tab does not bring it to the front, so everything loads into the one tab you are recording.

**Capture.** Record the browser window, not the 6K desktop: a window of 1920x1080 points on the Retina display captures at 3840x2160, so the video is 4K and text still reads on a phone. Clean profile, bookmarks bar hidden, notifications off. GitHub pages are zoomed with `document.documentElement.style.zoom = '1.4'`. **Private repository names never appear on camera**, and the GitHub billing page stays closed because it lists them.

Pages Claude loads, in capture order:

| Tab | Open | Prepare |
| --- | --- | --- |
| A | [Cirujano repository](https://github.com/juan294/cirujano) | README top: name and one-line description. |
| B | [Cost baseline](https://github.com/juan294/cirujano/blob/develop/docs/research/2026-09-08-github-actions-cost-baseline.md) | **Monthly bill** ($370.64, $401.78), then **Where the minutes go**. |
| C | [Evidence PR #8](https://github.com/juan294/cirujano-push-proof/pull/8) | Body at **Model requested**, token counts and the **Sandbox** line, then the measurement table. Read back OPEN on 2026-10-17, base `d5dc444`, head `b359f3b`. |
| D | [PR #8 Files changed](https://github.com/juan294/cirujano-push-proof/pull/8/files) | The `cirujano_validated_push` job and one added job condition. Do not scroll the embedded classifier. |
| E | [PR run](https://github.com/juan294/cirujano-push-proof/actions/runs/37920229570), [optimized push](https://github.com/juan294/cirujano-push-proof/actions/runs/37920318553), [direct-push control](https://github.com/juan294/cirujano-push-proof/actions/runs/37920425565) | Lint, test and build green; then the skipped jobs; then every job green on the control. |
| F | Nebius AI Cloud console → project `default-project-eu-west1` (the P5 project) → **Compute → Virtual machines**, URL `console.nebius.com/<project id>/compute` (Chrome, signed in; `/compute/instances` renders blank) | Starts at "No standalone VMs". Used only in beat 6. |
| G | [Sutura repair monitor runs, October 14-15](https://github.com/juan294/cirujano/actions/workflows/sutura.yml?query=created%3A2026-10-14..2026-10-15) | Five rows: "No repair needed: CI #114 (success)" on top, "Repair requested: CI #110 (failure)" at the bottom. The unfiltered list starts with newer rows (on 2026-10-24 a red `develop` and failed monitor runs), so keep the date filter. |

Terminal (large font, dark theme), in the repository root. Stage the API reads before recording; run only the two `estimate` commands on camera:

```sh
gh api repos/juan294/cirujano-push-proof/actions/runs/37919235519/jobs > /tmp/cirujano-demo-baseline-jobs.json
gh api repos/juan294/cirujano-push-proof/actions/runs/37920318553/jobs > /tmp/cirujano-demo-candidate-jobs.json
node packages/cli/dist/bin.js estimate --jobs /tmp/cirujano-demo-baseline-jobs.json
node packages/cli/dist/bin.js estimate --jobs /tmp/cirujano-demo-candidate-jobs.json
```

Expected: `Billable minutes: 3` with 0 skipped jobs, then `Billable minutes: 1` with 3 skipped jobs (re-checked 2026-10-17). If `packages/cli/dist` is missing, run `pnpm run build` first. Never fake terminal output.

**Cards** (still 3840x2160 images for the editor) are in [video-cards](video-cards/): `0-intro-card.png` (beat 0, 10 seconds; `0-intro-card-youtube-thumbnail.jpg` is the YouTube thumbnail), `1-vision.png` (beat 1), `2-same-tree-illustration.png` (beat 2, labeled "Illustration"), `3-together.png` (beat 7, last 5 seconds), `4-results.png` (beat 8) and `5-end-card.png` (beat 8, silent hold). Sources, the stylesheet and the renderer are in [video-cards/src](video-cards/src/); after a text change run `zsh docs/demo/video-cards/src/render.sh`.

**Live run (beat 6) preflight.** The run starts a billable Nebius VM, so it needs Juan's explicit go at recording time; preparation alone does not authorize it. Check that the P5 controller is alive (`launchctl list | grep cirujano-runner-P5`) and idle with no VM (`tail -1 ~/Library/Logs/cirujano/runner-P5.log` shows `"state":"absent"`; it did at 2026-10-18 13:5x local). The repository and coverage workflow behind handle P5 are in the gitignored `docs/agents/fleet-migration-targets.md`.

## Script

The narration is 426 words including the intro (beat 6 gained one sentence and beat 8 became a vision close on 2026-10-24): 2:50 at 150 words per minute. Eric on ElevenLabs speaks about 2.4 words per second. Beat 8 has 111 words, 43.4 seconds of speech; fitted to 46 seconds, the end card holds about 2 seconds in silence and the video ends at 2:55. Timestamps are editing targets; the recorded clips set the final lengths.

### 0. Intro | 0:00-0:10

**Show:** `0-intro-card.png` full screen for the whole beat. No browser.

**Say:**

> Hi, I'm Juan González. I run more than twenty projects with AI coding agents, and this is Cirujano, one of my two entries for the Nebius and NVIDIA Global AI Hackathon.

### 1. The future | 0:10-0:27

**Show:** `1-vision.png` for most of the beat, then cut to Tab A, README top, for the last sentence.

**Say:**

> Imagine every development team shipping more software on the same budget, because CI removes its own waste, with proof. If Sutura is the nurse for CI that breaks, Cirujano is the surgeon for CI that works but costs too much.

### 2. Why I built it | 0:27-0:42

**Show:** Tab B, point at $370.64 and $401.78, scroll to **Where the minutes go**. Last four seconds: `2-same-tree-illustration.png`.

**Say:**

> It started with my own bill. My agents push all day, and GitHub Actions cost me 386 dollars a month. Two workflows used about 70 percent, and every push ran the full suite.

### 3. How it works on Nebius | 0:42-0:59

**Show:** Tab C, PR #8 body: the model line, token counts and the Sandbox line. Caption in the editor: **Recorded live result, 2026-10-09**.

**Say:**

> Cirujano reads billing and run history. NVIDIA Nemotron, on Nebius Token Factory, proposes one bounded cut, or abstains. Cirujano builds the patch itself, verifies it in Nebius Token Factory Sandboxes, and opens a pull request. A developer signs off.

### 4. The actual cut | 0:59-1:14

**Show:** Tab D, point at `cirujano_validated_push`, then one job's added condition. Switch to Tab E, the PR run with lint, test and build green. Keep the **Recorded live result, 2026-10-09** caption.

**Say:**

> Here is a real cut on a public proof repository. Each merge re-ran checks its pull request had already passed. Cirujano added a guard: skip the merge run only when that exact tree already passed. Any doubt, and every job runs.

### 5. The receipts | 1:14-1:33

**Show: full screen, split.** Left half: Dia with GitHub. Right half: the terminal, covering the Chrome window. No Claude window on screen; you run every step yourself from this list.

Set up before recording (Claude preps the two Dia tabs on "prep 5"; done 2026-10-24):

1. Dia tab 1: [PR #8](https://github.com/juan294/cirujano-push-proof/pull/8) at zoom 1.2 (1.4 is too wide for the half screen and hides the Billed min column), scrolled so the lines "Sandbox: sandbox-verified; network disabled" and "Sandbox guard matrix: 69 cells, 0 mismatches; classifier cases: 60" sit just above the measurement table.
2. Dia tab 2: the [direct-push control run](https://github.com/juan294/cirujano-push-proof/actions/runs/37920425565) at zoom 1.2, top of the page (lint, test and build green).
3. Dia tab 1 in front. Mouse pointer off the table.
4. Terminal on the right half, in the repository root, dark theme, font about 24 pt. Turn off autosuggestions and history overlays (an old command could show a private repository name). The job files in `/tmp` are staged by Claude on "prep 5" (checked 2026-10-24: both present, estimates print 3 and 1):

   ```sh
   cd ~/code/cirujano
   clear
   ```

Recording, about 20 seconds:

1. Start recording. Hold about 5 seconds on the Sandbox lines (sentence 1).
2. In the terminal, run and hold about 2 seconds. Expect `Billable minutes: 3`, `Skipped jobs: 0`:

   ```sh
   node packages/cli/dist/bin.js estimate --jobs /tmp/cirujano-demo-baseline-jobs.json
   ```

3. Run and hold about 2 seconds. Expect `Billable minutes: 1`, `Skipped jobs: 3`:

   ```sh
   node packages/cli/dist/bin.js estimate --jobs /tmp/cirujano-demo-candidate-jobs.json
   ```

4. In Dia, scroll a little so the baseline rows (3) and candidate rows (1) sit in the middle. Hold about 4 seconds.
5. Click Dia tab 2, the control run. Hold about 4 seconds on the green lint, test and build jobs.
6. Stop recording. Save as `~/Desktop/Cirujano Demo/split-5.mp4`.

If the clip is shorter than about 19 seconds, `fit-voice.sh 5` speeds the voice up to 1.2; past that, cut "Then GitHub measured it." from the Say block.

**Say:**

> Sandboxes checked the guard with the network off: 129 scenarios, zero mismatches. Then GitHub measured it. Each merged push used one runner-minute instead of three, and a direct push still ran everything. When an earlier idea saved nothing, Cirujano opened no pull request.

### 6. Heavy work moves to Nebius, live | 1:33-1:53

**Show: a live run, split screen, sped up.** Left half: the terminal with the controller's decision view (below). Right half: Tab F, **Virtual machines**, starting from "No standalone VMs". Caption in the editor: **Live run, sped up**.

Set up before recording (Claude checks the controller and parks the Chrome tab on "prep 6"):

1. Chrome (right half): signed in to the Nebius console, project `default-project-eu-west1`, **Compute → Virtual machines**, showing "No standalone VMs". Chrome zoom 125% (Cmd+= twice; it survives reloads). Claude parks this tab. Do not touch it during the take; Claude reloads it.
2. Terminal (left half, covering Dia): dark theme, font about 24 pt, autosuggestions off. Start the decision view and leave it running:

   ```sh
   clear
   tail -n 0 -F ~/Library/Logs/cirujano/runner-P5.log | jq -R -r --unbuffered 'fromjson? | select(.decision) | "\((.queue.observedAtMs // 0)/1000 | strftime("%H:%M:%S"))  \(.decision.state)  \(.decision.effect.type)  \(.decision.reason)"' | awk '{k=$0; sub(/^[^ ]+  /,"",k); if(k!=p){print; fflush(); p=k}}'
   ```

   It prints one line per state change (UTC) and no repository name. `fromjson?` skips the plain-text lines the controller writes when it restarts; without it `jq` stops at the first one.
3. The Claude window stays off screen (another desktop) but reachable: you type "go 6" in it.

Recording, about 15 minutes of real time:

1. Start recording. Hold about 5 seconds on the empty terminal and "No standalone VMs".
2. Type "go 6" in the off-screen Claude window, then return to the recorded screen. This is the authorization for the billable VM.
3. Claude dispatches the P5 coverage workflow off camera (`gh workflow run` on the P5 repository, `--ref develop`; a manual run of an existing workflow, no commit) and reloads the Virtual machines page every 8 to 10 seconds, with a 3-second settle after each reload.
4. Do nothing on screen. Expected sequence, from the 2026-10-18 and 2026-10-23 cycles on P5: `create-vm` within 30 seconds of dispatch; VM **Running** about 2.5 minutes in; `register-runner` and `busy` about 5 minutes in; job done and `begin-drain` about 9 minutes in; `stop-vm` after the idle grace, about 13 to 28 minutes in; `delete-vm` about 2 minutes after `stop-vm`, and the console shows "No standalone VMs" again. A `blocked` line can appear for one tick between `busy` and `begin-drain`; it clears on its own.
5. When Claude answers "done" (the `delete-vm` line is printed and the console is empty), hold 3 seconds and stop recording. Save as `~/Desktop/Cirujano Demo/split-6.mp4`. Stop the decision view with Ctrl+C.

Compress the 14 minutes to about 20 seconds; keep the `create-vm`, `busy`, `stop-vm` and `delete-vm` lines readable for a second each. The GitHub run page names the private repository, so it stays off camera. Fallback if the run is not authorized or fails: use the runner pilot record ([R14 rows](../research/2026-09-15-nebius-runner-pilot-r14.md)) with the caption **Recorded, 2026-09-15**, and change "This is live" to "Here it is".

**Say:**

> Work that can't be cut moves to Nebius AI Cloud. This is live: a job queues, Cirujano starts a VM, the job runs, and once the queue is empty the VM stops and is deleted. The whole cycle took fourteen minutes, shown here sped up. 800 of my real CI jobs have already run this way.

### 7. Sutura and Cirujano | 1:53-2:08

**Show:** Tab G in Dia with the two Sutura rows, then `3-together.png` as an editor cutaway over the last 5 seconds of the clip, on "The developer is the doctor" (its middle panel reads "Developer, Signs off"). The cutaway covers clip time; it does not add length. Do not start a Sutura walkthrough.

Set up before recording (Claude parks the tab on "prep 7"; done 2026-10-24):

1. Dia (left half): Tab G at zoom 1.2, date filter `created:2026-10-14..2026-10-15` in the search box, the GitHub notice banner dismissed. Do not reload (page-code zoom resets).
2. Right half: anything neutral, or Dia full screen. Mouse pointer off the rows.

Recording, about 15 seconds:

1. Start recording. Hold about 3 seconds on the whole list.
2. Move the pointer to the bottom row, "Repair requested: CI #110 (failure)", and hold about 4 seconds (sentence 1: Sutura triages red CI).
3. Move the pointer to the top row, "No repair needed: CI #114 (success)", and hold about 4 seconds.
4. Move the pointer away and hold about 4 seconds. Stop recording. Save as `~/Desktop/Cirujano Demo/split-7.mp4`.

**Say:**

> Sutura triages red CI and requests verified repairs. Cirujano operates on green CI; its audit recommended the lean cadence that Sutura now coordinates. The developer is the doctor and approves every change.

### 8. What it saved me, and close | 2:08-2:55

**Show:** `4-results.png`: the red −67% stamp and the 3 → 1 row first, then 2,109 → 778 (**OBSERVED**), then the vision line "Next: every team shipping with AI agents" on "Now scale that". Cut to `5-end-card.png` on "Cirujano: keep every check" and hold it in silence to 2:55. No screen recording: beat 8 is the two cards over `voice-8.mp3` (45.9 s, fitted with `fit-voice.sh 8=46`). In that file "Now scale that" starts at 20.6 s, "Cirujano: keep every check" at 36.7 s and "Thank you" ends at 44.0 s: show the vision line from 20.6 s and cut to the end card at 36.7 s.

**Say:**

> What has it saved me? On the proof, two of every three runner-minutes on merged pushes, with every check kept. And since my private repositories moved to the cadence Cirujano recommended, CI dropped from about 2,100 minutes a day to under 800, from about 380 dollars a month to 140. Now scale that. Every team shipping with AI agents pays to run the same checks again and again. Cirujano turns that waste into shipped software: CI that finds its own waste, proves every cut, and runs heavy work on Nebius only when it is needed. Cirujano: keep every check, cut every wasted dollar. Built on Nebius, with NVIDIA Nemotron. Thank you.

## Rehearse three times, then capture

1. **Voice only.** Read the nine Say blocks with a stopwatch. Aim for 2:30-2:45 before the end-card hold. If long, cut "Then GitHub measured it." in beat 5 and "with proof" in beat 1; keep the cut, the receipts and the live run intact.
2. **Screen only.** Practice A → B → C → D → E → terminal → C → E → F → G. Hold key details three to five seconds, point once, then stop moving the pointer. Keep recorded-result captions visible.
3. **Full practice.** Speak while switching views. Watch it back once: can a stranger see the guard in the diff, see 3 become 1, see a VM start and stop on Nebius, and tell measured savings from the early observation? Re-record the weak beat, not the whole video.
4. **Capture.** One clip per beat. Measure them before the voice-over: `for i in 1 2 3 4 5 6 7 8; do ffprobe -v error -show_entries format=duration -of csv=p=0 ~/Desktop/"Cirujano Demo"/split-$i.mp4; done`. Beats 1 to 8 plus the 10-second intro must stay under 3:00; take any excess from beat 8's silent end-card hold.

**Refresh the account numbers the morning you record.** Beat 8 uses October 17-23 (refreshed 2026-10-24; the earlier October 14-16 window, 164 minutes a day, turned out to be the quietest stretch and was replaced). Ask Claude to re-read the billing API; if the window changes, update the Say block, `results.html` and the Evidence table together, then re-render the cards.

## Voice-over and assembly

Voice: ElevenLabs **Eric** (`cjVigY5qzO86Huf0OWal`, premade, American) on `eleven_multilingual_v2`, not `eleven_v3` (v3 ignores the speed setting and its pace varies between takes). Settings: stability 0.5, similarity 0.75, style 0.15, speaker boost on, `language_code` "en".

Run `zsh docs/demo/video-cards/src/fit-voice.sh` after the clips exist. It writes `beat-N.txt` from the Say blocks above (the caption source), reads each clip length, generates at speed 1.0, regenerates once at the fitting speed when speech is longer than the clip (max 1.2; up to about 1.08 is not noticeable), pads silence to the clip length minus 0.1 s, checks that each file decodes cleanly, and leaves one `voice-N.mp3` per clip. To redo one beat, pass its number (`fit-voice.sh 5`): every generation spends quota (about 2,300 characters for the whole script). Never cut words to fit; if a clip has more than about 3 seconds of slack, add a verified sentence instead.

Assembly in iMovie: import `split-N.mp4` in order, drop the cards as cutaways, place `voice-N.mp3` under its clip aligned at the start, add the **Recorded live result, 2026-10-09** and **Live run, sped up** captions, export 3840x2160, upload public on YouTube with captions from the `beat-N.txt` files, set `0-intro-card-youtube-thumbnail.jpg` as the thumbnail and keep the transcript for the judging archive.

Say **Nebius Token Factory**, **NVIDIA Nemotron** and **Nebius AI Cloud** clearly. One pronunciation of Cirujano (see-roo-HAH-no). Excited about the future, calm during the proof, precise on numbers.

## Longer pitch for conversations

Use this outside the submission cut, or for judge questions.

> Developer teams already pay for every push. As AI agents push more often, CI spend grows with them, and most of it is the same verification run again. Imagine every team's CI finding its own waste, proving each cut, and running the work that remains only when it is needed. Across thousands of teams, that is more software for the same engineering budget.
>
> Cirujano came from my own bill: about 386 dollars a month of GitHub Actions, most of it in two workflows that ran the full suite on every push. I did not want to fix that by deleting checks, so Cirujano only accepts a cut it can prove.
>
> Nebius makes this practical. NVIDIA Nemotron on Nebius Token Factory proposes one bounded operation or abstains. Cirujano builds the patch deterministically and verifies it in Token Factory Sandboxes with the network off, then measures it on real runs. Work that cannot be cut moves to Nebius AI Cloud VMs that start when a job queues and are deleted when the queue is empty.
>
> On the public proof, eligible merge pushes went from three runner-minutes to one with every pull request check kept, and 800 real CI jobs from my projects have run on Nebius. When the first optimization family saved nothing, Cirujano opened no pull request. Sutura, my other entry, triages red CI; the developer approves every change from both. The runner study closes on October 28 with net cost.

## Everything we used

Say the first three out loud. The rest can sit in the Devpost text.

| Component | Role | Evidence |
| --- | --- | --- |
| Nebius Token Factory | OpenAI-compatible inference for the Nemotron call | PR #8, [live chain](../research/2026-10-09-skip-validated-push-live-proof.md#chain) |
| NVIDIA Nemotron 3 Nano 30B A3B | Proposes one supported operation or abstains; live model `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | PR #8 model and token record (1,115 tokens, $0.00012) |
| Nebius Token Factory Sandboxes | Runs the push-guard harness in disposable, network-disabled isolation | PR #8: 69 matrix cells, 60 classifier cases |
| Nebius AI Cloud | CPU VMs and disks for one-job-at-a-time on-demand runners | [Runner pilot](../research/2026-09-15-nebius-runner-pilot-r14.md), [runbook](../runbooks/nebius-runner.md) |
| GitHub Actions, REST API, GitHub CLI | Run and job evidence, rounded-minute estimates, PR identity and readback | Runs, `gh api`, `cirujano estimate` |
| TypeScript 6, Node 22, pnpm | Product runtime and workspace | [Stack](../../CLAUDE.md#stack) |
| YAML parser, deterministic classifier, bounded patch builder | Keep the model to supported edits and preserve workflow meaning | PR diff, [guard description](nemotron-optimization.md#skip-validated-pushes) |
| Docker/OCI images, cloud-init, Actions runner | Sandbox images and cloud runner bootstrap | [Technical demo](nemotron-optimization.md), [runner pilot](../research/2026-09-15-nebius-runner-pilot-r14.md) |
| Vitest, V8 coverage, ESLint, esbuild | Product verification, quality comparisons, bundles | [Contributor setup](../../README.md#contributor-setup) |
| Daily telemetry, macOS launchd controllers | Fleet usage collection and the owner-hosted runner control loops | [Telemetry runbook](../runbooks/fleet-telemetry.md) |
| Codex and Claude Code | Development assistance, separate from the runtime model | Not shown in the video |

The Cirujano proof did not use Sutura's Nemotron Super and Ultra roles, Nebius ConTree, Tavily, GPU runners, Kubernetes, fine-tuning or an automatic Sutura-Cirujano hand-off.

## Time and money: what is measured

| Status | Number | Limit |
| --- | --- | --- |
| Measured mechanism | **3 → 1** rounded runner-minutes per eligible merge push (66.7%) | Three sampled pushes on a public repository: **$0** invoice effect. Direct-push control billed 4. Not human waiting time. |
| Measured usage | **800** Cirujano jobs, 3,297 minutes on Nebius VMs, 2026-09-13 to 2026-10-17 | A usage count. Fleet report: **$18.84** gross hosted list cost avoided against **$19.87** controller-accounted Nebius cost; accounting incomplete, net savings unavailable. |
| Measured inference | **$0.00012**, 1,115 tokens for the live Nemotron decision | One proof decision, not a fleet cost. |
| Observed, not attributed | Private-repository CI **2,109 → 778** minutes a day (about **$380 → $140** a month at list price) | July-August average against October 17-23, the first seven full days with the lean cadence on every private repository. Daily values that week ranged from 157 to 1,297 minutes. Activity not normalized. List price before included minutes and provider costs. |
| GitHub Actions bill | Net **$370.64** July, **$401.78** August, **$81.16** September, **$102.08** October 1-18 | The September drop started before any Cirujano change shipped. Do not attribute it. |
| Modeled | About **$120** a month net from packing heavy jobs onto shared VMs | Assumes four concurrent runner slots; implemented runners have one slot per enrollment. |
| Pending | Net runner savings and developer hours | The 45-day runner window closes 2026-10-28; closing it does not guarantee a complete net result. Hours are unmeasured. |

If a judge asks "How much has it saved you?":

> On the controlled proof, two of every three runner-minutes on eligible merge pushes, with every check kept. Since my private repositories moved to the cadence Cirujano recommended, CI fell from about 2,100 minutes a day to about 780 in the first full week, but activity also changed, so I don't claim it as a Cirujano saving. The runner study reports net cost after October 28.

## How the products work together

**Sutura heals red CI. Cirujano trims green CI. A developer keeps approval.** Sutura is the nurse who triages and stitches what breaks; Cirujano is the surgeon who operates on CI that works but costs too much; the developer is the doctor who signs off on both. Keep Sutura to its one beat; they are distinct products and separate submissions.

- **Two failure modes.** A pipeline can break, or it can keep working while it wastes money. Sutura answers red CI with a verified repair, a flaky verdict or a refusal. Cirujano measures green CI, removes verified waste and moves heavy jobs to on-demand Nebius VMs.
- **One link today.** Cirujano's 2026-10-02 cadence assessment recommended fast checks per push and the full suite nightly and at release. Since the owner decision of 2026-10-16, Sutura coordinates that cadence and requests a repair when a run fails.
- **One evidence standard.** Neither trusts a green check alone. Sutura rejects fixes that delete tests; Cirujano rejects savings that delete coverage. Both open evidence-backed pull requests and never merge.
- **Not built yet.** There is no automatic hand-off, and Sutura does not provision Cirujano runners.

## Lines you must not say

| Tempting line | Why not |
| --- | --- |
| "Cirujano cut my bill from $386 to $81." | September's drop began before any Cirujano change shipped; the heaviest repository fell to about 10 minutes a day from 2026-08-22. |
| "It saves me $240 a month" or "$2,900 a year." | The 778-minute window is one week, activity is not normalized and the figure is list price. Do not quote the old 164-minute figure: it was the quietest three days. |
| "The runners save money" or "break even." | $18.84 avoided against $19.87 of Nebius cost, with incomplete accounting. |
| "63 percent cheaper" or "CI is 67 percent faster." | 63 percent is the unattributed observation; 66.7 percent is rounded runner-minutes on three sampled pushes, not delivery time. |
| "Sutura fixed my failing runs." | The Actions rows show a repair request, not a completed repair. |
| "Cirujano is the nurse" or "Sutura is the surgeon." | Owner metaphor rule, 2026-10-18. |
| Calling recorded footage live. | Only beat 6 is executed during the recording. PR #8 and its runs are a recorded live result from 2026-10-09. |
| Any private repository name. | This repository is public; use handles (P5). |

## Evidence

| Claim | Source | Status |
| --- | --- | --- |
| More than twenty projects | Fleet routing list: 19 local repositories plus 2 hosted ones in the owner's global instructions | VERIFIED 2026-10-18 |
| $386 a month | [Baseline](../research/2026-09-08-github-actions-cost-baseline.md#monthly-bill): July $370.64, August $401.78; same totals from the billing usage API | VERIFIED 2026-10-17 |
| Two workflows used about 70 percent | Baseline, "Where the minutes go" | VERIFIED sample, INFERRED total |
| Every push ran the full suite | [Cadence assessment](../research/2026-10-02-ci-cadence-assessment.md): full CI on routine changes before the lean cadence | VERIFIED |
| Nemotron proposes or abstains; Cirujano builds the patch | PR #8 model record; six live push cases including two abstentions and an injection case ([live proof](../research/2026-10-09-skip-validated-push-live-proof.md#live-model-evaluation)) | VERIFIED, small labeled corpus |
| 129 scenarios, zero mismatches, network off | PR #8: 69 guard-matrix cells plus 60 classifier cases | VERIFIED |
| One runner-minute instead of three; direct push ran everything | Candidates 37920072110, 37920192411, 37920318553 billed 1; baselines billed 3; control 37920425565 ran all jobs and billed 4 ([measured runs](../research/2026-10-09-skip-validated-push-live-proof.md#measured-runs)); `cirujano estimate` re-checked | VERIFIED 2026-10-17 |
| An earlier idea saved nothing, no PR opened | Cache family, 3 against 3 rounded minutes ([live outcome](nemotron-optimization.md#live-outcome)) | VERIFIED |
| VM starts on queue, stops and is deleted when idle | P5 controller log, 2026-10-18: `create-vm` 09:25:05Z, `busy` 09:29:20Z, `stop-vm` 09:38:06Z, `delete-vm` 09:39:15Z; [runner pilot](../research/2026-09-15-nebius-runner-pilot-r14.md) | VERIFIED 2026-10-18 |
| 800 real CI jobs on Nebius | Scheduled fleet telemetry, 2026-09-13 to 2026-10-17T04:17Z: 800 Cirujano jobs, 3,297 minutes | VERIFIED usage; not a savings claim |
| Audit recommended the cadence; Sutura coordinates it and requests repairs | [Cadence assessment](../research/2026-10-02-ci-cadence-assessment.md); owner decision 2026-10-16; public Actions row "Repair requested: CI #110 (failure)", 2026-10-14 | VERIFIED; a request is not a completed repair |
| About 780 instead of about 2,100 minutes a day; $140 instead of $380 at list price | Billing usage API, private repositories: 2,109 min and $12.66 list a day (July-August) against 778 min and $4.67 a day (October 17-23), times 30. Same method reproduces the earlier 164-minute figure for October 14-16 | VERIFIED observation 2026-10-24; NOT attributed |
| Runner study closes October 28 | 45-day matched window of the enrolled migrations | VERIFIED date; result pending |

**Gross, discount and net, re-derived 2026-10-18** from the billing usage API pulls of 2026-10-17. Fully discounted usage (free public-repository minutes) grew from $132.57 gross in August to $284.30 in September; the remaining gross fell from $414.32 to $89.03. The larger "discount" is therefore mostly public minutes, which cost nothing, and the bill fell because private usage fell. Neither product is credited with it.

Prepared on Cirujano `develop` after `906bad5`. The live optimizer result stays bound to tool `49c934d` and proof candidate `b359f3b`. Private repository names and raw billing rows stay outside this public repository. No proof workflow, provider operation or runner start was run to prepare this script; beat 6 needs Juan's go at recording time.
