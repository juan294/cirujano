import { isAbsolute } from 'node:path';
import { canonicalJson, decodeProvenance, decodeQualityEvidence, decodeVerificationProfile, jsonDigest, parseWorkflowSource, type Provenance, type QualityEvidence, type SourceManifest, type VerificationProfile } from '@cirujano/core';
export interface ExecutionProfile { schemaVersion:1;kind:'execution-profile';provenance:Provenance;proposalDigest:string;candidateSha:string;candidateRepository:string;project:string;image:{uuid:string;ociDigest:string;registryReference:string;importOperationId:string;recipeHash:string;manifestHash:string;dependencyStoreHash:string;harnessHash:string};verificationProfile:VerificationProfile;expectedQuality:QualityEvidence;timeoutSeconds:600;maxLayerBytes:number;imageRetention:'owner-retained' }
export interface SandboxPermit {schemaVersion:1;kind:'sandbox-permit';permitId:string;repositoryId:number;proposalDigest:string;profileDigest:string;candidateSha:string;imageUuid:string;project:string;expiresAt:string;maxOperations:number}
export interface ImageManifest {schemaVersion:1;kind:'optimization-image';toolSourceSha:string;bundleDigest:string;nodeVersion:string;pnpmVersion:string;lockfileHash:string;dependencyStoreHash:string;harnessHash:string;recipeHash:string}
export interface SandboxPayload {schemaVersion:1;kind:'sandbox-payload';role:'base'|'candidate';profileDigest:string;proposalDigest:string;toolSourceSha:string;bundleDigest:string;imageManifestHash:string;harnessHash:string;sourceDigest:string;workflowPath:string;workflowHash:string;files:SourceManifest['files'];verificationProfile:VerificationProfile;expectedQuality:QualityEvidence}
export interface HarnessCommand {argv:string[];exitCode:number|null;signal:string|null;timedOut:boolean;truncated:boolean;stdoutHash:string;stderrHash:string}
export interface HarnessEnvelope {schemaVersion:1;kind:'harness-result';role:'base'|'candidate';profileDigest:string;proposalDigest:string;toolSourceSha:string;bundleDigest:string;imageManifestHash:string;harnessHash:string;sourceDigest:string;workflowHash:string;commands:HarnessCommand[];quality:QualityEvidence|null;elapsedMs:number}
function invalid():never{throw new Error('unsupported-execution-profile');}
function record(value:unknown):Record<string,unknown>{canonicalJson(value);if(!value||typeof value!=='object'||Array.isArray(value))invalid();return value as Record<string,unknown>;}
function exact(value:unknown,keys:string[]):Record<string,unknown>{const r=record(value);if(Object.keys(r).sort().join(',')!==keys.sort().join(','))invalid();return r;}
const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const bounded=(value:unknown)=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=512&&!/[\u0000-\u001f\u007f]/.test(value);
export function completeCommands(profile:VerificationProfile):string[][]{return[['pnpm','install','--frozen-lockfile'],...profile.commands.map(argv=>[...argv])];}
export function decodeExecutionProfile(value:unknown):ExecutionProfile {
 const p=exact(value,['schemaVersion','kind','provenance','proposalDigest','candidateSha','candidateRepository','project','image','verificationProfile','expectedQuality','timeoutSeconds','maxLayerBytes','imageRetention']) as unknown as ExecutionProfile;
 decodeProvenance(p.provenance);decodeVerificationProfile(p.verificationProfile);decodeQualityEvidence(p.expectedQuality);
 const image=exact(p.image,['uuid','ociDigest','registryReference','importOperationId','recipeHash','manifestHash','dependencyStoreHash','harnessHash']);
 if(p.schemaVersion!==1||p.kind!=='execution-profile'||!hash(p.proposalDigest)||!sha(p.candidateSha)||p.candidateSha===p.provenance.baseSha||!bounded(p.candidateRepository)||!isAbsolute(p.candidateRepository)||!bounded(p.project)||!uuid(image.uuid)||!uuid(image.importOperationId)||!['ociDigest','recipeHash','manifestHash','dependencyStoreHash','harnessHash'].every(key=>hash(image[key]))||!bounded(image.registryReference)||!/^docker:\/\/[A-Za-z0-9./_:-]+@sha256:[a-f0-9]{64}$/.test(String(image.registryReference))||!String(image.registryReference).endsWith(`@sha256:${String(image.ociDigest)}`)||p.timeoutSeconds!==600||p.verificationProfile.timeoutSeconds!==600||!Number.isSafeInteger(p.maxLayerBytes)||p.maxLayerBytes<1||p.maxLayerBytes>1024*1024*1024||p.imageRetention!=='owner-retained')invalid();
 if(!p.verificationProfile.commands.every(argv=>['pnpm','node'].includes(argv[0]!)&&argv.every(arg=>bounded(arg)&&!arg.includes('${{')))||p.verificationProfile.commands.some(argv=>argv[0]==='pnpm'&&['install','i'].includes(argv[1]!))||!p.expectedQuality.tests.length||!p.expectedQuality.coverage.length||p.expectedQuality.tests.some(test=>test.outcome==='failed')||p.expectedQuality.commandDigest!==jsonDigest(completeCommands(p.verificationProfile)))invalid();
 return p;
}
/** The owner profile lists every post-install check, in original order. Shell syntax cannot be guessed. */
export function validateProfileCommands(source:string,profile:VerificationProfile,jobId:string):void {
 const workflow=parseWorkflowSource(source),job=record(record(workflow.jobs)[jobId]);
 if(!Array.isArray(job.steps)||Object.hasOwn(job,'env')||Object.hasOwn(workflow,'env')||Object.hasOwn(job,'defaults')||Object.hasOwn(workflow,'defaults'))invalid();let installed=false;const checks:string[][]=[];
 for(const raw of job.steps){const step=record(raw);if(!Object.hasOwn(step,'run'))continue;
  if(typeof step.run!=='string'||Object.keys(step).some(key=>['if','env','shell','working-directory','continue-on-error','timeout-minutes'].includes(key)))invalid();
  if(step.run==='pnpm install --frozen-lockfile'){if(installed)invalid();installed=true;continue;}
  if(!installed||! /^(?:pnpm|node)(?: [A-Za-z0-9_./:@=+-]+)*$/.test(step.run))invalid();checks.push(step.run.split(' '));
 }
 if(!installed||canonicalJson(checks)!==canonicalJson(profile.commands))invalid();
}
export function decodeSandboxPermit(value:unknown,profile:ExecutionProfile,now=Date.now()):SandboxPermit {
 const p=exact(value,['schemaVersion','kind','permitId','repositoryId','proposalDigest','profileDigest','candidateSha','imageUuid','project','expiresAt','maxOperations']) as unknown as SandboxPermit;
 if(p.schemaVersion!==1||p.kind!=='sandbox-permit'||typeof p.permitId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(p.permitId)||p.repositoryId!==profile.provenance.repositoryId||p.proposalDigest!==profile.proposalDigest||p.profileDigest!==jsonDigest(profile)||p.candidateSha!==profile.candidateSha||p.imageUuid!==profile.image.uuid||p.project!==profile.project||typeof p.expiresAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(p.expiresAt)||!Number.isFinite(Date.parse(p.expiresAt))||new Date(p.expiresAt).toISOString().replace('.000Z','Z')!==p.expiresAt||Date.parse(p.expiresAt)<=now||!Number.isSafeInteger(p.maxOperations)||p.maxOperations<2||p.maxOperations>8)throw new Error('sandbox-permit-invalid');return p;
}
export function decodeImageManifest(value:unknown,profile:ExecutionProfile):ImageManifest {
 const m=exact(value,['schemaVersion','kind','toolSourceSha','bundleDigest','nodeVersion','pnpmVersion','lockfileHash','dependencyStoreHash','harnessHash','recipeHash']) as unknown as ImageManifest;
 const expected={schemaVersion:1,kind:'optimization-image',toolSourceSha:profile.provenance.toolSourceSha,bundleDigest:profile.provenance.bundleDigest,nodeVersion:profile.verificationProfile.nodeVersion,pnpmVersion:profile.verificationProfile.pnpmVersion,lockfileHash:profile.provenance.lockfileHash,dependencyStoreHash:profile.image.dependencyStoreHash,harnessHash:profile.image.harnessHash,recipeHash:profile.image.recipeHash};if(canonicalJson(m)!==canonicalJson(expected))invalid();return m;
}
export function compareQuality(base:QualityEvidence,candidate:QualityEvidence):void {
 decodeQualityEvidence(base);decodeQualityEvidence(candidate);
 if(!base.tests.length||!base.coverage.length||base.commandDigest!==candidate.commandDigest||base.tests.some(test=>test.outcome==='failed')||canonicalJson([...base.tests].sort((a,b)=>a.id<b.id?-1:1))!==canonicalJson([...candidate.tests].sort((a,b)=>a.id<b.id?-1:1))||base.coverage.length!==candidate.coverage.length)throw new Error('quality-regression');
 for(const prior of base.coverage){const after=candidate.coverage.find(item=>item.path===prior.path);if(!after)throw new Error('quality-regression');for(const key of ['Statements','Branches','Functions','Lines']as const){const denominator=key.toLowerCase()as 'statements'|'branches'|'functions'|'lines';if(after[denominator]!==prior[denominator]||after[`covered${key}`]<prior[`covered${key}`])throw new Error('quality-regression');}}
}
export function buildSandboxPayload(profile:ExecutionProfile,files:SourceManifest['files'],role:'base'|'candidate'):SandboxPayload {
 const paths=new Set(files.map(file=>file.path));
 if(files.some(file=>file.path==='.home'||file.path.startsWith('.home/')||file.path==='.pnpm-store'||file.path.startsWith('.pnpm-store/'))||paths.has(profile.verificationProfile.testReportPath)||paths.has(profile.verificationProfile.coverageReportPath)||profile.verificationProfile.sourcePaths.some(path=>!paths.has(path)))invalid();
 const workflow=files.find(file=>file.path===profile.provenance.workflowPath);if(!workflow)invalid();
 const payload:SandboxPayload={schemaVersion:1,kind:'sandbox-payload',role,profileDigest:jsonDigest(profile),proposalDigest:profile.proposalDigest,toolSourceSha:profile.provenance.toolSourceSha,bundleDigest:profile.provenance.bundleDigest,imageManifestHash:profile.image.manifestHash,harnessHash:profile.image.harnessHash,sourceDigest:jsonDigest(files.map(({path,mode,hash})=>({path,mode,hash}))),workflowPath:workflow.path,workflowHash:workflow.hash,files,verificationProfile:profile.verificationProfile,expectedQuality:profile.expectedQuality};
 if(Buffer.byteLength(canonicalJson(payload))>16*1024*1024)throw new Error('sandbox-payload-size');return payload;
}
export function decodeHarnessEnvelope(value:unknown,profile:ExecutionProfile,role:'base'|'candidate',sourceDigest:string,workflowHash:string):HarnessEnvelope {
 const commands=completeCommands(profile.verificationProfile);
 const e=exact(value,['schemaVersion','kind','role','profileDigest','proposalDigest','toolSourceSha','bundleDigest','imageManifestHash','harnessHash','sourceDigest','workflowHash','commands','quality','elapsedMs'])as unknown as HarnessEnvelope;
 if(e.schemaVersion!==1||e.kind!=='harness-result'||e.role!==role||e.profileDigest!==jsonDigest(profile)||e.proposalDigest!==profile.proposalDigest||e.toolSourceSha!==profile.provenance.toolSourceSha||e.bundleDigest!==profile.provenance.bundleDigest||e.imageManifestHash!==profile.image.manifestHash||e.harnessHash!==profile.image.harnessHash||e.sourceDigest!==sourceDigest||e.workflowHash!==workflowHash||!Array.isArray(e.commands)||e.commands.length!==commands.length||typeof e.elapsedMs!=='number'||!Number.isFinite(e.elapsedMs)||e.elapsedMs<0||e.elapsedMs>600_000||!e.quality)throw new Error('harness-evidence-invalid');
 for(const [i,raw]of e.commands.entries()){const c=exact(raw,['argv','exitCode','signal','timedOut','truncated','stdoutHash','stderrHash']);if(canonicalJson(c.argv)!==canonicalJson(commands[i])||c.exitCode!==0||c.signal!==null||c.timedOut!==false||c.truncated!==false||!hash(c.stdoutHash)||!hash(c.stderrHash))throw new Error('harness-command-failed');}
 compareQuality(profile.expectedQuality,e.quality);return e;
}
