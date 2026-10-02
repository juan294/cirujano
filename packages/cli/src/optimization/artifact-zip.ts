import { inflateRawSync } from 'node:zlib';
import { safeRelativePath } from '@cirujano/core';
const MAX_ARCHIVE=8*1024*1024,MAX_OUTPUT=1024*1024;
function invalid():never{throw new Error('quality-archive-invalid');}
function crc32(bytes:Buffer):number{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
/** Exactly one bounded regular quality.json, decoded in memory; no extraction writes. */
export function readQualityZip(archive:Buffer):Buffer{
 if(!Buffer.isBuffer(archive)||archive.length<22||archive.length>MAX_ARCHIVE)invalid();
 let end=-1;for(let offset=archive.length-22;offset>=Math.max(0,archive.length-65557);offset--)if(archive.readUInt32LE(offset)===0x06054b50&&offset+22+archive.readUInt16LE(offset+20)===archive.length){end=offset;break;}
 if(end<0||archive.readUInt16LE(end+4)!==0||archive.readUInt16LE(end+6)!==0||archive.readUInt16LE(end+8)!==1||archive.readUInt16LE(end+10)!==1)invalid();
 const directorySize=archive.readUInt32LE(end+12),directory=archive.readUInt32LE(end+16);
 if(directory+directorySize!==end||directorySize<46||directory+46>end||archive.readUInt32LE(directory)!==0x02014b50)invalid();
 const flags=archive.readUInt16LE(directory+8),method=archive.readUInt16LE(directory+10),crc=archive.readUInt32LE(directory+16),compressed=archive.readUInt32LE(directory+20),size=archive.readUInt32LE(directory+24),nameLength=archive.readUInt16LE(directory+28),extraLength=archive.readUInt16LE(directory+30),commentLength=archive.readUInt16LE(directory+32),attributes=archive.readUInt32LE(directory+38),local=archive.readUInt32LE(directory+42);
 if((flags&~0x808)!==0||![0,8].includes(method)||size>MAX_OUTPUT||compressed>MAX_ARCHIVE||archive.readUInt16LE(directory+34)!==0||local!==0||46+nameLength+extraLength+commentLength!==directorySize||(attributes&0x10)!==0||![0,0x8000].includes((attributes>>>16)&0xf000))invalid();
 const name=new TextDecoder('utf8',{fatal:true}).decode(archive.subarray(directory+46,directory+46+nameLength));safeRelativePath(name);if(name!=='quality.json')invalid();
 function checkExtra(offset:number,length:number){const last=offset+length;while(offset<last){if(offset+4>last)invalid();const kind=archive.readUInt16LE(offset),count=archive.readUInt16LE(offset+2);if(kind===1||offset+4+count>last)invalid();offset+=4+count;}}
 checkExtra(directory+46+nameLength,extraLength);
 if(directory<30||archive.readUInt32LE(0)!==0x04034b50||archive.readUInt16LE(6)!==flags||archive.readUInt16LE(8)!==method||archive.readUInt16LE(26)!==nameLength)invalid();
 const localExtra=archive.readUInt16LE(28),dataStart=30+nameLength+localExtra,dataEnd=dataStart+compressed;
 if(dataEnd>directory||!archive.subarray(30,30+nameLength).equals(Buffer.from(name)))invalid();checkExtra(30+nameLength,localExtra);
 if(flags&8){const descriptor=dataEnd,signature=descriptor+4<=directory&&archive.readUInt32LE(descriptor)===0x08074b50?4:0;if(descriptor+signature+12!==directory||archive.readUInt32LE(descriptor+signature)!==crc||archive.readUInt32LE(descriptor+signature+4)!==compressed||archive.readUInt32LE(descriptor+signature+8)!==size)invalid();}
 else if(dataEnd!==directory||archive.readUInt32LE(14)!==crc||archive.readUInt32LE(18)!==compressed||archive.readUInt32LE(22)!==size)invalid();
 let output:Buffer;
 if(method===0)output=Buffer.from(archive.subarray(dataStart,dataEnd));
 else{const result:unknown=inflateRawSync(archive.subarray(dataStart,dataEnd),{maxOutputLength:MAX_OUTPUT,info:true});if(!result||typeof result!=='object'||!('buffer'in result)||!Buffer.isBuffer(result.buffer)||!('engine'in result)||!result.engine||typeof result.engine!=='object'||!('bytesWritten'in result.engine)||result.engine.bytesWritten!==compressed)invalid();output=result.buffer;}
 if(output.length!==size||crc32(output)!==crc)invalid();return output;
}
