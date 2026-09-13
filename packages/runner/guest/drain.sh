#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_GENERATION:?RUNNER_GENERATION is required}"
runner_dir="/var/lib/cirujano/runner-${RUNNER_GENERATION}"
state_dir=${CIRUJANO_STATE_DIR:-/var/lib/cirujano}
runner_root=${CIRUJANO_RUNNER_ROOT:-/var/lib/cirujano}
runner_dir="$runner_root/runner-${RUNNER_GENERATION}"
docker_bin=${CIRUJANO_DOCKER_BIN:-docker}
process_is_live() {
  local pid=$1 state
  kill -0 "$pid" 2>/dev/null || return 1
  state=$(ps -o stat= -p "$pid" 2>/dev/null || true)
  [[ "$state" != *Z* ]]
}
touch "$state_dir/admission-disabled"
listener_pid_file="$state_dir/listener-${RUNNER_GENERATION}.pid"
exec 9>"$state_dir/generation-${RUNNER_GENERATION}.lock"
flock_bin=${CIRUJANO_FLOCK_BIN:-flock}
lock_held=0
if "$flock_bin" -n 9; then lock_held=1; fi
if (( lock_held == 0 )) && [[ -f "$listener_pid_file" ]]; then
  listener_pid=$(<"$listener_pid_file")
  [[ "$listener_pid" =~ ^[0-9]+$ ]] || { echo 'invalid listener pid' >&2; exit 2; }
  listener_command=$(ps -o command= -p "$listener_pid" 2>/dev/null || true)
  [[ "$listener_command" == *"$runner_dir"* ]] || { echo 'listener identity is stale or foreign' >&2; exit 3; }
  kill -TERM "$listener_pid" 2>/dev/null || true
  for _ in {1..50}; do
    process_is_live "$listener_pid" || break
    sleep 0.1
  done
  process_is_live "$listener_pid" && { echo busy; exit 3; }
fi
(( lock_held == 1 )) || [[ -f "$listener_pid_file" ]] || { echo busy; exit 3; }
if (( lock_held == 0 )); then
  for _ in {1..50}; do
    "$flock_bin" -n 9 && { lock_held=1; break; }
    sleep 0.1
  done
fi
(( lock_held == 1 )) || { echo busy; exit 3; }
if pgrep -f "${runner_dir}/bin/Runner.Worker" >/dev/null; then
  echo busy
  exit 3
fi
install -d -m 0700 "$state_dir/diag-${RUNNER_GENERATION}"
if [[ -d "$runner_dir/_diag" ]]; then
  cp -a "$runner_dir/_diag/." "$state_dir/diag-${RUNNER_GENERATION}/"
fi
pgrep -f "${runner_dir}/bin/Runner.Worker|${runner_dir}/bin/Runner.Listener" >/dev/null && { echo busy; exit 3; }
"$docker_bin" ps -aq --filter "label=cirujano.generation=${RUNNER_GENERATION}" | xargs -r "$docker_bin" rm -f
"$docker_bin" volume ls -q --filter "label=cirujano.generation=${RUNNER_GENERATION}" | xargs -r "$docker_bin" volume rm
find "$runner_dir" -mindepth 1 -maxdepth 1 -exec rm -r -- {} +
rm -f "$listener_pid_file"
echo drained
