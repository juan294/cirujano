import { describe,expect,it } from 'vitest';
import { ownedZip } from './artifact-zip.test-helper.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readQualityZip } from './artifact-zip.js';
describe('bounded GitHub quality ZIP',()=>{
 it('reads an actual platform ZIP archive',()=>{const directory=mkdtempSync(join(tmpdir(),'owned-quality-zip-'));try{writeFileSync(join(directory,'quality.json'),'{"tests":[]}');execFileSync('/usr/bin/zip',['-q','archive.zip','quality.json'],{cwd:directory});expect(readQualityZip(readFileSync(join(directory,'archive.zip'))).toString()).toBe('{"tests":[]}');}finally{rmSync(directory,{recursive:true,force:true});}});
 it.each([false,true])('reads an owned complete archive compressed=%s entirely in memory',compressed=>{const body=Buffer.from('{"quality":"owned"}');expect(readQualityZip(ownedZip(body,'quality.json',compressed))).toEqual(body);});
 it.each(['../quality.json','/quality.json','quality\\file.json','other.json'])('rejects unsafe or unexpected member %s',name=>expect(()=>readQualityZip(ownedZip(Buffer.from('{}'),name))).toThrow());
 it.each(['crc','local-name','encrypted','symlink','fifo','socket','device','unix-directory','zip64','trailing','bomb','directory-count'])('rejects %s before extracting',mutation=>{let zip=ownedZip(Buffer.from('{}'));const central=zip.indexOf(Buffer.from('504b0102','hex'));if(mutation==='crc')zip.writeUInt32LE(0,central+16);else if(mutation==='local-name')zip[30]=120;else if(mutation==='encrypted')zip.writeUInt16LE(1,central+8);else if(mutation==='symlink')zip.writeUInt32LE((0o120777*65536)>>>0,central+38);else if(['fifo','socket','device','unix-directory'].includes(mutation))zip.writeUInt32LE(({fifo:0o010644,socket:0o140644,device:0o060644,'unix-directory':0o040755}[mutation]! *65536)>>>0,central+38);else if(mutation==='zip64')zip.writeUInt32LE(0xffffffff,central+24);else if(mutation==='trailing')zip=Buffer.concat([zip,Buffer.from('untrusted')]);else if(mutation==='bomb')zip=ownedZip(Buffer.alloc(1048577));else zip.writeUInt16LE(2,zip.length-12);expect(()=>readQualityZip(zip)).toThrow();});
});
