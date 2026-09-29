import { mkdtemp, readFile, stat, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withOperationStore, readPrivateJson, consumePermit, scrubOptimizationValue } from './store.js';

const directories: string[] = [];
async function temporary() { const value = await mkdtemp(join(tmpdir(), 'cirujano-optimizer-store-')); directories.push(value); return value; }
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

describe('private optimization stage persistence', () => {
  it('writes complete atomic files with private modes and rereads strict JSON', async () => {
    const path = join(await temporary(), 'operation');
    await withOperationStore(path, async store => { await store.writeJson('intent.json', { schemaVersion: 1, status: 'intent' }); });
    expect((await stat(path)).mode & 0o777).toBe(0o700);
    expect((await stat(join(path, 'intent.json'))).mode & 0o777).toBe(0o600);
    expect(await readPrivateJson(join(path, 'intent.json'))).toEqual({ schemaVersion: 1, status: 'intent' });
  });
  it('rejects symlinked directories, outputs and inputs before reading or writing', async () => {
    const root = await temporary(); const real = join(root, 'real');
    await withOperationStore(real, async store => { await store.writeJson('intent.json', { ok: true }); });
    await symlink(real, join(root, 'alias'));
    await expect(withOperationStore(join(root, 'alias'), async () => undefined)).rejects.toThrow(/symlink/);
    await symlink(join(real, 'intent.json'), join(real, 'alias.json'));
    await expect(readPrivateJson(join(real, 'alias.json'))).rejects.toThrow(/symlink/);
    await expect(withOperationStore(real, async store => store.writeJson('alias.json', {}))).rejects.toThrow(/symlink/);
  });
  it('holds one operation lock and releases it on interruption', async () => {
    const path = join(await temporary(), 'operation');
    await withOperationStore(path, async () => {
      await expect(withOperationStore(path, async () => undefined)).rejects.toThrow(/lock/);
    });
    await expect(withOperationStore(path, async () => { throw new Error('owned interruption'); })).rejects.toThrow('owned interruption');
    await withOperationStore(path, async store => store.writeJson('recovered.json', { recovered: true }));
  });
  it('does not overwrite completed artifacts or accept unsafe file names', async () => {
    const path = join(await temporary(), 'operation');
    await withOperationStore(path, async store => {
      await store.writeText('candidate.patch', 'exact bytes\n');
      await expect(store.writeText('candidate.patch', 'replacement')).rejects.toThrow(/exists/);
      await expect(store.writeJson('../escape.json', {})).rejects.toThrow(/file name/);
    });
    expect(await readFile(join(path, 'candidate.patch'), 'utf8')).toBe('exact bytes\n');
  });
  it('permits owned intent updates while retaining strict JSON reads', async () => {
    const path = join(await temporary(), 'operation');
    await withOperationStore(path, async store => {
      await store.writeJson('intent.json', { status: 'intent' });
      await store.writeJson('intent.json', { status: 'outcome-unknown' }, { replaceIntent: true });
    });
    expect(await readPrivateJson(join(path, 'intent.json'))).toEqual({ status: 'outcome-unknown' });
    await writeFile(join(path, 'bad.json'), '{"a":1,"a":2}');
    await expect(readPrivateJson(join(path, 'bad.json'))).rejects.toThrow(/Duplicate/);
  });
  it('scrubs secret text while preserving typed token counters', () => {
    const secret = 'synthetic-provider-key';
    expect(scrubOptimizationValue({ promptTokens: 12, completionTokens: 3, totalTokens: 15, reason: `value ${secret}`, nested: ['ghp_' + 'a'.repeat(24)] }, [secret]))
      .toEqual({ promptTokens: 12, completionTokens: 3, totalTokens: 15, reason: 'value [REDACTED]', nested: ['[REDACTED]'] });
  });
  it('consumes a permit once across distinct operation directories', async () => {
    const ledger = join(await temporary(), 'permits');
    const digest = 'a'.repeat(64);
    await consumePermit({ ledger, kind: 'inference', digest, operation: 'attempt-a', maximum: 1 });
    await expect(consumePermit({ ledger, kind: 'inference', digest, operation: 'attempt-b', maximum: 1 })).rejects.toThrow(/exhausted/);
    expect((await stat(join(ledger, `inference-${digest}.json`))).mode & 0o777).toBe(0o600);
  });
  it('accounts for concurrent quota reservations and separates operation classes', async () => {
    const ledger = join(await temporary(), 'permits'); const digest = 'b'.repeat(64);
    const results = await Promise.allSettled([0, 1].map(i => consumePermit({ ledger, kind: 'sandbox', digest, operation: String(i), maximum: 1 })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await consumePermit({ ledger, kind: 'publication', digest, operation: 'pr', maximum: 1 });
    await expect(consumePermit({ ledger, kind: 'publication', digest: '../x', operation: 'bad', maximum: 1 })).rejects.toThrow();
  });
});
