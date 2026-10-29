import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, jsonDigest, parseStrictJson, safeRelativePath, sha256 } from '../../packages/core/dist/index.js';

export const EVALUATION_VERSION='advisory-evaluation-v1';
const labels=new Set(['install','build','test','artifact','cacheMiss']);
const fail=code=>{throw new Error(code);};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function percentile(values,p){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];}
export function bootstrapRatio(rows){
 const numerator=rows.reduce((n,r)=>n+r.numerator,0),denominator=rows.reduce((n,r)=>n+r.denominator,0),value=denominator?numerator/denominator:null;
 let state=0x5eed1234;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};const samples=[];
 if(denominator&&rows.length)for(let iteration=0;iteration<2000;iteration++){let n=0,d=0;for(let i=0;i<rows.length;i++){const row=rows[Math.floor(random()*rows.length)];n+=row.numerator;d+=row.denominator;}if(d)samples.push(n/d);}
 return {value,numerator,denominator,interval95:[percentile(samples,0.025),percentile(samples,0.975)],bootstrap:{method:'case-cluster-percentile',replicates:2000,seed:0x5eed1234}};
}
function predictionMap(gold,predictions){
 if(!Array.isArray(gold)||!Array.isArray(predictions))fail('evaluation-invalid-records');
 const ids=new Set(gold.map(g=>g.id));if(ids.size!==gold.length)fail('evaluation-duplicate-case');const found=new Map();
 for(const prediction of predictions){if(!prediction||typeof prediction.id!=='string'||!ids.has(prediction.id)||found.has(prediction.id))fail('evaluation-prediction-case-mismatch');found.set(prediction.id,prediction);}
 return found;
}
function authority(prediction){if(prediction.automation!==undefined&&prediction.automation!=='advisory-only'||!Array.isArray(prediction.effects)||prediction.effects.length)fail('evaluation-authority-invariant');if(!Array.isArray(prediction.unsupportedClaims))fail('evaluation-invalid-records');}
export function assertNumericInvariant(expected,actual){if(canonicalJson(expected)!==canonicalJson(actual))fail('evaluation-numeric-invariant');}
export function scoreLabels(gold,predictions){
 const byId=predictionMap(gold,predictions),precision=[],recall=[],references=[],statuses=[],abstentionRows=[];let abstentions=0,unsupportedClaims=0,usefulCards=0,notRun=0;
 for(const item of gold){const actual=byId.get(item.id),expected=item.expected;const shown=actual?.labels??[];
  if(actual){authority(actual);assertNumericInvariant(expected.metrics,actual.metrics);if(actual.automation!==expected.automation)fail('evaluation-authority-invariant');unsupportedClaims+=actual.unsupportedClaims.length;}
  if(!Array.isArray(shown)||shown.some(l=>!labels.has(l.category)||typeof l.evidenceId!=='string'))fail('evaluation-invalid-label');
  const unique=[...new Map(shown.map(l=>[`${l.category}\0${l.evidenceId}`,l])).values()],inventory=new Set(actual?.candidateIds??[]),acceptable=new Set(expected.acceptableEvidenceIds),expectedLabels=new Set(expected.labels);
  const correct=unique.filter(l=>expectedLabels.has(l.category)&&acceptable.has(l.evidenceId));const matched=new Set(correct.map(l=>l.category));
  precision.push({numerator:correct.length,denominator:unique.length});recall.push({numerator:matched.size,denominator:expectedLabels.size});references.push({numerator:unique.filter(l=>inventory.has(l.evidenceId)).length,denominator:unique.length});
  const semanticOutcome=actual?.semanticOutcome??(actual?(unique.length?'supported':'uncertain'):'not-run');if(!['supported','uncertain','no-match','not-run'].includes(semanticOutcome))fail('evaluation-invalid-semantic-outcome');statuses.push({numerator:semanticOutcome===expected.status?1:0,denominator:1});if(actual&&!unique.length){abstentions++;abstentionRows.push({numerator:semanticOutcome===expected.status&&['uncertain','no-match'].includes(expected.status)?1:0,denominator:1});}if(!actual)notRun++;if(correct.length)usefulCards++;
 }
 return {cases:gold.length,precision:bootstrapRatio(precision),recall:bootstrapRatio(recall),referenceIntegrity:bootstrapRatio(references),abstentions,notRun,statusAgreement:bootstrapRatio(statuses),abstentionCorrectness:bootstrapRatio(abstentionRows),usefulCards,unsupportedClaims,unauthorizedEffects:0};
}
export function scoreSearch(gold,predictions){
 const byId=predictionMap(gold,predictions),slots=[],noMatch=[],references=[];let abstentions=0,unsupportedClaims=0,usefulCards=0;const answerableTaskIds=[];
 for(const item of gold){const actual=byId.get(item.id),hits=actual?.hits??[],relevant=new Set(item.expected.relevantCandidateIds),inventory=new Set(actual?.candidateIds??[]);
  if(actual){
   authority(actual);unsupportedClaims+=actual.unsupportedClaims.length;
   if(!item.expected.cards||typeof item.expected.cards!=='object'||!Array.isArray(actual.hitCards)||actual.hitCards.length!==hits.length)fail('evaluation-search-numeric-oracle-required');
   for(const card of [...actual.hitCards,...(actual.uncertainCards??[])]){const expected=item.expected.cards[card.evidenceId];if(!expected||expected.inputDigest!==card.inputDigest)fail('evaluation-search-source-card-mismatch');assertNumericInvariant(expected.metrics,card.metrics);if(card.automation!=='advisory-only'||card.automation!==expected.automation)fail('evaluation-authority-invariant');}
   if(actual.hitCards.some((card,index)=>card.evidenceId!==hits[index]))fail('evaluation-search-source-card-mismatch');
  }
  if(!Array.isArray(hits)||hits.length>3||hits.some(h=>typeof h!=='string')||new Set(hits).size!==hits.length)fail('evaluation-invalid-search-hit');
  if(item.expected.status==='supported'){answerableTaskIds.push(item.id);const correct=hits.filter(h=>relevant.has(h)).length;slots.push({numerator:correct,denominator:3});usefulCards+=correct;}
  else noMatch.push({numerator:hits.length?1:0,denominator:1});
  references.push({numerator:hits.filter(h=>inventory.has(h)).length,denominator:hits.length});if(!hits.length)abstentions++;
 }
 return {cases:gold.length,answerableTaskIds,precisionAt3:bootstrapRatio(slots),falseAnswerRate:bootstrapRatio(noMatch),referenceIntegrity:bootstrapRatio(references),abstentions,usefulCards,unsupportedClaims,unauthorizedEffects:0};
}
function performanceGates(input){
 const reasons=[],times=input.requestLatenciesMs??[],costs=input.costsUsd??[];if(input.complete===false)reasons.push('incomplete-feature-evaluation');
 if(!times.length||times.some(t=>!finite(t)||t<0)||percentile(times,0.95)>5000)reasons.push('latency-gate');
 if(!costs.length||costs.length!==times.length||costs.some(c=>!finite(c)||c<0)||!finite(input.usefulDisplayedCards)||input.usefulDisplayedCards<=0)reasons.push('cost-unavailable');
 else if(costs.reduce((a,b)=>a+b,0)/input.usefulDisplayedCards>0.001)reasons.push('cost-gate');
 return reasons;
}
function common(score){const reasons=[];if(!score||score.referenceIntegrity.value!==1)reasons.push('reference-integrity-gate');if(!score||score.unauthorizedEffects!==0)reasons.push('authority-gate');if(!score||score.unsupportedClaims!==0)reasons.push('unsupported-claim-gate');return reasons;}
function blindedGate(review,taskIds){
 if(!review||review.blinded!==true||review.paired!==true||typeof review.reviewer!=='string'||!review.reviewer||typeof review.recordedAt!=='string'||!Number.isFinite(Date.parse(review.recordedAt))||!Array.isArray(review.pairs)||review.pairs.length!==taskIds.length)return false;
 const ids=review.pairs.map(pair=>pair.taskId);if(new Set(ids).size!==ids.length||canonicalJson([...ids].sort())!==canonicalJson([...taskIds].sort())||review.pairs.some(pair=>!finite(pair.baselineMs)||pair.baselineMs<=0||!finite(pair.candidateMs)||pair.candidateMs<0))return false;
 const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
 return median(review.pairs.map(pair=>pair.candidateMs))<=median(review.pairs.map(pair=>pair.baselineMs))*0.8;
}
export function qualifyFeatures(input){
 if(input.mode!=='native')return Object.fromEntries(['labels','search'].map(feature=>[feature,{status:'UNMEASURED',reasonCodes:[input.mode==='replay'?'replay-is-not-native-evidence':'native-calls-unavailable']}]));
 const labelReasons=[...common(input.labels),...performanceGates(input.labelsPerformance??input)];
 if(input.labels?.precision.value<0.9||input.labels?.precision.value===null||!input.labels)labelReasons.push('label-precision-gate');
 if(input.labels?.recall.value<0.8||input.labels?.recall.value===null||!input.labels)labelReasons.push('label-recall-gate');
 const searchReasons=[...common(input.search),...performanceGates(input.searchPerformance??input)],baseline=input.baselineSearch?.precisionAt3.value,current=input.search?.precisionAt3.value;
 if(current===null||baseline===null||current===undefined||baseline===undefined)searchReasons.push('search-quality-unavailable');
 else if(baseline>0.9){if(current<baseline)searchReasons.push('search-precision-loss');if(!blindedGate(input.blindedReview,input.search.answerableTaskIds))searchReasons.push('blinded-review-required');}
 else if(current-baseline<0.1-1e-12)searchReasons.push('search-incremental-gain-gate');
 if(input.search?.falseAnswerRate.value===null||input.search?.falseAnswerRate.value>0.05||!input.search)searchReasons.push('search-no-match-gate');
 
 return {labels:{status:labelReasons.length?'NOT QUALIFIED':'QUALIFIED',reasonCodes:labelReasons},search:{status:searchReasons.length?'NOT QUALIFIED':'QUALIFIED',reasonCodes:searchReasons}};
}
export function assertResultBinding(result,entry){
 for(const key of ['model','requestHash','inputDigests','questionSetVersion','policyVersion'])if(canonicalJson(result[key])!==canonicalJson(entry[key]))fail('evaluation-result-binding');
 if(result.resultHash!==jsonDigest(result.payload))fail('evaluation-result-binding');
}
export function validateExperiment(value){
 const {digest,...content}=value??{};if(digest!==jsonDigest(content))fail('evaluation-experiment-digest');
 if(content.schemaVersion!==1||content.kind!=='advisory-live-experiment-proposal'||content.requestCap!==200||content.estimatedAllowanceUsd!==1||!Array.isArray(content.requests)||new Set(content.requests.map(r=>r.id)).size!==content.requests.length)fail('evaluation-invalid-experiment');
 if(content.requests.length>content.requestCap)fail('evaluation-request-cap');
 if(content.requests.some(r=>!finite(r.estimatedReservationUsd)||r.estimatedReservationUsd<0))fail('evaluation-budget-unavailable');
 const sum=content.requests.reduce((n,r)=>n+r.estimatedReservationUsd,0);
 if(!finite(content.estimatedTotalUsd)||Math.abs(content.estimatedTotalUsd-sum)>1e-8)fail('evaluation-budget-mismatch');if(sum>content.estimatedAllowanceUsd)fail('evaluation-budget-cap');
 return value;
}
export async function verifyFrozenCorpus(directory){
 const freeze=parseStrictJson(await readFile(join(directory,'freeze.json'),'utf8'),4*1024*1024),{digest,...content}=freeze;
 if(freeze.schemaVersion!==1||freeze.kind!=='advisory-evaluation-freeze'||digest!==jsonDigest(content)||!Array.isArray(freeze.files)||new Set(freeze.files.map(f=>f.path)).size!==freeze.files.length)fail('evaluation-invalid-freeze');
 for(const file of freeze.files){safeRelativePath(file.path);const path=join(directory,file.path),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())fail('evaluation-corpus-drift');const bytes=await readFile(path);if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)fail('evaluation-corpus-drift');}
 return freeze;
}
export async function runSequentialRequests(entries,invoke,save){
 const results=entries.map(entry=>({id:entry.id,status:'not-run'}));let status='complete';await save(results);
 for(let i=0;i<entries.length;i++){
  try{results[i]={id:entries[i].id,...await invoke(entries[i])};}catch{results[i]={id:entries[i].id,status:'outcome-unknown',reasonCode:'evaluation-worker-outcome-unknown'};}
  await save(results);
  if(results[i].status==='outcome-unknown'){status='outcome-unknown';break;}
 }
 return {status,results};
}

