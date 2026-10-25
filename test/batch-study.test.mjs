import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {JobStore} from '../server/jobs.mjs';
import {BatchStore} from '../server/batches.mjs';
import {BatchImporter} from '../server/batch-import.mjs';
import {WorkspaceStore} from '../server/workspaces.mjs';
import {batchViewShape} from '../server/batch-analysis.mjs';
import {hash} from '../server/domain.mjs';
import {zipEntries} from '../server/zip.mjs';
import {start} from '../server/index.mjs';
const query={source:'synthetic-activity',start:'2024-01-01',end:'2024-04-01',grid:.1,interval:'DAILY',bounds:[-2,49,-1,50]};
const options={start:'2024-01-10',end:'2024-02-01',group:'TRAWLERS'};
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'batch-study-')),jobs=new JobStore(dir);await jobs.load();const batches=new BatchStore(dir,jobs);await batches.load();const studies=new WorkspaceStore(dir,jobs,{list:()=>[]},batches),importer=new BatchImporter(dir,batches,jobs);try{await fn({dir,jobs,batches,studies,importer});}finally{await batches.close();await jobs.close();await rm(dir,{recursive:true,force:true});}}
async function create(context,{partial=false,interval='DAILY'}={}){const {jobs,batches}=context,b=await batches.create({...query,interval}),submit=jobs.submit.bind(jobs);if(partial)jobs.submit=async(...args)=>{const result=await submit(...args);await batches.pause(b.id);return result;};try{batches.start(b.id);await batches.running.get(b.id);}finally{jobs.submit=submit;}return b;}
async function body(context,b,scope=options){const analyzed=await context.batches.analyze(b.id,scope);return {title:'Saved historical view',query:{...query,start:'2024-03-01',end:'2024-03-02',grid:.01},references:[{kind:'batch',id:b.id,label:analyzed.complete?'Historical data':'PARTIAL historical data'}],presentation:{activeView:'downloads',batchId:b.id,batchView:{schemaVersion:1,options:scope,batchFingerprint:analyzed.batchFingerprint,viewport:{center:[49.6,-1.4],zoom:8},draftPending:false}}};}
async function archive(context,b){const exported=await context.batches.exportEntries(b.id,{allowPartial:true}),entries=[];for(const e of exported.entries){const data=[];for await(const bytes of e.open?e.open():e.data?[e.data]:[await readFile(e.path)])data.push(bytes);entries.push({name:e.name,data:Buffer.concat(data)});}const chunks=[];for await(const bytes of zipEntries(entries))chunks.push(bytes);return Buffer.concat(chunks);}
test('historical study scope is independent of the builder and retains immutable view revisions',async()=>fixture(async c=>{
 const b=await create(c),input=await body(c,b),before=hash(b),chunk=await readFile(c.jobs.artifactPath(b.parts[0].jobId)),saved=await c.studies.saveStudy(input),v=saved.revision.presentation.batchView;
 assert.deepEqual(v.options,options);assert.deepEqual(v.viewport,{center:[49.6,-1.4],zoom:8});assert.equal(v.sourceSha256,hash(b));assert.equal(v.batchFingerprint,undefined);assert.equal(saved.revision.query.grid,.01);assert.equal(saved.revision.query.start,'2024-03-01');
 const updated=await c.studies.saveStudy({...await body(c,b,{...options,group:'LONGLINERS'}),id:saved.studyId,baseRevisionId:saved.revision.id});assert.equal(updated.revision.queryHash,saved.revision.queryHash);assert.equal(updated.revision.queryRevisionId,saved.revision.queryRevisionId);assert.deepEqual((await c.studies.openStudy(saved.studyId,saved.revision.id)).revision.presentation.batchView,v);
 assert.equal(hash(b),before);assert.deepEqual(await readFile(c.jobs.artifactPath(b.parts[0].jobId)),chunk);
}));
test('dirty, stale, unlinked and invalid batch views cannot be saved as applied results',async()=>fixture(async c=>{
 const b=await create(c),input=await body(c,b);const change=patch=>({...input,presentation:{...input.presentation,batchView:{...input.presentation.batchView,...patch}}});
 await assert.rejects(c.studies.saveStudy(change({draftPending:true})),/Apply the current batch filters/);
 await assert.rejects(c.studies.saveStudy({...input,references:[]}),/Link the selected batch/);
 await assert.rejects(c.studies.saveStudy(change({batchFingerprint:'0'.repeat(64)})),/changed since/);
 await assert.rejects(c.studies.saveStudy(change({options:{...options,start:'2023-01-01'}})),/inside the saved batch/);
 await assert.rejects(c.studies.saveStudy(change({options:{...options,offset:50}})),/display scope/);
 await assert.rejects(c.studies.saveStudy(change({viewport:{center:[0,0],zoom:22}})),/viewport/);
 const monthly=await create(c,{interval:'MONTHLY'}),monthlyInput=await body(c,monthly,{start:'2024-02-01',end:'2024-03-01',group:''});monthlyInput.presentation.batchView.options.start='2024-02-02';await assert.rejects(c.studies.saveStudy(monthlyInput),/bin boundaries/);
 for(const scope of [{...options,start:'2024-02-30'},{...options,group:'x\n'},{...options,end:options.start},{...options,group:[]},null])assert.throws(()=>batchViewShape(scope),/display scope/);
}));
test('partial sources are explicitly labelled and retain missing windows across study reopen',async()=>fixture(async c=>{
 const empty=await c.batches.create(query);assert.ok(!(await c.studies.library()).some(r=>r.id===empty.id));await assert.rejects(c.batches.resource(empty.id),/at least one completed chunk/);
 const b=await create(c,{partial:true}),library=(await c.studies.library()).find(r=>r.id===b.id);assert.match(library.label,/PARTIAL · 1\/3 chunks/);
 const input=await body(c,b),saved=await c.studies.saveStudy(input);assert.equal(saved.availability[0].status,'available');const a=await c.batches.analyze(b.id,{...options,sourceSha256:saved.revision.presentation.batchView.sourceSha256});assert.equal(a.complete,false);assert.equal(a.selectionComplete,true);assert.equal(a.returnedTotal,132);assert.equal(a.missingWindows.length,2);
 const reopened=await c.studies.lastStudy();assert.deepEqual(reopened.revision.presentation.batchView.options,options);assert.equal(reopened.availability[0].status,'available');
 c.batches.start(b.id);await c.batches.running.get(b.id);assert.equal((await c.studies.openStudy(saved.studyId)).availability[0].status,'changed');await assert.rejects(c.batches.analyze(b.id,{...options,sourceSha256:saved.revision.presentation.batchView.sourceSha256}),/no longer matches/);
}));
test('portable complete and partial study views rebind only to original archive content',async()=>fixture(async source=>{
 for(const partial of [false,true]){const b=await create(source,{partial}),saved=await source.studies.saveStudy(await body(source,b)),plan=await source.studies.exportStudy(saved.studyId),zip=await archive(source,b);
  await fixture(async target=>{const missing=await target.studies.importStudy(plan);assert.equal(missing.availability[0].status,'missing');assert.deepEqual(missing.revision.presentation.batchView.options,options);
   const imported=(await target.importer.receive(Readable.from([zip]))).batch,restored=await target.studies.openStudy(missing.studyId);assert.equal(restored.availability[0].status,'available');assert.equal(restored.availability[0].resolvedId,imported.id);assert.notEqual(imported.id,b.id);
   const a=await target.batches.analyze(imported.id,{...options,sourceSha256:restored.revision.presentation.batchView.sourceSha256});assert.equal(a.returnedTotal,132);assert.equal(a.complete,!partial);assert.equal(a.selectionComplete,true);
   const broken=structuredClone(plan);broken.plan.revision.presentation.batchView.sourceSha256='0'.repeat(64);broken.sha256=hash(broken.plan);await assert.rejects(target.studies.importStudy(broken),/source reference/);
  });
 }
}));
test('a retained partial archive can restore an old study after its native batch advances',async()=>fixture(async c=>{
 const b=await create(c,{partial:true}),saved=await c.studies.saveStudy(await body(c,b)),zip=await archive(c,b);c.batches.start(b.id);await c.batches.running.get(b.id);const imported=(await c.importer.receive(Readable.from([zip]))).batch,opened=await c.studies.openStudy(saved.studyId);
 assert.equal(opened.availability[0].status,'available');assert.equal(opened.availability[0].resolvedId,imported.id);assert.notEqual(imported.id,b.id);assert.equal((await c.batches.analyze(imported.id,{...options,sourceSha256:opened.revision.presentation.batchView.sourceSha256})).complete,false);
}));
test('running, concurrently changed or corrupt chunks never satisfy a saved batch reference',async()=>fixture(async c=>{
 const b=await create(c,{partial:true}),input=await body(c,b),original=c.batches.verifyChunks.bind(c.batches);c.batches.running.set(b.id,Promise.resolve());await assert.rejects(c.studies.saveStudy(input),/Pause the batch/);assert.ok(!(await c.studies.library()).some(r=>r.id===b.id));c.batches.running.delete(b.id);
 c.batches.verifyChunks=async snapshot=>{await original(snapshot);b.error='Changed during study verification';};await assert.rejects(c.batches.resource(b.id),/changed while verifying/);c.batches.verifyChunks=original;
 const saved=await c.studies.saveStudy(await body(c,b));await writeFile(c.jobs.artifactPath(b.parts[0].jobId),'corrupt');assert.notEqual((await c.studies.openStudy(saved.studyId)).availability[0].status,'available');await assert.rejects(c.batches.analyze(b.id,{...options,sourceSha256:saved.revision.presentation.batchView.sourceSha256}),/integrity/);
}));
test('HTTP study restoration checks original batch identity offline after restart',async()=>fixture(async c=>{
 const b=await create(c,{partial:true}),saved=await c.studies.saveStudy(await body(c,b));let app;
 try{await c.batches.close();await c.jobs.close();app=await start({port:0,workspace:c.dir,fetchImpl:async()=>{throw Error('No upstream request is permitted');}});assert.equal((await fetch(app.origin+`/api/batches/${b.id}/analysis?sourceSha256=${hash(b)}`)).status,401);const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}}),headers={Cookie:session.headers.get('set-cookie').split(';')[0]};const opened=await(await fetch(app.origin+'/api/studies/last',{headers})).json();assert.equal(opened.studyId,saved.studyId);assert.equal(opened.availability[0].status,'available');
 const response=await fetch(app.origin+`/api/batches/${b.id}/analysis?`+new URLSearchParams({...options,sourceSha256:opened.revision.presentation.batchView.sourceSha256}),{headers});assert.equal(response.status,200);const a=await response.json();assert.equal(a.returnedTotal,132);assert.equal(a.complete,false);
 const rejected=await fetch(app.origin+`/api/batches/${b.id}/analysis?sourceSha256=${'0'.repeat(64)}`,{headers});assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/no longer matches/);
 }finally{if(app)await app.close();}
}));
