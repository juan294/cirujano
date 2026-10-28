import type { EvidenceBundleV1 } from './contracts.js';
import type { ComparisonPayload } from './compare.js';
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
function signed(value:number):string{return `${value>0?'+':''}${value}`;}
function percent(value:number|null):string{return value===null?'undefined (zero baseline)':`${signed(Number(value.toFixed(2)))}%`;}
function comparisonSource(repository:string,sha:string,path:string,start?:number,end?:number):string{
 return `https://github.com/${repository}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}${start!==undefined&&end!==undefined?`#L${start}-L${end}`:''}`;
}
function renderComparisonPayload(payload:ComparisonPayload):string[]{
 const b=payload.baseline,c=payload.candidate;
 const lines=['Observations',`Samples: ${b.sampleCount} baseline; ${c.sampleCount} candidate.`,
  `Median job duration: ${b.medianDurationMs/1000} → ${c.medianDurationMs/1000} seconds; change ${signed(payload.delta.durationMs/1000)} seconds (${percent(payload.delta.durationPercent)}).`,
  `Median rounded job minutes: ${b.medianRoundedMinutes} → ${c.medianRoundedMinutes}; change ${signed(payload.delta.roundedMinutes)} (${percent(payload.delta.roundedMinutesPercent)}).`,
  `Observed regression threshold met: ${payload.regression?'yes':'no'}. This is an observational comparison, not causal proof or measured optimization success.`,
  `Baseline window: ${escapeMarkdown(b.window.startedAt)} through ${escapeMarkdown(b.window.completedAt)}. Candidate window: ${escapeMarkdown(c.window.startedAt)} through ${escapeMarkdown(c.window.completedAt)}.`,
  `[Baseline source](${comparisonSource(b.source.repository,b.source.headSha,b.source.workflowPath)}) · [Candidate source](${comparisonSource(c.source.repository,c.source.headSha,c.source.workflowPath)})`];
 for(const [label,cohort] of [['Baseline',b],['Candidate',c]] as const)lines.push(`${label} runs: ${cohort.runs.map(r=>`[${r.runId}, attempt ${r.attempt}, job ${r.jobId}](https://github.com/${cohort.source.repository}/actions/runs/${r.runId}/attempts/${r.attempt})`).join(', ')}`);
 for(const step of payload.matchedSteps){const left=step.baselineReferences[0]!,right=step.candidateReferences[0]!;lines.push(`Matched ${escapeMarkdown(step.name)} (${step.category}): ${step.baselineMedianMs/1000} → ${step.candidateMedianMs/1000} seconds; change ${signed(step.deltaMs/1000)} seconds. [Baseline step](${comparisonSource(left.repository,left.headSha,left.workflowPath,left.lineStart,left.lineEnd)}) · [Candidate step](${comparisonSource(right.repository,right.headSha,right.workflowPath,right.lineStart,right.lineEnd)})`);}
 for(const step of payload.unmatchedSteps)lines.push(`Unmatched ${step.cohort} step ${escapeMarkdown(step.name)}: ${escapeMarkdown(step.reason)}; no matched timing attribution.`);
 for(const category of payload.categoryDeltas)lines.push(`Matched ${category.category} category observations: ${category.baselineMedianMs/1000} → ${category.candidateMedianMs/1000} seconds; change ${signed(category.deltaMs/1000)} seconds.`);
 lines.push('Hypotheses');
 if(!payload.hypotheses.length)lines.push('No semantic hypotheses supplied; the comparison used local evidence only.');
 for(const hypothesis of payload.hypotheses){
  lines.push(`${escapeMarkdown(hypothesis.category)}: ${hypothesis.status}, probability ${hypothesis.probability}. ${escapeMarkdown(hypothesis.text)}`);
  for(const excerpt of hypothesis.evidence){const cohort=b.runs.some(r=>r.inputDigest===excerpt.evidenceDigest)?b:c;lines.push(`[Evidence ${escapeMarkdown(excerpt.id)}](${comparisonSource(cohort.source.repository,cohort.source.headSha,excerpt.sourcePath,excerpt.lineStart,excerpt.lineEnd)})`);}
  lines.push(`Alternatives: ${hypothesis.alternatives.map(escapeMarkdown).join(' ')}`,`Missing facts: ${hypothesis.missingFacts.map(escapeMarkdown).join(' ')}`);
 }
 return lines;
}
export function renderReport(value:AdvisoryReport):string {
  const payload=value.payload as {cards?:EvidenceCard[];kind?:string};
  return [`Advisory status: ${value.status}`,value.reasonCodes.map(escapeMarkdown).join(', '),
    ...(payload.kind==='comparison'?renderComparisonPayload(value.payload as ComparisonPayload):payload.kind==='search'?renderSearchPayload(value.payload as SearchPayload):payload.cards?payload.cards.length?payload.cards.map(renderCard):['No opportunities: no evidence bundles supplied.']: [escapeMarkdown(JSON.stringify(value.payload))]),
    ...value.limitations.map(escapeMarkdown),...value.nextActions.map(escapeMarkdown)].filter(Boolean).join('\n\n')+'\n';
}
