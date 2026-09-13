#!/bin/bash

set -euo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STORE_PATH="${CIRUJANO_TELEMETRY_STORE:-$HOME/.local/share/cirujano/telemetry}"
OWNER="${CIRUJANO_TELEMETRY_OWNER:-}"
SINCE="${CIRUJANO_TELEMETRY_SINCE:-2026-09-13}"
LOOKBACK_HOURS="${CIRUJANO_TELEMETRY_LOOKBACK_HOURS:-48}"
LOCK_PATH="$STORE_PATH/.collect.lock"
REPORT_PATH="$STORE_PATH/latest.md"
REPORT_TEMP="$REPORT_PATH.$$.tmp"

mkdir -p "$STORE_PATH"

if [ "${CIRUJANO_TELEMETRY_LOCKED:-0}" != "1" ]; then
  if /usr/bin/lockf -k -s -t 0 "$LOCK_PATH" /usr/bin/env CIRUJANO_TELEMETRY_LOCKED=1 "$0"; then
    exit 0
  else
    STATUS=$?
  fi
  if [ "$STATUS" -eq 75 ]; then
    echo "telemetry: collection already active"
    exit 0
  fi
  exit "$STATUS"
fi

cleanup() {
  rm -f "$REPORT_TEMP"
}
trap cleanup EXIT

if [ -z "$OWNER" ]; then
  OWNER="$(gh api user --jq .login)"
fi

CLI_PATH="${CIRUJANO_CLI_PATH:-}"
if [ -z "$CLI_PATH" ]; then
  cd "$REPO_ROOT"
  pnpm --dir packages/cli build
  CLI_PATH="$REPO_ROOT/packages/cli/dist/bin.js"
fi
if [ ! -r "$CLI_PATH" ]; then
  echo "telemetry: CLI bundle is not readable at $CLI_PATH" >&2
  exit 1
fi

node "$CLI_PATH" telemetry collect \
  --owner "$OWNER" \
  --store "$STORE_PATH" \
  --lookback-hours "$LOOKBACK_HOURS"
node "$CLI_PATH" telemetry report \
  --store "$STORE_PATH" \
  --since "$SINCE" \
  --format markdown > "$REPORT_TEMP"
mv "$REPORT_TEMP" "$REPORT_PATH"

echo "telemetry: report updated at $REPORT_PATH"
