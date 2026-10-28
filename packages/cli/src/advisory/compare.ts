import { canonicalJson, jsonDigest, sha256 } from '@cirujano/core';
import type { EvidenceBundleV1 } from './contracts.js';
import { JEV_ENDPOINT, JEV_MODEL, type JevResponse, type LocalExcerpt, type RequestProjection } from './inference-contracts.js';
import { validateJevResponse } from './jev.js';
import type { PreparedRequestV1 } from './prepare.js';
import { supportState } from './questions.js';
import { report, type AdvisoryReport } from './rules.js';
import { compareSteps, validateComparisonInputs, type CategoryDelta, type CohortStats, type StepComparison, type UnmatchedStep } from './compare-cohorts.js';
import { buildComparisonProjection, COMPARISON_CATEGORIES, type ComparisonCategory } from './compare-questions.js';
export { readCohort } from './compare-cohorts.js';
export type { CohortManifestV1 } from './compare-cohorts.js';

export interface ComparisonHypothesis {category:ComparisonCategory;status:'supported'|'uncertain'|'absent';probability:number;text:string;evidence:LocalExcerpt[];alternatives:string[];missingFacts:string[]}
export interface ComparisonPayload {kind:'comparison';baseline:CohortStats;candidate:CohortStats;delta:{durationMs:number;durationPercent:number|null;roundedMinutes:number;roundedMinutesPercent:number|null};regression:boolean;matchedSteps:StepComparison[];unmatchedSteps:UnmatchedStep[];categoryDeltas:CategoryDelta[];hypotheses:ComparisonHypothesis[]}
export interface RetainedComparison {prepared:PreparedRequestV1;response:JevResponse}
function assertRetained(prepared:PreparedRequestV1,expected:RequestProjection,comparison:{baselineDigests:string[];candidateDigests:string[]}):void{
 try{
  const actual:RequestProjection={task:prepared.task,question:prepared.question,body:prepared.body,mapping:prepared.mapping,inputDigests:prepared.inputDigests,questionSetVersion:prepared.questionSetVersion,policyVersion:prepared.policyVersion};
  const body=canonicalJson(expected.body),{digest,...content}=prepared,context=(prepared as PreparedRequestV1&{comparison?:unknown}).comparison;
  if(canonicalJson(actual)!==canonicalJson(expected)||canonicalJson(context)!==canonicalJson(comparison)||prepared.model!==JEV_MODEL||prepared.endpoint!==JEV_ENDPOINT||prepared.schemaVersion!==1||prepared.kind!=='advisory-prepared-request'||prepared.requestBody!==body||prepared.requestHash!==sha256(body)||prepared.requestBytes!==Buffer.byteLength(body)||jsonDigest(content)!==digest)throw new Error();
 }catch{throw new Error('enrichment-comparison-mismatch');}
}
export function compareCohorts(base:EvidenceBundleV1[],candidate:EvidenceBundleV1[],retained?:RetainedComparison):AdvisoryReport<ComparisonPayload>{
 const inputs=validateComparisonInputs(base,candidate),baseline=inputs.baselineStats,next=inputs.candidateStats,durationMs=next.medianDurationMs-baseline.medianDurationMs,roundedMinutes=next.medianRoundedMinutes-baseline.medianRoundedMinutes;
 const durationPercent=baseline.medianDurationMs===0?null:100*durationMs/baseline.medianDurationMs,roundedMinutesPercent=baseline.medianRoundedMinutes===0?null:100*roundedMinutes/baseline.medianRoundedMinutes;
 const payload:ComparisonPayload={kind:'comparison',baseline,candidate:next,delta:{durationMs,durationPercent,roundedMinutes,roundedMinutesPercent},regression:durationPercent!==null&&durationPercent>=10&&durationMs>=10000,...compareSteps(inputs),hypotheses:[]};
 if(retained){
  const projection=buildComparisonProjection(inputs.base,inputs.candidate),comparison={baselineDigests:inputs.base.map(b=>b.digest).sort(),candidateDigests:inputs.candidate.map(b=>b.digest).sort()};assertRetained(retained.prepared,projection,comparison);const response=validateJevResponse(retained.response,projection.body);
  payload.hypotheses=COMPARISON_CATEGORIES.map(category=>{const answer=response.answers[category]!;if(answer.type!=='noul')throw new Error('enrichment-comparison-mismatch');const status=supportState(answer.noul),symptom=category==='dependencySetup'?'dependency setup':category==='compilation'?'compilation':'artifact transfer';return {category,status,probability:answer.noul,text:status==='absent'?`Investigation hypothesis (absent): supplied evidence does not support a ${symptom} symptom; this is not a causal conclusion.`:`Investigation hypothesis (${status}): ${symptom} may relate to the observed difference; this is not a causal conclusion.`,evidence:projection.mapping,alternatives:['Runner load and external service variability may explain timing differences.','Source/input differences and sample selection remain alternative explanations.'],missingFacts:['No provider-verified logs were collected.','No controlled experiment isolates a root cause.']};});
 }
 const result=report('complete',payload,baseline.medianDurationMs===0?['cohort-zero-baseline-absolute-only']:[]);
 result.limitations.push('Cohorts are observational; timing changes and semantic hypotheses do not establish causality, invoice savings or optimization proof.','No provider-verified logs were collected. Category totals include only matched non-overlapping source steps.','At most 20 bundles are accepted across both cohorts; each cohort requires at least three completed successful supported executions.');
 result.nextActions=['Inspect the pinned run and source references, unmatched steps and alternative explanations; collect missing evidence into fresh directories before a separate optimization workflow.'];
 return result;
}
