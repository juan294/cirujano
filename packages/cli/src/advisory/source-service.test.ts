import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../cli.js';
import {createAdvisoryService} from './service.js';
import {api,options,request,workflow} from './collector-fixture.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(content=workflow) {
 const root=await mkdtemp(join(tmpdir(),'advisory-source-'));roots.push(root);
 const fake=api(content,r=>(r['repos/example/project/actions/runs/10/attempts/2'] as Record<string,unknown>).event='pull_request');
 let sends=0;const output:string[]=[];
 const service=createAdvisoryService({...options(fake.pageRunner),fetch:async()=>{sends++;throw Error('unexpected-model-call');}}),io={stdout:(s:string)=>output.push(s),stderr:(s:string)=>output.push(s)};
 const collect=(directory:string)=>runCli(['advisory','collect-source','--repository',request.repository,'--run','10','--attempt','2','--workflow',request.workflow,'--output',directory,'--format','json'],io,undefined,undefined,undefined,undefined,service);
 const ask=(directory:string,question:string,format='json')=>runCli(['advisory','ask-source','--input',directory,'--question',question,'--format',format],io,undefined,undefined,undefined,undefined,service);
 return {root,fake,output,service,io,collect,ask,sends:()=>sends};
}
it('collects private exact source bytes and searches immutable line references through the CLI without execution metrics',async()=>{
 const f=await fixture(),input=join(f.root,'source');expect(await f.collect(input)).toBe(0);
 const source=JSON.parse(await readFile(join(input,'source-evidence.json'),'utf8'));
 expect(source.source.content).toBe(workflow);expect((await stat(join(input,'source-evidence.json'))).mode&0o777).toBe(0o600);
 const reads=f.fake.calls.length;expect(await f.ask(input,'Where is dependency installation?')).toBe(0);
 const value=JSON.parse(f.output.pop()!);expect(value).toMatchObject({status:'complete',payload:{kind:'source-search',scope:'repository-at-run-head',method:'lexical',documentCount:1}});
 const hit=value.payload.hits[0];expect(hit.repository.name).toBe(request.repository);expect(hit.run.headSha).toBe('1'.repeat(40));expect(hit.blobSha).toBe(f.fake.blob);
 expect(hit.text).toContain('pnpm install --frozen-lockfile');expect(hit.text).toBe(workflow.split('\n').slice(hit.lineStart-1,hit.lineEnd).join('\n'));
 expect(hit).not.toHaveProperty('job');expect(hit).not.toHaveProperty('durationMs');expect(hit).not.toHaveProperty('githubHostedChargeUsd');
 expect(value.limitations.join(' ')).toContain('does not establish execution');expect(f.fake.calls).toHaveLength(reads);expect(f.sends()).toBe(0);
 expect(await f.ask(input,'dependency installation','markdown')).toBe(0);const markdown=f.output.pop()!;
 expect(markdown).toContain('repository-at-run-head');expect(markdown).toContain('/blob/'+'1'.repeat(40)+'/');expect(markdown).toContain('#L');expect(markdown).not.toContain('Observed job duration');
});
it('keeps matching hostile source text inert and never echoes a sensitive refused query',async()=>{
 const content=workflow.replace('pnpm install --frozen-lockfile','echo "<script>alert(1)</script>```"'),f=await fixture(content),input=join(f.root,'source');expect(await f.collect(input)).toBe(0);
 expect(await f.ask(input,'echo','markdown')).toBe(0);expect(f.output.pop()).toContain('````text');
 expect(await f.ask(input,'{"apiKey":"private-query-canary"}')).toBe(1);const failure=f.output.pop()!;expect(failure).not.toContain('private-query-canary');expect(JSON.parse(failure).reasonCodes).toContain('search-sensitive-query');
 expect(await f.ask(input,'Disable the tests')).toBe(0);expect(JSON.parse(f.output.pop()!).status).toBe('no-match');expect(f.sends()).toBe(0);
});
it('does not overwrite source outputs and recovers through a fresh output and valid local source command',async()=>{
 const f=await fixture(),input=join(f.root,'source');expect(await f.collect(input)).toBe(0);const original=await readFile(join(input,'source-evidence.json'),'utf8');
 expect(await f.collect(input)).toBe(1);const failure=JSON.parse(f.output.pop()!);expect(failure.reasonCodes).toContain('advisory-output-exists');expect(failure.nextActions.join(' ')).not.toMatch(/advisory (?:prepare|inbox|status)/u);
 expect(await readFile(join(input,'source-evidence.json'),'utf8')).toBe(original);expect(await f.collect(join(f.root,'fresh'))).toBe(0);
 expect(await f.ask(join(f.root,'missing'),'install')).toBe(1);const missing=JSON.parse(f.output.pop()!);expect(missing.payload.affectedInput).toBe(join(f.root,'missing'));expect(missing.nextActions.join(' ')).toContain('ask-source');expect(missing.nextActions.join(' ')).not.toContain('advisory prepare');
 expect(await f.ask(input,'install')).toBe(0);
});
it('refuses unsafe whole source without persisting or printing it and rejects input symlinks',async()=>{
 const f=await fixture('env:\n  API_KEY: private-source-canary\n'+workflow),input=join(f.root,'source');
 expect(await f.collect(input)).toBe(1);expect(f.output.join(' ')).not.toContain('private-source-canary');await expect(readFile(join(input,'source-evidence.json'))).rejects.toThrow();
 const safe=await fixture(),good=join(safe.root,'safe');expect(await safe.collect(good)).toBe(0);const link=join(safe.root,'alias');await symlink(good,link);
 expect(await safe.ask(link,'install')).toBe(1);expect(await safe.ask(good,'install')).toBe(0);
});
it('never admits declaration sidecars to execution, inference or cohort entrypoints',async()=>{
 const f=await fixture(),input=join(f.root,'source');expect(await f.collect(input)).toBe(0);
 for(const args of [['inbox','--input',input],['ask','--input',input,'--question','install'],['prepare','--input',input,'--task','labels','--output',join(f.root,'prepared')],['compare','--baseline',join(input,'source-evidence.json'),'--candidate',join(input,'source-evidence.json')],['enrich','--request',input,'--permit',join(input,'source-evidence.json'),'--output',join(f.root,'enriched')]]){
  const invocation=args[0]==='prepare'||args[0]==='enrich'?args:[...args,'--format','json'];
  expect(await runCli(['advisory',...invocation],f.io,undefined,undefined,undefined,undefined,f.service)).toBe(1);
 }
 expect(f.sends()).toBe(0);
});
it('requires source-specific inputs/options and rejects execution/prepared artifacts or modified sidecars',async()=>{
 const f=await fixture(),input=join(f.root,'source');expect(await f.collect(input)).toBe(0);
 for(const args of [['ask-source','--question','install'],['ask-source','--input',input,'--question','install','--enrichment','x'],['collect-source','--repository','a/b','--run','0','--attempt','1','--workflow',request.workflow,'--output','x'],['collect-source','--repository','a/b','--run','1','--attempt','1','--workflow',request.workflow,'--job-key','x','--output','x'],['ask-source',...Array.from({length:21},()=>['--input',input]).flat(),'--question','install']])expect(await runCli(['advisory',...args],f.io)).toBe(2);
 const {evidenceFixture}=await import('./fixture.js');await writeFile(join(input,'source-evidence.json'),JSON.stringify(evidenceFixture()));
 expect(await f.ask(input,'install')).toBe(1);expect(f.sends()).toBe(0);
});
