import {inspectSourceEnvironments,type SourceEnvironmentMapping} from '@cirujano/core';
import {AdvisoryEvidenceError,assertSafeEvidenceSource,hasCredentialAssignment} from './contracts.js';

export const SOURCE_ADMISSION_POLICY='declared-source-benign-env-v1' as const;
const jobKey=/^[A-Za-z_][A-Za-z0-9_-]*$/u;
function allowedLocation(path:SourceEnvironmentMapping['path']):boolean {
 return path.length===1||(path[0]==='jobs'&&typeof path[1]==='string'&&jobKey.test(path[1])&&(path.length===3||(path.length===5&&path[2]==='steps'&&typeof path[3]==='number')));
}
function integer(value:unknown,minimum:number,maximum:number):boolean {
 return (typeof value==='number'&&Number.isInteger(value)&&value>=minimum&&value<=maximum)||(typeof value==='string'&&/^[1-9]\d*$/u.test(value)&&Number(value)>=minimum&&Number(value)<=maximum);
}
function allowedValue(key:string,value:unknown):boolean {
 if(!/^[A-Z_][A-Z0-9_]{0,63}$/u.test(key)||hasCredentialAssignment(key+':'))return false;
 if(key==='NODE_ENV')return typeof value==='string'&&['development','test','production'].includes(value);
 if(key==='CI')return typeof value==='boolean'||value==='true'||value==='false';
 if(key==='QEMU_CPU_LIMIT'||key==='CIRUJANO_QEMU_CPUS')return integer(value,1,64);
 if(key==='NODE_OPTIONS'){
  const match=typeof value==='string'?/^--max-old-space-size=([1-9]\d*)$/u.exec(value):null;
  return match!==null&&integer(match[1],128,65536);
 }
 return typeof value==='string'&&/^\$\{\{[ \t]*needs\.[A-Za-z_][A-Za-z0-9_-]*\.result[ \t]*\}\}$/u.test(value);
}
function checkDecoded(value:unknown,path:string):void {
 if(typeof value==='string')assertSafeEvidenceSource(value,path);
 else if(Array.isArray(value))value.forEach(item=>checkDecoded(item,path));
 else if(value!==null&&typeof value==='object')for(const [key,item]of Object.entries(value)){
  if(hasCredentialAssignment(key+':'))throw new AdvisoryEvidenceError('unsafe-source-credential-or-environment');
  checkDecoded(item,path);
 }
}
/** Only the validation view masks approved AST keys; retained bytes are never modified. */
export function assertSafeDeclaredSource(content:string,path:string):void {
 const originalError=new AdvisoryEvidenceError('unsafe-source-credential-or-environment');
 try{
  const {data,mappings}=inspectSourceEnvironments(content);checkDecoded(data,path);
  let end=0,view='';
  for(const mapping of mappings){
   if(mapping.key!=='env'||!allowedLocation(mapping.path)||mapping.keyStart<end||mapping.keyEnd>content.length||content.slice(mapping.keyStart,mapping.keyEnd)!=='env')throw originalError;
   if(mapping.value===null||typeof mapping.value!=='object'||Array.isArray(mapping.value))throw originalError;
   const fields=Object.entries(mapping.value);if(!fields.length||fields.length>100||fields.some(([key,value])=>!allowedValue(key,value)))throw originalError;
   view+=content.slice(end,mapping.keyStart)+' '.repeat(mapping.keyEnd-mapping.keyStart);end=mapping.keyEnd;
  }
  view+=content.slice(end);assertSafeEvidenceSource(view,path);
 }catch{throw originalError;}
}
