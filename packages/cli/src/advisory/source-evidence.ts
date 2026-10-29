import {gitBlobSha,jsonDigest,safeRelativePath} from '@cirujano/core';
import {assertSafeEvidenceSource,type EvidenceBundleV1,type EvidenceSource} from './contracts.js';
import {strictRecord} from './storage.js';
import {assertSafeDeclaredSource,SOURCE_ADMISSION_POLICY} from './source-admission.js';

/** Local repository source at a run head; deliberately carries no execution attribution. */
export interface SourceDeclarationV1 {
 schemaVersion:1;kind:'advisory-declared-source';scope:'repository-at-run-head';
 repository:EvidenceBundleV1['repository'];run:EvidenceBundleV1['run'];source:EvidenceSource;
 fetchedAt:string;toolSourceSha:string;apiVersion:'2022-11-28';digest:string;
}
export interface SourceDeclarationV2 extends Omit<SourceDeclarationV1,'schemaVersion'> {schemaVersion:2;admissionPolicy:typeof SOURCE_ADMISSION_POLICY}
export type SourceDeclaration=SourceDeclarationV1|SourceDeclarationV2;
const invalid='advisory-source-invalid-evidence';
function requireValue(condition:unknown):asserts condition {if(!condition)throw new Error(invalid);}
function sha(value:unknown):boolean{return typeof value==='string'&&/^[a-f0-9]{40}$/u.test(value);}
function positive(value:unknown):boolean{return Number.isSafeInteger(value)&&(value as number)>0;}
export function decodeSourceDeclaration(value:unknown):SourceDeclaration {
 const version2=value!==null&&typeof value==='object'&&(value as {schemaVersion?:unknown}).schemaVersion===2;
 const raw=strictRecord(value,['schemaVersion','kind','scope','repository','run','source','fetchedAt','toolSourceSha','apiVersion','digest',...(version2?['admissionPolicy']:[])],invalid);
 requireValue(raw.schemaVersion===(version2?2:1)&&raw.kind==='advisory-declared-source'&&raw.scope==='repository-at-run-head'&&raw.apiVersion==='2022-11-28');
 if(version2)requireValue(raw.admissionPolicy===SOURCE_ADMISSION_POLICY);
 const repo=strictRecord(raw.repository,['id','name','visibility'],invalid);
 requireValue(positive(repo.id)&&typeof repo.name==='string'&&repo.name.length<=512&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo.name)&&!repo.name.split('/').some(p=>p==='.'||p==='..')&&['public','private','synthetic'].includes(String(repo.visibility)));
 const run=strictRecord(raw.run,['id','attempt','headSha','event'],invalid);
 requireValue(positive(run.id)&&positive(run.attempt)&&sha(run.headSha)&&typeof run.event==='string'&&run.event.length>0&&Buffer.byteLength(run.event)<=2048);
 const source=strictRecord(raw.source,['path','blobSha','content','lineStart','lineEnd'],invalid);
 requireValue(typeof source.path==='string'&&/^\.github\/workflows\/[^/]+\.ya?ml$/u.test(source.path));safeRelativePath(source.path);
 requireValue(typeof source.content==='string'&&Buffer.byteLength(source.content)<=256*1024&&sha(source.blobSha));
 (version2?assertSafeDeclaredSource:assertSafeEvidenceSource)(source.content,source.path);
 const lines=source.content.split('\n');requireValue(lines.length<=10000&&source.lineStart===1&&source.lineEnd===lines.length&&gitBlobSha(source.content)===source.blobSha);
 requireValue(typeof raw.fetchedAt==='string'&&Number.isFinite(Date.parse(raw.fetchedAt))&&sha(raw.toolSourceSha));
 const {digest,...content}=raw;requireValue(typeof digest==='string'&&/^[a-f0-9]{64}$/u.test(digest)&&jsonDigest(content)===digest);
 return raw as unknown as SourceDeclaration;
}
export function sealSourceDeclaration(value:Omit<SourceDeclarationV1,'digest'>):SourceDeclarationV1;
export function sealSourceDeclaration(value:Omit<SourceDeclarationV2,'digest'>):SourceDeclarationV2;
export function sealSourceDeclaration(value:Omit<SourceDeclarationV1,'digest'>|Omit<SourceDeclarationV2,'digest'>):SourceDeclaration {
 const content={...value} as Partial<SourceDeclaration>;delete content.digest;
 return decodeSourceDeclaration({...content,digest:jsonDigest(content)});
}
