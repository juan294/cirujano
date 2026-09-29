import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute } from 'node:path';
import { canonicalJson, decodeSourceManifest, gitBlobSha, safeRelativePath, sha256, type SourceManifest } from '@cirujano/core';
const execute=promisify(execFile);
/** Read committed Git objects only. Never checkout, execute source, stage or modify this repository. */
export async function readLocalCandidate(repository:string,candidateSha:string,source:SourceManifest,candidateWorkflow:string):Promise<SourceManifest['files']> {
 decodeSourceManifest(source);
 if(!isAbsolute(repository)||/[\u0000-\u001f]/.test(repository)||!/^[a-f0-9]{40}$/.test(candidateSha)||candidateSha===source.provenance.baseSha)throw new Error('candidate-identity-invalid');
 async function git(args:string[],maximum=8*1024*1024):Promise<Buffer>{const {stdout}=await execute('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',repository,...args],{encoding:'buffer',maxBuffer:maximum,timeout:60_000});return stdout;}
 if((await git(['rev-parse','--verify',`${candidateSha}^{commit}`])).toString().trim()!==candidateSha)throw new Error('candidate-commit-invalid');
 await git(['merge-base','--is-ancestor',source.provenance.baseSha,candidateSha]);
 const entries=(await git(['ls-tree','-r','-z',candidateSha])).toString('utf8').split('\0').filter(Boolean);
 if(entries.length>5000)throw new Error('candidate-source-size');
 const originals=new Map(source.files.map(file=>[file.path,file]));
 const files:SourceManifest['files']=[];let total=0;
 for(const entry of entries){const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s.exec(entry);if(!match)throw new Error('candidate-file-mode');const [,mode,blob,path]=match;
  safeRelativePath(path!);const original=originals.get(path!);if(!original||original.mode!==mode)throw new Error('candidate-file-drift');
  const bytes=await git(['cat-file','blob',blob!],4*1024*1024+1);total+=bytes.length;if(bytes.length>4*1024*1024||total>16*1024*1024||gitBlobSha(bytes)!==blob)throw new Error('candidate-blob-invalid');
  files.push({path:path!,mode:mode as '100644'|'100755',hash:sha256(bytes),bytesBase64:bytes.toString('base64')});
 }
 files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const expected=source.files.map(file=>file.path===source.provenance.workflowPath?{...file,hash:sha256(candidateWorkflow),bytesBase64:Buffer.from(candidateWorkflow).toString('base64')}:file);
 if(canonicalJson(files)!==canonicalJson(expected))throw new Error('candidate-source-drift');return files;
}
