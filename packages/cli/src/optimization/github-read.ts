import { canonicalJson, decodeActionReceipt, decodeArtifact, decodeSourceManifest, decodeVerificationProfile, gitBlobSha, inspectWorkflow, jsonDigest, OptimizationInputError, parseStrictJson, parseWorkflowSource, safeRelativePath, sha256 } from '@cirujano/core';
import type { ActionReceipt, BaselineJob, InputArtifact, SourceManifest } from '@cirujano/core';
import { defaultGitHubPageRunner, record, positiveInteger, text, timestamp, array } from '../github-api.js';
import type { GitHubPageRunner } from '../github-api.js';
import { createHash } from 'node:crypto';

export interface GitHubReadOptions { pageRunner?: GitHubPageRunner; ghPath?: string }
export interface CollectionOptions extends GitHubReadOptions { toolSourceSha: string; bundleDigest: string }
export interface CollectionRequest { repository: string; ref: string; workflow: string; job: string; runs: number[] }
const actionCommit='820762786026740c76f36085b0efc47a31fe5020';
const profilePath='.cirujano/optimization-profile.json';
const shaPattern=/^[a-f0-9]{40}$/;
function refuse(reason:string):never { throw new OptimizationInputError(reason); }
function exactSha(value:unknown):string { if(typeof value!=='string'||!shaPattern.test(value)) refuse('github-invalid-sha');return value; }
function validateRepository(repository:string):void { if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)||repository.split('/').some(part=>part==='.'||part==='..')) refuse('github-invalid-repository'); }
function validateTree(tree:Record<string,unknown>[],rootSha:string):void {
 const directories=new Map<string,string>([['',rootSha]]),children=new Map<string,Record<string,unknown>[]>();
 for(const entry of tree) {
  const path=safeRelativePath(text(entry.path,'tree.path'));const slash=path.lastIndexOf('/'),parent=slash<0?'':path.slice(0,slash);
  children.set(parent,[...(children.get(parent)??[]),entry]);
  if(entry.type==='tree'&&entry.mode==='040000') directories.set(path,exactSha(entry.sha));
 }
 for(const [directory,entries] of children) {
  const expected=directories.get(directory);if(!expected) refuse('github-tree-missing-directory');
  const content=Buffer.concat(entries.sort((left,right)=>{
   const key=(entry:Record<string,unknown>)=>Buffer.from(String(entry.path).split('/').at(-1)!+(entry.type==='tree'?'/':''));
   return Buffer.compare(key(left),key(right));
  }).map(entry=>Buffer.concat([Buffer.from(`${entry.mode==='040000'?'40000':String(entry.mode)} ${String(entry.path).split('/').at(-1)!}\0`),Buffer.from(exactSha(entry.sha),'hex')])));
  const actual=createHash('sha1').update(`tree ${content.length}\0`).update(content).digest('hex');if(actual!==expected) refuse('github-tree-hash');
 }
 for(const [directory,digest] of directories) if(!children.has(directory)&&digest!==createHash('sha1').update('tree 0\0').digest('hex')) refuse('github-tree-incomplete');
}

