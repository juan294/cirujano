import { dirname, join, resolve } from 'node:path';
import { jsonDigest, type InputArtifact, type PushInputArtifact } from '@cirujano/core';
import { diagnoseOptimization, type DiagnosisPreview } from './diagnose.js';
import { decodeInferenceConfig } from './nebius.js';
import { readPrivateJson } from './store.js';

export function record(value: unknown): Record<string,unknown> { if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('invalid-proposal-evidence'); return value as Record<string,unknown>; }
export function exactKeys(value:Record<string,unknown>,keys:string[]):void { if(Object.keys(value).sort().join(',')!==keys.sort().join(',')) throw new Error('invalid-proposal-evidence'); }
interface JournalBinding { diagnosis: { status: string }; inference: { startedAt: string }; preview: DiagnosisPreview }

/** The retained inference intent must name exactly this request, receipt and diagnosis, for either family. */
export function assertInferenceJournal(value:unknown,{diagnosis,inference,preview}:JournalBinding):Record<string,unknown> {
  const intent=record(value);
  exactKeys(intent,['schemaVersion','kind','attemptId','permitId','permitDigest','inputDigest','requestHash','requestBytes','model','endpoint','startedAt','status','reasonCode','inferenceReceiptDigest','diagnosisDigest']);
  if(intent.schemaVersion!==1||intent.kind!=='inference-intent'||intent.status!==diagnosis.status||intent.reasonCode!==(diagnosis.status==='proposal'?'model-proposal-validated':'model-abstained')||intent.inputDigest!==preview.inputDigest||intent.requestHash!==preview.requestHash||intent.requestBytes!==preview.requestBytes||intent.model!==preview.model||intent.endpoint!==preview.endpoint||intent.startedAt!==inference.startedAt||intent.inferenceReceiptDigest!==jsonDigest(inference)||intent.diagnosisDigest!==jsonDigest(diagnosis)||typeof intent.permitDigest!=='string'||!/^[a-f0-9]{64}$/.test(intent.permitDigest)||typeof intent.permitId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(intent.permitId)||intent.attemptId!==jsonDigest({permitDigest:intent.permitDigest,inputDigest:preview.inputDigest,requestHash:preview.requestHash})) throw new Error('inference-journal-drift');
  return intent;
}
/** The retained diagnose operation state must match the diagnosis and the input it was made from. */
export function assertDiagnosisState(value:unknown,status:string,inputDigest:string):Record<string,unknown> {
  const diagnosisState=record(value);
  exactKeys(diagnosisState,['schemaVersion','kind','action','status','reasonCode','nextCommand','inputDigest']);
  if(diagnosisState.schemaVersion!==1||diagnosisState.kind!=='optimization-operation'||diagnosisState.action!=='diagnose'||diagnosisState.status!==status||diagnosisState.inputDigest!==inputDigest) throw new Error('diagnosis-journal-drift');
  return diagnosisState;
}

/** How one family reads and binds its retained artifacts; the binding order below is shared. */
export interface DiagnosisFamily<C extends { input: InputArtifact | PushInputArtifact; source: unknown }, D extends { status: string; inferenceReceiptDigest: string }, R extends { status: string; requestHash: string; requestedModel: string; startedAt: string }> {
  readContext(inputPath: string): Promise<C>;
  readDiagnosis(path: string): Promise<D>;
  readInference(path: string): Promise<R>;
  /** Same provenance across input and receipt, and evidence the input supplied. */
  bind(context: C, diagnosis: D, inference: R): void;
}
/** The diagnosis, its receipt and its journal all bind the retained input, for either family. */
export async function readBoundDiagnosis<C extends { input: InputArtifact | PushInputArtifact; source: unknown }, D extends { status: string; inferenceReceiptDigest: string }, R extends { status: string; requestHash: string; requestedModel: string; startedAt: string }>(family: DiagnosisFamily<C, D, R>, inputPath: string, diagnosisPath: string, stateFile = 'operation.json', intentFile = 'intent.json'): Promise<C & { diagnosis: D; inference: R; config: unknown; intent: unknown; diagnosisState: unknown }> {
  const context=await family.readContext(inputPath),directory=dirname(diagnosisPath);
  const retained=resolve(inputPath)===resolve(join(directory,'input.json'))?context:await family.readContext(join(directory,'input.json'));
  if(jsonDigest(retained.input)!==jsonDigest(context.input)||jsonDigest(retained.source)!==jsonDigest(context.source)) throw new Error('diagnosis-source-drift');
  const diagnosis=await family.readDiagnosis(diagnosisPath),inference=await family.readInference(join(directory,'inference.json'));
  family.bind(context,diagnosis,inference);
  if(inference.status!=='completed'||diagnosis.inferenceReceiptDigest!==jsonDigest(inference)) throw new Error('invalid-inference-receipt');
  const config=decodeInferenceConfig(await readPrivateJson(join(directory,'config.json'))),preview=(await diagnoseOptimization(context.input,config,undefined)).preview;
  if(!preview||inference.requestHash!==preview.requestHash||inference.requestedModel!==config.model) throw new Error('inference-request-drift');
  const intent=assertInferenceJournal(await readPrivateJson(join(directory,intentFile)),{diagnosis,inference,preview});
  const diagnosisState=assertDiagnosisState(await readPrivateJson(join(directory,stateFile)),diagnosis.status,jsonDigest(context.input));
  return {...context,diagnosis,inference,config,intent,diagnosisState};
}
