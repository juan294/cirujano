import { canonicalJson, jsonDigest } from '@cirujano/core';
import { redactCredentialShapes } from '@cirujano/runner';
import { hasCredentialAssignment, type EvidenceBundleV1 } from './contracts.js';
import { JEV_MODEL, LABEL_QUESTION_VERSION, MAX_REQUEST_BYTES, type LocalExcerpt, type RequestProjection } from './inference-contracts.js';
import { labelQuestions } from './questions.js';
import { bundleIdentity, POLICY_VERSION, validatedBundles } from './rules.js';

const sensitiveKey=/(?:token|password|passwd|secret|api[_-]?key|authorization|credentials?|environment|repository|owner|username|account|sourcePath|endpoint|url|(?:^|[_-])(?:env|path)(?:$|[_-]))/i;
const environmentAssignment=/(?:^|[\s;])(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*[^\s]/m;
const credentialText=/(?:\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+|(?:^|[\n,{])\s*["']?(?:[A-Za-z0-9]+[_-])?(?:token|password|secret|api[_-]?key|authorization)["']?\s*[:=]|\$\{\{\s*secrets[.\[])/im;
const urlShape=/\b(?:https?|file|ssh|git):\/\/[^\s<>"']+/gi;
const absoluteShape=/(?:\b[A-Za-z]:\\[^\s<>"']+|\\\\[^\s<>"']+|(?:^|[\s="'(:])(?:~\/|\/)[A-Za-z0-9_.-][^\s<>"']*)/g;
function assertNoSecrets(text:string):void {
  if(redactCredentialShapes(text)!==text||hasCredentialAssignment(text)||environmentAssignment.test(text)||credentialText.test(text))throw new Error('projection-secret-bearing-payload');
}
/** Strip known identities before hashing; exact-payload human authorization is still required. */
export function sanitizeText(text:string,identities:readonly string[]=[]):string{
  assertNoSecrets(text);
  let result=text.replace(urlShape,'[redacted-url]').replace(absoluteShape,' [redacted-path]');
  for(const identity of [...new Set(identities)].filter(Boolean).sort((a,b)=>b.length-a.length)){
    const escaped=identity.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    result=result.replace(new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`,'gi'),(_match,prefix:string)=>`${prefix}[redacted-identity]`);
  }
  result=result.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[redacted-email]').replace(/(^|\s)@[A-Za-z0-9_-]+/g,'$1[redacted-account]');
  return result;
}
/** Validate keys as well as values; refusal is conservative and cannot prove confidentiality. */
export function assertSafeProjection(value:unknown):void{
  canonicalJson(value);
  function inspect(entry:unknown):void{
    if(typeof entry==='string'){
      assertNoSecrets(entry);urlShape.lastIndex=0;absoluteShape.lastIndex=0;
      if(urlShape.test(entry)||absoluteShape.test(entry))throw new Error('projection-unprojected-identity');
    }else if(Array.isArray(entry))entry.forEach(inspect);
    else if(entry!==null&&typeof entry==='object')for(const [key,item]of Object.entries(entry)){
      assertNoSecrets(key);if(sensitiveKey.test(key))throw new Error('projection-sensitive-key');inspect(item);
    }
  }
  inspect(value);
}
/** Local-only enumeration: includes private text and never grants authority to transmit it. */
export function enumerateEvidenceExcerpts(inputs:EvidenceBundleV1[]):LocalExcerpt[]{
  const bundles=validatedBundles(inputs).sort((a,b)=>bundleIdentity(a).localeCompare(bundleIdentity(b)));
  const excerpts:LocalExcerpt[]=[],seen=new Set<string>();
  for(const bundle of bundles){
    const candidates:Omit<LocalExcerpt,'id'|'transmittedText'>[]=[];
    for(const step of bundle.steps)if(bundle.mapping==='supported'&&step.sourceIndex!==null&&step.command!==null&&step.lineStart!==null&&step.lineEnd!==null)candidates.push({evidenceDigest:bundle.digest,sourcePath:bundle.workflow.path,lineStart:step.lineStart,lineEnd:step.lineEnd,sourceIndex:step.sourceIndex,originalText:step.command});
    for(const source of bundle.sources)if(source.path!==bundle.workflow.path)candidates.push({evidenceDigest:bundle.digest,sourcePath:source.path,lineStart:source.lineStart,lineEnd:source.lineEnd,sourceIndex:null,originalText:source.content});
    candidates.sort((a,b)=>a.sourcePath.localeCompare(b.sourcePath)||(a.sourceIndex??-1)-(b.sourceIndex??-1));
    for(const candidate of candidates){
      const identity=jsonDigest({repositoryId:bundle.repository.id,headSha:bundle.run.headSha,path:candidate.sourcePath,sourceIndex:candidate.sourceIndex,lineStart:candidate.lineStart,lineEnd:candidate.lineEnd,text:candidate.originalText});
      if(seen.has(identity))continue;seen.add(identity);
      excerpts.push({...candidate,id:`e${String(excerpts.length+1).padStart(3,'0')}`,transmittedText:candidate.originalText});
    }
  }
  return excerpts;
}
/** Remote labels preserve their original explicit limit and public/synthetic-only boundary. */
export function projectExcerpts(inputs:EvidenceBundleV1[]):LocalExcerpt[]{
  const bundles=validatedBundles(inputs);if(bundles.some(b=>b.repository.visibility==='private'))throw new Error('private-inference-disabled');
  const excerpts=enumerateEvidenceExcerpts(bundles);if(excerpts.length>20)throw new Error('projection-excerpt-limit');
  return excerpts.map(excerpt=>{const bundle=bundles.find(b=>b.digest===excerpt.evidenceDigest)!;const identities=[bundle.repository.name,...bundle.repository.name.split('/')];const transmittedText=sanitizeText(excerpt.originalText,identities);assertSafeProjection({text:transmittedText});return {...excerpt,transmittedText};});
}
export function buildLabelProjection(bundles:EvidenceBundleV1[]):RequestProjection{
  const mapping=projectExcerpts(bundles);if(!mapping.length)throw new Error('projection-no-excerpts');
  const body={model:JEV_MODEL,state:{excerpts:mapping.map(({id,transmittedText})=>({id,text:transmittedText}))},questions:labelQuestions(mapping)};
  assertSafeProjection(body);if(Buffer.byteLength(canonicalJson(body))>MAX_REQUEST_BYTES)throw new Error('projection-request-size-limit');
  return {task:'labels',question:null,body,mapping,inputDigests:validatedBundles(bundles).map(b=>b.digest).sort(),questionSetVersion:LABEL_QUESTION_VERSION,policyVersion:POLICY_VERSION};
}
