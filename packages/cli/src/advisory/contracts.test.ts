import { describe, expect, it } from 'vitest';
import { jsonDigest, gitBlobSha } from '@cirujano/core';
import { decodeEvidence, sealEvidence } from './contracts.js';
import { evidenceFixture } from './fixture.js';

describe('advisory evidence integrity',()=>{
 it('round-trips exact private/public evidence without changing source bytes',()=>{
  const value=evidenceFixture();expect(decodeEvidence(value)).toEqual(value);
  expect(decodeEvidence(evidenceFixture({repository:{id:1,name:'example/private',visibility:'private'}})).repository.visibility).toBe('private');
 });
 it('rejects missing, unknown and forged fields even when digest is recomputed',()=>{
  const value=evidenceFixture();expect(()=>decodeEvidence({...value,extra:true})).toThrow();
  expect(()=>decodeEvidence({...value,digest:'0'.repeat(64)})).toThrow(/digest/);
  const missing: Partial<typeof value>={...value}; delete missing.job;expect(()=>decodeEvidence(missing)).toThrow();
  const content: Partial<typeof value>={...value}; delete content.digest;const forged={...content,job:{...value.job,id:0}};expect(()=>decodeEvidence({...forged,digest:jsonDigest(forged)})).toThrow(/id/);
 });
 it('validates source hash, size, unique source paths and step identity',()=>{
  const value=evidenceFixture();expect(()=>sealEvidence({...value,sources:[{...value.sources[0]!,content:value.sources[0]!.content.replace('pnpm','yarn')}]})).toThrow(/blob/);
  expect(()=>sealEvidence({...value,sources:[value.sources[0]!,value.sources[0]!]})).toThrow(/duplicate/);
  expect(()=>sealEvidence({...value,steps:[value.steps[0]!,value.steps[0]!]})).toThrow(/duplicate/);
  const content='x'.repeat(256*1024+1);expect(()=>sealEvidence({...value,sources:[{path:'x.txt',content,blobSha:gitBlobSha(content),lineStart:1,lineEnd:1}]})).toThrow(/size/);
 });
 it('rejects contradictory timing and unsafe source attribution',()=>{
  const value=evidenceFixture();expect(()=>sealEvidence({...value,job:{...value.job,completedAt:'2026-10-28T00:00:00Z',startedAt:'2026-10-28T01:00:00Z'}})).toThrow(/timing/);
  expect(()=>sealEvidence({...value,mapping:'unsupported-mapping'})).toThrow(/mapping/);
  expect(()=>sealEvidence({...value,steps:[{...value.steps[0]!,lineStart:null}]})).toThrow(/mapping/);
 });
 it('preserves null timing and explicit missing/ambiguous reasons',()=>{
  const value=evidenceFixture();const missing=sealEvidence({...value,job:{...value.job,startedAt:null,completedAt:null},reasonCodes:['missing-job-timing']});
  expect(decodeEvidence(missing).job.startedAt).toBeNull();expect(missing.reasonCodes).toContain('missing-job-timing');
 });
 it('rechecks mapping after a caller reseals duplicate or reordered source',()=>{
  const value=evidenceFixture();const content=value.sources[0]!.content+'      - name: Install\n        run: pnpm install --frozen-lockfile\n';
  expect(()=>sealEvidence({...value,workflow:{...value.workflow,blobSha:gitBlobSha(content)},sources:[{...value.sources[0]!,content,blobSha:gitBlobSha(content),lineEnd:content.split('\n').length}]})).toThrow(/mapping/);
  expect(()=>sealEvidence({...value,job:{...value.job,key:'${{ matrix.job }}'}})).toThrow(/job-key/);
 });
 it.each(['env:\n  NODE_ENV: production\n', 'token: literal-credential\n', 'export PROJECT_CONFIG=literal\n', 'Authorization: Bearer literal-value\n', 'https://name:password@example.com/file'])('rejects credential/environment-bearing source without scrubbing exact bytes: %s',content=>{
  const value=evidenceFixture();expect(()=>sealEvidence({...value,sources:[...value.sources,{path:'config.txt',blobSha:gitBlobSha(content),content,lineStart:1,lineEnd:content.split('\n').length}]})).toThrow(/unsafe-source/);
 });

 it.each(['{"clientSecret":"literal-value"}', 'const accessToken = "literal"', 'apiKey: "literal"'])('refuses raw camelCase credential source while corrected public input succeeds: %s',content=>{
  const value=evidenceFixture();expect(()=>sealEvidence({...value,sources:[...value.sources,{path:'public.txt',blobSha:gitBlobSha(content),content,lineStart:1,lineEnd:1}]})).toThrow('unsafe-source-credential-or-environment');
  expect(decodeEvidence(evidenceFixture()).mapping).toBe('supported');
 });

});
