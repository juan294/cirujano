#!/bin/bash
# Installs (or removes) the launchd operating controller for one fleet enrollment.
# Usage: install-runner-agent.sh <P#>            install or refresh the agent and verify its first tick
#        install-runner-agent.sh <P#> --remove   unload the agent and delete its plist (state is kept)
# Prerequisite: `cirujano fleet controller-config --id <P#>` wrote config.json and the host key
# under the state root. Without permit.json the agent runs the controller in --dry-run mode, which
# is the installation smoke test; the owner adds permit.json (mode 0600) to make it operate.

set -euo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENROLLMENT_ID="${1:-}"
MODE="${2:-install}"
if ! printf '%s' "$ENROLLMENT_ID" | grep -Eq '^P[1-9][0-9]{0,3}$'; then
  echo "usage: $0 <P#> [--remove]" >&2
  exit 2
fi
if [ "$MODE" != "install" ] && [ "$MODE" != "--remove" ]; then
  echo "usage: $0 <P#> [--remove]" >&2
  exit 2
fi

TEMPLATE="$SCRIPT_DIR/launchd/com.thecreativetoken.cirujano-runner.plist.in"
SOURCE_WRAPPER="$SCRIPT_DIR/run-cirujano-controller.sh"
LABEL="com.thecreativetoken.cirujano-runner-$ENROLLMENT_ID"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/cirujano"
INSTALL_ROOT="$HOME/.local/lib/cirujano/runner"
WRAPPER="$INSTALL_ROOT/run-cirujano-controller.sh"
CLI_PATH="$INSTALL_ROOT/cirujano.mjs"
GUEST_DIR="$INSTALL_ROOT/guest"
STATE_ROOT="${CIRUJANO_RUNNER_STATE_ROOT:-$HOME/.local/share/cirujano/runner}"
STATE_DIR="$STATE_ROOT/$ENROLLMENT_ID"
CONTROLLER_KEY_PATH="$STATE_ROOT/controller_ed25519"
DOMAIN="gui/$(id -u)"
INSTALL_STARTED="$(date +%s)"
SOURCE_CLI_PATH="${CIRUJANO_SOURCE_CLI_PATH:-}"
SOURCE_GUEST_DIR="${CIRUJANO_SOURCE_GUEST_DIR:-$REPO_ROOT/packages/runner/guest}"
LAUNCHCTL_PATH="${CIRUJANO_LAUNCHCTL_PATH:-/bin/launchctl}"
SSH_KEYGEN_PATH="${CIRUJANO_SSH_KEYGEN_PATH:-/usr/bin/ssh-keygen}"
WAIT_SECONDS="${CIRUJANO_INSTALL_WAIT_SECONDS:-300}"
POLL_SECONDS="${CIRUJANO_INSTALL_POLL_SECONDS:-5}"
RUNNER_VERSION="${CIRUJANO_ACTIONS_RUNNER_VERSION:-2.337.0}"
RUNNER_SHA256="${CIRUJANO_ACTIONS_RUNNER_SHA256:-70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613}"

if [ "$MODE" = "--remove" ]; then
  "$LAUNCHCTL_PATH" bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$TARGET"
  echo "runner: removed agent $LABEL; state kept at $STATE_DIR"
  exit 0
fi

for required in "$STATE_DIR/config.json" "$STATE_DIR/ssh_host_ed25519_key"; do
  if [ ! -r "$required" ]; then
    echo "runner: $required is missing; run cirujano fleet controller-config --id $ENROLLMENT_ID first" >&2
    exit 1
  fi
done
if [ ! -d "$SOURCE_GUEST_DIR" ]; then
  echo "runner: guest helper source directory is missing: $SOURCE_GUEST_DIR" >&2
  exit 1
fi

cd "$REPO_ROOT"
if [ -z "$SOURCE_CLI_PATH" ]; then
  pnpm --dir packages/cli build
  SOURCE_CLI_PATH="$REPO_ROOT/packages/cli/dist/bin.js"
fi
mkdir -p "$(dirname "$TARGET")" "$LOG_DIR" "$INSTALL_ROOT" "$STATE_DIR"
chmod 700 "$LOG_DIR" "$INSTALL_ROOT" "$STATE_ROOT" "$STATE_DIR"
touch "$LOG_DIR/runner-$ENROLLMENT_ID.log" "$LOG_DIR/runner-$ENROLLMENT_ID-error.log"
chmod 600 "$LOG_DIR/runner-$ENROLLMENT_ID.log" "$LOG_DIR/runner-$ENROLLMENT_ID-error.log"

# One shared bundle serves every enrollment; each permit is bound to its digest, so replacing
# the bundle invalidates the other enrollments' permits until they are reissued.
if [ -r "$CLI_PATH" ]; then
  OLD_DIGEST="$(/usr/bin/shasum -a 256 "$CLI_PATH" | /usr/bin/awk '{print $1}')"
  NEW_DIGEST="$(/usr/bin/shasum -a 256 "$SOURCE_CLI_PATH" | /usr/bin/awk '{print $1}')"
  if [ "$OLD_DIGEST" != "$NEW_DIGEST" ]; then
    OTHERS="$(ls "$HOME/Library/LaunchAgents" 2>/dev/null | grep -E '^com\.thecreativetoken\.cirujano-runner-P[0-9]+\.plist$' | grep -v "^$LABEL.plist$" || true)"
    if [ -n "$OTHERS" ]; then
      echo "runner: the shared bundle digest changes; operating permits for these agents no longer match and need reissuing:" >&2
      printf '%s\n' "$OTHERS" >&2
    fi
  fi
