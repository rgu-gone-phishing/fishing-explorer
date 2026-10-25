import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JobStore} from '../server/jobs.mjs';
import {validate,verifyArtifact} from '../server/domain.mjs';
import {checkLastReport,reportRequest} from '../server/gfw.mjs';
const query=validate({source:'gfw-fishing',datasetVersion:'v5.0',start:'2024-01-01',end:'2024-02-01',grid:0.1,interval:'DAILY',grouping:'GEARTYPE',bounds:[-2,49,-1,50]});
const dataset='public-global-fishing-effort:v5.0';
const raw=JSON.stringify({entries:[{[dataset]:[{date:'2024-01-04',lat:49,lon:-2,hours:3,geartype:'trawlers'}]}]});
async function fixture(fn,fetchImpl){const dir=await mkdtemp(join(tmpdir(),'fishing-recovery-'));const store=new JobStore(dir,{fetchImpl,token:()=> 'test-personal-token'});try{await store.load();await fn(store,dir);}finally{await store.close();await rm(dir,{recursive:true,force:true});}}
test('last-report statuses never establish ownership from URL alone',async()=>{
 const req=new URL(reportRequest(query).url);
 const running=await checkLastReport(query,'token',{fetchImpl:async()=>new Response(JSON.stringify({status:'running',uri:req.pathname+req.search}))});
 assert.equal(running.state,'running');assert.equal(running.parametersMatch,true);assert.match(running.message,/geometry is not verified/);
 const missing=await checkLastReport(query,'token',{fetchImpl:async()=>new Response('',{status:404})});assert.equal(missing.state,'unavailable');
 const failed=await checkLastReport(query,'token',{fetchImpl:async()=>new Response(JSON.stringify({status:422,message:{}}))});assert.equal(failed.state,'remote-error');
});
test('wrong dataset or out-of-scope data is rejected, while matching rows remain a candidate',async()=>{
 const candidate=await checkLastReport(query,'token',{fetchImpl:async()=>new Response(raw,{headers:{'x-datasets':dataset}})});
 assert.equal(candidate.state,'candidate');assert.equal(candidate.summary.rows,1);
 for(const content of [raw.replace('v5.0','v4.0'),raw.replace('"lon":-2','"lon":45'),raw.replace('2024-01-04','2023-01-04')]){
 const mismatch=await checkLastReport(query,'token',{fetchImpl:async()=>new Response(content)});assert.equal(mismatch.state,'mismatch');
 }
});
test('timeout blocks duplicate submission; review and explicit acceptance produce flagged provenance',async()=>{
 let calls=0;
 await fixture(async(store,dir)=>{
 const job=await store.submit(query);await store.queue;assert.equal(job.status,'recovery-needed');
 await assert.rejects(store.submit(query),/needs recovery/);assert.equal(calls,1);
 await store.action(job.id,'recover');assert.equal(job.recovery.state,'candidate');assert.equal(job.status,'recovery-needed');
 await assert.rejects(store.artifact(job.id),/Complete artifact/);
 const preview=await store.candidate(job.id);assert.equal(preview.sampleRows.length,1);
 await assert.rejects(store.action(job.id,'accept-recovery',{}),/confirm ownership/);
 await store.action(job.id,'accept-recovery',{confirmOwnership:true,candidateHash:preview.candidateHash});assert.equal(job.status,'complete');
 const a=await store.artifact(job.id);verifyArtifact(a);assert.match(a.manifest.provenance.request.recovery.association,/user-confirmed/);assert.match(a.files['caveats.txt'],/RECOVERY ASSOCIATION/);
 assert.equal(JSON.stringify(a).includes('test-personal-token'),false);
 const disk=JSON.parse(await readFile(join(dir,`job-${job.id}.json`),'utf8'));assert.equal(disk.status,'complete');
 },async(url)=>{calls++;return url.endsWith('/last-report')?new Response(raw,{headers:{'x-datasets':dataset}}):new Response('',{status:524});});
});
test('release is explicit, never creates a complete result, and retry retains the old job',async()=>{
 let calls=0;
 await fixture(async store=>{
 const job=await store.submit(query);await store.queue;
 await assert.rejects(store.action(job.id,'release'),/acknowledge/);
 await store.action(job.id,'release',{confirmRemoteReview:true});assert.equal(job.status,'abandoned');
 await assert.rejects(store.artifact(job.id));assert.equal(calls,1);
 const next=await store.action(job.id,'retry');await store.queue;assert.equal(next.parentId,job.id);assert.notEqual(next.id,job.id);assert.equal(calls,2);
 },async()=>{calls++;return new Response('',{status:524});});
});
test('concurrent submissions reserve one remote slot before persistence',async()=>{
 let calls=0;
 await fixture(async store=>{
 const results=await Promise.allSettled([store.submit(query),store.submit(query)]);await store.queue;
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1);
 },async()=>{calls++;return new Response(raw);});
});
test('queued pause/cancel never submit upstream; stop-waiting preserves uncertain remote status',async()=>{
 let calls=0;let unblock;
 await fixture(async store=>{
 store.queue=new Promise(resolve=>{unblock=resolve;});
 const job=await store.submit(query);await store.action(job.id,'pause');assert.equal(job.status,'paused');
 await store.action(job.id,'cancel');unblock();await store.queue;assert.equal(calls,0);
 const next=await store.submit(query);
 for(let i=0;i<50&&!calls;i++)await new Promise(r=>setTimeout(r,2));
 await store.action(next.id,'cancel');await store.queue;assert.equal(next.status,'recovery-needed');
 },async(url,options)=>{calls++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));});
});
test('restart distinguishes never-submitted queued work from uncertain live work',async()=>{
 await fixture(async(store,dir)=>{
 for(const [id,state] of [['44444444-4444-4444-8444-444444444444','queued'],['55555555-5555-4555-8555-555555555555','running']])await writeFile(join(dir,`job-${id}.json`),JSON.stringify({id,query,status:state}));
 const restored=new JobStore(dir);await restored.load();assert.equal(restored.get('44444444-4444-4444-8444-444444444444').status,'paused');assert.equal(restored.get('55555555-5555-4555-8555-555555555555').status,'recovery-needed');
 },async()=>new Response(raw));
});
