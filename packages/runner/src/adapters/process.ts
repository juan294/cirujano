import { spawn } from 'node:child_process';

export interface ProcessRequest {
  command: string;
  args: readonly string[];
  stdin?: string;
  secrets?: readonly string[];
  timeoutMs: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessResult {
  argv: readonly string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  if (!request.command.startsWith('/') || request.args.some((value) => typeof value !== 'string')) {
    throw new TypeError('process command must be absolute and arguments must be strings');
  }
  if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) throw new RangeError('timeoutMs must be positive');
  const limit = request.maxOutputBytes ?? 64 * 1024;
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('maxOutputBytes must be a positive integer');

  return new Promise((resolve, reject) => {
    const child = spawn(request.command, [...request.args], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: request.env ?? process.env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const collect = (chunks: Buffer[], chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const used = stream === 'stdout' ? stdoutBytes : stderrBytes;
      const remaining = Math.max(0, limit - used);
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      if (stream === 'stdout') {
        stdoutBytes += Math.min(chunk.length, remaining);
        stdoutTruncated ||= chunk.length > remaining;
      } else {
        stderrBytes += Math.min(chunk.length, remaining);
        stderrTruncated ||= chunk.length > remaining;
      }
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk, 'stderr'));
    child.once('error', reject);
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 250);
      forceKillTimer.unref();
    }, request.timeoutMs);
    timer.unref();
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      const secrets = request.secrets ?? [];
      const render = (chunks: Buffer[], truncated: boolean) => {
        const text = Buffer.concat(chunks).toString('utf8');
        return redactSecrets(text, secrets) + (truncated ? '[truncated]' : '');
      };
      resolve({
        argv: [request.command, ...request.args], exitCode, signal,
        timedOut, stdout: render(stdout, stdoutTruncated), stderr: render(stderr, stderrTruncated),
      });
    });
    if (request.stdin === undefined) child.stdin.end();
    else child.stdin.end(request.stdin);
  });
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  return secrets.filter((secret) => secret.length > 0).reduce(
    (redacted, secret) => redacted.split(secret).join('[REDACTED]'),
    text,
  );
}
