#!/usr/bin/env bash
set -euo pipefail
# Runs as the unprivileged runner account inside the job's environment before
# every job, so it takes no environment overrides: the grant path and clock are
# fixed. It reads the exact grant the guest persisted and refuses work that
# cannot finish before the immutable shutdown; a missing or unreadable grant
# refuses instead of defaulting the bounds to zero.
timeout 10s bash -euo pipefail -c '
  grant_file=/var/lib/cirujano/grant.env
  [[ -r "$grant_file" ]] || { echo "Cirujano grant is unreadable: $grant_file" >&2; exit 1; }
  # shellcheck disable=SC1090 -- root-owned file written atomically by arm-grant
  source "$grant_file"
  : "${grant_deadline_ms:?grant deadline missing}" "${max_job_ms:?max job missing}" "${shutdown_margin_ms:?shutdown margin missing}"
  now_ms=$(($(date +%s) * 1000))
  safe_cutoff_ms=$((grant_deadline_ms - max_job_ms - shutdown_margin_ms))
  if (( now_ms > safe_cutoff_ms )); then
    echo "Cirujano grant cannot fit this job before shutdown" >&2
    exit 1
  fi
'
