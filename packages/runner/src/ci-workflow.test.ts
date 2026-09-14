import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(import.meta.dirname, '../../../.github/workflows/ci.yml'),
  'utf8',
);

describe('CI workflow', () => {
  it('uses GitHub-valid job identifiers', () => {
    const jobs = workflow.split('\njobs:\n', 2)[1];
    if (jobs === undefined) throw new Error('CI workflow has no jobs section');
    const identifiers = [...jobs.matchAll(/^  ([^\s:]+):\s*$/gmu)].map((match) => match[1]);

    expect(identifiers).toContain('ubuntu_24_04');
    expect(identifiers).not.toContain('ubuntu-24.04');
    expect(identifiers).not.toHaveLength(0);
    for (const identifier of identifiers) {
      expect(identifier).toMatch(/^[A-Za-z_][A-Za-z0-9_-]{0,98}$/u);
    }
  });

  it('uses a host-sized CPU topology for the Ubuntu boot oracle', () => {
    const jobs = workflow.split('\njobs:\n', 2)[1];
    if (jobs === undefined) throw new Error('CI workflow has no jobs section');
    const lines = jobs.split('\n');
    const start = lines.indexOf('  ubuntu_24_04:');
    const end = lines.findIndex(
      (line, index) => index > start && /^  [^\s:]+:\s*$/u.test(line),
    );
    const job = lines.slice(start, end === -1 ? undefined : end).join('\n');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(job).toContain('      CIRUJANO_QEMU_CPUS: 2');
  });
});
