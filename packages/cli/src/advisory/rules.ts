import { billableMinutesForJob } from '@cirujano/core';
import { decodeEvidence, type EvidenceBundleV1 } from './contracts.js';

export const RULES_VERSION='advisory-rules-v1';
export const POLICY_VERSION='advisory-policy-v1';
export type Category='install'|'build'|'test'|'artifact'|'unknown';
export interface AdvisoryReport<T=unknown> {schemaVersion:1;status:'complete'|'partial'|'no-match'|'uncertain'|'unavailable'|'outcome-unknown';reasonCodes:string[];limitations:string[];nextActions:string[];payload:T}
export function report<T>(status:AdvisoryReport['status'],payload:T,reasonCodes:string[]=[]):AdvisoryReport<T>{return {schemaVersion:1,status,reasonCodes,limitations:['Read-only advisory evidence; no optimization proof, causal conclusion or permission to change CI.','CI routing belongs to Sutura. Unknown prices remain unavailable.'],nextActions:['Inspect pinned evidence; use advisory collect into a fresh directory to complete missing evidence.'],payload};}
export function classifyCommand(command:string|null):Category {
  if(command===null||/[\n\r;&|`$<>]/u.test(command))return 'unknown';
  const tokens=command.trim().split(/\s+/u),[tool,verb,third]=tokens;
  if(['pnpm','npm','yarn'].includes(tool??'')){
    if((verb==='install'||(tool==='npm'&&verb==='ci'))&&tokens.slice(2).every(t=>['--frozen-lockfile','--immutable','--ignore-scripts','--prefer-offline'].includes(t)))return 'install';
    if((verb==='build'&&tokens.length===2)||(verb==='run'&&third==='build'&&tokens.length===3))return 'build';
    if((verb==='test'&&tokens.length===2)||(verb==='run'&&third==='test'&&tokens.length===3))return 'test';
  }
  return 'unknown';
}
export function elapsed(start:string|null,end:string|null):number|null {
  if(start===null||end===null)return null;
  const a=Date.parse(start),b=Date.parse(end);return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?b-a:null;
}
export function bundleIdentity(b:EvidenceBundleV1):string{return `${b.repository.id}/${b.run.id}/${b.run.attempt}/${b.job.id}`;}
export function observeBundle(input:EvidenceBundleV1){
  const b=decodeEvidence(input),durationMs=elapsed(b.job.startedAt,b.job.completedAt);
  const roundedMinutes=billableMinutesForJob(b.job);
  const steps=b.steps.map(s=>{
    const duration=elapsed(s.startedAt,s.completedAt);
    const bounded=duration!==null&&durationMs!==null&&duration<=durationMs&&s.startedAt!==null&&s.completedAt!==null&&b.job.startedAt!==null&&b.job.completedAt!==null&&Date.parse(s.startedAt)>=Date.parse(b.job.startedAt)&&Date.parse(s.completedAt)<=Date.parse(b.job.completedAt);
    const mapped=b.mapping==='supported'&&s.sourceIndex!==null;
    const category=mapped?classifyCommand(s.command):'unknown';
    const share=bounded&&durationMs>0&&mapped?duration!/durationMs:null;
    return {...s,category,durationMs:duration,share,investigate:category==='install'&&duration!==null&&duration>=30000&&share!==null&&share>=0.2};
  });
  const repeated=steps.filter((s,i)=>s.command!==null&&s.sourceIndex!==null&&steps.some((t,j)=>i!==j&&t.sourceIndex!==null&&s.command===t.command)).map(s=>({sourceIndex:s.sourceIndex,command:s.command}));
  return {identity:bundleIdentity(b),inputDigest:b.digest,evidence:b,durationMs,roundedMinutes,githubHostedChargeUsd:b.repository.visibility==='public'&&b.job.labels.some(label=>['ubuntu-latest','ubuntu-22.04','ubuntu-24.04','ubuntu-24.04-arm','windows-latest','windows-2022','windows-2025','macos-latest','macos-14','macos-15'].includes(label))&&!b.job.labels.includes('self-hosted')?0:null,steps,repeated,automation:'advisory-only' as const};
}
export type EvidenceCard=ReturnType<typeof observeBundle>;
export function evidenceStatus(bundle:EvidenceBundleV1):'complete'|'partial' {
  return bundle.mapping!=='supported'||bundle.reasonCodes.length>0||bundle.job.startedAt===null||bundle.job.completedAt===null||bundle.job.conclusion===null||bundle.steps.some(step=>step.startedAt===null||step.completedAt===null||step.conclusion===null)?'partial':'complete';
}
export function validatedBundles(inputs:EvidenceBundleV1[]):EvidenceBundleV1[]{
  if(inputs.length>20)throw new Error('advisory-input-limit');
  const seen=new Map<string,EvidenceBundleV1>();
  for(const input of inputs){const b=decodeEvidence(input),id=bundleIdentity(b),prior=seen.get(id);if(prior&&prior.digest!==b.digest)throw new Error('advisory-conflicting-evidence');seen.set(id,b);}
  return [...seen.values()];
}
export function buildInbox(inputs:EvidenceBundleV1[],sort:'duration'|'minutes'='duration'){
 const cards=validatedBundles(inputs).map(observeBundle).sort((a,b)=>((sort==='duration'?b.durationMs:b.roundedMinutes)??-1)-((sort==='duration'?a.durationMs:a.roundedMinutes)??-1)||(a.identity<b.identity?-1:a.identity>b.identity?1:0));
 return report(cards.some(c=>evidenceStatus(c.evidence)==='partial')?'partial':'complete',{rulesVersion:RULES_VERSION,policyVersion:POLICY_VERSION,cards},cards.length?[]:['empty-inventory']);
}
