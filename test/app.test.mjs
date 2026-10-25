import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../server/index.mjs';
import {validate,makeArtifact,hash,verifyArtifact} from '../server/domain.mjs';
const input={source:'synthetic-activity',start:'2024-01-01',end:'2024-02-01',grid:0.01,interval:'DAILY',bounds:[-2,49,-1,50]};
test('reject unsupported sources, impossible dates and geometries before extraction',()=>{
 for(const change of [{source:'vms'},{start:'2024-02-30'},{end:'2024-01-01'},{end:'2025-01-01'},{bounds:[179,49,-179,50]},{bounds:[-2,49,NaN,50]},{grid:0.001}]) assert.throws(()=>validate({...input,...change}));
});
test('time aggregation conserves illustrative hours and hashes do not depend on study identity',()=>{
 const q=validate({...input,title:'First study'});assert.deepEqual(q,validate({...input,title:'Another study'}));
 const daily=makeArtifact(q,'one');const monthly=makeArtifact(validate({...input,interval:'MONTHLY'}),'two');
 assert.equal(daily.rows.length,124);assert.equal(monthly.rows.length,4);
 assert.equal(daily.rows.reduce((a,r)=>a+r.hours,0),310);assert.equal(monthly.rows.reduce((a,r)=>a+r.hours,0),310);
 for(const [file,content] of Object.entries(daily.files))assert.equal(hash(content),daily.manifest.files[file].sha256);
});
test('exclusive end and leap day are preserved',()=>{
 const a=makeArtifact(validate({...input,start:'2024-02-28',end:'2024-03-01'}),'leap');assert.equal(a.rows.length,8);assert.ok(a.rows.some(r=>r.date==='2024-02-29'));assert.ok(!a.rows.some(r=>r.date==='2024-03-01'));
});
test('local session protection, persisted artifact, restart recovery and workspace exclusion',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'fishing-explorer-test-'));let app;
 try{
 app=await start({port:0,workspace});
 await assert.rejects(start({port:0,workspace}),/already in use/);
 assert.equal((await fetch(app.origin+'/api/jobs')).status,401);
 const token=app.launchUrl.split('#')[1];
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':token}});assert.equal(session.status,200);
 const cookie=session.headers.get('set-cookie').split(';')[0];const headers={Cookie:cookie,'Content-Type':'application/json'};
 assert.equal((await fetch(app.origin+'/api/jobs',{headers:{...headers,Origin:'https://untrusted.example'}})).status,403);
 assert.equal((await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':token}})).status,403);
 assert.equal((await fetch(app.origin+'/api/extract',{method:'POST',headers,body:JSON.stringify({...input,source:'vms'})})).status,400);
 const response=await fetch(app.origin+'/api/extract',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(response.status,202);const job=await response.json();
 for(let i=0;i<100;i++){const jobs=await (await fetch(app.origin+'/api/jobs',{headers})).json();if(jobs[0].status==='complete')break;await new Promise(r=>setTimeout(r,10));}
 const artifact=await (await fetch(app.origin+`/api/artifacts/${job.id}/bundle`,{headers})).json();assert.equal(artifact.manifest.complete,true);assert.equal(artifact.rows.length,124);
 assert.equal(JSON.stringify(artifact).includes(token),false);
 assert.equal((await fetch(app.origin+'/server/index.mjs')).status,404);
 const bytes=await readFile(join(workspace,`artifact-${job.id}.json`),'utf8');
 await app.close();app=null;
 const interruptedId='11111111-1111-4111-8111-111111111111';await writeFile(join(workspace,`job-${interruptedId}.json`),JSON.stringify({id:interruptedId,status:'running',query:validate(input)}));
 app=await start({port:0,workspace});assert.equal(await readFile(join(workspace,`artifact-${job.id}.json`),'utf8'),bytes);
 const interrupted=JSON.parse(await readFile(join(workspace,`job-${interruptedId}.json`),'utf8'));assert.equal(interrupted.status,'incomplete');
 } finally {if(app)await app.close();await rm(workspace,{recursive:true,force:true});}
});

test('corrupted or inconsistent saved data cannot pass integrity validation',()=>{
 const a=makeArtifact(validate(input),'check');assert.equal(verifyArtifact(a),a);
 const corrupt=structuredClone(a);corrupt.files['data.csv']+='bad';assert.throws(()=>verifyArtifact(corrupt),/integrity/);
 const altered=structuredClone(a);altered.rows[0].hours=900;assert.throws(()=>verifyArtifact(altered),/disagree/);
});

test('live server flow keeps credentials in memory and imports verified bundles',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'fishing-explorer-live-test-'));let app;
 const token='private-test-token-never-persist';
 const dataset='public-global-fishing-effort:v5.0';
 try{
 app=await start({port:0,workspace,fetchImpl:async(url,options)=>{
  assert.equal(options.headers.Authorization,`Bearer ${token}`);
  return new Response(JSON.stringify({entries:[{[dataset]:[{date:'2024-01-04',lat:49,lon:-2,hours:7,geartype:'trawlers'}]}]}),{headers:{'x-datasets':dataset}});
 }});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}});
 const headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 const call=(path,body,method='POST')=>fetch(app.origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal((await call('/api/connection',{token})).status,200);
 const response=await call('/api/extract',{...input,source:'gfw-fishing',datasetVersion:'v5.0',grouping:'GEARTYPE'});
 assert.equal(response.status,202);const job=await response.json();
 let jobs;
 for(let i=0;i<100;i++){jobs=await(await call('/api/jobs',undefined,'GET')).json();if(jobs[0].status==='complete')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(jobs[0].status,'complete');
 const artifact=await(await call(`/api/artifacts/${job.id}`,undefined,'GET')).json();assert.equal(artifact.rows[0].hours,7);
 const disk=await readFile(join(workspace,`artifact-${job.id}.json`),'utf8');assert.ok(!disk.includes(token));
 assert.equal((await call('/api/import',artifact)).status,201);
 const broken=structuredClone(artifact);broken.rows[0].hours=900;
 assert.equal((await call('/api/import',broken)).status,400);
 await call('/api/connection',undefined,'DELETE');
 assert.equal((await(await call('/api/connection',undefined,'GET')).json()).connected,false);
 assert.equal((await call('/api/extract',{...input,source:'gfw-fishing',datasetVersion:'v5.0',grouping:'GEARTYPE'})).status,400);
 }finally{if(app)await app.close();await rm(workspace,{recursive:true,force:true});}
});
