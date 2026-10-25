import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {validate,hash,archive,geometry,verifyArtifact} from '../server/domain.mjs';
import {reportRequest,fetchReport} from '../server/gfw.mjs';
import {previewQuery,previewParameters,tileRequest} from '../server/previews.mjs';
import {compareArtifacts} from '../server/comparison.mjs';
import {matchSavedScope,SavedReuseStore} from '../server/saved-reuse.mjs';
import {JobStore} from '../server/jobs.mjs';
import {BatchStore,planBatch} from '../server/batches.mjs';
import {WorkspaceStore} from '../server/workspaces.mjs';
import {buildExtractPackage,ExtractPackageImporter} from '../server/extract-package.mjs';
import {zipEntries} from '../server/zip.mjs';
import {handoffDocumentation} from '../server/handoff-docs.mjs';
import {extractReport,reportHtml,reportSvg} from '../server/reports.mjs';
const input={source:'gfw-fishing',datasetVersion:'v5.0',start:'2024-01-01',end:'2024-02-01',grid:.1,interval:'DAILY',grouping:'GEARTYPE',flags:[],gears:[],bounds:[-2,49,-1,50]};
const dataset='public-global-fishing-effort:v5.0',rows=[{date:'2024-01-01',lat:49.5,lon:-1.5,geartype:'trawlers',hours:2.5}],raw=JSON.stringify({entries:[{[dataset]:rows}]});
const fixture=(distance,extra={})=>{const query=validate({...input,...(distance===undefined?{}:{distanceFromPortKm:distance}),...extra});return archive(query,'00000000-0000-4000-8000-000000000001',rows,{raw,responseVersion:dataset,request:reportRequest(query)});};
async function workspace(fn){const dir=await mkdtemp(join(tmpdir(),'port-distance-')),jobs=new JobStore(dir);await jobs.load();const batches=new BatchStore(dir,jobs);await batches.load();try{await fn({dir,jobs,batches,studies:new WorkspaceStore(dir,jobs,{list:()=>[]},batches)});}finally{await batches.close();await jobs.close();await rm(dir,{recursive:true,force:true});}}
test('distance filter distinguishes omitted legacy semantics from every explicit integer threshold',()=>{
 const legacy=validate(input);assert.equal(legacy.schemaVersion,2);assert.equal(Object.hasOwn(legacy,'distanceFromPortKm'),false);assert.equal(new URL(reportRequest(legacy).url).searchParams.get('filters[0]'),null);
 for(const n of [0,1,2,3,4,5])for(const version of ['v4.0','v5.0']){const q=validate({...input,datasetVersion:version,distanceFromPortKm:n});assert.equal(q.schemaVersion,6);assert.equal(q.distanceFromPortKm,n);assert.deepEqual(validate(q),q);assert.notEqual(hash(q),hash(legacy));assert.equal(new URL(reportRequest(q).url).searchParams.get('filters[0]'),`distance_from_port_km >= ${n}`);}
 for(const n of [-1,6,.5,'3','',null,false,NaN,Infinity,{},'3 OR 1=1'])assert.throws(()=>validate({...input,distanceFromPortKm:n}),/Minimum port distance/);
 for(const source of ['gfw-presence','gfw-sar','synthetic-activity'])assert.throws(()=>validate({...input,source,distanceFromPortKm:0}),/only for AIS fishing/);
} );
test('named geometry, studies and historical partitions retain the explicit filter without changing the builder',async()=>workspace(async({studies})=>{
 const g=geometry(validate(input)),q=validate({...input,distanceFromPortKm:3,geometry:g,boundarySource:{type:'gfw-region',kind:'eez',id:'123',dataset:'public-eez-areas',label:'Fixture',version:null,retrievedAt:'2026-10-24T00:00:00Z',simplify:0,geometrySha256:hash(g),originalSha256:'0'.repeat(64),selectedSha256:'0'.repeat(64)}});assert.equal(q.schemaVersion,6);assert.deepEqual(validate(q),q);const plan=planBatch({...q,end:'2024-04-01'});assert.ok(plan.parts.every(p=>p.query.distanceFromPortKm===3&&p.query.boundarySource.id==='123'));
 const saved=await studies.saveStudy({title:'Port exclusion query',query:q,references:[],presentation:{}}),portable=await studies.exportStudy(saved.studyId),restored=await studies.importStudy(portable);assert.equal(restored.revision.query.distanceFromPortKm,3);assert.deepEqual(restored.revision.query,q);
 const old=await studies.saveStudy({title:'Legacy query',query:input,references:[],presentation:{}});assert.equal((await studies.openStudy(old.studyId)).revision.query.distanceFromPortKm,undefined);
}));
test('preview style and tile requests use the same threshold and separate their cache identities',()=>{
 const a=previewQuery({...input,distanceFromPortKm:0}),b=previewQuery({...input,distanceFromPortKm:3}),legacy=previewQuery(input);assert.notEqual(hash(a),hash(b));assert.notEqual(hash(a),hash(legacy));
 for(const q of [a,b]){const expected=`distance_from_port_km >= ${q.distanceFromPortKm}`;assert.equal(previewParameters(q).get('filters[0]'),expected);assert.equal(new URL(tileRequest(q,'AA==',3,3,2)).searchParams.get('filters[0]'),expected);}
 assert.equal(previewQuery({...input,distanceFromPortKm:3,flags:['ESP'],gears:['trawlers']}).distanceFromPortKm,3);assert.equal(new URL(reportRequest(validate({...input,distanceFromPortKm:3,flags:['ESP'],gears:['trawlers']})).url).searchParams.get('filters[0]'),"flag in ('ESP') AND geartype in ('trawlers') AND distance_from_port_km >= 3");
} );
test('saved reuse and arithmetic comparison reject different or unrecorded port filters',async()=>workspace(async({jobs,batches})=>{
 const a=fixture(),zero=fixture(0),three=fixture(3),same=fixture(3);for(const other of [a,zero]){assert.equal(matchSavedScope(other.query,three.query).compatible,false);assert.match(matchSavedScope(other.query,three.query).reasons.join(' '),/port distance/);const comparison=compareArtifacts(other,three);assert.equal(comparison.canComputeDifference,false);assert.ok(comparison.checks.some(c=>c.label==='Minimum port distance (km)'&&!c.match));}
 assert.equal(matchSavedScope(three.query,same.query).compatible,true);assert.equal(compareArtifacts(three,same).canComputeDifference,true);assert.equal(matchSavedScope(a.query,zero.query).compatible,false);
 await jobs.import(a);await jobs.import(zero);const chosen=await jobs.import(three),search=await new SavedReuseStore(jobs,batches).search({query:three.query});assert.equal(search.matches.length,1);assert.equal(search.matches[0].id,chosen.id);assert.equal(search.excluded.length,2);
}));
test('provider-side filtering is recorded and is never applied by dropping aggregated local rows',async()=>{
 const query=validate({...input,distanceFromPortKm:3}),a=await fetchReport(query,'test-filter','explicit-fixture-token',{fetchImpl:async url=>{assert.equal(new URL(url).searchParams.get('filters[0]'),'distance_from_port_km >= 3');return new Response(raw,{headers:{'x-datasets':dataset}});}});assert.deepEqual(a.rows,rows.map(r=>({...r,flag:'',vesselId:''})));verifyArtifact(a);assert.equal(a.files['upstream-response.json'],raw);assert.match(a.files['caveats.txt'],/not a locally calculated buffer/);assert.match(a.files['caveats.txt'],/grid cells can overlap/i);assert.equal(JSON.stringify(a).includes('explicit-fixture-token'),false);
 const changed=structuredClone(a);changed.query.distanceFromPortKm=0;assert.throws(()=>verifyArtifact(changed),/invalid/);
});
test('research handoffs and offline imports preserve port filters and unchanged original source bytes',async()=>workspace(async({dir,jobs})=>{
 for(const threshold of [undefined,0,3]){const a=fixture(threshold),source=Buffer.from(JSON.stringify(a,null,2)+'\n'),packageResult=buildExtractPackage(a,source),parts=[];for await(const part of zipEntries(packageResult.entries))parts.push(part);const imported=await new ExtractPackageImporter(dir,jobs).receive(Readable.from([Buffer.concat(parts)])),restored=await jobs.artifact(imported.id);assert.deepEqual(restored,a);assert.equal(restored.query.distanceFromPortKm,threshold);const files=new Map(packageResult.entries.map(e=>[e.name,e.data]));assert.ok(files.get('source.bundle.json').equals(source));const summary=handoffDocumentation(a.query)['query-summary.txt'];if(threshold===undefined)assert.ok(!summary.includes('distanceFromPortKm'));else{assert.ok(summary.includes(`"distanceFromPortKm":${threshold}`));assert.ok((await reportHtml(extractReport(a))).includes('distanceFromPortKm'));assert.ok((await reportSvg(extractReport(a))).includes(`port/anchorage distance: ≥ ${threshold} km`));}}
}));
