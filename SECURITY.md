# Security Policy

## Supported Versions

Only the current release line receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.0.x   | Yes       |

## Reporting a Vulnerability

Do not report a security vulnerability through a public issue.

Send details to `juan294@gmail.com` with the subject `[cirujano] Security vulnerability report`. Include the affected commit or version, steps to reproduce, impact, and a suggested fix if you have one. Remove repository credentials, provider keys, private repository names, and personal data from all evidence.

You can expect an acknowledgment within 48 hours, an initial assessment within 7 days, and a coordinated disclosure after a fix is available.

## Security Boundaries

- Workflow files, run logs, and billing data are untrusted input.
- Cirujano must not remove, skip, or weaken tests and verification to make a workflow cheaper.
- GitHub and Nebius credentials are secrets and must never enter evidence artifacts.
- Cirujano opens evidence-backed pull requests for human review and never auto-merges them.
- Cirujano never creates or starts billable Nebius infrastructure without owner authorization.
