import { canonicalJson, jsonDigest, sha256 } from '@cirujano/core';
import type { EvidenceBundleV1 } from './contracts.js';
import { JEV_ENDPOINT, JEV_MODEL, type JevResponse, type LocalExcerpt, type RequestProjection } from './inference-contracts.js';
import { validateJevResponse } from './jev.js';
import type { PreparedRequestV1 } from './prepare.js';
import { ABSENT_THRESHOLD, SUPPORTED_THRESHOLD } from './questions.js';
import { observeBundle, report, validatedBundles, type AdvisoryReport, type EvidenceCard } from './rules.js';
import { actionScopeQuery, searchIntent, shortlistEvidence, validateSearchQuery, type SearchIntent } from './search-candidates.js';
import { buildSearchProjection } from './search-questions.js';

export type SearchCard=Pick<EvidenceCard,'identity'|'inputDigest'|'durationMs'|'roundedMinutes'|'githubHostedChargeUsd'|'automation'> & {evidence:Pick<EvidenceBundleV1,'repository'|'run'|'workflow'|'job'|'mapping'|'reasonCodes'>};
export interface SearchHit {excerpt:LocalExcerpt;card:SearchCard;score:number;probability:number|null;relevance:number|null}
export interface SearchPayload {kind:'search';query:string;intent:SearchIntent;method:'lexical'|'retained-jev';hits:SearchHit[];uncertainCandidates:SearchHit[];candidateCount:number}
export interface RetainedSearch {prepared:PreparedRequestV1;response:JevResponse}
function assertRetained(prepared:PreparedRequestV1,expected:RequestProjection):void{
 try{
  const actual:RequestProjection={task:prepared.task,question:prepared.question,body:prepared.body,mapping:prepared.mapping,inputDigests:prepared.inputDigests,questionSetVersion:prepared.questionSetVersion,policyVersion:prepared.policyVersion};
  const requestBody=canonicalJson(expected.body),{digest,...content}=prepared;
  if(canonicalJson(actual)!==canonicalJson(expected)||prepared.model!==JEV_MODEL||prepared.endpoint!==JEV_ENDPOINT||prepared.schemaVersion!==1||prepared.kind!=='advisory-prepared-request'||prepared.requestBody!==requestBody||prepared.requestHash!==sha256(requestBody)||prepared.requestBytes!==Buffer.byteLength(requestBody)||jsonDigest(content)!==digest)throw new Error();
 }catch{throw new Error('enrichment-search-mismatch');}
}
export function searchEvidence(inputs:EvidenceBundleV1[],query:string,retained?:RetainedSearch):AdvisoryReport<SearchPayload>{
 validateSearchQuery(query);const bundles=validatedBundles(inputs),payload:SearchPayload={kind:'search',query,intent:searchIntent(query),method:retained?'retained-jev':'lexical',hits:[],uncertainCandidates:[],candidateCount:0};
 if(actionScopeQuery(query)){
  if(retained)throw new Error('enrichment-search-mismatch');
  const result=report('no-match',payload,['search-advisory-only-scope']);result.nextActions=['Ask for existing evidence about installation, builds, tests or cache misses. CI routing changes belong to Sutura and require a separate authorized workflow.'];return result;
 }
 const candidates=shortlistEvidence(bundles,query);payload.candidateCount=candidates.length;
 const cards=new Map<string,SearchCard>();
 function hit(excerpt:LocalExcerpt,score:number,probability:number|null=null,relevance:number|null=null):SearchHit{
  let card=cards.get(excerpt.evidenceDigest);
  if(!card){
   const bundle=bundles.find(b=>b.digest===excerpt.evidenceDigest);if(!bundle)throw new Error('search-input-mismatch');
   const observed=observeBundle(bundle);const {repository,run,workflow,job,mapping,reasonCodes}=bundle;
   card={identity:observed.identity,inputDigest:observed.inputDigest,durationMs:observed.durationMs,roundedMinutes:observed.roundedMinutes,githubHostedChargeUsd:observed.githubHostedChargeUsd,automation:observed.automation,evidence:{repository,run,workflow,job,mapping,reasonCodes}};cards.set(excerpt.evidenceDigest,card);
  }
  return {excerpt,card,score,probability,relevance};
 }
 if(!retained){payload.hits=candidates.filter(c=>c.score>0).slice(0,3).map(c=>hit(c.excerpt,c.score));return report(payload.hits.length?'complete':'no-match',payload,payload.hits.length?[]:['search-no-lexical-match']);}
 const projection=buildSearchProjection(bundles,query);assertRetained(retained.prepared,projection);const response=validateJevResponse(retained.response,projection.body),exists=response.answers.answer_exists!;
 if(exists.type!=='noul')throw new Error('enrichment-search-mismatch');
 if(exists.noul<=ABSENT_THRESHOLD)return report('no-match',payload,['search-no-semantic-match']);
 const selection=response.answers.best_evidence!;if(selection.type!=='choice')throw new Error('enrichment-search-mismatch');
 const scored=projection.mapping.map(excerpt=>{const relevance=response.answers[`${excerpt.id}_relevance`]!;if(relevance.type!=='noul')throw new Error('enrichment-search-mismatch');return hit(excerpt,candidates.find(c=>c.excerpt.id===excerpt.id)?.score??0,selection.probabilities[excerpt.id]!,relevance.noul);}).sort((a,b)=>b.probability!-a.probability!||a.excerpt.id.localeCompare(b.excerpt.id));
 if(exists.noul<SUPPORTED_THRESHOLD){payload.uncertainCandidates=scored.filter(h=>h.relevance!>ABSENT_THRESHOLD).slice(0,3);return report('uncertain',payload,['search-existence-uncertain']);}
 payload.hits=scored.filter(h=>h.relevance!>=SUPPORTED_THRESHOLD).slice(0,3);payload.uncertainCandidates=scored.filter(h=>h.relevance!>ABSENT_THRESHOLD&&h.relevance!<SUPPORTED_THRESHOLD).slice(0,3);
 return report(payload.hits.length?'complete':payload.uncertainCandidates.length?'uncertain':'no-match',payload,payload.hits.length?[]:[payload.uncertainCandidates.length?'search-relevance-uncertain':'search-no-semantic-match']);
}
