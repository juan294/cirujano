/** Private evaluation subprocess. This is neither the published CLI nor an optimizer replacement. */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, decodeFamilyArtifact, jsonDigest, type InputArtifact, type PushInputArtifact } from '@cirujano/core';
import { consumePermit, readPrivateJson } from '../optimization/store.js';
import { diagnoseOptimization } from '../optimization/diagnose.js';
import { assertInferenceAuthority, decodeInferencePermit, DEFAULT_INFERENCE_ENDPOINT, DEFAULT_INFERENCE_MODEL, type InferencePermit } from '../optimization/nebius.js';
import { enrichOperation, readEnrichmentOperation } from './enrich.js';
import { PRICE_QUOTE } from './inference-contracts.js';
import { JevTransportError, sendJev, validateJevApiKey } from './jev.js';
import { decodeAdvisoryPermit, permitDigest } from './permit.js';
import { prepareNumericJev, numericShadowPolicy, NUMERIC_SHADOW_VERSION } from './numeric-shadow.js';
import { readPreparedOperation } from './prepare.js';
import { freshOperation } from './storage.js';

const ledger=join(homedir(),'.local/share/cirujano/advisory/permits');
const config={schemaVersion:1 as const,model:DEFAULT_INFERENCE_MODEL,endpoint:DEFAULT_INFERENCE_ENDPOINT};
const sealed=<T extends object>(content:T)=>({...content,digest:jsonDigest(content)});
interface Replay {response?:unknown;httpStatus?:number;failure?:'transport-unknown';crash?:string}
interface Control {action:string;input?:unknown;id?:string;request?:unknown;requestDirectory?:string;permit?:unknown;output?:string;mode?:'native'|'replay';replay?:Replay;replayLedger?:string;authorizationDigest?:string;experimentDigest?:string;priceQuote?:{source:string;date:string;inputUsdPerMillion:number;outputUsdPerMillion:number}}
function inputValue(value:unknown):InputArtifact|PushInputArtifact{return decodeFamilyArtifact('input',value);}
function replayFetcher(replay:Replay,provider:'jev'|'nebius'):typeof fetch{return async(_url,init)=>{
 if(provider==='nebius'&&init?.method==='GET')return new Response(JSON.stringify({data:[{id:DEFAULT_INFERENCE_MODEL}]}));
 if(replay.failure)throw new Error('evaluation-injected-transport-unknown');
 return new Response(JSON.stringify(replay.response??{}),{status:replay.httpStatus??200,headers:{'Content-Type':'application/json'}});
};}
async function nemotronPreview(input:InputArtifact|PushInputArtifact,price:NonNullable<Control['priceQuote']>){
 const preview=(await diagnoseOptimization(input,config,undefined)).preview;if(!preview)return null;
 let body='';
 const capture:typeof fetch=async(_url,init)=>{if(init?.method==='GET')return new Response(JSON.stringify({data:[{id:DEFAULT_INFERENCE_MODEL}]}));body=String(init?.body??'');throw new Error('evaluation-preview-captured-without-network');};
 // Only capture the existing owned request constructor. No response or optimizer receipt is fabricated or retained.
 const previewPermit={kind:'inference-permit',permitId:'evaluation-preview-only',repositoryId:input.provenance.repositoryId,inputDigest:jsonDigest(input),...config,expiresAt:'2099-01-01T00:00:00Z',maxRequests:1,maxCompletionTokens:2048,priceBasis:null};
 await diagnoseOptimization(input,config,previewPermit,{apiKey:'evaluation-preview-no-network',fetch:capture,beforePost:async()=>{}});
 if(!body||preview.requestBytes!==Buffer.byteLength(body))throw new Error('evaluation-preview-mismatch');
 const {sha256}=await import('@cirujano/core');if(sha256(body)!==preview.requestHash)throw new Error('evaluation-preview-mismatch');
 const content={...preview,requestBody:body,inputDigests:[jsonDigest(input)],questionSetVersion:'existing-optimizer-diagnosis',policyVersion:NUMERIC_SHADOW_VERSION,priceQuote:price,estimatedReservationUsd:(preview.requestBytes*2*price.inputUsdPerMillion+2048*price.outputUsdPerMillion)/1_000_000};
 return sealed({...content,kind:'nebius-numeric-shadow-request' as const});
}
function responsePayload(value:Record<string,unknown>,entry:Record<string,unknown>,mode:string){const payload=value.payload??{};return {...value,model:entry.model,requestHash:entry.requestHash,inputDigests:entry.inputDigests,questionSetVersion:entry.questionSetVersion,policyVersion:entry.policyVersion,resultHash:jsonDigest(payload),mode};}
export async function runEvaluationControl(control:Control):Promise<unknown>{
 const replay=control.mode==='replay',permitLedger=replay?control.replayLedger:ledger;
 if(replay&&!permitLedger)throw new Error('evaluation-replay-ledger-required');
 if(control.action==='authorize-batch'){
  if(!control.authorizationDigest||!control.experimentDigest)throw new Error('evaluation-invalid-authorization');
  await consumePermit({kind:'inference',digest:jsonDigest({namespace:'advisory-evaluation-batch-v1',authorizationDigest:control.authorizationDigest}),operation:control.experimentDigest,maximum:1,...(permitLedger?{ledger:permitLedger}:{})});return {status:'reserved',mode:replay?'replay':'native'};
 }
 if(control.action==='prepare-numeric'){
  const input=inputValue(control.input),policy=numericShadowPolicy(input);if(policy.decision==='unsupported')return {policy,jev:null,nemotron:null};
  if(!control.priceQuote)throw new Error('evaluation-price-quote-required');return {policy,jev:prepareNumericJev(input),nemotron:await nemotronPreview(input,control.priceQuote)};
 }
 if(control.action==='execute-advisory'||control.action==='validate-advisory'){
  if(!control.requestDirectory)throw new Error('evaluation-invalid-control');
  const actualContext=await readPreparedOperation(control.requestDirectory);
  if(canonicalJson(control.request)!==canonicalJson(actualContext.prepared))throw new Error('evaluation-advisory-request-drift');
  if(control.action==='validate-advisory'){decodeAdvisoryPermit(control.permit,actualContext.prepared);validateJevApiKey(replay?'evaluation-replay-key':process.env.TYPESAFE_API_KEY);return {status:'validated'};}
  if(!control.requestDirectory||!control.output)throw new Error('evaluation-invalid-control');
  const receipt=await enrichOperation(control.requestDirectory,control.permit,control.output,{apiKey:replay?'evaluation-replay-key':process.env.TYPESAFE_API_KEY??'',...(replay?{fetch:replayFetcher(control.replay??{},'jev'),permitLedger:permitLedger!,checkpoint:async stage=>{if(control.replay?.crash===stage)throw new Error('evaluation-replay-crash');}}:{})});
  const metadata=actualContext.prepared as unknown as Record<string,unknown>;return responsePayload({status:receipt.status,payload:{receiptDigest:receipt.digest},latencyMs:receipt.latencyMs,costUsd:receipt.costUsd,inputTokens:receipt.inputTokens,outputTokens:receipt.outputTokens,providerPosts:1,receiptPath:join(control.output,'receipt.json')},metadata,replay?'replay':'native');
 }
 if(control.action==='inspect-advisory'){
  if(!control.requestDirectory)throw new Error('evaluation-invalid-control');const result=await readEnrichmentOperation(control.requestDirectory);return {prepared:result.prepared,receipt:result.receipt,response:result.response};
 }
 if((control.action!=='execute-numeric'&&control.action!=='validate-numeric')||(!control.output&&control.action==='execute-numeric')||!control.request)throw new Error('evaluation-invalid-control');
 const input=inputValue(control.input),request=control.request as Record<string,unknown>;
 if(request.kind==='advisory-numeric-shadow-request'){
  const prepared=prepareNumericJev(input);if(canonicalJson(request)!==canonicalJson(prepared))throw new Error('evaluation-numeric-request-drift');
  const permit=decodeAdvisoryPermit(control.permit,prepared);const apiKey=replay?'evaluation-replay-key':process.env.TYPESAFE_API_KEY;validateJevApiKey(apiKey);if(control.action==='validate-numeric')return {status:'validated'};
  return freshOperation(control.output!,async store=>{
   await store.writeText('input.json',canonicalJson(input));await store.writeText('request.json',canonicalJson(prepared));await store.writeText('permit.json',canonicalJson(permit));
   await consumePermit({kind:'inference',digest:permitDigest(permit),operation:`numeric-shadow:${prepared.requestHash}`,maximum:1,...(permitLedger?{ledger:permitLedger}:{})});
   const intent=sealed({schemaVersion:1,kind:'numeric-shadow-intent',requestHash:prepared.requestHash,inputDigest:prepared.inputDigest,permitDigest:permitDigest(permit),mode:replay?'replay':'native'});await store.writeText('intent.json',canonicalJson(intent));if(control.replay?.crash==='after-intent')throw new Error('evaluation-replay-crash');
   let receipt:Record<string,unknown>;
   try{const result=await sendJev(prepared.requestBody,prepared.body,{apiKey,...(replay?{fetch:replayFetcher(control.replay??{},'jev')}:{})});await store.writeText('response.json',result.responseText);const answer=result.response.answers.material!;if(answer.type!=='noul')throw new Error('evaluation-invalid-numeric-answer');receipt={status:'completed',payload:{decision:answer.noul>=0.8?'proposal':answer.noul<=0.2?'abstain':'uncertain',probability:answer.noul},responseHash:result.responseHash,latencyMs:result.latencyMs,inputTokens:result.response.usage.input_tokens,outputTokens:result.response.usage.output_tokens,costUsd:result.response.usage.input_tokens*PRICE_QUOTE.inputUsdPerMillion/1_000_000};}
   catch(error){if(!(error instanceof JevTransportError))throw error;receipt={status:error.status,payload:{decision:'unavailable'},reasonCode:error.reasonCode,responseHash:error.responseHash,latencyMs:null,inputTokens:null,outputTokens:null,costUsd:null};}
   const result=sealed(responsePayload({...receipt,providerPosts:1,intentDigest:intent.digest},request,replay?'replay':'native'));await store.writeText('receipt.json',canonicalJson(result));return result;
  });
 }
 if(request.kind!=='nebius-numeric-shadow-request'||!control.priceQuote)throw new Error('evaluation-invalid-numeric-request');
 const expected=await nemotronPreview(input,control.priceQuote);if(canonicalJson(request)!==canonicalJson(expected))throw new Error('evaluation-numeric-request-drift');
 const permit:InferencePermit=decodeInferencePermit(control.permit);assertInferenceAuthority(permit,config,input as InputArtifact,Number(request.requestBytes),new Date());
 const apiKey=replay?'evaluation-replay-key':process.env.NEBIUS_API_KEY;if(!apiKey||!/^[\x21-\x7e]{1,2048}$/u.test(apiKey))throw new Error('evaluation-key-required');if(control.action==='validate-numeric')return {status:'validated'};
 return freshOperation(control.output!,async store=>{
  await store.writeText('input.json',canonicalJson(input));await store.writeText('request.json',canonicalJson(request));await store.writeText('permit.json',canonicalJson(permit));let posts=0;
  const external=replay?replayFetcher(control.replay??{},'nebius'):fetch;
  const fetcher:typeof fetch=async(url,init)=>{if(init?.method==='POST')posts++;return external(url,init);};
  const result=await diagnoseOptimization(input,config,permit,{apiKey,fetch:fetcher,timeoutMs:15000,beforePost:async intent=>{
   await consumePermit({kind:'inference',digest:permitDigest(permit),operation:`numeric-shadow:${String(request.requestHash)}`,maximum:1,...(permitLedger?{ledger:permitLedger}:{})});await store.writeText('intent.json',canonicalJson(intent));if(control.replay?.crash==='after-intent')throw new Error('evaluation-replay-crash');
  }});
  await store.writeText('optimizer-result.json',canonicalJson(result));const inference=result.inference;
  const output=responsePayload({status:inference?.status==='outcome-unknown'?'outcome-unknown':inference?.status==='completed'?'completed':'unavailable',payload:{decision:result.status,acceptedUnsafe:0},latencyMs:inference?.latencyMs??null,costUsd:inference?.cost?.amount??null,inputTokens:inference?.usage?.promptTokens??null,outputTokens:inference?.usage?.completionTokens??null,responseHash:inference?.responseHash??null,providerPosts:posts},request,replay?'replay':'native');
  await store.writeText('receipt.json',canonicalJson(sealed(output)));return output;
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const value=await readPrivateJson(resolve(process.argv[2]??''),8*1024*1024);const result=await runEvaluationControl(value as Control);process.stdout.write(JSON.stringify(result)+'\n');}
 catch(error){process.stderr.write(error instanceof Error&&/^[a-z0-9-]+$/u.test(error.message)?error.message+'\n':'evaluation-worker-failed\n');process.exitCode=1;}
}
