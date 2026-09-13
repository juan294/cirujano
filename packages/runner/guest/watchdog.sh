#!/usr/bin/env bash
set -euo pipefail
state_dir=${CIRUJANO_STATE_DIR:-/var/lib/cirujano}
grant_file="$state_dir/grant.env"
install -d -m 0700 "$state_dir"
boot_ms=${CIRUJANO_NOW_MS:-$(($(date +%s) * 1000))}
unarmed_deadline_ms=$((boot_ms + 600000))

power_off() {
  if [[ -n "${CIRUJANO_POWEROFF_FILE:-}" ]]; then
    touch "$CIRUJANO_POWEROFF_FILE"
  else
    systemctl poweroff
  fi
}

persist_grant() {
  local tmp
  tmp=$(mktemp "$state_dir/.grant.XXXXXX")
  {
    printf 'grant_generation=%s\n' "$grant_generation"
    printf 'grant_started_at_ms=%s\n' "$grant_started_at_ms"
    printf 'grant_deadline_ms=%s\n' "$grant_deadline_ms"
    printf 'max_job_ms=%s\n' "$max_job_ms"
    printf 'shutdown_margin_ms=%s\n' "$shutdown_margin_ms"
    printf 'grant_boot_id=%q\n' "$grant_boot_id"
    printf 'last_monotonic_ms=%s\n' "$last_monotonic_ms"
    printf 'monotonic_elapsed_ms=%s\n' "$monotonic_elapsed_ms"
    printf 'maximum_wall_ms=%s\n' "$maximum_wall_ms"
  } > "$tmp"
  chmod 0600 "$tmp"
  [[ "${CIRUJANO_SKIP_SYNC:-0}" == 1 ]] || sync "$tmp"
  mv "$tmp" "$grant_file"
  [[ "${CIRUJANO_SKIP_SYNC:-0}" == 1 ]] || sync "$state_dir"
}

while true; do
  now_ms=${CIRUJANO_NOW_MS:-$(($(date +%s) * 1000))}
  current_boot_id=${CIRUJANO_BOOT_ID:-$(cat /proc/sys/kernel/random/boot_id)}
  current_monotonic_ms=${CIRUJANO_MONOTONIC_MS:-$(awk '{ printf "%d", $1 * 1000 }' /proc/uptime)}
  deadline_ms=$unarmed_deadline_ms
  if [[ -f "$grant_file" ]]; then
    # shellcheck disable=SC1090 -- file is root-owned and written atomically
    source "$grant_file"
    deadline_ms=${grant_deadline_ms:?grant deadline missing}
    maximum_wall_ms=${maximum_wall_ms:?grant maximum wall missing}
    if (( now_ms < maximum_wall_ms )); then
      touch "$state_dir/quarantined"
      power_off
      exit 1
    fi
    if [[ "$current_boot_id" == "$grant_boot_id" ]]; then
      (( current_monotonic_ms >= last_monotonic_ms )) || { touch "$state_dir/quarantined"; power_off; exit 1; }
      monotonic_elapsed_ms=$((monotonic_elapsed_ms + current_monotonic_ms - last_monotonic_ms))
    else
      grant_boot_id=$current_boot_id
    fi
    last_monotonic_ms=$current_monotonic_ms
    maximum_wall_ms=$now_ms
    persist_grant
    if (( monotonic_elapsed_ms >= grant_deadline_ms - grant_started_at_ms )); then
      touch "$state_dir/deadline-reached"
      power_off
      exit 0
    fi
  fi
  if (( now_ms >= deadline_ms )); then
    touch "$state_dir/deadline-reached"
    power_off
    exit 0
  fi
  [[ "${CIRUJANO_WATCHDOG_ONCE:-0}" == 1 ]] && exit 0
  sleep 5
done
