import { canonicalJson, jsonDigest } from '../../packages/core/dist/index.js';
import { assertResultBinding } from './evaluation-metrics.mjs';

const POLICY='numeric-shadow-v1';
const PROVIDERS={typesafe:{key:'jev',model:'jev-1.14.0',endpoint:'https://api.typesafe.ai/v1/systemone',questionSetVersion:'numeric-materiality-noul-v1'},nebius:{key:'nemotron',model:'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',endpoint:'https://api.tokenfactory.nebius.com/v1/chat/completions',questionSetVersion:'existing-optimizer-diagnosis'}};
const fail=reason=>{throw new Error(reason);};
const known=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const binary=decision=>decision==='proposal'||decision==='abstain';
function unique(rows,key,reason){const result=new Map();for(const row of rows){if(!row||typeof row[key]!=='string'||result.has(row[key]))fail(reason);result.set(row[key],row);}return result;}
function agreement(pairs){const eligible=pairs.filter(([left,right])=>binary(left)&&binary(right)),matches=eligible.filter(([left,right])=>left===right).length;return {matches,denominator:eligible.length,value:eligible.length?matches/eligible.length:null};}
function validateRequest(request,row){
 const provider=PROVIDERS[request.provider];
 if(!provider||request.id!==`numeric-${request.provider}-${row.id}`||request.caseId!==row.id||!row.nativeEligible||request.model!==provider.model||request.endpoint!==provider.endpoint||request.policyVersion!==POLICY||request.questionSetVersion!==provider.questionSetVersion||canonicalJson(request.inputDigests)!==canonicalJson([row.seedInputDigest])||typeof request.requestHash!=='string'||!/^[a-f0-9]{64}$/u.test(request.requestHash))fail('numeric-request-binding');
}
function observation(row,provider,request,result,mode){
 const empty={provider,mode,status:row.nativeEligible?'not-run':'not-applicable',decision:null,costUsd:null,latencyMs:null,requestId:request?.id??null,requestHash:request?.requestHash??null,responseHash:null,resultHash:null,reasonCodes:[]};
 if(!row.nativeEligible)return {...empty,reasonCodes:['numeric-prefilter-not-eligible']};
 if(!request)return {...empty,status:'not-requested',reasonCodes:['numeric-request-pair-missing']};
 if(!result||result.status==='not-run')return {...empty,reasonCodes:['numeric-result-not-recorded']};
 if(mode==='dry-run')fail('numeric-dry-run-result-confusion');
 if(result.mode!==undefined&&result.mode!==mode)fail('numeric-native-replay-confusion');
 const fields=['model','requestHash','inputDigests','questionSetVersion','policyVersion','resultHash'];
 if(result.status==='completed'||fields.some(key=>Object.hasOwn(result,key))){
  try{assertResultBinding(result,request);}catch{fail('numeric-result-binding');}
  if(result.mode!==mode)fail('numeric-native-replay-confusion');
 }
 const provenance={...empty,responseHash:typeof result.responseHash==='string'?result.responseHash:null,resultHash:typeof result.resultHash==='string'?result.resultHash:null};
 if(result.status==='outcome-unknown')return {...provenance,status:'outcome-unknown',reasonCodes:['numeric-outcome-unknown']};
 if(result.status==='unavailable')return {...provenance,status:'unavailable',reasonCodes:['numeric-provider-unavailable']};
 if(result.status!=='completed')fail('numeric-invalid-result-status');
 if(!/^[a-f0-9]{64}$/u.test(result.responseHash??''))return {...provenance,status:'unavailable',reasonCodes:['numeric-receipt-missing']};
 const decision=result.payload?.decision;
 if(provider==='typesafe'){
  const probability=result.payload?.probability;if(!known(probability)||probability>1||decision!==(probability>=0.8?'proposal':probability<=0.2?'abstain':'uncertain'))fail('numeric-invalid-jev-decision');
 }else if(!binary(decision))fail('numeric-invalid-nemotron-decision');
 const costUsd=known(result.costUsd)?result.costUsd:null,latencyMs=known(result.latencyMs)?result.latencyMs:null;
 return {...provenance,status:'completed',decision,costUsd,latencyMs,reasonCodes:[...(costUsd===null?['numeric-cost-unavailable']:[]),...(latencyMs===null?['numeric-latency-unavailable']:[])]};
}
function providerSummary(cases,key){
 const observations=cases.filter(row=>row.nativeEligible).map(row=>row[key]),completed=observations.filter(row=>row.status==='completed'),costsKnown=observations.length>0&&observations.every(row=>known(row.costUsd)),latenciesKnown=observations.length>0&&observations.every(row=>known(row.latencyMs));
 return {population:observations.length,completed:completed.length,proposals:completed.filter(row=>row.decision==='proposal').length,abstentions:completed.filter(row=>row.decision==='abstain').length,uncertain:completed.filter(row=>row.decision==='uncertain').length,unavailable:observations.filter(row=>['unavailable','not-requested'].includes(row.status)).length,unknown:observations.filter(row=>row.status==='outcome-unknown').length,notRun:observations.filter(row=>row.status==='not-run').length,costUsd:costsKnown?observations.reduce((sum,row)=>sum+row.costUsd,0):null,latencyMs:latenciesKnown?observations.reduce((sum,row)=>sum+row.latencyMs,0):null};
}
function cascadeCase(row,mode){
 const base={id:row.id,sourceMode:mode,projected:true,status:row.nativeEligible?'UNMEASURED':'not-applicable',decision:null,escalated:null,costUsd:null,latencyMs:null,projectedRequests:null,requestIds:[],reasonCodes:[]};
 if(!row.nativeEligible)return {...base,reasonCodes:['numeric-prefilter-not-eligible']};
 const {jev,nemotron}=row;
 if(jev.status!=='completed'||!binary(jev.decision))return {...base,reasonCodes:[jev.decision==='uncertain'?'numeric-cascade-gate-uncertain':'numeric-cascade-gate-unavailable']};
 const escalated=jev.decision==='proposal',required=escalated?[jev,nemotron]:[jev],complete=required.every(record=>record.status==='completed'&&binary(record.decision));
 if(!complete)return {...base,escalated,requestIds:required.map(record=>record.requestId).filter(Boolean),reasonCodes:['numeric-cascade-required-pair-unavailable']};
 const costKnown=required.every(record=>known(record.costUsd)),latencyKnown=required.every(record=>known(record.latencyMs));
 return {...base,status:costKnown&&latencyKnown?'PROJECTED':'UNMEASURED',decision:escalated?nemotron.decision:'abstain',escalated,costUsd:costKnown?required.reduce((sum,record)=>sum+record.costUsd,0):null,latencyMs:latencyKnown?required.reduce((sum,record)=>sum+record.latencyMs,0):null,projectedRequests:required.length,requestIds:required.map(record=>record.requestId),reasonCodes:[...(costKnown?[]:['numeric-cascade-cost-unavailable']),...(latencyKnown?[]:['numeric-cascade-latency-unavailable'])]};
}
/** Pure shadow comparison: consumes already-recorded exact requests/results and never calls a provider. */
export function compareNumericOutcomes(policyRows,experimentRequests,executionResults,mode){
 if(!['dry-run','native','replay'].includes(mode)||!Array.isArray(policyRows)||!Array.isArray(experimentRequests)||!Array.isArray(executionResults))fail('numeric-invalid-comparison-input');
 const seeds=unique(policyRows,'id','numeric-duplicate-seed'),requests=experimentRequests.filter(r=>r.kind==='numeric'||r.feature==='numeric'),requestMap=unique(requests,'id','numeric-duplicate-request'),results=executionResults.filter(r=>typeof r?.id==='string'&&r.id.startsWith('numeric-')),resultMap=unique(results,'id','numeric-duplicate-result');
 for(const row of policyRows)if(!['cache','push'].includes(row.family)||typeof row.nativeEligible!=='boolean'||!/^[a-f0-9]{64}$/u.test(row.seedInputDigest??'')||row.policy?.policyVersion!==POLICY||!['proposal','abstain','unsupported'].includes(row.policy?.decision)||row.nativeEligible&&row.policy.decision==='unsupported')fail('numeric-invalid-policy-row');
 for(const request of requests){const row=seeds.get(request.caseId);if(!row)fail('numeric-invented-request-pair');validateRequest(request,row);}
 for(const result of results)if(!requestMap.has(result.id))fail('numeric-invented-result-pair');
 const cases=policyRows.map(row=>({id:row.id,family:row.family,seedInputDigest:row.seedInputDigest,seedExpectedDiagnosis:row.seedExpectedDiagnosis??null,nativeEligible:row.nativeEligible,rules:{policyVersion:POLICY,decision:row.policy.decision,facts:row.policy.facts??{}},...Object.fromEntries(Object.entries(PROVIDERS).map(([provider,description])=>{const id=`numeric-${provider}-${row.id}`;return [description.key,observation(row,provider,requestMap.get(id),resultMap.get(id),mode)];}))}));
 const eligible=cases.filter(row=>row.nativeEligible),measured=eligible.filter(row=>row.jev.status==='completed'&&row.nemotron.status==='completed').length;
 const comparison={schemaVersion:1,kind:'advisory-numeric-shadow-comparison',policyVersion:POLICY,mode,status:!measured?'UNMEASURED':measured===eligible.length?'MEASURED':'PARTIAL',nativeQualification:false,productionDiagnosisChanged:false,seedCount:cases.length,eligibleCaseCount:eligible.length,cases,agreement:{rulesVsJev:agreement(eligible.map(r=>[r.rules.decision,r.jev.decision])),rulesVsNemotron:agreement(eligible.map(r=>[r.rules.decision,r.nemotron.decision])),jevVsNemotron:agreement(eligible.map(r=>[r.jev.decision,r.nemotron.decision]))},providers:{jev:providerSummary(cases,'jev'),nemotron:providerSummary(cases,'nemotron')},provenance:{policyRowsDigest:jsonDigest(policyRows),numericRequestsDigest:jsonDigest(requests),numericResultsDigest:jsonDigest(results)},limitations:['Agreement is not proof of optimal materiality policy or measured CI improvement.','Only paired binary decisions enter agreement denominators; uncertainty and missing outcomes are counted separately.','Provider results remain numerical shadow experiments; no production diagnosis, proof, authorization or routing changes.','Replay provenance remains replay and never supplies native qualification.']};
 const cascadeCases=cases.map(row=>cascadeCase(row,mode)),population=cascadeCases.filter(row=>row.status!=='not-applicable'),allKnown=key=>population.length>0&&population.every(row=>known(row[key]));
 const cascade={schemaVersion:1,kind:'advisory-projected-numeric-cascade',projected:true,nativeExecuted:false,sourceMode:mode,status:population.length>0&&population.every(row=>row.status==='PROJECTED')?'PROJECTED':'UNMEASURED',gate:'Jev proposal escalates to the separately recorded Nemotron decision; Jev abstention stops. Uncertainty never forces escalation.',cases:cascadeCases,totals:{population:population.length,completeCases:population.filter(row=>row.status==='PROJECTED').length,costUsd:allKnown('costUsd')?population.reduce((sum,row)=>sum+row.costUsd,0):null,latencyMs:allKnown('latencyMs')?population.reduce((sum,row)=>sum+row.latencyMs,0):null,projectedRequests:allKnown('projectedRequests')?population.reduce((sum,row)=>sum+row.projectedRequests,0):null},limitations:['Projected serial latency and cost sum separately recorded required stages; no native cascade was executed.','Unused Nemotron stages after a known Jev abstention are not projected requests. Missing required stages/costs/latencies remain unknown.','Separate recordings omit any unmeasured orchestration, retrieval or cross-provider interaction overhead.']};
 return {comparison,cascade};
}
