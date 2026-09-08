# 0001: Keep Cirujano a separate project from Sutura

Date: 2026-09-08
Status: Accepted

## Context

Sutura is a verified self-healing CI agent entered in the Nebius x NVIDIA
Global AI Hackathon. While measuring the owner's GitHub Actions bill on
2026-09-08, a second product shape appeared: rank where Actions minutes go,
verify workflow patches that cut cost, and move heavy jobs onto on-demand
Nebius runners. The question was whether to add that to Sutura or build it
separately.

## Decision

Cirujano is its own repository, folder, memory, and hackathon submission.
Sutura's scope stays fixed at repairing red CI. Cirujano cuts the cost of
green CI.

## Reasons

- The hackathon rules allow multiple entries only if each is "unique and
  substantially different". Repairing failures and cutting cost are different
  problems with different users, inputs, and evidence.
- Sutura's story is judged on technical implementation, design, impact, and
  idea. Runner hosting is infrastructure, not agentic repair, and would dilute
  that story while adding an operations surface to a public repository.
- Sutura's remaining roadmap (benchmark, public demo, external evidence,
  video) needs the weeks that a scope expansion would consume.
- Separate folders and repositories keep the two development environments
  from mixing: different secrets, different rules, different release lines.

## Consequences

- Shared conventions are copied, not linked: both repositories use the cc-rpi
  blueprint, the same CI, CodeQL, and dependency-review workflows, and the
  same commit and branch topology.
- The two products can compose (Sutura opens repair PRs, Cirujano opens cost
  PRs, both as GitHub Actions) without either depending on the other.
- Cirujano's first evidence is the owner's own bill, recorded anonymized in
  `docs/research/2026-09-08-github-actions-cost-baseline.md`.
