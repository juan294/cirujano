# Project: Cirujano

## Codex Compatibility

This project follows the cc-rpi methodology and is configured to work
with both Claude Code and Codex / GPT-5.x.

When operating in Codex, treat these files as the source of truth:

- `CLAUDE.md` -- project overview, workflow, commands, git/deploy context
- `.agents/skills/rpi-*/SKILL.md` -- Codex workflow packages for
  `rpi-research`, `rpi-plan`, `rpi-implement`, `rpi-validate`,
  `rpi-pre-launch`, `rpi-update-docs`, `rpi-release`, and related
  workflows (`.claude/skills/rpi-*/` is the Claude-side copy)
- `.rpi/rules/*.md` -- canonical rule bodies named by the rule map below
- `.claude/rules/*.md` -- the same bodies with path-scoped frontmatter
- `.agents/skills/*/SKILL.md` -- on-demand domain skills and procedures

If the user says "make this Codex compatible", ensure this file exists
and is kept in sync with the compatibility conventions below.

## Workflow Dispatch

When the user invokes an RPI workflow such as `rpi-research`, `rpi-plan`,
`rpi-implement`, `rpi-validate`, `rpi-pre-launch`, `rpi-update-docs`,
`rpi-release`, `rpi-fix-ci`, `rpi-describe-pr`, or `rpi-status`:

1. Select the matching skill package (`.agents/skills/rpi-*/` in Codex,
   `.claude/skills/rpi-*/` in Claude).
2. Read its `SKILL.md` and every reference it names completely before acting.
3. Follow it as the workflow spec for this task.
4. Keep all outputs in the repo locations that workflow requires.

The v1 `.claude/commands/*.md` aliases were removed in the v2.0.2 sync;
unprefixed names such as `/plan` are native harness modes, not RPI workflows.

If the workflow references a plan path or research path, read that
document fully before doing anything else.

## Claude-to-Codex Translation

The workflow packages are shared, but some referenced surfaces are
Claude-native. In Codex, translate them to the closest equivalent behavior:

- `/simplify` -- if `codex-simplify` is installed, use it; otherwise run
  a dedicated post-implementation review for reuse, quality, and
  efficiency; use parallel agents when helpful
- `/batch` -- parallelize independent work with separate worktrees or
  isolated agents when the plan marks phases as `[batch-eligible]`
- `/worktree` or `EnterWorktree` -- perform implementation in an isolated
  git worktree or equivalent isolated workspace
- `Task` / `Explore` agents -- use Codex subagents or parallel research
  passes with the same role separation
- `AskUserQuestion` -- ask the user directly only when the codebase and
  docs cannot answer safely
- `/clear` and `/compact` -- treat as context-management guidance, not
  literal required commands

Preserve the methodology even when the harness differs.

## Codex-Only Skills

- Do not define a project skill literally named `simplify` in a
  Claude-compatible repo.
- If Codex needs a local equivalent of a Claude-native command, use a
  non-conflicting name such as `codex-simplify`.
- Keep the canonical copy outside `.claude/skills/` and sync it into
  `~/.codex/skills/` for local Codex discovery.

## Rules Loading

Always follow `CLAUDE.md`, then this file's shared policy blocks, then
the path-mapped rule bodies:

- Push accountability and RPI details are inline blocks below; there is
  no separate `.claude/rules/` copy of them any more
- For rule files with `paths` frontmatter, apply them when the files you
  are reading or editing match those path globs; the conditional rule
  access table below maps task types to `.rpi/rules/` bodies
- If a rule conflicts with a workflow skill, the skill governs the
  workflow and the rule governs local constraints within that workflow

## Skills

Treat `.agents/skills/*/SKILL.md` (Codex) and `.claude/skills/*/SKILL.md`
(Claude) as on-demand skills:

- Load a skill when the task matches its description
- Load a skill when a workflow or rule points to it
- Use a domain skill as supplemental instructions, not as a replacement
  for the RPI workflow package

Personal Codex-only skills may also exist in `~/.codex/skills/`.
Use them only when they do not shadow Claude-native command names.

## Outputs and Gates

Preserve the standard cc-rpi artifact locations:

