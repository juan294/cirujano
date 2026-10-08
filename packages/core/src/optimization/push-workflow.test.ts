import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jsonDigest, sha256 } from './canonical.js';
import { inspectPushWorkflow } from './push-workflow.js';
import { parseWorkflowSource } from './workflow.js';

const directory = new URL('../../fixtures/optimization/push/', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, directory), 'utf8');
const manifest = JSON.parse(read('manifest.json')) as { cases: { name: string; file: string; status: string; reason: string; branch: string; inventory?: string[]; guardedJobIds?: string[] }[] };
const workflowPath = '.github/workflows/ci.yml';
function inspect(source: string, integrationBranch = 'main', inventory: { path: string; source: string }[] = []) {
  return inspectPushWorkflow(source, { workflowHash: sha256(source), workflowPath, integrationBranch, inventory });
}

describe('push-ineligible-reason-codes', () => {
  it('names every case once and covers every refusal rule', () => {
    expect(new Set(manifest.cases.map(entry => entry.name)).size).toBe(manifest.cases.length);
    expect(new Set(manifest.cases.filter(entry => entry.status === 'unsupported').map(entry => entry.reason))).toEqual(new Set(['yaml-alias', 'branch-filter-missing', 'branch-ignore', 'branch-glob', 'multiple-branches', 'branch-mismatch', 'pull-request-target', 'workflow-run-consumer', 'no-guarded-jobs', 'reusable-job', 'job-environment', 'permissions-not-read-only', 'secret-reference', 'status-function-condition', 'unparseable-condition', 'event-context-reference', 'job-continue-on-error', 'workflow-call', 'local-action', 'pull-request-types']));
  });
  for (const entry of manifest.cases) it(entry.name, () => {
    const source = read(entry.file);
    const result = inspect(source, entry.branch, (entry.inventory ?? []).map(path => ({ path: `.github/workflows/${path.split('/').pop()!}`, source: read(path) })));
    expect(result.status).toBe(entry.status);
    expect(result.reason).toBe(entry.reason);
    if (entry.status === 'eligible') {
      expect(result.operations).toEqual([{ type: 'skip-validated-push', integrationBranch: entry.branch, guardedJobIds: entry.guardedJobIds, classifierJobId: 'cirujano_validated_push' }]);
      expect(result.protectedDigest).toBe(jsonDigest(parseWorkflowSource(source)));
      expect(result.structuralFacts).toMatchObject({ integrationBranch: entry.branch, guardedJobCount: entry.guardedJobIds!.length });
    } else {
      expect(result.operations).toEqual([]);
      expect(result.protectedDigest).toBeNull();
    }
  });
});

