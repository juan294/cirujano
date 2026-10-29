import { dirname, join } from 'node:path';
import { billableMinutesForJob, canonicalJson, safeRelativePath } from '@cirujano/core';
import { readPrivateJson } from '../optimization/store.js';
import { decodeEvidence, type EvidenceBundleV1, type EvidenceStep } from './contracts.js';
import { classifyCommand, elapsed, evidenceStatus, type Category } from './rules.js';

export interface CohortManifestV1 {schemaVersion:1;kind:'advisory-cohort';repositoryId:number;workflowPath:string;jobKey:string;event:string;headSha:string;runnerLabels:string[];samples:{input:string;digest:string;runId:number;attempt:number;jobId:number}[]}
export interface CohortRun {inputDigest:string;runId:number;attempt:number;jobId:number;startedAt:string;completedAt:string;durationMs:number;roundedMinutes:number}
export interface CohortStats {sampleCount:number;medianDurationMs:number;medianRoundedMinutes:number;window:{startedAt:string;completedAt:string};source:{repositoryId:number;repository:string;workflowPath:string;workflowBlobSha:string;jobKey:string;event:string;headSha:string;runnerLabels:string[]};runs:CohortRun[]}
export interface StepReference {inputDigest:string;repository:string;runId:number;attempt:number;jobId:number;headSha:string;workflowPath:string;lineStart:number;lineEnd:number}
export interface StepComparison {sourceIndex:number;name:string;command:string|null;category:Category;baselineMedianMs:number;candidateMedianMs:number;deltaMs:number;baselineReferences:StepReference[];candidateReferences:StepReference[]}
export interface UnmatchedStep {cohort:'baseline'|'candidate';sourceIndex:number;name:string;command:string|null;reason:string}
export interface CategoryDelta {category:Category;baselineMedianMs:number;candidateMedianMs:number;deltaMs:number}
export interface ComparableInputs {base:EvidenceBundleV1[];candidate:EvidenceBundleV1[];baselineStats:CohortStats;candidateStats:CohortStats}
export function median(values:number[]):number{const sorted=[...values].sort((a,b)=>a-b);if(!sorted.length)throw new Error('cohort-empty-metric');const mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]!:(sorted[mid-1]!+sorted[mid]!)/2;}
function positive(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<=0)throw new Error('cohort-invalid-id');}
function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw new Error('cohort-invalid-manifest');return value as Record<string,unknown>;}
function labels(value:unknown):string[]{if(!Array.isArray(value)||!value.length||value.length>100||!value.every(v=>typeof v==='string'&&v.length&&Buffer.byteLength(v)<=2048)||new Set(value).size!==value.length)throw new Error('cohort-invalid-runner-labels');return [...value].sort() as string[];}
function sampleCount(length:number,maximum=20):void{if(!Number.isSafeInteger(maximum)||maximum<0||maximum>20||length<3||length>20||length>maximum)throw new Error('cohort-sample-count');}
function sameSource(a:CohortStats['source'],b:CohortStats['source'],within:boolean):boolean{return a.repositoryId===b.repositoryId&&a.repository===b.repository&&a.workflowPath===b.workflowPath&&a.jobKey===b.jobKey&&a.event===b.event&&canonicalJson(a.runnerLabels)===canonicalJson(b.runnerLabels)&&(!within||(a.headSha===b.headSha&&a.workflowBlobSha===b.workflowBlobSha));}
function sourceOf(b:EvidenceBundleV1):CohortStats['source']{if(!b.workflow.blobSha)throw new Error('cohort-missing-source');return {repositoryId:b.repository.id,repository:b.repository.name,workflowPath:b.workflow.path,workflowBlobSha:b.workflow.blobSha,jobKey:b.job.key,event:b.run.event,headSha:b.run.headSha,runnerLabels:labels(b.job.labels)};}
export function validateCohort(inputs:EvidenceBundleV1[]):{bundles:EvidenceBundleV1[];stats:CohortStats}{
 sampleCount(inputs.length);const bundles=inputs.map(input=>{try{return decodeEvidence(input);}catch{throw new Error('cohort-invalid-evidence');}});
 const seenRuns=new Set<number>(),source=sourceOf(bundles[0]!);const runs:CohortRun[]=[];
 for(const b of bundles){
  if(b.mapping!=='supported'||evidenceStatus(b)!=='complete'||b.reasonCodes.length||b.job.conclusion!=='success'||!b.steps.length||!b.steps.some(s=>s.sourceIndex!==null))throw new Error('cohort-incomplete-or-unsupported');
  if(!sameSource(source,sourceOf(b),true))throw new Error('cohort-mixed-source-or-runner');
  if(seenRuns.has(b.run.id))throw new Error('cohort-duplicate-or-retried-run');seenRuns.add(b.run.id);
  const durationMs=elapsed(b.job.startedAt,b.job.completedAt),roundedMinutes=billableMinutesForJob(b.job);if(durationMs===null||roundedMinutes===null)throw new Error('cohort-invalid-timing');
  let previousEnd=-Infinity;
  for(const step of b.steps){const duration=elapsed(step.startedAt,step.completedAt);if(duration===null||step.startedAt===null||step.completedAt===null||!['success','skipped'].includes(step.conclusion??''))throw new Error('cohort-incomplete-step');const start=Date.parse(step.startedAt),end=Date.parse(step.completedAt);if(start<previousEnd)throw new Error('cohort-step-overlap');previousEnd=Math.max(previousEnd,end);}
  runs.push({inputDigest:b.digest,runId:b.run.id,attempt:b.run.attempt,jobId:b.job.id,startedAt:b.job.startedAt!,completedAt:b.job.completedAt!,durationMs,roundedMinutes});
 }
 runs.sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.runId-b.runId);for(let i=1;i<runs.length;i++)if(Date.parse(runs[i]!.startedAt)<Date.parse(runs[i-1]!.completedAt))throw new Error('cohort-sample-window-overlap');
 const ordered=runs.map(r=>bundles.find(b=>b.digest===r.inputDigest)!);
 return {bundles:ordered,stats:{sampleCount:runs.length,medianDurationMs:median(runs.map(r=>r.durationMs)),medianRoundedMinutes:median(runs.map(r=>r.roundedMinutes)),window:{startedAt:runs[0]!.startedAt,completedAt:runs.at(-1)!.completedAt},source,runs}};
}
export function validateComparisonInputs(base:EvidenceBundleV1[],candidate:EvidenceBundleV1[]):ComparableInputs{
 if(base.length+candidate.length>20)throw new Error('cohort-total-input-limit');
 const left=validateCohort(base),right=validateCohort(candidate);if(!sameSource(left.stats.source,right.stats.source,false))throw new Error('cohort-incompatible-source-or-runner');
 const ids=new Set(left.bundles.map(b=>b.run.id));if(right.bundles.some(b=>ids.has(b.run.id)))throw new Error('cohort-overlapping-or-retried-run');
 if(Date.parse(left.stats.window.completedAt)>Date.parse(right.stats.window.startedAt))throw new Error('cohort-baseline-must-precede-candidate');
 return {base:left.bundles,candidate:right.bundles,baselineStats:left.stats,candidateStats:right.stats};
}
export async function readCohort(path:string,maximum=20):Promise<{manifest:CohortManifestV1;bundles:EvidenceBundleV1[]}>{
 const raw=object(await readPrivateJson(path),['schemaVersion','kind','repositoryId','workflowPath','jobKey','event','headSha','runnerLabels','samples']);
 if(raw.schemaVersion!==1||raw.kind!=='advisory-cohort'||typeof raw.workflowPath!=='string'||!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(raw.workflowPath)||typeof raw.jobKey!=='string'||!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(raw.jobKey)||typeof raw.event!=='string'||typeof raw.headSha!=='string'||!/^[a-f0-9]{40}$/.test(raw.headSha))throw new Error('cohort-invalid-manifest');positive(raw.repositoryId);safeRelativePath(raw.workflowPath);const runnerLabels=labels(raw.runnerLabels);
 if(!Array.isArray(raw.samples))throw new Error('cohort-invalid-manifest');sampleCount(raw.samples.length,maximum);
 const seen=new Set<string>(),bundles:EvidenceBundleV1[]=[];
 for(const entry of raw.samples){
  const sample=object(entry,['input','digest','runId','attempt','jobId']);if(typeof sample.input!=='string'||typeof sample.digest!=='string'||!/^[a-f0-9]{64}$/.test(sample.digest))throw new Error('cohort-invalid-sample');safeRelativePath(sample.input);positive(sample.runId);positive(sample.attempt);positive(sample.jobId);
  if(seen.has(sample.input))throw new Error('cohort-duplicate-sample-path');seen.add(sample.input);
  const bundle=decodeEvidence(await readPrivateJson(join(dirname(path),sample.input,'evidence.json'),4*1024*1024));
  if(bundle.digest!==sample.digest||bundle.run.id!==sample.runId||bundle.run.attempt!==sample.attempt||bundle.job.id!==sample.jobId||bundle.repository.id!==raw.repositoryId||bundle.workflow.path!==raw.workflowPath||bundle.job.key!==raw.jobKey||bundle.run.event!==raw.event||bundle.run.headSha!==raw.headSha||canonicalJson(labels(bundle.job.labels))!==canonicalJson(runnerLabels))throw new Error('cohort-manifest-evidence-mismatch');bundles.push(bundle);
 }
 validateCohort(bundles);return {manifest:raw as unknown as CohortManifestV1,bundles};
}
function reference(b:EvidenceBundleV1,s:EvidenceStep):StepReference{return {inputDigest:b.digest,repository:b.repository.name,runId:b.run.id,attempt:b.run.attempt,jobId:b.job.id,headSha:b.run.headSha,workflowPath:b.workflow.path,lineStart:s.lineStart!,lineEnd:s.lineEnd!};}
function stepKey(step:EvidenceStep):string{return canonicalJson({sourceIndex:step.sourceIndex,name:step.name,command:step.command});}
export function compareSteps(inputs:ComparableInputs):{matchedSteps:StepComparison[];unmatchedSteps:UnmatchedStep[];categoryDeltas:CategoryDelta[]}{
 const {base,candidate}=inputs,left=base[0]!.steps.filter(s=>s.sourceIndex!==null),right=candidate[0]!.steps.filter(s=>s.sourceIndex!==null),matchedSteps:StepComparison[]=[],unmatchedSteps:UnmatchedStep[]=[];
 for(const step of left){if(step.command===null){unmatchedSteps.push({cohort:'baseline',sourceIndex:step.sourceIndex!,name:step.name,command:null,reason:'command-identity-unavailable'});continue;}const key=stepKey(step),other=right.find(s=>stepKey(s)===key);const leftAll=base.map(b=>b.steps.find(s=>stepKey(s)===key)),rightAll=candidate.map(b=>b.steps.find(s=>stepKey(s)===key));if(!other||leftAll.some(s=>!s)||rightAll.some(s=>!s)){unmatchedSteps.push({cohort:'baseline',sourceIndex:step.sourceIndex!,name:step.name,command:step.command,reason:'source-step-identity-changed-or-missing'});continue;}const baselineMedianMs=median(leftAll.map(s=>elapsed(s!.startedAt,s!.completedAt)!)),candidateMedianMs=median(rightAll.map(s=>elapsed(s!.startedAt,s!.completedAt)!));matchedSteps.push({sourceIndex:step.sourceIndex!,name:step.name,command:step.command,category:classifyCommand(step.command),baselineMedianMs,candidateMedianMs,deltaMs:candidateMedianMs-baselineMedianMs,baselineReferences:base.map((b,i)=>reference(b,leftAll[i]!)),candidateReferences:candidate.map((b,i)=>reference(b,rightAll[i]!))});}
 for(const step of right)if(!matchedSteps.some(s=>s.sourceIndex===step.sourceIndex&&s.name===step.name&&s.command===step.command))unmatchedSteps.push({cohort:'candidate',sourceIndex:step.sourceIndex!,name:step.name,command:step.command,reason:step.command===null?'command-identity-unavailable':'source-step-identity-changed-or-missing'});
 const categories=[...new Set(matchedSteps.map(s=>s.category))],categoryDeltas=categories.map(category=>{const indexes=new Set(matchedSteps.filter(s=>s.category===category).map(s=>s.sourceIndex));const sums=(bundles:EvidenceBundleV1[])=>bundles.map(b=>b.steps.filter(s=>s.sourceIndex!==null&&indexes.has(s.sourceIndex)).reduce((sum,s)=>sum+elapsed(s.startedAt,s.completedAt)!,0));const baselineMedianMs=median(sums(base)),candidateMedianMs=median(sums(candidate));return {category,baselineMedianMs,candidateMedianMs,deltaMs:candidateMedianMs-baselineMedianMs};});
 return {matchedSteps,unmatchedSteps,categoryDeltas};
}
