import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {JobStore} from '../server/jobs.mjs';
import {BatchStore} from '../server/batches.mjs';
import {analyzeBatch,analysisOptions} from '../server/batch-analysis.mjs';
import {start} from '../server/index.mjs';
const query={source:'synthetic-activity',start:'2023-12-15',end:'2024-03-10',grid:0.1,interval:'DAILY',bounds:[-2,49,-1,50]};
async function fixture(fn,fetchImpl){const workspace=await mkdtemp(join(tmpdir(),'batch-analysis-'));const jobs=new JobStore(workspace,{fetchImpl,token:()=> 'fixture-token'});await jobs.load();const batches=new BatchStore(workspace,jobs);await batches.load();try{await fn({workspace,jobs,batches});}finally{await batches.close();await jobs.close();await rm(workspace,{recursive:true,force:true});}}
const finish=async(batches,b)=>{batches.start(b.id);await batches.running.get(b.id);};
test('whole-batch analysis conserves totals and row lineage across page and chunk boundaries',async()=>fixture(async({batches})=>{
 const b=await batches.create(query);await finish(batches,b);const a=await batches.analyze(b.id);
 assert.equal(batches.view(b).analysisFingerprint,a.batchFingerprint);
 assert.equal(a.complete,true);assert.equal(a.returnedTotal,860);assert.equal(a.matchedRows,344);assert.equal(a.series.length,86);assert.equal(a.cells.length,4);assert.equal(a.cells.reduce((v,c)=>v+c.value,0),860);assert.equal(a.parents.length,4);
 assert.equal(a.rows.length,50);assert.equal(a.nextOffset,50);const page=await batches.analyze(b.id,{offset:50});assert.equal(page.returnedTotal,860);assert.equal(page.rows[0].chunkIndex,0);assert.ok(page.rows.some(r=>r.chunkIndex===1));
 const all=[];for(let offset=0;offset<a.matchedRows;offset+=50)all.push(...(await batches.analyze(b.id,{offset})).rows);
 assert.equal(all.length,344);assert.equal(new Set(all.map(r=>JSON.stringify(r))).size,344);assert.equal(all.reduce((v,r)=>v+r.hours,0),860);
 const selected=await batches.analyze(b.id,{start:'2024-01-01',end:'2024-02-01',group:'TRAWLERS'});assert.equal(selected.returnedTotal,186);assert.equal(selected.matchedRows,62);assert.equal(selected.cells.length,2);assert.equal(selected.parents.length,1);assert.equal(selected.series.length,31);
 assert.equal((await batches.analyze(b.id,{group:'nonexistent'})).returnedTotal,null);
}));
test('unretrieved windows, empty returned bins and explicit zero remain distinct',async()=>{
 let calls=0;
 await fixture(async({batches})=>{
  const b=await batches.create({...query,source:'gfw-fishing',datasetVersion:'v5.0',grouping:'GEARTYPE',start:'2024-01-01',end:'2024-03-01'});await finish(batches,b);
  const a=await batches.analyze(b.id);assert.equal(a.complete,false);assert.equal(a.selectionComplete,false);assert.equal(a.returnedTotal,0);assert.equal(a.matchedRows,1);
  assert.deepEqual(a.series.slice(0,2).map(v=>[v.value,v.status]),[[0,'returned'],[null,'no-returned-rows']]);assert.equal(a.series.at(-1).status,'not-retrieved');assert.equal(a.series.at(-1).value,null);assert.equal(a.missingWindows.length,1);
  const january=await batches.analyze(b.id,{end:'2024-02-01'});assert.equal(january.complete,false);assert.equal(january.selectionComplete,true);
 },async()=>++calls===1?new Response(JSON.stringify({entries:[{'public-global-fishing-effort:v5.0':[{date:'2024-01-01',lat:49,lon:-2,hours:0,geartype:'trawlers'}]}]})):new Response('',{status:429}));
});
test('monthly filters respect saved boundaries and partial endpoint bins',async()=>fixture(async({batches})=>{
 const b=await batches.create({...query,interval:'MONTHLY'});await finish(batches,b);const a=await batches.analyze(b.id);assert.deepEqual(a.series.map(r=>r.value),[170,310,290,90]);assert.equal(a.series[0].start,'2023-12-15');assert.equal(a.series.at(-1).end,'2024-03-10');
 assert.equal((await batches.analyze(b.id,{start:'2024-01-01',end:'2024-03-01'})).returnedTotal,600);
 await assert.rejects(batches.analyze(b.id,{start:'2024-01-15'}),/bin boundaries/);
 assert.throws(()=>analysisOptions(b.query,{start:'2024-02-30'}));assert.throws(()=>analysisOptions(b.query,{offset:-1}));assert.throws(()=>analysisOptions(b.query,{end:'2025-01-01'}));
}));
test('display caps omit the entire oversized map without truncating totals or table',async()=>fixture(async({workspace,batches})=>{
 const b=await batches.create(query);await finish(batches,b);const a=await analyzeBatch(b,workspace,{}, {maxCells:2,maxGroups:1});assert.equal(a.mapOmitted,true);assert.deepEqual(a.cells,[]);assert.equal(a.returnedTotal,860);assert.equal(a.matchedRows,344);assert.equal(a.rows.length,50);assert.equal(a.groupsTruncated,true);assert.equal(a.groups.length,1);
}));
test('corrupt or incorrectly associated chunks prevent a batch result',async()=>fixture(async({workspace,batches})=>{
 const b=await batches.create(query);await finish(batches,b);const first=b.parts[0],end=first.end;first.end='2024-02-01';await assert.rejects(batches.analyze(b.id),/partition/);first.end=end;await writeFile(join(workspace,`artifact-${first.jobId}.json`),'corrupt');await assert.rejects(batches.analyze(b.id),/changed|integrity/);
}));
test('concurrent analysis and batch changes cannot produce a misleading stable snapshot',async()=>fixture(async({batches})=>{
 const b=await batches.create(query);await finish(batches,b);const pending=batches.analyze(b.id);await assert.rejects(batches.analyze(b.id),/Another saved batch/);b.error='Changed while reading';await assert.rejects(pending,/changed during analysis/);assert.equal((await batches.analyze(b.id)).returnedTotal,860);
}));
test('SAR whole-batch analysis retains detection units and never creates fishing hours',async()=>{
 await fixture(async({batches})=>{const b=await batches.create({...query,source:'gfw-sar',datasetVersion:'v5.0',grouping:'NONE',start:'2024-01-01',end:'2024-03-01'});await finish(batches,b);const a=await batches.analyze(b.id);assert.equal(a.units,'SAR vessel detections');assert.equal(a.returnedTotal,4);assert.ok(a.rows.every(r=>r.detections===2&&!Object.hasOwn(r,'hours')));},async url=>new Response(JSON.stringify({entries:[{'public-global-sar-presence:v5.0':[{date:new URL(url).searchParams.get('date-range').slice(0,10),lat:49,lon:-2,detections:2}]}]})));
});
test('HTTP analysis remains local and session-protected with no upstream calls',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'batch-analysis-http-'));let app;
 try{
  const jobs=new JobStore(workspace);await jobs.load();const batches=new BatchStore(workspace,jobs);await batches.load();const b=await batches.create(query);await finish(batches,b);await batches.close();await jobs.close();
  app=await start({workspace,port:0,fetchImpl:async()=>{throw Error('Analysis must remain offline');}});
  assert.equal((await fetch(`${app.origin}/api/batches/${b.id}/analysis`)).status,401);
  const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}}),headers={Cookie:session.headers.get('set-cookie').split(';')[0]};
  const response=await fetch(`${app.origin}/api/batches/${b.id}/analysis?group=TRAWLERS`,{headers});assert.equal(response.status,200);assert.equal((await response.json()).returnedTotal,516);
 }finally{if(app)await app.close();await rm(workspace,{recursive:true,force:true});}
});
