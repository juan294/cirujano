import { mkdtemp, readFile, realpath, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitBlobSha, jsonDigest, sha256 } from '@cirujano/core';
const url=new URL('../../../../scripts/optimization/image-context.mjs',import.meta.url);
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true});});
const recipe={schemaVersion:1,kind:'image-recipe',from:'docker.io/library/node@sha256:'+'a'.repeat(64),nodeVersion:'22.20.0',pnpmVersion:'10.11.0',toolSourceSha:'b'.repeat(40),bundleDigest:'c'.repeat(64)};
const source=(overrides:Record<string,string>={})=>{
 const contents:Record<string,string>={'package.json':JSON.stringify({name:'owned-inert',private:true,scripts:{preinstall:'echo NEVER EXECUTED',test:'node test.cjs'},dependencies:{yaml:'2.8.1'}}),'pnpm-lock.yaml':'lockfileVersion: 9.0\n','.github/workflows/ci.yml':'workflow-fixture','.cirujano/optimization-profile.json':JSON.stringify({schemaVersion:1,commands:[['pnpm','test']],testReportPath:'tests.json',coverageReportPath:'coverage.json',nodeVersion:recipe.nodeVersion,pnpmVersion:recipe.pnpmVersion,timeoutSeconds:600,sourcePaths:['test.cjs']}),'test.cjs':'throw Error("repository code must not enter context")','.pnpmfile.cjs':'throw Error("must not enter context")'};
 Object.assign(contents,overrides);
 const files=Object.entries(contents).map(([path,content])=>({path,mode:'100644',hash:sha256(content),bytesBase64:Buffer.from(content).toString('base64')})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const provenance={repositoryId:123,repository:'owned/inert',baseSha:'d'.repeat(40),workflowBlobSha:gitBlobSha(contents['.github/workflows/ci.yml']!),workflowPath:'.github/workflows/ci.yml',workflowHash:sha256(contents['.github/workflows/ci.yml']!),jobId:'test',stepIndex:2,lockfileHash:sha256(contents['pnpm-lock.yaml']!),sourceTreeDigest:jsonDigest(files.filter(file=>file.path!=='.github/workflows/ci.yml').map(({path,mode,hash})=>({path,mode,hash}))),verificationProfileHash:sha256(contents['.cirujano/optimization-profile.json']!),toolSourceSha:recipe.toolSourceSha,bundleDigest:recipe.bundleDigest};
 return {schemaVersion:1,provenance,profilePath:'.cirujano/optimization-profile.json',files};
};
const load=async()=>await import(url.href) as {generateImageContext:(source:unknown,recipe:unknown,output:string)=>Promise<{recipeHash:string;contextDigest:string;harnessHash:string;files:string[];output:string}>;dependencyStoreDigest:(path:string)=>Promise<string>};
async function output(){const root=await realpath(await mkdtemp(join(tmpdir(),'cirujano-image-')));roots.push(root);return join(root,'context');}
describe('manifest-only reviewable image preparation context',()=>{
 it('creates private deterministic context with hooks/source/credentials excluded and no provider UUID',async()=>{
  const directory=await output(),{generateImageContext}=await load(),result=await generateImageContext(source(),recipe,directory);
  expect(result.recipeHash).toBe(jsonDigest(recipe));expect(result.files).toEqual(['Dockerfile','build-manifest.mjs','dependency-input/package.json','dependency-input/pnpm-lock.yaml','harness.mjs','recipe.json']);
  expect((await stat(directory)).mode&0o777).toBe(0o700);for(const path of result.files) expect((await stat(join(directory,path))).mode&0o777).toBe(0o600);
  const manifest=JSON.parse(await readFile(join(directory,'dependency-input/package.json'),'utf8')) as Record<string,unknown>;expect(manifest.scripts).toBeUndefined();expect(manifest.dependencies).toEqual({yaml:'2.8.1'});
  const docker=await readFile(join(directory,'Dockerfile'),'utf8');expect(docker).toContain(recipe.from);expect(docker).toContain('--ignore-scripts --ignore-pnpmfile');expect(docker).not.toContain('COPY . ');expect(docker).toContain('chmod -R a+rX,a-w /opt/cirujano');expect(docker).not.toContain('chmod 0444');expect(docker).not.toContain('test.cjs');
  expect(await readFile(join(directory,'build-manifest.mjs'),'utf8')).toContain('dependencyStoreDigest');expect(JSON.stringify(result)).not.toContain('uuid');
  const second=await generateImageContext(source(),recipe,await output());expect(second.contextDigest).toBe(result.contextDigest);
 });
 it.each(['mutable-from','tool-drift','node-drift','pnpm-drift','lock-drift','source-hash','unsafe-source'])('rejects %s before creating approval context',async mutant=>{
  const s=source(),r={...recipe};if(mutant==='mutable-from') r.from='node:22';if(mutant==='tool-drift') r.toolSourceSha='f'.repeat(40);if(mutant==='node-drift') r.nodeVersion='24.21.0';if(mutant==='pnpm-drift') r.pnpmVersion='11.22.0';if(mutant==='lock-drift') s.provenance.lockfileHash='f'.repeat(64);if(mutant==='source-hash') s.files[0]!.hash='f'.repeat(64);if(mutant==='unsafe-source') s.files[0]!.path='.env';
  await expect((await load()).generateImageContext(s,r,await output())).rejects.toThrow();
 });
 it('refuses output symlinks and repeat writes over an existing approval context',async()=>{
  const out=await output(),target=await output();await symlink(target,out);await expect((await load()).generateImageContext(source(),recipe,out)).rejects.toThrow();
  const directory=await output();await(await load()).generateImageContext(source(),recipe,directory);await expect((await load()).generateImageContext(source(),recipe,directory)).rejects.toThrow();
 });
 it.each([
  'https://token:secret@registry.example/package.tgz',
  'https://registry.example/package.tgz?token=owned-secret',
  'https://registry.example/package.tgz?access_token=owned-secret',
  'https://registry.example/package.tgz?%61uth=owned-secret',
  'https://registry.example/package.tgz?X-Amz-Signature=owned-secret',
 ])('rejects immutable credential-bearing lock resolution before creating any context: %s',async tarball=>{
  const directory=await output(),lock=`lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      fixture:\n        specifier: 1.0.0\n        version: 1.0.0\npackages:\n  fixture@1.0.0:\n    resolution:\n      tarball: '${tarball}'\nsnapshots:\n  fixture@1.0.0: {}\n`;
  await expect((await load()).generateImageContext(source({'pnpm-lock.yaml':lock}),recipe,directory)).rejects.toThrow();
  await expect(stat(directory)).rejects.toMatchObject({code:'ENOENT'});
 });
 it.each(['token','authorization','_authToken'])('rejects lock authentication setting %s before creating any context',async setting=>{
  const directory=await output();await expect((await load()).generateImageContext(source({'pnpm-lock.yaml':`lockfileVersion: '9.0'\n${setting}: owned-secret\n`}),recipe,directory)).rejects.toThrow();await expect(stat(directory)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('rejects credential query parameters in package dependency URLs',async()=>{
  const directory=await output();await expect((await load()).generateImageContext(source({'package.json':JSON.stringify({name:'owned-inert',dependencies:{fixture:'https://registry.example/package.tgz?token=owned-secret'}})}),recipe,directory)).rejects.toThrow();await expect(stat(directory)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('accepts registry packages whose names merely end in link, file or patch',async()=>{
  const directory=await output(),lock="lockfileVersion: '9.0'\npackages:\n  terminal-link@2.1.1:\n    resolution: {integrity: sha512-owned}\n  '@npmcli/git@6.0.3':\n    resolution: {integrity: sha512-owned}\n  vfile@6.0.3:\n    dependencies:\n      terminal-link: 2.1.1\n      vfile: 6.0.3\n      diff-patch: 1.0.0\n";
  await expect((await load()).generateImageContext(source({'pnpm-lock.yaml':lock}),recipe,directory)).resolves.toMatchObject({output:directory});
 });
 it.each(["'@owned/local': link:../local","fixture: file:../fixture.tgz","fixture: github:owned/inert","fixture: git@github.com:owned/inert.git","fixture: 'link:../quoted'","fixture: file:../x\npackages:\n  fixture@file:../x:\n    resolution: {directory: ../x, type: directory}","fixture: file:../x.tgz\npackages:\n  fixture@file:../x.tgz:\n    resolution: {integrity: sha512-owned, tarball: file:../x.tgz}"])('still rejects local or hosted code specifier %s',async specifier=>{
  const directory=await output(),lock=`lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      ${specifier}\n`;
  await expect((await load()).generateImageContext(source({'pnpm-lock.yaml':lock}),recipe,directory)).rejects.toThrow();await expect(stat(directory)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('rejects locked Git dependencies that may execute prepare hooks despite ignore-scripts',async()=>{
  const directory=await output(),lock="lockfileVersion: '9.0'\npackages:\n  fixture:\n    resolution:\n      type: git\n      repo: https://github.com/owned/inert.git\n      commit: abcdef\n";
  await expect((await load()).generateImageContext(source({'pnpm-lock.yaml':lock}),recipe,directory)).rejects.toThrow();await expect(stat(directory)).rejects.toMatchObject({code:'ENOENT'});
 });
});
