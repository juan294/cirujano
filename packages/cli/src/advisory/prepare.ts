import { join } from 'node:path';
import { canonicalJson, jsonDigest, sha256 } from '@cirujano/core';
import { readPrivateJson, readPrivateText, type OperationStore } from '../optimization/store.js';
import { decodeEvidence, type EvidenceBundleV1 } from './contracts.js';
import { JEV_ENDPOINT, JEV_MODEL, MAX_REQUEST_BYTES, PRICE_QUOTE, type AdvisoryTask, type RequestProjection } from './inference-contracts.js';
import { buildSearchProjection } from './search-questions.js';
import { buildLabelProjection } from './projection.js';
import { freshOperation, inputDigests, readRetainedBundles } from './storage.js';
import { permitTemplate } from './permit.js';

export interface PreparedRequestV1 extends RequestProjection {
 schemaVersion:1;kind:'advisory-prepared-request';endpoint:typeof JEV_ENDPOINT;model:typeof JEV_MODEL;
 requestBody:string;requestHash:string;requestBytes:number;priceQuote:typeof PRICE_QUOTE;estimatedReservationUsd:number;digest:string;
}
export function buildPreparedRequest(bundles:EvidenceBundleV1[],task:AdvisoryTask,question:string|null=null):PreparedRequestV1 {
 if((task==='labels'&&question!==null)||(task==='search'&&typeof question!=='string')||(task!=='labels'&&task!=='search'))throw new Error('prepared-task-unavailable');
 const projection=task==='search'?buildSearchProjection(bundles,question!):buildLabelProjection(bundles);
 const requestBody=canonicalJson(projection.body),requestBytes=Buffer.byteLength(requestBody);
 if(requestBytes>MAX_REQUEST_BYTES)throw new Error('request-size-limit');
 // Deliberately conservative bytes-based estimate; provider token accounting may differ.
 const estimatedReservationUsd=Math.ceil(requestBytes*2*PRICE_QUOTE.inputUsdPerMillion/1_000_000*1e10)/1e10;
 const content={schemaVersion:1 as const,kind:'advisory-prepared-request' as const,...projection,endpoint:JEV_ENDPOINT,model:JEV_MODEL,requestBody,requestHash:sha256(requestBody),requestBytes,priceQuote:PRICE_QUOTE,estimatedReservationUsd};
 return {...content,digest:jsonDigest(content)};
}
export async function persistPrepared(store:OperationStore,prepared:PreparedRequestV1,bundles:EvidenceBundleV1[]):Promise<void>{
 for(const digest of prepared.inputDigests){const b=bundles.find(b=>b.digest===digest);if(!b)throw new Error('prepared-input-missing');await store.writeText(`bundle-${digest}.json`,canonicalJson(decodeEvidence(b)));}
 await store.writeText('body.json',prepared.requestBody);
 await store.writeText('prepared.json',canonicalJson(prepared));
}
export async function prepareOperation(bundles:EvidenceBundleV1[],task:AdvisoryTask,question:string|null,output:string,now:()=>Date=()=>new Date()):Promise<PreparedRequestV1>{
 const prepared=buildPreparedRequest(bundles,task,question);
 return freshOperation(output,async store=>{
  await persistPrepared(store,prepared,bundles);
  const template=permitTemplate(prepared,now());
  await store.writeText('preview.md',[
   '# Exact Jev payload review',`Body file: ${join(store.directory,'body.json')}`,`SHA256: ${prepared.requestHash}`,`UTF-8 bytes: ${prepared.requestBytes}`,
   `Conservative estimated reservation: $${prepared.estimatedReservationUsd}; price quote ${PRICE_QUOTE.date}: ${PRICE_QUOTE.source}. This is not a guaranteed provider billing cap.`,
   'Only public or synthetic source is projected. Pattern checks do not prove confidentiality. Review the complete body before owner authorization.',
   'This template is deliberately invalid authority. An owner-authorized permit must use kind jev-advisory-permit and payloadReviewed true. A prepared request grants no permission to send.',
   '```json',JSON.stringify(template,null,2),'```','Exact outbound body:','```json',prepared.requestBody,'```',
  ].join('\n\n')+'\n');
  return prepared;
 });
}
export async function readPreparedOperation(directory:string):Promise<{prepared:PreparedRequestV1;bundles:EvidenceBundleV1[]}>{
 const value=await readPrivateJson(join(directory,'prepared.json'),4*1024*1024);
 if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('prepared-invalid');
 const raw=value as Record<string,unknown>;
 const bundles=await readRetainedBundles(directory,inputDigests(raw.inputDigests));
 if((raw.task!=='labels'&&raw.task!=='search')||(raw.task==='labels'&&raw.question!==null)||(raw.task==='search'&&typeof raw.question!=='string'))throw new Error('prepared-task-unavailable');
 const prepared=buildPreparedRequest(bundles,raw.task,raw.question as string|null);
 if(canonicalJson(value)!==canonicalJson(prepared))throw new Error('prepared-digest-or-version-mismatch');
 if(await readPrivateText(join(directory,'body.json'),MAX_REQUEST_BYTES)!==prepared.requestBody)throw new Error('prepared-body-mismatch');
 return {prepared,bundles};
}
