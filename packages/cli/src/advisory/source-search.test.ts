import {expect,it} from 'vitest';
import {gitBlobSha} from '@cirujano/core';
import {collectSourceDeclaration} from './collect.js';
import {api,options,request} from './collector-fixture.js';
import {sealSourceDeclaration} from './source-evidence.js';
import {searchSourceDeclarations} from './source-search.js';

const selection={repository:request.repository,run:request.run,attempt:request.attempt,workflow:request.workflow};
it('deduplicates source identity across snapshots and refuses conflicting bytes at the same head/path',async()=>{
 const source=await collectSourceDeclaration(selection,options(api().pageRunner));
 const repeated=sealSourceDeclaration({...source,fetchedAt:'2026-10-29T01:00:00Z',run:{...source.run,id:11}});
 const result=searchSourceDeclarations([source,repeated],'install');expect(result.payload.documentCount).toBe(1);expect(result.payload.hits).toHaveLength(1);expect(result.payload.inputDigests).toHaveLength(2);
 const content=source.source.content+'# changed\n',changed=sealSourceDeclaration({...source,source:{...source.source,content,blobSha:gitBlobSha(content),lineEnd:content.split('\n').length}});
 expect(()=>searchSourceDeclarations([source,changed],'install')).toThrow('advisory-source-conflicting-evidence');
});
it('returns no lexical match without claiming absence and validates queries before exposing them',async()=>{
 const source=await collectSourceDeclaration(selection,options(api().pageRunner));
 const noMatch=searchSourceDeclarations([source],'unicorn');expect(noMatch.status).toBe('no-match');expect(noMatch.payload.hits).toEqual([]);
 expect(searchSourceDeclarations([],'install').payload.documentCount).toBe(0);
 expect(()=>searchSourceDeclarations([source],'')).toThrow('search-invalid-query');
 expect(()=>searchSourceDeclarations([source],'apiKey: private-canary')).toThrow('search-sensitive-query');
});
it.each(['headSha','event'])('refuses contradictory %s snapshots of the same repository/run/attempt/workflow',async field=>{
 const source=await collectSourceDeclaration(selection,options(api().pageRunner));
 const contradictory=sealSourceDeclaration({...source,run:{...source.run,[field]:field==='headSha'?'3'.repeat(40):'schedule'}});
 expect(()=>searchSourceDeclarations([source,contradictory],'install')).toThrow('advisory-source-conflicting-evidence');
});
it('bounds source inventories and aggregate bytes without silently truncating input evidence',async()=>{
 const source=await collectSourceDeclaration(selection,options(api().pageRunner));
 expect(()=>searchSourceDeclarations(Array.from({length:21},()=>source),'install')).toThrow('advisory-input-limit');
 const content='name: '+'a'.repeat(256*1024-6),large=sealSourceDeclaration({...source,source:{...source.source,content,blobSha:gitBlobSha(content),lineEnd:1}});
 expect(()=>searchSourceDeclarations(Array.from({length:9},()=>large),'install')).toThrow('advisory-source-size-limit');
});
it('finds private declarations locally and limits deterministic non-overlapping hits to three',async()=>{
 const content='name: CI\njobs:\n  check:\n    steps:\n'+Array.from({length:10},(_,i)=>`      - run: python3 -m pip install package-${i}\n        # filler\n        # filler\n        # filler\n        # filler\n        # filler`).join('\n'),source=await collectSourceDeclaration(selection,options(api(content).pageRunner));
 const privateSource=sealSourceDeclaration({...source,repository:{...source.repository,visibility:'private'}});
 const result=searchSourceDeclarations([privateSource],'install');expect(result.payload.hits).toHaveLength(3);expect(result.payload.candidateCount).toBe(10);
 expect(result.payload.hits.map(h=>h.lineStart)).toEqual([3,9,15]);
 expect(result.payload.hits.every(hit=>hit.repository.visibility==='private')).toBe(true);
});
