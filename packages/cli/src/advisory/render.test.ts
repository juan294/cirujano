import { expect, it } from 'vitest';
import { evidenceFixture } from './fixture.js';
import { buildInbox } from './rules.js';
import { renderReport, escapeMarkdown } from './render.js';
it('renders pinned source and run references, limits and escaped content',()=>{
 const output=renderReport(buildInbox([evidenceFixture()]));
 expect(output).toContain('/blob/');expect(output).toContain('#L');expect(output).toContain('/attempts/1');expect(output).toContain('advisory');expect(output).toContain('120');
 expect(escapeMarkdown('<script>\u001b[31m[x](evil)`')).not.toContain('<script>');
 expect(renderReport(buildInbox([]))).toContain('No opportunities');
});
it('uses exact canonical job and pinned source references',()=>{
 const b=evidenceFixture(),output=renderReport(buildInbox([b]));
 expect(output).toContain(`https://github.com/${b.repository.name}/actions/runs/${b.run.id}/attempts/${b.run.attempt}`);
 expect(output).toContain(`https://github.com/${b.repository.name}/actions/runs/${b.run.id}/job/${b.job.id}`);
 expect(output).toContain(`https://github.com/${b.repository.name}/blob/${b.run.headSha}/${b.workflow.path}#L1-L${b.sources[0]!.lineEnd}`);
});
it('renders semantic support and probability with the pinned selected source path',()=>{
 const value=buildInbox([evidenceFixture()]),card=value.payload.cards[0]!;
 card.semanticLabels=[{excerptId:'e001',category:'build',probability:0.85,support:'supported',requestHash:'a'.repeat(64),sourcePath:'scripts/build file.sh',sourceIndex:null,lineStart:2,lineEnd:4}];
 const text=renderReport(value);expect(text).toContain('probability 0.85');expect(text).toContain('/scripts/build%20file.sh#L2-L4');
});
it('renders local search as concise pinned evidence rather than a generated answer',async()=>{
 const {searchEvidence}=await import('./search.js');const result=searchEvidence([evidenceFixture()],'dependency installation');
 const text=renderReport(result);expect(text).toContain('lexical');expect(text).toContain('[source](');expect(text).toContain('pnpm install');expect(text).toContain('Observed job duration: 120 seconds');
 expect(renderReport(searchEvidence([evidenceFixture()],'swimming pools'))).toContain('No matching evidence');
});
it('preserves source line breaks and tabs in inert fences and escapes terminal controls',async()=>{
 const {gitBlobSha}=await import('@cirujano/core');const {sealEvidence}=await import('./contracts.js');const {searchEvidence}=await import('./search.js');
 const b=evidenceFixture(),content='warning\n\t````<script>inert</script>\nterminal \u001b[31m\n';
 b.sources.push({path:'notes/warning.txt',blobSha:gitBlobSha(content),content,lineStart:1,lineEnd:content.split('\n').length});
 const output=renderReport(searchEvidence([sealEvidence(b)],'warning'));
 expect(output).toContain('warning\n\t````<script>inert</script>');expect(output).toContain('`````text\n');expect(output).toContain('\\u001b');expect(output).not.toContain('\u001b');
});
