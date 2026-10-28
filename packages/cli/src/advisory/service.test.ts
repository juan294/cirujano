import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runCli } from '../cli.js';
import { withOperationStore } from '../optimization/store.js';
import { canonicalJson } from '@cirujano/core';
import { evidenceFixture } from './fixture.js';
import { createAdvisoryService } from './service.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('reads real private evidence through local inbox and status, preserving exact bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'advisory-'));roots.push(root);const dir=join(root,'evidence');const bundle=evidenceFixture();
 await withOperationStore(dir,async store=>store.writeText('evidence.json',canonicalJson(bundle)));
 const stdout:string[]=[],stderr:string[]=[];const io={stdout:(s:string)=>stdout.push(s),stderr:(s:string)=>stderr.push(s)};
 const service=createAdvisoryService();
 expect(await runCli(['advisory','inbox','--input',dir,'--format','json'],io,undefined,undefined,undefined,undefined,service)).toBe(0);
 expect(JSON.parse(stdout.pop()!).payload.cards[0].durationMs).toBe(120000);
 expect(await runCli(['advisory','status','--operation',dir,'--format','json'],io,undefined,undefined,undefined,undefined,service)).toBe(0);
 expect(JSON.parse(stdout.pop()!).payload.digest).toBe(bundle.digest);expect(stderr).toEqual([]);
 expect((await stat(join(dir,'evidence.json'))).mode&0o777).toBe(0o600);
 expect(await readFile(join(dir,'evidence.json'),'utf8')).toBe(canonicalJson(bundle));
});
it('never exposes provider errors and distinguishes usage from invalid evidence',async()=>{
 const output:string[]=[];const io={stdout:(s:string)=>output.push(s),stderr:(s:string)=>output.push(s)};
 expect(await runCli(['advisory','inbox','--input','missing'],io)).toBe(1);
 expect(output.join('')).toContain('local-only access');
 expect(await runCli(['advisory','inbox','--bad','x'],io)).toBe(2);
 expect(await runCli(['advisory','inbox'],io,undefined,undefined,undefined,undefined,{run:async()=>{throw new Error('secret_canary');}})).toBe(1);
 expect(output.join('')).not.toContain('secret_canary');
});
it('rejects symlink paths, active locks and output reuse, then accepts a fresh directory',async()=>{
 const {symlink}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'advisory-recovery-'));roots.push(root);
 const dir=join(root,'retained');await withOperationStore(dir,async store=>store.writeText('evidence.json',canonicalJson(evidenceFixture())));
 const alias=join(root,'alias');await symlink(dir,alias);const output:string[]=[];const io={stdout:(s:string)=>output.push(s),stderr:(s:string)=>output.push(s)};
 expect(await runCli(['advisory','inbox','--input',alias,'--format','json'],io)).toBe(1);expect(output.pop()).toContain('advisory-unsafe-path');
 const args=['advisory','collect','--repository','example/project','--run','10','--attempt','1','--workflow','.github/workflows/ci.yml','--job-key','check','--job-id','20','--output',dir];
 const service=createAdvisoryService({pageRunner:async()=>{throw new Error('must never reach network');}});
 expect(await runCli(args,io,undefined,undefined,undefined,undefined,service)).toBe(1);expect(output.pop()).toContain('advisory-output-exists');
 await withOperationStore(join(root,'active'),async()=>{
   const active=[...args];active[active.length-1]=join(root,'active');
   expect(await runCli(active,io,undefined,undefined,undefined,undefined,service)).toBe(1);expect(output.pop()).toContain('advisory-active-lock');
 });
 expect(await runCli(['advisory','inbox','--input',dir,'--format','json'],io)).toBe(0);expect(JSON.parse(output.pop()!).payload.cards).toHaveLength(1);
});
it('collects through the real CLI, then opens inbox and inspects status without further GETs',async()=>{
 const {api,options}=await import('./collector-fixture.js');const fake=api();
 const root=await mkdtemp(join(tmpdir(),'advisory-collect-'));roots.push(root);const dir=join(root,'new');
 const service=createAdvisoryService(options(fake.pageRunner));const output:string[]=[];const io={stdout:(s:string)=>output.push(s),stderr:(s:string)=>output.push(s)};
 const collect=['advisory','collect','--repository','example/project','--run','10','--attempt','2','--workflow','.github/workflows/ci.yml','--job-key','check','--job-id','20','--output',dir];
 expect(await runCli(collect,io,undefined,undefined,undefined,undefined,service)).toBe(0);
 expect(output.pop()).toContain('Advisory status: complete'); const reads=fake.calls.length;expect(reads).toBeGreaterThan(0);
 expect(await runCli(['advisory','inbox','--input',dir,'--format','json'],io,undefined,undefined,undefined,undefined,service)).toBe(0);
 expect(JSON.parse(output.pop()!).payload.cards[0].steps[1]).toMatchObject({category:'install',share:0.5});
 expect(await runCli(['advisory','status','--operation',dir,'--format','json'],io,undefined,undefined,undefined,undefined,service)).toBe(0);expect(JSON.parse(output.pop()!).status).toBe('complete');
 expect(fake.calls.length).toBe(reads);
 expect(await runCli(collect,io,undefined,undefined,undefined,undefined,service)).toBe(1);expect(fake.calls.length).toBe(reads);
 collect[collect.length-1]=join(root,'fresh');expect(await runCli(collect,io,undefined,undefined,undefined,undefined,service)).toBe(0);
});
it('names unsafe source refusal and the affected output without provider text',async()=>{
 const {api,options,workflow}=await import('./collector-fixture.js');const fake=api('env:\n  NODE_ENV: production\n'+workflow);
 const root=await mkdtemp(join(tmpdir(),'advisory-unsafe-'));roots.push(root);const dir=join(root,'out');const output:string[]=[];
 const code=await runCli(['advisory','collect','--repository','example/project','--run','10','--attempt','2','--workflow','.github/workflows/ci.yml','--job-key','check','--job-id','20','--output',dir],{stdout:s=>output.push(s),stderr:s=>output.push(s)},undefined,undefined,undefined,undefined,createAdvisoryService(options(fake.pageRunner)));
 expect(code).toBe(1);expect(output.join('')).toContain('unsafe-source-credential-or-environment');expect(output.join('')).toContain(dir.replaceAll('_','\\_'));
});
it('prepares locally, makes one explicitly permitted request and reuses bound labels without network',async()=>{
 const {writeFile}=await import('node:fs/promises');const {permitTemplate}=await import('./permit.js');const {readPreparedOperation}=await import('./prepare.js');
 const root=await mkdtemp(join(tmpdir(),'advisory-cli-enrich-'));roots.push(root);const input=join(root,'evidence');
 await withOperationStore(input,async store=>store.writeText('evidence.json',canonicalJson(evidenceFixture())));
 let sends=0;const now=()=>new Date('2026-10-28T12:00:00Z');const service=createAdvisoryService({now,apiKey:'test-bearer',permitLedger:join(root,'ledger'),fetch:async(_url,init)=>{sends++;const body=JSON.parse(init!.body as string);return new Response(JSON.stringify({model:'jev-1.14.0',answers:Object.fromEntries(Object.keys(body.questions).map(id=>[id,{type:'noul',noul:0.9}])),usage:{input_tokens:120,output_tokens:10}}));}});
 const output:string[]=[];const io={stdout:(s:string)=>output.push(s),stderr:(s:string)=>output.push(s)};const request=join(root,'prepared'),enriched=join(root,'result');
 expect(await runCli(['advisory','prepare','--input',input,'--task','labels','--output',request],io,undefined,undefined,undefined,undefined,service)).toBe(0);expect(sends).toBe(0);
 const {prepared}=await readPreparedOperation(request);const permit=join(root,'permit.json');await writeFile(permit,JSON.stringify({...permitTemplate(prepared,now()),kind:'jev-advisory-permit',payloadReviewed:true}),{mode:0o600});
 expect(await runCli(['advisory','enrich','--request',request,'--permit',permit,'--output',enriched],io,undefined,undefined,undefined,undefined,service)).toBe(0);expect(sends).toBe(1);
 expect(await runCli(['advisory','inbox','--input',input,'--enrichment',enriched,'--format','json'],io,undefined,undefined,undefined,undefined,service)).toBe(0);
 const card=JSON.parse(output.pop()!).payload.cards[0];expect(card.durationMs).toBe(120000);expect(card.semanticLabels[0]).toMatchObject({support:'supported',probability:0.9});expect(sends).toBe(1);
 expect(await runCli(['advisory','status','--operation',enriched,'--format','json'],io,undefined,undefined,undefined,undefined,service)).toBe(0);expect(sends).toBe(1);
});
it('runs local search and explicit search enrichment, rejecting a changed query without further sends',async()=>{
 const {writeFile}=await import('node:fs/promises');const {permitTemplate}=await import('./permit.js');const {readPreparedOperation}=await import('./prepare.js');
 const root=await mkdtemp(join(tmpdir(),'advisory-search-'));roots.push(root);const input=join(root,'evidence');await withOperationStore(input,async store=>store.writeText('evidence.json',canonicalJson(evidenceFixture())));
 let sends=0;const now=()=>new Date('2026-10-28T12:00:00Z'),output:string[]=[];const io={stdout:(s:string)=>output.push(s),stderr:(s:string)=>output.push(s)};
 const service=createAdvisoryService({now,apiKey:'test-key',permitLedger:join(root,'ledger'),fetch:async(_url,init)=>{
  sends++;const body=JSON.parse(init!.body as string);const answers=Object.fromEntries(Object.entries(body.questions as Record<string,{type:string;criteria:Record<string,string>}>).map(([id,q])=>[id,q.type==='noul'?{type:'noul',noul:0.9}:{type:'choice',choice:Object.keys(q.criteria)[0],confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map((key,index)=>[key,index===0?1:0]))}]));
  return new Response(JSON.stringify({model:'jev-1.14.0',answers,usage:{input_tokens:120,output_tokens:10}}));
 }});
 const query='Where is dependency installation?';
 expect(await runCli(['advisory','ask','--input',input,'--question',query,'--format','json'],io,undefined,undefined,undefined,undefined,service)).toBe(0);expect(sends).toBe(0);expect(JSON.parse(output.pop()!).payload.method).toBe('lexical');
 const request=join(root,'request'),result=join(root,'result');expect(await runCli(['advisory','prepare','--input',input,'--task','search','--question',query,'--output',request],io,undefined,undefined,undefined,undefined,service)).toBe(0);expect(sends).toBe(0);
 const {prepared}=await readPreparedOperation(request);const permit=join(root,'permit.json');await writeFile(permit,JSON.stringify({...permitTemplate(prepared,now()),kind:'jev-advisory-permit',payloadReviewed:true}),{mode:0o600});
 expect(await runCli(['advisory','enrich','--request',request,'--permit',permit,'--output',result],io,undefined,undefined,undefined,undefined,service)).toBe(0);expect(sends).toBe(1);
 expect(await runCli(['advisory','ask','--input',input,'--question',query,'--enrichment',result,'--format','json'],io,undefined,undefined,undefined,undefined,service)).toBe(0);expect(JSON.parse(output.pop()!).payload.hits).toHaveLength(1);expect(sends).toBe(1);
 expect(await runCli(['advisory','ask','--input',input,'--question','different query','--enrichment',result,'--format','json'],io,undefined,undefined,undefined,undefined,service)).toBe(1);expect(sends).toBe(1);
 const mismatch=JSON.parse(output.pop()!);expect(mismatch.nextActions[0]).toContain('cirujano advisory ask --input');expect(mismatch.nextActions.some((action:string)=>action.includes('advisory prepare')&&action.includes('--task search'))).toBe(true);
 expect(await runCli(['advisory','ask','--input',input,'--question','different query','--format','json'],io,undefined,undefined,undefined,undefined,service)).toBe(0);expect(JSON.parse(output.pop()!).status).toBe('no-match');
});
it('refuses a sensitive local query before reading enrichment and never echoes it',async()=>{
 const output:string[]=[];const io={stdout:(s:string)=>output.push(s),stderr:(s:string)=>output.push(s)};
 expect(await runCli(['advisory','ask','--question','{"apiKey":"literal-sensitive-canary"}','--enrichment','missing-result','--format','json'],io)).toBe(1);
 const refusal=output.pop()!;expect(JSON.parse(refusal).reasonCodes).toContain('search-sensitive-query');
 expect(refusal).not.toContain('literal-sensitive-canary');
 expect(await runCli(['advisory','ask','--question','ordinary dependency query','--format','json'],io)).toBe(0);expect(JSON.parse(output.pop()!).status).toBe('no-match');
});
