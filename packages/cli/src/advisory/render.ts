import type { AdvisoryReport, EvidenceCard } from './rules.js';

export function escapeMarkdown(value:string):string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu,' ').replace(/&/gu,'&amp;').replace(/</gu,'&lt;').replace(/>/gu,'&gt;').replace(/[\\`*_{}[\]()#+.!|]/gu,'\\$&');
}
export function sourceUrl(card:EvidenceCard,lineStart=1,lineEnd=lineStart,path=card.evidence.workflow.path):string {
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
export function renderReport(value:AdvisoryReport):string {
  const payload=value.payload as {cards?:EvidenceCard[]};
  return [`Advisory status: ${value.status}`,value.reasonCodes.map(escapeMarkdown).join(', '),
    ...(payload.cards?payload.cards.length?payload.cards.map(renderCard):['No opportunities: no evidence bundles supplied.']: [escapeMarkdown(JSON.stringify(value.payload))]),
    ...value.limitations.map(escapeMarkdown),...value.nextActions.map(escapeMarkdown)].filter(Boolean).join('\n\n')+'\n';
}
