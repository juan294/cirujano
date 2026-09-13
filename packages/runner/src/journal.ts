import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Server } from 'node:net';
import { dirname, join, resolve } from 'node:path';

export class ControllerLockError extends Error {
  override readonly name = 'ControllerLockError';
}

export interface ControllerLock {
  path: string;
  release(): Promise<void>;
}

export async function writeJournalAtomic(path: string, value: unknown): Promise<void> {
  const directory = dirname(resolve(path));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${path.split('/').at(-1) ?? 'state'}.tmp-${process.pid}-${randomUUID()}`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, resolve(path));
  await chmod(resolve(path), 0o600);
  const directoryHandle = await open(directory, constants.O_RDONLY);
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
}

export async function readJournal<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as T;
}

export async function appendRedactedEvent(
  path: string,
  event: unknown,
  options: { secrets?: readonly string[]; maxBytes?: number } = {},
): Promise<void> {
  const maximum = options.maxBytes ?? 64 * 1024;
  if (!Number.isInteger(maximum) || maximum < 80) throw new RangeError('event maxBytes must be an integer of at least 80');
  const sanitized = redactValue(event, options.secrets ?? []);
  let line = `${JSON.stringify(sanitized)}\n`;
  if (Buffer.byteLength(line) > maximum) {
    const type = typeof event === 'object' && event !== null && 'type' in event && typeof event.type === 'string' ? event.type : 'event';
    line = `${JSON.stringify({ schemaVersion: 1, type, redacted: '[REDACTED]', truncated: true })}\n`;
  }
  const directory = dirname(resolve(path));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = await open(resolve(path), 'a', 0o600);
  try {
    await file.writeFile(line, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await chmod(resolve(path), 0o600);
}

export async function acquireControllerLock(stateDirectory: string): Promise<ControllerLock> {
  const directory = resolve(stateDirectory);
  if (directory.startsWith('/Volumes/') || stateDirectory.startsWith('//')) {
    throw new ControllerLockError('controller state must use a local filesystem');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const socketPath = join(directory, '.controller.sock');
  if (Buffer.byteLength(socketPath) >= 100) throw new ControllerLockError('controller lock path is too long for a Unix socket');

  let server = createServer();
  try {
    await listen(server, socketPath);
  } catch (error) {
    if (!isAddressInUse(error)) throw error;
    if (await socketIsHeld(socketPath)) throw new ControllerLockError('another controller holds this state lock');
    await unlink(socketPath).catch((unlinkError: unknown) => {
      if (!isMissing(unlinkError)) throw unlinkError;
    });
    server = createServer();
    try {
      await listen(server, socketPath);
    } catch (retryError) {
      if (isAddressInUse(retryError)) throw new ControllerLockError('another controller acquired this state lock');
      throw retryError;
    }
  }
  await chmod(socketPath, 0o600);
  let released = false;
  return {
    path: socketPath,
    async release() {
      if (released) return;
      released = true;
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      await unlink(socketPath).catch((error: unknown) => { if (!isMissing(error)) throw error; });
    },
  };
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolveListen, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolveListen(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(path);
  });
}

async function socketIsHeld(path: string): Promise<boolean> {
  try { await access(path); } catch { return false; }
  return new Promise((resolveHeld) => {
    const socket = createConnection(path);
    const timer = setTimeout(() => { socket.destroy(); resolveHeld(false); }, 250);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolveHeld(true); });
    socket.once('error', () => { clearTimeout(timer); resolveHeld(false); });
  });
}

function redactValue(value: unknown, secrets: readonly string[], key = ''): unknown {
  if (/token|secret|password|private.?key|cloud.?init|user.?data/iu.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, secrets));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, redactValue(entry, secrets, name)]));
  }
  return value;
}

function isAddressInUse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE';
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
