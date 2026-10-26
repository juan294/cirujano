#!/bin/bash

set -euo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/launchd/com.thecreativetoken.cirujano-telemetry.plist.in"
SOURCE_COLLECTOR="$SCRIPT_DIR/collect-actions-telemetry.sh"
LABEL="com.thecreativetoken.cirujano-telemetry"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/cirujano"
INSTALL_ROOT="$HOME/.local/lib/cirujano/telemetry"
COLLECTOR="$INSTALL_ROOT/collect-actions-telemetry.sh"
CLI_PATH="$INSTALL_ROOT/cirujano.mjs"
STORE_PATH="${CIRUJANO_TELEMETRY_STORE:-$HOME/.local/share/cirujano/telemetry}"
SINCE="${CIRUJANO_TELEMETRY_SINCE:-2026-09-13}"
DOMAIN="gui/$(id -u)"
INSTALL_STARTED="$(date +%s)"
SOURCE_CLI_PATH="${CIRUJANO_SOURCE_CLI_PATH:-}"
LAUNCHCTL_PATH="${CIRUJANO_LAUNCHCTL_PATH:-/bin/launchctl}"
WAIT_SECONDS="${CIRUJANO_INSTALL_WAIT_SECONDS:-1200}"
POLL_SECONDS="${CIRUJANO_INSTALL_POLL_SECONDS:-5}"

cd "$REPO_ROOT"
if [ -z "$SOURCE_CLI_PATH" ]; then
  pnpm --dir packages/cli build
  SOURCE_CLI_PATH="$REPO_ROOT/packages/cli/dist/bin.js"
fi
mkdir -p "$(dirname "$TARGET")" "$LOG_DIR" "$INSTALL_ROOT" "$STORE_PATH"
chmod 700 "$LOG_DIR" "$INSTALL_ROOT" "$STORE_PATH"
touch "$LOG_DIR/telemetry.log" "$LOG_DIR/telemetry-error.log"
chmod 600 "$LOG_DIR/telemetry.log" "$LOG_DIR/telemetry-error.log"
COLLECTOR_TEMP="$COLLECTOR.$$.tmp"
CLI_TEMP="$CLI_PATH.$$.tmp"
cleanup() {
  rm -f "$COLLECTOR_TEMP" "$CLI_TEMP" "$TARGET.tmp"
}
trap cleanup EXIT
cp "$SOURCE_CLI_PATH" "$CLI_TEMP"
cp "$SOURCE_COLLECTOR" "$COLLECTOR_TEMP"
chmod 700 "$COLLECTOR_TEMP" "$CLI_TEMP"

COLLECTOR_ESCAPED="${COLLECTOR//&/\\&}"
CLI_PATH_ESCAPED="${CLI_PATH//&/\\&}"
LOG_DIR_ESCAPED="${LOG_DIR//&/\\&}"
sed \
  -e "s|__COLLECTOR_PATH__|$COLLECTOR_ESCAPED|g" \
  -e "s|__CLI_PATH__|$CLI_PATH_ESCAPED|g" \
  -e "s|__LOG_DIR__|$LOG_DIR_ESCAPED|g" \
  "$TEMPLATE" > "$TARGET.tmp"
plutil -lint "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"
chmod 600 "$TARGET"

"$LAUNCHCTL_PATH" bootout "$DOMAIN/$LABEL" 2>/dev/null || true
mv "$CLI_TEMP" "$CLI_PATH"
mv "$COLLECTOR_TEMP" "$COLLECTOR"
"$LAUNCHCTL_PATH" bootstrap "$DOMAIN" "$TARGET"

DEADLINE="$((INSTALL_STARTED + WAIT_SECONDS))"
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATE="$("$LAUNCHCTL_PATH" print "$DOMAIN/$LABEL" | awk '/^[[:space:]]*state = / { print $3; exit }')"
  if [ "$STATE" = "not" ]; then
    break
  fi
  sleep "$POLL_SECONDS"
done

DETAILS="$("$LAUNCHCTL_PATH" print "$DOMAIN/$LABEL")"
EXIT_CODE="$(printf '%s\n' "$DETAILS" | awk -F'= ' '/^[[:space:]]*last exit code = / { print $2; exit }')"
if [ "$EXIT_CODE" != "0" ]; then
  printf '%s\n' "$DETAILS"
  echo "telemetry: initial launch did not exit successfully" >&2
  exit 1
fi

SNAPSHOT_PATH="$STORE_PATH/$(date -u +%F).json"
REPORT_PATH="$STORE_PATH/latest.md"
if [ ! -s "$SNAPSHOT_PATH" ] || [ "$(stat -f %m "$SNAPSHOT_PATH")" -lt "$INSTALL_STARTED" ]; then
  echo "telemetry: initial launch did not write a fresh daily snapshot" >&2
  exit 1
fi
if [ ! -s "$REPORT_PATH" ] || [ "$(stat -f %m "$REPORT_PATH")" -lt "$INSTALL_STARTED" ]; then
  echo "telemetry: initial launch did not write a fresh cumulative report" >&2
  exit 1
fi
node "$CLI_PATH" telemetry report --store "$STORE_PATH" --since "$SINCE" --format json >/dev/null

printf '%s\n' "$DETAILS"
echo "telemetry: verified fresh snapshot at $SNAPSHOT_PATH"
echo "telemetry: verified cumulative report at $REPORT_PATH"
