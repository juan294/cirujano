import { createHash } from 'node:crypto';
import { gitBlobSha } from '@cirujano/core';
import type { GitHubPageRunner } from '../github-api.js';

export const head='1'.repeat(40),tool='2'.repeat(40);
export const workflow='name: CI\non: push\njobs:\n  check:\n    name: Checks\n    runs-on: ubuntu-latest\n    steps:\n      - name: Install\n        run: pnpm install --frozen-lockfile\n';
export const request={repository:'example/project',run:10,attempt:2,workflow:'.github/workflows/ci.yml',jobKey:'check',jobId:20,sourceFiles:[]};
function tree(entries:{path:string;mode:string;type:string;sha:string;size?:number}[]) { const bytes=Buffer.concat([...entries].sort((a,b)=>Buffer.compare(Buffer.from(a.path+(a.type==='tree'?'/':'')),Buffer.from(b.path+(b.type==='tree'?'/':'')))).map(e=>Buffer.concat([Buffer.from(`${e.mode==='040000'?'40000':e.mode} ${e.path}\0`),Buffer.from(e.sha,'hex')])));return {sha:createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex'),tree:entries,truncated:false}; }
export function api(source=workflow,change?:(responses:Record<string,unknown>)=>void) {
 const blob=gitBlobSha(source),leaf=tree([{path:'ci.yml',type:'blob',mode:'100644',sha:blob,size:Buffer.byteLength(source)}]),mid=tree([{path:'workflows',type:'tree',mode:'040000',sha:leaf.sha}]),root=tree([{path:'.github',type:'tree',mode:'040000',sha:mid.sha}]);
 const repo={id:1,full_name:'example/project',private:false,visibility:'public'};
 const run={id:10,run_attempt:2,head_sha:head,path:request.workflow,event:'push',status:'completed',conclusion:'success',repository:repo,head_repository:repo};
 const job={id:20,name:'Checks',run_id:10,run_attempt:2,head_sha:head,status:'completed',conclusion:'success',labels:['ubuntu-latest'],started_at:'2026-10-28T10:00:00Z',completed_at:'2026-10-28T10:02:00Z',steps:[{number:1,name:'Set up job',status:'completed',conclusion:'success',started_at:'2026-10-28T10:00:00Z',completed_at:'2026-10-28T10:00:00Z'},{number:17,name:'Install',status:'completed',conclusion:'success',started_at:'2026-10-28T10:00:00Z',completed_at:'2026-10-28T10:01:00Z'},{number:99,name:'Post actions/checkout@v6',status:'completed',conclusion:'success',started_at:'2026-10-28T10:01:59Z',completed_at:'2026-10-28T10:02:00Z'}]};
 const responses:Record<string,unknown>={['repos/example/project']:repo,[`repos/example/project/actions/runs/10/attempts/2`]:run,[`repos/example/project/actions/runs/10/attempts/2/jobs?per_page=100&page=1`]:{total_count:1,jobs:[job]},[`repos/example/project/git/commits/${head}`]:{sha:head,tree:{sha:root.sha}},[`repos/example/project/git/trees/${root.sha}`]:root,[`repos/example/project/git/trees/${mid.sha}`]:mid,[`repos/example/project/git/trees/${leaf.sha}`]:leaf,[`repos/example/project/git/blobs/${blob}`]:{sha:blob,encoding:'base64',size:Buffer.byteLength(source),content:Buffer.from(source).toString('base64')}};
 change?.(responses);const calls:string[][]=[];const pageRunner:GitHubPageRunner=async(_command,args)=>{calls.push(args);const endpoint=args[5]!;if(!(endpoint in responses)) throw new Error(`unexpected fixture endpoint ${endpoint}`);return {stdout:JSON.stringify(responses[endpoint])};};
 return {pageRunner,calls,responses,blob};
}
export const options=(pageRunner:GitHubPageRunner)=>({pageRunner,toolSourceSha:tool,now:()=>new Date('2026-10-28T11:00:00Z')});
export function jobs(responses:Record<string,unknown>) {return (responses['repos/example/project/actions/runs/10/attempts/2/jobs?per_page=100&page=1'] as {jobs:Record<string,unknown>[]}).jobs;}
