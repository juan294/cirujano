import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { canonicalJson } from '@cirujano/core';
import type { CliIo } from '../cli.js';
import type { GitHubPageRunner } from '../github-api.js';
import { readPrivateJson, withOperationStore, type OperationStore } from '../optimization/store.js';
import type { AdvisoryArguments } from './arguments.js';
import { collectSelectedJob } from './collect.js';
import { decodeEvidence, type EvidenceBundleV1 } from './contracts.js';
import { buildInbox, evidenceStatus, report, type AdvisoryReport } from './rules.js';
import { renderReport } from './render.js';

declare const CIRUJANO_TOOL_SOURCE_SHA:string|undefined;
export interface AdvisoryService { run(args:AdvisoryArguments,io:CliIo):Promise<0|1|2> }
export interface AdvisoryServiceOptions {pageRunner?:GitHubPageRunner;toolSourceSha?:string;now?:()=>Date}
export async function readEvidenceDirectory(directory:string):Promise<EvidenceBundleV1>{return decodeEvidence(await readPrivateJson(join(directory,'evidence.json'),4*1024*1024));}
export async function freshOperation<T>(directory:string,work:(store:OperationStore)=>Promise<T>):Promise<T>{
  return withOperationStore(directory,async store=>{
    if((await readdir(store.directory)).some(name=>!name.startsWith('.controller')))throw new Error('advisory-output-exists');
    return work(store);
  });
}
export function emitReport(args:AdvisoryArguments,io:CliIo,value:AdvisoryReport):void {io.stdout(args.format==='json'?JSON.stringify(value)+'\n':renderReport(value));}
export function failureReason(error:unknown):string {
  const message=error instanceof Error?error.message:'';
  if(/^(?:unsafe-source|invalid-evidence|contradictory-evidence|duplicate-evidence|advisory|github|evidence|permit|private|secret|request|response|cohort|enrichment|prepared|projection|jev)-[a-z0-9-]+$/u.test(message))return message;
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
    let affectedInput:string|null=args.flags.operation??args.flags.output??null;
    try{
      if(args.action==='collect'){
        const b=await freshOperation(args.flags.output!,async store=>{
          const value=await collectSelectedJob({repository:args.flags.repository!,run:Number(args.flags.run),attempt:Number(args.flags.attempt),workflow:args.flags.workflow!,jobKey:args.flags['job-key']!,jobId:Number(args.flags['job-id']),sourceFiles:args.sourceFiles},{...options,toolSourceSha:await sourceSha(options)});
          await store.writeText('evidence.json',canonicalJson(value));return value;
        });
        emitReport(args,io,report(evidenceStatus(b),{digest:b.digest,operation:args.flags.output},b.reasonCodes));return 0;
      }
      if(args.action==='inbox'){
        if(args.enrichments.length)throw new Error('enrichment-unavailable');
        const bundles:EvidenceBundleV1[]=[];for(const input of args.inputs){affectedInput=input;bundles.push(await readEvidenceDirectory(input));}
        emitReport(args,io,buildInbox(bundles,args.sort));return 0;
      }
      const bundle=await readEvidenceDirectory(args.flags.operation!);
      emitReport(args,io,report(evidenceStatus(bundle),{digest:bundle.digest,kind:bundle.kind},bundle.reasonCodes));return 0;
    }catch(error){
      const value=report('unavailable',{operation:args.flags.operation??args.flags.output??null,affectedInput},[failureReason(error)]);
      value.nextActions=['Inspect the affected input or advisory status --operation <directory>; select a fresh dedicated output directory.', 'Run advisory inbox with previously retained valid --input directories for local-only access.'];
      emitReport(args,io,value);return 1;
    }
  }};
}
