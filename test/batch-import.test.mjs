import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {deflateRawSync} from 'node:zlib';
import {BATCH_DOCUMENTATION_FILES} from '../server/handoff-docs.mjs';
import {JobStore} from '../server/jobs.mjs';
import {BatchStore} from '../server/batches.mjs';
import {BatchImporter} from '../server/batch-import.mjs';
import {ZipReader} from '../server/zip-reader.mjs';
import {zipEntries,crc32} from '../server/zip.mjs';
import {WorkspaceStore} from '../server/workspaces.mjs';
import {hash,archive,reportRowBin,validate,verifyArtifact} from '../server/domain.mjs';
import {createHash} from 'node:crypto';
import {start} from '../server/index.mjs';
const query={source:'synthetic-activity',start:'2024-01-01',end:'2024-04-01',grid:0.1,interval:'DAILY',bounds:[-2,49,-1,50]};
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'batch-zip-test-')),jobs=new JobStore(dir);await jobs.load();const batches=new BatchStore(dir,jobs);await batches.load();const importer=new BatchImporter(dir,batches,jobs);try{await fn({dir,jobs,batches,importer});}finally{await batches.close();await jobs.close();await rm(dir,{recursive:true,force:true});}}
async function createBatch(context,partial=false){const {jobs,batches}=context,b=await batches.create(query),submit=jobs.submit.bind(jobs);if(partial)jobs.submit=async(...args)=>{const job=await submit(...args);await batches.pause(b.id);return job;};batches.start(b.id);await batches.running.get(b.id);jobs.submit=submit;return b;}
async function materialize(entries){const output=[];for(const entry of entries){const chunks=[];for await(const bytes of entry.open?entry.open():entry.data?[entry.data]:[await readFile(entry.path)])chunks.push(bytes);output.push({name:entry.name,data:Buffer.concat(chunks)});}return output;}
async function zip(entries){const chunks=[];for await(const b of zipEntries(entries))chunks.push(b);return Buffer.concat(chunks);}
async function exported(context,batch){return materialize((await context.batches.exportEntries(batch.id,{allowPartial:true})).entries);}
// Independent test encoder: ZIP32 local sizes with no descriptors, optionally Deflate.
function otherZip(entries,method=8){const parts=[],central=[];let offset=0;for(const e of entries){const name=Buffer.from(e.name),data=method===8?deflateRawSync(e.data):e.data,crc=crc32(e.data),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(e.data.length,22);local.writeUInt16LE(name.length,26);parts.push(local,name,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(e.data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=30+name.length+data.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);}
test('complete stored and deflated archives restore all chunks and preserve the original ZIP bytes',async()=>fixture(async source=>{
 const b=await createBatch(source),entries=await exported(source,b);
 for(const bytes of [await zip(entries),otherZip(entries)])await fixture(async destination=>{
  const imported=await destination.importer.receive(Readable.from([bytes]));assert.equal(imported.batch.status,'complete');assert.equal(destination.jobs.jobs.length,3);assert.notEqual(imported.batch.id,b.id);assert.equal((await destination.batches.analyze(imported.batch.id)).returnedTotal,910);
  const output=await destination.batches.exportEntries(imported.batch.id);assert.deepEqual(await readFile(output.originalArchive.path),bytes);assert.equal(hash(await destination.batches.resource(imported.batch.id)),hash(b));
  const repeated=await destination.importer.receive(Readable.from([bytes]));assert.equal(repeated.reused,true);assert.equal(repeated.batch.id,imported.batch.id);assert.equal(destination.jobs.jobs.length,3);
  const jobs=new JobStore(destination.dir);await jobs.load();const batches=new BatchStore(destination.dir,jobs);await batches.load();assert.equal(jobs.jobs.length,3);assert.equal((await batches.analyze(imported.batch.id)).matchedRows,364);assert.deepEqual(await jobs.artifact(imported.batch.parts[0].jobId),await source.jobs.artifact(b.parts[0].jobId));
 });
}));
test('partial archives remain immutable and explicit continuation reuses completed chunks only',async()=>fixture(async source=>{
 const b=await createBatch(source,true),bytes=await zip(await exported(source,b));await fixture(async destination=>{
  const imported=(await destination.importer.receive(Readable.from([bytes]))).batch;assert.equal(imported.status,'paused');assert.equal(imported.parts.filter(p=>p.status==='complete').length,1);assert.throws(()=>destination.batches.start(imported.id),/immutable/);await assert.rejects(destination.batches.pause(imported.id),/immutable/);
  const partial=await destination.batches.analyze(imported.id);assert.equal(partial.complete,false);assert.equal(partial.missingWindows.length,2);assert.equal(partial.returnedTotal,310);
  const copy=await destination.batches.copyRemaining(imported.id);assert.equal(copy.parts[0].jobId,imported.parts[0].jobId);assert.equal(copy.status,'planned');assert.equal(destination.jobs.jobs.length,1);destination.batches.start(copy.id);await destination.batches.running.get(copy.id);assert.equal(copy.status,'complete');assert.equal(destination.jobs.jobs.length,3);assert.equal((await destination.batches.analyze(copy.id)).returnedTotal,910);assert.equal(destination.batches.get(imported.id).status,'paused');assert.deepEqual(await readFile((await destination.batches.exportEntries(imported.id,{allowPartial:true})).originalArchive.path),bytes);
  const restartedJobs=new JobStore(destination.dir);await restartedJobs.load();const restarted=new BatchStore(destination.dir,restartedJobs);await restarted.load();assert.equal((await restarted.analyze(copy.id)).returnedTotal,910);assert.equal(restarted.get(imported.id).status,'paused');
 });
}));
test('legacy version-1 manifests infer exact partition windows without inventing original batch metadata',async()=>fixture(async source=>{
 const b=await createBatch(source),entries=(await exported(source,b)).filter(e=>!BATCH_DOCUMENTATION_FILES.includes(e.name)),manifest=JSON.parse(entries[0].data);manifest.schemaVersion=1;delete manifest.chunkMonths;delete manifest.sourceBatch;delete manifest.documentation;entries[0].data=Buffer.from(JSON.stringify(manifest));
 await fixture(async destination=>{const imported=(await destination.importer.receive(Readable.from([await zip(entries)]))).batch;assert.equal(imported.importedArchive.inferredChunkMonths,true);assert.equal((await destination.batches.resource(imported.id)).type,'legacy-batch-archive');assert.equal((await destination.batches.analyze(imported.id)).returnedTotal,910);});
}));
test('different ZIP containers with identical logical batch data remain separately preserved',async()=>fixture(async source=>{
 const b=await createBatch(source),entries=await exported(source,b),stored=await zip(entries),deflated=otherZip(entries);
 await fixture(async destination=>{const first=await destination.importer.receive(Readable.from([stored])),second=await destination.importer.receive(Readable.from([deflated]));assert.notEqual(first.batch.id,second.batch.id);assert.equal(second.reused,false);assert.deepEqual(await readFile((await destination.batches.originalZip(destination.batches.get(first.batch.id))).path),stored);assert.deepEqual(await readFile((await destination.batches.originalZip(destination.batches.get(second.batch.id))).path),deflated);});
}));
test('the original ZIP remains recoverable if a derived chunk is damaged, and reimport creates a separate valid copy',async()=>fixture(async source=>{
 const b=await createBatch(source),bytes=await zip(await exported(source,b));await fixture(async destination=>{const first=(await destination.importer.receive(Readable.from([bytes]))).batch;await writeFile(destination.jobs.artifactPath(first.parts[0].jobId),'damaged');await assert.rejects(destination.batches.analyze(first.id),/changed|integrity/);const archive=await destination.batches.exportEntries(first.id);assert.deepEqual(await readFile(archive.originalArchive.path),bytes);const recovered=await destination.importer.receive(Readable.from([bytes]));assert.notEqual(recovered.batch.id,first.id);assert.equal(recovered.reused,false);assert.equal((await destination.batches.analyze(recovered.batch.id)).returnedTotal,910);});
}));
test('invalid late CSV or contradictory manifest commits no jobs or batches and keeps existing data',async()=>fixture(async source=>{
 const b=await createBatch(source),entries=await exported(source,b);
 await fixture(async destination=>{const baseline=await destination.jobs.submit({...query,end:'2024-01-03'});await destination.jobs.queue;const original=await destination.jobs.artifact(baseline.id);
  const altered=entries.map(e=>({...e,data:Buffer.from(e.data)}));altered.at(-1).data=Buffer.from('tampered CSV');await assert.rejects(destination.importer.receive(Readable.from([await zip(altered)])),/CSV/);
  const bad=entries.map(e=>({...e})),manifest=JSON.parse(bad[0].data);manifest.complete=false;bad[0].data=Buffer.from(JSON.stringify(manifest));await assert.rejects(destination.importer.receive(Readable.from([await zip(bad)])),/completeness/);
  assert.equal(destination.jobs.jobs.length,1);assert.equal(destination.batches.batches.length,0);assert.deepEqual(await destination.jobs.artifact(baseline.id),original);assert.deepEqual(await readdir(join(destination.dir,'imported-batches')),[]);
 });
}));
test('unsafe names, duplicate entries, corruption and truncation are rejected before extraction',async()=>fixture(async source=>{
 const b=await createBatch(source),entries=await exported(source,b);
 await fixture(async destination=>{
  const unsafe=[...entries,{name:'../outside.txt',data:Buffer.from('must not escape')}];await assert.rejects(destination.importer.receive(Readable.from([otherZip(unsafe,0)])),/unsafe/);
  await assert.rejects(destination.importer.receive(Readable.from([otherZip([...entries,entries[0]],0)])),/duplicate/);
  const bytes=await zip(entries);await assert.rejects(destination.importer.receive(Readable.from([bytes.subarray(0,bytes.length-10)])),/directory/);
  const corrupt=Buffer.from(bytes);corrupt[50]^=1;await assert.rejects(destination.importer.receive(Readable.from([corrupt])));assert.equal(destination.jobs.jobs.length,0);assert.equal(destination.batches.batches.length,0);
 });
}));
test('aborted uploads and uncommitted staging directories do not become visible after restart',async()=>fixture(async({dir,importer})=>{
 async function* interrupted(){yield Buffer.from('partial ZIP');throw Error('Upload interrupted');}await assert.rejects(importer.receive(Readable.from(interrupted())),/interrupted/);assert.equal(importer.busy,false);
 const stage=join(dir,'imported-batches','.stage-crash-fixture');await mkdir(stage);await writeFile(join(stage,'job-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'),'{}');const jobs=new JobStore(dir);await jobs.load();const batches=new BatchStore(dir,jobs);await batches.load();assert.equal(jobs.jobs.length,0);assert.equal(batches.batches.length,0);
}));
test('rehashed files cannot conceal rows outside their recorded chunk window',async()=>fixture(async source=>{
 const b=await createBatch(source),entries=await exported(source,b),manifest=JSON.parse(entries[0].data),target=entries.find(e=>e.name==='chunks/0003.bundle.json'),old=JSON.parse(target.data),rows=structuredClone(old.rows);rows[0].date='2023-01-01';const changed=archive(old.query,old.manifest.id,rows,{createdAt:old.manifest.createdAt});target.data=Buffer.from(JSON.stringify(changed));entries.find(e=>e.name==='data/0003.csv').data=Buffer.from(changed.files['data.csv']);const update={bytes:target.data.length,sha256:createHash('sha256').update(target.data).digest('hex'),csvBytes:changed.manifest.files['data.csv'].bytes,csvSha256:changed.manifest.files['data.csv'].sha256};Object.assign(manifest.parts[2],update);Object.assign(manifest.sourceBatch.parts[2],update);entries[0].data=Buffer.from(JSON.stringify(manifest));
 await fixture(async destination=>{await assert.rejects(destination.importer.receive(Readable.from([await zip(entries)])),/daily window/);assert.equal(destination.jobs.jobs.length,0);assert.equal(destination.batches.batches.length,0);});
}));
test('monthly date labels with explicit days retain original text while mapping to the correct bin',()=>{
 const q=validate({...query,start:'2024-01-15',end:'2024-02-03',interval:'MONTHLY'}),rows=[{date:'2024-01-01',lat:49,lon:-2,hours:1},{date:'2024-02-01T00:00:00.000Z',lat:49,lon:-2,hours:2}],data=archive(q,'fixture',rows);verifyArtifact(data);assert.equal(reportRowBin(rows[0],q),'2024-01');assert.equal(reportRowBin(rows[1],q),'2024-02');assert.equal(data.rows[0].date,'2024-01-01');
});
test('attempted missing live chunks require explicit upstream review before new submissions',async()=>fixture(async source=>{
 let sourceCalls=0;source.jobs.token=()=> 'fixture-token';source.jobs.fetchImpl=async url=>++sourceCalls===1?new Response(JSON.stringify({entries:[{'public-global-fishing-effort:v5.0':[{date:new URL(url).searchParams.get('date-range').slice(0,10),lat:49,lon:-2,hours:1}]}]})):new Response('',{status:524});
 const b=await source.batches.create({...query,source:'gfw-fishing',datasetVersion:'v5.0',grouping:'GEARTYPE'});source.batches.start(b.id);await source.batches.running.get(b.id);const bytes=await zip(await exported(source,b));
 await fixture(async destination=>{let calls=0;destination.jobs.token=()=> 'fixture-token';destination.jobs.fetchImpl=async url=>{calls++;return new Response(JSON.stringify({entries:[{'public-global-fishing-effort:v5.0':[{date:new URL(url).searchParams.get('date-range').slice(0,10),lat:49,lon:-2,hours:1}]}]}));};const imported=(await destination.importer.receive(Readable.from([bytes]))).batch,copy=await destination.batches.copyRemaining(imported.id);assert.equal(copy.continuedFrom.requiresSourceReview,true);assert.throws(()=>destination.batches.start(copy.id),/Review upstream/);assert.equal(calls,0);destination.batches.start(copy.id,{confirmSourceReview:true});await destination.batches.running.get(copy.id);assert.equal(copy.status,'complete');assert.equal(calls,2);assert.ok(copy.continuedFrom.reviewedAt);});
}));
test('documented archive imports rebind a portable study to exact original batch content',async()=>fixture(async source=>{
 const b=await createBatch(source),studies=new WorkspaceStore(source.dir,source.jobs,{list:()=>[]},source.batches),saved=await studies.saveStudy({title:'Batch study',query:{...query,end:'2024-02-01'},references:[{kind:'batch',id:b.id,label:'Historical data'}],presentation:{}}),plan=await studies.exportStudy(saved.studyId),bytes=await zip(await exported(source,b));
 await fixture(async destination=>{const imported=(await destination.importer.receive(Readable.from([bytes]))).batch,restored=new WorkspaceStore(destination.dir,destination.jobs,{list:()=>[]},destination.batches),study=await restored.importStudy(plan);assert.equal(study.availability[0].status,'available');assert.equal(study.availability[0].resolvedId,imported.id);assert.equal(study.revision.references[0].sha256,hash(b));});
}));
test('HTTP binary import is session-protected and returns the original ZIP without upstream access',async()=>fixture(async source=>{
 const b=await createBatch(source),bytes=await zip(await exported(source,b)),dir=await mkdtemp(join(tmpdir(),'batch-import-http-'));let app,calls=0;
 try{app=await start({workspace:dir,port:0,fetchImpl:async()=>{calls++;throw Error('No upstream import requests');}});assert.equal((await fetch(app.origin+'/api/batches/import-zip',{method:'POST',body:bytes})).status,401);const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}}),headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/zip'};
  const response=await fetch(app.origin+'/api/batches/import-zip',{method:'POST',headers,body:bytes});assert.equal(response.status,201);const result=await response.json();assert.equal(result.batch.status,'complete');const exported=await fetch(`${app.origin}/api/batches/${result.batch.id}/export`,{headers});assert.deepEqual(Buffer.from(await exported.arrayBuffer()),bytes);assert.equal(calls,0);
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
}));

