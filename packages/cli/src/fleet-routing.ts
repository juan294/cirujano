import { requiredSelfHostedLabels, switchVariableFor } from './fleet-registry.js';

/**
 * The Cirujano gated runner selection (docs/plans/2026-10-29-runner-routing-switch.md).
 * An enrolled job asks for its Cirujano label only while the repository variable
 * CIRUJANO_RUNNER_<P#> equals `on` (GitHub compares strings case-insensitively); an unset or
 * deleted variable sends it to ubuntu-latest, so a runner that can no longer serve is released
 * without a push.
 */
export interface RoutingGate {
  enrollmentId: string;
  repository: string;
  workflowPath: string;
  runnerLabel: string;
  ownerUserId: number;
}

export class FleetRoutingError extends Error {
  override readonly name = 'FleetRoutingError';
}

const HOSTED_FALLBACK = "'ubuntu-latest'";

/** Repository and path sit inside a quoted literal and a format() template, so they must need no escaping. */
function validateGate(gate: RoutingGate): void {
  if (!Number.isSafeInteger(gate.ownerUserId) || gate.ownerUserId <= 0) refuse('owner user id must be a positive integer');
  if ([gate.repository, gate.workflowPath].some((part) => /['{}]/u.test(part))) refuse('unsafe workflow path');
}

/** Only the owner's own runs may reach the Cirujano label. */
function ownerClause(gate: RoutingGate): string {
  return `github.actor_id == '${gate.ownerUserId}'`;
}

/** The controller admits only runs of the enrolled workflow itself, so the guard must pin it. */
function workflowRefClause(gate: RoutingGate): string {
  return `github.workflow_ref == format('${gate.repository}/${gate.workflowPath}@{0}', github.ref)`;
}

export function renderGatedRunsOn(gate: RoutingGate): string {
  validateGate(gate);
  const guard = `${ownerClause(gate)} && (github.event_name != 'pull_request' || `
    + `(github.event.pull_request.user.id == ${gate.ownerUserId} && github.event.pull_request.head.repo.id == github.event.repository.id)) && `
    + workflowRefClause(gate);
  return `\${{ vars.${switchVariableFor(gate.enrollmentId)} == 'on' && (${guard}) && fromJSON('${JSON.stringify(requiredSelfHostedLabels(gate.runnerLabel))}') || ${HOSTED_FALLBACK} }}`;
}

/**
 * Accepts only the canonical shape: everything outside the guard byte for byte, one expression,
 * and a balanced guard without a top-level `||` whose top-level conjuncts include the exact owner
 * and workflow_ref clauses. The guard may be stricter than the generated one.
 */
export function parseGatedRunsOn(expression: string, gate: RoutingGate): { runsOn: string[]; routingSwitch: string } {
  validateGate(gate);
  const routingSwitch = switchVariableFor(gate.enrollmentId);
  if (!expression.startsWith('${{ ') || !expression.endsWith(' }}')) refuse('expression delimiters');
  const inner = expression.slice(4, -3);
  if (inner.includes('${{') || inner.includes('}}')) refuse('nested expression');
  const prefix = `vars.${routingSwitch} == 'on' && (`;
  if (!inner.startsWith(prefix)) {
    const other = /^vars\.([A-Za-z_][A-Za-z0-9_]*) == 'on' && \(/u.exec(inner);
    refuse(other === null ? 'switch gate' : `switch variable must be ${routingSwitch}`);
  }
  const tail = /\) && fromJSON\('([^']*)'\) \|\| (.+)$/u.exec(inner);
  if (tail === null || tail[2] !== HOSTED_FALLBACK) refuse('hosted fallback');
  const required = requiredSelfHostedLabels(gate.runnerLabel);
  if (tail[1] !== JSON.stringify(required)) refuse(`runner labels must be ${JSON.stringify(required)}`);
  const conjuncts = topLevelConjuncts(inner.slice(prefix.length, tail.index));
  if (!conjuncts.includes(ownerClause(gate))) refuse(`owner clause ${ownerClause(gate)}`);
  if (!conjuncts.includes(workflowRefClause(gate))) refuse('workflow_ref clause');
  return { runsOn: required, routingSwitch };
}

/** Splits a guard on top-level `&&`. Single-quoted literals (`''` escapes a quote) are masked first. */
function topLevelConjuncts(guard: string): string[] {
  const masked = guard.replace(/'(?:[^']|'')*'/gu, (literal) => '_'.repeat(literal.length));
  if (masked.includes("'")) refuse('balanced guard');
  const conjuncts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index]!;
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth < 0) refuse('balanced guard');
    } else if (depth === 0 && masked.startsWith('||', index)) refuse('guard must not contain a top-level ||');
    else if (depth === 0 && masked.startsWith('&&', index)) {
      conjuncts.push(guard.slice(start, index).trim());
      start = index + 2;
      index += 1;
    }
  }
  if (depth !== 0) refuse('balanced guard');
  conjuncts.push(guard.slice(start).trim());
  return conjuncts;
}

function refuse(rule: string): never {
  throw new FleetRoutingError(rule);
}

/**
 * The value of a one-line YAML scalar: plain, single-quoted (`''`) or double-quoted (`\"`, `\\`).
 * Anything YAML would reject or cut short (a stray quote, another escape, ` #` in a plain
 * scalar) is refused rather than read differently from GitHub.
 */
export function yamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    const body = trimmed.slice(1, -1);
    if (body.replaceAll("''", '').includes("'")) refuse('YAML scalar has an unescaped single quote');
    return body.replaceAll("''", "'");
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const body = trimmed.slice(1, -1);
    if (!/^(?:[^"\\]|\\["\\])*$/u.test(body)) refuse('YAML scalar has an unsupported double-quoted escape');
    return body.replace(/\\(["\\])/gu, (_escape, character: string) => character);
  }
  if (trimmed.includes(' #')) refuse('YAML scalar would end at a comment');
  return trimmed;
}
