import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '@cirujano/core';
import { readPrivateJson, withOperationStore, type OperationStore } from '../optimization/store.js';
import { decodeEvidence, type EvidenceBundleV1 } from './contracts.js';

export async function readEvidenceDirectory(directory:string):Promise<EvidenceBundleV1>{return decodeEvidence(await readPrivateJson(join(directory,'evidence.json'),4*1024*1024));}
export function inputDigests(value:unknown):string[]{
 if(!Array.isArray(value)||value.length===0||value.length>20||!value.every(d=>typeof d==='string'&&/^[a-f0-9]{64}$/u.test(d))||new Set(value).size!==value.length)throw new Error('prepared-invalid-inputs');
 return value as string[];
}
export async function readRetainedBundles(directory:string,digests:readonly string[]):Promise<EvidenceBundleV1[]>{
 const bundles:EvidenceBundleV1[]=[];
 for(const digest of digests){const bundle=decodeEvidence(await readPrivateJson(join(directory,`bundle-${digest}.json`),4*1024*1024));if(bundle.digest!==digest)throw new Error('prepared-input-digest-mismatch');bundles.push(bundle);}
 return bundles;
}
/** Local fallback reads validated snapshots even when the inference body/version is unusable. */
export async function readEvidenceInputs(directory:string,maximum=20):Promise<EvidenceBundleV1[]>{
 if(maximum<1||maximum>20)throw new Error('advisory-input-limit');
 const direct=await optionalJson(join(directory,'evidence.json'),4*1024*1024);
 if(direct!==null)return [decodeEvidence(direct)];
 const raw=await readPrivateJson(join(directory,'prepared.json'),4*1024*1024);
 if(raw===null||typeof raw!=='object'||Array.isArray(raw))throw new Error('prepared-invalid');
 const prepared=raw as Record<string,unknown>;
 if(prepared.schemaVersion!==1||prepared.kind!=='advisory-prepared-request')throw new Error('prepared-invalid');
 const digests=inputDigests(prepared.inputDigests);if(digests.length>maximum)throw new Error('advisory-input-limit');
 return readRetainedBundles(directory,digests);
}
export async function freshOperation<T>(directory:string,work:(store:OperationStore)=>Promise<T>):Promise<T>{
 return withOperationStore(directory,async store=>{
  const lockFiles=new Set(['.controller-lock.sqlite','.controller-lock.sqlite-journal','.controller.sock']);
  if((await readdir(store.directory)).some(name=>!lockFiles.has(name)))throw new Error('advisory-output-exists');
  return work(store);
 });
}
export async function optionalJson(path:string,maximumBytes=1024*1024):Promise<unknown|null>{
 try{return await readPrivateJson(path,maximumBytes);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
export function strictRecord(value:unknown,keys:readonly string[],reason:string):Record<string,unknown>{
 canonicalJson(value);
 if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new Error(reason);
 return value as Record<string,unknown>;
}
