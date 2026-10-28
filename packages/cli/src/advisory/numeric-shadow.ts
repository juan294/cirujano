import { canonicalJson, jsonDigest, sha256 } from '@cirujano/core';
import { JEV_ENDPOINT, JEV_MODEL, MAX_REQUEST_BYTES, PRICE_QUOTE, type JevBody } from './inference-contracts.js';

export const NUMERIC_SHADOW_VERSION='numeric-shadow-v1';
interface NumericInput {status?:unknown;family?:unknown;baselines?:unknown;history?:unknown;structuralFacts?:unknown}
function median(values:number[]):number {const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]!:((sorted[middle-1]??0)+(sorted[middle]??0))/2;}
function number(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>=0;}
export function numericShadowPolicy(input:NumericInput){
 const policyVersion=NUMERIC_SHADOW_VERSION;
 if(input.status!=='collected')return {policyVersion,decision:'unsupported' as const,facts:{},limitations:['Deterministic prefilter is preserved; no provider call is useful.']};
 if(input.family==='skip-validated-push'){
  if(!Array.isArray(input.history)||!input.history.length)return {policyVersion,decision:'unsupported' as const,facts:{},limitations:['Missing history.']};
  const rows=input.history as {billedMinutes:unknown;validated:unknown}[];if(rows.some(r=>!number(r.billedMinutes)||typeof r.validated!=='boolean'))throw new Error('evaluation-invalid-numeric-input');
  const validated=rows.filter(r=>r.validated),validatedShare=validated.length/rows.length,projectedMinutes=validated.reduce((n,r)=>n+(r.billedMinutes as number),0)-rows.length;
  return {policyVersion,decision:projectedMinutes>0&&validatedShare>=0.2?'proposal' as const:'abstain' as const,facts:{validatedShare,projectedMinutes,pushes:rows.length},limitations:['Experimental materiality policy; not a replacement diagnosis, authorization or savings proof.']};
 }
 if(!Array.isArray(input.baselines)||!input.baselines.length)return {policyVersion,decision:'unsupported' as const,facts:{},limitations:['Missing timing.']};
 const rows=input.baselines as {elapsedMs:unknown;installElapsedMs:unknown}[];if(rows.some(r=>!number(r.elapsedMs)||!number(r.installElapsedMs)||(r.installElapsedMs as number)>(r.elapsedMs as number)))throw new Error('evaluation-invalid-numeric-input');
 const installMedianMs=median(rows.map(r=>r.installElapsedMs as number)),shares=rows.map(r=>r.elapsedMs===0?null:(r.installElapsedMs as number)/(r.elapsedMs as number));
 const installShareMedian=shares.some(s=>s===null)?null:median(shares as number[]);
 return {policyVersion,decision:installShareMedian!==null&&installMedianMs>=30000&&installShareMedian>=0.2?'proposal' as const:'abstain' as const,facts:{installMedianMs,installShareMedian,samples:rows.length},limitations:['Experimental materiality policy; not a replacement diagnosis, authorization or savings proof.']};
}
export function prepareNumericJev(input:NumericInput){
 const policy=numericShadowPolicy(input);if(policy.decision==='unsupported')throw new Error('evaluation-numeric-prefilter');
 const body:JevBody={model:JEV_MODEL,state:{facts:policy.facts},questions:{material:{type:'noul',instructions:input.family==='skip-validated-push'?'Do the supplied numeric observations indicate material repeated CI work relative to one minute of classifier overhead per push?':'Do the supplied numeric observations indicate dependency installation is a material part of the observed job?',criteria:{true:'The supplied observations indicate material work worth investigating, without establishing optimization success.',false:'The supplied observations indicate negligible work or insufficient information to support the hypothesis.'}}}};
 const requestBody=canonicalJson(body),requestBytes=Buffer.byteLength(requestBody);if(requestBytes>MAX_REQUEST_BYTES)throw new Error('evaluation-request-size');
 const content={schemaVersion:1 as const,kind:'advisory-numeric-shadow-request' as const,policyVersion:NUMERIC_SHADOW_VERSION,questionSetVersion:'numeric-materiality-noul-v1',inputDigest:jsonDigest(input),inputDigests:[jsonDigest(input)],body,requestBody,requestHash:sha256(requestBody),requestBytes,model:JEV_MODEL,endpoint:JEV_ENDPOINT,priceQuote:PRICE_QUOTE,estimatedReservationUsd:Math.ceil(requestBytes*2*PRICE_QUOTE.inputUsdPerMillion/1_000_000*1e10)/1e10};
 return {...content,digest:jsonDigest(content)};
}
