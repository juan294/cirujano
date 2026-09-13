#!/usr/bin/env bash
set -euo pipefail
if (( EUID != 0 )) && [[ "${CIRUJANO_TEST_MODE:-0}" != 1 ]]; then exec sudo -n "$0"; fi
state_dir=${CIRUJANO_STATE_DIR:-/var/lib/cirujano}
systemctl_bin=${CIRUJANO_SYSTEMCTL_BIN:-systemctl}
[[ -d "$state_dir" ]] || { echo '{"complete":false,"status":"booting","admissionEnabled":null,"runnerActive":null,"workerActive":null,"grant":null}'; exit 0; }
[[ ! -e "$state_dir/quarantined" && ! -e "$state_dir/deadline-reached" ]] || { echo '{"complete":true,"status":"failed","admissionEnabled":false,"runnerActive":false,"workerActive":false,"grant":null}'; exit 0; }
[[ -e "$state_dir/ready" ]] || { echo '{"complete":true,"status":"booting","admissionEnabled":false,"runnerActive":false,"workerActive":false,"grant":null,"watchdogReady":false,"sshIdentityVerified":true,"registrationReady":false}'; exit 0; }
watchdog=false
if "$systemctl_bin" is-active --quiet cirujano-watchdog 2>/dev/null; then watchdog=true; fi
admission=true
[[ ! -e "$state_dir/admission-disabled" ]] || admission=false
runner=false
worker=false
pgrep -f '/var/lib/cirujano/runner-[0-9]+/bin/Runner.Listener' >/dev/null 2>&1 && runner=true
pgrep -f '/var/lib/cirujano/runner-[0-9]+/bin/Runner.Worker' >/dev/null 2>&1 && worker=true
status=ready
[[ "$admission" == false ]] && status=drained
[[ "$runner" == true ]] && status=ready
[[ "$worker" == true ]] && status=busy
grant=null
network_egress_bytes=${CIRUJANO_NETWORK_EGRESS_BYTES:-}
if [[ -z "$network_egress_bytes" ]]; then
  network_egress_bytes=$({ find /sys/class/net -mindepth 1 -maxdepth 1 ! -name lo -exec cat '{}/statistics/tx_bytes' \; 2>/dev/null || true; } | awk '{ total += $1 } END { printf "%.0f", total }')
  network_egress_bytes=${network_egress_bytes:-0}
fi
[[ "$network_egress_bytes" =~ ^[0-9]+$ ]] || { echo '{"complete":false,"status":"unknown","admissionEnabled":null,"runnerActive":null,"workerActive":null,"grant":null}'; exit 0; }
if [[ -f "$state_dir/grant.env" ]]; then
  # shellcheck disable=SC1090 -- root-owned file written by arm-grant
  source "$state_dir/grant.env"
  [[ "${grant_generation:-}" =~ ^[1-9][0-9]*$ && "${grant_started_at_ms:-}" =~ ^[0-9]+$ && "${grant_deadline_ms:-}" =~ ^[0-9]+$ ]] \
    || { echo '{"complete":false,"status":"unknown","admissionEnabled":null,"runnerActive":null,"workerActive":null,"grant":null}'; exit 0; }
  grant="{\"generation\":$grant_generation,\"startedAtMs\":$grant_started_at_ms,\"deadlineMs\":$grant_deadline_ms}"
fi
printf '{"complete":true,"status":"%s","admissionEnabled":%s,"runnerActive":%s,"workerActive":%s,"grant":%s,"watchdogReady":%s,"sshIdentityVerified":true,"registrationReady":true,"networkEgressBytes":%s}\n' "$status" "$admission" "$runner" "$worker" "$grant" "$watchdog" "$network_egress_bytes"
