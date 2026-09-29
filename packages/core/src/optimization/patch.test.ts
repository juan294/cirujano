import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPnpmCachePatch, validateCacheOnlyChange } from './patch.js';
import { sha256 } from './canonical.js';
import { parseWorkflowSource, protectedWorkflowDigest } from './workflow.js';
import { provenance } from './optimization.test-helper.js';
import type { ActionReceipt } from './contracts.js';
const directory=new URL('../../fixtures/optimization/',import.meta.url);
const receipt=JSON.parse(readFileSync(new URL('setup-node-receipt.json',directory),'utf8')) as ActionReceipt;
const base=readFileSync(new URL('eligible.yml',directory),'utf8');
const options=(source:string)=>({provenance:{...provenance,workflowHash:sha256(source)},receipt,rootLockfile:true,timedBaseline:true,requiredChecks:['test'],verificationProfilePresent:true});
const expected=(source:string)=>source.replace('node-version: 22.20.0','node-version: 22.20.0\n          cache: pnpm\n          cache-dependency-path: pnpm-lock.yaml');
function applyPatch(source:string,patch:string):string {
 const root=mkdtempSync(join(tmpdir(),'cirujano-cache-patch-'));
 try {mkdirSync(join(root,'.github/workflows'),{recursive:true});writeFileSync(join(root,'.github/workflows/ci.yml'),source);writeFileSync(join(root,'candidate.patch'),patch);execFileSync('git',['apply','--check','candidate.patch'],{cwd:root});execFileSync('git',['apply','candidate.patch'],{cwd:root});return readFileSync(join(root,'.github/workflows/ci.yml'),'utf8');}
 finally {rmSync(root,{recursive:true,force:true});}
}
describe('localized cache-only workflow surgery',()=>{
 const cases=JSON.parse(readFileSync(new URL('manifest.json',directory),'utf8')) as {cases:{file:string;status:string}[]};
 for(const entry of cases.cases.filter(entry=>entry.status==='eligible')) it(`preserves complete protected semantics for ${entry.file}`,()=>{
  const source=readFileSync(new URL(entry.file,directory),'utf8'),result=createPnpmCachePatch(source,options(source));
  expect(result.status).toBe('proposed');expect(result.operation).toEqual({type:'enable-pnpm-cache',jobId:'test',stepIndex:2});
  const tree=parseWorkflowSource(result.candidate) as {jobs:{test:{steps:{with?:Record<string,unknown>}[]}}};expect(tree.jobs.test.steps[2]!.with).toMatchObject({cache:'pnpm','cache-dependency-path':'pnpm-lock.yaml'});
  expect(result.beforeStructuralDigest).toBe(result.afterStructuralDigest);expect(result.beforeStructuralDigest).toBe(protectedWorkflowDigest(source,'test',2));
  expect(applyPatch(source,result.patch)).toBe(result.candidate);expect(result.patch.split('\n').filter(line=>line.startsWith('+')&&!line.startsWith('+++'))).toHaveLength(2);
 });
 it('has an exact minimal golden diff and candidate for the public root fixture',()=>{
  const result=createPnpmCachePatch(base,options(base));expect(result.candidate).toBe(expected(base));
  expect(result.patch).toBe('diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n@@ -13,5 +13,7 @@\n       - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020\n         with:\n           node-version: 22.20.0\n+          cache: pnpm\n+          cache-dependency-path: pnpm-lock.yaml\n       - run: pnpm install --frozen-lockfile\n       - run: pnpm test\n');
 });
 it.each(['crlf','no-final-newline','quoted-key','flow-map','comment-fake-block'])('preserves %s format and applies with real git',format=>{
  let source=base;
  if(format==='crlf') source=base.replaceAll('\n','\r\n');
  if(format==='no-final-newline') source=base.trimEnd();
  if(format==='quoted-key') source=base.replace('node-version:',"'node-version':");
  if(format==='flow-map') source=base.replace('with:\n          node-version: 22.20.0','with: { node-version: "22.20.0" }');
  if(format==='comment-fake-block') source='# - uses: actions/setup-node@fake\n#   with:\n#     node-version: fake\n'+base;
  const result=createPnpmCachePatch(source,options(source));expect(applyPatch(source,result.patch)).toBe(result.candidate);validateCacheOnlyChange(source,result.candidate,'test',2);
  if(format==='crlf') expect(result.candidate.replaceAll('\r\n','')).not.toContain('\n');
  if(format==='no-final-newline') expect(result.candidate.endsWith('\n')).toBe(false);
  if(format==='comment-fake-block') expect(result.candidate.startsWith('# - uses: actions/setup-node@fake\n#   with:\n#     node-version: fake\n')).toBe(true);
 });
 it('is idempotent and binds no-change to the same target',()=>{
  const first=createPnpmCachePatch(base,options(base));const second=createPnpmCachePatch(first.candidate,options(first.candidate));
  expect(second.status).toBe('no-change');expect(second.patch).toBe('');expect(second.candidate).toBe(first.candidate);expect(second.operation).toEqual(first.operation);
 });
 it.each([
  (candidate:string)=>candidate.replace('contents: read','contents: write'),
  (candidate:string)=>candidate.replace('on: [push]','on: [pull_request_target]'),
  (candidate:string)=>candidate.replace('      - run: pnpm test\n',''),
  (candidate:string)=>candidate.replace('pnpm test','pnpm test --coverage.threshold=0'),
  (candidate:string)=>candidate.replace('pnpm install --frozen-lockfile','pnpm install'),
  (candidate:string)=>candidate.replace('      - run: pnpm test','      - if: false\n        run: pnpm test'),
  (candidate:string)=>candidate.replace('      - run: pnpm test','      - continue-on-error: true\n        run: pnpm test'),
  (candidate:string)=>candidate.replace('cache-dependency-path: pnpm-lock.yaml','cache-dependency-path: ../pnpm-lock.yaml'),
  (candidate:string)=>candidate.replace('cache: pnpm','cache: pnpm\n          cache: pnpm'),
  (candidate:string)=>candidate+'# arbitrary model diff\n',
 ])('rejects every unauthorized candidate alteration',mutate=>expect(()=>validateCacheOnlyChange(base,mutate(expected(base)),'test',2)).toThrow());
 it.each(['selected-step-id','consumer','aggregate','dynamic','dependent'])('rejects %s before editing',name=>{
  const source=name==='selected-step-id'?base.replace('        with:\n          node-version','        id: node\n        with:\n          node-version'):readFileSync(new URL(`mutations/${name}.yml`,directory),'utf8');
  expect(()=>createPnpmCachePatch(source,options(source))).toThrow();
 });
 it('rejects stale source, missing lockfile, nested dependency path and explicit disable',()=>{
  expect(()=>createPnpmCachePatch(base,options(base+'# drift'))).toThrow();
  expect(()=>createPnpmCachePatch(base,{...options(base),rootLockfile:false})).toThrow();
  for(const file of ['disabled-cache.yml','unknown-dependency-path.yml','duplicate-key.yml']) {const source=readFileSync(new URL(file,directory),'utf8');expect(()=>createPnpmCachePatch(source,options(source))).toThrow();}
 });
 it.each(['.github/workflows/my workflow.yml','package.json','.github/workflows/nested/ci.yml','.github/workflows/../ci.yml'])('rejects unsupported patch path %s',workflowPath=>{
  expect(()=>createPnpmCachePatch(base,{...options(base),provenance:{...options(base).provenance,workflowPath}})).toThrow();
 });

});
