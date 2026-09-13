#!/usr/bin/env bash
set -euo pipefail
timeout 10s bash -c '
  source /var/lib/cirujano/grant.env
  now_ms=$(($(date +%s) * 1000))
  safe_cutoff_ms=$((deadline_ms - max_job_ms - shutdown_margin_ms))
  if (( now_ms > safe_cutoff_ms )); then
    echo "Cirujano grant cannot fit this job before shutdown" >&2
    exit 1
  fi
'
