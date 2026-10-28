import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '@cirujano/core';
import { JEV_ENDPOINT, JEV_MODEL, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, type JevBody } from './inference-contracts.js';
import { JevTransportError, sendJev, validateJevApiKey, validateJevResponse } from './jev.js';

const body:JevBody={model:JEV_MODEL,state:{excerpts:{candidate_a:'pnpm install',candidate_b:'npm test'}},questions:{
  install:{type:'noul',instructions:'Does candidate_a install dependencies?',criteria:{true:'It installs dependencies.',false:'It does other work.'}},
  rank:{type:'choice',instructions:'Which excerpt shows dependency installation?',criteria:{candidate_a:'pnpm install',candidate_b:'npm test'}},
}};
const bodyText=JSON.stringify(body);
const fixture=async()=>JSON.parse(await readFile(new URL('../../fixtures/advisory/provider/jev-1.14.0-response.synthetic.json',import.meta.url),'utf8')) as Record<string,unknown>;
const fetchReturning=(response:Response):typeof fetch=>async()=>response;
function responseOf(value:unknown):Response{return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});}

describe('pinned native Jev response contract',()=>{
 it('accepts named Nouls and Choice distributions, with native token fields',async()=>{
  const result=validateJevResponse(await fixture(),body);
  expect(result.model).toBe(JEV_MODEL);expect(result.answers.install).toEqual({type:'noul',noul:0.9});expect(result.usage).toEqual({input_tokens:120,output_tokens:12});
 });
 it.each(['model','missing-id','extra-id','wrong-type','extra-field','noul-nan','noul-range','choice-keys','choice-sum','choice-selection','confidence','missing-usage','null-usage','negative-usage','fractional-usage','extra-root'])('rejects %s without exposing provider text',async(kind)=>{
  const value=await fixture();const answers=value.answers as Record<string,Record<string,unknown>>;
  if(kind==='model')value.model='jev-latest';
  if(kind==='missing-id')delete answers.install;
  if(kind==='extra-id')answers.provider_secret={type:'noul',noul:0.9};
  if(kind==='wrong-type')answers.install={type:'choice',choice:'candidate_a',confidence:1,probabilities:{candidate_a:1}};
  if(kind==='extra-field')answers.install!.provider_secret='canary';
  if(kind==='noul-nan')answers.install!.noul=NaN;
  if(kind==='noul-range')answers.install!.noul=1.01;
  if(kind==='choice-keys')answers.rank!.probabilities={candidate_a:1};
  if(kind==='choice-sum')answers.rank!.probabilities={candidate_a:0.6,candidate_b:0.3};
  if(kind==='choice-selection')answers.rank!.choice='candidate_b';
  if(kind==='confidence')answers.rank!.confidence=-1;
  if(kind==='missing-usage')delete value.usage;
  if(kind==='null-usage')value.usage=null;
  if(kind==='negative-usage')value.usage={input_tokens:-1,output_tokens:0};
  if(kind==='fractional-usage')value.usage={input_tokens:1.5,output_tokens:0};
  if(kind==='extra-root')value.provider_secret='canary';
  let thrown:unknown;try{validateJevResponse(value,body);}catch(error){thrown=error;}
  expect(thrown).toBeInstanceOf(JevTransportError);expect(thrown).toMatchObject({status:'unavailable',reasonCode:'jev-invalid-response'});expect(String(thrown)).not.toContain('canary');
 });
 it('allows probability rounding tolerance and a selected tied maximum',async()=>{
  const value=await fixture(),answers=value.answers as Record<string,Record<string,unknown>>;
  answers.rank!.probabilities={candidate_a:0.5000001,candidate_b:0.5};
  expect(validateJevResponse(value,body).answers.rank).toMatchObject({choice:'candidate_a'});
  answers.rank!.probabilities={candidate_a:0.5,candidate_b:0.5};answers.rank!.choice='candidate_b';
  expect(validateJevResponse(value,body).answers.rank).toMatchObject({choice:'candidate_b'});
 });
});

