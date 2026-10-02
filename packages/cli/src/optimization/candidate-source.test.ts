import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeSourceManifest, gitBlobSha, jsonDigest, sha256 } from '@cirujano/core';
import { readLocalCandidate } from './candidate-source.js';
const directories:string[]=[];
afterEach(async()=>{for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'optimization-git-'));directories.push(root);
 const git=(...args:string[])=>execFileSync('git',['-C',root,'-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','user.name=Owned Fixture','-c','user.email=fixture@invalid','-c','commit.gpgsign=false',...args],{encoding:'utf8'}).trim();
 const workflow='name: Owned\njobs: {}\n',candidate=workflow+'# deterministic candidate\n',profile=JSON.stringify({schemaVersion:1,commands:[['pnpm','install','--frozen-lockfile']],nodeVersion:'22.20.0',pnpmVersion:'10.17.1',timeoutSeconds:600,sourcePaths:['owned.txt'],testReportPath:'tests.json',coverageReportPath:'coverage.json'});
 const bytes:Record<string,string>={'.github/workflows/ci.yml':workflow,'pnpm-lock.yaml':'lockfileVersion: 9.0\n','.cirujano/optimization-profile.json':profile,'owned.txt':'source unchanged\n'};
 await mkdir(join(root,'.github/workflows'),{recursive:true});await mkdir(join(root,'.cirujano'));for(const [path,content]of Object.entries(bytes))await writeFile(join(root,path),content);
 git('init','--initial-branch=develop');git('add','.');git('commit','-m','Owned base');const baseSha=git('rev-parse','HEAD');
 const files=Object.entries(bytes).map(([path,content])=>({path,mode:'100644',hash:sha256(content),bytesBase64:Buffer.from(content).toString('base64')})).sort((a,b)=>a.path<b.path?-1:1);
 const source=decodeSourceManifest({schemaVersion:1,profilePath:'.cirujano/optimization-profile.json',files,provenance:{repositoryId:1,repository:'owned/proof',baseSha,workflowBlobSha:gitBlobSha(workflow),workflowPath:'.github/workflows/ci.yml',workflowHash:sha256(workflow),jobId:'test',stepIndex:2,lockfileHash:sha256(bytes['pnpm-lock.yaml']!),verificationProfileHash:sha256(profile),sourceTreeDigest:jsonDigest(files.filter(f=>f.path!=='.github/workflows/ci.yml').map(({path,mode,hash})=>({path,mode,hash}))),toolSourceSha:'1'.repeat(40),bundleDigest:'2'.repeat(64)}});
 await writeFile(join(root,'.github/workflows/ci.yml'),candidate);git('add','.');git('commit','-m','Owned candidate');const candidateSha=git('rev-parse','HEAD');return{root,git,source,candidate,candidateSha};
}
describe('actual local candidate commit binding',()=>{
 it('reads committed bytes and modes and ignores unrelated uncommitted edits',async()=>{const f=await fixture();await writeFile(join(f.root,'owned.txt'),'dirty preserved');const files=await readLocalCandidate(f.root,f.candidateSha,f.source,f.candidate);expect(files.find(file=>file.path==='owned.txt')?.bytesBase64).toBe(Buffer.from('source unchanged\n').toString('base64'));expect(files.find(file=>file.path===f.source.provenance.workflowPath)?.hash).toBe(sha256(f.candidate));});
 it.each(['source','mode','workflow-mode','extra','workflow'])('rejects committed %s drift',async mutation=>{const f=await fixture();if(mutation==='source')await writeFile(join(f.root,'owned.txt'),'drift');else if(mutation==='extra')await writeFile(join(f.root,'extra.txt'),'new');else if(mutation==='workflow')await writeFile(join(f.root,'.github/workflows/ci.yml'),f.candidate+'# extra');else f.git('update-index','--chmod=+x',mutation==='mode'?'owned.txt':'.github/workflows/ci.yml');if(!mutation.endsWith('mode'))f.git('add','.');f.git('commit','-m','Drift');await expect(readLocalCandidate(f.root,f.git('rev-parse','HEAD'),f.source,f.candidate)).rejects.toThrow();});
 it('rejects an invented candidate SHA',async()=>{const f=await fixture();await expect(readLocalCandidate(f.root,'9'.repeat(40),f.source,f.candidate)).rejects.toThrow();});
 it('does not substitute a local replacement commit for a claimed immutable SHA',async()=>{const f=await fixture();await writeFile(join(f.root,'owned.txt'),'Unrelated committed bytes');f.git('add','.');f.git('commit','-m','Unrelated candidate');const wrong=f.git('rev-parse','HEAD');f.git('replace',wrong,f.candidateSha);await expect(readLocalCandidate(f.root,wrong,f.source,f.candidate)).rejects.toThrow();});
});
