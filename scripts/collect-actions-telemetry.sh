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
REGISTRY_PATH="${CIRUJANO_FLEET_REGISTRY:-$STORE_PATH/fleet-registry.json}"
FLEET_REPORT_PATH="$STORE_PATH/fleet-latest.md"
FLEET_REPORT_TEMP="$FLEET_REPORT_PATH.$$.tmp"

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
  rm -f "$REPORT_TEMP" "$FLEET_REPORT_TEMP"
}
trap cleanup EXIT

# The owner lookup is the first GitHub read; retry it like the collector's own reads.
if [ -z "$OWNER" ]; then
  for DELAY in 2 8 -; do
    if OWNER="$(gh api user --jq .login)" && [ -n "$OWNER" ]; then
      break
    fi
    if [ "$DELAY" = "-" ]; then
      echo "telemetry: could not read the GitHub owner" >&2
      exit 1
    fi
    sleep "$DELAY"
  done
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

if [ -n "${CIRUJANO_FLEET_REGISTRY:-}" ] || [ -e "$REGISTRY_PATH" ]; then
  node "$CLI_PATH" telemetry report \
    --store "$STORE_PATH" \
    --since "$SINCE" \
    --format markdown \
    --registry "$REGISTRY_PATH" > "$FLEET_REPORT_TEMP"
  mv "$FLEET_REPORT_TEMP" "$FLEET_REPORT_PATH"
  echo "telemetry: fleet report updated at $FLEET_REPORT_PATH"
fi