- `docs/research/` -- research documents
- `docs/plans/` -- implementation plans and phase files
- `docs/decisions/` -- ADRs and decision records
- `docs/agents/` -- operational reports (commit policy follows repo
  visibility per Rule #70: gitignored on public repos, tracked on private)

Respect the phase gates:

- Stop after research and present the document
- Stop after the plan is finalized and reviewed
- Stop after each implementation phase unless the user explicitly says
  to continue

During research, follow the documentarian rule:
describe what exists; do not suggest improvements unless asked.

## Verification and Git

- Run the verification commands specified by the workflow skill, the plan,
  or `CLAUDE.md`
- Keep verification sequential unless the workflow explicitly says work
  can be parallelized
- Preserve the project's git workflow exactly as described in
  `CLAUDE.md`
- Preserve the project's branch topology exactly as documented in
  `CLAUDE.md`, and keep implementation work in isolated worktrees or
  temporary branches
- Creating, starting, or resizing a Nebius runner VM is billable
  infrastructure and needs explicit owner authorization
<!-- rpi:push-accountability:start -->
# Push Accountability

Keep working branches and worktrees local. Finish applicable tests, coverage,
typechecks, lint, build and deployment preflight locally, resolve failures,
and integrate completed work locally into the documented integration branch.
Inspect workflow and deployment triggers before the single authorized push of
that completed branch. Never create Vercel Preview deployments or publish
working branches/PRs for experimentation. If an integration push would create a
Preview, stop before pushing and use only a documented, non-destructive bypass.
Production publication remains separately and explicitly authorized. Read-only
inspection of existing runs and deployments is allowed.

Commit or preserve intended changes before pulling; never pull through a dirty
tree. After an authorized push, inspect every expected workflow for the exact
pushed commit. Diagnose failures from existing logs and reproduce/fix locally.
Report the failed remote result; do not trigger reruns or a fix-and-repush loop.
A new remote action needs authorization after the complete local gates pass.
<!-- rpi:push-accountability:end -->
<!-- rpi:rpi-details:start -->
# RPI Details

## Context Management

- Each RPI phase should be its own conversation.
  Preserve their acceptance boundaries unless the user explicitly authorizes
  continuation; a continuation instruction does not remove verification.
- Use `/clear` between unrelated tasks.
  Use `/compact` when context is heavy but the task continues.
- Handoffs record objective, approved scope, base/current commit and worktree,
  findings, decisions, check evidence and tested identity, deviations, risks and
  next phase. On resume, verify actual files, refs and evidence validity before
  relying on the handoff; compaction never grants new authority.
- Subagents are context control mechanisms --
  they search/read in their window and return only distilled results.
- Research and planning happen against the integration branch.
  Implementation happens in worktrees or temporary branches.

## Rules for All Phases

- Read controlling instructions/contracts and directly mentioned files completely.
  Inspect implementation to the depth needed; reuse valid prior reads.
- In `rpi-research`, document what exists without improvement recommendations.
  Use the separate `rpi-assess` workflow for evaluative research and alternatives.
- Every code reference must include file:line.
- Delegate only useful bounded independent assignments within this phase.
  A narrow task may stay with the parent. State objective, permitted actions,
  owned files, evidence/output, resource budget and terminal condition for each
  assignment. Missing required results remain coverage gaps until resolved.
- Never write documents with placeholder values.
- Exhaust all tools before suggesting manual steps --
  check CLI tools, shell commands, MCP servers, and file tools
  before escalating to the user.

## Rules for Implementation

- Follow the atomic loop:
  implement -> independent review -> repair -> simplify -> verify.
  The native simplify command or Codex helper catches code reuse, quality, and efficiency issues
  that the plan-compliance reviewer does not check.
- Independent batch work stays local, one owner per file set/worktree and one
  integration owner. Never use a batch mode that automatically publishes PRs.
  Keep at most three simultaneous implementers; use fewer when the task or
  available resources do not justify three.
- Run ALL automated verification after each phase.
- Stop after each phase for acceptance unless the user explicitly authorizes
  continuation. Finish all authorized phase work before that gate.
- If a technical discovery invalidates the plan contract, record the adjustment
  and explain the impact before dependent work; ask only for a required new decision.

## Pre-Release Workflow

`rpi-pre-launch` -> `rpi-remediate` -> `rpi-update-docs` -> `rpi-release`

After `rpi-pre-launch`, include a simplify pass for reuse, quality and
efficiency. Track its findings with the other audit results; resolve security
and infrastructure findings through the same review, repair and verification
loop. Preserve all required audit domains regardless of staffing.

Resolve every confirmed actionable finding before acceptance. Reject false
positives with evidence. Strategic findings needing a new architectural decision
receive explicit local dispositions and owner review; external issue creation
requires authorization. Never silently discard a finding.

## Testing Philosophy

Prefer automated verification.
Manual only for: sudo, hardware, new installs, visual-only.
Use deterministic linting/formatting tools. Preserve TDD for behavioral code
changes. Run all required phase/final gates locally, sequentially with failure
aggregation; a later success cannot erase an earlier failure. Reuse evidence
only for unchanged tested inputs, never as a substitute for an invalidated gate.
<!-- rpi:rpi-details:end -->
<!-- rpi:rule-map:start -->
## Conditional rule access

Before acting on a matching task/path, read the installed rule body below.
The installation manifest records the selected components and exact mappings.
This root map applies even when a session starts at the repository root and
later edits a nested directory; it is an instruction contract, not a native
Codex glob loader. Sessions started inside a subproject also read their actual
root-to-current-directory instruction chain. Preserve project-specific overrides.

| Task or path | Required resource | Essential constraint |
| --- | --- | --- |
| Deployment, CI, release or infrastructure configuration | `.rpi/rules/deployment-safety.md` | Local gates first; no Vercel Preview; production needs authorization. |
| SQL, Supabase migrations, schema, data access or database tests | `.rpi/rules/supabase.md` | Reset/test locally; privileges and RLS are distinct; remote targets need authorization. |
| Behavioral changes, tests, fixtures and validation | `.rpi/rules/testing.md` | TDD for behavioral code; every required check must run and pass. |
| WebMCP, MCP tools, tool registration or agent-facing interfaces | `.rpi/rules/webmcp.md` | Validate on the server; isolate unstable browser APIs and test caller recovery. |

If a required component is missing, report the exact missing path and run the
read-only installation check before proceeding with dependent work. Never
invent a successful read or silently treat an incomplete install as healthy.
<!-- rpi:rule-map:end -->
