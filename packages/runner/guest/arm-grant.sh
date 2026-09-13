#!/usr/bin/env bash
set -euo pipefail
if (( EUID != 0 )) && [[ "${CIRUJANO_TEST_MODE:-0}" != 1 ]]; then exec sudo -n "$0"; fi

state_dir=${CIRUJANO_STATE_DIR:-/var/lib/cirujano}
grant_file="$state_dir/grant.env"
install -d -m 0700 "$state_dir"

IFS= read -r generation
IFS= read -r started_at_ms
IFS= read -r deadline_ms
IFS= read -r max_job_ms
IFS= read -r shutdown_margin_ms
IFS= read -r confirmed_stopped_generation
for value in "$generation" "$started_at_ms" "$deadline_ms" "$max_job_ms" "$shutdown_margin_ms"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { echo 'grant contains a non-numeric field' >&2; exit 2; }
done
(( generation > 0 && deadline_ms > started_at_ms && max_job_ms > 0 && shutdown_margin_ms > 0 )) \
  || { echo 'grant bounds are invalid' >&2; exit 2; }

boot_id=${CIRUJANO_BOOT_ID:-$(cat /proc/sys/kernel/random/boot_id)}
monotonic_ms=${CIRUJANO_MONOTONIC_MS:-$(awk '{ printf "%d", $1 * 1000 }' /proc/uptime)}
maximum_wall_ms=$started_at_ms
monotonic_elapsed_ms=0

if [[ -f "$grant_file" ]]; then
  # shellcheck disable=SC1090 -- root-owned file created below
  source "$grant_file"
  if (( generation == grant_generation )); then
    [[ "$started_at_ms" == "$grant_started_at_ms" && "$deadline_ms" == "$grant_deadline_ms" ]] \
      || { echo 'existing generation cannot be extended' >&2; exit 3; }
    exit 0
  fi
  (( generation == grant_generation + 1 )) || { echo 'grant generation must increment exactly once' >&2; exit 3; }
  [[ "$confirmed_stopped_generation" == "$grant_generation" ]] \
    || { echo 'new generation requires confirmed normal provider stop' >&2; exit 3; }
  now_ms=${CIRUJANO_NOW_MS:-$(($(date +%s) * 1000))}
  (( now_ms < grant_deadline_ms )) || { echo 'expired grant requires fresh VM creation' >&2; exit 3; }
fi

tmp=$(mktemp "$state_dir/.grant.XXXXXX")
trap 'rm -f "$tmp"' EXIT
{
  printf 'grant_generation=%s\n' "$generation"
  printf 'grant_started_at_ms=%s\n' "$started_at_ms"
  printf 'grant_deadline_ms=%s\n' "$deadline_ms"
  printf 'max_job_ms=%s\n' "$max_job_ms"
  printf 'shutdown_margin_ms=%s\n' "$shutdown_margin_ms"
  printf 'grant_boot_id=%q\n' "$boot_id"
  printf 'last_monotonic_ms=%s\n' "$monotonic_ms"
  printf 'monotonic_elapsed_ms=%s\n' "$monotonic_elapsed_ms"
  printf 'maximum_wall_ms=%s\n' "$maximum_wall_ms"
} > "$tmp"
chmod 0600 "$tmp"
[[ "${CIRUJANO_SKIP_SYNC:-0}" == 1 ]] || sync "$tmp"
mv "$tmp" "$grant_file"
rm -f "$state_dir/admission-disabled"
[[ "${CIRUJANO_SKIP_SYNC:-0}" == 1 ]] || sync "$state_dir"
trap - EXIT
