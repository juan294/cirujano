#!/usr/bin/env bash
set -euo pipefail

readonly image_url=https://cloud-images.ubuntu.com/noble/20260911/noble-server-cloudimg-amd64.img
readonly image_sha256=612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354
readonly runner_version=2.328.0
readonly runner_sha256=01066fad3a2893e63e6ca880ae3a1fad5bf9329d60e77ee15f2b97c148c3cd4e
readonly overlay_size=16G
readonly qemu_cpu_model=qemu64
readonly qemu_cpus=${CIRUJANO_QEMU_CPUS:-8}
readonly qemu_memory_mb=${CIRUJANO_QEMU_MEMORY_MB:-4096}
repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cache_directory=${CIRUJANO_BOOT_CACHE_DIR:-$repository_root/.rpi/local/cache}
image_path="$cache_directory/noble-server-cloudimg-amd64-20260911.img"
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/cirujano-boot.XXXXXX")
qemu_pid=
run_succeeded=0
cleanup() {
  if [[ -n "$qemu_pid" ]] && kill -0 "$qemu_pid" 2>/dev/null; then
    kill "$qemu_pid" 2>/dev/null || true
    wait "$qemu_pid" 2>/dev/null || true
  fi
  rm -rf -- "$temporary_directory"
  if (( run_succeeded == 1 )); then
    [[ ! -e "$temporary_directory" ]] || { printf 'ephemeral cleanup failed\n' >&2; return 1; }
    printf 'ephemeral cleanup: complete\n'
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

for tool in curl qemu-img qemu-system-x86_64 ssh ssh-keygen; do
  command -v "$tool" >/dev/null 2>&1 || { printf 'missing required tool: %s\n' "$tool" >&2; exit 1; }
done
mkdir -p "$cache_directory"
if [[ ! -f "$image_path" ]]; then
  curl --fail --location --output "$image_path.partial" "$image_url"
  mv "$image_path.partial" "$image_path"
fi
actual_image_sha256=$(sha256 "$image_path")
[[ "$actual_image_sha256" == "$image_sha256" ]] || { printf 'Ubuntu image checksum mismatch\n' >&2; exit 1; }

host_key="$temporary_directory/host-key"
login_key="$temporary_directory/login-key"
ssh-keygen -q -t ed25519 -N '' -f "$host_key"
ssh-keygen -q -t ed25519 -N '' -f "$login_key"
pnpm --filter @cirujano/runner run build >/dev/null
CIRUJANO_HOST_PRIVATE_KEY_PATH="$host_key" \
CIRUJANO_HOST_PUBLIC_KEY_PATH="$host_key.pub" \
CIRUJANO_LOGIN_PUBLIC_KEY_PATH="$login_key.pub" \
CIRUJANO_ACTIONS_RUNNER_VERSION="$runner_version" \
CIRUJANO_ACTIONS_RUNNER_SHA256="$runner_sha256" \
  node "$repository_root/scripts/render-runner-cloud-init.mjs" "$temporary_directory/user-data"
printf '%s\n' 'instance-id: cirujano-cloud-init-boot' 'local-hostname: cirujano-boot' >"$temporary_directory/meta-data"

seed_image="$temporary_directory/seed.img"
if command -v cloud-localds >/dev/null 2>&1; then
  cloud-localds "$seed_image" "$temporary_directory/user-data" "$temporary_directory/meta-data"
elif command -v hdiutil >/dev/null 2>&1; then
  seed_directory="$temporary_directory/seed"
  mkdir "$seed_directory"
  cp "$temporary_directory/user-data" "$seed_directory/user-data"
  cp "$temporary_directory/meta-data" "$seed_directory/meta-data"
  hdiutil makehybrid -quiet -iso -joliet -default-volume-name cidata -o "$temporary_directory/seed" "$seed_directory"
  seed_image="$temporary_directory/seed.iso"
else
  printf 'cloud-localds or hdiutil is required to create the NoCloud seed\n' >&2
  exit 1
fi

overlay="$temporary_directory/overlay.qcow2"
serial_log="$temporary_directory/serial.log"
known_hosts="$temporary_directory/known_hosts"
qemu_img=$(command -v qemu-img)
qemu_system=$(command -v qemu-system-x86_64)
"$qemu_img" create -q -f qcow2 -F qcow2 -b "$image_path" "$overlay"
"$qemu_img" resize -q "$overlay" "$overlay_size"
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
printf '[127.0.0.1]:%s %s\n' "$port" "$(cut -d ' ' -f 1-2 "$host_key.pub")" >"$known_hosts"
chmod 0600 "$known_hosts"

started_at=$(date +%s)
started_at_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
"$qemu_system" \
  -machine accel=kvm:tcg \
  -cpu "$qemu_cpu_model" -smp "$qemu_cpus" -m "$qemu_memory_mb" \
  -drive "file=$overlay,format=qcow2,if=virtio,cache=unsafe" \
  -drive "file=$seed_image,format=raw,if=virtio" \
  -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:$port-:22" \
  -device virtio-net-pci,netdev=net0 \
  -display none -monitor none -serial "file:$serial_log" >"$temporary_directory/qemu.log" 2>&1 &
qemu_pid=$!

ssh_args=(
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$known_hosts"
  -o IdentitiesOnly=yes
  -o ConnectTimeout=5
  -o ConnectionAttempts=1
  -i "$login_key"
  -p "$port"
)
ssh_deadline=$((started_at + 420))
until ssh "${ssh_args[@]}" runner@127.0.0.1 'test -f /run/cirujano-ssh-ready' >/dev/null 2>&1; do
  if ! kill -0 "$qemu_pid" 2>/dev/null; then
    printf 'QEMU exited before SSH became ready\n' >&2
    head -c 4096 "$temporary_directory/qemu.log" >&2
    exit 1
  fi
  (( $(date +%s) < ssh_deadline )) || { printf 'SSH readiness timed out\n' >&2; exit 1; }
  sleep 5
done
ssh_ready_at=$(date +%s)
proof_output="$temporary_directory/proof.txt"
if ! ssh "${ssh_args[@]}" runner@127.0.0.1 \
  'test -f /run/cirujano-ssh-ready && systemctl is-active ssh.socket && systemctl is-active ssh.service && systemctl is-active cirujano-watchdog && cloud-init status --wait && cloud-init --version 2>&1 && /opt/cirujano/status' \
  >"$proof_output"; then
  printf 'guest readiness proof failed; serial log sha256: %s\n' "$(sha256 "$serial_log")" >&2
  head -c 4096 "$proof_output" >&2
  exit 1
fi
for required in active 'status: done' '"watchdogReady":true' '"grant":null'; do
  grep -q "$required" "$proof_output" || { printf 'guest proof is missing: %s\n' "$required" >&2; head -c 4096 "$proof_output" >&2; exit 1; }
done
watchdog_observed_at=$(date +%s)

poweroff_deadline=$((ssh_ready_at + 660))
while kill -0 "$qemu_pid" 2>/dev/null; do
  (( $(date +%s) < poweroff_deadline )) || { printf 'QEMU did not exit after the unarmed deadline\n' >&2; exit 1; }
  sleep 5
done
if wait "$qemu_pid"; then qemu_status=0; else qemu_status=$?; fi
qemu_pid=
powered_off_at=$(date +%s)
elapsed=$((powered_off_at - started_at))
unarmed_elapsed=$((powered_off_at - ssh_ready_at))
(( qemu_status == 0 )) || { printf 'QEMU exited with status %s\n' "$qemu_status" >&2; exit 1; }
(( unarmed_elapsed >= 540 && unarmed_elapsed <= 660 )) || { printf 'guest poweroff was outside unarmed tolerance: %ss\n' "$unarmed_elapsed" >&2; exit 1; }
grep -Eq 'Powering Off|reboot: Power down|poweroff.target' "$serial_log" || { printf 'serial log has no guest poweroff evidence\n' >&2; exit 1; }

printf 'image: %s\n' "$image_url"
printf 'image sha256: %s\n' "$actual_image_sha256"
printf 'qemu: %s\n' "$("$qemu_system" --version | head -1)"
printf 'acceleration: kvm:tcg\n'
printf 'cpu model: %s (%s vCPUs)\n' "$qemu_cpu_model" "$qemu_cpus"
printf 'overlay cache: unsafe (ephemeral test disk)\n'
printf 'host fingerprint: %s\n' "$(ssh-keygen -lf "$host_key.pub" -E sha256 | awk '{print $2}')"
printf 'sshd preflight: proved by root-owned readiness marker\n'
printf 'boot started: %s\n' "$started_at_iso"
printf 'ssh ready: %s\n' "$(date -u -r "$ssh_ready_at" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$ssh_ready_at" +%Y-%m-%dT%H:%M:%SZ)"
printf 'watchdog observed: %s\n' "$(date -u -r "$watchdog_observed_at" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$watchdog_observed_at" +%Y-%m-%dT%H:%M:%SZ)"
printf 'guest powered off: %s\n' "$(date -u -r "$powered_off_at" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$powered_off_at" +%Y-%m-%dT%H:%M:%SZ)"
printf 'ssh ready after: %ss\n' "$((ssh_ready_at - started_at))"
printf 'unarmed poweroff after SSH readiness: %ss\n' "$unarmed_elapsed"
printf 'total QEMU runtime: %ss\n' "$elapsed"
printf 'serial log sha256: %s\n' "$(sha256 "$serial_log")"
printf '%s\n' "$(grep -E 'cloud-init [0-9]+\.[0-9]+' "$proof_output" | head -1)"
run_succeeded=1
