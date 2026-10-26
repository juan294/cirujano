import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, decodeSourceManifest, decodeVerificationProfile, gitBlobSha, jsonDigest, normalizeQualityReports, parseStrictJson, parseWorkflowSource, protectedWorkflowDigest, safeRelativePath, sha256, type SourceManifest } from '@cirujano/core';
import { validateProfileCommands } from './execution-profile.js';
import { decodeQualityRun, type QualityRunEnvelope } from './quality-run.js';

declare const CIRUJANO_TOOL_SOURCE_SHA: string | undefined;
const execute=promisify(execFile),maximum=16*1024*1024;
export interface QualityReporterConfig {schemaVersion:1;kind:'quality-reporter-config';profilePath:string;workflowPath:string;jobId:string;rawTestReportPath:string;rawCoverageReportPath:string;receiptPath:string;qualityPath:string;controllerBundlePath:string;toolSourceSha:string;bundleDigest:string;pnpmPath:string}
export interface QualityReporterOptions {workspace?:string;env?:NodeJS.ProcessEnv}
function fail(reason:string):never{throw new Error(`quality-reporter-${reason}`);}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail('object');return value as Record<string,unknown>;}
function sensitive(path:string):void{if(/(?:^|\/)(?:\.git|\.env(?:\..*)?|\.npmrc|\.pnpmfile\.cjs|credentials(?:\..*)?|id_rsa|id_ed25519|[^/]*\.(?:pem|key))(?:\/|$)/i.test(path))fail('sensitive-path');}
function path(value:unknown):string{if(typeof value!=='string')fail('path');safeRelativePath(value);sensitive(value);return value;}
async function ancestors(absolute:string):Promise<void>{const parts=absolute.split('/').filter(Boolean);let current='/';for(const segment of parts.slice(0,-1)){current=join(current,segment);const stat=await lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())fail('symlink-parent');}}
async function bytes(absolute:string,limit=maximum,after?:number,allowEmpty=false):Promise<Buffer>{await ancestors(absolute);const handle=await open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>limit||(!allowEmpty&&stat.size<1)||(after!==undefined&&(stat.mtimeMs<after||stat.ctimeMs<after)))fail('report-file');const value=await handle.readFile();if(value.length!==stat.size||value.length>limit)fail('file-size-drift');return value;}finally{await handle.close();}}
async function exists(absolute:string):Promise<boolean>{try{await lstat(absolute);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
async function absent(absolute:string):Promise<void>{if(await exists(absolute))fail('preseeded-report');}
async function ensureParents(absolute:string):Promise<void>{let current='/';for(const segment of absolute.split('/').filter(Boolean).slice(0,-1)){current=join(current,segment);if(!await exists(current))await mkdir(current,{mode:0o700});const stat=await lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())fail('symlink-parent');}}
async function privateWrite(absolute:string,value:unknown):Promise<void>{await ensureParents(absolute);const handle=await open(absolute,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(canonicalJson(value));await handle.sync();}finally{await handle.close();}}
async function readJson(absolute:string,after?:number):Promise<unknown>{return parseStrictJson(new TextDecoder('utf8',{fatal:true}).decode(await bytes(absolute,maximum,after)),maximum);}
function config(value:unknown):QualityReporterConfig{
 canonicalJson(value);const c=record(value);const keys=['schemaVersion','kind','profilePath','workflowPath','jobId','rawTestReportPath','rawCoverageReportPath','receiptPath','qualityPath','controllerBundlePath','toolSourceSha','bundleDigest','pnpmPath'];
 if(Object.keys(c).sort().join(',')!==keys.sort().join(',')||c.schemaVersion!==1||c.kind!=='quality-reporter-config'||typeof c.jobId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(c.jobId)||typeof c.toolSourceSha!=='string'||!/^[a-f0-9]{40}$/.test(c.toolSourceSha)||typeof c.bundleDigest!=='string'||!/^[a-f0-9]{64}$/.test(c.bundleDigest)||typeof c.pnpmPath!=='string'||!isAbsolute(c.pnpmPath)||/[\u0000-\u001f]/.test(c.pnpmPath))fail('config');
 for(const key of ['profilePath','workflowPath','rawTestReportPath','rawCoverageReportPath','receiptPath','qualityPath'])path(c[key]);
 if(typeof c.controllerBundlePath!=='string'||!c.controllerBundlePath||/[\u0000-\u001f]/.test(c.controllerBundlePath))fail('bundle-path');if(!isAbsolute(c.controllerBundlePath))path(c.controllerBundlePath);
 if(!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(String(c.workflowPath)))fail('workflow-path');
 return c as unknown as QualityReporterConfig;
}
async function git(workspace:string,args:string[],limit=maximum):Promise<Buffer>{return(await execute('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',workspace,...args],{encoding:'buffer',timeout:10000,maxBuffer:limit,env:{PATH:process.env.PATH}})).stdout;}
async function toolIdentity():Promise<string>{if(typeof CIRUJANO_TOOL_SOURCE_SHA!=='undefined')return CIRUJANO_TOOL_SOURCE_SHA;return(await git(dirname(fileURLToPath(import.meta.url)),['rev-parse','HEAD'],1024)).toString().trim();}
function githubIdentity(env:NodeJS.ProcessEnv,workspace:string,c:QualityReporterConfig):Record<string,string>|null{
 if(env.GITHUB_ACTIONS!=='true')return null;
 const names=['GITHUB_REPOSITORY_ID','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA','GITHUB_JOB','GITHUB_WORKFLOW_REF','RUNNER_OS','RUNNER_ARCH','ImageOS','ImageVersion'];const identity:Record<string,string>={};
 for(const name of names){const value=env[name];if(!value||Buffer.byteLength(value)>512||/[\u0000-\u001f\u007f]/.test(value))fail('github-environment');identity[name]=value;}
 if(env.GITHUB_WORKSPACE!==undefined&&env.GITHUB_WORKSPACE!==workspace)fail('github-workspace');
 if(identity.GITHUB_JOB!==c.jobId||!identity.GITHUB_WORKFLOW_REF!.startsWith(`${identity.GITHUB_REPOSITORY}/${c.workflowPath}@`)||! /^[a-f0-9]{40}$/.test(identity.GITHUB_SHA!)||!['GITHUB_REPOSITORY_ID','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'].every(name=>/^[1-9]\d*$/.test(identity[name]!)&&Number.isSafeInteger(Number(identity[name]))))fail('github-identity');
 return identity;
}
async function snapshot(workspace:string,c:QualityReporterConfig,configPath:string,env:NodeJS.ProcessEnv){
 const profileBytes=await bytes(join(workspace,c.profilePath)),profile=decodeVerificationProfile(parseStrictJson(profileBytes.toString('utf8'))),workflowBytes=await bytes(join(workspace,c.workflowPath)),workflow=workflowBytes.toString('utf8');validateProfileCommands(workflow,profile,c.jobId);
 const outputs=[c.rawTestReportPath,c.rawCoverageReportPath,c.receiptPath,c.qualityPath,profile.testReportPath,profile.coverageReportPath];if(new Set(outputs).size!==outputs.length||outputs.some(output=>[configPath,c.profilePath,c.workflowPath,'pnpm-lock.yaml',...profile.sourcePaths].includes(output)))fail('report-path-overlap');outputs.forEach(path);
 const parsed=parseWorkflowSource(workflow),job=record(record(parsed.jobs)[c.jobId]);if(!Array.isArray(job.steps))fail('job');const indexes=job.steps.flatMap((step,index)=>typeof record(step).uses==='string'&&String(record(step).uses).startsWith('actions/setup-node@')?[index]:[]);if(indexes.length!==1)fail('setup-node-step');
 const bundlePath=isAbsolute(c.controllerBundlePath)?c.controllerBundlePath:join(workspace,c.controllerBundlePath);if(sha256(await bytes(bundlePath))!==c.bundleDigest||await toolIdentity()!==c.toolSourceSha)fail('tool-bundle-drift');
 const pnpm=await execute(c.pnpmPath,['--version'],{cwd:workspace,encoding:'utf8',maxBuffer:4096,timeout:10000,env:{PATH:process.env.PATH}});const pnpmVersion=pnpm.stdout.trim();if(pnpm.stderr||pnpmVersion!==profile.pnpmVersion||process.versions.node!==profile.nodeVersion)fail('runtime-drift');
 const identity=githubIdentity(env,workspace,c),files:SourceManifest['files']=[];
 let headSha:string|null=null;let entries:{path:string;mode:'100644'|'100755';blob?:string}[];
 if(identity){headSha=(await git(workspace,['rev-parse','--verify','HEAD^{commit}'],1024)).toString().trim();if(headSha!==identity.GITHUB_SHA)fail('head-drift');
  entries=(await git(workspace,['ls-tree','-r','-z',headSha])).toString('utf8').split('\0').filter(Boolean).map(entry=>{const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s.exec(entry);if(!match)fail('git-file-mode');return{path:path(match[3]),mode:match[1] as '100644'|'100755',blob:match[2]!};});
  if(entries.some(entry=>outputs.includes(entry.path)))fail('tracked-report');
 }else{entries=[...new Set([configPath,c.profilePath,c.workflowPath,'pnpm-lock.yaml',...profile.sourcePaths,...(!isAbsolute(c.controllerBundlePath)?[c.controllerBundlePath]:[])])].sort().map(file=>({path:path(file),mode:'100644'}));}
 if(entries.length>5000)fail('source-limit');let total=0;
 for(const entry of entries){const filePath=join(workspace,entry.path),content=await bytes(filePath,4*1024*1024,undefined,true),stat=await lstat(filePath);total+=content.length;if(total>maximum)fail('source-size');const actualMode=stat.mode&0o111?'100755':'100644';if(identity&&(actualMode!==entry.mode||gitBlobSha(content)!==entry.blob))fail('source-drift');files.push({path:entry.path,mode:identity?entry.mode:actualMode,hash:sha256(content),bytesBase64:content.toString('base64')});}
 files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const sourceTreeDigest=identity?jsonDigest(files.filter(file=>file.path!==c.workflowPath).map(({path,mode,hash})=>({path,mode,hash}))):null;
 const workflowHash=sha256(workflowBytes),lockfileHash=sha256(await bytes(join(workspace,'pnpm-lock.yaml'))),profileHash=sha256(profileBytes);
 if(identity)decodeSourceManifest({schemaVersion:1,profilePath:c.profilePath,files,provenance:{repositoryId:Number(identity.GITHUB_REPOSITORY_ID),repository:identity.GITHUB_REPOSITORY,baseSha:headSha,workflowBlobSha:gitBlobSha(workflowBytes),workflowPath:c.workflowPath,workflowHash,jobId:c.jobId,stepIndex:indexes[0],lockfileHash,sourceTreeDigest,verificationProfileHash:profileHash,toolSourceSha:c.toolSourceSha,bundleDigest:c.bundleDigest}});
 return{profile,outputs,binding:{configHash:sha256(await bytes(join(workspace,configPath))),profileHash,workflowHash,lockfileHash,toolSourceSha:c.toolSourceSha,bundleDigest:c.bundleDigest,nodeVersion:process.versions.node,pnpmVersion,workflowContractDigest:protectedWorkflowDigest(workflow,c.jobId,indexes[0]!),sourceTreeDigest,headSha,identity,files:files.map(({path,mode,hash})=>({path,mode,hash}))}};
}

