import { assertSafeEvidenceSource, type EvidenceBundleV1 } from './contracts.js';
import type { LocalExcerpt } from './inference-contracts.js';
import { enumerateEvidenceExcerpts } from './projection.js';

export type SearchIntent='find-install'|'find-build'|'find-tests'|'find-cache-evidence'|'generic-evidence-search';
const stopWords=new Set(['a','an','and','or','the','to','of','for','in','on','at','with','from','where','which','find','show','me','is','are','does','do','how','why','what','time','consuming','spending','spend','work','evidence','please']);
const synonyms:Record<string,string>={dependency:'install',dependencies:'install',setup:'install',installation:'install',installing:'install',installs:'install',packages:'install',builds:'build',building:'build',compile:'build',compiles:'build',compiler:'build',compiling:'build',compilation:'build',transpile:'build',bundle:'build',bundling:'build',tests:'test',testing:'test',vitest:'test',jest:'test',pytest:'test',unittest:'test',caching:'cache',cached:'cache',misses:'miss',artifacts:'artifact',upload:'artifact',download:'artifact',transfer:'artifact'};
export function validateSearchQuery(query:string):void{
 if(typeof query!=='string'||!query.trim()||Buffer.byteLength(query)>4096||/[\u0000-\u001f\u007f]/u.test(query))throw new Error('search-invalid-query');
 try{assertSafeEvidenceSource(query,'query');}catch{throw new Error('search-sensitive-query');}
}
export function actionScopeQuery(query:string):boolean{
 return /\b(?:delete|remove|disable|skip|change|edit|modify|rewrite|toggle|route)\b/i.test(query)&&/\b(?:checks?|tests?|ci|workflows?|cadence|routing|pipeline)\b/i.test(query);
}
function tokens(text:string):Set<string>{return new Set((text.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}_-]+/gu)??[]).filter(t=>!stopWords.has(t)).map(t=>synonyms[t]??t));}
export function searchIntent(query:string):SearchIntent{
 const words=tokens(query),categories=['install','build','test','cache'].filter(t=>words.has(t));if(categories.length!==1)return 'generic-evidence-search';
 return ({install:'find-install',build:'find-build',test:'find-tests',cache:'find-cache-evidence'} as const)[categories[0] as 'install'|'build'|'test'|'cache'];
}
export interface SearchCandidate {excerpt:LocalExcerpt;score:number}
/** Lexical score uses retained text only; names/ordinals never create a matching claim. */
export function shortlistEvidence(bundles:EvidenceBundleV1[],query:string):SearchCandidate[]{
 validateSearchQuery(query);const wanted=tokens(query);
 return enumerateEvidenceExcerpts(bundles).map(excerpt=>{const words=tokens(excerpt.originalText);let score=0;for(const word of wanted)if(words.has(word))score++;return {excerpt,score};}).sort((a,b)=>b.score-a.score||a.excerpt.id.localeCompare(b.excerpt.id)).slice(0,20);
}
