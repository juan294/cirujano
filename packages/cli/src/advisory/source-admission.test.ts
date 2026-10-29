import {expect,it} from 'vitest';
import {jsonDigest} from '@cirujano/core';
import {collectSourceDeclaration,collectSelectedJob} from './collect.js';
import {api,options,request,workflow} from './collector-fixture.js';
import {decodeSourceDeclaration} from './source-evidence.js';
import {searchSourceDeclarations} from './source-search.js';

const selection={repository:request.repository,run:request.run,attempt:request.attempt,workflow:request.workflow};
const collect=(content:string)=>collectSourceDeclaration(selection,options(api(content).pageRunner));
it('still reads and searches unchanged strict V1 declarations',async()=>{
 const source=await collect(workflow),legacy=JSON.parse(JSON.stringify(source));
 delete legacy.digest;delete legacy.admissionPolicy;legacy.schemaVersion=1;legacy.digest=jsonDigest(legacy);
 const decoded=decodeSourceDeclaration(legacy);expect(decoded).toEqual(legacy);
 const result=searchSourceDeclarations([decoded],'Where are dependencies installed?');
 expect(result.status).toBe('complete');expect(result.payload.admissionPolicies).toEqual(['strict-source-v1']);
});
it.each(['NODE_ENV: production','CI: true','QEMU_CPU_LIMIT: "4"','CIRUJANO_QEMU_CPUS: 2','NODE_OPTIONS: "--max-old-space-size=4096"','GOVERNOR_RESULT: ${{ needs.audit-job.result }}'])('admits only declared-source V2 benign env: %s',async field=>{
 const content='env:\n  '+field+'\n'+workflow,source=await collect(content);
 expect(source).toMatchObject({schemaVersion:2,admissionPolicy:'declared-source-benign-env-v1',source:{content}});
 expect(source.source.content).toBe(content);expect(decodeSourceDeclaration(source)).toEqual(source);
 await expect(collectSelectedJob(request,options(api(content).pageRunner))).rejects.toThrow('unsafe-source-credential-or-environment');
 const legacy=JSON.parse(JSON.stringify(source));delete legacy.digest;delete legacy.admissionPolicy;legacy.schemaVersion=1;legacy.digest=jsonDigest(legacy);
 expect(()=>decodeSourceDeclaration(legacy)).toThrow('unsafe-source-credential-or-environment');
});
it('validates multiple real env locations and preserves Unicode/CRLF bytes',async()=>{
 const content=('# café 工具\nenv: {CI: false}\n'+workflow.replace('    steps:','    env: {CIRUJANO_QEMU_CPUS: 2}\n    steps:').replace('        run:','        env: {NODE_ENV: test}\n        run:')).replaceAll('\n','\r\n');
 expect((await collect(content)).source.content).toBe(content);
});
it.each(['NODE_ENV: custom','NODE_ENV: true','CI: "yes"','CI: 1','CIRUJANO_QEMU_CPUS: 0','CIRUJANO_QEMU_CPUS: 65','CIRUJANO_QEMU_CPUS: 1.5','CIRUJANO_QEMU_CPUS: "02"','CIRUJANO_QEMU_CPUS: null','CIRUJANO_QEMU_CPUS: []','UNKNOWN: private-value','NODE_OPTIONS: "--max-old-space-size=4096 --require ./hook.js"','NODE_OPTIONS: "--max-old-space-size=0"','NODE_OPTIONS: "--max-old-space-size=999999"','RESULT: ${{ needs.audit.outputs.token }}','RESULT: ${{ secrets.HIDDEN }}','RESULT: ${{ github.token }}','RESULT: ${{ needs.audit.result || secrets.HIDDEN }}','RESULT: "prefix ${{ needs.audit.result }}"','GH_TOKEN: ${{ needs.audit.result }}','apiKey: ${{ needs.audit.result }}'])('refuses unknown or sensitive environment %s',async field=>{
 await expect(collect('env:\n  '+field+'\n'+workflow)).rejects.toThrow(/unsafe-source/u);
});
it.each([
 '"\\u0065nv": {CI: true}\n',
 "'env': {CI: true}\n",
 'env: {CI: true}\nenv: {CI: false}\n',
 'env: &a {CI: true}\nother: *a\n',
 'env: !!str value\n',
 'env: ${{ fromJSON(inputs.env) }}\n',
 'environment: production\n',
 'env: {CI: true}\nother: {env: {CI: true}}\n',
 'env: {CI: true}\n---\n',
 '"\\u0065nv": {CI: true}\ntext: "echo {env: hidden-value}"\n',
])('never masks malformed/escaped/nested keys or scalar decoys: %s',async prefix=>{
 await expect(collect(prefix+workflow)).rejects.toThrow(/unsafe-source/u);
});
it.each(['container:\n      env: {CI: true}','services:\n      db:\n        env: {CI: true}','defaults:\n      env: {CI: true}'])('refuses env outside supported job/step locations',async block=>{
 const content=workflow.replace('    steps:',block.split('\n').map((line,index)=>index===0?'    '+line:line).join('\n')+'\n    steps:');
 await expect(collect(content)).rejects.toThrow(/unsafe-source/u);
});
it.each(['# apiToken: synthetic-canary\n','other: "Bearer abcdef123456"\n','other: ${{ secrets.HIDDEN }}\n','other: https://user:password@example.com\n'])('keeps credential checks over the entire original source',async extra=>{
 await expect(collect('env: {CI: true}\n'+extra+workflow)).rejects.toThrow(/unsafe-source/u);
});
it('keeps shell assignment refusals and unknown mappings beside a benign mapping',async()=>{
 await expect(collect('env: {CI: true}\n'+workflow.replace('pnpm install --frozen-lockfile','CI=true pnpm install --frozen-lockfile'))).rejects.toThrow(/unsafe-source/u);
 await expect(collect('env: {CI: true}\n'+workflow.replace('    steps:','    env: {UNKNOWN: hidden}\n    steps:'))).rejects.toThrow(/unsafe-source/u);
});
it.each(['GH_\\u0054OKEN','PASS\\u0057ORD','AUTHORIZA\\u0054ION'])('refuses semantic credential keys even when YAML escapes their spelling: %s',async key=>{
 await expect(collect('env:\n  "'+key+'": ${{ needs.audit.result }}\n'+workflow)).rejects.toThrow(/unsafe-source/u);
});
it.each(['env: {CI: true}\n"api\\u004Bey": hidden-value\n','env: {CI: true}\nother: "\\u0042earer abcdef123456"\n'])('checks decoded keys and values outside approved env mappings',async prefix=>{
 await expect(collect(prefix+workflow)).rejects.toThrow(/unsafe-source/u);
});
it('rejects unknown V2 policy or version-field substitutions after resealing',async()=>{
 const source=await collect('env: {CI: true}\n'+workflow);
 for(const changed of [{...source,admissionPolicy:'unreviewed-policy'},{...source,schemaVersion:1}]){
  const content:Record<string,unknown>={...changed};delete content.digest;
  expect(()=>decodeSourceDeclaration({...content,digest:jsonDigest(content)})).toThrow();
 }
});
