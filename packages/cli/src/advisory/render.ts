import type { EvidenceBundleV1 } from './contracts.js';
import type { SearchPayload, SearchHit } from './search.js';
import type { AdvisoryReport, EvidenceCard } from './rules.js';

export function escapeMarkdown(value:string):string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu,' ').replace(/&/gu,'&amp;').replace(/</gu,'&lt;').replace(/>/gu,'&gt;').replace(/[\\`*_{}[\]()#+.!|]/gu,'\\$&');
}
export function sourceUrl(card:{evidence:Pick<EvidenceBundleV1,'repository'|'run'|'workflow'>},lineStart=1,lineEnd=lineStart,path=card.evidence.workflow.path):string {
  const b=card.evidence;return `https://github.com/${b.repository.name}/blob/${b.run.headSha}/${path.split('/').map(encodeURIComponent).join('/')}#L${lineStart}-L${lineEnd}`;
}
export function renderCard(card:EvidenceCard):string {
  const b=card.evidence,run=`https://github.com/${b.repository.name}/actions/runs/${b.run.id}/attempts/${b.run.attempt}`;
  const lines=[`### ${escapeMarkdown(b.job.name)} — advisory-only`, `[Run ${b.run.id}, attempt ${b.run.attempt}](${run}) · [Job ${b.job.id}](https://github.com/${b.repository.name}/actions/runs/${b.run.id}/job/${b.job.id})`,
    `Duration: ${card.durationMs===null?'unavailable':`${card.durationMs/1000} seconds`}; rounded minutes: ${card.roundedMinutes??'unavailable'}; GitHub hosted charge: ${card.githubHostedChargeUsd===0?'$0 (public hosted execution)':'unavailable'}.`,
    `Source mapping: ${b.mapping}.`];
  for(const step of card.steps){
    lines.push(`- ${escapeMarkdown(step.name)}: ${step.category}; ${step.durationMs===null?'unavailable':`${step.durationMs/1000}s`}; share ${step.share===null?'unavailable':`${(step.share*100).toFixed(1)}%`}${step.investigate?'; investigate dependency installation':''}${step.lineStart!==null&&step.lineEnd!==null?` ([source](${sourceUrl(card,step.lineStart,step.lineEnd)}))`:''}.`);
  }
  if(card.semanticLabels?.length){lines.push('Optional Jev observations (native quality UNMEASURED):');for(const label of card.semanticLabels)if(label.support!=='absent')lines.push(`- ${escapeMarkdown(label.category)}: ${label.support}, probability ${label.probability}; excerpt ${escapeMarkdown(label.excerptId)} ([source](${sourceUrl(card,label.lineStart,label.lineEnd,label.sourcePath)})).`);}
  if(card.repeated.length)lines.push('Byte-identical repeated commands observed; this does not establish redundant work.');
  if(b.reasonCodes.length)lines.push(`Missing or limited evidence: ${b.reasonCodes.map(escapeMarkdown).join(', ')}.`);
  return lines.join('\n\n');
}
function inertExcerpt(text:string):string {
 const safe=text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0')).replace(/\r(?!\n)/gu,'\\r');
 const fence='`'.repeat((safe.match(/`+/gu)??[]).reduce((maximum,run)=>Math.max(maximum,run.length+1),3));
 return `${fence}text\n${safe}${safe.endsWith('\n')?'':'\n'}${fence}`;
}
function renderSearchHit(hit:SearchHit,uncertain=false):string {
 const b=hit.card.evidence,e=hit.excerpt;
 return [`${uncertain?'Uncertain candidate':'Evidence'} ${escapeMarkdown(e.id)} — ${escapeMarkdown(b.job.name)}`,
 `[source](${sourceUrl(hit.card,e.lineStart,e.lineEnd,e.sourcePath)}) · [run ${b.run.id}, attempt ${b.run.attempt}](https://github.com/${b.repository.name}/actions/runs/${b.run.id}/attempts/${b.run.attempt}) · [job ${b.job.id}](https://github.com/${b.repository.name}/actions/runs/${b.run.id}/job/${b.job.id})`,
 `Observed job duration: ${hit.card.durationMs===null?'unavailable':hit.card.durationMs/1000+' seconds'}; rounded minutes: ${hit.card.roundedMinutes??'unavailable'}${hit.probability===null?'':`; selection probability ${hit.probability}; relevance ${hit.relevance}`}.`,
 inertExcerpt(e.originalText)].join('\n\n');
}
function renderSearchPayload(payload:SearchPayload):string[]{
 return [`Question: ${escapeMarkdown(payload.query)}`,`Method: ${payload.method}; intent: ${payload.intent}; candidates: ${payload.candidateCount}.`,
 ...(payload.hits.length?payload.hits.map(hit=>renderSearchHit(hit)):['No matching evidence is supported.']),
 ...payload.uncertainCandidates.map(hit=>renderSearchHit(hit,true))];
}
export function renderReport(value:AdvisoryReport):string {
  const payload=value.payload as {cards?:EvidenceCard[];kind?:string};
  return [`Advisory status: ${value.status}`,value.reasonCodes.map(escapeMarkdown).join(', '),
    ...(payload.kind==='search'?renderSearchPayload(value.payload as SearchPayload):payload.cards?payload.cards.length?payload.cards.map(renderCard):['No opportunities: no evidence bundles supplied.']: [escapeMarkdown(JSON.stringify(value.payload))]),
    ...value.limitations.map(escapeMarkdown),...value.nextActions.map(escapeMarkdown)].filter(Boolean).join('\n\n')+'\n';
}
