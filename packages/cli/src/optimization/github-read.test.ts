import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { decodeActionReceipt, decodeArtifact, decodeSourceManifest, gitBlobSha, jsonDigest, sha256 } from '@cirujano/core';
import { collectGitHubInput, githubReadJson, readGitHubSource } from './github-read.js';
import { baseSha, githubFixture, repository } from './github-read.test-helper.js';
const request={repository,ref:baseSha,workflow:'.github/workflows/ci.yml',job:'test',runs:[99]};
const identity={toolSourceSha:'1'.repeat(40),bundleDigest:'2'.repeat(64)};
describe('bounded GitHub comparison routes',()=>{
 it('accepts only an immutable SHA comparison at the fixed read-only origin',async()=>{
  const endpoint=`repos/${repository}/compare/${baseSha}...${'c'.repeat(40)}`,calls:string[][]=[];
  const result=await githubReadJson(endpoint,{pageRunner:async(_command,args)=>{calls.push(args);return{stdout:JSON.stringify({status:'ahead'})};}});
  expect(result).toEqual({status:'ahead'});expect(calls).toHaveLength(1);expect(calls[0]).toContain(endpoint);
  expect(calls[0]?.slice(0,5)).toEqual(['api','--method','GET','--hostname','github.com']);
 });
 it.each([
  `repos/${repository}/compare/develop...main`,
  `repos/${repository}/compare/${baseSha.slice(1)}...${'c'.repeat(40)}`,
  `repos/${repository}/compare/${baseSha}..${'c'.repeat(40)}`,
  `repos/${repository}/compare/${baseSha}....${'c'.repeat(40)}`,
  `repos/${repository}/compare/${baseSha}...${'c'.repeat(40)}?page=1`,
  `repos/${repository}/compare/${baseSha}...${'c'.repeat(40)}/../pulls`,
  `repos/../proof/compare/${baseSha}...${'c'.repeat(40)}`,
  `repos/./proof/compare/${baseSha}...${'c'.repeat(40)}`,
  `repos/${repository}/git/../pulls`,
 ])('rejects malformed or traversal endpoint %s before transport',async endpoint=>{
  const calls:string[][]=[];await expect(githubReadJson(endpoint,{pageRunner:async(_command,args)=>{calls.push(args);return{stdout:'{}'};}})).rejects.toThrow('github-unsafe-endpoint');expect(calls).toEqual([]);
 });
});
describe('immutable read-only GitHub collection',()=>{
 it('retains a real source blob above 1 MiB within the documented file and response limits',async()=>{
  const bytes=Buffer.alloc(2*1024*1024,0x61),blobSha=gitBlobSha(bytes);
  const rawTree=Buffer.concat([Buffer.from('100644 fixture.bin\0'),Buffer.from(blobSha,'hex')]);
  const treeSha=createHash('sha1').update(`tree ${rawTree.length}\0`).update(rawTree).digest('hex');
  const responses:Record<string,unknown>={
   [`repos/${repository}`]:{id:123,full_name:repository,fork:false},
   [`repos/${repository}/git/commits/${baseSha}`]:{sha:baseSha,tree:{sha:treeSha}},
   [`repos/${repository}/git/trees/${treeSha}?recursive=1`]:{sha:treeSha,truncated:false,tree:[{path:'fixture.bin',type:'blob',mode:'100644',sha:blobSha,size:bytes.length}]},
   [`repos/${repository}/git/blobs/${blobSha}`]:{sha:blobSha,encoding:'base64',size:bytes.length,content:bytes.toString('base64')},
  };
  const retained=await readGitHubSource(repository,baseSha,{pageRunner:async(_command,args)=>{
   const endpoint=args.find(value=>value.startsWith('repos/'))!;return {stdout:JSON.stringify(responses[endpoint])};
  }});
  expect(retained.files).toHaveLength(1);expect(retained.files[0]!.hash).toBe(sha256(bytes));
  expect(Buffer.compare(Buffer.from(retained.files[0]!.bytesBase64,'base64'),bytes)).toBe(0);
 });
 it('collects exact attempts, full source, all checks and selected installation timing',async()=>{
  const fixture=githubFixture(); const result=await collectGitHubInput(request,{...identity,pageRunner:fixture.pageRunner});
  expect(result.reasonCode).toBe('collected'); expect(decodeArtifact('input',result.input).operations).toEqual([{type:'enable-pnpm-cache',jobId:'test',stepIndex:2}]);
  expect(result.input.baselines[0]).toMatchObject({attempt:2,installStepNumber:5,installElapsedMs:60000,elapsedMs:120000});
  expect(result.input.requiredChecks).toEqual(['audit','test']); expect(decodeSourceManifest(result.source).files).toHaveLength(4);
  expect(decodeActionReceipt(result.receipt)).toMatchObject({repository:'actions/setup-node',commitSha:'820762786026740c76f36085b0efc47a31fe5020',releaseTag:'v7.0.0',immutable:true,actionHash:'5d765941ab5d8bef27f08e81b0b041cdb2df2050ea0261dc925d157a2bafbd2b'});
  expect(result.input.structuralFacts.actionReceiptDigest).toBe(jsonDigest(result.receipt));
  expect(result.input.structuralFacts.treeSha).toBe(fixture.treeSha);
  expect(fixture.calls.every(call=>call.command==='gh'&&call.args.includes('GET')&&!call.args.includes('--paginate'))).toBe(true);
  expect(fixture.calls.some(call=>call.args.some(arg=>arg.includes('/logs')))).toBe(false);
 });
 it('returns no-change for an existing cache',async()=>{
  const fixture=githubFixture(githubFixture().source.replace('node-version: 22.20.0','node-version: 22.20.0\n          cache: pnpm'));
  expect((await collectGitHubInput(request,{...identity,pageRunner:fixture.pageRunner})).reasonCode).toBe('already-cached');
 });
 it.each(['fork','sha','tree','omitted-file','symlink','blob','attempt','job-name','step-sequence','check','profile','pull-request','mutable-release'])('rejects %s provenance and incomplete inventory',async kind=>{
  const fixture=githubFixture();
  const run=fixture.responses[`repos/${repository}/actions/runs/99`] as Record<string,unknown>;
  const tree=fixture.responses[`repos/${repository}/git/trees/${fixture.treeSha}?recursive=1`] as {truncated:boolean;tree:{mode:string;sha:string}[]};
  const jobs=fixture.responses[`repos/${repository}/actions/runs/99/attempts/2/jobs?per_page=100&page=1`] as {jobs:{name:string;run_attempt:number;steps:{name:string}[]}[]};
  if(kind==='fork') run.head_repository={id:456,full_name:'fork-owner/benchmark',fork:true};
  if(kind==='sha') run.head_sha='c'.repeat(40);
  if(kind==='tree') tree.truncated=true;
  if(kind==='omitted-file') tree.tree.splice(3,1);
  if(kind==='symlink') tree.tree[0]!.mode='120000';
  if(kind==='blob') tree.tree[0]!.sha='d'.repeat(40);
  if(kind==='attempt') jobs.jobs[0]!.run_attempt=1;
  if(kind==='job-name') jobs.jobs[0]!.name='wrong';
  if(kind==='step-sequence') jobs.jobs[0]!.steps[4]!.name='Run pnpm install';
  if(kind==='check') fixture.responses[`repos/${repository}/commits/${baseSha}/check-runs?filter=latest&per_page=100&page=1`]={total_count:3,check_runs:[]};
  if(kind==='profile') tree.tree.splice(2,1);
  if(kind==='pull-request') run.event='pull_request';
  if(kind==='mutable-release') fixture.responses['repos/actions/setup-node/releases/tags/v7.0.0']={id:353541365,tag_name:'v7.0.0',immutable:false};
  await expect(collectGitHubInput(request,{...identity,pageRunner:fixture.pageRunner})).rejects.toThrow();
 });
 it('selects explicit gh configuration and returns deterministic unsupported permission reasons',async()=>{
  const fixture=githubFixture(githubFixture().source.replace('contents: read','contents: write'));
  const result=await collectGitHubInput(request,{...identity,pageRunner:fixture.pageRunner,ghPath:'/trusted/gh'});
  expect(result.input.status).toBe('unsupported');expect(result.reasonCode).toBe('permissions-not-read-only');expect(result.input.operations).toEqual([]);
  expect(fixture.calls.every(call=>call.command==='/trusted/gh')).toBe(true);
 });
 it('validates exact SHA/paths before any API call',async()=>{
  const fixture=githubFixture();await expect(collectGitHubInput({...request,ref:'develop'},{...identity,pageRunner:fixture.pageRunner})).rejects.toThrow();
  expect(fixture.calls).toHaveLength(0);
 });
});
