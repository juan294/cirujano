import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, realpath, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { canonicalJson, sha256, type VerificationProfile } from '@cirujano/core';

// The reporter requires an absolute pnpm path; resolve the runner's actual binary instead of assuming a local install location.
const pnpmPath=execFileSync('/bin/sh',['-c','command -v pnpm'],{encoding:'utf8'}).trim();
export async function reporterFixture() {
 const workspace=await realpath(await mkdtemp(join(tmpdir(),'cirujano-reporter-'))),root=resolve(import.meta.dirname,'../../../..');
 const git=(...args:string[])=>execFileSync('git',['-C',workspace,'-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{encoding:'utf8',env:{PATH:process.env.PATH,GIT_AUTHOR_NAME:'Owned fixture',GIT_AUTHOR_EMAIL:'fixture@invalid',GIT_COMMITTER_NAME:'Owned fixture',GIT_COMMITTER_EMAIL:'fixture@invalid'}}).trim();
 const profile:VerificationProfile={schemaVersion:1,commands:[['node','reporter.mjs','start','--config','reporter.json'],['pnpm','test'],['node','reporter.mjs','finish','--config','reporter.json']],testReportPath:'normalized-tests.json',coverageReportPath:'normalized-coverage.json',nodeVersion:process.versions.node,pnpmVersion:execFileSync(pnpmPath,['--version'],{encoding:'utf8'}).trim(),timeoutSeconds:600,sourcePaths:['src/math.ts']};
 const toolSourceSha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),controller='owned-controller-fixture\n';
 const config={schemaVersion:1,kind:'quality-reporter-config',profilePath:'.cirujano/optimization-profile.json',workflowPath:'.github/workflows/ci.yml',jobId:'test',rawTestReportPath:'raw-tests.json',rawCoverageReportPath:'raw-coverage/coverage-final.json',receiptPath:'.reporter-receipt.json',qualityPath:'quality.json',controllerBundlePath:'controller.mjs',toolSourceSha,bundleDigest:sha256(controller),pnpmPath:pnpmPath};
 const workflow=`name: Owned\non: push\npermissions: {contents: read}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020\n        with: {node-version: '${profile.nodeVersion}'}\n      - run: pnpm install --frozen-lockfile\n      - run: node reporter.mjs start --config reporter.json\n      - run: pnpm test\n      - run: node reporter.mjs finish --config reporter.json\n`;
 const files={'package.json':JSON.stringify({name:'owned',private:true,type:'module',packageManager:`pnpm@${profile.pnpmVersion}`,scripts:{test:'vitest run --config vitest.config.mjs --coverage'}}),'src/math.ts':'export function add(a:number,b:number){if(a<0)return 0;return a+b}\n','math.test.ts':"import {test,expect} from 'vitest';import {add} from './src/math';test('adds',()=>expect(add(1,2)).toBe(3));test.skip('skipped',()=>{});\n",'vitest.config.mjs':"export default {test:{fileParallelism:false,maxWorkers:1,reporters:['json'],outputFile:'raw-tests.json',coverage:{provider:'v8',include:['src/**/*.ts'],reporter:['json'],reportsDirectory:'raw-coverage'}}};\n",'.cirujano/optimization-profile.json':canonicalJson(profile),'.github/workflows/ci.yml':workflow,'pnpm-lock.yaml':"lockfileVersion: '9.0'\n",'reporter.json':canonicalJson(config),'reporter.mjs':'// owned inert entry fixture\n','controller.mjs':controller,'.gitignore':'node_modules/\nraw-tests.json\nraw-coverage/\nnormalized-tests.json\nnormalized-coverage.json\n.reporter-receipt.json\nquality.json\n'};
 for(const [path,bytes]of Object.entries(files)){await mkdir(dirname(join(workspace,path)),{recursive:true});await writeFile(join(workspace,path),bytes);}
 git('init','--initial-branch=develop');git('add','.');const tree=git('write-tree'),headSha=git('commit-tree',tree,'-m','Owned isolated source object');git('update-ref','refs/heads/develop',headSha);
 await symlink(join(root,'node_modules'),join(workspace,'node_modules'),'dir');
 const capture=()=>execFileSync(pnpmPath,['test'],{cwd:workspace,encoding:'utf8',timeout:30000,env:{...process.env,pnpm_config_verify_deps_before_run:'false'}});
 const env:NodeJS.ProcessEnv={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY_ID:'1',GITHUB_REPOSITORY:'owner/owned',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2',GITHUB_SHA:headSha,GITHUB_JOB:'test',GITHUB_WORKFLOW_REF:'owner/owned/.github/workflows/ci.yml@refs/heads/develop',RUNNER_OS:'Linux',RUNNER_ARCH:'X64',ImageOS:'ubuntu24',ImageVersion:'20260920.1'};
 const json=async(path:string)=>JSON.parse(await readFile(join(workspace,path),'utf8')) as Record<string,unknown>;
 return{workspace,profile,config,headSha,git,capture,env,json};
}
