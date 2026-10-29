import {expect,it} from 'vitest';
import {collectSourceDeclaration} from './collect.js';
import {api,options,request,workflow} from './collector-fixture.js';
import {searchSourceDeclarations} from './source-search.js';

const selection={repository:request.repository,run:request.run,attempt:request.attempt,workflow:request.workflow};
async function search(query:string,command='pnpm install --frozen-lockfile',extra='') {
 const content=extra+workflow.replace('pnpm install --frozen-lockfile',command);
 const source=await collectSourceDeclaration(selection,options(api(content).pageRunner));
 return searchSourceDeclarations([source],query);
}
it.each(['Which provider log establishes whether dependencies missed the cache?','Show a trace proving the regression was caused by a required wait','What actually ran and how much time was wasted?','Show cache hit records','Which job had a cache hit?','Show test results','Which declared trace proves the regression?','Which configured package manifest defines helper implementation?','Show the package.json manifest that defines the scripts','Show the external helper body that implements verification','Which reusable-workflow implementation resolves the hidden behavior?'])('abstains when workflow declarations cannot provide requested evidence: %s',async query=>{
 const result=await search(query,'echo workflow source trace log helper implementation cache regression wait');
 expect(result.status).toBe('no-match');expect(result.payload.documentCount).toBe(1);expect(result.payload.hits).toEqual([]);
 expect(result.reasonCodes).not.toContain('search-no-lexical-match');
});
it.each([['Show cache hit records','uses: actions/cache@v7'],['Which job had a cache hit?','uses: actions/cache@v7'],['Which jobs had cache hits?','uses: actions/cache@v7'],['Which jobs had cache misses?','uses: actions/cache@v7'],['Show test results','run: pnpm test']])('does not substitute an invocation for requested runtime records: %s',async(query,step)=>{
 const content=workflow.replace('run: pnpm install --frozen-lockfile',step),source=await collectSourceDeclaration(selection,options(api(content).pageRunner));
 const result=searchSourceDeclarations([source],query);expect(result.status).toBe('no-match');expect(result.reasonCodes).toContain('source-runtime-evidence-unavailable');
});
it.each(['Where does the workflow declare a build?','Find test commands','Where are artifacts uploaded?','Where is caching configured?'])('does not return installation or metadata for another operation: %s',async query=>{
 const result=await search(query,'pnpm install --frozen-lockfile','# build test artifact cache source workflow\n');
 expect(result.status).toBe('no-match');expect(result.payload.hits).toEqual([]);
});
it('does not treat a step label, comment or echoed command as operation evidence',async()=>{
 const result=await search('Where is dependency installation declared?','echo "pip install example"','# dependency installation\n');
 expect(result.status).toBe('no-match');expect(result.payload.hits).toEqual([]);
});
it.each([
 ['Where is dependency installation?','npm ci'],
 ['Where are Python prerequisites installed?','python3 -m pip install example'],
 ['Which command installs operating-system packages?','sudo apt-get install example'],
 ['Where is the build entrypoint invoked and what implementation is missing?','pnpm run build'],
 ['Where is coverage testing invoked?','pnpm run test:coverage'],
 ['Where is behavioral testing declared?','node --test src/check.test.js'],
])('retains positive declaration navigation: %s',async(query,command)=>{
 const result=await search(query,command);expect(result.status).toBe('complete');expect(result.payload.hits.some(hit=>hit.text.includes(command))).toBe(true);
 expect(result.payload).toMatchObject({searchPolicyVersion:'declared-source-search-v2'});
});
it('keeps mixed cache-location questions as declarations while refusing runtime proof alone',async()=>{
 const content=workflow.replace('run: pnpm install --frozen-lockfile','uses: actions/cache@v7'),source=await collectSourceDeclaration(selection,options(api(content).pageRunner));
 expect(searchSourceDeclarations([source],'Where is caching configured and does that declaration prove a cache miss?').status).toBe('complete');
 expect(searchSourceDeclarations([source],'Prove an actual cache miss').status).toBe('no-match');
});
it('requires specific terms while preserving direct literal source lookup',async()=>{
 expect((await search('Find retained workflow source jobs')).status).toBe('no-match');
 expect((await search('Find echo','echo hello')).status).toBe('complete');
});
