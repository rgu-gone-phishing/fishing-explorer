import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BatchStore,planBatch} from '../server/batches.mjs';
import {JobStore} from '../server/jobs.mjs';
import {zipEntries} from '../server/zip.mjs';
import {start} from '../server/index.mjs';
const base={source:'synthetic-activity',start:'2023-12-15',end:'2024-03-10',grid:0.1,interval:'DAILY',bounds:[-2,49,-1,50]};
async function setup(fn,fetchImpl){const dir=await mkdtemp(join(tmpdir(),'fishing-batches-'));const jobs=new JobStore(dir,{fetchImpl,token:()=> 'test-token'});await jobs.load();const batches=new BatchStore(dir,jobs);await batches.load();try{await fn({dir,jobs,batches});}finally{const stop=batches.close();await jobs.close();await stop;await rm(dir,{recursive:true,force:true});}}
const complete=async(batches,batch)=>{batches.start(batch.id);await batches.running.get(batch.id);};
test('calendar-aligned partitions cover exact bounds, including leap days and partial months',()=>{
 const plan=planBatch(base);assert.deepEqual(plan.parts.map(p=>[p.start,p.end]),[['2023-12-15','2024-01-01'],['2024-01-01','2024-02-01'],['2024-02-01','2024-03-01'],['2024-03-01','2024-03-10']]);
 const days=plan.parts.reduce((sum,p)=>sum+(Date.parse(p.end)-Date.parse(p.start))/86400000,0);assert.equal(days,86);
 assert.throws(()=>planBatch({...base,interval:'ENTIRE'}));assert.throws(()=>planBatch(base,{chunkMonths:3}));assert.throws(()=>planBatch(base,{chunkMonths:0}));
 const monthly=planBatch({...base,source:'gfw-fishing',datasetVersion:'v5.0',grouping:'GEARTYPE',interval:'MONTHLY'},{chunkMonths:12});assert.equal(monthly.parts.length,1);
});
test('completed batches persist independent chunks and a complete export manifest',async()=>setup(async({jobs,batches,dir})=>{
 const b=await batches.create(base);await complete(batches,b);assert.equal(b.status,'complete');assert.equal(b.parts.length,4);assert.ok(b.parts.every(p=>p.status==='complete'&&p.sha256));
 const values=await Promise.all(b.parts.map(p=>jobs.artifact(p.jobId)));assert.equal(values.flatMap(a=>a.rows).reduce((sum,r)=>sum+r.hours,0),860);
 const exported=await batches.exportEntries(b.id);assert.equal(exported.complete,true);const manifest=JSON.parse(exported.entries[0].data);assert.deepEqual(manifest.missingWindows,[]);
 const restarted=new BatchStore(dir,jobs);await restarted.load();assert.equal(restarted.get(b.id).status,'complete');
 const buffers=[];for await(const buffer of zipEntries(exported.entries))buffers.push(buffer);const zip=Buffer.concat(buffers);assert.ok(zip.length>values[0].files['data.csv'].length);
}));
test('failure preserves completed chunks; explicit resume retries only the unfinished window',async()=>{
 let calls=0;
 await setup(async({jobs,batches})=>{
  const b=await batches.create({...base,source:'gfw-fishing',datasetVersion:'v5.0',grouping:'GEARTYPE',start:'2024-01-01',end:'2024-04-01'});
  await complete(batches,b);assert.equal(b.status,'paused');assert.equal(b.parts[0].status,'complete');assert.equal(calls,2);
  await assert.rejects(batches.exportEntries(b.id),/incomplete/);const partial=await batches.exportEntries(b.id,{allowPartial:true});assert.equal(partial.complete,false);assert.equal(JSON.parse(partial.entries[0].data).missingWindows.length,2);
  const savedId=b.parts[0].jobId;await complete(batches,b);assert.equal(b.status,'complete');assert.equal(calls,4);assert.equal(b.parts[0].jobId,savedId);assert.equal(b.parts[1].attempts.length,1);
 },async url=>{calls++;if(calls===2)return new Response('',{status:429});const date=new URL(url).searchParams.get('date-range').split(',')[0].slice(0,10);return new Response(JSON.stringify({entries:[{'public-global-fishing-effort:v5.0':[{date,lat:49,lon:-2,geartype:'trawlers',hours:1}]}]}));});
});
test('corrupt completed chunks stop export and are never fetched again automatically',async()=>setup(async({jobs,batches,dir})=>{
 const b=await batches.create(base);await complete(batches,b);await writeFile(join(dir,`artifact-${b.parts[0].jobId}.json`),'corrupt');await assert.rejects(batches.exportEntries(b.id),/integrity/);
}));
test('restart with a reserved running child blocks duplicate upstream work',async()=>{
 let calls=0;
 await setup(async({jobs,batches,dir})=>{
  const b=await batches.create({...base,source:'gfw-fishing',datasetVersion:'v5.0',grouping:'GEARTYPE'});const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';b.parts[0].jobId=id;b.status='running';await batches.persist(b);
  await writeFile(join(dir,`job-${id}.json`),JSON.stringify({id,query:b.parts[0].query,status:'running',batchId:b.id}));
  const restoredJobs=new JobStore(dir,{fetchImpl:async()=>{calls++;throw Error('Should not fetch');},token:()=> 'token'});await restoredJobs.load();const restored=new BatchStore(dir,restoredJobs);await restored.load();const plan=restored.get(b.id);assert.equal(plan.status,'paused');await complete(restored,plan);assert.equal(plan.status,'paused');assert.equal(calls,0);assert.match(plan.error,/unresolved/);
 },async()=>{calls++;throw Error('Should not fetch');});
});
test('pause waits for a submitted chunk and resume skips that saved result',async()=>{
 let resolveFetch,calls=0;
 await setup(async({jobs,batches})=>{
  const b=await batches.create({...base,source:'gfw-fishing',datasetVersion:'v5.0',grouping:'GEARTYPE',start:'2024-01-01',end:'2024-03-01'});batches.start(b.id);
  for(let i=0;i<100&&!resolveFetch;i++)await new Promise(r=>setTimeout(r,2));
  await batches.pause(b.id);assert.equal(b.status,'pausing');resolveFetch();await batches.running.get(b.id);assert.equal(b.status,'paused');assert.equal(calls,1);assert.equal(b.parts[0].status,'complete');
  batches.start(b.id);for(let i=0;i<100&&calls<2;i++)await new Promise(r=>setTimeout(r,2));resolveFetch();await batches.running.get(b.id);assert.equal(b.status,'complete');assert.equal(calls,2);
 },async url=>{calls++;return new Promise(resolve=>{resolveFetch=()=>resolve(new Response(JSON.stringify({entries:[{'public-global-fishing-effort:v5.0':[{date:new URL(url).searchParams.get('date-range').slice(0,10),lat:49,lon:-2,hours:1}]}]})));});});
});
test('HTTP preview is non-executing; start and complete ZIP export work',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'fishing-batch-http-'));let app;
 try{
  app=await start({port:0,workspace});const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}});const headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
  const call=(path,body,method='POST')=>fetch(app.origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await call('/api/batches/preview',{query:base})).status,200);assert.equal((await(await call('/api/jobs',undefined,'GET')).json()).length,0);
  const b=await(await call('/api/batches',{query:base})).json();await call(`/api/batches/${b.id}/start`,{});
  let plans;for(let i=0;i<200;i++){plans=await(await call('/api/batches',undefined,'GET')).json();if(plans[0].status==='complete')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(plans[0].status,'complete');const response=await call(`/api/batches/${b.id}/export`,undefined,'GET');assert.equal(response.headers.get('content-type'),'application/zip');const data=Buffer.from(await response.arrayBuffer());assert.equal(data.readUInt32LE(0),0x04034b50);
  await writeFile('/tmp/fishing-explorer-verified-batch.zip',data);
 }finally{if(app)await app.close();await rm(workspace,{recursive:true,force:true});}
});

test('completed retrieval stays visibly running until its final persistence finishes',async()=>setup(async({batches})=>{
 const b=await batches.create(base),persist=batches.persist.bind(batches);let release,atFinal;const finalReached=new Promise(resolve=>{atFinal=resolve;});batches.persist=async value=>{if(value.status==='complete'){atFinal();await new Promise(resolve=>{release=resolve;});}return persist(value);};batches.start(b.id);try{await finalReached;assert.equal(batches.view(b).status,'running');await assert.rejects(batches.exportEntries(b.id),/wait for its current chunk/);}finally{release();await batches.running.get(b.id);}assert.equal(batches.view(b).status,'complete');assert.equal((await batches.exportEntries(b.id)).complete,true);
}));
