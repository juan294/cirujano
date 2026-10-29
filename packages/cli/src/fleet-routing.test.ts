import { describe, expect, it } from 'vitest';

import { switchVariableFor } from './fleet-registry.js';
import { parseGatedRunsOn, renderGatedRunsOn, yamlScalar } from './fleet-routing.js';

const LABEL = 'cirujano-baseline-actions_linux';
const OWNER_ID = 4242;
const GATE = { enrollmentId: 'P3', repository: 'example-owner/example-app', workflowPath: '.github/workflows/ci.yml', runnerLabel: LABEL, ownerUserId: OWNER_ID };
const WORKFLOW_REF = "github.workflow_ref == format('example-owner/example-app/.github/workflows/ci.yml@{0}', github.ref)";
const RENDERED = renderGatedRunsOn(GATE);

describe('switchVariableFor', () => {
  it('names one repository variable per enrollment and refuses other ids', () => {
    expect(switchVariableFor('P3')).toBe('CIRUJANO_RUNNER_P3');
    expect(switchVariableFor('P1234')).toBe('CIRUJANO_RUNNER_P1234');
    for (const id of ['P0', 'p3', 'P12345', 'X3', '']) expect(() => switchVariableFor(id)).toThrow(/enrollment id/u);
  });
});

describe('renderGatedRunsOn', () => {
  it('emits the canonical gated selection with the hosted fallback', () => {
    expect(RENDERED).toBe(
      "${{ vars.CIRUJANO_RUNNER_P3 == 'on' && (github.actor_id == '4242' && (github.event_name != 'pull_request' || "
      + '(github.event.pull_request.user.id == 4242 && github.event.pull_request.head.repo.id == github.event.repository.id)) && '
      + `${WORKFLOW_REF}) && fromJSON('["self-hosted","linux","x64","${LABEL}"]') || 'ubuntu-latest' }}`,
    );
  });

  it('refuses an owner id that is not a positive integer', () => {
    for (const ownerUserId of [0, -1, 1.5, Number.NaN]) expect(() => renderGatedRunsOn({ ...GATE, ownerUserId })).toThrow(/owner user id/u);
  });

  it('refuses a repository or workflow path that cannot sit inside an expression literal', () => {
    for (const workflowPath of [".github/workflows/it's.yml", '.github/workflows/{0}.yml', '.github/workflows/a}.yml']) {
      expect(() => renderGatedRunsOn({ ...GATE, workflowPath })).toThrow(/unsafe workflow path/u);
      expect(() => parseGatedRunsOn(RENDERED, { ...GATE, workflowPath })).toThrow(/unsafe workflow path/u);
    }
  });
});

describe('parseGatedRunsOn', () => {
  it('round-trips the rendered selection', () => {
    expect(parseGatedRunsOn(RENDERED, GATE)).toEqual({ runsOn: ['self-hosted', 'linux', 'x64', LABEL], routingSwitch: 'CIRUJANO_RUNNER_P3' });
  });

  it('accepts the plain, single-quoted and double-quoted YAML forms of the same selection', () => {
    const singleQuoted = `'${RENDERED.replaceAll("'", "''")}'`;
    const doubleQuoted = `"${RENDERED.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    for (const scalar of [RENDERED, singleQuoted, doubleQuoted]) {
      expect(parseGatedRunsOn(yamlScalar(scalar), GATE).routingSwitch).toBe('CIRUJANO_RUNNER_P3');
    }
  });

  it('accepts a stricter guard that keeps the workflow_ref clause as a top-level conjunct', () => {
    const strict = RENDERED.replace(
      "(github.actor_id == '4242'",
      "(github.actor_id == '4242' && github.repository == 'example-owner/example-app' && (github.event_name != 'pull_request' || github.event.sender.type == 'User')",
    );
    expect(parseGatedRunsOn(strict, GATE).runsOn).toEqual(['self-hosted', 'linux', 'x64', LABEL]);
  });

  it.each([
    ['a selection without the switch gate', RENDERED.replace("vars.CIRUJANO_RUNNER_P3 == 'on' && ", ''), /switch gate/u],
    ['another enrollment switch', RENDERED.replace('CIRUJANO_RUNNER_P3', 'CIRUJANO_RUNNER_P4'), /switch variable must be CIRUJANO_RUNNER_P3/u],
    ['an inverted switch test', RENDERED.replace("== 'on'", "!= 'on'"), /switch gate/u],
    ['a guard without the workflow_ref clause', RENDERED.replace(` && ${WORKFLOW_REF}`, ''), /workflow_ref clause/u],
    ['a workflow_ref clause for another workflow', RENDERED.replace('workflows/ci.yml@', 'workflows/ci-nightly.yml@'), /workflow_ref clause/u],
    ['a top-level || in the guard', RENDERED.replace(` && ${WORKFLOW_REF}`, ` && ${WORKFLOW_REF} || github.event_name == 'schedule'`), /top-level \|\|/u],
    ['unbalanced guard parentheses', RENDERED.replace("(github.actor_id == '4242'", "((github.actor_id == '4242'"), /balanced/u],
    ['a missing runner label', RENDERED.replace('"x64",', ''), /runner labels must be/u],
    ['an extra runner label', RENDERED.replace('"x64",', '"x64","gpu",'), /runner labels must be/u],
    ['another hosted fallback', RENDERED.replace("|| 'ubuntu-latest'", "|| 'ubuntu-24.04'"), /hosted fallback/u],
    ['a missing expression delimiter', RENDERED.replace(' }}', ''), /expression delimiters/u],
    ['a guard without the owner clause', RENDERED.replace("github.actor_id == '4242' && ", ''), /owner clause/u],
    ['a guard with only the workflow_ref clause', RENDERED.replace(/&& \(.*\) && fromJSON/u, `&& (${WORKFLOW_REF}) && fromJSON`), /owner clause/u],
    ['an owner clause for another account', RENDERED.replace("github.actor_id == '4242'", "github.actor_id == '4243'"), /owner clause/u],
    ['a nested expression in the guard', RENDERED.replace("github.actor_id == '4242'", "github.actor_id == '4242' }} junk ${{ true"), /nested expression/u],
  ])('refuses %s and names the rule', (_name, expression, rule) => {
    expect(() => parseGatedRunsOn(expression, GATE)).toThrow(rule);
  });

  it('ignores parentheses and || inside expression string literals', () => {
    const quoted = RENDERED.replace("github.actor_id == '4242'", "github.actor_id == '4242' && github.head_ref != 'a) || (b'' x'");
    expect(parseGatedRunsOn(quoted, GATE).routingSwitch).toBe('CIRUJANO_RUNNER_P3');
  });
});

describe('yamlScalar', () => {
  it('unquotes plain, single-quoted and double-quoted scalars with their escapes', () => {
    expect(yamlScalar(' plain value ')).toBe('plain value');
    expect(yamlScalar("'it''s'")).toBe("it's");
    expect(yamlScalar('"a \\"b\\" \\\\ c"')).toBe('a "b" \\ c');
  });

  it('refuses scalars that YAML would reject or truncate', () => {
    expect(() => yamlScalar(`'${RENDERED}'`)).toThrow(/YAML scalar/u);
    expect(() => yamlScalar('"a "b" c"')).toThrow(/YAML scalar/u);
    expect(() => yamlScalar('"a \\n b"')).toThrow(/YAML scalar/u);
    expect(() => yamlScalar("${{ x == 'a #b' }}")).toThrow(/YAML scalar/u);
  });
});
