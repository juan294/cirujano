import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { sha256 } from '@cirujano/core';
import { evidenceFixture } from './fixture.js';
import { buildPreparedRequest, prepareOperation, readPreparedOperation } from './prepare.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('prepares exact reviewed bytes, local snapshots and invalid authorization template without spending',async()=>{
 const b=evidenceFixture(),p=buildPreparedRequest([b],'labels');
 expect(p.requestHash).toBe(sha256(p.requestBody));expect(p.requestBytes).toBe(Buffer.byteLength(p.requestBody));
 expect(p.requestBody).not.toContain('example/project');expect(p.estimatedReservationUsd).toBeGreaterThan(0);
 const root=await mkdtemp(join(tmpdir(),'advisory-prepare-'));roots.push(root);const dir=join(root,'prepared');
 await prepareOperation([b],'labels',null,dir,()=>new Date('2026-10-28T12:00:00Z'));
 expect((await readPreparedOperation(dir)).prepared).toEqual(p);
 expect((await stat(join(dir,'body.json'))).mode&0o777).toBe(0o600);
 expect(await readFile(join(dir,'body.json'),'utf8')).toBe(p.requestBody);
 const preview=await readFile(join(dir,'preview.md'),'utf8');expect(preview).toContain('payloadReviewed');expect(preview).toContain('false');expect(preview).toContain('not a guaranteed');
 await expect(prepareOperation([b],'labels',null,dir)).rejects.toThrow('output-exists');
 await writeFile(join(dir,'body.json'),p.requestBody+' ');await expect(readPreparedOperation(dir)).rejects.toThrow('prepared-body-mismatch');
});
it('refuses private snapshots before constructing requests, then allows corrected public input',()=>{
 const b=evidenceFixture({repository:{id:1,name:'example/project',visibility:'private'}});
 expect(()=>buildPreparedRequest([b],'labels')).toThrow('private-inference-disabled');
 expect(buildPreparedRequest([evidenceFixture()],'labels').task).toBe('labels');
});
