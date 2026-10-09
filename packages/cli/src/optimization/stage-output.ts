import type { CliIo } from '../cli.js';
import type { OptimizeArguments } from './arguments.js';

/** One POSIX shell word, for the commands printed as `nextCommand`. */
export function shellQuote(value: string): string { return `'${value.replace(/'/g, "'\\''")}'`; }
/** A local stage's result line, as JSON or text. */
export function emitStage(args: OptimizeArguments, io: CliIo, status: string, reasonCode: string, nextCommand = 'cirujano --help'): void {
  io.stdout(args.format === 'json' ? `${JSON.stringify({ status, reasonCode, nextCommand })}\n` : `${status}: ${reasonCode}\nNext: ${nextCommand}\n`);
}
