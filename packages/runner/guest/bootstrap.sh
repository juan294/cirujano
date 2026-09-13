#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_VERSION:?RUNNER_VERSION is required}"
: "${RUNNER_SHA256:?RUNNER_SHA256 is required}"
install -d -m 0700 /var/lib/cirujano /opt/cirujano /opt/actions-runner
install -m 0755 /tmp/cirujano/watchdog.sh /opt/cirujano/watchdog
install -m 0755 /tmp/cirujano/arm-grant.sh /opt/cirujano/arm-grant
install -m 0755 /tmp/cirujano/job-start-hook.sh /opt/cirujano/job-start-hook
install -m 0755 /tmp/cirujano/register-runner.sh /opt/cirujano/register-runner
install -m 0755 /tmp/cirujano/drain.sh /opt/cirujano/drain
install -m 0755 /tmp/cirujano/status.sh /opt/cirujano/status
install -m 0755 /tmp/cirujano/resume-admission.sh /opt/cirujano/resume-admission
install -m 0644 /tmp/cirujano/cirujano-watchdog.service /etc/systemd/system/cirujano-watchdog.service
systemctl daemon-reload
systemctl enable --now cirujano-watchdog

archive="/tmp/actions-runner-${RUNNER_VERSION}.tar.gz"
curl --fail --silent --show-error --location --output "$archive" \
  "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
printf '%s  %s\n' "$RUNNER_SHA256" "$archive" | sha256sum --check --strict
tar -xzf "$archive" -C /opt/actions-runner
chown -R runner:runner /opt/actions-runner
rm -f "$archive"
touch /var/lib/cirujano/ready