describe('one bounded fixed-origin POST',()=>{
 it('sends the exact reviewed UTF-8 bytes once with only fixed endpoint/headers and retains response hash',async()=>{
  const value=await fixture(),raw=JSON.stringify(value);const calls:{url:string;init:RequestInit|undefined}[]=[];
  const fetcher:typeof fetch=async(url,init)=>{calls.push({url:String(url),init});return new Response(raw);};
  const result=await sendJev(bodyText,body,{apiKey:'test-key',fetch:fetcher});
  expect(calls).toHaveLength(1);expect(calls[0]!.url).toBe(JEV_ENDPOINT);expect(calls[0]!.init).toMatchObject({method:'POST',body:bodyText,redirect:'manual',headers:{Authorization:'Bearer test-key','Content-Type':'application/json'}});
  expect(Object.keys(calls[0]!.init!.headers!)).toEqual(['Authorization','Content-Type']);expect(calls[0]!.init!.signal).toBeInstanceOf(AbortSignal);
  expect(result.responseHash).toBe(sha256(raw));expect(result.responseText).toBe(raw);expect(result.latencyMs).toBeGreaterThanOrEqual(0);
 });
 it.each(['',' key with space','key\nsecret'])('does not send without a usable key',async(apiKey)=>{
  let sends=0;const fetcher:typeof fetch=async()=>{sends++;return responseOf(await fixture());};
  await expect(sendJev(bodyText,body,{apiKey,fetch:fetcher})).rejects.toMatchObject({status:'unavailable',reasonCode:'jev-key-required'});expect(sends).toBe(0);
 });
 it.each(['mismatch','oversize','model-alias','extra-assets','bad-deadline'])('refuses %s before any emission',async(kind)=>{
  let sends=0;const fetcher:typeof fetch=async()=>{sends++;return responseOf(await fixture());};let text=bodyText;let request=body;let deadlineMs=15000;
  if(kind==='mismatch')text=JSON.stringify({...body,state:{different:true}});
  if(kind==='oversize')text=' '.repeat(MAX_REQUEST_BYTES+1);
  if(kind==='model-alias'){request={...body,model:'jev-latest'} as unknown as JevBody;text=JSON.stringify(request);}
  if(kind==='extra-assets'){request={...body,assets:{x:'data'}} as unknown as JevBody;text=JSON.stringify(request);}
  if(kind==='bad-deadline')deadlineMs=15001;
  await expect(sendJev(text,request,{apiKey:'test-key',fetch:fetcher,deadlineMs})).rejects.toMatchObject({status:'unavailable'});expect(sends).toBe(0);
 });
 it.each([401,429,529])('retains HTTP %s category without retry or provider body disclosure',async(status)=>{
  let sends=0;const fetcher:typeof fetch=async()=>{sends++;return new Response('provider_canary_secret',{status});};
  let thrown:unknown;try{await sendJev(bodyText,body,{apiKey:'test-key',fetch:fetcher});}catch(error){thrown=error;}
  expect(thrown).toMatchObject({status:'unavailable',httpStatus:status,reasonCode:`jev-http-${status}`,responseHash:null});expect(String(thrown)).not.toContain('canary');expect(sends).toBe(1);
 });
 it('rejects redirect without following it',async()=>{
  let sends=0;const fetcher:typeof fetch=async()=>{sends++;return new Response(null,{status:302,headers:{location:'https://foreign.invalid/steal'}});};
  await expect(sendJev(bodyText,body,{apiKey:'test-key',fetch:fetcher})).rejects.toMatchObject({status:'unavailable',reasonCode:'jev-redirect-refused',httpStatus:302});expect(sends).toBe(1);
 });
 it('rejects a followed redirect even if an injected fetch reports 200',async()=>{
  const response=responseOf(await fixture());Object.defineProperty(response,'redirected',{value:true});
  await expect(sendJev(bodyText,body,{apiKey:'test-key',fetch:fetchReturning(response)})).rejects.toMatchObject({status:'unavailable',reasonCode:'jev-redirect-refused'});
 });
 it.each(['malformed','wrong-model','null-usage','duplicate-json-key'])('returns unavailable for %s and hashes bounded received bytes',async(kind)=>{
  const value=await fixture();if(kind==='wrong-model')value.model='jev-preview';if(kind==='null-usage')value.usage=null;
  const raw=kind==='malformed'?'provider_canary_secret':kind==='duplicate-json-key'?' {"model":"jev-1.14.0","model":"jev-1.14.0"}':JSON.stringify(value);
  let thrown:unknown;try{await sendJev(bodyText,body,{apiKey:'test-key',fetch:fetchReturning(new Response(raw))});}catch(error){thrown=error;}
  expect(thrown).toMatchObject({status:'unavailable',reasonCode:'jev-invalid-response',httpStatus:200,responseHash:sha256(raw)});expect(String(thrown)).not.toContain('canary');
 });
 it('bounds the decoded stream independently of content-length and cancels excess bytes',async()=>{
  let cancelled=false;const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));controller.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
  await expect(sendJev(bodyText,body,{apiKey:'test-key',fetch:fetchReturning(new Response(stream,{headers:{'content-length':'1'}}))})).rejects.toMatchObject({status:'unavailable',reasonCode:'jev-response-size'});expect(cancelled).toBe(true);
 });
 it.each([String(MAX_RESPONSE_BYTES+1),'-1','invalid'])('refuses excessive or malformed declared response size %s',async(length)=>{
  await expect(sendJev(bodyText,body,{apiKey:'test-key',fetch:fetchReturning(new Response('{}',{headers:{'content-length':length}}))})).rejects.toMatchObject({status:'unavailable',reasonCode:'jev-response-size'});
 });
 it('marks a rejected POST transport outcome unknown without exposing its error',async()=>{
  const fetcher:typeof fetch=async()=>{throw new Error('test-key provider_canary_secret');};
  await expect(sendJev(bodyText,body,{apiKey:'test-key',fetch:fetcher})).rejects.toMatchObject({status:'outcome-unknown',reasonCode:'jev-outcome-unknown',httpStatus:null});
 });
 it('enforces a total deadline even when an injected fetch ignores abort',async()=>{
  let signal:AbortSignal|undefined;let sends=0;const fetcher:typeof fetch=async(_url,init)=>{sends++;signal=init!.signal!;return new Promise<Response>(()=>{});};
  await expect(sendJev(bodyText,body,{apiKey:'test-key',fetch:fetcher,deadlineMs:15})).rejects.toMatchObject({status:'outcome-unknown',reasonCode:'jev-deadline'});expect(signal!.aborted).toBe(true);expect(sends).toBe(1);
 });
 it('includes body streaming in the same deadline and cancels a stalled stream',async()=>{
  let cancelled=false;const stream=new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel(){cancelled=true;}});
  await expect(sendJev(bodyText,body,{apiKey:'test-key',fetch:fetchReturning(new Response(stream)),deadlineMs:15})).rejects.toMatchObject({status:'outcome-unknown',reasonCode:'jev-deadline'});expect(cancelled).toBe(true);
 });
});

