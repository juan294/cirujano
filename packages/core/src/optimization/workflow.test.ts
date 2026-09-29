import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectWorkflow, protectedWorkflowDigest } from './workflow.js';
import { sha256 } from './canonical.js';
import { provenance } from './optimization.test-helper.js';
import type { ActionReceipt } from './contracts.js';
const directory = new URL('../../fixtures/optimization/', import.meta.url);
const receipt = JSON.parse(readFileSync(new URL('setup-node-receipt.json',directory),'utf8')) as ActionReceipt;
const manifest = JSON.parse(readFileSync(new URL('manifest.json',directory),'utf8')) as { cases: {name:string; file:string; status:string; reason:string; gate:string; providerCalls:number|null;timedBaseline?:boolean}[] };
function inspect(source:string,timedBaseline=true) { return inspectWorkflow(source,{ provenance:{ ...provenance, workflowHash:sha256(source) }, receipt, rootLockfile:true, timedBaseline, requiredChecks:['test'], verificationProfilePresent:true }); }
describe('exact safe workflow contract', () => {
  it('contains exactly 21 independently named evaluation cases', () => {
    expect(manifest.cases).toHaveLength(21); expect(new Set(manifest.cases.map(entry => entry.name)).size).toBe(21);
  });
  for (const entry of manifest.cases) it(entry.name, () => {
    const result = inspect(readFileSync(new URL(entry.file,directory),'utf8'),entry.timedBaseline!==false);
    expect(result.status).toBe(entry.status); expect(result.reason).toBe(entry.reason);
    if (entry.status !== 'eligible') { expect(result.operations).toEqual([]); expect(entry.providerCalls).toBe(0); }
  });
  it.each(['consumer', 'aggregate', 'dynamic', 'dependent', 'missing-permission', 'alternate-checkout', 'secret-env'])('rejects mutation %s', name => {
    expect(inspect(readFileSync(new URL(`mutations/${name}.yml`,directory),'utf8')).status).toBe('unsupported');
  });
  it('preserves on as a string key and freezes every protected semantic', () => {
    const source = readFileSync(new URL('eligible.yml',directory),'utf8');
    const result=inspect(source); expect(result.status).toBe('eligible');
    const patched=source.replace('node-version: 22.20.0','node-version: 22.20.0\n          cache: pnpm\n          cache-dependency-path: pnpm-lock.yaml');
    expect(protectedWorkflowDigest(source,'test',2)).toBe(protectedWorkflowDigest(patched,'test',2));
    expect(protectedWorkflowDigest(source.replace('pnpm test','pnpm test --skip'),'test',2)).not.toBe(result.protectedDigest);
  });
  it('rejects immutable source tampering and prerequisite loss before inference', () => {
    const source=readFileSync(new URL('eligible.yml',directory),'utf8');
    const evidence={ provenance,receipt,rootLockfile:true,timedBaseline:true,requiredChecks:['test'],verificationProfilePresent:true };
    expect(() => inspectWorkflow(source,evidence)).toThrow();
    expect(inspectWorkflow(source,{...evidence,provenance:{...provenance,workflowHash:sha256(source)},timedBaseline:false}).reason).toBe('no-timed-baseline');
    expect(inspectWorkflow(source,{...evidence,provenance:{...provenance,workflowHash:sha256(source)},requiredChecks:[]}).reason).toBe('missing-required-checks');
  });
});

describe('reviewed workflow refusals',()=>{
  const source=readFileSync(new URL('eligible.yml',directory),'utf8');
  it('returns no-change for both real current Cirujano CI jobs',()=>{
    const cached=readFileSync(new URL('../../../../.github/workflows/ci.yml',import.meta.url),'utf8');
    for(const jobId of ['checks','ubuntu_24_04']) expect(inspectWorkflow(cached,{provenance:{...provenance,jobId,workflowHash:sha256(cached)},receipt,rootLockfile:true,timedBaseline:false,requiredChecks:[],verificationProfilePresent:false}).reason).toBe('already-cached');
  });
  it('recognizes existing official setup-node caching before mutable runtime eligibility',()=>{
    const cached=source.replace(receipt.commitSha,'v7').replace('22.20.0','22').replace('node-version: 22','node-version: 22\n          cache: pnpm');
    expect(inspect(cached).reason).toBe('already-cached');
  });
  it.each([
    source.replace('jobs:','defaults:\n  run:\n    working-directory: sub\njobs:'),
    source.replace('    runs-on:','    defaults:\n      run:\n        working-directory: sub\n    runs-on:'),
    source.replace('- run: pnpm test', '- env:\n          NEBIUS_API_KEY: synthetic-canary\n        run: pnpm test'),
    source.replace('node-version: 22.20.0', 'node-version: !evil 22.20.0'),
  ])('rejects ambiguous execution context and secret keys',mutated=>expect(inspect(mutated).status).toBe('unsupported'));
});
