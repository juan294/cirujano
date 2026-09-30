import {join} from 'node:path';
import {jsonDigest,gitBlobSha,canonicalJson} from '@cirujano/core';
import {measurementFixture} from './measure.test-helper.js';
import {runMeasure} from './measure.js';
import {runReport,readReportContext} from './report-service.js';
import type {GitHubPageRunner} from '../github-api.js';
import type {GitHubMutationRunner,PublicationPermit} from './publish.js';

/** Real product stages and Git source; only the external GitHub transport is owned. */
export async function publicationFixture(){
 const f=await measurementFixture(),measurement=await runMeasure(join(f.proposed,'proposal.json'),join(f.verified,'sandbox.json'),f.cohort,f.measured,{pageRunner:f.pageRunner,binaryRunner:f.binaryRunner,now:()=>Date.parse('2026-09-29T22:00:00Z')});
 if(!measurement.artifactPath)throw new Error('owned measurement did not complete');
 const result=await runReport(join(f.proposed,'proposal.json'),join(f.verified,'sandbox.json'),measurement.artifactPath,join(f.directory,'reported'));if(!result.artifactPath)throw new Error('owned report did not complete');const reviewed=await readReportContext(result.artifactPath),report=reviewed.report;
 const permit:PublicationPermit={schemaVersion:1,kind:'publication-permit',permitId:'owned-publication',repositoryId:report.provenance.repositoryId,repository:report.provenance.repository,baseRef:report.baseRef,headRef:report.headRef,baseSha:report.provenance.baseSha,headSha:report.candidateSha,proposalDigest:report.proposalDigest,sandboxDigest:report.sandboxDigest,measurementDigest:report.measurementDigest,reportDigest:jsonDigest(report),bodyHash:report.markdownHash,marker:report.marker,expiresAt:'2026-09-30T23:00:00Z',maxCreates:1};
 const pulls:Record<string,unknown>[]=[],posts:{args:string[];body:unknown}[]=[],refs=new Map([[permit.baseRef,permit.baseSha],[permit.headRef,permit.headSha]]);
 const pull=()=>({number:1,state:'open',merged:false,merged_at:null,auto_merge:null,html_url:`https://github.com/${permit.repository}/pull/1`,body:report.markdown,base:{ref:permit.baseRef,sha:permit.baseSha,repo:{id:permit.repositoryId,full_name:permit.repository}},head:{ref:permit.headRef,sha:permit.headSha,repo:{id:permit.repositoryId,full_name:permit.repository}}});
 const pageRunner:GitHubPageRunner=async(command,args,settings)=>{const endpoint=args.find(value=>value.startsWith('repos/'))!;let body:unknown;
  if(endpoint.includes('/git/ref/heads/')){const ref=endpoint.split('/git/ref/heads/')[1]!.split('/').map(decodeURIComponent).join('/');body={ref:`refs/heads/${ref}`,object:{type:'commit',sha:refs.get(ref)}};}
  else if(endpoint.includes('/compare/'))body={status:'ahead',base_commit:{sha:permit.baseSha},merge_base_commit:{sha:permit.baseSha},files:[{filename:report.provenance.workflowPath,status:'modified',sha:gitBlobSha(f.context.candidate)}]};
  else if(endpoint.includes('/pulls?'))body=pulls;
  else if(endpoint.includes('/pulls/'))body=pulls.find(row=>row.number===Number(endpoint.split('/').at(-1)));
  else return f.pageRunner(command,args,settings);
  f.calls.push(args);return{stdout:JSON.stringify(body)};
 };
 const mutationRunner:GitHubMutationRunner=async(_command,args,settings)=>{const body=JSON.parse(settings.input);posts.push({args,body});if(canonicalJson(body)!==canonicalJson({title:'Enable verified pnpm store caching',head:permit.headRef,base:permit.baseRef,body:report.markdown,maintainer_can_modify:false,draft:false}))throw new Error('unexpected owned publication request');pulls.push(pull());return{stdout:JSON.stringify(pulls[0])};};
 return{...f,report,reportPath:result.artifactPath,permit,refs,pulls,posts,pull,pageRunner,mutationRunner,publication:join(f.directory,'reported','publication'),options:{pageRunner,mutationRunner,now:()=>Date.parse('2026-09-30T00:00:00Z'),permitLedger:join(f.directory,'publication-ledger')}};
}
