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
});
