import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot=fileURLToPath(new URL('../..',import.meta.url));
const require=createRequire(new URL('../../packages/cli/package.json',import.meta.url));
const {build}=require('esbuild');
const argv=process.argv.slice(2);let check=false,output=join(repositoryRoot,'packages/cli/fixtures/advisory/evaluation');
for(let i=0;i<argv.length;i++){
 if(argv[i]==='--check'&&!check)check=true;
 else if(argv[i]==='--output'&&argv[i+1])output=resolve(argv[++i]);
 else throw new Error('Usage: node scripts/advisory/generate-corpus.mjs [--check] [--output DIR]');
}
const temporary=await mkdtemp(join(tmpdir(),'cirujano-corpus-generator-'));
try{
 const modulePath=join(temporary,'corpus.mjs');
 await build({entryPoints:[join(repositoryRoot,'packages/cli/src/advisory/evaluation-corpus.ts')],outfile:modulePath,bundle:true,platform:'node',target:'node22',format:'esm',banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"},sourcemap:false,logLevel:'silent'});
 const generator=await import(pathToFileURL(modulePath).href);
 if(!check)await generator.writeEvaluationCorpus(output);
 const summary=await generator.validateEvaluationCorpus(output);
 process.stdout.write(JSON.stringify({schemaVersion:1,status:'frozen',output,...summary})+'\n');
}finally{await rm(temporary,{recursive:true,force:true});}
