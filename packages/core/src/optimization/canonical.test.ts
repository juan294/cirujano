import { describe, expect, it } from 'vitest';
import { canonicalJson, parseStrictJson, safeRelativePath, sha256 } from './canonical.js';

describe('immutable optimization JSON', () => {
  it('sorts every record and hashes exact UTF-8 bytes', () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: 'é' })).toBe('{"a":"é","z":[{"a":1,"b":2}]}');
    expect(sha256('é')).not.toBe(sha256('e'));
    expect(canonicalJson(parseStrictJson('{"z":1,"a":2}'))).toBe('{"a":2,"z":1}');
  });
  it.each(['{"a":1,"a":2}', '{"x":{"a":1,"\\u0061":2}}', '{"__proto__":1}', '{"constructor":2}', '[NaN]', '{} {}'])('rejects ambiguous JSON %s', (text) => {
    expect(() => parseStrictJson(text)).toThrow();
  });
  it('rejects invalid values and records carrying prototypes', () => {
    for (const value of [NaN, Infinity, undefined, new Date(), Object.create({ a: 1 }), { value: undefined }]) {
      expect(() => canonicalJson(value)).toThrow();
    }
  });
  it.each(['/tmp/a', '../a', 'a/../b', 'a//b', 'C:\\a', 'a\\b', './a', 'a/'])('rejects unsafe path %s', (path) => {
    expect(() => safeRelativePath(path)).toThrow();
  });
  it('rejects sparse arrays, extra properties, cycles and control paths', () => {
    const extra = Object.assign([1], { extra: 1 }); const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [Array(1), extra, cycle]) expect(() => canonicalJson(value)).toThrow();
    expect(() => safeRelativePath('a\nb')).toThrow();
  });
  it('accepts literal relative source paths', () => expect(safeRelativePath('.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml'));
});
