import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {JobStore} from '../server/jobs.mjs';
import {BatchStore} from '../server/batches.mjs';
import {analyzeBatch} from '../server/batch-analysis.mjs';
import {prepareBatchReport,batchReportHtml,batchReportOptions,assertBatchReportCurrent,batchReportModel} from '../server/batch-reports.mjs';
import {reportSvg} from '../server/reports.mjs';
import {archive,hash} from '../server/domain.mjs';
import {start} from '../server/index.mjs';
import {Readable} from 'node:stream';
import {BatchImporter} from '../server/batch-import.mjs';
import {zipEntries} from '../server/zip.mjs';
const query={source:'synthetic-activity',start:'2024-01-01',end:'2024-03-01',grid:0.1,interval:'DAILY',bounds:[-2,49,-1,50]};
async function fixture(fn){const workspace=await mkdtemp(join(tmpdir(),'batch-reports-')),jobs=new JobStore(workspace);await jobs.load();const batches=new BatchStore(workspace,jobs);await batches.load();try{await fn({workspace,jobs,batches});}finally{await batches.close();await jobs.close();await rm(workspace,{recursive:true,force:true});}}
const finish=async(batches,b)=>{batches.start(b.id);await batches.running.get(b.id);};
const opts=(batches,b,extra={})=>({fingerprint:batches.view(b).analysisFingerprint,...extra});
async function pausedFixture(ctx){const {batches,jobs,workspace}=ctx,b=await batches.create(query),persist=batches.persist.bind(batches);batches.persist=async batch=>{await persist(batch);if(batch.id===b.id&&batch.status==='running'&&batch.parts[0].status==='complete')await batches.pause(b.id);};await finish(batches,b);batches.persist=persist;
 const p=b.parts[0],a=archive(p.query,p.jobId,[{date:'2024-01-01',lat:49.5,lon:-1.5,hours:0,geartype:'TRAWLERS'},{date:'2024-01-03',lat:49.5,lon:-1.5,hours:8,geartype:'TRAWLERS'}]);a.files['caveats.txt']='SYNTHETIC partial-batch test fixture: one zero, one positive row, unreturned bins and a missing chunk. Not observations.\n';a.manifest.files['caveats.txt']={sha256:hash(a.files['caveats.txt']),bytes:Buffer.byteLength(a.files['caveats.txt'])};await jobs.atomic(`artifact-${p.jobId}.json`,a);const bytes=await readFile(join(workspace,`artifact-${p.jobId}.json`));Object.assign(p,{rows:2,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,csvSha256:a.manifest.files['data.csv'].sha256,csvBytes:a.manifest.files['data.csv'].bytes});await batches.persist(b);return b;
}
test('batch reports reconcile all selected values and retain every verified chunk and caveat',async()=>fixture(async({batches})=>{
 const b=await batches.create(query);await finish(batches,b);const m=await prepareBatchReport(batches,b.id,opts(batches,b));assert.equal(m.total,600);assert.equal(m.rows,240);assert.equal(m.parents.length,2);assert.equal(m.groups.reduce((s,g)=>s+g.value,0),600);assert.equal(m.series.reduce((s,g)=>s+(g.value??0),0),600);assert.equal(m.cells.reduce((s,g)=>s+g.value,0),600);assert.equal(m.metadata.complete,true);assert.ok(m.parents.every(p=>p.artifactId&&p.manifestHash&&p.dataHash&&p.caveatHash));assert.equal(m.metadata.dataHash,hash(m.parents));assert.equal(m.sourceCaveats.length,1);assert.deepEqual(m.sourceCaveats[0].chunks,[1,2]);assert.equal(m.id,(await prepareBatchReport(batches,b.id,opts(batches,b))).id);assert.equal(await reportSvg(m),await reportSvg(m));
 const selected=await prepareBatchReport(batches,b.id,opts(batches,b,{end:'2024-02-01',group:'TRAWLERS'}));assert.equal(selected.total,186);assert.equal(selected.rows,62);assert.equal(selected.parents.length,1);assert.notEqual(selected.id,m.id);
}));
test('partial batches, selected completeness, unavailable bins and zero values remain distinct in figures and HTML',async()=>fixture(async ctx=>{
 const b=await pausedFixture(ctx),{batches}=ctx;await assert.rejects(prepareBatchReport(batches,b.id,opts(batches,b)),/explicitly PARTIAL/);const m=await prepareBatchReport(batches,b.id,opts(batches,b,{partial:'true'}));assert.equal(m.total,8);assert.equal(m.metadata.complete,false);assert.equal(m.metadata.selectionComplete,false);assert.deepEqual(m.series.slice(0,3).map(b=>[b.value,b.status]),[[0,'returned'],[null,'no-returned-rows'],[8,'returned']]);assert.equal(m.series.at(-1).status,'not-retrieved');
 const svg=await reportSvg(m),html=await batchReportHtml(m);assert.match(svg,/PARTIAL HISTORICAL BATCH/);assert.match(svg,/url\(#not-retrieved\)/);assert.match(svg,/diagonal hatching = no returned rows/);assert.match(html,/Selected returned total<\/td><td>8 synthetic apparent fishing hours \(partial\)/);assert.match(html,/one zero, one positive row/);assert.match(html,/Not retrieved/);
 const january=await prepareBatchReport(batches,b.id,opts(batches,b,{partial:'true',end:'2024-02-01'}));assert.equal(january.metadata.complete,false);assert.equal(january.metadata.selectionComplete,true);assert.equal(january.missingWindows.length,1);assert.equal(january.relevantMissing.length,0);assert.match(await reportSvg(january),/PARTIAL HISTORICAL BATCH · selected window retrieved/);
}));
test('empty planned batches can only export explicitly partial reports, with no invented parents or observations',async()=>fixture(async({batches})=>{
 const b=await batches.create(query),m=await prepareBatchReport(batches,b.id,opts(batches,b,{partial:'true'}));assert.equal(m.total,null);assert.equal(m.parents.length,0);assert.ok(m.series.every(b=>b.status==='not-retrieved'&&b.value===null));assert.match(await batchReportHtml(m),/No completed parent chunks intersect/);assert.match(await reportSvg(m),/PARTIAL HISTORICAL BATCH/);
}));
test('oversized group and coordinate summaries are wholly omitted while totals stay complete',async()=>fixture(async({batches,workspace})=>{
 const b=await batches.create(query);await finish(batches,b);const a=await analyzeBatch(b,workspace,{}, {maxCells:2,maxGroups:1,includeReportData:true}),m=batchReportModel(a);assert.equal(m.mapOmitted,true);assert.equal(m.cellCount,null);assert.equal(m.groupTotalsOmitted,true);assert.deepEqual(m.groups,[]);assert.equal(m.total,600);assert.match(await batchReportHtml(m),/no truncated group total/);assert.match(await reportSvg(m),/Group chart omitted/);
 const filtered=await analyzeBatch(b,workspace,{group:'TRAWLERS'}, {maxGroups:1,includeReportData:true});assert.equal(filtered.groupTotalsOmitted,false);assert.equal(filtered.groupTotals[0].value,360);
}));
test('reports reject stale review fingerprints, concurrent retrieval and corrupt chunk files',async()=>fixture(async({batches,workspace})=>{
 const b=await batches.create(query);await finish(batches,b);const prior=opts(batches,b);b.error='Changed';await assert.rejects(prepareBatchReport(batches,b.id,prior),/changed/);const m=await prepareBatchReport(batches,b.id,opts(batches,b));b.error='Changed again';assert.throws(()=>assertBatchReportCurrent(batches,b.id,m.metadata.batchFingerprint),/changed/);batches.running.set(b.id,Promise.resolve());await assert.rejects(prepareBatchReport(batches,b.id,opts(batches,b)),/changed/);batches.running.delete(b.id);await writeFile(join(workspace,`artifact-${b.parts[0].jobId}.json`),'corrupt');await assert.rejects(prepareBatchReport(batches,b.id,opts(batches,b)),/changed|integrity/);
}));
test('batch export options exclude row pagination and malformed review tokens',()=>{
 for(const input of [{},{fingerprint:'invalid'},{fingerprint:'a'.repeat(64),offset:'50'},{fingerprint:'a'.repeat(64),partial:'yes'}])assert.throws(()=>batchReportOptions(input));
});
test('monthly batch reports preserve partial calendar endpoints and exact display boundaries',async()=>fixture(async({batches})=>{
 const b=await batches.create({...query,start:'2023-12-15',end:'2024-03-10',interval:'MONTHLY'});await finish(batches,b);const m=await prepareBatchReport(batches,b.id,opts(batches,b));assert.deepEqual(m.series.map(b=>b.value),[170,310,290,90]);assert.equal(m.series[0].start,'2023-12-15');assert.equal(m.series.at(-1).end,'2024-03-10');await assert.rejects(prepareBatchReport(batches,b.id,opts(batches,b,{start:'2024-01-15'})),/bin boundaries/);
}));
test('local batch report routes enforce sessions, partial acknowledgement and the reviewed fingerprint',async()=>fixture(async ctx=>{
 const b=await pausedFixture(ctx);await ctx.batches.close();await ctx.jobs.close();let app;try{app=await start({workspace:ctx.workspace,port:0,fetchImpl:async()=>{throw Error('No upstream');}});const base=app.origin+`/api/batches/${b.id}`;assert.equal((await fetch(base+'/report')).status,401);const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}}),headers={Cookie:session.headers.get('set-cookie').split(';')[0]};const a=await(await fetch(base+'/analysis',{headers})).json();const params=new URLSearchParams({fingerprint:a.batchFingerprint,partial:'true',end:'2024-02-01'});const html=await fetch(base+'/report?'+params,{headers});assert.equal(html.status,200);assert.match(html.headers.get('content-disposition'),/PARTIAL.*\.html/);assert.match(await html.text(),/selected window retrieved, other windows missing/);const svg=await fetch(base+'/figure?'+params,{headers});assert.equal(svg.status,200);assert.equal(svg.headers.get('content-type'),'image/svg+xml');assert.match(await svg.text(),/PARTIAL/);params.delete('partial');assert.equal((await fetch(base+'/report?'+params,{headers})).status,400);assert.equal((await fetch(base+'/report',{headers})).status,400);
 }finally{if(app)await app.close();}
}));

test('reports of imported partial archives retain original artifacts, data hashes and missing windows',async()=>fixture(async source=>{
 const original=await pausedFixture(source),before=await prepareBatchReport(source.batches,original.id,opts(source.batches,original,{partial:'true'})),exported=await source.batches.exportEntries(original.id,{allowPartial:true}),parts=[];for await(const bytes of zipEntries(exported.entries))parts.push(bytes);
 await fixture(async destination=>{const importer=new BatchImporter(destination.workspace,destination.batches,destination.jobs),imported=await importer.receive(Readable.from([Buffer.concat(parts)])),b=destination.batches.get(imported.batch.id),after=await prepareBatchReport(destination.batches,b.id,opts(destination.batches,b,{partial:'true'}));assert.equal(after.total,before.total);assert.deepEqual(after.series,before.series);assert.equal(after.parents[0].artifactId,before.parents[0].artifactId);assert.equal(after.parents[0].dataHash,before.parents[0].dataHash);assert.notEqual(after.parents[0].jobId,before.parents[0].jobId);assert.equal(after.metadata.importedArchive.sourceId,original.id);assert.equal(after.metadata.complete,false);});
}));
