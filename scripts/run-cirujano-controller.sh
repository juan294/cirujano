#!/bin/bash
# Operating controller wrapper for one fleet enrollment, run by launchd with KeepAlive.
# Reads the enrollment state directory (config.json, optional permit.json, host key) and the
# installed CLI bundle; the candidate digest is always the hash of the bundle actually run, so a
# replaced bundle no longer matches its permit and the controller fails closed.
# Without permit.json the controller runs --dry-run: it observes and journals but never mutates.
# This wrapper prints paths and status lines only; it never echoes tokens or key material.

set -euo pipefail

umask 077

STATE_DIR="${CIRUJANO_RUNNER_STATE_DIR:?CIRUJANO_RUNNER_STATE_DIR is required}"
CLI_PATH="${CIRUJANO_CLI_PATH:?CIRUJANO_CLI_PATH is required}"
GUEST_DIR="${CIRUJANO_GUEST_DIR:?CIRUJANO_GUEST_DIR is required}"
CONTROLLER_KEY_PATH="${CIRUJANO_CONTROLLER_KEY_PATH:-$HOME/.local/share/cirujano/runner/controller_ed25519}"
RELEASE_FILE="$STATE_DIR/actions-runner.env"
CONFIG_PATH="$STATE_DIR/config.json"
PERMIT_PATH="$STATE_DIR/permit.json"

for required in "$CLI_PATH" "$CONFIG_PATH" "$STATE_DIR/ssh_host_ed25519_key" "$CONTROLLER_KEY_PATH" "$CONTROLLER_KEY_PATH.pub" "$RELEASE_FILE"; do
  if [ ! -r "$required" ]; then
    echo "runner: required file is not readable: $required" >&2
    exit 1
  fi
done
if [ ! -d "$GUEST_DIR" ]; then
  echo "runner: guest helper directory is missing: $GUEST_DIR" >&2
  exit 1
fi

# Pinned Actions runner release (version and archive SHA-256), written by the installer.
# shellcheck disable=SC1090
. "$RELEASE_FILE"
: "${CIRUJANO_ACTIONS_RUNNER_VERSION:?actions-runner.env must set CIRUJANO_ACTIONS_RUNNER_VERSION}"
: "${CIRUJANO_ACTIONS_RUNNER_SHA256:?actions-runner.env must set CIRUJANO_ACTIONS_RUNNER_SHA256}"

export CIRUJANO_GH_PATH="${CIRUJANO_GH_PATH:-/opt/homebrew/bin/gh}"
export CIRUJANO_NEBIUS_PATH="${CIRUJANO_NEBIUS_PATH:-$HOME/.nebius/bin/nebius}"
export CIRUJANO_SSH_PATH="${CIRUJANO_SSH_PATH:-/usr/bin/ssh}"
export CIRUJANO_SSH_KEY_PATH="$CONTROLLER_KEY_PATH"
export CIRUJANO_GUEST_DIR="$GUEST_DIR"
export CIRUJANO_HOST_PRIVATE_KEY_PATH="$STATE_DIR/ssh_host_ed25519_key"
export CIRUJANO_LOGIN_PUBLIC_KEY_PATH="$CONTROLLER_KEY_PATH.pub"
export CIRUJANO_ACTIONS_RUNNER_VERSION CIRUJANO_ACTIONS_RUNNER_SHA256
export CIRUJANO_NETWORK_EGRESS_LIMIT_GIB="${CIRUJANO_NETWORK_EGRESS_LIMIT_GIB:-10}"
CIRUJANO_CANDIDATE_DIGEST="$(/usr/bin/shasum -a 256 "$CLI_PATH" | /usr/bin/awk '{print $1}')"
export CIRUJANO_CANDIDATE_DIGEST

ARGS=(runner watch --config "$CONFIG_PATH")
if [ "${CIRUJANO_RUNNER_DRY_RUN:-0}" = "1" ] || [ ! -r "$PERMIT_PATH" ]; then
  echo "runner: no operating permit at $PERMIT_PATH or dry-run requested; observing only"
  ARGS+=(--dry-run)
else
  ARGS+=(--permit "$PERMIT_PATH")
fi

echo "runner: starting controller for $STATE_DIR with bundle $CLI_PATH"
exec node "$CLI_PATH" "${ARGS[@]}"