test('version-3 handoff documents retain partial status and reject rehashed contradictory documentation',async()=>fixture(async source=>{
 const b=await createBatch(source,true),entries=await exported(source,b),manifest=JSON.parse(entries[0].data),summary=entries.find(e=>e.name==='query-summary.txt').data.toString();assert.equal(manifest.schemaVersion,3);assert.match(summary,/Status: PARTIAL/);assert.match(summary,/Partition inventory/);assert.match(summary,/not supplied/);assert.equal(JSON.parse(entries.find(e=>e.name==='query.json').data).end,b.query.end);assert.equal(manifest.documentation.version,1);
 for(const name of ['query-summary.txt','data-dictionary.json','boundary.geojson'])await fixture(async destination=>{const changed=entries.map(e=>({...e,data:Buffer.from(e.data)})),entry=changed.find(e=>e.name===name);entry.data=Buffer.from('Contradictory handoff document');const m=JSON.parse(changed[0].data);m.documentation.files[name]={bytes:entry.data.length,sha256:hash(entry.data.toString())};changed[0].data=Buffer.from(JSON.stringify(m));await assert.rejects(destination.importer.receive(Readable.from([await zip(changed)])),/handoff document/);assert.equal(destination.jobs.jobs.length,0);assert.equal(destination.batches.batches.length,0);});
 const unsupported=entries.map(e=>({...e,data:Buffer.from(e.data)})),m=JSON.parse(unsupported[0].data);m.documentation.version=999;unsupported[0].data=Buffer.from(JSON.stringify(m));await fixture(async destination=>{await assert.rejects(destination.importer.receive(Readable.from([await zip(unsupported)])),/Unsupported/);assert.equal(destination.jobs.jobs.length,0);});
}));
test('legacy version-2 archives remain importable and re-export byte-for-byte without added documentation',async()=>fixture(async source=>{
 const b=await createBatch(source),entries=(await exported(source,b)).filter(e=>!BATCH_DOCUMENTATION_FILES.includes(e.name)),m=JSON.parse(entries[0].data);m.schemaVersion=2;delete m.documentation;entries[0].data=Buffer.from(JSON.stringify(m));const bytes=await zip(entries);
 await fixture(async destination=>{const imported=await destination.importer.receive(Readable.from([bytes])),batch=destination.batches.get(imported.batch.id);assert.equal((await destination.batches.resource(batch.id)).id,b.id);assert.deepEqual(await readFile((await destination.batches.originalZip(batch)).path),bytes);assert.deepEqual(await readFile((await destination.batches.exportEntries(batch.id)).originalArchive.path),bytes);});
}));
