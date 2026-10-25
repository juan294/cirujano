import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Group = { patterns: string[]; 'exclude-patterns'?: string[]; 'applies-to'?: string; 'update-types'?: string[] };
type Update = { 'package-ecosystem': string; 'target-branch': string; groups?: Record<string, Group> };
type Workflow = { jobs: Record<string, { steps: { uses?: string }[] }> };
const root = resolve(import.meta.dirname, '../../..');
const config = parse(readFileSync(resolve(root, '.github/dependabot.yml'), 'utf8')) as { updates: Update[] };
const workflow = parse(readFileSync(resolve(root, '.github/workflows/codeql.yml'), 'utf8')) as Workflow;
const matches = (pattern: string, name: string): boolean =>
  new RegExp(`^${pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*')}$`, 'u').test(name);
const codeqlRefs = (refs: string[]): string[] => refs.filter(ref => ref.startsWith('github/codeql-action/'));
const consistent = (refs: string[]): boolean => new Set(codeqlRefs(refs).map(ref => ref.split('@')[1])).size === 1;

// Model the documented first matching group and its version-update scope.
// This is a local config oracle, not a live Dependabot updater execution.
function updateGroup(update: Update, refs: string[], selected: string, next: string): string[] {
  const group = Object.values(update.groups ?? {}).find(candidate =>
    (candidate['applies-to'] ?? 'version-updates') === 'version-updates' &&
    candidate.patterns.some(pattern => matches(pattern, selected)) &&
    !candidate['exclude-patterns']?.some(pattern => matches(pattern, selected)));
  return refs.map(ref => {
    const [name] = ref.split('@');
    if (name === undefined) throw new Error('missing dependency name');
    const included = group
      ? group.patterns.some(pattern => matches(pattern, name)) && !group['exclude-patterns']?.some(pattern => matches(pattern, name))
      : name === selected;
    return included ? `${name}@${next}` : ref;
  });
}

describe('CodeQL dependency updates', () => {
  const update = config.updates.find(entry => entry['package-ecosystem'] === 'github-actions');
  const actual = Object.values(workflow.jobs).flatMap(job => job.steps.flatMap(step => step.uses ? [step.uses] : []));
  const fixture = [...actual, `github/codeql-action/upload-sarif@${codeqlRefs(actual)[0]?.split('@')[1]}`];

  it('updates init, analyze and upload together without grouping unrelated actions', () => {
    expect(update?.['target-branch']).toBe('develop');
    if (!update) throw new Error('missing github-actions updater');
    expect(consistent(actual)).toBe(true);
    const group = Object.values(update.groups ?? {}).find(candidate => candidate.patterns.some(pattern => matches(pattern, 'github/codeql-action/init')));
    expect(group?.['update-types']).toBeUndefined();
    expect(group?.['exclude-patterns']).toBeUndefined();
    const next = 'a'.repeat(40);
    const changed = updateGroup(update, fixture, 'github/codeql-action/init', next);
    expect(codeqlRefs(changed)).toHaveLength(3);
    expect(codeqlRefs(changed).every(ref => ref.endsWith(`@${next}`))).toBe(true);
    expect(consistent(changed)).toBe(true);
    expect(changed.filter(ref => !ref.startsWith('github/codeql-action/'))).toEqual(actual.filter(ref => !ref.startsWith('github/codeql-action/')));
  });

  it('rejects the independent-bump regression', () => {
    if (!update) throw new Error('missing github-actions updater');
    const changed = updateGroup({ ...update, groups: {} }, fixture, 'github/codeql-action/init', 'b'.repeat(40));
    expect(consistent(changed)).toBe(false);
  });
});
