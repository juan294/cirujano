import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export type GitHubPageRunner = (
  command: string,
  args: string[],
  options: { encoding: 'utf8'; maxBuffer: number; timeout: number },
) => Promise<{ stdout: string }>;

export const defaultGitHubPageRunner: GitHubPageRunner = async (command, args, options) => {
  const { stdout } = await execFile(command, args, options);
  return { stdout: String(stdout) };
};

export function githubCliPath(environment: NodeJS.ProcessEnv): string {
  return environment['CIRUJANO_GH_PATH'] ?? '/opt/homebrew/bin/gh';
}

/** Read-only paginated GitHub read through the authenticated CLI; retries one transient timeout. */
export async function githubPages(ghPath: string, endpoint: string, pageRunner: GitHubPageRunner): Promise<unknown[]> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { stdout } = await pageRunner(ghPath, ['api', '--paginate', '--slurp', endpoint], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60_000,
      });
      const parsed: unknown = JSON.parse(stdout);
      return array(parsed, 'GitHub paginated response');
    } catch (error) {
      if (attempt === 2 || !isTimeout(error)) throw error;
    }
  }
  throw new Error('unreachable GitHub retry state');
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { killed?: unknown; signal?: unknown };
  return value.killed === true || value.signal === 'SIGTERM';
}

export function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

export function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

export function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a nonempty string`);
  return value;
}

export function nullableText(value: unknown, name: string): string {
  if (value === null || value === '') return '';
  return text(value, name);
}

export function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

export function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function nonnegativeNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number`);
  return value;
}

export function nonnegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

export function timestamp(value: unknown, name: string): string {
  const result = text(value, name);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${name} must be a timestamp`);
  return result;
}

export function nullableTimestamp(value: unknown, name: string): string | null {
  return value === null ? null : timestamp(value, name);
}

/** Expands a leading `~/` to the home directory. */
export function expandHome(value: string): string {
  return value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
}

export function absolutePath(value: string, name: string): string {
  const expanded = expandHome(value);
  if (!isAbsolute(expanded)) throw new Error(`${name} must be an absolute path`);
  return expanded;
}

/** Parsed JSON of a file, or null when the file does not exist. */
export async function readOptionalJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
