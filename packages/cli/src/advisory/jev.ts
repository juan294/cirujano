import { canonicalJson, parseStrictJson, sha256 } from '@cirujano/core';
import {
  JEV_ENDPOINT, JEV_MODEL, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, TOTAL_DEADLINE_MS,
  type JevBody, type JevResponse,
} from './inference-contracts.js';

export type JevFailureStatus='unavailable'|'outcome-unknown';
/** A safe category only: never retains the provider body, key or original transport exception. */
export class JevTransportError extends Error {
  constructor(
    readonly status:JevFailureStatus,
    readonly reasonCode:string,
    readonly httpStatus:number|null=null,
    readonly responseHash:string|null=null,
  ) {super(reasonCode);this.name='JevTransportError';}
}
function invalidResponse():never {throw new JevTransportError('unavailable','jev-invalid-response');}
function record(value:unknown,keys?:readonly string[]):Record<string,unknown> {
  if(value===null||typeof value!=='object'||Array.isArray(value))invalidResponse();
  const found=value as Record<string,unknown>;
  if(keys&&(Object.keys(found).length!==keys.length||keys.some(key=>!Object.hasOwn(found,key))))invalidResponse();
  return found;
}
function probability(value:unknown):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)invalidResponse();
  return value;
}
function sameKeys(value:Record<string,unknown>,expected:Record<string,unknown>):void {
  if(Object.keys(value).length!==Object.keys(expected).length||Object.keys(expected).some(key=>!Object.hasOwn(value,key)))invalidResponse();
}
/** Choice distributions may differ from one by at most 1e-6 due to serialized rounding. */
const DISTRIBUTION_TOLERANCE=1e-6;
export function validateJevResponse(value:unknown,body:JevBody):JevResponse {
  try {
    canonicalJson(value);
    const root=record(value,['model','answers','usage']);
    if(root.model!==JEV_MODEL)invalidResponse();
    const answers=record(root.answers);sameKeys(answers,body.questions);
    for(const [id,question] of Object.entries(body.questions)) {
      const answer=record(answers[id]);
      if(question.type==='noul') {
        record(answer,['type','noul']);if(answer.type!=='noul')invalidResponse();probability(answer.noul);
      } else {
        record(answer,['type','choice','confidence','probabilities']);if(answer.type!=='choice'||typeof answer.choice!=='string')invalidResponse();
        probability(answer.confidence);
        const probabilities=record(answer.probabilities);sameKeys(probabilities,question.criteria);
        const values=Object.values(probabilities).map(probability),sum=values.reduce((total,p)=>total+p,0);
        if(Math.abs(sum-1)>DISTRIBUTION_TOLERANCE||!Object.hasOwn(probabilities,answer.choice)||probabilities[answer.choice]!==Math.max(...values))invalidResponse();
      }
    }
    const usage=record(root.usage,['input_tokens','output_tokens']);
    if(![usage.input_tokens,usage.output_tokens].every(token=>typeof token==='number'&&Number.isSafeInteger(token)&&token>=0))invalidResponse();
    return value as JevResponse;
  } catch {return invalidResponse();}
}

