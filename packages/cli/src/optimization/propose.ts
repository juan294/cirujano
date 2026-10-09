import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertSameProvenance, canonicalJson, createPnpmCachePatch, decodeArtifact, jsonDigest, sha256, validateCacheOnlyChange, validateDiagnosisEvidence, type ProposalArtifact, type DiagnosisArtifact, type InferenceArtifact, type PnpmCachePatch } from '@cirujano/core';
import type { CliIo } from '../cli.js';
import type { OptimizeArguments } from './arguments.js';
import { exactKeys, readBoundDiagnosis, record, type DiagnosisFamily } from './diagnosis-journal.js';
import { readRetainedOptimizationContext } from './input-context.js';
import { readOptimizationArtifact, readPrivateJson, readPrivateText, withOperationStore, type OperationStore } from './store.js';

type InputContext = Awaited<ReturnType<typeof readRetainedOptimizationContext>>;
interface DiagnosisContext extends InputContext { diagnosis: DiagnosisArtifact; inference: InferenceArtifact; config: unknown; intent: unknown; diagnosisState: unknown }
export interface ProposalContext extends DiagnosisContext { proposal: ProposalArtifact; candidate: string; patch: string }
const preconditions = ['exact-retained-source', 'verified-setup-node-v7', 'timed-frozen-pnpm-install', 'no-step-output-consumers', 'unchanged-command-and-quality-profile'];
function workflow(context:InputContext):string { return Buffer.from(context.source.files.find(file=>file.path===context.input.provenance.workflowPath)!.bytesBase64,'base64').toString('utf8'); }
function editor(context:InputContext):PnpmCachePatch { return createPnpmCachePatch(workflow(context),{provenance:context.input.provenance,receipt:context.receipt,rootLockfile:true,timedBaseline:context.input.baselines.length>0,requiredChecks:context.input.requiredChecks,verificationProfilePresent:true}); }

const cacheDiagnosis:DiagnosisFamily<InputContext,DiagnosisArtifact,InferenceArtifact>={
  readContext:readRetainedOptimizationContext,
  readDiagnosis:path=>readOptimizationArtifact('diagnosis',path),
  readInference:path=>readOptimizationArtifact('inference',path),
  bind:(context,diagnosis,inference)=>{assertSameProvenance(context.input.provenance,inference.provenance);validateDiagnosisEvidence(diagnosis,context.input);},
};
export function readDiagnosisContext(inputPath:string,diagnosisPath:string,stateFile='operation.json',intentFile='intent.json'):Promise<DiagnosisContext> {
  return readBoundDiagnosis(cacheDiagnosis,inputPath,diagnosisPath,stateFile,intentFile);
}
function proposalFor(context:DiagnosisContext,patch:PnpmCachePatch,candidateSha:string|null=null):ProposalArtifact {
  if(context.diagnosis.status!=='proposal'||patch.status!=='proposed') throw new Error('model-proposal-required');
  return decodeArtifact('proposal',{schemaVersion:1,kind:'proposal',provenance:context.input.provenance,status:'proposed',operation:context.diagnosis.operation,candidateSha,candidateWorkflowHash:patch.afterHash,patchHash:sha256(patch.patch),beforeStructuralDigest:patch.beforeStructuralDigest,afterStructuralDigest:patch.afterStructuralDigest,permittedDiff:{cache:'pnpm',cacheDependencyPath:'pnpm-lock.yaml'},preconditions,verificationProfile:context.profile,diagnosisDigest:jsonDigest(context.diagnosis)});
}
function patchReceipt(context:DiagnosisContext,proposal:ProposalArtifact,patch:PnpmCachePatch):unknown {
  return {schemaVersion:1,kind:'patch-receipt',inputDigest:jsonDigest(context.input),diagnosisDigest:jsonDigest(context.diagnosis),inferenceDigest:jsonDigest(context.inference),proposalDigest:jsonDigest(proposal),beforeHash:patch.beforeHash,afterHash:patch.afterHash,patchHash:sha256(patch.patch)};
}
export async function copyInputContext(store:OperationStore,context:InputContext):Promise<void> {
  await store.writeText('source.json',canonicalJson(context.source));await store.writeJson('action-receipt.json',context.receipt);await store.writeArtifact('input',context.input);await store.writeJson('collection-receipt.json',context.collectionReceipt);
}
async function copyDiagnosisContext(store:OperationStore,context:DiagnosisContext):Promise<void> {
  await copyInputContext(store,context);await store.writeJson('config.json',context.config);await store.writeArtifact('diagnosis',context.diagnosis);await store.writeArtifact('inference',context.inference);await store.writeJson('diagnosis-intent.json',context.intent);await store.writeJson('diagnosis-state.json',context.diagnosisState);
}
export async function copyProposalContext(store:OperationStore,context:ProposalContext):Promise<void> {
  await copyDiagnosisContext(store,context);await store.writeArtifact('proposal',context.proposal);await store.writeText('candidate.yml',context.candidate);await store.writeText('workflow.patch',context.patch);await store.writeJson('patch-receipt.json',patchReceipt(context,context.proposal,editor(context)));
}
async function readCopiedDiagnosisContext(directory:string):Promise<DiagnosisContext> {
  return readDiagnosisContext(join(directory,'input.json'),join(directory,'diagnosis.json'),'diagnosis-state.json','diagnosis-intent.json');
}

