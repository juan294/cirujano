import { readFile } from 'node:fs/promises';
import { join,dirname,basename } from 'node:path';
import { assertSameProvenance,canonicalJson,decodeArtifact,jsonDigest,parseStrictJson,sha256,type SandboxArtifact } from '@cirujano/core';
import { createSandboxClient,previewSandboxRequest,type SandboxClientOptions,type SandboxCreateIntent,type SandboxRecord,type SandboxObservedOperation,type SandboxResult } from './sandbox.js';
import { buildSandboxPayload,compareQuality,decodeExecutionProfile,decodeHarnessEnvelope,decodeImageManifest,decodeSandboxPermit,validateProfileCommands,type ExecutionProfile,type HarnessEnvelope,type SandboxPayload,type SandboxPermit } from './execution-profile.js';
import { readLocalCandidate } from './candidate-source.js';
import { readProposalContext,copyProposalContext,type ProposalContext } from './propose.js';
import { consumePermit,readPrivateJson,readOptimizationArtifact,scrubOptimizationValue,withOperationStore,type OperationStore } from './store.js';
declare const CIRUJANO_HARNESS_HASH:string|undefined;
export interface VerificationOptions extends Omit<SandboxClientOptions,'project'>{permitLedger?:string}
export interface VerificationDisposition {status:'sandbox-verified'|'failed'|'rejected'|'outcome-unknown';reasonCode:string;artifactPath:string|null;recovery?:string}
interface RoleJournal {createStatus:'intent'|'created'|'failed'|'outcome-unknown';role:'base'|'candidate';payloadDigest:string;intent:SandboxCreateIntent|null;record:SandboxRecord|null;receipt:SandboxObservedOperation|null;envelope:HarnessEnvelope|null;cancelRequested:boolean}
interface PairJournal {schemaVersion:1;kind:'sandbox-pair';proposalDigest:string;profileDigest:string;permitDigest:string;status:'running'|'failed'|'outcome-unknown'|'sandbox-verified';roles:RoleJournal[];startedAt:string;completedAt:string|null;latestArtifact:string|null;artifactDigest:string|null}
interface PairContext {context:ProposalContext;profile:ExecutionProfile;permit:SandboxPermit;payloads:SandboxPayload[];journal:PairJournal}
const terminal=(status:string)=>['SUCCESS','FAILED','CANCELLED'].includes(status);
function exact(value:unknown,keys:string[]):Record<string,unknown>{canonicalJson(value);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw new Error('sandbox-journal-invalid');return value as Record<string,unknown>;}
function reject(reasonCode='sandbox-evidence-rejected'):VerificationDisposition{return{status:'rejected',reasonCode,artifactPath:null};}
async function trustedHarnessHash():Promise<string>{return typeof CIRUJANO_HARNESS_HASH!=='undefined'?CIRUJANO_HARNESS_HASH:sha256(await readFile(new URL('../../../../scripts/optimization/harness.mjs',import.meta.url)));}
async function boundProfile(context:ProposalContext,raw:unknown):Promise<{profile:ExecutionProfile;payloads:SandboxPayload[]}>{
 const profile=decodeExecutionProfile(raw);assertSameProvenance(profile.provenance,context.proposal.provenance);
 if(profile.proposalDigest!==jsonDigest(context.proposal)||canonicalJson(profile.verificationProfile)!==canonicalJson(context.profile)||profile.image.harnessHash!==await trustedHarnessHash()||(context.proposal.candidateSha!==null&&context.proposal.candidateSha!==profile.candidateSha))throw new Error('sandbox-profile-drift');
 const workflow=Buffer.from(context.source.files.find(f=>f.path===context.input.provenance.workflowPath)!.bytesBase64,'base64').toString('utf8');validateProfileCommands(workflow,profile.verificationProfile,profile.provenance.jobId);
 const candidate=await readLocalCandidate(profile.candidateRepository,profile.candidateSha,context.source,context.candidate);
 return{profile,payloads:[buildSandboxPayload(profile,context.source.files,'base'),buildSandboxPayload(profile,candidate,'candidate')]};
}
async function writeJournal(store:OperationStore,journal:PairJournal,options:VerificationOptions):Promise<void>{
 if(canonicalJson(scrubOptimizationValue(journal,[options.iamToken]))!==canonicalJson(journal))throw new Error('sandbox-journal-secret');await store.writeJson('intent.json',journal,{replaceIntent:true});
}
function decodeReceipt(raw:unknown,row:RoleJournal,profile:ExecutionProfile):SandboxObservedOperation {
 const receipt=exact(raw,['id','status','imageUuid','project','disposable','process','usage','createdAt','providerDuration','stdoutHash','stderrHash','stdoutTruncated','stderrTruncated']) as unknown as SandboxObservedOperation;
 if(!row.record||receipt.id!==row.record.id||receipt.imageUuid!==profile.image.uuid||receipt.project!==profile.project||receipt.disposable!==true||!['PENDING','ASSIGNED','EXECUTING','SUCCESS','FAILED','CANCELLED'].includes(receipt.status))throw new Error('sandbox-receipt-drift');
 if(![receipt.stdoutTruncated,receipt.stderrTruncated].every(value=>value===null||typeof value==='boolean'))throw new Error('sandbox-truncation-drift');
 if(receipt.process){const process=exact(receipt.process,['exitCode','signal','timedOut','stopped','continued','coreDump']);if(!Number.isSafeInteger(process.exitCode)||!Number.isSafeInteger(process.signal)||!['timedOut','stopped','continued','coreDump'].every(key=>typeof process[key]==='boolean'))throw new Error('sandbox-process-drift');}
 if(receipt.usage){exact(receipt.usage,['value','unit','currency']);if(!Number.isFinite(receipt.usage.value)||receipt.usage.value<0||receipt.usage.unit!=='undocumented-provider-unit'||receipt.usage.currency!==null)throw new Error('sandbox-usage-drift');}
 return receipt;
}
function acceptResult(row:RoleJournal,result:SandboxResult,profile:ExecutionProfile,payload:SandboxPayload):boolean {
 row.receipt=result.operation;row.envelope=null;
 if(!result.operation||result.operation.status!=='SUCCESS'||!result.operation.process||result.status==='failed'||result.status==='outcome-unknown'||result.stdout===null)return false;
 try{const parsed=parseStrictJson(result.stdout),envelope=decodeHarnessEnvelope(parsed,profile,row.role,payload.sourceDigest,payload.workflowHash);if(result.stdout!==canonicalJson(envelope)+'\n'||result.operation.stdoutHash!==sha256(result.stdout))throw new Error('harness-envelope-bytes');row.envelope=envelope;return true;}catch{return false;}
}
function artifactFor(pair:PairContext):SandboxArtifact {
 const{profile,journal,context}=pair,known=journal.roles.length>0&&journal.roles.every(row=>row.record&&row.receipt&&terminal(row.receipt.status));
 let status:SandboxArtifact['status']=!known&&journal.roles.some(row=>row.intent&&row.createStatus!=='failed')?'outcome-unknown':'failed';
 if(journal.roles.length===2&&journal.roles.every(row=>row.envelope&&row.receipt?.status==='SUCCESS'&&row.receipt.process?.exitCode===0&&row.receipt.process.signal===0&&!row.receipt.process.timedOut&&!row.receipt.process.stopped&&!row.receipt.process.continued&&!row.receipt.process.coreDump)){
  compareQuality(journal.roles[0]!.envelope!.quality!,journal.roles[1]!.envelope!.quality!);status='sandbox-verified';
 }
 const completedAt=status==='outcome-unknown'?null:journal.completedAt;
 const usage=journal.roles.length===2&&journal.roles.every(row=>row.receipt?.usage)?{value:journal.roles.reduce((sum,row)=>sum+row.receipt!.usage!.value,0),unit:'undocumented-provider-unit',currency:null}:null;
 return decodeArtifact('sandbox',{schemaVersion:1,kind:'sandbox',provenance:profile.provenance,candidateSha:profile.candidateSha,patchHash:context.proposal.patchHash,proposalDigest:jsonDigest(context.proposal),status,image:{uuid:profile.image.uuid,digest:profile.image.ociDigest,recipeHash:profile.image.recipeHash,manifestHash:profile.image.manifestHash},operations:journal.roles.flatMap(row=>row.record&&row.receipt?[{id:row.record.id,status:row.receipt.status,role:row.role,exitCode:row.receipt.process?.exitCode??null,signal:row.receipt.process?.signal?String(row.receipt.process.signal):null,timedOut:row.receipt.process?.timedOut??false,truncated:row.receipt.stdoutTruncated===true||row.receipt.stderrTruncated===true}]:[]),networkEnabled:false,baseQuality:journal.roles.find(row=>row.role==='base')?.envelope?.quality??null,candidateQuality:journal.roles.find(row=>row.role==='candidate')?.envelope?.quality??null,startedAt:journal.startedAt,completedAt,elapsedMs:completedAt?Date.parse(completedAt)-Date.parse(journal.startedAt):null,usage,truncated:journal.roles.some(row=>row.receipt?.stdoutTruncated===true||row.receipt?.stderrTruncated===true),cleanupState:known?'disposable-confirmed':'unknown',retainedImage:true});
}
async function finish(store:OperationStore,pair:PairContext,options:VerificationOptions,initial:boolean):Promise<VerificationDisposition>{
 pair.journal.completedAt=new Date((options.now??Date.now)()).toISOString();const artifact=artifactFor(pair);pair.journal.status=artifact.status;
 const name=initial?'sandbox.json':`sandbox-${jsonDigest(artifact)}.json`;
 try{await store.writeJson(name,artifact);}catch(error){if(!(error instanceof Error&&error.message.startsWith('artifact-exists'))||canonicalJson(await readPrivateJson(join(store.directory,name)))!==canonicalJson(artifact))throw error;}
 pair.journal.latestArtifact=name;pair.journal.artifactDigest=jsonDigest(artifact);await writeJournal(store,pair.journal,options);
 const needsInspection=artifact.status==='outcome-unknown'&&pair.journal.roles.some(row=>row.intent&&!row.record&&row.createStatus!=='failed');
 const reasonCode=artifact.status==='sandbox-verified'?'paired-quality-verified':needsInspection?'sandbox-create-id-unavailable-provider-inspection-required':artifact.status==='outcome-unknown'?'sandbox-outcome-unresolved':'sandbox-quality-failed';
 await store.writeJson('operation.json',{schemaVersion:1,kind:'optimization-operation',action:'verify',status:artifact.status,reasonCode,inputDigest:jsonDigest(pair.context.input),nextCommand:'cirujano --help'},{replaceIntent:true});
 return{status:artifact.status,reasonCode,artifactPath:join(store.directory,name),...(needsInspection?{recovery:'Provider inspection is required before a new create. No operation ID was returned; this stage cannot safely look it up or retry.'}:{})};
}
export async function verifyPair(proposalPath:string,profileRaw:unknown,permitRaw:unknown,output:string,options:VerificationOptions):Promise<VerificationDisposition>{
 let pair:PairContext;
 try{const context=await readProposalContext(proposalPath),bound=await boundProfile(context,profileRaw),permit=decodeSandboxPermit(permitRaw,bound.profile,(options.now??Date.now)());pair={context,...bound,permit,journal:{schemaVersion:1,kind:'sandbox-pair',proposalDigest:jsonDigest(context.proposal),profileDigest:jsonDigest(bound.profile),permitDigest:jsonDigest(permit),status:'running',roles:[],startedAt:new Date((options.now??Date.now)()).toISOString(),completedAt:null,latestArtifact:null,artifactDigest:null}};}catch{return reject();}
 try{return await withOperationStore(output,async store=>{
  try{await readPrivateJson(join(store.directory,'intent.json'));return{status:'outcome-unknown',reasonCode:'existing-sandbox-intent',artifactPath:null}as VerificationDisposition;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await copyProposalContext(store,pair.context);await store.writeJson('execution-profile.json',pair.profile);await store.writeJson('sandbox-permit.json',pair.permit);await writeJournal(store,pair.journal,options);
  const client=createSandboxClient({...options,project:pair.profile.project,authorityDigest:jsonDigest(pair.permit)});const image=await client.inspectImage(pair.profile);
  if(image.status!=='verified'||!image.receipt||!image.manifestBytes){pair.journal.status='failed';return await finish(store,pair,options,true);}
  decodeImageManifest(parseStrictJson(new TextDecoder('utf8',{fatal:true}).decode(image.manifestBytes)),pair.profile);await store.writeJson('image-readback.json',image.receipt);
  for(const payload of pair.payloads){const row:RoleJournal={createStatus:'intent',role:payload.role,payloadDigest:jsonDigest(payload),intent:null,record:null,receipt:null,envelope:null,cancelRequested:false};pair.journal.roles.push(row);
   const created=await client.create(payload,pair.profile.image.uuid,pair.profile.maxLayerBytes,async intent=>{row.intent=intent;await writeJournal(store,pair.journal,options);await consumePermit({kind:'sandbox',digest:jsonDigest(pair.permit),operation:jsonDigest({permitDigest:jsonDigest(pair.permit),role:row.role,attemptId:intent.attemptId}),maximum:pair.permit.maxOperations,...(options.permitLedger?{ledger:options.permitLedger}:{})});},async record=>{row.record=record;await writeJournal(store,pair.journal,options);});
   row.createStatus=created.status;await writeJournal(store,pair.journal,options);
   if(created.status!=='created'||!created.record){pair.journal.status=created.status==='outcome-unknown'?'outcome-unknown':'failed';break;}
   let result=await client.poll(created.record);
   if(result.status==='outcome-unknown'){result=await client.cancel(created.record,async()=>{row.cancelRequested=true;await writeJournal(store,pair.journal,options);});}
   if(!acceptResult(row,result,pair.profile,payload)){pair.journal.status=result.status==='outcome-unknown'?'outcome-unknown':'failed';await writeJournal(store,pair.journal,options);break;}
   await writeJournal(store,pair.journal,options);
  }
  return finish(store,pair,options,true);
 });}catch{return{status:pair.journal.roles.some(row=>row.intent&&row.createStatus!=='failed'&&(!row.receipt||!terminal(row.receipt.status)))?'outcome-unknown':'failed',reasonCode:'sandbox-stage-interrupted',artifactPath:null};}
}
async function readPair(directory:string):Promise<PairContext>{
 const context=await readProposalContext(join(directory,'proposal.json')),{profile,payloads}=await boundProfile(context,await readPrivateJson(join(directory,'execution-profile.json'))),permit=decodeSandboxPermit(await readPrivateJson(join(directory,'sandbox-permit.json')),profile,0);
 const journal=exact(await readPrivateJson(join(directory,'intent.json')),['schemaVersion','kind','proposalDigest','profileDigest','permitDigest','status','roles','startedAt','completedAt','latestArtifact','artifactDigest'])as unknown as PairJournal;
 if(journal.schemaVersion!==1||journal.kind!=='sandbox-pair'||journal.proposalDigest!==jsonDigest(context.proposal)||journal.profileDigest!==jsonDigest(profile)||journal.permitDigest!==jsonDigest(permit)||!['running','failed','outcome-unknown','sandbox-verified'].includes(journal.status)||!Array.isArray(journal.roles)||journal.roles.length>2||!Number.isFinite(Date.parse(journal.startedAt)))throw new Error('sandbox-journal-drift');
 for(const[i,row]of journal.roles.entries()){exact(row,['createStatus','role','payloadDigest','intent','record','receipt','envelope','cancelRequested']);const payload=payloads[i]!;if(!['intent','created','failed','outcome-unknown'].includes(row.createStatus)||row.role!==payload.role||row.payloadDigest!==jsonDigest(payload)||typeof row.cancelRequested!=='boolean')throw new Error('sandbox-role-drift');
  if(row.intent){exact(row.intent,['schemaVersion','kind','attemptId','requestHash','payloadDigest','imageUuid','project','createdAt']);const preview=previewSandboxRequest(payload,profile.image.uuid,profile.maxLayerBytes,jsonDigest(permit));if(row.intent.schemaVersion!==1||row.intent.kind!=='sandbox-intent'||row.intent.requestHash!==preview.requestHash||row.intent.payloadDigest!==preview.payloadDigest||row.intent.imageUuid!==profile.image.uuid||row.intent.project!==profile.project||row.intent.attemptId!==jsonDigest({requestHash:row.intent.requestHash,payloadDigest:row.intent.payloadDigest,imageUuid:profile.image.uuid,project:profile.project}))throw new Error('sandbox-intent-drift');}
  if(row.record){exact(row.record,['id','url','imageUuid','project','requestHash','createdAt']);if(!row.intent||row.record.requestHash!==row.intent.requestHash||row.record.imageUuid!==profile.image.uuid||row.record.project!==profile.project||row.record.createdAt!==row.intent.createdAt||! /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.record.id)||row.record.url!==`https://api.tokenfactory.nebius.com/sandboxes/v1/operations/${row.record.id}`)throw new Error('sandbox-record-drift');}
  if(row.receipt)decodeReceipt(row.receipt,row,profile);
  if(row.envelope){decodeHarnessEnvelope(row.envelope,profile,row.role,payload.sourceDigest,payload.workflowHash);if(!row.receipt||row.receipt.status!=='SUCCESS'||row.receipt.stdoutHash!==sha256(canonicalJson(row.envelope)+'\n'))throw new Error('sandbox-envelope-drift');}
 }
 if(new Set(journal.roles.flatMap(row=>row.record?[row.record.id]:[])).size!==journal.roles.filter(row=>row.record).length)throw new Error('sandbox-duplicate-operation');return{context,profile,permit,payloads,journal};
}
async function readBoundSandboxArtifact(path:string,pair:PairContext):Promise<SandboxArtifact>{
 const sandbox=await readOptimizationArtifact('sandbox',path);
 const readback=exact(await readPrivateJson(join(dirname(path),'image-readback.json')),['imageUuid','importOperationId','registryReference','approvedOciDigest','harnessHash','manifestHash','readAt']);
 if(readback.imageUuid!==pair.profile.image.uuid||readback.importOperationId!==pair.profile.image.importOperationId||readback.registryReference!==pair.profile.image.registryReference||readback.approvedOciDigest!==pair.profile.image.ociDigest||readback.harnessHash!==pair.profile.image.harnessHash||readback.manifestHash!==pair.profile.image.manifestHash||!Number.isFinite(Date.parse(String(readback.readAt)))||pair.journal.latestArtifact!==basename(path)||pair.journal.artifactDigest!==jsonDigest(sandbox)||canonicalJson(sandbox)!==canonicalJson(artifactFor(pair)))throw new Error('sandbox-artifact-drift');return sandbox;
}
export async function readSandboxContext(path:string):Promise<PairContext&{sandbox:SandboxArtifact}>{
 const pair=await readPair(dirname(path));return{...pair,sandbox:await readBoundSandboxArtifact(path,pair)};
}
async function recover(directory:string,options:VerificationOptions,cancelPermit?:unknown):Promise<VerificationDisposition>{
 try{return await withOperationStore(directory,async store=>{const pair=await readPair(store.directory);if(cancelPermit!==undefined)decodeSandboxPermit(cancelPermit,pair.profile,(options.now??Date.now)());
  if(pair.journal.latestArtifact){const existing=await readBoundSandboxArtifact(join(store.directory,pair.journal.latestArtifact),pair);if(existing.status==='sandbox-verified')return{status:'sandbox-verified',reasonCode:'paired-quality-verified',artifactPath:join(store.directory,pair.journal.latestArtifact)}as VerificationDisposition;}
  const client=createSandboxClient({...options,project:pair.profile.project,authorityDigest:jsonDigest(pair.permit)});
  for(const[i,row]of pair.journal.roles.entries()){if(!row.record)continue;if(row.receipt&&terminal(row.receipt.status)&&row.envelope)continue;
   if(cancelPermit!==undefined){const observed=await client.read(row.record);if(!observed.operation)throw new Error('sandbox-operation-ownership-unverified');}
   const result=cancelPermit===undefined?await client.read(row.record):await client.cancel(row.record,async()=>{row.cancelRequested=true;await writeJournal(store,pair.journal,options);});acceptResult(row,result,pair.profile,pair.payloads[i]!);
  }
  return finish(store,pair,options,false);
 });}catch{return reject('sandbox-recovery-rejected');}
}
export const reconcileSandbox=(directory:string,options:VerificationOptions)=>recover(directory,options);
export const cancelSandbox=(directory:string,permit:unknown,options:VerificationOptions)=>recover(directory,options,permit);
