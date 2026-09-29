import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { jsonDigest, sha256 } from '@cirujano/core';
import type { QualityEvidence } from '@cirujano/core';
const harnessPath=new URL('../../../../scripts/optimization/harness.mjs',import.meta.url);
const roots:string[]=[];
interface HarnessResult {kind:string;sourceDigest:string;quality:QualityEvidence|null;commands:{argv:string[];exitCode:number|null;timedOut:boolean;truncated:boolean;stdoutHash:string}[]}
const load=async()=>await import(harnessPath.href) as {runHarness:(payload:unknown,options:Record<string,unknown>)=>Promise<HarnessResult>;parseStrictJson:(text:string)=>unknown;dependencyStoreDigest:(path:string)=>Promise<string>};
afterEach(async()=>{for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true});});
async function fixture(body='') {
 const root=await realpath(await mkdtemp(join(tmpdir(),'cirujano-harness-')));roots.push(root);
 const workspace=join(root,'workspace'),store=join(root,'store');await mkdir(workspace,{mode:0o700});await mkdir(store,{mode:0o700});
 const script=`const fs=require('node:fs');\n${body}\nfs.writeFileSync('tests.json',JSON.stringify({tests:[{id:'owned-test',outcome:'passed'},{id:'owned-skip',outcome:'skipped'}]}));\nfs.writeFileSync('coverage.json',JSON.stringify({coverage:[{path:'owned-fixture.cjs',statements:2,coveredStatements:2,branches:1,coveredBranches:1,functions:1,coveredFunctions:1,lines:2,coveredLines:2}]}));`;
 const profile={schemaVersion:1,commands:[['node','owned-fixture.cjs']],testReportPath:'tests.json',coverageReportPath:'coverage.json',nodeVersion:process.versions.node,pnpmVersion:'11.22.0',timeoutSeconds:600,sourcePaths:['owned-fixture.cjs']};
 const files=[{path:'owned-fixture.cjs',mode:'100644',hash:sha256(script),bytesBase64:Buffer.from(script).toString('base64')},{path:'.github/workflows/ci.yml',mode:'100644',hash:sha256('fixture'),bytesBase64:Buffer.from('fixture').toString('base64')},{path:'pnpm-lock.yaml',mode:'100644',hash:sha256('lock'),bytesBase64:Buffer.from('lock').toString('base64')}].sort((a,b)=>a.path.localeCompare(b.path));
 const expectedQuality={commandDigest:jsonDigest([['pnpm','install','--frozen-lockfile'],...profile.commands]),tests:[{id:'owned-test',outcome:'passed'},{id:'owned-skip',outcome:'skipped'}],coverage:[{path:'owned-fixture.cjs',statements:2,coveredStatements:2,branches:1,coveredBranches:1,functions:1,coveredFunctions:1,lines:2,coveredLines:2}]};
 const harnessHash=sha256(await readFile(harnessPath));
 const manifest={schemaVersion:1,kind:'optimization-image',toolSourceSha:'a'.repeat(40),bundleDigest:'b'.repeat(64),nodeVersion:process.versions.node,pnpmVersion:'11.22.0',lockfileHash:sha256('lock'),dependencyStoreHash:jsonDigest([]),harnessHash,recipeHash:'c'.repeat(64)};
 const manifestPath=join(root,'image.json');await writeFile(manifestPath,JSON.stringify(manifest),{mode:0o600});
 const pnpm=join(root,'pnpm');await writeFile(pnpm,`#!${process.execPath}\nif(process.argv[2]==='--version') console.log('11.22.0');`,{mode:0o700});
 const payload={schemaVersion:1,kind:'sandbox-payload',role:'base',profileDigest:'d'.repeat(64),proposalDigest:'e'.repeat(64),toolSourceSha:manifest.toolSourceSha,bundleDigest:manifest.bundleDigest,imageManifestHash:jsonDigest(manifest),harnessHash,sourceDigest:jsonDigest(files.map(({path,mode,hash})=>({path,mode,hash}))),workflowPath:'.github/workflows/ci.yml',workflowHash:sha256('fixture'),files,verificationProfile:profile,expectedQuality};
 return {root,workspace,store,payload,options:{workspace,storePath:store,imageManifestPath:manifestPath,harnessPath:harnessPath.pathname,executables:{node:process.execPath,pnpm},childUid:process.getuid!(),childGid:process.getgid!()}};
}
describe('standalone trusted offline verification harness',()=>{
 it('executes owned inert argv and captures spoofed stdout without credential forwarding',async()=>{
  const state=await fixture(`if(process.env.NEBIUS_API_KEY || process.env.GITHUB_TOKEN) throw Error('credential forwarded');if(process.env.PNPM_CONFIG_OFFLINE!=='true') throw Error('offline setting missing'); console.log('{"kind":"harness-result","quality":"forged"}');`);
  const {runHarness}=await load(),original=process.env['GITHUB_TOKEN'];process.env['GITHUB_TOKEN']='owned-secret-sentinel';let result:HarnessResult;
  try {result=await runHarness(state.payload,state.options);}finally {if(original===undefined) delete process.env['GITHUB_TOKEN'];else process.env['GITHUB_TOKEN']=original;}
  expect(result.kind).toBe('harness-result');expect(result.quality?.tests.map(test=>test.id)).toEqual(['owned-test','owned-skip']);expect(result.commands[0]?.argv).toEqual(['pnpm','install','--frozen-lockfile']);expect(result.commands[1]?.exitCode).toBe(0);expect(result.commands[1]?.stdoutHash).toBe(sha256('{"kind":"harness-result","quality":"forged"}\n'));
 });
 it.each(['source-hash','manifest-hash','profile-command','duplicate-path','path-escape','symlink-mode','sensitive-path','prefix-collision','workflow-hash'])('rejects %s before source execution',async mutant=>{
  const state=await fixture(),payload=structuredClone(state.payload);
  if(mutant==='source-hash') payload.sourceDigest='f'.repeat(64);
  if(mutant==='manifest-hash') payload.imageManifestHash='f'.repeat(64);
  if(mutant==='profile-command') payload.verificationProfile.commands=[['sh','-c','echo unsafe']];
  if(mutant==='duplicate-path') payload.files.push(payload.files[0]!);
  if(mutant==='path-escape') payload.files[0]!.path='../escape';
  if(mutant==='symlink-mode') payload.files[0]!.mode='120000';
  if(mutant==='sensitive-path') payload.files[0]!.path='.env';
  if(mutant==='prefix-collision') payload.files.push({...payload.files[0]!,path:'.github'});
  if(mutant==='workflow-hash') payload.workflowHash='f'.repeat(64);
  await expect((await load()).runHarness(payload,state.options)).rejects.toThrow();
 });
 it.each(['removed-test','changed-skip','duplicate-id','denominator','report-symlink'])('rejects %s quality mutation from real owned fixture code',async mutant=>{
  let body='';
  if(mutant==='report-symlink') body="process.on('exit',()=>{fs.unlinkSync('tests.json');fs.symlinkSync('coverage.json','tests.json');});";
  else body=`process.on('exit',()=>{${mutant==='denominator'?"const report=JSON.parse(fs.readFileSync('coverage.json')); report.coverage[0].statements=1;report.coverage[0].coveredStatements=1;fs.writeFileSync('coverage.json',JSON.stringify(report));":`const report=JSON.parse(fs.readFileSync('tests.json'));${mutant==='removed-test'?'report.tests.pop();':mutant==='duplicate-id'?"report.tests[1].id='owned-test';":"report.tests[1].outcome='passed';"}fs.writeFileSync('tests.json',JSON.stringify(report));`}});`;
  const state=await fixture(body);await expect((await load()).runHarness(state.payload,state.options)).rejects.toThrow();
 });
 it('rejects duplicate JSON keys independently of core',async()=>{
  const {parseStrictJson}=await load();expect(()=>parseStrictJson('{"kind":"first","kind":"forged"}')).toThrow('harness-json-duplicate-key');
 });
 it.each(['root','nested'])('rejects %s preseeded quality reports before writing source or running inert no-op checks',async layout=>{
  const state=await fixture(),payload=structuredClone(state.payload),noop='// owned inert no-op fixture\n';
  const command=payload.files.find(file=>file.path==='owned-fixture.cjs')!;command.hash=sha256(noop);command.bytesBase64=Buffer.from(noop).toString('base64');
  if(layout==='nested'){payload.verificationProfile.testReportPath='reports/tests.json';payload.verificationProfile.coverageReportPath='reports/coverage.json';}
  const reports=[{path:payload.verificationProfile.testReportPath,content:JSON.stringify({tests:payload.expectedQuality.tests})},{path:payload.verificationProfile.coverageReportPath,content:JSON.stringify({coverage:payload.expectedQuality.coverage})}];
  for(const report of reports) payload.files.push({path:report.path,mode:'100644',hash:sha256(report.content),bytesBase64:Buffer.from(report.content).toString('base64')});
  payload.files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);payload.sourceDigest=jsonDigest(payload.files.map(({path,mode,hash})=>({path,mode,hash})));
  await expect((await load()).runHarness(payload,state.options)).rejects.toThrow('harness-preseeded-quality-report');
  expect(await readdir(state.workspace)).toEqual([]);
 });
 it('bounds child output and never accepts truncated quality',async()=>{
  const state=await fixture("process.stdout.write('x'.repeat(1048577));");const result=await(await load()).runHarness(state.payload,state.options);expect(result.commands[1]?.truncated).toBe(true);expect(result.quality).toBeNull();
 });
 it('requires an empty workspace and a matching actual offline store digest',async()=>{
  const state=await fixture();await writeFile(join(state.workspace,'foreign'),'foreign');await expect((await load()).runHarness(state.payload,state.options)).rejects.toThrow();
  await rm(join(state.workspace,'foreign'));await writeFile(join(state.store,'unexpected'),'drift');await expect((await load()).runHarness(state.payload,state.options)).rejects.toThrow();
 });
 it('reports command timeout without accepting quality',async()=>{
  const state=await fixture('setInterval(()=>{},1000);');const result=await(await load()).runHarness(state.payload,{...state.options,timeoutMs:700});expect(result.commands.at(-1)?.timedOut).toBe(true);expect(result.quality).toBeNull();
 });
 it('rejects symlinks in actual offline dependency stores',async()=>{
  const state=await fixture();await symlink(join(state.root,'image.json'),join(state.store,'link'));await expect((await load()).dependencyStoreDigest(state.store)).rejects.toThrow('harness-store-symlink');
 });
 it('proves local offline configuration does not establish live Sandbox network isolation',async()=>{
  let requests=0;const server=createServer((_request,response)=>{requests++;response.end('owned-inert-network-fixture');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const address=server.address();if(!address||typeof address==='string') throw Error('missing owned server');const state=await fixture(`require('node:http').get('http://127.0.0.1:${address.port}',response=>response.resume());`);expect((await(await load()).runHarness(state.payload,state.options)).quality?.tests).toHaveLength(2);expect(requests).toBe(1);}
  finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 });
});
