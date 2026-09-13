#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_REPOSITORY:?RUNNER_REPOSITORY is required}"
: "${RUNNER_NAME:?RUNNER_NAME is required}"
: "${RUNNER_LABEL:?RUNNER_LABEL is required}"
: "${RUNNER_GENERATION:?RUNNER_GENERATION is required}"
state_dir=${CIRUJANO_STATE_DIR:-/var/lib/cirujano}
runner_root=${CIRUJANO_RUNNER_ROOT:-/var/lib/cirujano}
runner_template=${CIRUJANO_RUNNER_TEMPLATE:-/opt/actions-runner}
sudo_bin=${CIRUJANO_SUDO_BIN:-sudo}
exec 9>"$state_dir/generation-${RUNNER_GENERATION}.lock"
flock_bin=${CIRUJANO_FLOCK_BIN:-flock}
"$flock_bin" -n 9 || { echo 'runner generation is draining' >&2; exit 3; }
IFS= read -r RUNNER_TOKEN
[[ -n "$RUNNER_TOKEN" ]] || { echo 'registration token missing' >&2; exit 1; }
runner_dir="$runner_root/runner-${RUNNER_GENERATION}"
[[ ! -e "$state_dir/admission-disabled" ]] || { echo 'runner admission is disabled' >&2; exit 3; }
if [[ "${CIRUJANO_TEST_MODE:-0}" == 1 ]]; then install -d -m 0700 "$runner_dir"; else install -d -m 0700 -o runner -g runner "$runner_dir"; fi
cp -a "$runner_template/." "$runner_dir/"
printf '%s\n' 'ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/cirujano/job-start-hook' > "$runner_dir/.env"
[[ "${CIRUJANO_TEST_MODE:-0}" == 1 ]] || chown runner:runner "$runner_dir/.env"
export ACTIONS_RUNNER_INPUT_TOKEN="$RUNNER_TOKEN"
unset RUNNER_TOKEN
"$sudo_bin" -u runner --preserve-env=ACTIONS_RUNNER_INPUT_TOKEN bash -c \
  'cd "$1" && ./config.sh --unattended --ephemeral --disableupdate --url "$2" --name "$3" --labels "$4" --work _work' \
  bash "$runner_dir" "https://github.com/${RUNNER_REPOSITORY}" "$RUNNER_NAME" "$RUNNER_LABEL"
unset ACTIONS_RUNNER_INPUT_TOKEN
"$sudo_bin" -u runner bash -c 'cd "$1" && exec ./run.sh' bash "$runner_dir" &
listener_pid=$!
printf '%s\n' "$listener_pid" > "$state_dir/listener-${RUNNER_GENERATION}.pid"
trap 'kill -TERM "$listener_pid" 2>/dev/null || true; wait "$listener_pid" 2>/dev/null || true; exit 0' TERM INT
wait "$listener_pid"
