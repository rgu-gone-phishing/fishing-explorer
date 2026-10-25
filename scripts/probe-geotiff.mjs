// Explicit opt-in report contract probe. Never called by startup or tests.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {validate} from '../server/domain.mjs';
import {reportRequest} from '../server/gfw.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/probe-geotiff.mjs TOKEN_FILE [JSON_QUERY_OVERRIDES]');
const token=(await readFile(process.argv[2],'utf8')).trim(),query=validate({source:'gfw-fishing',datasetVersion:'v5.0',start:'2024-01-01',end:'2024-01-03',grid:0.1,interval:'DAILY',grouping:'GEARTYPE',bounds:[-2,49,-1,50],...JSON.parse(process.argv[3]||'{}')});
const request=reportRequest(query),url=new URL(request.url);url.searchParams.set('format','TIF');request.url=url.href;
const response=await fetch(request.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(115000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/zip'},body:JSON.stringify(request.body)});
const chunks=[];let size=0;for await(const b of response.body){size+=b.length;if(size>32*1024*1024)throw Error('Probe exceeds 32 MiB.');chunks.push(Buffer.from(b));}const bytes=Buffer.concat(chunks);if(bytes.includes(Buffer.from(token)))throw Error('Credential echo rejected.');
const dir=join('local-data/probes/geotiff',randomUUID());await mkdir(dir,{recursive:true});await writeFile(join(dir,'response.bin'),bytes,{flag:'wx',mode:0o600});const summary={receivedAt:new Date().toISOString(),query,request,status:response.status,type:response.headers.get('content-type'),dataset:response.headers.get('x-datasets'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};await writeFile(join(dir,'request.json'),JSON.stringify(summary,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({directory:dir,status:summary.status,type:summary.type,bytes:size,signature:bytes.subarray(0,8).toString('hex')}));
