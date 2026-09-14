#!/usr/bin/env bash
set -euo pipefail

systemctl_bin=${CIRUJANO_SYSTEMCTL_BIN:-systemctl}
sshd_bin=${CIRUJANO_SSHD_BIN:-/usr/sbin/sshd}
journalctl_bin=${CIRUJANO_JOURNALCTL_BIN:-journalctl}
serial_path=${CIRUJANO_SERIAL_PATH:-/dev/console}
ready_marker=${CIRUJANO_SSH_READY_MARKER:-/run/cirujano-ssh-ready}
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/cirujano-ssh-diagnostics.XXXXXX")
cleanup() {
  rm -rf -- "$temporary_directory"
}
trap cleanup EXIT INT TERM

restart_output="$temporary_directory/restart.txt"
set +e
"$systemctl_bin" restart ssh >"$restart_output" 2>&1
restart_status=$?
set -e
if (( restart_status == 0 )); then
  set +e
  "$sshd_bin" -t >>"$restart_output" 2>&1
  preflight_status=$?
  if (( preflight_status == 0 )); then
    "$systemctl_bin" is-active --quiet ssh.socket >>"$restart_output" 2>&1
    preflight_status=$?
  fi
  if (( preflight_status == 0 )); then
    "$systemctl_bin" is-active --quiet ssh.service >>"$restart_output" 2>&1
    preflight_status=$?
  fi
  set -e
  if (( preflight_status == 0 )); then
    install -m 0644 /dev/null "$ready_marker"
    exit 0
  fi
  restart_status=$preflight_status
fi

raw="$temporary_directory/raw.txt"
redacted="$temporary_directory/redacted.txt"
printf '%s\n' 'CIRUJANO_SSH_DIAGNOSTICS_BEGIN' >"$raw"

append_section() {
  local title=$1 limit=$2 output status
  shift 2
  output="$temporary_directory/${title}.txt"
  printf 'SECTION %s\n' "$title" >>"$raw"
  set +e
  "$@" >"$output" 2>&1
  status=$?
  set -e
  head -c "$limit" "$output" >>"$raw"
  printf '\nCOMMAND_EXIT %s\n' "$status" >>"$raw"
}

printf '%s\n' 'SECTION restart-output' >>"$raw"
head -c 4096 "$restart_output" >>"$raw"
printf '\nCOMMAND_EXIT %s\n' "$restart_status" >>"$raw"
append_section sshd-config 8192 "$sshd_bin" -t
append_section service-status 16384 "$systemctl_bin" status ssh.service --no-pager --full
append_section service-journal 32768 "$journalctl_bin" -u ssh.service --no-pager -n 200 --output=short-iso
printf '%s\n' 'CIRUJANO_SSH_DIAGNOSTICS_END' >>"$raw"

awk '
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/ { print "[REDACTED PRIVATE KEY]"; private_key=1; next }
  private_key && /-----END [A-Z ]*PRIVATE KEY-----/ { private_key=0; next }
  private_key { next }
  {
    gsub(/(GITHUB_TOKEN|NEBIUS_API_KEY|AWS_SECRET_ACCESS_KEY)[[:space:]]*[:=][[:space:]]*[^[:space:]]+/, "[REDACTED]")
    gsub(/github_pat_[A-Za-z0-9_]+/, "[REDACTED]")
    gsub(/gh[pousr]_[A-Za-z0-9_]+/, "[REDACTED]")
    gsub(/Authorization: Bearer [^[:space:]]+/, "Authorization: Bearer [REDACTED]")
    print
  }
' "$raw" >"$redacted"
head -c 65536 "$redacted" >"$serial_path"
exit "$restart_status"
