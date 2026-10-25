// Explicit bounded developer probe. Does not run on application startup.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {validate} from '../server/domain.mjs';
import {reportRequest,parseReport} from '../server/gfw.mjs';
const [tokenFile,version='v5.0']=process.argv.slice(2);if(!tokenFile||!['v4.0','v5.0'].includes(version))throw Error('Usage: node scripts/probe-port-distance.mjs TOKEN_FILE [v4.0|v5.0]');
const token=(await readFile(tokenFile,'utf8')).trim();if(!token)throw Error('An explicit personal token is required.');
const dir=join('local-data/probes/port-distance',version+'-'+randomUUID());await mkdir(dir,{recursive:true});
for(const distanceFromPortKm of [0,3]){
 const query=validate({source:'gfw-fishing',datasetVersion:version,start:'2024-01-01',end:'2024-02-01',grid:.1,interval:'ENTIRE',grouping:'GEARTYPE',bounds:[-2,49,-1,50],distanceFromPortKm}),request=reportRequest(query);
 const response=await fetch(request.url,{method:request.method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(request.body),redirect:'error',signal:AbortSignal.timeout(60000)});let size=0;const chunks=[];
 for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw Error('Probe exceeds 2 MiB; no second request will be made.');chunks.push(chunk);}const raw=Buffer.concat(chunks);if(raw.includes(Buffer.from(token)))throw Error('Credential echo rejected.');
 const record={at:new Date().toISOString(),query,request,status:response.status,reportedVersion:response.headers.get('x-datasets'),bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};
 await writeFile(join(dir,`${distanceFromPortKm}.response.json`),raw,{flag:'wx',mode:0o600});await writeFile(join(dir,`${distanceFromPortKm}.request.json`),JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({directory:dir,distanceFromPortKm,status:response.status,bytes:raw.length}));if(response.status!==200)break;
 const parsed=parseReport(raw.toString('utf8'),query,record.reportedVersion);console.log(JSON.stringify({distanceFromPortKm,rows:parsed.rows.length,total:parsed.rows.reduce((n,r)=>n+r.hours,0),version:parsed.responseVersion}));
}
