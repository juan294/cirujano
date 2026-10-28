import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { canonicalJson } from '@cirujano/core';
import { shellQuote } from '../optimization/stage-output.js';
import { readPrivateJson } from '../optimization/store.js';
import { prepareOperation } from './prepare.js';
import { enrichOperation, inspectAdvisoryOperation, readEnrichmentOperation, type EnrichOptions } from './enrich.js';
import { actionScopeQuery, validateSearchQuery } from './search-candidates.js';
import { searchEvidence } from './search.js';
import { LABEL_CATEGORIES, supportState } from './questions.js';
import type { CliIo } from '../cli.js';
import type { GitHubPageRunner } from '../github-api.js';
import type { AdvisoryArguments } from './arguments.js';
import { collectSelectedJob } from './collect.js';
import type { EvidenceBundleV1 } from './contracts.js';
import { readEvidenceInputs, freshOperation } from './storage.js';
import { buildInbox, evidenceStatus, report, type AdvisoryReport } from './rules.js';
import { renderReport } from './render.js';

declare const CIRUJANO_TOOL_SOURCE_SHA:string|undefined;
export interface AdvisoryService { run(args:AdvisoryArguments,io:CliIo):Promise<0|1|2> }
export interface AdvisoryServiceOptions extends EnrichOptions {pageRunner?:GitHubPageRunner;toolSourceSha?:string;now?:()=>Date}
export function emitReport(args:AdvisoryArguments,io:CliIo,value:AdvisoryReport):void {io.stdout(args.format==='json'?JSON.stringify(value)+'\n':renderReport(value));}
export function failureReason(error:unknown):string {
  const message=error instanceof Error?error.message:'';
  if(/^(?:unsafe-source|invalid-evidence|contradictory-evidence|duplicate-evidence|advisory|github|evidence|permit|private|secret|request|response|cohort|enrichment|prepared|projection|jev|search)-[a-z0-9-]+$/u.test(message))return message;
  if(message.startsWith('permit-exhausted:'))return 'permit-exhausted';
  if(/symlink/u.test(message))return 'advisory-unsafe-path';
  if(/another controller/u.test(message))return 'advisory-active-lock';
  if(/ENOENT/u.test(message))return 'advisory-input-missing';
  return 'advisory-invalid-or-unavailable-evidence';
}
async function sourceSha(options:AdvisoryServiceOptions):Promise<string>{
  if(options.toolSourceSha)return options.toolSourceSha;
  if(typeof CIRUJANO_TOOL_SOURCE_SHA!=='undefined')return CIRUJANO_TOOL_SOURCE_SHA;
  return (await promisify(execFile)('git',['-C',dirname(fileURLToPath(import.meta.url)),'rev-parse','HEAD'],{timeout:10000,maxBuffer:1024})).stdout.trim();
}
export function createAdvisoryService(options:AdvisoryServiceOptions={}):AdvisoryService {
  return {async run(args,io){
    let safeQuestion:string|null=null;
    let affectedInput:string|null=args.flags.operation??args.flags.output??null;
    try{
      if(args.action==='collect'){
        const b=await freshOperation(args.flags.output!,async store=>{
          const value=await collectSelectedJob({repository:args.flags.repository!,run:Number(args.flags.run),attempt:Number(args.flags.attempt),workflow:args.flags.workflow!,jobKey:args.flags['job-key']!,jobId:Number(args.flags['job-id']),sourceFiles:args.sourceFiles},{...options,toolSourceSha:await sourceSha(options)});
          await store.writeText('evidence.json',canonicalJson(value));return value;
        });
        emitReport(args,io,report(evidenceStatus(b),{digest:b.digest,operation:args.flags.output},b.reasonCodes));return 0;
      }
      if(args.action==='prepare'){
        const bundles:EvidenceBundleV1[]=[];for(const input of args.inputs){affectedInput=input;bundles.push(...await readEvidenceInputs(input,20-bundles.length));}
        const prepared=await prepareOperation(bundles,args.flags.task as 'labels'|'search',args.flags.question??null,args.flags.output!,options.now);
        emitReport(args,io,report('complete',{requestHash:prepared.requestHash,requestBytes:prepared.requestBytes,estimatedReservationUsd:prepared.estimatedReservationUsd,preview:args.flags.output!+'/preview.md'},['prepared-not-sent']));return 0;
      }
      if(args.action==='enrich'){
        affectedInput=args.flags.permit!;const permit=await readPrivateJson(args.flags.permit!);affectedInput=args.flags.request!;
        const receipt=await enrichOperation(args.flags.request!,permit,args.flags.output!,{...options,apiKey:options.apiKey??process.env.TYPESAFE_API_KEY??''});
        const value=await inspectAdvisoryOperation(args.flags.output!);emitReport(args,io,value);return receipt.status==='completed'?0:1;
      }
      if(args.action==='ask'){
        validateSearchQuery(args.flags.question!);safeQuestion=args.flags.question!;
        const bundles:EvidenceBundleV1[]=[];for(const input of args.inputs){affectedInput=input;bundles.push(...await readEvidenceInputs(input,20-bundles.length));}
        if(args.enrichments[0])affectedInput=args.enrichments[0];
        const retained=args.enrichments[0]?await readEnrichmentOperation(args.enrichments[0]):undefined;
        const value=searchEvidence(bundles,args.flags.question!,retained);emitReport(args,io,value);return 0;
      }
      if(args.action==='inbox'){
        const bundles:EvidenceBundleV1[]=[];for(const input of args.inputs){affectedInput=input;bundles.push(...await readEvidenceInputs(input,20-bundles.length));}
        const value=buildInbox(bundles,args.sort),digests=new Set(value.payload.cards.map(c=>c.inputDigest));
        const attached=new Map<string,number>();
        for(const directory of args.enrichments){
          affectedInput=directory;const context=await readEnrichmentOperation(directory);
          if(context.prepared.task!=='labels'||context.prepared.inputDigests.some(d=>!digests.has(d)))throw new Error('enrichment-input-or-task-mismatch');
          for(const excerpt of context.prepared.mapping){
            const card=value.payload.cards.find(c=>c.inputDigest===excerpt.evidenceDigest);if(!card)throw new Error('enrichment-input-mismatch');
            for(const category of LABEL_CATEGORIES){
              const answer=context.response.answers[`${excerpt.id}_${category}`];if(!answer||answer.type!=='noul')throw new Error('enrichment-answer-mismatch');
              const key=canonicalJson([excerpt.evidenceDigest,excerpt.sourcePath,excerpt.sourceIndex,category]);
              if(attached.has(key)){if(attached.get(key)!==answer.noul)throw new Error('enrichment-conflicting-results');continue;}attached.set(key,answer.noul);
              (card.semanticLabels??=[]).push({excerptId:excerpt.id,category,probability:answer.noul,support:supportState(answer.noul),requestHash:context.prepared.requestHash,sourcePath:excerpt.sourcePath,sourceIndex:excerpt.sourceIndex,lineStart:excerpt.lineStart,lineEnd:excerpt.lineEnd});
            }
          }
        }
        if(value.status==='complete'&&value.payload.cards.some(c=>c.semanticLabels?.some(label=>label.support==='uncertain')))value.status='uncertain';
        if(args.enrichments.length)value.limitations.push('Semantic labels are opt-in; native usefulness and latency remain UNMEASURED.');
        emitReport(args,io,value);return 0;
      }
      const value=await inspectAdvisoryOperation(args.flags.operation!);emitReport(args,io,value);return value.status==='unavailable'||value.status==='outcome-unknown'?1:0;
    }catch(error){
      const reason=failureReason(error);
      if(args.action==='enrich'&&reason==='advisory-invalid-or-unavailable-evidence'){
        try{const retained=await inspectAdvisoryOperation(args.flags.output!);if(retained.status==='outcome-unknown'){emitReport(args,io,retained);return 1;}}catch{/* Preserve the original safe failure category when local evidence cannot be validated. */}
      }
      const value=report('unavailable',{operation:args.flags.operation??args.flags.output??null,affectedInput,request:args.flags.request??null,permit:args.flags.permit??null},[reason]);
      value.nextActions=['Inspect the affected input or advisory status --operation <directory>; select a fresh dedicated output directory.', 'Run advisory inbox with previously retained valid --input directories for local-only access.'];
      const localInput=args.inputs[0]??args.flags.request;
      if(localInput)value.nextActions.unshift(`cirujano advisory inbox --input ${shellQuote(localInput)} --format markdown`);
      if(args.action==='ask'&&safeQuestion!==null){
        const selected=args.inputs.map(input=>`--input ${shellQuote(input)}`).join(' ');
        value.nextActions.unshift(`cirujano advisory ask ${selected} --question ${shellQuote(safeQuestion)} --format markdown`);
        if(args.inputs.length&&!actionScopeQuery(safeQuestion)&&reason!=='private-inference-disabled'){
          const fresh=join(dirname(args.enrichments[0]??args.inputs[0]!),`advisory-search-${randomUUID()}`);
          value.nextActions.push(`cirujano advisory prepare ${selected} --task search --question ${shellQuote(safeQuestion)} --output ${shellQuote(fresh)}`);
        }
      }
      if(reason==='search-sensitive-query')value.nextActions.push('Use a question without credential values; the refused question is never echoed.');
      if(reason==='jev-key-required')value.nextActions.push('Supply TYPESAFE_API_KEY as a nonempty token of at most 2048 characters without whitespace. This preflight sent no request or consumed authority.');
      if(args.flags.request&&args.flags.permit)value.nextActions.push(`Owner authorization must be a reviewed single-use jev-advisory-permit at ${shellQuote(args.flags.permit)} matching ${shellQuote(join(args.flags.request,'body.json'))}; template creation grants no permission. Consumed authority needs a fresh permit ID.`);
      emitReport(args,io,value);return 1;
    }
  }};
}
