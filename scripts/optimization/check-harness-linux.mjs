import { execFile as callback } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, dependencyStoreDigest, executionCommands, jsonDigest, parseStrictJson, sha256 } from './harness.mjs';
const execFile=promisify(callback);
const security=['--pull=never','--network=none','--memory=256m','--cpus=1','--pids-limit=64','--rm'];
/** Cached-image local Linux gate only: no pull/build/import or project source execution. */
async function check() {
 const {stdout:identity}=await execFile('docker',['image','inspect','node:22-bookworm','--format','{{.Id}}'],{timeout:10000});const imageId=identity.trim();if(!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw Error('linux-image-identity');
 const {stdout:runtime}=await execFile('docker',['run',...security,'--entrypoint','/usr/local/bin/node',imageId,'--version'],{timeout:15000});const nodeVersion=runtime.trim().replace(/^v/,'');if(!/^\d+\.\d+\.\d+$/.test(nodeVersion)) throw Error('linux-node-version');
 process.stdout.write(canonicalJson({imageId,nodeVersion,pnpm:'synthetic owned inert fixture',providerIsolation:'unproven'})+'\n');
 const root=await realpath(await mkdtemp(join(tmpdir(),'cirujano-linux-harness-')));
 try {
  await chmod(root,0o755);await mkdir(join(root,'store'),{mode:0o755});await writeFile(join(root,'store','trusted-fixture'),'trusted-store',{mode:0o444});
  await copyFile(new URL('./harness.mjs',import.meta.url),join(root,'harness.mjs'));await chmod(join(root,'harness.mjs'),0o444);
  const pnpmVersion='10.11.0',profile={schemaVersion:1,commands:[['node','owned-fixture.cjs']],testReportPath:'tests.json',coverageReportPath:'coverage.json',nodeVersion,pnpmVersion,timeoutSeconds:600,sourcePaths:['owned-fixture.cjs']};
  const tests=[{id:'linux-isolation',outcome:'passed'}],coverage=[{path:'owned-fixture.cjs',statements:1,coveredStatements:1,branches:1,coveredBranches:1,functions:1,coveredFunctions:1,lines:1,coveredLines:1}];
  const code=`const fs=require('node:fs');
let denied=false;try {fs.writeFileSync('/proc/'+process.ppid+'/fd/1','FORGED_PARENT_STDOUT\\n');} catch(error) {denied=['EACCES','EPERM'].includes(error.code);} if(!denied) throw Error('parent FD writable');
if(process.getuid()!==65534||process.getgid()!==65534) throw Error('source UID mismatch');
for(const path of ['/opt/cirujano/harness.mjs','/opt/cirujano/image.json','/opt/cirujano/store/tamper']) {let protectedAsset=false;try {fs.appendFileSync(path,'tamper');} catch(error) {protectedAsset=['EACCES','EPERM','EROFS'].includes(error.code);} if(!protectedAsset) throw Error('trusted asset writable');}
fs.writeFileSync(process.env.npm_config_store_dir+'/owned-inert-store-write','safe');
console.log('owned captured stdout spoof');
fs.writeFileSync('tests.json',${JSON.stringify(JSON.stringify({tests}))});fs.writeFileSync('coverage.json',${JSON.stringify(JSON.stringify({coverage}))});
`;
  const contents={'owned-fixture.cjs':code,'.github/workflows/ci.yml':'owned-fixture','pnpm-lock.yaml':'owned-lock'};
  const files=Object.entries(contents).map(([path,value])=>({path,mode:'100644',hash:sha256(value),bytesBase64:Buffer.from(value).toString('base64')})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const manifest={schemaVersion:1,kind:'optimization-image',toolSourceSha:'a'.repeat(40),bundleDigest:'b'.repeat(64),nodeVersion,pnpmVersion,lockfileHash:sha256('owned-lock'),dependencyStoreHash:await dependencyStoreDigest(join(root,'store')),harnessHash:sha256(await readFile(join(root,'harness.mjs'))),recipeHash:'c'.repeat(64)};
  await writeFile(join(root,'image.json'),canonicalJson(manifest),{mode:0o444});
  await writeFile(join(root,'pnpm'),`#!/usr/local/bin/node\nif(process.argv[2]==='--version') console.log('${pnpmVersion}');else if(process.argv.slice(2).join(' ')!=='install --frozen-lockfile') process.exit(1);\n`,{mode:0o555});
  const payload={schemaVersion:1,kind:'sandbox-payload',role:'base',profileDigest:'d'.repeat(64),proposalDigest:'e'.repeat(64),toolSourceSha:manifest.toolSourceSha,bundleDigest:manifest.bundleDigest,imageManifestHash:jsonDigest(manifest),harnessHash:manifest.harnessHash,sourceDigest:jsonDigest(files.map(({path,mode,hash})=>({path,mode,hash}))),workflowPath:'.github/workflows/ci.yml',workflowHash:sha256('owned-fixture'),files,verificationProfile:profile,expectedQuality:{commandDigest:jsonDigest(executionCommands(profile)),tests,coverage}};
  const args=['run',...security,'--read-only','--tmpfs','/workspace:rw,size=64m,mode=0700','--mount',`type=bind,src=${root},dst=/opt/cirujano,readonly`,'--mount',`type=bind,src=${join(root,'pnpm')},dst=/usr/local/bin/pnpm,readonly`,'--entrypoint','/usr/local/bin/node','-i',imageId,'/opt/cirujano/harness.mjs'];
  const stdout=await new Promise((resolveResult,reject)=>{const child=callback('docker',args,{timeout:30000,maxBuffer:1024*1024},(error,stdout)=>error?reject(error):resolveResult(stdout));child.stdin.end(canonicalJson(payload));});
  if(stdout.includes('FORGED_PARENT_STDOUT')) throw Error('linux-parent-stdout-spoof');const result=parseStrictJson(stdout);
  if(result.kind!=='harness-result'||!result.quality||canonicalJson(result.quality.tests)!==canonicalJson(tests)||result.commands.length!==2||result.commands.some(command=>command.exitCode!==0||command.signal||command.timedOut||command.truncated)) throw Error('linux-isolation-or-quality-failed');
  process.stdout.write(canonicalJson({status:'passed',imageId,nodeVersion,childUid:65534,childGid:65534,parentFdWrite:'denied',trustedAssetWrite:'denied',writableStoreClone:'passed',providerIsolation:'unproven'})+'\n');
 } finally {await rm(root,{recursive:true,force:true});}
}
try {await check();}catch(error){process.stderr.write((error instanceof Error&&/^linux-[a-z-]+$/.test(error.message)?error.message:'linux-harness-check-failed')+'\n');process.exitCode=1;}
