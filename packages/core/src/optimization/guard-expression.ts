import { OptimizationInputError } from './canonical.js';

/**
 * A small GitHub Actions expression parser and evaluator for job conditions. It never uses `eval`
 * or `vm`. It parses any call so eligibility can detect status functions, but evaluates only the
 * status functions; the generated guard needs nothing else.
 */
export type ExpressionNode =
  | { type: 'literal'; value: null | boolean | number | string }
  | { type: 'context'; name: string }
  | { type: 'property'; object: ExpressionNode; name: string }
  | { type: 'index'; object: ExpressionNode; index: ExpressionNode }
  | { type: 'not'; operand: ExpressionNode }
  | { type: 'binary'; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode }
  | { type: 'call'; name: string; args: ExpressionNode[] };
type BinaryOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';
export interface EvaluationContext { contexts: Record<string, unknown>; status: { success: boolean; failure: boolean; cancelled: boolean } }

const STATUS_FUNCTIONS = new Set(['success', 'failure', 'cancelled', 'always']);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*/;
const NUMBER = /^-?(?:0x[0-9a-fA-F]+|(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![A-Za-z0-9_.])/;
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function syntax(): never { throw new OptimizationInputError('expression-syntax'); }

type Token = { kind: 'literal'; value: null | boolean | number | string } | { kind: 'name'; value: string } | { kind: 'punct'; value: string };
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let rest = text;
  while ((rest = rest.trimStart())) {
    const punct = /^(?:==|!=|<=|>=|&&|\|\||[()[\].,!<>])/.exec(rest)?.[0];
    const previous = tokens.at(-1);
    const number = NUMBER.exec(rest)?.[0];
    if (number && !(previous?.kind === 'punct' && previous.value === '.')) {
      const hex = /^(-?)0x(.+)$/.exec(number);
      tokens.push({ kind: 'literal', value: hex ? (hex[1] ? -1 : 1) * parseInt(hex[2]!, 16) : Number(number) });
      rest = rest.slice(number.length); continue;
    }
    if (punct) { tokens.push({ kind: 'punct', value: punct }); rest = rest.slice(punct.length); continue; }
    if (rest.startsWith("'")) {
      let index = 1, value = '';
      for (;;) {
        const quote = rest.indexOf("'", index);
        if (quote < 0) syntax();
        value += rest.slice(index, quote);
        if (rest[quote + 1] === "'") { value += "'"; index = quote + 2; continue; }
        rest = rest.slice(quote + 1); break;
      }
      tokens.push({ kind: 'literal', value }); continue;
    }
    const name = IDENTIFIER.exec(rest)?.[0];
    if (!name) syntax();
    tokens.push(name === 'null' ? { kind: 'literal', value: null } : name === 'true' || name === 'false' ? { kind: 'literal', value: name === 'true' } : { kind: 'name', value: name });
    rest = rest.slice(name.length);
  }
  return tokens;
}

export function parseExpression(text: string): ExpressionNode {
  const tokens = tokenize(text);
  let position = 0;
  const peek = (value: string) => tokens[position]?.kind === 'punct' && tokens[position]!.value === value;
  const expect = (value: string) => { if (!peek(value)) syntax(); position++; };
  const binary = (operators: string[], next: () => ExpressionNode) => (): ExpressionNode => {
    let left = next();
    while (operators.some(peek)) { const operator = tokens[position++]!.value as BinaryOperator; left = { type: 'binary', operator, left, right: next() }; }
    return left;
  };
  const primary = (): ExpressionNode => {
    const token = tokens[position++];
    if (!token) syntax();
    if (token.kind === 'literal') return { type: 'literal', value: token.value };
    if (token.kind === 'punct' && token.value === '(') { const inner = or(); expect(')'); return inner; }
    if (token.kind !== 'name') syntax();
    if (!peek('(')) return { type: 'context', name: token.value };
    position++;
    const args: ExpressionNode[] = [];
    if (!peek(')')) { args.push(or()); while (peek(',')) { position++; args.push(or()); } }
    expect(')');
    return { type: 'call', name: token.value, args };
  };
  const postfix = (): ExpressionNode => {
    let node = primary();
    for (;;) {
      if (peek('.')) { position++; const token = tokens[position++]; if (token?.kind !== 'name') syntax(); node = { type: 'property', object: node, name: token.value }; continue; }
      if (peek('[')) { position++; const index = or(); expect(']'); node = { type: 'index', object: node, index }; continue; }
      return node;
    }
  };
  const unary = (): ExpressionNode => { if (peek('!')) { position++; return { type: 'not', operand: unary() }; } return postfix(); };
  const relational = binary(['<', '<=', '>', '>='], unary), equality = binary(['==', '!='], relational), and = binary(['&&'], equality);
  const or: () => ExpressionNode = binary(['||'], and);
  const node = or();
  if (position !== tokens.length) syntax();
  return node;
}

