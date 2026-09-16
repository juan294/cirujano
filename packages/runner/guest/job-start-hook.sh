#!/usr/bin/env bash
set -euo pipefail
# Runs as the runner account (root-equivalent through docker and sudo) inside the job's environment before
# every job, so it takes no environment overrides: the grant path and clocks are
# fixed. It reads the exact grant the guest persisted and refuses work that
# cannot finish before the immutable shutdown. Like the watchdog it measures
# running time on the monotonic clock; a missing or unreadable grant refuses
# instead of defaulting the bounds to zero.
timeout 10s bash -euo pipefail -c '
  grant_file=/var/lib/cirujano/grant.env
  [[ -r "$grant_file" ]] || { echo "Cirujano grant is unreadable: $grant_file" >&2; exit 1; }
  # shellcheck disable=SC1090 -- root-owned file written atomically by arm-grant
  source "$grant_file"
  : "${grant_started_at_ms:?grant start missing}" "${grant_deadline_ms:?grant deadline missing}" "${max_job_ms:?max job missing}" "${shutdown_margin_ms:?shutdown margin missing}"
  : "${grant_boot_id:?grant boot missing}" "${last_monotonic_ms:?grant monotonic missing}" "${monotonic_elapsed_ms:?grant elapsed missing}"
  boot_id=$(cat /proc/sys/kernel/random/boot_id)
  uptime_ms=$(awk "{ printf \"%d\", \$1 * 1000 }" /proc/uptime)
  elapsed_ms=$monotonic_elapsed_ms
  if [[ "$boot_id" == "$grant_boot_id" ]] && (( uptime_ms > last_monotonic_ms )); then
    elapsed_ms=$((monotonic_elapsed_ms + uptime_ms - last_monotonic_ms))
  fi
  remaining_ms=$((grant_deadline_ms - grant_started_at_ms - elapsed_ms))
  if (( remaining_ms < max_job_ms + shutdown_margin_ms )); then
    echo "Cirujano grant cannot fit this job before shutdown" >&2
    exit 1
  fi
'
