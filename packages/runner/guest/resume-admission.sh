#!/usr/bin/env bash
set -euo pipefail
if (( EUID != 0 )) && [[ "${CIRUJANO_TEST_MODE:-0}" != 1 ]]; then exec sudo -n "$0"; fi
state_dir=${CIRUJANO_STATE_DIR:-/var/lib/cirujano}
[[ -d "$state_dir" && -f "$state_dir/grant.env" ]] || { echo 'guest grant is unavailable' >&2; exit 3; }
rm -f "$state_dir/admission-disabled"
echo resumed