/** Fixed GitHub origin, explicit GET, one bounded response, no retries or raw logs. */
export async function githubGet(endpoint:string, options:GitHubReadOptions={}):Promise<Record<string,unknown>> {
 if(!/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\//.test(`${endpoint}/`)||endpoint.includes('..')||endpoint.includes('/logs')||/[\s#\\]/.test(endpoint)) refuse('github-unsafe-endpoint');
 const runner=options.pageRunner??defaultGitHubPageRunner;
 let stdout:string;
 try { ({stdout}=await runner(options.ghPath??process.env['CIRUJANO_GH_PATH']??'gh',['api','--method','GET','--hostname','github.com',endpoint,'-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2022-11-28'],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:60_000})); }
 catch { return refuse('github-read-failed'); }
 if(Buffer.byteLength(stdout)>8*1024*1024) refuse('github-response-too-large');
 return record(parseStrictJson(stdout,8*1024*1024),'GitHub response');
}
async function paged(endpoint:string,key:string,options:GitHubReadOptions):Promise<Record<string,unknown>[]> {
 const result:Record<string,unknown>[]=[];let total:number|undefined;
 for(let page=1;page<=50;page++) {
  const response=await githubGet(`${endpoint}${endpoint.includes('?')?'&':'?'}per_page=100&page=${page}`,options);
  if(typeof response.total_count!=='number'||!Number.isSafeInteger(response.total_count)||response.total_count<0||response.total_count>5000) refuse('github-page-count');
  if(total!==undefined&&total!==response.total_count) refuse('github-page-drift'); total=response.total_count;
  const entries=array(response[key],key).map(value=>record(value,key));if(entries.length>100) refuse('github-page-size'); result.push(...entries);
  if(result.length===total) return result;
  if(result.length>total||entries.length<100) refuse('github-incomplete-pages');
 }
 return refuse('github-page-limit');
}
function blobBytes(blob:Record<string,unknown>,expectedSha:string,expectedSize?:number):Buffer {
 if(blob.sha!==expectedSha||blob.encoding!=='base64'||typeof blob.content!=='string'||typeof blob.size!=='number'||blob.size<0||blob.size>4*1024*1024) refuse('github-blob-identity');
 const encoded=blob.content.replace(/\n/g,'');if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) refuse('github-blob-encoding');
 const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded||bytes.length!==blob.size||(expectedSize!==undefined&&bytes.length!==expectedSize)||gitBlobSha(bytes)!==expectedSha) refuse('github-blob-hash');return bytes;
}
/** Retains every regular file of the exact immutable Git tree; never checks out source. */
export async function readGitHubSource(repository:string,commitSha:string,options:GitHubReadOptions={}):Promise<{repositoryId:number;files:SourceManifest['files'];treeSha:string}> {
 validateRepository(repository);exactSha(commitSha);
 const repo=await githubGet(`repos/${repository}`,options);
 if(repo.full_name!==repository||repo.fork!==false) refuse('github-repository-identity');const repositoryId=positiveInteger(repo.id,'repository.id');
 const commit=await githubGet(`repos/${repository}/git/commits/${commitSha}`,options);if(commit.sha!==commitSha) refuse('github-source-sha');
 const treeSha=exactSha(record(commit.tree,'commit.tree').sha);
 const response=await githubGet(`repos/${repository}/git/trees/${treeSha}?recursive=1`,options);if(response.sha!==treeSha||response.truncated!==false) refuse('github-tree-truncated-or-drift');
 const tree=array(response.tree,'tree').map(value=>record(value,'tree entry'));if(tree.length>10000) refuse('github-tree-limit');
 validateTree(tree,treeSha);
 const files:SourceManifest['files']=[];const seen=new Set<string>();let totalBytes=0;
 for(const entry of tree) {
  const path=safeRelativePath(text(entry.path,'tree.path'));if(seen.has(path)) refuse('github-tree-duplicate');seen.add(path);
  exactSha(entry.sha);
  if(entry.type==='tree'&&entry.mode==='040000') continue;
  if(entry.type!=='blob'||(entry.mode!=='100644'&&entry.mode!=='100755')) refuse('github-unsafe-file-mode');
  if(typeof entry.size!=='number'||!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>4*1024*1024) refuse('github-file-size');totalBytes+=entry.size;
  if(totalBytes>16*1024*1024||files.length>=5000) refuse('github-source-size');
  const bytes=blobBytes(await githubGet(`repos/${repository}/git/blobs/${entry.sha}`,options),entry.sha as string,entry.size);
  files.push({path,mode:entry.mode,hash:sha256(bytes),bytesBase64:bytes.toString('base64')});
 }
 const regularPaths=new Set(files.map(file=>file.path));
 if(files.some(file=>file.path.split('/').slice(0,-1).some((_,index)=>regularPaths.has(file.path.split('/').slice(0,index+1).join('/'))))) refuse('github-file-path-collision');
 files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return {repositoryId,files,treeSha};
}
async function officialReceipt(options:GitHubReadOptions):Promise<ActionReceipt> {
 const release=await githubGet('repos/actions/setup-node/releases/tags/v7.0.0',options);
 const action=await githubGet(`repos/actions/setup-node/contents/action.yml?ref=${actionCommit}`,options);
 const bytes=blobBytes(action,exactSha(action.sha)); const parsed=parseWorkflowSource(bytes.toString('utf8'));
 return decodeActionReceipt({repository:'actions/setup-node',commitSha:actionCommit,releaseTag:release.tag_name,releaseId:release.id,immutable:release.immutable,actionHash:sha256(bytes),inputs:Object.keys(record(parsed.inputs,'action.inputs')),outputs:Object.keys(record(parsed.outputs,'action.outputs')),retrievedAt:new Date().toISOString()});
}
function assertRun(run:Record<string,unknown>,request:CollectionRequest,repositoryId:number,runId:number,attempt?:number):number {
 const repo=record(run.repository,'run.repository'),head=record(run.head_repository,'run.head_repository');
 if(run.id!==runId||run.head_sha!==request.ref||run.path!==request.workflow||run.status!=='completed'||run.conclusion!=='success'||!['push','workflow_dispatch','schedule'].includes(String(run.event))||repo.id!==repositoryId||repo.full_name!==request.repository||head.id!==repositoryId||head.full_name!==request.repository||head.fork!==false) refuse('github-run-identity');
 const found=positiveInteger(run.run_attempt,'run.attempt');if(attempt!==undefined&&found!==attempt) refuse('github-attempt-drift');return found;
}
function stepName(step:Record<string,unknown>):string {
 if(typeof step.name==='string'&&step.name&&!step.name.includes('${{')) return step.name;
 if(typeof step.uses==='string') return `Run ${step.uses}`;
 if(typeof step.run==='string') return `Run ${step.run.split('\n')[0]}`;
 return refuse('github-unresolved-step-name');
}
function validateSteps(job:Record<string,unknown>,steps:Record<string,unknown>[],installIndex:number):{number:number;elapsedMs:number} {
 const executed=array(job.steps,'job.steps').map(value=>record(value,'job.step'));if(executed.length>steps.length+20) refuse('github-step-inventory');
 let offset=0;if(executed[0]?.name==='Set up job') offset=1;
 for(let index=0;index<steps.length;index++) {
  const observed=executed[offset+index];if(!observed||observed.name!==stepName(steps[index]!)||observed.number!==offset+index+1||observed.status!=='completed'||!['success','skipped'].includes(String(observed.conclusion))) refuse('github-step-sequence');
 }
 for(const step of executed.slice(offset+steps.length)) if(typeof step.name!=='string'||(!step.name.startsWith('Post ')&&step.name!=='Complete job')||step.status!=='completed'||step.conclusion!=='success') refuse('github-step-inventory');
 const install=executed[offset+installIndex];if(!install||install.conclusion!=='success') refuse('github-install-not-successful');
 const started=timestamp(install.started_at,'install.started_at'),completed=timestamp(install.completed_at,'install.completed_at');const elapsedMs=Date.parse(completed)-Date.parse(started);if(elapsedMs<0) refuse('github-install-timing');
 return {number:positiveInteger(install.number,'install.number'),elapsedMs};
}
export async function collectGitHubInput(request:CollectionRequest,options:CollectionOptions):Promise<{input:InputArtifact;source:SourceManifest;receipt:ActionReceipt;reasonCode:string}> {
 validateRepository(request.repository);exactSha(request.ref);safeRelativePath(request.workflow);
 if(!shaPattern.test(options.toolSourceSha)||!/^[a-f0-9]{64}$/.test(options.bundleDigest)) refuse('github-invalid-tool-identity');
 if(!request.workflow.startsWith('.github/workflows/')||!request.job||!Array.isArray(request.runs)||!request.runs.length||request.runs.length>10||new Set(request.runs).size!==request.runs.length) refuse('github-invalid-collection-request');request.runs.forEach(run=>positiveInteger(run,'run'));
 const retained=await readGitHubSource(request.repository,request.ref,options);
 const workflow=retained.files.find(file=>file.path===request.workflow),lock=retained.files.find(file=>file.path==='pnpm-lock.yaml'),profile=retained.files.find(file=>file.path===profilePath);
 if(!workflow) refuse('github-missing-workflow');if(!lock) refuse('github-missing-root-lockfile');if(!profile) refuse('github-missing-verification-profile');
 const sourceText=Buffer.from(workflow.bytesBase64,'base64').toString('utf8');
 const verifiedProfile=decodeVerificationProfile(parseStrictJson(Buffer.from(profile.bytesBase64,'base64').toString('utf8')));
 const parsed=parseWorkflowSource(sourceText),job=record(record(parsed.jobs,'workflow.jobs')[request.job],'selected job');
 const steps=array(job.steps,'selected steps').map(value=>record(value,'selected step'));
 const selected=steps.map((step,index)=>({step,index})).filter(({step})=>typeof step.uses==='string'&&step.uses.startsWith('actions/setup-node@'));if(selected.length!==1) refuse('github-ambiguous-setup-node');
 const stepIndex=selected[0]!.index, installIndex=steps.findIndex(step=>step.run==='pnpm install --frozen-lockfile');if(installIndex<0) refuse('github-missing-frozen-install');
 const jobName=job.name??request.job;if(typeof jobName!=='string'||jobName.includes('${{')) refuse('github-unresolved-job-name');
 const provenance={repositoryId:retained.repositoryId,repository:request.repository,baseSha:request.ref,workflowBlobSha:gitBlobSha(Buffer.from(workflow.bytesBase64,'base64')),workflowPath:request.workflow,workflowHash:workflow.hash,jobId:request.job,stepIndex,lockfileHash:lock.hash,sourceTreeDigest:jsonDigest(retained.files.filter(file=>file.path!==request.workflow).map(({path,mode,hash})=>({path,mode,hash}))),verificationProfileHash:profile.hash,toolSourceSha:options.toolSourceSha,bundleDigest:options.bundleDigest};
 const source=decodeSourceManifest({schemaVersion:1,provenance,profilePath,files:retained.files});
 const receipt=await officialReceipt(options);const baselines:BaselineJob[]=[];const inventories:Record<string,string>={};const required=new Set<string>();let jobInventory:string|undefined;
 for(const runId of request.runs) {
  const latest=await githubGet(`repos/${request.repository}/actions/runs/${runId}`,options);const attempt=assertRun(latest,request,retained.repositoryId,runId);
  assertRun(await githubGet(`repos/${request.repository}/actions/runs/${runId}/attempts/${attempt}`,options),request,retained.repositoryId,runId,attempt);
  const jobs=await paged(`repos/${request.repository}/actions/runs/${runId}/attempts/${attempt}/jobs`,'jobs',options);const names=new Set<string>();
  for(const item of jobs) { const name=text(item.name,'job.name');if(names.has(name)||item.run_id!==runId||item.run_attempt!==attempt||item.head_sha!==request.ref||item.status!=='completed'||item.conclusion!=='success') refuse('github-job-inventory');names.add(name);required.add(name); }
  const observedInventory=canonicalJson([...names].sort());if(jobInventory!==undefined&&jobInventory!==observedInventory) refuse('github-job-inventory-drift');jobInventory=observedInventory;
  const targets=jobs.filter(item=>item.name===jobName);if(targets.length!==1) refuse('github-selected-job-identity');const target=targets[0]!;
  const timing=validateSteps(target,steps,installIndex);const startedAt=timestamp(target.started_at,'job.started_at'),completedAt=timestamp(target.completed_at,'job.completed_at');const elapsedMs=Date.parse(completedAt)-Date.parse(startedAt);if(elapsedMs<0||timing.elapsedMs>elapsedMs) refuse('github-job-timing');
  inventories[`run-${runId}-jobs`]=canonicalJson(jobs.map(item=>({id:positiveInteger(item.id,'job.id'),name:item.name,conclusion:item.conclusion})));
  baselines.push({runId,attempt,jobId:positiveInteger(target.id,'job.id'),headSha:request.ref,conclusion:'success',startedAt,completedAt,elapsedMs,installStepNumber:timing.number,installElapsedMs:timing.elapsedMs,runnerLabels:array(target.labels,'job.labels').map(label=>text(label,'runner label')),runnerImage:null,requiredChecks:[...names].sort()});
 }
 const checks=await paged(`repos/${request.repository}/commits/${request.ref}/check-runs?filter=latest`,'check_runs',options);
 for(const check of checks) { if(check.head_sha!==request.ref||check.status!=='completed'||check.conclusion!=='success') refuse('github-required-check-incomplete');required.add(text(check.name,'check.name')); }
 if(!checks.length) refuse('github-missing-check-inventory');
 const requiredChecks=[...required].sort();inventories['required-checks']=canonicalJson(checks.map(check=>({name:check.name,conclusion:check.conclusion,headSha:check.head_sha})));
 const eligibility=inspectWorkflow(sourceText,{provenance,receipt,rootLockfile:true,timedBaseline:baselines.length>0,requiredChecks,verificationProfilePresent:true});
 if(eligibility.status==='eligible'&&(verifiedProfile.nodeVersion!==eligibility.structuralFacts.nodeVersion||verifiedProfile.pnpmVersion!==eligibility.structuralFacts.pnpmVersion)) refuse('github-profile-runtime-drift');
 const input=decodeArtifact('input',{schemaVersion:1,kind:'input',provenance,status:eligibility.status==='eligible'?'collected':eligibility.status,baselines,structuralFacts:{...eligibility.structuralFacts,reasonCode:eligibility.reason,treeSha:retained.treeSha,actionReceiptDigest:jsonDigest(receipt)},evidence:{...inventories,'setup-node-receipt':canonicalJson(receipt),'workflow-eligibility':eligibility.reason,'install-timing':canonicalJson(baselines.map(sample=>({runId:sample.runId,attempt:sample.attempt,installElapsedMs:sample.installElapsedMs})))},operations:eligibility.operations,requiredChecks});
 return {input,source,receipt,reasonCode:eligibility.status==='eligible'?'collected':eligibility.reason};
}
