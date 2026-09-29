import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readlink, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { canonicalJson, decodeArtifact, parseStrictJson, type ArtifactKind, type ArtifactMap } from '@cirujano/core';
import { acquireControllerLock, assertControllerLock, redactCredentialShapes, redactSecrets, writeJournalAtomic, type ControllerLock } from '@cirujano/runner';

export const defaultOptimizationRoot = () => join(homedir(), '.local/share/cirujano/optimization');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Reject user-controlled symlinks while allowing macOS's fixed system aliases. */
async function guardPath(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let cursor = root;
  const parts = absolute.slice(root.length).split('/').filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    cursor = join(cursor, parts[index]!);
    let info;
    try { info = await lstat(cursor); } catch (error) { if (missing(error)) return; throw error; }
    if (info.isSymbolicLink()) {
      if (process.platform === 'darwin' && ((cursor === '/var' && await readlink(cursor) === 'private/var') || (cursor === '/tmp' && await readlink(cursor) === 'private/tmp'))) continue;
      throw new Error('optimization-symlink: refusing symlink path');
    }
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error('optimization-path: parent is not a directory');
  }
}

async function prepareDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  if (absolute === parse(absolute).root || absolute === homedir()) throw new Error('optimization-path: select a dedicated operation directory');
  await guardPath(absolute);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  await guardPath(absolute);
  await chmod(absolute, 0o700);
  return absolute;
}

export function scrubOptimizationValue(value: unknown, secrets: readonly string[] = []): unknown {
  canonicalJson(value);
  function scrub(entry: unknown): unknown {
    if (typeof entry === 'string') return redactCredentialShapes(redactSecrets(entry, secrets));
    if (Array.isArray(entry)) return entry.map(scrub);
    if (entry !== null && typeof entry === 'object') return Object.fromEntries(Object.entries(entry).map(([key, item]) => [key, scrub(item)]));
    return entry;
  }
  return scrub(value);
}

export async function readPrivateBytes(path: string, maximumBytes = 1024 * 1024): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 32 * 1024 * 1024) throw new Error('optimization-size: invalid read bound');
  await guardPath(path);
  const handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximumBytes) throw new Error('optimization-size: artifact is not a bounded file');
    const buffer = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset > maximumBytes) throw new Error('optimization-size: artifact exceeds read bound');
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}

export async function readPrivateText(path: string, maximumBytes = 256 * 1024): Promise<string> {
  return new TextDecoder('utf8', { fatal: true }).decode(await readPrivateBytes(path, maximumBytes));
}
export async function readPrivateJson(path: string, maximumBytes = 1024 * 1024): Promise<unknown> {
  return parseStrictJson(await readPrivateText(path, maximumBytes), maximumBytes);
}

export async function readOptimizationArtifact<K extends ArtifactKind>(kind: K, path: string): Promise<ArtifactMap[K]> {
  return decodeArtifact(kind, await readPrivateJson(path));
}

export class OperationStore {
  constructor(readonly directory: string, private readonly lock: ControllerLock) {}

  private async outputPath(name: string, replace: boolean): Promise<string> {
    assertControllerLock(this.lock);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(name)) throw new Error('optimization-path: unsafe file name');
    const path = join(this.directory, name);
    await guardPath(path);
    try {
      const info = await lstat(path);
      if (!info.isFile()) throw new Error('optimization-path: output is not a file');
      if (!replace) throw new Error('artifact-exists: inspect the existing stage with optimize status');
    } catch (error) { if (!missing(error)) throw error; }
    return path;
  }

  async writeJson(name: string, value: unknown, options: { replaceIntent?: boolean; secrets?: readonly string[] } = {}): Promise<void> {
    if (options.replaceIntent && !/^(?:intent|operation|(?:inference|sandbox|publication)-[a-f0-9]{64})\.json$/.test(name)) throw new Error('optimization-state: only owned intent journals can be updated');
    const path = await this.outputPath(name, options.replaceIntent ?? false);
    await writeJournalAtomic(path, scrubOptimizationValue(value, options.secrets));
  }

  async writeArtifact<K extends ArtifactKind>(kind: K, value: ArtifactMap[K], secrets: readonly string[] = []): Promise<void> {
    const sanitized = decodeArtifact(kind, scrubOptimizationValue(decodeArtifact(kind, value), secrets));
    await this.writeJson(`${kind}.json`, sanitized);
  }

  /** Exact private patch/source bytes must never be changed by text redaction. */
  async writeText(name: string, text: string): Promise<void> {
    const path = await this.outputPath(name, false);
    if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('optimization-size: output exceeds bound');
    const temporary = join(this.directory, `.${name}.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
      await handle.close();
      await rename(temporary, path);
      const directoryHandle = await open(this.directory, constants.O_RDONLY);
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

export async function withOperationStore<T>(directory: string, work: (store: OperationStore) => Promise<T>): Promise<T> {
  const path = await prepareDirectory(directory);
  const lock = await acquireControllerLock(path);
  try { return await work(new OperationStore(path, lock)); } finally { await lock.release(); }
}

/** Reserve before emission; a crash consumes authority until explicitly renewed. */
export async function consumePermit(options: { kind: 'inference' | 'sandbox' | 'publication'; digest: string; operation: string; maximum: number; ledger?: string }): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(options.digest) || !Number.isSafeInteger(options.maximum) || options.maximum < 1 || options.maximum > 8 || !options.operation || options.operation.length > 512) throw new Error('permit-invalid: invalid authority reservation');
  const directory = options.ledger ?? join(defaultOptimizationRoot(), 'permits');
  await withOperationStore(directory, async store => {
    const name = `${options.kind}-${options.digest}.json`;
    let operations: string[] = [];
    try {
      const prior = await readPrivateJson(join(store.directory, name));
      if (canonicalJson(prior) !== canonicalJson({ schemaVersion: 1, kind: options.kind, digest: options.digest, operations: (prior as { operations?: unknown }).operations }) || !Array.isArray((prior as { operations?: unknown }).operations) || !(prior as { operations: unknown[] }).operations.every(entry => typeof entry === 'string')) throw new Error('permit-ledger-invalid');
      operations = (prior as { operations: string[] }).operations;
    } catch (error) { if (!missing(error)) throw error; }
    if (operations.length >= options.maximum || operations.includes(options.operation)) throw new Error('permit-exhausted: this authority already emitted its allowed operation; reconcile status');
    await store.writeJson(name, { schemaVersion: 1, kind: options.kind, digest: options.digest, operations: [...operations, options.operation] }, { replaceIntent: true });
  });
}