it('does not report success when synchronous processing crosses the total deadline',async()=>{
 const value=await fixture();const clock=vi.spyOn(performance,'now').mockReturnValueOnce(0).mockReturnValue(16);
 try {await expect(sendJev(bodyText,body,{apiKey:'test-key',fetch:fetchReturning(responseOf(value)),deadlineMs:15})).rejects.toMatchObject({status:'outcome-unknown',reasonCode:'jev-deadline'});}
 finally {clock.mockRestore();}
});

it('shares the exact key preflight before reservation, including 2048-character boundaries',async()=>{
 expect(()=>validateJevApiKey('k'.repeat(2048))).not.toThrow();
 for(const key of [undefined,null,42,'','k k','k\n','k'.repeat(2049)])expect(()=>validateJevApiKey(key)).toThrow('jev-key-required');
 let sends=0;const fetcher:typeof fetch=async()=>{sends++;return responseOf(await fixture());};
 await expect(sendJev(bodyText,body,{apiKey:'k'.repeat(2049),fetch:fetcher})).rejects.toMatchObject({status:'unavailable',reasonCode:'jev-key-required'});expect(sends).toBe(0);
 await expect(sendJev(bodyText,body,{apiKey:'k'.repeat(2048),fetch:fetcher})).resolves.toMatchObject({response:{model:JEV_MODEL}});expect(sends).toBe(1);
});
