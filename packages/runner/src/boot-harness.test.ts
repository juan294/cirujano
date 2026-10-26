import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const harness = readFileSync(
  resolve(import.meta.dirname, '../../../scripts/test-runner-cloud-init-boot.sh'),
  'utf8',
);

describe('cloud-init boot harness', () => {
  it('uses the bounded generic CPU model under software emulation', () => {
    expect(harness).toContain('readonly qemu_cpu_model=qemu64');
    expect(harness).toContain('-cpu "$qemu_cpu_model" -smp "$qemu_cpus"');
    expect(harness).not.toContain('-cpu max');
  });

  it('uses non-durable caching only for the disposable overlay', () => {
    expect(harness).toContain(
      '-drive "file=$overlay,format=qcow2,if=virtio,cache=unsafe"',
    );
    expect(harness).toContain('-drive "file=$seed_image,format=raw,if=virtio"');
    expect(harness).not.toContain('file=$seed_image,format=raw,if=virtio,cache=unsafe');
    expect(harness).toContain("printf 'overlay cache: unsafe (ephemeral test disk)\\n'");
  });

  it('proves the runner account can enter and enumerate the state directory', () => {
    // The proof command runs over SSH as the unprivileged runner user; config.sh needs both.
    expect(harness).toContain('test -x /var/lib/cirujano && test -r /var/lib/cirujano && echo state-dir-readable-by-runner');
    expect(harness).toContain("for required in active state-dir-readable-by-runner '\"grant\":null'; do");
  });

  it('arms a grant after SSH readiness and proves provisioning and the armed poweroff', () => {
    // Provisioning under software emulation cannot meet the ten-minute controller-loss window,
    // so the oracle does what the controller does in production: it arms a grant first.
    expect(harness).toContain('readonly armed_window_s=900');
    expect(harness).toContain("| ssh \"${ssh_args[@]}\" runner@127.0.0.1 'sudo -n /opt/cirujano/arm-grant'");
    expect(harness.indexOf("'sudo -n /opt/cirujano/arm-grant'")).toBeLessThan(harness.indexOf("'cloud-init status'"));
    expect(harness).not.toContain('cloud-init status --wait');
    for (const marker of ['"status":"ready"', '"watchdogReady":true', '"registrationReady":true', '"grant":{"generation":1,']) {
      expect(harness).toContain(marker);
    }
    expect(harness).toContain('(( armed_elapsed >= armed_window_s && armed_elapsed <= armed_window_s + 120 ))');
    expect(harness).toContain("grep -Eq 'Powering Off|reboot: Power down|poweroff.target' \"$serial_log\"");
  });

  it('uses KVM when the host exposes it and reports the accelerator that actually ran', () => {
    // GitHub's hosted Ubuntu runners expose /dev/kvm behind a root-only node; software emulation
    // is the fallback, not the target. QEMU's accel=kvm:tcg already degrades on its own.
    expect(harness).toContain('-machine accel=kvm:tcg');
    expect(harness).toContain('if [[ -e /dev/kvm && ! -w /dev/kvm ]] && sudo -n true 2>/dev/null; then');
    expect(harness).toContain('sudo -n chmod 0666 /dev/kvm');
    expect(harness).toContain('if [[ -w /dev/kvm ]]; then accelerator=kvm; else accelerator=tcg; fi');
    expect(harness).toContain("printf 'acceleration: %s (requested kvm:tcg)\\n' \"$accelerator\"");
    expect(harness).not.toContain("printf 'acceleration: kvm:tcg\\n'");
  });

  it('names the slow phase when provisioning misses the armed deadline', () => {
    expect(harness).toContain('report_provisioning_timeout() {');
    expect(harness).toContain("|| { report_provisioning_timeout; exit 1; }");
    expect(harness).toContain("provisioning deadline missed %ss after arming (limit %ss)");
    expect(harness).toContain("'cloud-init status --long 2>&1; sudo -n tail -n 40 /var/log/cloud-init-output.log 2>&1'");
    expect(harness.indexOf('report_provisioning_timeout() {')).toBeLessThan(harness.indexOf('provisioning_deadline=$((armed_at + armed_window_s - 120))'));
  });
});
