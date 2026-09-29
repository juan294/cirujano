import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeArtifact, jsonDigest, sha256 } from '@cirujano/core';
import { createOptimizationService } from './service.js';
import type { OptimizeArguments } from './arguments.js';
import { githubFixture, baseSha, repository } from './github-read.test-helper.js';
import { config, permitFixture, responseFixture, model } from './nebius.test-helper.js';
import { readPrivateJson } from './store.js';

const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0)) await rm(directory,{recursive:true,force:true});});
const command=(action:OptimizeArguments['action'],flags:Record<string,string|string[]>):OptimizeArguments=>({command:'optimize',action,flags,format:'json'});
async function setup(decision:'proposal'|'abstain'='proposal',alreadyCached=false) {
  const directory=await mkdtemp(join(tmpdir(),'cirujano-propose-'));directories.push(directory);
  const original=githubFixture();const fixture=alreadyCached?githubFixture(original.source.replace('node-version: 22.20.0','node-version: 22.20.0\n          cache: pnpm')):original;let posts=0;
  const service=createOptimizationService({pageRunner:fixture.pageRunner,toolSourceSha:'1'.repeat(40),bundleDigest:'2'.repeat(64),apiKey:'synthetic-provider-key',permitLedger:join(directory,'permits'),fetch:async(_url,init)=>{
    if(init?.method==='GET') return new Response(JSON.stringify({data:[{id:model}]}));
    posts++;const response=responseFixture();response.choices[0]!.message.content=JSON.stringify({status:decision,reason:'Expensive measured install',uncertainty:'Performance remains unmeasured',evidenceIds:['install-timing'],operation:decision==='proposal'?{type:'enable-pnpm-cache',jobId:'test',stepIndex:2}:null});return new Response(JSON.stringify(response));
  }});
  const output:string[]=[];const io={stdout:(value:string)=>output.push(value),stderr:(value:string)=>output.push(value)};
  const collected=join(directory,'collected'),diagnosed=join(directory,'diagnosed'),proposed=join(directory,'proposed');
  expect(await service.run(command('collect',{repository,ref:baseSha,workflow:'.github/workflows/ci.yml',job:'test',run:['99'],output:collected}),io)).toBe(0);
  const input=decodeArtifact('input',await readPrivateJson(join(collected,'input.json')));
  const configPath=join(directory,'config.json'),permitPath=join(directory,'permit.json');await writeFile(configPath,JSON.stringify(config));await writeFile(permitPath,JSON.stringify(permitFixture(input)));
  expect(await service.run(command('diagnose',{input:join(collected,'input.json'),config:configPath,permit:permitPath,output:diagnosed}),io)).toBe(0);
  const propose=()=>service.run(command('propose',{input:join(collected,'input.json'),diagnosis:join(diagnosed,'diagnosis.json'),output:proposed}),io);
  return {directory,fixture,service,io,output,collected,diagnosed,proposed,propose,posts:()=>posts};
}
describe('model-bound local proposal lifecycle',()=>{
  it('keeps already-cached source as no-change without any model receipt or call',async()=>{
    const result=await setup('proposal',true);expect(await result.propose()).toBe(0);expect(result.posts()).toBe(0);await expect(readFile(join(result.proposed,'workflow.patch'),'utf8')).rejects.toThrow();expect(await result.service.run(command('status',{operation:result.proposed}),result.io)).toBe(0);
  });
  it('generates the exact allowed patch without modifying source or calling the model again',async()=>{
    const result=await setup();const before=await readFile(join(result.collected,'source.json'),'utf8');
    expect(await result.propose()).toBe(0);
    const proposal=decodeArtifact('proposal',await readPrivateJson(join(result.proposed,'proposal.json')));
    const patch=await readFile(join(result.proposed,'workflow.patch'),'utf8'),candidate=await readFile(join(result.proposed,'candidate.yml'),'utf8');
    expect(proposal.status).toBe('proposed');expect(proposal.candidateSha).toBeNull();expect(proposal.patchHash).toBe(sha256(patch));expect(proposal.candidateWorkflowHash).toBe(sha256(candidate));expect(proposal.beforeStructuralDigest).toBe(proposal.afterStructuralDigest);
    expect(patch.split('\n').filter(line=>line.startsWith('+')&&!line.startsWith('+++'))).toHaveLength(2);
    expect(await readFile(join(result.collected,'source.json'),'utf8')).toBe(before);expect(result.posts()).toBe(1);
    expect(await result.service.run(command('status',{operation:result.proposed}),result.io)).toBe(0);
  });
  it.each(['request','receipt','diagnosis','valid-diagnosis-content','source'])('rejects %s drift and leaves no candidate patch',async failure=>{
    const result=await setup();
    if(failure==='source'){const input=decodeArtifact('input',await readPrivateJson(join(result.collected,'input.json')));input.baselines[0]!.installElapsedMs=1;await writeFile(join(result.collected,'input.json'),JSON.stringify(input));}
    else if(failure==='diagnosis'||failure==='valid-diagnosis-content'){const diagnosis=decodeArtifact('diagnosis',await readPrivateJson(join(result.diagnosed,'diagnosis.json')));if(failure==='diagnosis')diagnosis.evidenceIds=['unknown'];else diagnosis.reason='Schema-valid rewritten model decision';await writeFile(join(result.diagnosed,'diagnosis.json'),JSON.stringify(diagnosis));}
    else {const inference=decodeArtifact('inference',await readPrivateJson(join(result.diagnosed,'inference.json'))),diagnosis=decodeArtifact('diagnosis',await readPrivateJson(join(result.diagnosed,'diagnosis.json')));if(failure==='request')inference.requestHash='9'.repeat(64);else inference.completionId='other-completion';diagnosis.inferenceReceiptDigest=jsonDigest(inference);await writeFile(join(result.diagnosed,'inference.json'),JSON.stringify(inference));await writeFile(join(result.diagnosed,'diagnosis.json'),JSON.stringify(diagnosis));}
    expect(await result.propose()).toBe(1);await expect(readFile(join(result.proposed,'workflow.patch'),'utf8')).rejects.toThrow();expect(result.posts()).toBe(1);
  });
  it('preserves a valid model abstention without a patch',async()=>{
    const result=await setup('abstain');expect(await result.propose()).toBe(0);expect(result.output.join('')).toContain('model-abstained');await expect(readFile(join(result.proposed,'workflow.patch'),'utf8')).rejects.toThrow();expect(result.posts()).toBe(1);
    expect(await result.service.run(command('status',{operation:result.proposed}),result.io)).toBe(0);
  });
  it('refuses overwrite and rejects candidate-file drift in status',async()=>{
    const result=await setup();expect(await result.propose()).toBe(0);const patch=await readFile(join(result.proposed,'workflow.patch'),'utf8');expect(await result.propose()).toBe(1);expect(await readFile(join(result.proposed,'workflow.patch'),'utf8')).toBe(patch);
    await writeFile(join(result.proposed,'candidate.yml'),'# forged candidate\n');expect(await result.service.run(command('status',{operation:result.proposed}),result.io)).toBe(1);
  });
  it('rejects malformed copied inference journals on later reread',async()=>{
    const result=await setup();expect(await result.propose()).toBe(0);const intent=await readPrivateJson(join(result.proposed,'diagnosis-intent.json')) as Record<string,unknown>;intent.extraCommand='run something';await writeFile(join(result.proposed,'diagnosis-intent.json'),JSON.stringify(intent));expect(await result.service.run(command('status',{operation:result.proposed}),result.io)).toBe(1);
  });
  it('reports an interrupted local proposal without claiming another unknown inference',async()=>{
    const result=await setup();expect(await result.propose()).toBe(0);await rm(join(result.proposed,'operation.json'));await rm(join(result.proposed,'proposal.json'));
    expect(await result.service.run(command('status',{operation:result.proposed}),result.io)).toBe(1);
    const last=JSON.parse(result.output.at(-1)!);expect(last.status).toBe('failed');expect(last.reasonCode).toBe('interrupted-local-proposal');expect(result.posts()).toBe(1);
  });
});
