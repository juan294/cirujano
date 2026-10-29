import { homedir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, jsonDigest, parseStrictJson, sha256 } from '@cirujano/core';
import { shellQuote } from '../optimization/stage-output.js';
import { consumePermit, readPrivateJson, readPrivateText } from '../optimization/store.js';
import { JEV_ENDPOINT, JEV_MODEL, MAX_RESPONSE_BYTES, PRICE_QUOTE, type JevResponse } from './inference-contracts.js';
import { JevTransportError, sendJev, validateJevResponse, validateJevApiKey } from './jev.js';
import { decodeAdvisoryPermit, permitDigest } from './permit.js';
import { persistPrepared, readPreparedOperation } from './prepare.js';
import { freshOperation, optionalJson, readEvidenceDirectory, strictRecord } from './storage.js';
import { evidenceStatus, report, type AdvisoryReport } from './rules.js';

export interface EnrichOptions {apiKey?:string;fetch?:typeof fetch;permitLedger?:string;now?:()=>Date;checkpoint?:(stage:string)=>Promise<void>}
interface EnrichmentOperation {schemaVersion:1;kind:'advisory-enrichment-operation';requestHash:string;preparedDigest:string;permitDigest:string;digest:string}
interface InferenceIntent {schemaVersion:1;kind:'jev-advisory-intent';operationDigest:string;requestHash:string;preparedDigest:string;permitDigest:string;model:typeof JEV_MODEL;endpoint:typeof JEV_ENDPOINT;createdAt:string;digest:string}
export interface AdvisoryReceiptV1 {schemaVersion:1;kind:'jev-advisory-receipt';requestHash:string;preparedDigest:string;intentDigest:string;permitDigest:string;model:typeof JEV_MODEL|null;latencyMs:number|null;inputTokens:number|null;outputTokens:number|null;costUsd:number|null;costBasis:'published-token-quote';responseHash:string|null;status:'completed'|'unavailable'|'outcome-unknown';reasonCodes:string[];httpStatus:number|null;digest:string}
interface EnrichmentResult {schemaVersion:1;kind:'advisory-enrichment';requestHash:string;preparedDigest:string;receiptDigest:string;responseHash:string;digest:string}
function sealed<T extends object>(content:T):T&{digest:string}{return {...content,digest:jsonDigest(content)};}
function verifyDigest(value:Record<string,unknown>):void {const {digest,...content}=value;if(typeof digest!=='string'||jsonDigest(content)!==digest)throw new Error('enrichment-digest-mismatch');}
const operationKeys=['schemaVersion','kind','requestHash','preparedDigest','permitDigest','digest'] as const;
const intentKeys=['schemaVersion','kind','operationDigest','requestHash','preparedDigest','permitDigest','model','endpoint','createdAt','digest'] as const;
const receiptKeys=['schemaVersion','kind','requestHash','preparedDigest','intentDigest','permitDigest','model','latencyMs','inputTokens','outputTokens','costUsd','costBasis','responseHash','status','reasonCodes','httpStatus','digest'] as const;
export async function enrichOperation(requestDirectory:string,permitValue:unknown,output:string,options:EnrichOptions={}):Promise<AdvisoryReceiptV1>{
 const {prepared,bundles}=await readPreparedOperation(requestDirectory),now=options.now??(()=>new Date());
 const permit=decodeAdvisoryPermit(permitValue,prepared,now());
 const apiKey=options.apiKey;validateJevApiKey(apiKey);
 return freshOperation(output,async store=>{
  await persistPrepared(store,prepared,bundles);
  const operation:EnrichmentOperation=sealed({schemaVersion:1,kind:'advisory-enrichment-operation',requestHash:prepared.requestHash,preparedDigest:prepared.digest,permitDigest:permitDigest(permit)});
  await store.writeText('operation.json',canonicalJson(operation));
  // One fixed ledger for all output directories. The override is injectable only by trusted test callers.
  await consumePermit({kind:'inference',digest:operation.permitDigest,operation:`jev-advisory:${prepared.requestHash}`,maximum:1,ledger:options.permitLedger??join(homedir(),'.local/share/cirujano/advisory/permits')});
  await options.checkpoint?.('after-reservation');
  const intent:InferenceIntent=sealed({schemaVersion:1,kind:'jev-advisory-intent',operationDigest:operation.digest,requestHash:prepared.requestHash,preparedDigest:prepared.digest,permitDigest:operation.permitDigest,model:JEV_MODEL,endpoint:JEV_ENDPOINT,createdAt:now().toISOString()});
  await store.writeText('intent.json',canonicalJson(intent));await options.checkpoint?.('after-intent');
  const base={schemaVersion:1 as const,kind:'jev-advisory-receipt' as const,requestHash:prepared.requestHash,preparedDigest:prepared.digest,intentDigest:intent.digest,permitDigest:operation.permitDigest,costBasis:'published-token-quote' as const};
  let receipt:AdvisoryReceiptV1;
  try{
   const result=await sendJev(prepared.requestBody,prepared.body,{apiKey,...(options.fetch?{fetch:options.fetch}:{})});
   await options.checkpoint?.('after-response');
   await store.writeText('response.json',result.responseText);
   receipt=sealed({...base,model:JEV_MODEL,latencyMs:result.latencyMs,inputTokens:result.response.usage.input_tokens,outputTokens:result.response.usage.output_tokens,costUsd:result.response.usage.input_tokens*PRICE_QUOTE.inputUsdPerMillion/1_000_000,responseHash:result.responseHash,status:'completed',reasonCodes:[],httpStatus:200});
  }catch(error){
   if(!(error instanceof JevTransportError))throw error;
   receipt=sealed({...base,model:null,latencyMs:null,inputTokens:null,outputTokens:null,costUsd:null,responseHash:error.responseHash,status:error.status,reasonCodes:[error.reasonCode],httpStatus:error.httpStatus});
  }
  await store.writeText('receipt.json',canonicalJson(receipt));await options.checkpoint?.('after-receipt');
  if(receipt.status==='completed'){
   const result:EnrichmentResult=sealed({schemaVersion:1,kind:'advisory-enrichment',requestHash:prepared.requestHash,preparedDigest:prepared.digest,receiptDigest:receipt.digest,responseHash:receipt.responseHash!});
   await store.writeText('result.json',canonicalJson(result));
  }
  return receipt;
 });
}
async function readJournal(directory:string){
 const context=await readPreparedOperation(directory),p=context.prepared;
 const operation=strictRecord(await readPrivateJson(join(directory,'operation.json')),operationKeys,'enrichment-invalid-operation');verifyDigest(operation);
 if(operation.schemaVersion!==1||operation.kind!=='advisory-enrichment-operation'||operation.requestHash!==p.requestHash||operation.preparedDigest!==p.digest||typeof operation.permitDigest!=='string'||!/^[a-f0-9]{64}$/u.test(operation.permitDigest))throw new Error('enrichment-operation-mismatch');
 const rawIntent=await optionalJson(join(directory,'intent.json'));
 if(rawIntent===null)return {...context,operation:operation as unknown as EnrichmentOperation,intent:null,receipt:null};
 const intent=strictRecord(rawIntent,intentKeys,'enrichment-invalid-intent');verifyDigest(intent);
 if(intent.schemaVersion!==1||intent.kind!=='jev-advisory-intent'||intent.operationDigest!==operation.digest||intent.requestHash!==p.requestHash||intent.preparedDigest!==p.digest||intent.permitDigest!==operation.permitDigest||intent.model!==JEV_MODEL||intent.endpoint!==JEV_ENDPOINT||typeof intent.createdAt!=='string'||!Number.isFinite(Date.parse(intent.createdAt)))throw new Error('enrichment-intent-mismatch');
 const rawReceipt=await optionalJson(join(directory,'receipt.json'));
 if(rawReceipt===null)return {...context,operation:operation as unknown as EnrichmentOperation,intent:intent as unknown as InferenceIntent,receipt:null};
 const receipt=strictRecord(rawReceipt,receiptKeys,'enrichment-invalid-receipt');verifyDigest(receipt);
 if(receipt.schemaVersion!==1||receipt.kind!=='jev-advisory-receipt'||receipt.requestHash!==p.requestHash||receipt.preparedDigest!==p.digest||receipt.intentDigest!==intent.digest||receipt.permitDigest!==operation.permitDigest||receipt.costBasis!=='published-token-quote'||!['completed','unavailable','outcome-unknown'].includes(String(receipt.status))||!Array.isArray(receipt.reasonCodes)||!receipt.reasonCodes.every(r=>typeof r==='string'&&/^jev-[a-z0-9-]+$/u.test(r))||(receipt.responseHash!==null&&(typeof receipt.responseHash!=='string'||!/^[a-f0-9]{64}$/u.test(receipt.responseHash))))throw new Error('enrichment-receipt-mismatch');
 if(receipt.status!=='completed'&&(receipt.model!==null||receipt.inputTokens!==null||receipt.outputTokens!==null||receipt.costUsd!==null||receipt.latencyMs!==null||receipt.reasonCodes.length===0))throw new Error('enrichment-receipt-mismatch');
 return {...context,operation:operation as unknown as EnrichmentOperation,intent:intent as unknown as InferenceIntent,receipt:receipt as unknown as AdvisoryReceiptV1};
}
export async function readEnrichmentOperation(directory:string){
 const context=await readJournal(directory),{prepared,receipt}=context;
 if(!receipt||receipt.status!=='completed')throw new Error('enrichment-not-completed');
 const responseText=await readPrivateText(join(directory,'response.json'),MAX_RESPONSE_BYTES),response=validateJevResponse(parseStrictJson(responseText,MAX_RESPONSE_BYTES),prepared.body);
 if(sha256(responseText)!==receipt.responseHash||receipt.model!==response.model||receipt.inputTokens!==response.usage.input_tokens||receipt.outputTokens!==response.usage.output_tokens||receipt.costUsd!==response.usage.input_tokens*PRICE_QUOTE.inputUsdPerMillion/1_000_000||typeof receipt.latencyMs!=='number'||!Number.isFinite(receipt.latencyMs)||receipt.latencyMs<0||receipt.httpStatus!==200||receipt.reasonCodes.length!==0)throw new Error('enrichment-response-mismatch');
 const result=strictRecord(await readPrivateJson(join(directory,'result.json')),['schemaVersion','kind','requestHash','preparedDigest','receiptDigest','responseHash','digest'],'enrichment-invalid-result');verifyDigest(result);
 const expected=sealed({schemaVersion:1,kind:'advisory-enrichment',requestHash:prepared.requestHash,preparedDigest:prepared.digest,receiptDigest:receipt.digest,responseHash:receipt.responseHash});
 if(canonicalJson(result)!==canonicalJson(expected))throw new Error('enrichment-result-mismatch');
 return {...context,receipt,response:response as JevResponse,result:result as unknown as EnrichmentResult};
}
export async function inspectAdvisoryOperation(directory:string):Promise<AdvisoryReport>{
 const rawOperation=await optionalJson(join(directory,'operation.json'));
 if(rawOperation!==null){
  const context=await readJournal(directory);
  const recovery=[`cirujano advisory inbox --input ${shellQuote(directory)} --format markdown`,'Inspect retained intent and receipt; a new send requires a fresh explicit owner permit and fresh output directory.'];
  if(!context.receipt){const value=report('outcome-unknown',{requestHash:context.prepared.requestHash},['enrichment-incomplete-intent']);value.nextActions=recovery;return value;}
  if(context.receipt.status!=='completed'){const value=report(context.receipt.status,{requestHash:context.prepared.requestHash,receiptDigest:context.receipt.digest},context.receipt.reasonCodes);value.nextActions=recovery;return value;}
  if(await optionalJson(join(directory,'result.json'))===null||await optionalJson(join(directory,'response.json'),MAX_RESPONSE_BYTES)===null){const value=report('outcome-unknown',{requestHash:context.prepared.requestHash},['enrichment-missing-final-artifact']);value.nextActions=recovery;return value;}
  const completed=await readEnrichmentOperation(directory);return report('complete',{requestHash:completed.prepared.requestHash,receipt:completed.receipt},[]);
 }
 if(await optionalJson(join(directory,'prepared.json'),4*1024*1024)!==null){const {prepared}=await readPreparedOperation(directory);return report('complete',{requestHash:prepared.requestHash,requestBytes:prepared.requestBytes,estimatedReservationUsd:prepared.estimatedReservationUsd},['prepared-not-sent']);}
 const bundle=await readEvidenceDirectory(directory);return report(evidenceStatus(bundle),{digest:bundle.digest,kind:bundle.kind},bundle.reasonCodes);
}
