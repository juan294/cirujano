import { gitBlobSha, jsonDigest, parseWorkflowSource, safeRelativePath } from '@cirujano/core';
import { redactCredentialShapes } from '@cirujano/runner';

export interface EvidenceStep {
  number: number; name: string; startedAt: string | null; completedAt: string | null; conclusion: string | null;
  sourceIndex: number | null; command: string | null; lineStart: number | null; lineEnd: number | null;
}
export interface EvidenceSource { path: string; blobSha: string; content: string; lineStart: number; lineEnd: number }
export interface EvidenceBundleV1 {
  schemaVersion: 1; kind: 'advisory-evidence';
  repository: { id: number; name: string; visibility: 'public' | 'private' | 'synthetic' };
  run: { id: number; attempt: number; headSha: string; event: string };
  workflow: { path: string; blobSha: string | null };
  job: { id: number; key: string; name: string; labels: string[]; conclusion: string | null; startedAt: string | null; completedAt: string | null };
  steps: EvidenceStep[]; sources: EvidenceSource[]; mapping: 'supported' | 'unsupported-mapping'; reasonCodes: string[];
  fetchedAt: string; toolSourceSha: string; apiVersion: '2022-11-28'; digest: string;
  datumStatus: Record<string, 'present' | 'missing' | 'ambiguous'>;
}
export class AdvisoryEvidenceError extends Error { constructor(reason: string) { super(reason); this.name = 'AdvisoryEvidenceError'; } }
export function evidenceFail(reason: string): never { throw new AdvisoryEvidenceError(reason); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !(k in value))) evidenceFail('invalid-evidence-fields');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 2048): asserts value is string { if (typeof value !== 'string' || !value || Buffer.byteLength(value) > max) evidenceFail('invalid-evidence-string'); }
function positive(value: unknown): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) <= 0) evidenceFail('invalid-evidence-id'); }
function sha(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) evidenceFail('invalid-evidence-sha'); }
function nullableString(value: unknown) { if (value !== null) string(value); }
function time(value: unknown): asserts value is string | null { if (value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) evidenceFail('invalid-evidence-timing'); }
function times(start: unknown, end: unknown) { time(start); time(end); if (start !== null && end !== null && Date.parse(end) < Date.parse(start)) evidenceFail('contradictory-evidence-timing'); }
function strings(value: unknown, max: number): asserts value is string[] { if (!Array.isArray(value) || value.length > max) evidenceFail('invalid-evidence-list'); value.forEach(v => string(v)); if (new Set(value).size !== value.length) evidenceFail('duplicate-evidence-value'); }
function hasExpression(value: unknown): boolean { if (typeof value==='string') return value.includes('${{'); if (Array.isArray(value)) return value.some(hasExpression); if (value && typeof value==='object') return Object.values(value).some(hasExpression); return false; }
/** Shared source-to-execution check: API ordinals never select a workflow step. */
export function mapWorkflowSteps(workflow: EvidenceSource, jobKey: string, jobName: string, observed: EvidenceStep[]): EvidenceStep[] | null {
  try {
    const parsed=parseWorkflowSource(workflow.content), jobs=parsed.jobs as Record<string,unknown>, raw=jobs?.[jobKey];
    if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null; const job=raw as Record<string,unknown>;
    if ('strategy' in job || 'uses' in job || !Array.isArray(job.steps) || (job.name??jobKey)!==jobName || hasExpression(job.name)) return null;
    const source=job.steps as Record<string,unknown>[];
    if (source.length>200 || source.some(step=>!step || typeof step!=='object' || Array.isArray(step) || typeof step.name!=='string' || !step.name || /^(?:Set up job|Complete job|Post )/.test(step.name) || hasExpression(step) || (step.run!==undefined && typeof step.run!=='string') || (typeof step.uses==='string' && !/^(?:actions\/(?:checkout|setup-node|cache|upload-artifact|download-artifact)|pnpm\/action-setup)@/.test(step.uses)))) return null;
    const names=source.map(s=>s.name as string);if(new Set(names).size!==names.length)return null;
    const execution=[...observed];if(execution[0]?.name==='Set up job')execution.shift();
    if(execution.length<source.length || execution.slice(0,source.length).some((step,index)=>step.name!==names[index]) || execution.slice(source.length).some(step=>step.name!=='Complete job'&&!step.name.startsWith('Post ')))return null;
    if(new Set(execution.slice(0,source.length).map(s=>s.name)).size!==source.length)return null;
    return observed.map(step=>{const index=names.indexOf(step.name);if(index<0)return {...step,sourceIndex:null,command:null,lineStart:null,lineEnd:null};const original=source[index]!;return {...step,sourceIndex:index,command:typeof original.run==='string'?original.run:null,lineStart:1,lineEnd:workflow.lineEnd};});
  } catch {return null;}
}
/** Known credential assignment forms, including camelCase keys in raw source text. */
export function hasCredentialAssignment(content:string):boolean {
  return /\b["']?[A-Za-z0-9_-]*(?:token|password|passwd|secret|api[_-]?key|authorization|credential)[A-Za-z0-9_-]*["']?\s*[:=]/i.test(content);
}
/** Conservative refusal, not a claim that regex detection proves confidentiality. */
export function assertSafeEvidenceSource(content: string, path: string): void {
  const dangerousKey=/(?:^|[\n,{])\s*["']?(?:env(?:ironment)?|(?:[A-Za-z0-9]+[_-])?(?:token|password|secret|api[_-]?key|authorization))["']?\s*[:=]/im;
  const environmentAssignment=/(?:^|[\s;])(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*[^\s]/m;
  if (/(?:^|\/)\.env(?:\.|$)/i.test(path) || redactCredentialShapes(content)!==content || hasCredentialAssignment(content) || dangerousKey.test(content) || environmentAssignment.test(content) || /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/i.test(content) || /https?:\/\/[^\s/@]+:[^\s/@]+@/i.test(content) || /\$\{\{\s*secrets(?:[.\[])/i.test(content)) evidenceFail('unsafe-source-credential-or-environment');
}
function datumStatuses(value: Pick<EvidenceBundleV1,'workflow'|'job'|'steps'|'mapping'>): EvidenceBundleV1['datumStatus'] {
  const states: EvidenceBundleV1['datumStatus']={'workflow.blobSha':value.workflow.blobSha===null?'missing':'present','workflow.executedSource':value.mapping==='supported'?'present':'ambiguous'};
  for(const key of ['startedAt','completedAt','conclusion'] as const)states[`job.${key}`]=value.job[key]===null?'missing':'present';
  for(const step of value.steps)for(const key of ['startedAt','completedAt','conclusion','sourceIndex','command','lineStart','lineEnd'] as const)states[`steps.${step.number}.${key}`]=step[key]===null?(value.mapping==='unsupported-mapping'&&['sourceIndex','command','lineStart','lineEnd'].includes(key)?'ambiguous':'missing'):'present';
  return states;
}
export function evidenceIdentity(value: EvidenceBundleV1): string { return `${value.repository.id}/${value.run.id}/${value.run.attempt}/${value.job.id}`; }

/** Validate retained evidence, including the digest and every attribution against immutable source. */
export function decodeEvidence(value: unknown): EvidenceBundleV1 {
  const bundle = object(value, ['schemaVersion','kind','repository','run','workflow','job','steps','sources','mapping','reasonCodes','fetchedAt','toolSourceSha','apiVersion','digest','datumStatus']);
  if (bundle.schemaVersion !== 1 || bundle.kind !== 'advisory-evidence' || bundle.apiVersion !== '2022-11-28') evidenceFail('invalid-evidence-version');
  const repository = object(bundle.repository,['id','name','visibility']); positive(repository.id); string(repository.name,512);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.name) || repository.name.split('/').some(v => v === '.' || v === '..') || !['public','private','synthetic'].includes(String(repository.visibility))) evidenceFail('invalid-evidence-repository');
  const run = object(bundle.run,['id','attempt','headSha','event']); positive(run.id); positive(run.attempt); sha(run.headSha); string(run.event);
  const workflow = object(bundle.workflow,['path','blobSha']); string(workflow.path); safeRelativePath(workflow.path); if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(workflow.path)) evidenceFail('invalid-evidence-workflow'); if (workflow.blobSha !== null) sha(workflow.blobSha);
  const job = object(bundle.job,['id','key','name','labels','conclusion','startedAt','completedAt']); positive(job.id); string(job.key); if(!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(job.key))evidenceFail('invalid-evidence-job-key'); string(job.name); strings(job.labels,100); nullableString(job.conclusion); times(job.startedAt,job.completedAt);
  if (!Array.isArray(bundle.steps) || bundle.steps.length > 200 || !Array.isArray(bundle.sources) || bundle.sources.length > 20) evidenceFail('evidence-size-limit');
  const seenSteps = new Set<number>();
  for (const raw of bundle.steps) {
    const step = object(raw,['number','name','startedAt','completedAt','conclusion','sourceIndex','command','lineStart','lineEnd']); positive(step.number); string(step.name); nullableString(step.conclusion); times(step.startedAt,step.completedAt);
    if (seenSteps.has(step.number)) evidenceFail('duplicate-evidence-step'); seenSteps.add(step.number);
    if (step.sourceIndex !== null && (!Number.isSafeInteger(step.sourceIndex) || (step.sourceIndex as number) < 0)) evidenceFail('invalid-evidence-mapping');
    if (step.command !== null && (typeof step.command !== 'string' || Buffer.byteLength(step.command) > 256*1024)) evidenceFail('evidence-size-limit');
    if (step.lineStart !== null) positive(step.lineStart); if (step.lineEnd !== null) positive(step.lineEnd);
    if (step.startedAt !== null && job.startedAt !== null && Date.parse(step.startedAt as string) < Date.parse(job.startedAt as string)) evidenceFail('contradictory-evidence-timing');
    if (step.completedAt !== null && job.completedAt !== null && Date.parse(step.completedAt as string) > Date.parse(job.completedAt as string)) evidenceFail('contradictory-evidence-timing');
  }
  let sourceBytes = 0; const paths = new Set<string>();
  for (const raw of bundle.sources) {
    const source = object(raw,['path','blobSha','content','lineStart','lineEnd']); string(source.path); safeRelativePath(source.path); sha(source.blobSha);
    if (paths.has(source.path)) evidenceFail('duplicate-evidence-source'); paths.add(source.path);
    if (typeof source.content !== 'string' || Buffer.byteLength(source.content) > 256*1024) evidenceFail('evidence-size-limit'); sourceBytes += Buffer.byteLength(source.content); assertSafeEvidenceSource(source.content,source.path);
    if (source.lineStart !== 1 || source.lineEnd !== source.content.split('\n').length) evidenceFail('invalid-evidence-source-range');
    if (gitBlobSha(source.content) !== source.blobSha) evidenceFail('evidence-blob-mismatch');
  }
  if (sourceBytes > 2*1024*1024) evidenceFail('evidence-size-limit');
  strings(bundle.reasonCodes,100); time(bundle.fetchedAt); if (bundle.fetchedAt === null) evidenceFail('invalid-evidence-timing'); sha(bundle.toolSourceSha);
  const result = bundle as unknown as EvidenceBundleV1;
  if (bundle.mapping === 'unsupported-mapping') {
    if (result.sources.length || result.steps.some(s => s.sourceIndex !== null || s.command !== null || s.lineStart !== null || s.lineEnd !== null) || !result.reasonCodes.includes('unsupported-mapping')) evidenceFail('invalid-evidence-mapping');
  } else if (bundle.mapping === 'supported') {
    if (run.event !== 'push') evidenceFail('invalid-evidence-mapping');
    const source = result.sources.find(s => s.path === result.workflow.path); if (!source || source.blobSha !== workflow.blobSha) evidenceFail('invalid-evidence-mapping');
    const mapped=mapWorkflowSteps(source,result.job.key,result.job.name,result.steps);if(!mapped)evidenceFail('invalid-evidence-mapping');
    for(let index=0;index<mapped.length;index++){
      const expected=mapped[index]!,step=result.steps[index]!;
      if(step.sourceIndex!==expected.sourceIndex || step.command!==expected.command)evidenceFail('invalid-evidence-mapping');
      if(step.sourceIndex===null){if(step.lineStart!==null||step.lineEnd!==null)evidenceFail('invalid-evidence-mapping');}
      else if(step.lineStart!==1 || step.lineEnd!==source.lineEnd)evidenceFail('invalid-evidence-mapping');
    }
  } else evidenceFail('invalid-evidence-mapping');
  if(jsonDigest(result.datumStatus)!==jsonDigest(datumStatuses(result)))evidenceFail('invalid-evidence-datum-status');
  if (typeof bundle.digest !== 'string' || !/^[a-f0-9]{64}$/.test(bundle.digest)) evidenceFail('invalid-evidence-digest');
  const { digest, ...content } = result; if (jsonDigest(content) !== digest) evidenceFail('evidence-digest-mismatch');
  return result;
}
export function sealEvidence(value: Omit<EvidenceBundleV1,'digest'|'datumStatus'> & {datumStatus?: EvidenceBundleV1['datumStatus']}): EvidenceBundleV1 {
  const content = { ...value } as Partial<EvidenceBundleV1>; delete content.digest; content.datumStatus=datumStatuses(value);
  return decodeEvidence({ ...content, digest: jsonDigest(content) });
}
