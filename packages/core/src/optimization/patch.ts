import { isMap, isScalar, parseDocument } from 'yaml';
import { canonicalJson, OptimizationInputError, sha256 } from './canonical.js';
import type { CacheOperation } from './contracts.js';
import { inspectWorkflow, parseWorkflowSource, protectedWorkflowDigest } from './workflow.js';
import type { WorkflowEvidence } from './workflow.js';

export type WorkflowInspectionOptions = WorkflowEvidence;
export interface PnpmCachePatch {
 status:'proposed'|'no-change'; candidate:string; patch:string; beforeHash:string; afterHash:string;
 beforeStructuralDigest:string; afterStructuralDigest:string; operation:CacheOperation;
}
function mapping(value:unknown):Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value)) throw new OptimizationInputError('cache-patch-invalid-mapping');return value as Record<string,unknown>;
}
function selectedInputs(tree:Record<string,unknown>,jobId:string,stepIndex:number):Record<string,unknown> {
 const job=mapping(mapping(tree.jobs)[jobId]);if(!Array.isArray(job.steps)||!Number.isSafeInteger(stepIndex)||stepIndex<0||!job.steps[stepIndex]) throw new OptimizationInputError('cache-patch-invalid-target');
 return mapping(mapping(job.steps[stepIndex]).with);
}
/** Insert within the selected AST mapping only; never serialize the surrounding YAML. */
function insertCacheFields(source:string,jobId:string,stepIndex:number):string {
 const document=parseDocument(source,{version:'1.2',uniqueKeys:true,strict:true,keepSourceTokens:true});
 const inputs=document.getIn(['jobs',jobId,'steps',stepIndex,'with'],true);
 if(!isMap(inputs)||!inputs.range||!inputs.items.length) throw new OptimizationInputError('cache-patch-unsupported-map-format');
 const newline=source.includes('\r\n')?'\r\n':'\n';
 if(newline==='\r\n'&&source.replaceAll('\r\n','').includes('\n')) throw new OptimizationInputError('cache-patch-mixed-newlines');
 let cursor:number,addition:string;
 if(inputs.flow) {
  cursor=inputs.range[1]-1;if(source[cursor]!=='}') throw new OptimizationInputError('cache-patch-unsupported-flow-format');
  const prefix=source.slice(inputs.range[0]+1,cursor).trimEnd();
  addition=`${prefix.endsWith(',')?'':','} cache: pnpm, cache-dependency-path: pnpm-lock.yaml`;
 } else {
  const first=inputs.items[0]?.key;if(!isScalar(first)||!first.range) throw new OptimizationInputError('cache-patch-unsupported-key-format');
  const keyStart=first.range[0],lineStart=source.lastIndexOf('\n',keyStart-1)+1,indent=source.slice(lineStart,keyStart);
  if(!/^ +$/.test(indent)) throw new OptimizationInputError('cache-patch-unsupported-indentation');
  cursor=inputs.range[1];const prefix=source.slice(0,cursor);
  const needsNewline=!prefix.endsWith('\n'),atEnd=cursor===source.length;
  addition=`${needsNewline?newline:''}${indent}cache: pnpm${newline}${indent}cache-dependency-path: pnpm-lock.yaml${atEnd&&needsNewline?'':newline}`;
 }
 return source.slice(0,cursor)+addition+source.slice(cursor);
}
/** Both the complete YAML tree and every original byte outside the insertion are protected. */
export function validateCacheOnlyChange(base:string,candidate:string,jobId:string,stepIndex:number):void {
 const before=parseWorkflowSource(base),after=parseWorkflowSource(candidate);
 const original=selectedInputs(before,jobId,stepIndex),changed=selectedInputs(after,jobId,stepIndex);
 if(Object.hasOwn(original,'cache')||Object.hasOwn(original,'cache-dependency-path')||changed.cache!=='pnpm'||changed['cache-dependency-path']!=='pnpm-lock.yaml') throw new OptimizationInputError('cache-patch-not-exact-two-fields');
 delete changed.cache;delete changed['cache-dependency-path'];
 if(canonicalJson(before)!==canonicalJson(after)) throw new OptimizationInputError('cache-patch-protected-semantics-changed');
 if(candidate!==insertCacheFields(base,jobId,stepIndex)) throw new OptimizationInputError('cache-patch-protected-bytes-changed');
}
interface Lines {lines:string[];finalNewline:boolean}
function lines(source:string):Lines {const result=source.split('\n'),finalNewline=source.endsWith('\n');if(finalNewline) result.pop();return {lines:result,finalNewline};}
/** One insertion/replacement hunk with three context lines, including exact CRLF bytes. */
function unifiedPatch(base:string,candidate:string,path:string):string {
 const before=lines(base),after=lines(candidate);let prefix=0,suffix=0;
 while(prefix<before.lines.length&&prefix<after.lines.length&&before.lines[prefix]===after.lines[prefix]) prefix++;
 while(suffix<before.lines.length-prefix&&suffix<after.lines.length-prefix&&before.lines[before.lines.length-1-suffix]===after.lines[after.lines.length-1-suffix]) suffix++;
 const start=Math.max(0,prefix-3),oldEnd=Math.min(before.lines.length,before.lines.length-suffix+3),newEnd=Math.min(after.lines.length,after.lines.length-suffix+3);
 let patch=`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -${start+1},${oldEnd-start} +${start+1},${newEnd-start} @@\n`;
 const append=(sign:string,line:string,index:number,source:Lines)=>{patch+=`${sign}${line}\n`;if(index===source.lines.length-1&&!source.finalNewline) patch+='\\ No newline at end of file\n';};
 for(let index=start;index<prefix;index++) append(' ',before.lines[index]!,index,before);
 for(let index=prefix;index<before.lines.length-suffix;index++) append('-',before.lines[index]!,index,before);
 for(let index=prefix;index<after.lines.length-suffix;index++) append('+',after.lines[index]!,index,after);
 for(let index=before.lines.length-suffix;index<oldEnd;index++) append(' ',before.lines[index]!,index,before);
 return patch;
}
export function createPnpmCachePatch(source:string,options:WorkflowInspectionOptions):PnpmCachePatch {
 if(!/^\.github\/workflows\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.ya?ml$/.test(options.provenance.workflowPath)) throw new OptimizationInputError('cache-patch-unsupported-workflow-path');
 const verdict=inspectWorkflow(source,options),{jobId,stepIndex,workflowPath}=options.provenance;
 if(verdict.status==='unsupported') throw new OptimizationInputError(`cache-patch-${verdict.reason}`);
 const operation:CacheOperation={type:'enable-pnpm-cache',jobId,stepIndex};
 const beforeHash=sha256(source),beforeStructuralDigest=protectedWorkflowDigest(source,jobId,stepIndex);
 if(verdict.status==='no-change') return {status:'no-change',candidate:source,patch:'',beforeHash,afterHash:beforeHash,beforeStructuralDigest,afterStructuralDigest:beforeStructuralDigest,operation};
 const candidate=insertCacheFields(source,jobId,stepIndex);validateCacheOnlyChange(source,candidate,jobId,stepIndex);
 const afterStructuralDigest=protectedWorkflowDigest(candidate,jobId,stepIndex);
 return {status:'proposed',candidate,patch:unifiedPatch(source,candidate,workflowPath),beforeHash,afterHash:sha256(candidate),beforeStructuralDigest,afterStructuralDigest,operation};
}