/** Start/finish bracket existing checks; this reporter never reruns source commands. */
export async function runQualityReporter(action:'start'|'finish',configPath:string,options:QualityReporterOptions={}):Promise<void>{
 if(!['start','finish'].includes(action))fail('action');path(configPath);const workspace=await realpath(options.workspace??process.cwd()),env=options.env??process.env,c=config(await readJson(join(workspace,configPath))),state=await snapshot(workspace,c,configPath,env),receiptPath=join(workspace,c.receiptPath);
 if(action==='start'){for(const output of state.outputs)await absent(join(workspace,output));await privateWrite(receiptPath,{schemaVersion:1,kind:'quality-reporter-start',workspace,startedAt:Date.now(),binding:state.binding,bindingDigest:jsonDigest(state.binding)});return;}
 const receipt=record(await readJson(receiptPath));if(Object.keys(receipt).sort().join(',')!==['schemaVersion','kind','workspace','startedAt','binding','bindingDigest'].sort().join(',')||receipt.schemaVersion!==1||receipt.kind!=='quality-reporter-start'||receipt.workspace!==workspace||typeof receipt.startedAt!=='number'||!Number.isSafeInteger(receipt.startedAt)||receipt.startedAt<=0||Date.now()-receipt.startedAt>state.profile.timeoutSeconds*1000||receipt.startedAt>Date.now()||receipt.bindingDigest!==jsonDigest(receipt.binding)||canonicalJson(receipt.binding)!==canonicalJson(state.binding))fail('freshness-receipt');
 const quality=normalizeQualityReports(await readJson(join(workspace,c.rawTestReportPath),receipt.startedAt),await readJson(join(workspace,c.rawCoverageReportPath),receipt.startedAt),state.profile,workspace);
 const outputs:[string,unknown][]=[[state.profile.testReportPath,{tests:quality.tests}],[state.profile.coverageReportPath,{coverage:quality.coverage}]];
 const identity=state.binding.identity;if(identity){const envelope:QualityRunEnvelope={schemaVersion:1,kind:'github-quality',repositoryId:Number(identity.GITHUB_REPOSITORY_ID),repository:identity.GITHUB_REPOSITORY!,runId:Number(identity.GITHUB_RUN_ID),attempt:Number(identity.GITHUB_RUN_ATTEMPT),headSha:state.binding.headSha!,workflowPath:c.workflowPath,workflowHash:state.binding.workflowHash,jobId:c.jobId,sourceTreeDigest:state.binding.sourceTreeDigest!,lockfileHash:state.binding.lockfileHash,profileHash:state.binding.profileHash,toolSourceSha:c.toolSourceSha,bundleDigest:c.bundleDigest,runnerOs:identity.RUNNER_OS!,runnerArchitecture:identity.RUNNER_ARCH!,runnerImage:`${identity.ImageOS}/${identity.ImageVersion}`,nodeVersion:state.binding.nodeVersion,pnpmVersion:state.binding.pnpmVersion,workflowContractDigest:state.binding.workflowContractDigest,quality};outputs.push([c.qualityPath,decodeQualityRun(envelope)]);}
 for(const [output]of outputs){await absent(join(workspace,output));await ensureParents(join(workspace,output));}for(const [output,value]of outputs)await privateWrite(join(workspace,output),value);
}
export async function qualityReporterMain(argv:string[]=process.argv.slice(2)):Promise<number>{try{if(argv.length!==3||!['start','finish'].includes(argv[0]!)||argv[1]!=='--config')fail('usage');await runQualityReporter(argv[0] as 'start'|'finish',argv[2]!);return 0;}catch{process.stderr.write('quality-reporter-rejected: inspect source, runtime and fresh report configuration\n');return 1;}}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await qualityReporterMain();