/** Parse a job `if:` value: a bare expression, exactly one `${{ }}` wrapper, or a YAML boolean/number. */
export function conditionExpression(value: unknown): ExpressionNode {
  if (typeof value === 'boolean' || typeof value === 'number') return { type: 'literal', value };
  if (typeof value !== 'string') syntax();
  const wrapped = /^\s*\$\{\{([\s\S]*)\}\}\s*$/.exec(value);
  const text = wrapped ? wrapped[1]! : value;
  if (text.includes('${{') || text.includes('}}')) syntax();
  return parseExpression(text);
}

export function usesStatusFunction(node: ExpressionNode): boolean {
  switch (node.type) {
    case 'call': return STATUS_FUNCTIONS.has(node.name.toLowerCase()) || node.args.some(usesStatusFunction);
    case 'property': return usesStatusFunction(node.object);
    case 'index': return usesStatusFunction(node.object) || usesStatusFunction(node.index);
    case 'not': return usesStatusFunction(node.operand);
    case 'binary': return usesStatusFunction(node.left) || usesStatusFunction(node.right);
    default: return false;
  }
}

/**
 * Documented falsy values are false, 0, -0, '' and null; NaN is treated as falsy too.
 * Known limits, harmless for the generated guard because it treats the original condition as
 * opaque: strings convert to numbers only in strict JSON number form (no trimming, no hex), and
 * case folding uses `toUpperCase`, which maps some characters (such as `ß`) to several.
 */
export function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === '') return false;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  return true;
}
function kind(value: unknown): string { return value === null || value === undefined ? 'null' : Array.isArray(value) ? 'object' : typeof value; }
function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value === '' ? 0 : JSON_NUMBER.test(value) ? Number(value) : NaN;
  return NaN;
}
function upper(value: string): string { return value.toUpperCase(); }
function looseEquals(left: unknown, right: unknown): boolean {
  if (kind(left) === kind(right)) return typeof left === 'string' ? upper(left) === upper(right as string) : kind(left) === 'null' || left === right;
  return toNumber(left) === toNumber(right);
}
function compare(operator: '<' | '<=' | '>' | '>=', left: unknown, right: unknown): boolean {
  const strings = typeof left === 'string' && typeof right === 'string';
  const a = strings ? upper(left) : toNumber(left), b = strings ? upper(right) : toNumber(right);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return operator === '<' ? a < b : operator === '<=' ? a <= b : operator === '>' ? a > b : a >= b;
}
function member(object: unknown, key: unknown): unknown {
  if (Array.isArray(object)) return typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < object.length ? object[key] : null;
  if (object === null || typeof object !== 'object' || typeof key !== 'string') return null;
  const match = Object.keys(object).find(name => upper(name) === upper(key));
  return match === undefined ? null : (object as Record<string, unknown>)[match];
}

export function evaluateExpression(node: ExpressionNode, context: EvaluationContext): unknown {
  const evaluate = (next: ExpressionNode) => evaluateExpression(next, context);
  switch (node.type) {
    case 'literal': return node.value;
    case 'context': return member(context.contexts, node.name) ?? null;
    case 'property': return member(evaluate(node.object), node.name) ?? null;
    case 'index': return member(evaluate(node.object), evaluate(node.index)) ?? null;
    case 'not': return !isTruthy(evaluate(node.operand));
    case 'call': {
      const name = node.name.toLowerCase();
      if (!STATUS_FUNCTIONS.has(name)) throw new OptimizationInputError('expression-unsupported-function');
      if (node.args.length) syntax();
      return name === 'always' ? true : context.status[name as 'success' | 'failure' | 'cancelled'];
    }
    case 'binary': {
      if (node.operator === '&&') { const left = evaluate(node.left); return isTruthy(left) ? evaluate(node.right) : left; }
      if (node.operator === '||') { const left = evaluate(node.left); return isTruthy(left) ? left : evaluate(node.right); }
      const left = evaluate(node.left), right = evaluate(node.right);
      if (node.operator === '==') return looseEquals(left, right);
      if (node.operator === '!=') return !looseEquals(left, right);
      return compare(node.operator, left, right);
    }
  }
}
