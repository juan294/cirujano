import { describe, expect, it } from 'vitest';
import { collectSelectedJob } from './collect.js';
import { api, jobs, options, request, workflow } from './collector-fixture.js';

describe('selected immutable advisory evidence',()=>{
 it('pins run/attempt/source, maps literal names rather than API ordinal, and uses GET only',async()=>{const fake=api();const found=await collectSelectedJob(request,options(fake.pageRunner));expect(found.mapping).toBe('supported');expect(found.steps[1]).toMatchObject({number:17,sourceIndex:0,command:'pnpm install --frozen-lockfile'});expect(found.workflow.blobSha).toBe(fake.blob);expect(found.sources[0]!.content).toBe(workflow);expect(fake.calls.every(a=>a.includes('GET')&&a.includes('X-GitHub-Api-Version: 2022-11-28'))).toBe(true);expect(fake.calls.some(a=>a.some(v=>v.includes('/logs')))).toBe(false);});
 it.each(['attempt','head','path','job-head','blob','tree'])('rejects altered %s identity/hash',async(kind)=>{const fake=api(workflow,r=>{const run=r['repos/example/project/actions/runs/10/attempts/2'] as Record<string,unknown>;if(kind==='attempt')run.run_attempt=3;if(kind==='head')run.head_sha='bad';if(kind==='path')run.path='other.yml';if(kind==='job-head')jobs(r)[0]!.head_sha='3'.repeat(40);if(kind==='blob'){const key=Object.keys(r).find(k=>k.includes('/git/blobs/'))!;(r[key] as Record<string,unknown>).content=Buffer.from('altered').toString('base64');}if(kind==='tree'){const key=Object.keys(r).find(k=>k.includes('/git/trees/'))!;(r[key] as Record<string,unknown>).tree=[];}});await expect(collectSelectedJob(request,options(fake.pageRunner))).rejects.toThrow();});
 it.each(['pull_request','workflow_dispatch'])('keeps %s metadata unbound to executed source',async(event)=>{const fake=api(workflow,r=>(r['repos/example/project/actions/runs/10/attempts/2'] as Record<string,unknown>).event=event);const result=await collectSelectedJob(request,options(fake.pageRunner));expect(result.mapping).toBe('unsupported-mapping');expect(result.sources).toEqual([]);expect(result.steps.every(s=>s.command===null)).toBe(true);});
 it.each([workflow.replace('name: Checks','name: Misleading'),workflow.replace('    steps:','    strategy: {matrix: {os: [ubuntu-latest]}}\n    steps:'),workflow.replace('      - name: Install','      - name: Install\n        run: echo other\n      - name: Install'),workflow.replace('name: Install','name: ${{ matrix.name }}')])('discloses unsupported mapping then accepts corrected source',async(source)=>{const fake=api(source);expect((await collectSelectedJob(request,options(fake.pageRunner))).mapping).toBe('unsupported-mapping');expect((await collectSelectedJob(request,options(api().pageRunner))).mapping).toBe('supported');});
 it('retains missing timing and zero job durations without fabricating measurements',async()=>{const missing=api(workflow,r=>{jobs(r)[0]!.completed_at=null;});const result=await collectSelectedJob(request,options(missing.pageRunner));expect(result.job.completedAt).toBeNull();expect(result.reasonCodes).toContain('missing-job-timing');const zero=api(workflow,r=>{const j=jobs(r)[0]!;j.completed_at=j.started_at;j.steps=[];});expect((await collectSelectedJob(request,options(zero.pageRunner))).job.completedAt).toBe('2026-10-28T10:00:00Z');});
 it('refuses unsafe source paths before a GitHub read',async()=>{const fake=api();await expect(collectSelectedJob({...request,sourceFiles:['../secret']},options(fake.pageRunner))).rejects.toThrow();expect(fake.calls).toEqual([]);});
 it.each(['env:\n  NODE_ENV: production\n', 'env:\n  API_KEY: token-value\n'])('refuses environment-bearing workflow without persisting it',async(prefix)=>{
  const fake=api(prefix+workflow);await expect(collectSelectedJob(request,options(fake.pageRunner))).rejects.toThrow(/unsafe-source/);
 });

 it.each([null,undefined])('keeps absent API steps as partial metadata and recovers on corrected input',async(steps)=>{
  const fake=api(workflow,r=>{jobs(r)[0]!.steps=steps;});const partial=await collectSelectedJob(request,options(fake.pageRunner));expect(partial.mapping).toBe('unsupported-mapping');expect(partial.reasonCodes).toContain('missing-steps');expect(partial.steps).toEqual([]);expect(partial.sources).toEqual([]);
  expect((await collectSelectedJob(request,options(api().pageRunner))).mapping).toBe('supported');
 });

 it.each(['repository','run','jobs','source'])('reports the fixed failed GET stage without provider error text: %s',async(stage)=>{
  const fake=api();const runner: typeof fake.pageRunner=async(command,args,opts)=>{const endpoint=args[5]!;const target=stage==='repository'?endpoint==='repos/example/project':stage==='run'?endpoint.includes('/attempts/2')&&!endpoint.includes('/jobs'):stage==='jobs'?endpoint.includes('/jobs'):endpoint.includes('/git/');if(target)throw new Error('provider-canary-secret');return fake.pageRunner(command,args,opts);};
  await expect(collectSelectedJob(request,options(runner))).rejects.toMatchObject({message:`github-read-unavailable-${stage}`,reasonCode:'github-read-unavailable',stage});
 });

});