describe('push workflow eligibility boundaries', () => {
  const source = read('eligible-multi-job.yml');
  it('refuses tampered bytes before any inspection', () => {
    expect(() => inspectPushWorkflow(source, { workflowHash: sha256(`${source}#`), workflowPath, integrationBranch: 'main', inventory: [] })).toThrow();
  });
  it('fails closed when a repository workflow cannot be read strictly', () => {
    expect(inspect(source, 'main', [{ path: '.github/workflows/broken.yml', source: 'on: [push\n' }]).reason).toBe('workflow-inventory-unreadable');
  });
  it('matches workflow_run consumers by workflow name in any case, or by path for an unnamed workflow', () => {
    const consumer = (workflows: string) => [{ path: '.github/workflows/after.yml', source: `on:\n  workflow_run:\n    workflows: [${workflows}]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n` }];
    expect(inspect(source, 'main', consumer('Nightly')).reason).toBe('eligible');
    expect(inspect(source, 'main', consumer('CI')).reason).toBe('workflow-run-consumer');
    expect(inspect(source, 'main', consumer("'ci'")).reason).toBe('workflow-run-consumer');
    const unnamed = source.replace('name: CI\n', '');
    expect(inspect(unnamed, 'main', consumer('CI')).reason).toBe('eligible');
    expect(inspect(unnamed, 'main', consumer(workflowPath)).reason).toBe('workflow-run-consumer');
    expect(inspect(source, 'main', [{ path: workflowPath, source }]).reason).toBe('eligible');
  });
  it('reads every documented way to reference secrets or the event', () => {
    const mutations: [string, string][] = [['${{ secrets.GITHUB_TOKEN }}', "${{ secrets['DEPLOY'] }}"], ['${{ secrets.GITHUB_TOKEN }}', '${{ toJSON(secrets) }}'], ['- run: pnpm lint', '- run: echo ${{ github.head_ref }}'], ['- run: pnpm lint', '- run: echo ${{ github.base_ref }}'], ['- run: pnpm lint', '- run: echo ${{ github.event_name }}'], ['- run: pnpm lint', '- run: echo ${{ github.ref_name }}'], ['- run: pnpm lint', '- run: echo "$GITHUB_EVENT_PATH"'], ['- run: pnpm lint', "- run: echo ${{ github['ref'] }}"], ['- run: pnpm lint', '- run: echo ${{ toJSON(github) }}'], ['- run: pnpm lint', "- run: echo ${{ format('{0}', github) }}"], ['- run: pnpm lint', '- run: echo "$GITHUB_HEAD_REF"'], ['- run: pnpm lint', '- run: echo "$GITHUB_BASE_REF"'], ['- run: pnpm lint', '- run: echo "$GITHUB_WORKFLOW_REF"'], ['- run: pnpm lint', '- run: echo ${{ github.workflow_ref }}'], ['- run: pnpm lint', '- run: echo ${{ toJSON(github.*) }}'], ['- run: pnpm lint', "- if: \"!contains(toJSON(github), 'refs/pull/')\"\n        run: pnpm lint"], ["if: github.repository == 'public-example/benchmark'", "if: \"!contains(toJSON(github), 'refs/pull/')\""]];
    for (const [from, to] of mutations) {
      expect(inspect(source.replace(from, to)).status, to).toBe('unsupported');
    }
    expect(inspect(source.replace('permissions:\n  contents: read\njobs:', 'permissions:\n  contents: read\nenv:\n  REF: ${{ github.ref }}\njobs:')).reason).toBe('event-context-reference');
  });
  it('accepts an absent original condition, an empty permission map and secrets.github_token in any case', () => {
    expect(inspect(source.replace("    if: github.repository == 'public-example/benchmark'\n", '').replace('permissions:\n  contents: read', 'permissions: {}').replace('secrets.GITHUB_TOKEN', 'secrets.github_token')).status).toBe('eligible');
  });
  it('refuses write permissions granted at job level or through write-all', () => {
    expect(inspect(source.replace('permissions:\n  contents: read', 'permissions: write-all')).reason).toBe('permissions-not-read-only');
    expect(inspect(source.replace('    needs: lint\n', '    needs: lint\n    permissions:\n      issues: write\n')).reason).toBe('permissions-not-read-only');
  });
  it('refuses a needs reference to a job that does not exist, and a job id outside the GitHub grammar', () => {
    expect(inspect(source.replace('needs: lint', 'needs: missing')).reason).toBe('unsupported-workflow-shape');
    expect(inspect(source.replace('  lint:\n', "  'lint x':\n").replace('needs: lint', "needs: 'lint x'").replace('needs: [lint, test]', "needs: ['lint x', test]")).reason).toBe('unsupported-workflow-shape');
  });
  it('accepts a subset of the default pull_request activity types only', () => {
    expect(inspect(source.replace('  pull_request:\n    branches: [main]', '  pull_request:\n    types: [opened, synchronize]\n    branches: [main]')).status).toBe('eligible');
    expect(inspect(source.replace('  pull_request:\n    branches: [main]', '  pull_request:\n    types: [labeled]\n    branches: [main]')).reason).toBe('pull-request-types');
  });
  it('binds the inspected inventory into the structural facts', () => {
    const one = inspect(source, 'main', [{ path: '.github/workflows/a.yml', source: 'on: push\njobs: {}\n' }]), two = inspect(source, 'main', [{ path: '.github/workflows/a.yml', source: 'on: push\njobs: {}\n# changed\n' }]);
    expect(one.structuralFacts.inventoryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(one.structuralFacts.inventoryDigest).not.toBe(two.structuralFacts.inventoryDigest);
    expect(inspect(source, 'main', [{ path: '.github/workflows/a.yml', source: 'on: push\njobs: {}\n' }, { path: '.github/workflows/a.yml', source: 'on: push\njobs: {}\n' }]).reason).toBe('workflow-inventory-unreadable');
  });
});
