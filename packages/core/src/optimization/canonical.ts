import { createHash } from 'node:crypto';

export class OptimizationInputError extends Error {
  constructor(message: string) { super(message); this.name = 'OptimizationInputError'; }
}

const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new OptimizationInputError('JSON nesting exceeds 64 or contains cycle');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index))) throw new OptimizationInputError('Ambiguous JSON array');
    return `[${value.map(entry => canonicalJson(entry, depth + 1)).join(',')}]`;
  }
  if (typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new OptimizationInputError('JSON contains an invalid value or prototype');
  }
  return `{${Object.keys(value).sort().map((key) => {
    if (forbiddenKeys.has(key)) throw new OptimizationInputError(`Forbidden JSON key: ${key}`);
    return `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], depth + 1)}`;
  }).join(',')}}`;
}

/** JSON.parse loses duplicate keys; this grammar validates every key before decoding. */
export function parseStrictJson(text: string, maximumBytes = 1024 * 1024): unknown {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 32 * 1024 * 1024) throw new OptimizationInputError('Invalid JSON byte bound');
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) throw new OptimizationInputError('JSON exceeds byte bound');
  let cursor = 0;
  function whitespace() { while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++; }
  function string(): string {
    const start = cursor++;
    while (cursor < text.length) {
      const character = text[cursor++];
      if (character === '\\') cursor++;
      else if (character === '"') return JSON.parse(text.slice(start, cursor)) as string;
    }
    throw new OptimizationInputError('Unterminated JSON string');
  }
  function value(depth: number): void {
    if (depth > 64) throw new OptimizationInputError('JSON nesting exceeds 64');
    whitespace();
    const character = text[cursor];
    if (character === '{') {
      cursor++; whitespace(); const seen = new Set<string>();
      if (text[cursor] === '}') { cursor++; return; }
      while (cursor < text.length) {
        whitespace(); if (text[cursor] !== '"') throw new OptimizationInputError('Invalid JSON object key');
        const key = string();
        if (seen.has(key) || forbiddenKeys.has(key)) throw new OptimizationInputError(`Duplicate or forbidden JSON key: ${key}`);
        seen.add(key); whitespace(); if (text[cursor++] !== ':') throw new OptimizationInputError('Missing JSON colon');
        value(depth + 1); whitespace(); const delimiter = text[cursor++];
        if (delimiter === '}') return;
        if (delimiter !== ',') throw new OptimizationInputError('Invalid JSON object delimiter');
      }
    } else if (character === '[') {
      cursor++; whitespace(); if (text[cursor] === ']') { cursor++; return; }
      while (cursor < text.length) {
        value(depth + 1); whitespace(); const delimiter = text[cursor++];
        if (delimiter === ']') return;
        if (delimiter !== ',') throw new OptimizationInputError('Invalid JSON array delimiter');
      }
    } else if (character === '"') { string(); return; }
    else {
      const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(cursor));
      if (token) { cursor += token[0].length; return; }
    }
    throw new OptimizationInputError('Invalid JSON value');
  }
  value(0); whitespace(); if (cursor !== text.length) throw new OptimizationInputError('Trailing JSON content');
  const parsed: unknown = JSON.parse(text); canonicalJson(parsed); return parsed;
}
export function sha256(bytes: string | Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export function jsonDigest(value: unknown): string { return sha256(canonicalJson(value)); }
export function safeRelativePath(path: string): string {
  if (!path || Buffer.byteLength(path) > 512 || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path) || /^[A-Za-z]:/.test(path) || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new OptimizationInputError('Unsafe relative path');
  }
  return path;
}

export function gitBlobSha(bytes: string | Uint8Array): string { const buffer=Buffer.from(bytes); return createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex'); }
