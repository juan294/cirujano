import { canonicalJson,decodeQualityEvidence,parseStrictJson,safeRelativePath,type QualityEvidence } from '@cirujano/core';
export interface QualityRunEnvelope{schemaVersion:1;kind:'github-quality';repositoryId:number;repository:string;runId:number;attempt:number;headSha:string;workflowPath:string;workflowHash:string;jobId:string;sourceTreeDigest:string;lockfileHash:string;profileHash:string;toolSourceSha:string;bundleDigest:string;runnerOs:string;runnerArchitecture:string;runnerImage:string;nodeVersion:string;pnpmVersion:string;workflowContractDigest:string;quality:QualityEvidence}
const keys=['schemaVersion','kind','repositoryId','repository','runId','attempt','headSha','workflowPath','workflowHash','jobId','sourceTreeDigest','lockfileHash','profileHash','toolSourceSha','bundleDigest','runnerOs','runnerArchitecture','runnerImage','nodeVersion','pnpmVersion','workflowContractDigest','quality'];
export function decodeQualityRun(value:unknown):QualityRunEnvelope{
 canonicalJson(value);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw new Error('quality-run-schema');const e=value as QualityRunEnvelope;
 if(e.schemaVersion!==1||e.kind!=='github-quality'||![e.repositoryId,e.runId,e.attempt].every(id=>Number.isSafeInteger(id)&&id>0)||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(e.repository)||![e.headSha,e.toolSourceSha].every(sha=>typeof sha==='string'&&/^[a-f0-9]{40}$/.test(sha))||![e.workflowHash,e.sourceTreeDigest,e.lockfileHash,e.profileHash,e.bundleDigest,e.workflowContractDigest].every(hash=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash))||![e.runnerOs,e.runnerArchitecture,e.runnerImage,e.jobId].every(text=>typeof text==='string'&&text.length>0&&Buffer.byteLength(text)<=512&&!/[\u0000-\u001f\u007f]/.test(text))||![e.nodeVersion,e.pnpmVersion].every(version=>typeof version==='string'&&/^\d+\.\d+\.\d+$/.test(version)))throw new Error('quality-run-identity');
 safeRelativePath(e.workflowPath);if(!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(e.workflowPath))throw new Error('quality-run-workflow');decodeQualityEvidence(e.quality);return e;
}
export function readQualityRun(bytes:Buffer):QualityRunEnvelope{return decodeQualityRun(parseStrictJson(new TextDecoder('utf8',{fatal:true}).decode(bytes),1024*1024));}
function stripTimestamp(line:string):string{return line.replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z /,'');}
/** Input is the authenticated setup-node step slice, not arbitrary whole-job/source stdout. */
export function observeCacheLog(log:string,firstCandidate:boolean):'cold'|'miss'|'hit'|'unknown'{
 if(Buffer.byteLength(log)>4*1024*1024)return'unknown';let misses=0,hits=0;
 for(const raw of log.split(/\r?\n/)){const line=stripTimestamp(raw);if(line==='pnpm cache is not found')misses++;if(/^Cache restored from key: node-cache-Linux-(?:x64|arm64)-pnpm-[a-f0-9]{64}$/.test(line))hits++;}
 if(misses===1&&hits===0)return firstCandidate?'cold':'miss';if(hits===1&&misses===0)return'hit';return'unknown';
}
export function selectedCacheLog(log:string,setupNodeCommit:string):string{
 const lines=log.split(/\r?\n/),setup=`##[group]Run actions/setup-node@${setupNodeCommit}`;let start=-1,end=-1,next=-1,starts=0,ends=0;
 for(const [index,raw]of lines.entries()){
  const line=stripTimestamp(raw);
  if(line===setup){start=index;starts++;}
  if(line==='##[group]Run pnpm install --frozen-lockfile'){end=index;ends++;}
  if(start>=0&&index>start&&next<0&&line.startsWith('##[group]Run '))next=index;
 }
 if(starts!==1||ends!==1||end<=start||next<0)return'';return lines.slice(start+1,next).join('\n');
}

/** Read provider setup metadata before any workflow-controlled action output. */
/** Release tags name the image version, sometimes without its final patch component (tag 20260927.320 for 20260927.320.1). */
function releaseMatches(line:string,major:string,version:string):boolean{const tag=/^Image Release: https:\/\/github\.com\/actions\/runner-images\/releases\/tag\/ubuntu(\d\d)%2F(\d{8}(?:\.\d+){0,3})$/.exec(line);return !!tag&&tag[1]===major&&(tag[2]===version||version.startsWith(`${tag[2]}.`));}
export function readHostedRunnerIdentity(log:string,labels:unknown,requestedRunner:string):{runnerOs:string;runnerArchitecture:string;runnerImage:string}{
 if(Buffer.byteLength(log)>4*1024*1024||!Array.isArray(labels)||!labels.every(label=>typeof label==='string')||!labels.includes(requestedRunner)||labels.includes('self-hosted')||!/^ubuntu-(?:latest|\d\d\.04)$/.test(requestedRunner))throw new Error('measurement-runner-labels');
 const lines=log.replace(/^\uFEFF/,'').split(/\r?\n/).map(stripTimestamp),firstAction=lines.findIndex(line=>line.startsWith('##[group]Run ')),prefix=firstAction<0?lines:lines.slice(0,firstAction);
 if(prefix.filter(line=>/^Current runner version: '\d+\.\d+\.\d+'$/.test(line)).length!==1)throw new Error('measurement-runner-setup');
 const groups=prefix.map((line,index)=>line==='##[group]Runner Image'?index:-1).filter(index=>index>=0);if(groups.length!==1)throw new Error('measurement-runner-image');const begin=groups[0]!,end=prefix.findIndex((line,index)=>index>begin&&line==='##[endgroup]');if(end<0)throw new Error('measurement-runner-image');const block=prefix.slice(begin+1,end),images=block.filter(line=>line.startsWith('Image: ')),versions=block.filter(line=>line.startsWith('Version: ')),releases=block.filter(line=>line.startsWith('Image Release: '));
 if(images.length!==1||versions.length!==1||releases.length!==1)throw new Error('measurement-runner-image');const image=/^Image: ubuntu-(\d\d)\.04$/.exec(images[0]!),version=/^Version: (\d{8}(?:\.\d+){1,3})$/.exec(versions[0]!);if(!image||!version||(requestedRunner!=='ubuntu-latest'&&requestedRunner!==`ubuntu-${image[1]}.04`)||!releaseMatches(releases[0]!,image[1]!,version[1]!))throw new Error('measurement-runner-image');
 return{runnerOs:'Linux',runnerArchitecture:'X64',runnerImage:`ubuntu${image[1]}/${version[1]}`};
}
