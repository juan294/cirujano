#!/usr/bin/env bash
set -euo pipefail

# The GitHub runner's config.sh refuses to work under any ancestor directory it
# cannot enumerate, so the state directory is world-readable. Nothing secret
# lives at its top level: grant.env is 0644 on purpose (the job-start hook reads
# it as the runner account), generation directories are 0700 runner-owned and
# diag directories are 0700 root.
install -d -m 0755 /var/lib/cirujano
install -d -m 0700 /opt/actions-runner
install -d -m 0755 /opt/cirujano
install -m 0755 /tmp/cirujano/watchdog.sh /opt/cirujano/watchdog
install -m 0755 /tmp/cirujano/diagnose-ssh.sh /opt/cirujano/diagnose-ssh
install -m 0755 /tmp/cirujano/arm-grant.sh /opt/cirujano/arm-grant
install -m 0755 /tmp/cirujano/job-start-hook.sh /opt/cirujano/job-start-hook.sh
install -m 0755 /tmp/cirujano/register-runner.sh /opt/cirujano/register-runner
install -m 0755 /tmp/cirujano/drain.sh /opt/cirujano/drain
install -m 0755 /tmp/cirujano/status.sh /opt/cirujano/status
install -m 0755 /tmp/cirujano/resume-admission.sh /opt/cirujano/resume-admission
install -m 0644 /tmp/cirujano/cirujano-watchdog.service /etc/systemd/system/cirujano-watchdog.service
systemctl daemon-reload
systemctl enable --now cirujano-watchdog

if [[ "${CIRUJANO_SAFETY_ONLY:-0}" == 1 ]]; then
  exit 0
fi

: "${RUNNER_VERSION:?RUNNER_VERSION is required}"
: "${RUNNER_SHA256:?RUNNER_SHA256 is required}"

archive="/tmp/actions-runner-${RUNNER_VERSION}.tar.gz"
curl --fail --silent --show-error --location --output "$archive" \
  "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
printf '%s  %s\n' "$RUNNER_SHA256" "$archive" | sha256sum --check --strict
tar -xzf "$archive" -C /opt/actions-runner
chown -R runner:runner /opt/actions-runner
rm -f "$archive"
touch /var/lib/cirujano/ready
