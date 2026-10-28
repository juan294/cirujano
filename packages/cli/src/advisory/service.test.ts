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