fi

if [ ! -r "$CONTROLLER_KEY_PATH" ]; then
  "$SSH_KEYGEN_PATH" -q -t ed25519 -N '' -C 'cirujano-controller' -f "$CONTROLLER_KEY_PATH"
fi
chmod 600 "$CONTROLLER_KEY_PATH"

WRAPPER_TEMP="$WRAPPER.$$.tmp"
CLI_TEMP="$CLI_PATH.$$.tmp"
GUEST_TEMP="$GUEST_DIR.$$.tmp"
RELEASE_TEMP="$STATE_DIR/actions-runner.env.$$.tmp"
cleanup() {
  rm -rf "$WRAPPER_TEMP" "$CLI_TEMP" "$GUEST_TEMP" "$RELEASE_TEMP" "$TARGET.tmp"
}
trap cleanup EXIT
cp "$SOURCE_CLI_PATH" "$CLI_TEMP"
cp "$SOURCE_WRAPPER" "$WRAPPER_TEMP"
cp -R "$SOURCE_GUEST_DIR" "$GUEST_TEMP"
chmod 700 "$WRAPPER_TEMP" "$CLI_TEMP"
printf 'CIRUJANO_ACTIONS_RUNNER_VERSION=%s\nCIRUJANO_ACTIONS_RUNNER_SHA256=%s\n' "$RUNNER_VERSION" "$RUNNER_SHA256" > "$RELEASE_TEMP"
chmod 600 "$RELEASE_TEMP"

# sed replacement text: escape the delimiter, backslashes and ampersands.
escape() { local value="${1//\\/\\\\}"; value="${value//|/\\|}"; printf '%s' "${value//&/\\&}"; }
sed \
  -e "s|__ENROLLMENT_ID__|$ENROLLMENT_ID|g" \
  -e "s|__WRAPPER_PATH__|$(escape "$WRAPPER")|g" \
  -e "s|__CLI_PATH__|$(escape "$CLI_PATH")|g" \
  -e "s|__STATE_DIR__|$(escape "$STATE_DIR")|g" \
  -e "s|__GUEST_DIR__|$(escape "$GUEST_DIR")|g" \
  -e "s|__CONTROLLER_KEY_PATH__|$(escape "$CONTROLLER_KEY_PATH")|g" \
  -e "s|__LOG_DIR__|$(escape "$LOG_DIR")|g" \
  "$TEMPLATE" > "$TARGET.tmp"
plutil -lint "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"
chmod 600 "$TARGET"

"$LAUNCHCTL_PATH" bootout "$DOMAIN/$LABEL" 2>/dev/null || true
mv "$CLI_TEMP" "$CLI_PATH"
mv "$WRAPPER_TEMP" "$WRAPPER"
rm -rf "$GUEST_DIR"
mv "$GUEST_TEMP" "$GUEST_DIR"
mv "$RELEASE_TEMP" "$STATE_DIR/actions-runner.env"
"$LAUNCHCTL_PATH" bootstrap "$DOMAIN" "$TARGET"

# The first tick writes a redacted event; a controller that exits before then failed to start.
EVENTS_PATH="$STATE_DIR/events.jsonl"
DEADLINE="$((INSTALL_STARTED + WAIT_SECONDS))"
VERIFIED=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if [ -s "$EVENTS_PATH" ] && [ "$(stat -f %m "$EVENTS_PATH")" -ge "$INSTALL_STARTED" ]; then
    VERIFIED=1
    break
  fi
  STATE="$("$LAUNCHCTL_PATH" print "$DOMAIN/$LABEL" 2>/dev/null | awk '/^[[:space:]]*state = / { print $3; exit }' || true)"
  if [ "$STATE" = "not" ]; then
    break
  fi
  sleep "$POLL_SECONDS"
done

DETAILS="$("$LAUNCHCTL_PATH" print "$DOMAIN/$LABEL" 2>/dev/null || echo 'launchctl print failed')"
if [ "$VERIFIED" != "1" ]; then
  printf '%s\n' "$DETAILS"
  echo "runner: the agent did not journal a first tick within ${WAIT_SECONDS}s; inspect $LOG_DIR/runner-$ENROLLMENT_ID-error.log" >&2
  exit 1
fi

printf '%s\n' "$DETAILS"
if [ -r "$STATE_DIR/permit.json" ]; then
  echo "runner: verified first tick for $ENROLLMENT_ID under its operating permit"
else
  echo "runner: verified first dry-run tick for $ENROLLMENT_ID (no permit.json; observing only)"
fi
echo "runner: events at $EVENTS_PATH; logs at $LOG_DIR/runner-$ENROLLMENT_ID.log"
