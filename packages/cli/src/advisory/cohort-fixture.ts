import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, gitBlobSha } from '@cirujano/core';
import { sealEvidence, type EvidenceBundleV1 } from './contracts.js';
import { evidenceFixture } from './fixture.js';
import type { CohortManifestV1 } from './compare-cohorts.js';

/** Synthetic chronological successful runs; independent source SHAs distinguish the cohorts. */
export function cohortFixture(durationsSeconds:number[]=[100,110,120],options:{offset?:number;headSha?:string;command?:string;stepName?:string}={}):EvidenceBundleV1[]{
 const offset=options.offset??0,headSha=options.headSha??'1'.repeat(40),command=options.command??'pnpm install --frozen-lockfile',stepName=options.stepName??'Install',original=evidenceFixture();
 const content=original.sources[0]!.content.replace('pnpm install --frozen-lockfile',command).replace('name: Install',`name: ${stepName}`),lineEnd=content.split('\n').length;
 return durationsSeconds.map((duration,i)=>{const startedAt=new Date(Date.parse('2026-10-28T10:00:00Z')+(offset+i)*3600000).toISOString(),completedAt=new Date(Date.parse(startedAt)+duration*1000).toISOString();return sealEvidence({...original,run:{...original.run,id:100+offset+i,headSha},job:{...original.job,id:200+offset+i,startedAt,completedAt},workflow:{...original.workflow,blobSha:gitBlobSha(content)},sources:[{...original.sources[0]!,content,blobSha:gitBlobSha(content),lineEnd}],steps:[{...original.steps[0]!,name:stepName,command,startedAt,completedAt,lineEnd}]});});
}
export async function writeCohortFixture(directory:string,bundles:EvidenceBundleV1[]):Promise<{path:string;manifest:CohortManifestV1}>{
 await mkdir(directory,{recursive:true,mode:0o700});const first=bundles[0]!;
 const samples:CohortManifestV1['samples']=[];
 for(let i=0;i<bundles.length;i++){const b=bundles[i]!,input=`sample-${i}`;await mkdir(join(directory,input),{recursive:true,mode:0o700});await writeFile(join(directory,input,'evidence.json'),canonicalJson(b),{mode:0o600});samples.push({input,digest:b.digest,runId:b.run.id,attempt:b.run.attempt,jobId:b.job.id});}
 const manifest:CohortManifestV1={schemaVersion:1,kind:'advisory-cohort',repositoryId:first.repository.id,workflowPath:first.workflow.path,jobKey:first.job.key,event:first.run.event,headSha:first.run.headSha,runnerLabels:[...first.job.labels],samples};
 const path=join(directory,'cohort.json');await writeFile(path,canonicalJson(manifest),{mode:0o600});return {path,manifest};
}
export async function writeCohortFixtures(root:string):Promise<{baselinePath:string;candidatePath:string;baselineBundles:EvidenceBundleV1[];candidateBundles:EvidenceBundleV1[]}>{
 const baselineBundles=cohortFixture(),candidateBundles=cohortFixture([130,140,150],{offset:3,headSha:'3'.repeat(40)}),baseline=await writeCohortFixture(join(root,'baseline'),baselineBundles),candidate=await writeCohortFixture(join(root,'candidate'),candidateBundles);
 return {baselinePath:baseline.path,candidatePath:candidate.path,baselineBundles,candidateBundles};
}
