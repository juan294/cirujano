#!/usr/bin/env bash
set -euo pipefail
state_dir=${CIRUJANO_STATE_DIR:-/var/lib/cirujano}
grant_file="$state_dir/grant.env"
clock_file="$state_dir/clock.env"
unarmed_window_ms=600000
# install -d re-applies the mode to an existing directory: keep the bootstrap's
# 0755 so the runner's config.sh can still enumerate its ancestors.
install -d -m 0755 "$state_dir"

# The wall clock is never read here: NTP steps it, and the controller's clock
# that issues a grant is a different clock altogether. Both deadlines are
# measured on the monotonic clock. The unarmed window counts from a persisted
# per-boot anchor, so a watchdog restart within one boot cannot reset it and a
# reboot re-anchors it; an armed grant accumulates running time across reboots.

read_clock() {
  current_boot_id=${CIRUJANO_BOOT_ID:-$(cat /proc/sys/kernel/random/boot_id)}
  current_monotonic_ms=${CIRUJANO_MONOTONIC_MS:-$(awk '{ printf "%d", $1 * 1000 }' /proc/uptime)}
}

write_atomically() {
  local target=$1 tmp
  tmp=$(mktemp "$state_dir/.$(basename "$target").XXXXXX")
  cat > "$tmp"
  chmod 0644 "$tmp"
  [[ "${CIRUJANO_SKIP_SYNC:-0}" == 1 ]] || sync "$tmp"
  mv "$tmp" "$target"
  [[ "${CIRUJANO_SKIP_SYNC:-0}" == 1 ]] || sync "$state_dir"
}

power_off() {
  if [[ -n "${CIRUJANO_POWEROFF_FILE:-}" ]]; then
    touch "$CIRUJANO_POWEROFF_FILE"
  else
    systemctl poweroff
  fi
}

quarantine() {
  touch "$state_dir/quarantined"
  power_off
  exit 1
}

expire() {
  touch "$state_dir/deadline-reached"
  power_off
  exit 0
}

persist_anchor() {
  write_atomically "$clock_file" <<EOF
anchor_boot_id=$(printf '%q' "$anchor_boot_id")
anchor_monotonic_ms=$anchor_monotonic_ms
EOF
}

persist_grant() {
  write_atomically "$grant_file" <<EOF
grant_generation=$grant_generation
grant_started_at_ms=$grant_started_at_ms
grant_deadline_ms=$grant_deadline_ms
max_job_ms=$max_job_ms
shutdown_margin_ms=$shutdown_margin_ms
grant_boot_id=$(printf '%q' "$grant_boot_id")
last_monotonic_ms=$last_monotonic_ms
monotonic_elapsed_ms=$monotonic_elapsed_ms
EOF
}

read_clock
anchor_boot_id=
if [[ -f "$clock_file" ]]; then
  # shellcheck disable=SC1090 -- root-owned file written atomically below
  source "$clock_file"
fi
if [[ "$anchor_boot_id" != "$current_boot_id" ]]; then
  anchor_boot_id=$current_boot_id
  anchor_monotonic_ms=$current_monotonic_ms
  persist_anchor
fi

while true; do
  read_clock
  # arm-grant holds the same lock across its check and write, so a tick either sees the new
  # generation or waits; a tick that cannot get the lock skips its write and retries.
  exec 9>"$state_dir/grant.lock"
  if ! "${CIRUJANO_FLOCK_BIN:-flock}" -w 10 9; then
    exec 9>&-
    [[ "${CIRUJANO_WATCHDOG_ONCE:-0}" == 1 ]] && exit 0
    sleep 5
    continue
  fi
  if [[ -f "$grant_file" ]]; then
    # shellcheck disable=SC1090 -- file is root-owned and written atomically
    source "$grant_file"
    : "${grant_deadline_ms:?grant deadline missing}"
    if [[ "${CIRUJANO_TEST_MODE:-0}" == 1 && -n "${CIRUJANO_TEST_HOLD_AFTER_READ:-}" ]]; then
      # Test-only pause between reading and writing back the grant (race regression test).
      touch "$CIRUJANO_TEST_HOLD_AFTER_READ.reached"
      for _ in {1..100}; do [[ -e "$CIRUJANO_TEST_HOLD_AFTER_READ" ]] || break; sleep 0.1; done
    fi
    if [[ "$current_boot_id" == "$grant_boot_id" ]]; then
      (( current_monotonic_ms >= last_monotonic_ms )) || quarantine
      monotonic_elapsed_ms=$((monotonic_elapsed_ms + current_monotonic_ms - last_monotonic_ms))
    else
      grant_boot_id=$current_boot_id
    fi
    last_monotonic_ms=$current_monotonic_ms
    persist_grant
    (( monotonic_elapsed_ms < grant_deadline_ms - grant_started_at_ms )) || expire
  elif (( current_monotonic_ms - anchor_monotonic_ms >= unarmed_window_ms )); then
    expire
  fi
  exec 9>&-
  [[ "${CIRUJANO_WATCHDOG_ONCE:-0}" == 1 ]] && exit 0
  sleep 5
done