export async function readProposalContext(proposalPath:string):Promise<ProposalContext> {
  const directory=dirname(proposalPath),context=await readCopiedDiagnosisContext(directory),proposal=await readOptimizationArtifact('proposal',proposalPath),candidate=await readPrivateText(join(directory,'candidate.yml')),patch=await readPrivateText(join(directory,'workflow.patch'));
  const expected=editor(context);validateCacheOnlyChange(workflow(context),candidate,context.input.provenance.jobId,context.input.provenance.stepIndex);
  if(candidate!==expected.candidate||patch!==expected.patch||canonicalJson(proposal)!==canonicalJson(proposalFor(context,expected,proposal.candidateSha))||canonicalJson(await readPrivateJson(join(directory,'patch-receipt.json')))!==canonicalJson(patchReceipt(context,proposal,expected))) throw new Error('proposal-artifact-drift');
  return {...context,proposal,candidate,patch};
}
const quote=(value:string)=>`'${value.replace(/'/g,"'\\''")}'`;
function emit(args:OptimizeArguments,io:CliIo,status:string,reasonCode:string,nextCommand='cirujano --help'):void { io.stdout(args.format==='json'?`${JSON.stringify({status,reasonCode,nextCommand})}\n`:`${status}: ${reasonCode}\nNext: ${nextCommand}\n`); }
export async function runPropose(args:OptimizeArguments,io:CliIo):Promise<0|1> {
  try {
    const inputPath=args.flags.input,diagnosisPath=args.flags.diagnosis,output=args.flags.output;
    if(typeof inputPath!=='string'||typeof diagnosisPath!=='string'||typeof output!=='string') throw new Error('proposal-arguments-invalid');
    const inputContext=await readRetainedOptimizationContext(inputPath);
    const diagnosisContext=inputContext.input.status==='no-change'?null:await readDiagnosisContext(inputPath,diagnosisPath);
    const context=diagnosisContext??inputContext;
    const disposition=inputContext.input.status==='no-change'?'no-change':diagnosisContext?.diagnosis.status==='abstain'?'abstain':'proposed';
    let nextCommand='cirujano --help';
    await withOperationStore(output,async store=>{
      await store.writeJson('local-stage.json',{schemaVersion:1,kind:'proposal-stage',status:'local-only',inputDigest:jsonDigest(context.input)});
      if(disposition==='proposed') nextCommand=`cirujano optimize status --operation ${quote(await realpath(store.directory))}`;
      if(diagnosisContext) await copyDiagnosisContext(store,diagnosisContext);else await copyInputContext(store,context);
      if(disposition==='proposed'&&diagnosisContext){const generated=editor(diagnosisContext),proposal=proposalFor(diagnosisContext,generated);await store.writeText('workflow.patch',generated.patch);await store.writeText('candidate.yml',generated.candidate);await store.writeJson('patch-receipt.json',patchReceipt(diagnosisContext,proposal,generated));await store.writeArtifact('proposal',proposal);}
      await store.writeJson('operation.json',{schemaVersion:1,kind:'optimization-operation',action:'propose',status:disposition,reasonCode:disposition==='proposed'?'cache-only-proposal':disposition==='abstain'?'model-abstained':'already-cached-no-change',nextCommand,inputDigest:jsonDigest(context.input)});
    });
    emit(args,io,disposition,disposition==='proposed'?'cache-only-proposal':disposition==='abstain'?'model-abstained':'already-cached-no-change',nextCommand);return 0;
  } catch {emit(args,io,'rejected','proposal-evidence-rejected');return 1;}
}
export async function readProposalStatus(directory:string):Promise<{status:string;reasonCode:string;nextCommand:string}> {
  const state=record(await readPrivateJson(join(directory,'operation.json')));exactKeys(state,['schemaVersion','kind','action','status','reasonCode','nextCommand','inputDigest']);
  const context=await readRetainedOptimizationContext(join(directory,'input.json'));
  if(state.schemaVersion!==1||state.kind!=='optimization-operation'||state.action!=='propose'||state.inputDigest!==jsonDigest(context.input)) throw new Error('proposal-state-invalid');
  if(state.status==='proposed') {await readProposalContext(join(directory,'proposal.json'));if(state.reasonCode!=='cache-only-proposal'||state.nextCommand!==`cirujano optimize status --operation ${quote(await realpath(directory))}`) throw new Error('proposal-state-invalid');}
  else if(state.status==='abstain'){if((await readCopiedDiagnosisContext(directory)).diagnosis.status!=='abstain'||state.reasonCode!=='model-abstained'||state.nextCommand!=='cirujano --help')throw new Error('proposal-state-invalid');}
  else if(state.status==='no-change'){if(context.input.status!=='no-change'||state.reasonCode!=='already-cached-no-change'||state.nextCommand!=='cirujano --help')throw new Error('proposal-state-invalid');}
  else throw new Error('proposal-state-invalid');
  return {status:state.status as string,reasonCode:state.reasonCode as string,nextCommand:state.nextCommand as string};
}