export interface JevSendOptions {apiKey:string;fetch?:typeof fetch;deadlineMs?:number}
export interface JevSendResult {response:JevResponse;responseText:string;responseHash:string;latencyMs:number}
function validateRequest(text:string,body:JevBody):void {
  try {
    if(typeof text!=='string'||Buffer.byteLength(text)>MAX_REQUEST_BYTES)throw new Error();
    if(canonicalJson(parseStrictJson(text,MAX_REQUEST_BYTES))!==canonicalJson(body))throw new Error();
    const root=record(body,['model','state','questions']);if(root.model!==JEV_MODEL)throw new Error();record(root.state);
    const questions=record(root.questions);if(!Object.keys(questions).length||Object.keys(questions).length>128)throw new Error();
    for(const [id,raw] of Object.entries(questions)) {
      if(!/^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(id))throw new Error();
      const question=record(raw,['type','instructions','criteria']);
      if(typeof question.instructions!=='string'||!question.instructions||Buffer.byteLength(question.instructions)>4096)throw new Error();
      if(question.type==='noul') {
        const criteria=record(question.criteria,['true','false']);if(!Object.values(criteria).every(value=>typeof value==='string'))throw new Error();
      } else if(question.type==='choice') {
        const criteria=record(question.criteria);if(Object.keys(criteria).length<1||Object.keys(criteria).length>20||!Object.entries(criteria).every(([key,value])=>/^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(key)&&typeof value==='string'))throw new Error();
      } else throw new Error();
    }
  } catch {throw new JevTransportError('unavailable','jev-invalid-request');}
}
function cancelBody(response:Response):void {void response.body?.cancel().catch(()=>{});}
async function readResponse(response:Response,deadline:Promise<never>):Promise<string> {
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_RESPONSE_BYTES)) {
    cancelBody(response);throw new JevTransportError('unavailable','jev-response-size');
  }
  if(!response.body)throw new JevTransportError('unavailable','jev-invalid-response');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try {
    while(true) {
      const next=await Promise.race([reader.read(),deadline]);
      if(next.done)break;
      bytes+=next.value.byteLength;
      if(bytes>MAX_RESPONSE_BYTES)throw new JevTransportError('unavailable','jev-response-size');
      chunks.push(next.value);
    }
    try {return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}
    catch {throw new JevTransportError('unavailable','jev-invalid-response');}
  } finally {
    // A hostile injected stream may ignore cancellation; neither cancellation nor lock release may extend the total deadline.
    void reader.cancel().catch(()=>{});
    try {reader.releaseLock();}catch {/* A stalled read can still hold the reader until cancellation settles. */}
  }
}
export function validateJevApiKey(apiKey:unknown):asserts apiKey is string {
  if(typeof apiKey!=='string'||!apiKey||apiKey.length>2048||/[\s\u0000-\u001f\u007f]/u.test(apiKey))throw new JevTransportError('unavailable','jev-key-required');
}

/** One POST, no retries or discovery request. Caller owns durable intent and single-use authorization. */
export async function sendJev(bodyText:string,body:JevBody,options:JevSendOptions):Promise<JevSendResult> {
  validateRequest(bodyText,body);
  validateJevApiKey(options.apiKey);
  const deadlineMs=options.deadlineMs??TOTAL_DEADLINE_MS;
  if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>TOTAL_DEADLINE_MS)throw new JevTransportError('unavailable','jev-invalid-deadline');
  const controller=new AbortController(),started=performance.now();let timer:ReturnType<typeof setTimeout>;
  const deadline=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new JevTransportError('outcome-unknown','jev-deadline'));},deadlineMs);
  });
  let httpStatus:number|null=null,responseHash:string|null=null;
  try {
    const response=await Promise.race([(options.fetch??fetch)(JEV_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json'},body:bodyText,redirect:'manual',signal:controller.signal}),deadline]);
    httpStatus=response.status;
    if(response.redirected||(response.status>=300&&response.status<400)) {cancelBody(response);throw new JevTransportError('unavailable','jev-redirect-refused',httpStatus);}
    if(!response.ok) {cancelBody(response);throw new JevTransportError('unavailable',`jev-http-${response.status}`,httpStatus);}
    const responseText=await readResponse(response,deadline);responseHash=sha256(responseText);
    let parsed:unknown;try {parsed=parseStrictJson(responseText,MAX_RESPONSE_BYTES);}catch {throw new JevTransportError('unavailable','jev-invalid-response');}
    const validated=validateJevResponse(parsed,body),latencyMs=Math.max(0,performance.now()-started);
    if(controller.signal.aborted||latencyMs>=deadlineMs) {controller.abort();throw new JevTransportError('outcome-unknown','jev-deadline');}
    return {response:validated,responseText,responseHash,latencyMs};
  } catch(error) {
    if(error instanceof JevTransportError)throw new JevTransportError(error.status,error.reasonCode,httpStatus??error.httpStatus,responseHash??error.responseHash);
    throw new JevTransportError('outcome-unknown','jev-outcome-unknown',httpStatus,responseHash);
  } finally {clearTimeout(timer!);}
}
