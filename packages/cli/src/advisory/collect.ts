import { createHash } from 'node:crypto';
import { gitBlobSha, safeRelativePath } from '@cirujano/core';
import { githubGet, githubPaged, type GitHubReadOptions } from '../optimization/github-read.js';
import { evidenceFail, sealEvidence, mapWorkflowSteps, assertSafeEvidenceSource, type EvidenceBundleV1, type EvidenceSource, type EvidenceStep } from './contracts.js';
import {sealSourceDeclaration,type SourceDeclarationV2} from './source-evidence.js';
import {assertSafeDeclaredSource,SOURCE_ADMISSION_POLICY} from './source-admission.js';

export interface SourceCollectionRequest {repository:string;run:number;attempt:number;workflow:string}
export interface CollectionRequest extends SourceCollectionRequest { jobKey: string; jobId: number; sourceFiles: string[] }
export interface CollectionOptions extends GitHubReadOptions { toolSourceSha: string; now?: () => Date }
export class CollectionReadError extends Error {
  readonly reasonCode='github-read-unavailable';
  constructor(readonly stage:'repository'|'run'|'jobs'|'source'){super(`github-read-unavailable-${stage}`);this.name='CollectionReadError';}
}
async function readStage<T>(stage:CollectionReadError['stage'],read:()=>Promise<T>):Promise<T>{
  try{return await read();}catch(error){if(error instanceof Error && error.message==='github-read-failed')throw new CollectionReadError(stage);throw error;}
}
type ObjectValue = Record<string,unknown>;
function object(value: unknown): ObjectValue { if (!value || typeof value !== 'object' || Array.isArray(value)) evidenceFail('github-invalid-object'); return value as ObjectValue; }
function text(value: unknown): string { if (typeof value !== 'string' || !value || Buffer.byteLength(value)>2048) evidenceFail('github-invalid-text'); return value; }
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number)<=0) evidenceFail('github-invalid-id'); return value as number; }
function sha(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) evidenceFail('github-invalid-sha'); return value; }
function optionalText(value: unknown): string | null { return value===null || value===undefined ? null : text(value); }
function optionalTime(value: unknown): string | null { if (value===null || value===undefined) return null; const found=text(value); if (!Number.isFinite(Date.parse(found))) evidenceFail('github-invalid-timing'); return found; }
function list(value: unknown): unknown[] { if (!Array.isArray(value)) evidenceFail('github-invalid-list'); return value; }
function relative(path: string): string { safeRelativePath(path); if (path.split('/').length>32) evidenceFail('github-source-path-depth'); return path; }
function validateTree(response: ObjectValue, expectedSha: string): ObjectValue[] {
  if (response.sha!==expectedSha || response.truncated!==false) evidenceFail('github-tree-identity');
  const entries=list(response.tree).map(object); if (entries.length>10000) evidenceFail('github-tree-size'); const seen=new Set<string>();
  for (const entry of entries) { const path=text(entry.path); relative(path); if (path.includes('/') || seen.has(path)) evidenceFail('github-tree-path'); seen.add(path); sha(entry.sha); if (!['040000','100644','100755','120000','160000'].includes(String(entry.mode))) evidenceFail('github-tree-mode'); if (!['tree','blob','commit'].includes(String(entry.type))) evidenceFail('github-tree-type'); }
  const bytes=Buffer.concat([...entries].sort((a,b)=>Buffer.compare(Buffer.from(String(a.path)+(a.type==='tree'?'/':'')),Buffer.from(String(b.path)+(b.type==='tree'?'/':'')))).map(entry=>Buffer.concat([Buffer.from(`${entry.mode==='040000'?'40000':String(entry.mode)} ${String(entry.path)}\0`),Buffer.from(String(entry.sha),'hex')])));
  if (createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex')!==expectedSha) evidenceFail('github-tree-hash');
  return entries;
}
async function selectedSources(repository: string, head: string, paths: string[], options: CollectionOptions,validateSource=assertSafeEvidenceSource): Promise<EvidenceSource[]> {
  const commit=await githubGet(`repos/${repository}/git/commits/${head}`,options); if (commit.sha!==head) evidenceFail('github-source-sha');
  const root=sha(object(commit.tree).sha),cache=new Map<string,ObjectValue[]>(); const sources: EvidenceSource[]=[]; let total=0;
  for (const path of paths) {
    let treeSha=root; const parts=path.split('/'); let entry:ObjectValue|undefined;
    for (let index=0;index<parts.length;index++) {
      let entries=cache.get(treeSha); if (!entries) {entries=validateTree(await githubGet(`repos/${repository}/git/trees/${treeSha}`,options),treeSha);cache.set(treeSha,entries);}
      entry=entries.find(e=>e.path===parts[index]); if (!entry) evidenceFail('github-source-missing');
      if (index<parts.length-1) {if (entry.type!=='tree'||entry.mode!=='040000') evidenceFail('github-unsafe-source-mode');treeSha=sha(entry.sha);}
    }
    if (!entry || entry.type!=='blob' || !['100644','100755'].includes(String(entry.mode))) evidenceFail('github-unsafe-source-mode');
    const size=entry.size; if (!Number.isSafeInteger(size) || (size as number)<0 || (size as number)>256*1024) evidenceFail('github-source-size');total+=size as number; if (total>2*1024*1024) evidenceFail('github-source-size');
    const expectedSha=sha(entry.sha),blob=await githubGet(`repos/${repository}/git/blobs/${expectedSha}`,options);
    if (blob.sha!==expectedSha || blob.encoding!=='base64' || blob.size!==size || typeof blob.content!=='string') evidenceFail('github-blob-identity');
    const encoded=blob.content.replace(/\n/g,''); if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) evidenceFail('github-blob-encoding');
    const bytes=Buffer.from(encoded,'base64'); if (bytes.length!==size || bytes.toString('base64')!==encoded || gitBlobSha(bytes)!==expectedSha) evidenceFail('github-blob-hash');
    let content:string; try { content=new TextDecoder('utf8',{fatal:true}).decode(bytes); } catch { return evidenceFail('github-source-encoding'); }
    validateSource(content,path);
    sources.push({path,blobSha:expectedSha,content,lineStart:1,lineEnd:content.split('\n').length});
  }
  return sources;
}
function validateSelection(request:SourceCollectionRequest,options:CollectionOptions):void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(request.repository) || request.repository.split('/').some(v=>v==='.'||v==='..')) evidenceFail('github-invalid-repository');
  integer(request.run);integer(request.attempt);sha(options.toolSourceSha);relative(request.workflow);
  if(!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(request.workflow))evidenceFail('github-invalid-selection');
}
async function selectedRun(request:SourceCollectionRequest,options:CollectionOptions) {
  const repo=await readStage('repository',()=>githubGet(`repos/${request.repository}`,options));if (repo.full_name!==request.repository || typeof repo.private!=='boolean') evidenceFail('github-repository-identity');const repositoryId=integer(repo.id);
  const run=await readStage('run',()=>githubGet(`repos/${request.repository}/actions/runs/${request.run}/attempts/${request.attempt}`,options));
  if (run.id!==request.run || run.run_attempt!==request.attempt || run.path!==request.workflow || object(run.repository).id!==repositoryId || object(run.repository).full_name!==request.repository) evidenceFail('github-run-identity');
  const head=sha(run.head_sha),event=text(run.event),headRepo=object(run.head_repository);
  if (headRepo.id!==repositoryId || headRepo.full_name!==request.repository) evidenceFail('github-run-head-repository');
  return {repo,run,repositoryId,head,event};
}
/** Verified declarations for local browsing, independently of source-to-execution mapping. */
export async function collectSourceDeclaration(request:SourceCollectionRequest,options:CollectionOptions):Promise<SourceDeclarationV2> {
  validateSelection(request,options);const {repo,repositoryId,head,event}=await selectedRun(request,options);
  const sources=await readStage('source',()=>selectedSources(request.repository,head,[request.workflow],options,assertSafeDeclaredSource));
  return sealSourceDeclaration({schemaVersion:2,kind:'advisory-declared-source',scope:'repository-at-run-head',admissionPolicy:SOURCE_ADMISSION_POLICY,repository:{id:repositoryId,name:request.repository,visibility:repo.private?'private':'public'},run:{id:request.run,attempt:request.attempt,headSha:head,event},source:sources[0]!,fetchedAt:(options.now?.()??new Date()).toISOString(),toolSourceSha:options.toolSourceSha,apiVersion:'2022-11-28'});
}
/** Bounded metadata and selected immutable blobs only: no logs, checkout, execution or inference. */
export async function collectSelectedJob(request: CollectionRequest, options: CollectionOptions): Promise<EvidenceBundleV1> {
  validateSelection(request,options);integer(request.jobId);
  if(!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(request.jobKey)||!Array.isArray(request.sourceFiles))evidenceFail('github-invalid-selection');
  request.sourceFiles.forEach(relative);const paths=[request.workflow,...request.sourceFiles.filter(p=>p!==request.workflow)];if(paths.length>20||new Set(paths).size!==paths.length)evidenceFail('github-source-size-or-duplicate');
  const {repo,run,repositoryId,head,event}=await selectedRun(request,options);
  const jobs=await readStage('jobs',()=>githubPaged(`repos/${request.repository}/actions/runs/${request.run}/attempts/${request.attempt}/jobs`,'jobs',options)),matching=jobs.filter(j=>j.id===request.jobId);if (matching.length!==1) evidenceFail('github-job-identity');const job=matching[0]!;
  if (job.run_id!==request.run || job.run_attempt!==request.attempt || job.head_sha!==head) evidenceFail('github-job-identity');
  const name=text(job.name),labels=list(job.labels).map(text),reasonCodes:string[]=[];
  const rawSteps=job.steps===null||job.steps===undefined?[]:list(job.steps);if(!rawSteps.length)reasonCodes.push('missing-steps');if (rawSteps.length>200) evidenceFail('github-step-size');
  let previous=0;const steps=rawSteps.map(value=>{const s=object(value),number=integer(s.number);if(number<=previous)evidenceFail('github-step-order');previous=number;return {number,name:text(s.name),startedAt:optionalTime(s.started_at),completedAt:optionalTime(s.completed_at),conclusion:optionalText(s.conclusion),sourceIndex:null,command:null,lineStart:null,lineEnd:null} satisfies EvidenceStep;});
  const startedAt=optionalTime(job.started_at),completedAt=optionalTime(job.completed_at),conclusion=optionalText(job.conclusion);
  if (startedAt===null||completedAt===null) reasonCodes.push('missing-job-timing');if (conclusion===null||job.status!=='completed'||run.status!=='completed')reasonCodes.push('incomplete-execution');if (steps.some(s=>s.startedAt===null||s.completedAt===null))reasonCodes.push('missing-step-timing');
  let sources:EvidenceSource[]=[],mapped:EvidenceStep[]|null=null,blobSha:string|null=null;
  if (event==='push') {
    const candidate=await readStage('source',()=>selectedSources(request.repository,head,paths,options));const workflow=candidate[0]!;blobSha=workflow.blobSha;
    if (jobs.filter(j=>j.name===name).length===1) mapped=mapWorkflowSteps(workflow,request.jobKey,name,steps);
    if (mapped) sources=candidate;
  }
  if (!mapped)reasonCodes.push('unsupported-mapping');
  return sealEvidence({schemaVersion:1,kind:'advisory-evidence',repository:{id:repositoryId,name:request.repository,visibility:repo.private?'private':'public'},run:{id:request.run,attempt:request.attempt,headSha:head,event},workflow:{path:request.workflow,blobSha},job:{id:request.jobId,key:request.jobKey,name,labels,conclusion,startedAt,completedAt},steps:mapped??steps,sources,mapping:mapped?'supported':'unsupported-mapping',reasonCodes,fetchedAt:(options.now?.()??new Date()).toISOString(),toolSourceSha:options.toolSourceSha,apiVersion:'2022-11-28'});
}