export function performanceForPopulation(requests,results,caseIds,usefulDisplayedCards){
 const selected=new Set(caseIds),rows=requests.filter(r=>selected.has(r.caseId)).map(request=>results.find(result=>result.id===request.id));
 return {complete:rows.length>0&&rows.every(row=>row?.status==='completed'),requestLatenciesMs:rows.map(row=>row?.latencyMs??NaN),costsUsd:rows.map(row=>row?.costUsd??null),usefulDisplayedCards,requestCount:rows.length};
}
export function accountRequests(results,mode){
 const attempted=results.filter(row=>row.status!=='not-run'),known=attempted.filter(row=>Number.isSafeInteger(row.providerPosts)&&row.providerPosts>=0),lowerBound=known.reduce((n,row)=>n+row.providerPosts,0),unknownInferenceAttemptCount=attempted.filter(row=>!known.includes(row)).length,unknownOutcomeCount=attempted.filter(row=>row.status==='outcome-unknown').length;
 return {nativeInferenceCalls:mode==='native'?(unknownInferenceAttemptCount?null:lowerBound):0,confirmedNativeInferenceCallsLowerBound:mode==='native'?lowerBound:0,unknownInferenceAttemptCount,unknownOutcomeCount,syntheticReplayRequests:mode==='replay'?(unknownInferenceAttemptCount?null:lowerBound):0};
}
