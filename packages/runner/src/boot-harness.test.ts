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
});
