import {describe,expect,it} from 'vitest';
import {collectSelectedJob,collectSourceDeclaration} from './collect.js';
import {api,options,request,workflow} from './collector-fixture.js';

const selection={repository:request.repository,run:request.run,attempt:request.attempt,workflow:request.workflow};
describe('immutable declaration collection without execution attribution',()=>{
 it.each(['pull_request','schedule','release','workflow_dispatch'])('retains exact %s source without selecting a job or reading jobs',async event=>{
  const fake=api(workflow,r=>(r['repos/example/project/actions/runs/10/attempts/2'] as Record<string,unknown>).event=event);
  const source=await collectSourceDeclaration(selection,options(fake.pageRunner));
  expect(source).toMatchObject({kind:'advisory-declared-source',scope:'repository-at-run-head',run:{id:10,attempt:2,event},source:{path:request.workflow,blobSha:fake.blob,content:workflow,lineStart:1,lineEnd:workflow.split('\n').length}});
  expect(source).not.toHaveProperty('job');expect(source).not.toHaveProperty('mapping');
  expect(fake.calls.every(args=>args.includes('GET')&&!args[5]!.includes('/jobs')&&!args[5]!.includes('/logs'))).toBe(true);
  const execution=await collectSelectedJob(request,options(api(workflow,r=>(r['repos/example/project/actions/runs/10/attempts/2'] as Record<string,unknown>).event=event).pageRunner));
  expect(execution.mapping).toBe('unsupported-mapping');expect(execution.sources).toEqual([]);
 });
 it.each([workflow.replace('    steps:','    strategy: {matrix: {os: [ubuntu-latest]}}\n    steps:'),workflow.replace('name: Install\n        ',''),workflow.replace('name: Install','name: ${{ matrix.name }}')])('retains safe unmappable declarations while execution mapping remains unsupported',async content=>{
  const source=await collectSourceDeclaration(selection,options(api(content).pageRunner));expect(source.source.content).toBe(content);
  expect((await collectSelectedJob(request,options(api(content).pageRunner))).mapping).toBe('unsupported-mapping');
 });
 it.each(['env:\n  NODE_ENV: production\n','env:\n  API_KEY: canary\n','# apiToken: canary\n'])('keeps whole-file refusal even when a safe command is present',async prefix=>{
  await expect(collectSourceDeclaration(selection,options(api(prefix+workflow).pageRunner))).rejects.toThrow('unsafe-source-credential-or-environment');
 });
 it.each(['attempt','head','path','repository','head-repository','blob','tree','mode','encoding'])('rejects altered %s identity or immutable bytes',async kind=>{
  const fake=api(workflow,r=>{
   const run=r['repos/example/project/actions/runs/10/attempts/2'] as Record<string,unknown>;
   if(kind==='attempt')run.run_attempt=3;if(kind==='head')run.head_sha='bad';if(kind==='path')run.path='other.yml';
   if(kind==='repository')run.repository={id:9,full_name:'example/project'};if(kind==='head-repository')run.head_repository={id:9,full_name:'other/fork'};
   const blob=r[Object.keys(r).find(k=>k.includes('/git/blobs/'))!] as Record<string,unknown>;
   if(kind==='blob')blob.content=Buffer.from('changed').toString('base64');if(kind==='encoding')blob.content='not base64';
   const tree=r[Object.keys(r).find(k=>k.includes('/git/trees/'))!] as {tree:Record<string,unknown>[]};
   if(kind==='tree')tree.tree=[];if(kind==='mode')tree.tree[0]!.mode='120000';
  });await expect(collectSourceDeclaration(selection,options(fake.pageRunner))).rejects.toThrow();
 });
 it('round-trips Unicode and CRLF without normalizing blob bytes',async()=>{
  const content=('# café 工具\n'+workflow).replaceAll('\n','\r\n'),fake=api(content);
  const source=await collectSourceDeclaration(selection,options(fake.pageRunner));expect(source.source.content).toBe(content);expect(source.source.blobSha).toBe(fake.blob);
 });
 it('refuses a UTF-8 BOM rather than dropping it under the original blob identity',async()=>{
  await expect(collectSourceDeclaration(selection,options(api('\uFEFF'+workflow).pageRunner))).rejects.toThrow();
 });
 it('rejects unsafe selections before any transport call and enforces source bounds',async()=>{
  const fake=api();await expect(collectSourceDeclaration({...selection,workflow:'../ci.yml'},options(fake.pageRunner))).rejects.toThrow();expect(fake.calls).toEqual([]);
  await expect(collectSourceDeclaration(selection,options(api('#'+'a'.repeat(256*1024)).pageRunner))).rejects.toThrow();
  await expect(collectSourceDeclaration(selection,options(api('#\n'.repeat(10001)).pageRunner))).rejects.toThrow();
 });
 it('rejects tampered source fields, scope, digest and resealed unsafe text',async()=>{
  const {decodeSourceDeclaration,sealSourceDeclaration}=await import('./source-evidence.js');
  const source=await collectSourceDeclaration(selection,options(api().pageRunner));expect(decodeSourceDeclaration(source)).toEqual(source);
  for(const changed of [{...source,scope:'executed'},{...source,job:{}},{...source,digest:'0'.repeat(64)},{...source,source:{...source.source,lineEnd:1}},{...source,source:{...source.source,content:'changed'}}])expect(()=>decodeSourceDeclaration(changed)).toThrow();
  expect(()=>sealSourceDeclaration({...source,source:{...source.source,content:'env: {KEY: value}\n'+workflow}})).toThrow();
 });
});
