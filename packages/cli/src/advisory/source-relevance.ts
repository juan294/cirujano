import {lexicalTerms,validateSearchQuery} from './search-candidates.js';

export const SOURCE_SEARCH_POLICY='declared-source-search-v2' as const;
type Topic='install'|'build'|'test'|'artifact'|'cache'|'checkout'|'needs'|'condition'|'resource';
const filler=new Set(['retained','repository','repositories','inventory','source','workflow','workflows','job','jobs','step','steps','command','commands','declare','declares','declared','declaration','declarations','configured','configure','configuration','entrypoint','entrypoints','invoked','invoke','invokes','existing','observations','observation','within','each','twenty','named','location','locations','defined','provide','provides']);
const locationVerb='(?:declar(?:e|ed|es|ation|ations)|configur(?:e|ed|es|ation|ations)|entrypoints?|invok(?:e|ed|es|ing)|upload(?:s|ed|ing)?|download(?:s|ed|ing)?|inline)';
const declarationLocation=new RegExp('\\bwhere\\b.*\\b'+locationVerb+'\\b|\\bwhich\\b.*\\b(?:commands?|steps?|jobs?)\\b.*\\b'+locationVerb+'\\b','u');
const operations:Record<Topic,RegExp>={
 install:/^(?:(?:sudo|corepack)\s+)?(?:(?:pnpm|npm|yarn)\s+(?:install|ci)\b|(?:python(?:3)?\s+-m\s+)?pip(?:3)?\s+install\b|(?:apt(?:-get)?|apk|dnf|yum|brew)\s+(?:install|add)\b)/iu,
 build:/^(?:(?:pnpm|npm|yarn)\s+(?:run\s+)?build\b|(?:npx\s+)?(?:tsc|webpack|rollup)\b|(?:vite|cargo|go)\s+build\b|make\b)/iu,
 test:/^(?:(?:pnpm|npm|yarn)\s+(?:run\s+)?(?:test|coverage)\b|(?:npx\s+)?(?:vitest|jest|pytest)\b|node\b.*\s--test\b|python(?:3)?\s+-m\s+(?:pytest|unittest|coverage)\b)/iu,
 artifact:/^(?:uses:\s*["']?actions\/(?:upload|download)-artifact@|(?:tar|zip)\s)/iu,
 cache:/^(?:cache(?:-dependency-path)?|restore-keys)\s*:|^uses:\s*["']?actions\/cache@/iu,
 checkout:/^uses:\s*["']?actions\/checkout@|^(?:repository|ref|sparse-checkout(?:-cone)?)\s*:/iu,
 needs:/^needs\s*:/iu,
 condition:/^(?:if|needs)\s*:/iu,
 resource:/^(?:CIRUJANO_QEMU_CPUS|QEMU_CPU_LIMIT|NODE_OPTIONS)\s*:/u,
};
function body(line:string):string {
 let value=line.trim().replace(/^-\s+/u,'').replace(/^run:\s*/u,'');
 if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
 return value;
}
export function sourceQueryPolicy(query:string):{reasonCode:string|null;score:(line:string)=>number} {
 validateSearchQuery(query);const lower=query.toLocaleLowerCase('en-US'),words=lexicalTerms(query);
 const declaration=declarationLocation.test(lower);
 const runtime=/\b(?:logs?|traces?|results?|records?|metrics?|measurements?|durations?|timings?)\b/u.test(lower)||/\b(?:actually\s+(?:ran|run|executed)|time\s+(?:was\s+)?wasted|caused\s+by|cache\s+(?:hits?|miss(?:es)?))\b/u.test(lower);
 const externalBody=/\b(?:package\.json|package\s+manifest|helper\s+bod(?:y|ies)|script\s+bod(?:y|ies)|reusable[- ]workflow\s+implementation)\b/u.test(lower);
 const wanted=[...words].filter(word=>!filler.has(word));
 const logProof=/\b(?:logs?|traces?)\b/u.test(lower)&&/\b(?:prov(?:e|es|ed|ing)|establish(?:es)?|actual|caused)\b/u.test(lower);
 const reasonCode=(logProof||(!declaration&&runtime))?'source-runtime-evidence-unavailable':!declaration&&externalBody?'source-implementation-evidence-unavailable':wanted.length===0?'source-query-needs-specific-terms':null;
 const topics:Topic[]=[];
 if(words.has('install')||/\b(?:installed|prerequisites?)\b/u.test(lower))topics.push('install');
 for(const topic of ['build','test','artifact','cache'] as const)if(words.has(topic)||(topic==='test'&&words.has('coverage')))topics.push(topic);
 if(/\bcheckouts?\b/u.test(lower))topics.push('checkout');
 if(/\b(?:upstream|wait|needs|depends?\s+on)\b/u.test(lower))topics.push('needs');
 if(/\b(?:conditions?|eligibility)\b/u.test(lower))topics.push('condition');
 if(/\b(?:cpu|cpus|qemu|memory)\b/u.test(lower))topics.push('resource');
 const systemInstall=/\b(?:operating[- ]system|system\s+packages|apt(?:-get)?|apk|brew)\b/u.test(lower);
 return {reasonCode,score(line){
  if(reasonCode||/^\s*(?:#|name\s*:)/iu.test(line))return 0;
  const text=body(line),terms=lexicalTerms(text);let overlap=0;
  for(const word of wanted)if(terms.has(word))overlap++;
  if(topics.length){
   const matched=topics.filter(topic=>operations[topic].test(text));if(!matched.length)return 0;
   if(matched.includes('install')&&systemInstall&&!/^(?:sudo\s+)?(?:apt(?:-get)?|apk|dnf|yum|brew)\b/iu.test(text))return 0;
   return matched.length*4+overlap;
  }
  return overlap>=Math.min(2,wanted.length)?overlap:0;
 }};
}
