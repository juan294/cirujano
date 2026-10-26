import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { readFile, rm, writeFile, symlink, chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, jsonDigest, sha256 } from '@cirujano/core';
import { decodeQualityRun, readHostedRunnerIdentity } from './quality-run.js';
import { reporterFixture } from './quality-reporter-entry.test-helper.js';
import { runQualityReporter } from './quality-reporter-entry.js';
const directories:string[]=[];
async function fixture(){const f=await reporterFixture();directories.push(f.workspace);return f;}
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
// These fixtures run actual Git and Vitest/V8 subprocesses, each with its own deadline.
describe('standalone start/finish quality reporter',{timeout:30000},()=>{
 it('binds actual Git source, reports, runtimes and GitHub environment with six source digests',async()=>{
  const f=await fixture();await runQualityReporter('start','reporter.json',{workspace:f.workspace,env:f.env});f.capture();await runQualityReporter('finish','reporter.json',{workspace:f.workspace,env:f.env});
  const envelope=decodeQualityRun(await f.json('quality.json'));
  const runner=readHostedRunnerIdentity("Current runner version: '2.329.0'\n##[group]Runner Image\nImage: ubuntu-24.04\nVersion: 20260920.1\nImage Release: https://github.com/actions/runner-images/releases/tag/ubuntu24%2F20260920.1\n##[endgroup]\n##[group]Run actions/checkout@sha\n",['ubuntu-latest'],'ubuntu-latest');
  expect({runnerOs:envelope.runnerOs,runnerArchitecture:envelope.runnerArchitecture,runnerImage:envelope.runnerImage}).toEqual(runner);
  expect(envelope.headSha).toBe(f.headSha);expect(envelope.repository).toBe('owner/owned');expect(envelope.attempt).toBe(2);expect(envelope.runnerImage).toBe('ubuntu24/20260920.1');expect(envelope.nodeVersion).toBe(process.versions.node);expect(envelope.pnpmVersion).toBe(f.profile.pnpmVersion);expect(envelope.workflowHash).toBe(sha256(await readFile(join(f.workspace,f.config.workflowPath))));expect(envelope.profileHash).toBe(sha256(canonicalJson(f.profile)));expect(envelope.bundleDigest).toBe(f.config.bundleDigest);expect(envelope.sourceTreeDigest).toMatch(/^[a-f0-9]{64}$/);expect(envelope.quality.tests).toEqual([{id:'math.test.ts::adds',outcome:'passed'},{id:'math.test.ts::skipped',outcome:'skipped'}]);expect(envelope.quality.commandDigest).toBe(jsonDigest([['pnpm','install','--frozen-lockfile'],...f.profile.commands]));
  expect(await f.json(f.profile.testReportPath)).toEqual({tests:envelope.quality.tests});expect(await f.json(f.profile.coverageReportPath)).toEqual({coverage:envelope.quality.coverage});
  await expect(runQualityReporter('finish','reporter.json',{workspace:f.workspace,env:f.env})).rejects.toThrow();
 });
 it('accepts an actual tracked empty regular source file without accepting empty reports',async()=>{
  const f=await fixture();await writeFile(join(f.workspace,'.gitkeep'),'');f.git('add','.gitkeep');const sha=f.git('commit-tree',f.git('write-tree'),'-p',f.headSha,'-m','Owned empty-file source object');f.git('update-ref','refs/heads/develop',sha);f.env.GITHUB_SHA=sha;await runQualityReporter('start','reporter.json',{workspace:f.workspace,env:f.env});f.capture();await runQualityReporter('finish','reporter.json',{workspace:f.workspace,env:f.env});expect(decodeQualityRun(await f.json('quality.json')).headSha).toBe(sha);
 });
 it('runs the actual standalone bundled start/finish CLI without GitHub credentials',async()=>{
  const f=await fixture();await rm(join(f.workspace,'.git'),{recursive:true});const reporter=join(f.workspace,'standalone.mjs');await build({entryPoints:[new URL('./quality-reporter-entry.ts',import.meta.url).pathname],outfile:reporter,bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"},define:{CIRUJANO_TOOL_SOURCE_SHA:JSON.stringify(f.config.toolSourceSha)}});
  f.config.controllerBundlePath='standalone.mjs';f.config.bundleDigest=sha256(await readFile(reporter));await writeFile(join(f.workspace,'reporter.json'),canonicalJson(f.config));
  const invoke=(action:string)=>spawnSync(process.execPath,[reporter,action,'--config','reporter.json'],{cwd:f.workspace,env:{PATH:process.env.PATH},encoding:'utf8',timeout:30000});
  const start=invoke('start');expect(start.status).toBe(0);expect(start.stdout).toBe('');f.capture();const finish=invoke('finish');expect(finish.status).toBe(0);expect(finish.stderr).toBe('');expect((await f.json(f.profile.testReportPath)).tests).toHaveLength(2);expect(invoke('invalid').status).toBe(1);
 },30000);
 it('emits only normalized reports offline without Git or GitHub identities',async()=>{
  const f=await fixture();await rm(join(f.workspace,'.git'),{recursive:true});await runQualityReporter('start','reporter.json',{workspace:f.workspace,env:{}});f.capture();await runQualityReporter('finish','reporter.json',{workspace:f.workspace,env:{}});
  expect((await f.json(f.profile.testReportPath)).tests).toHaveLength(2);await expect(readFile(join(f.workspace,'quality.json'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it.each(['raw','normalized','receipt','quality'])('refuses preseeded %s before checks',async kind=>{const f=await fixture();const path=kind==='raw'?f.config.rawTestReportPath:kind==='normalized'?f.profile.testReportPath:kind==='receipt'?f.config.receiptPath:f.config.qualityPath;await writeFile(join(f.workspace,path),'{}');await expect(runQualityReporter('start','reporter.json',{workspace:f.workspace,env:f.env})).rejects.toThrow();});
 it.each(['source','profile','config','bundle','env','runtime','symlink','stale','counters','receipt'])('rejects drift or unsafe %s before normalized writes',async mutation=>{
  const f=await fixture();await runQualityReporter('start','reporter.json',{workspace:f.workspace,env:f.env});f.capture();
  if(mutation==='source')await writeFile(join(f.workspace,'src/math.ts'),'changed');
  if(mutation==='profile')await writeFile(join(f.workspace,f.config.profilePath),canonicalJson({...f.profile,sourcePaths:[]}));
  if(mutation==='config')await writeFile(join(f.workspace,'reporter.json'),canonicalJson({...f.config,jobId:'other'}));
  if(mutation==='bundle')await writeFile(join(f.workspace,f.config.controllerBundlePath),'changed');
  if(mutation==='env')f.env.GITHUB_SHA='a'.repeat(40);
  if(mutation==='runtime')f.env.RUNNER_ARCH='ARM64';
  if(mutation==='symlink'){await rm(join(f.workspace,f.config.rawTestReportPath));await symlink('/etc/passwd',join(f.workspace,f.config.rawTestReportPath));}
  if(mutation==='stale'){const {utimes}=await import('node:fs/promises');await utimes(join(f.workspace,f.config.rawTestReportPath),new Date(0),new Date(0));}
  if(mutation==='counters'){const report=await f.json(f.config.rawTestReportPath);report.numTotalTests=999;await writeFile(join(f.workspace,f.config.rawTestReportPath),JSON.stringify(report));}
  if(mutation==='receipt'){const receipt=await f.json(f.config.receiptPath);receipt.startedAt=0;await writeFile(join(f.workspace,f.config.receiptPath),JSON.stringify(receipt));}
  await expect(runQualityReporter('finish','reporter.json',{workspace:f.workspace,env:f.env})).rejects.toThrow();await expect(readFile(join(f.workspace,f.profile.testReportPath))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('refuses sensitive config paths and report output symlink parents',async()=>{const f=await fixture();await writeFile(join(f.workspace,'reporter.json'),canonicalJson({...f.config,rawTestReportPath:'.env'}));await expect(runQualityReporter('start','reporter.json',{workspace:f.workspace,env:{}})).rejects.toThrow();});
 it('preflights every normalized output ancestor before the first write',async()=>{
  const f=await fixture();await rm(join(f.workspace,'.git'),{recursive:true});await writeFile(join(f.workspace,f.config.profilePath),canonicalJson({...f.profile,coverageReportPath:'unsafe/normalized-coverage.json'}));await runQualityReporter('start','reporter.json',{workspace:f.workspace,env:{}});f.capture();await mkdir(join(f.workspace,'other'));await symlink(join(f.workspace,'other'),join(f.workspace,'unsafe'),'dir');
  await expect(runQualityReporter('finish','reporter.json',{workspace:f.workspace,env:{}})).rejects.toThrow();await expect(readFile(join(f.workspace,f.profile.testReportPath))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('keeps receipt and output files private',async()=>{const f=await fixture();await runQualityReporter('start','reporter.json',{workspace:f.workspace,env:{}});const {stat}=await import('node:fs/promises');expect((await stat(join(f.workspace,f.config.receiptPath))).mode&0o777).toBe(0o600);await chmod(join(f.workspace,'src/math.ts'),0o755);await expect(runQualityReporter('finish','reporter.json',{workspace:f.workspace,env:{}})).rejects.toThrow();});
});
