# Cirujano: Verified CI Cost Surgery

## One-liner

Cirujano reads GitHub Actions billing and run history, ranks where the
minutes go, proposes and verifies workflow patches that cut cost without
cutting coverage, and moves heavy jobs onto on-demand Nebius runners that
start when jobs queue and stop when idle. It opens evidence-backed PRs with
before and after minutes and never auto-merges. "Cirujano" means surgeon.
Sutura closes what must heal; Cirujano cuts what has to go.

## Context

Second entry for the Nebius x NVIDIA Global AI Hackathon (deadline
2026-10-30, track: Coding and Agentic Engineering). Sibling of
[Sutura](https://github.com/juan294/sutura), which repairs red CI; Cirujano
cuts the cost of green CI. The two are separate repos, separate submissions,
and must stay "unique and substantially different" per the hackathon rules.
Why they are separate: `docs/decisions/0001-separate-project-from-sutura.md`.
This repo is PUBLIC (MIT) from day 1: never commit secrets, billing
screenshots, private repository names, or anything from Juan's private fleet.
Aggregated, anonymized numbers are fine.

## Stack

- TypeScript (pinned `^6`, typescript-eslint has no TS7 support), Node 22,
  pnpm, Vitest, ESLint flat config
- LLM: NVIDIA Nemotron via Nebius Token Factory
  (OpenAI-compatible API, `https://api.tokenfactory.nebius.com/v1/`)
- Compute: Nebius AI Cloud, CLI at `~/.nebius/bin/nebius`, profile `TCT`,
  region `eu-north1`; runners are on-demand VMs, never 24/7
- GitHub data: Actions runs and jobs API. `/actions/runs/{id}/timing`
  reports `total_ms: 0` on current GitHub; billable minutes come from each
  job's `started_at`/`completed_at`, rounded up per job
- Env vars: `NEBIUS_API_KEY`, `GITHUB_TOKEN`, Nebius Cloud credentials.
  Fail closed, never commit

## RPI Workflow

This project follows Research-Plan-Implement (RPI).

1. /rpi-research -- Understand the codebase as-is
2. /rpi-plan -- Create a phased implementation spec
3. /rpi-implement -- Execute one phase at a time with review gates
4. /rpi-validate -- Verify implementation against the plan

Each phase is its own conversation. STOP after each phase.
Use /clear between tasks, /compact when context is heavy.
Native `/plan` is a Claude mode, not the RPI artifact workflow.
Shared RPI policy lives in the imported AGENTS.md; path-mapped rule
bodies load from `.claude/rules/`.

## Key Commands

```bash
pnpm run test        # Vitest
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # ESLint
pnpm run build       # tsc + esbuild bundles
pnpm run ci:fast     # pre-push mirror of ci.yml
```

## Git Workflow

- Integration branch (default): `develop`
- Production branch: `main`. Releases and the Devpost submission point here
- Implementation happens in git worktrees or temporary branches
- Verify current branch before committing; run typecheck + lint first
- Conventional commits:
  `feat|fix|test|refactor|chore|docs(scope): description`
- `packages/action/dist/index.cjs` is committed. Rebuild and commit it in the
  same commit as any `packages/core` or `packages/action` source change

```bash
# Commit before pulling (hook enforced)
git add <files> && git commit -m "msg"
git pull --rebase && git push
```

Run verification sequentially with `;` or `&&`, never as parallel Bash calls.
Never push on red: a red `develop` blocks every other push until green.

## Deployment

No hosted deployment. The artifact is a GitHub Action + CLI; releases are
tagged from `main`. Nebius runner VMs are provisioned by the tool itself and
are billable infrastructure: creating, starting, or resizing one needs Juan's
authorization. Demo assets live in `docs/demo/`.

Rules load from `.claude/rules/` and `.claude/skills/` automatically.

## Agent Behavior

Exhaust tools before asking the user. Production actions and paid Nebius
resources need human authorization. Every cost claim names the runs it was
measured on. Save operational lessons to auto memory immediately.
Don't wait to be asked.

## Project File Locations

Go directly to these paths -- never search for them.

| Topic    | Path                            | Notes                       |
| -------- | ------------------------------- | --------------------------- |
| Cost baseline | `docs/research/2026-09-08-github-actions-cost-baseline.md` | Anonymized measured starting point |
| Audit script | `scripts/gh-actions-cost-audit.sh` | Ranks billable minutes per workflow via the jobs API |
| Runner draft | `docs/research/nebius-runner-cloud-init.draft.yaml` | Unverified provisioning draft |
| Agent reports | `docs/agents/*-report.md` | Gitignored on public repos (Rule #70) |
| Research | `docs/research/YYYY-MM-DD-*.md` |                             |
| Plans    | `docs/plans/YYYY-MM-DD-*.md`    | Phase files in `-phases/`   |
| ADRs     | `docs/decisions/`               |                             |
| PR descriptions | `docs/prs/{number}_description.md` |                   |
| Release playbook | `docs/release/e2e-pro-playbook.md` | Wave A adopted; no release yet |
<!-- rpi:claude-import:start -->
@AGENTS.md
<!-- rpi:claude-import:end -->
