// ZIP store method with data descriptors. No compression/native dependencies.
// Format reference: PKWARE APPNOTE 6.3.10, sections 4.3.7–4.3.16.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const update=(crc,buffer)=>{for(const byte of buffer)crc=table[(crc^byte)&255]^(crc>>>8);return crc>>>0;};
export function crc32Accumulator(){let value=0xffffffff;return {update:buffer=>{value=update(value,buffer);},digest:()=>(value^0xffffffff)>>>0};}
export const crc32=buffer=>(update(0xffffffff,buffer)^0xffffffff)>>>0;
export async function* verifiedFile({path,size,sha256}){let count=0;const digest=createHash('sha256');for await(const chunk of createReadStream(path)){count+=chunk.length;digest.update(chunk);yield chunk;}if(count!==size||digest.digest('hex')!==sha256)throw Error('Archive changed during download.');}
export async function* zipEntries(entries){
 const directory=[];let offset=0;
 for(const entry of entries){
  if(!/^[a-zA-Z0-9_./-]+$/.test(entry.name)||entry.name.includes('..')||entry.name.startsWith('/'))throw Error('Invalid archive entry name.');
  const name=Buffer.from(entry.name);const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0808,6);header.writeUInt16LE(0x21,12);header.writeUInt16LE(name.length,26);
  const start=offset;yield header;yield name;offset+=header.length+name.length;
  let crc=0xffffffff,size=0;const digest=createHash('sha256');
  const source=entry.open?entry.open():entry.data?[entry.data]:createReadStream(entry.path);
  for await(const chunk of source){crc=update(crc,chunk);digest.update(chunk);size+=chunk.length;if(size>0xffffffff)throw Error('ZIP64 is not supported.');yield chunk;offset+=chunk.length;}
  if(entry.size!==undefined&&size!==entry.size)throw Error('Archive source changed during export.');
  if(entry.sha256&&digest.digest('hex')!==entry.sha256)throw Error('Archive source integrity changed during export.');
  crc=(crc^0xffffffff)>>>0;
  const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(size,8);descriptor.writeUInt32LE(size,12);yield descriptor;offset+=16;
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0808,8);central.writeUInt16LE(0x21,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(size,20);central.writeUInt32LE(size,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(start,42);directory.push(central,name);
 }
 const directoryStart=offset;
 for(const part of directory){yield part;offset+=part.length;}
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(offset-directoryStart,12);end.writeUInt32LE(directoryStart,16);yield end;
}
