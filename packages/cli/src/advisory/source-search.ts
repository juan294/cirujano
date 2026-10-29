import {jsonDigest} from '@cirujano/core';
import {report,type AdvisoryReport} from './rules.js';
import {actionScopeQuery} from './search-candidates.js';
import {sourceQueryPolicy,SOURCE_SEARCH_POLICY} from './source-relevance.js';
import {decodeSourceDeclaration,type SourceDeclaration} from './source-evidence.js';

export interface SourceHit {
 inputDigest:string;repository:SourceDeclaration['repository'];run:SourceDeclaration['run'];
 path:string;blobSha:string;lineStart:number;lineEnd:number;text:string;score:number;
}
export interface SourceSearchPayload {kind:'source-search';scope:'repository-at-run-head';method:'lexical';searchPolicyVersion:typeof SOURCE_SEARCH_POLICY;admissionPolicies:string[];query:string;inputDigests:string[];documentCount:number;candidateCount:number;hits:SourceHit[]}
export function sourceReport<T>(status:AdvisoryReport['status'],payload:T,reasons:string[]=[]):AdvisoryReport<T> {
 const value=report(status,payload,reasons);
 value.limitations.unshift('Repository source at the recorded run head does not establish execution, cache state, command implementation, timing attribution or causality. Source navigation is local-only.');
 value.nextActions=['Use advisory ask-source for retained declarations; collect-source into a fresh directory for another workflow. Credentials and unapproved environment configuration remain refused.'];
 if(reasons.includes('source-runtime-evidence-unavailable')||reasons.includes('source-implementation-evidence-unavailable'))value.nextActions=['Ask where a command or configuration is declared. These workflow documents do not supply provider logs, runtime traces or external helper/package bodies.'];
 return value;
}
export function searchSourceDeclarations(inputs:SourceDeclaration[],query:string):AdvisoryReport<SourceSearchPayload> {
 const policy=sourceQueryPolicy(query);if(inputs.length>20)throw new Error('advisory-input-limit');
 const documents=new Map<string,SourceDeclaration>(),snapshots=new Map<string,string>();let bytes=0;
 for(const input of inputs){
  const source=decodeSourceDeclaration(input);bytes+=Buffer.byteLength(source.source.content);if(bytes>2*1024*1024)throw new Error('advisory-source-size-limit');
  const snapshotKey=jsonDigest({repositoryId:source.repository.id,runId:source.run.id,attempt:source.run.attempt,path:source.source.path}),snapshot=jsonDigest({repository:source.repository,run:source.run});
  if(snapshots.has(snapshotKey)&&snapshots.get(snapshotKey)!==snapshot)throw new Error('advisory-source-conflicting-evidence');snapshots.set(snapshotKey,snapshot);
  const key=jsonDigest({repositoryId:source.repository.id,headSha:source.run.headSha,path:source.source.path}),prior=documents.get(key);
  if(prior&&(jsonDigest(prior.source)!==jsonDigest(source.source)||jsonDigest(prior.repository)!==jsonDigest(source.repository)))throw new Error('advisory-source-conflicting-evidence');
  if(!prior)documents.set(key,source);
 }
 const payload:SourceSearchPayload={kind:'source-search',scope:'repository-at-run-head',method:'lexical',searchPolicyVersion:SOURCE_SEARCH_POLICY,admissionPolicies:[...new Set(inputs.map(s=>s.schemaVersion===2?s.admissionPolicy:'strict-source-v1'))].sort(),query,inputDigests:[...new Set(inputs.map(s=>s.digest))].sort(),documentCount:documents.size,candidateCount:0,hits:[]};
 if(actionScopeQuery(query))return sourceReport('no-match',payload,['search-advisory-only-scope']);
 if(policy.reasonCode)return sourceReport('no-match',payload,[policy.reasonCode]);
 const candidates:{document:SourceDeclaration;lines:string[];index:number;score:number;order:number}[]=[];
 let order=0;
 for(const document of [...documents.values()].sort((a,b)=>a.repository.name.localeCompare(b.repository.name)||a.run.headSha.localeCompare(b.run.headSha)||a.source.path.localeCompare(b.source.path))){
  const lines=document.source.content.split('\n');
  for(let index=0;index<lines.length;index++){
   const relevance=policy.score(lines[index]!);if(relevance>0)candidates.push({document,lines,index,score:relevance,order:order++});
  }
 }
 const shortlist=candidates.sort((a,b)=>b.score-a.score||a.order-b.order).slice(0,20);payload.candidateCount=shortlist.length;
 for(const candidate of shortlist){
  const {document,lines,index}=candidate,lineStart=Math.max(1,index-1),lineEnd=Math.min(lines.length,index+3);
  if(payload.hits.some(hit=>hit.repository.id===document.repository.id&&hit.run.headSha===document.run.headSha&&hit.path===document.source.path&&lineStart<=hit.lineEnd&&lineEnd>=hit.lineStart))continue;
  payload.hits.push({inputDigest:document.digest,repository:document.repository,run:document.run,path:document.source.path,blobSha:document.source.blobSha,lineStart,lineEnd,text:lines.slice(lineStart-1,lineEnd).join('\n'),score:candidate.score});
  if(payload.hits.length===3)break;
 }
 return sourceReport(payload.hits.length?'complete':'no-match',payload,payload.hits.length?[]:['search-no-lexical-match']);
}
