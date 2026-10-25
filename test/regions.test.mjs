import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RegionStore,parseCatalogue} from '../server/regions.mjs';
import {JobStore} from '../server/jobs.mjs';
import {hash,validate,makeArtifact,verifyArtifact} from '../server/domain.mjs';
import {reportRequest} from '../server/gfw.mjs';
import {previewQuery} from '../server/previews.mjs';
import {start} from '../server/index.mjs';
const token='test-personal-token-123456789';
const geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]};
const list=[{id:1,label:'Repeated name',isoSov1:'AAA',isoSov2:'BBB'},{id:2,label:'Repeated name',isoSov1:'CCC'}];
const metadata={id:'public-eez-areas',source:'<a href="https://example.org">Source</a>',createdAt:'2025-01-01T00:00:00Z'};
const feature=(id=1,g=geometry)=>({type:'Feature',id,properties:{version:'2026-10-01'},geometry:g});
function provider(log,overrides={}){return async(url,options)=>{
 const u=new URL(url);log.push({path:u.pathname,search:u.search,auth:options.headers.Authorization});assert.equal(u.origin,'https://gateway.api.globalfishingwatch.org');
 let data=u.pathname.endsWith('/context-layers')?list:/context-layers\//.test(u.pathname)?feature(u.pathname.split('/').at(-1)):metadata;
 if(overrides.response)return overrides.response(u,data);
 if(overrides.geometry&&/context-layers\//.test(u.pathname))data=feature(u.pathname.split('/').at(-1),overrides.geometry);
 return new Response(JSON.stringify(data),{headers:{'x-datasets':'public-eez-areas'}});
};}
async function fixture(fn,override){const workspace=await mkdtemp(join(tmpdir(),'fishing-regions-'));const jobs=new JobStore(workspace);await jobs.load();const log=[],regions=new RegionStore(workspace,jobs,{fetchImpl:provider(log,override),token:()=>token});try{await fn({workspace,jobs,regions,log});}finally{await jobs.close();await rm(workspace,{recursive:true,force:true});}}
test('region lists keep repeated names, sovereignty evidence and distinct identifiers',async()=>fixture(async({regions,log})=>{
 assert.equal((await regions.catalogue('eez')).loaded,false);assert.equal(log.length,0);await regions.refresh('eez');const result=await regions.catalogue('eez',{search:'repeated'});assert.equal(result.entries.length,2);assert.notEqual(result.entries[0].id,result.entries[1].id);assert.equal((await regions.catalogue('eez',{search:'BBB'})).entries[0].id,'1');
 assert.throws(()=>parseCatalogue([{id:1,label:'a'},{id:'1',label:'b'}]),/repeated/);await assert.rejects(regions.catalogue('../../secret'));
}));
test('catalogue pagination does not deduplicate repeated labels or hide later matches',async()=>fixture(async({regions})=>{
 await regions.refresh('eez');const first=await regions.catalogue('eez'),second=await regions.catalogue('eez',{offset:first.nextOffset});assert.equal(first.entries.length,50);assert.equal(second.entries.length,5);assert.equal(second.entries[0].id,'50');assert.equal(second.nextOffset,null);
},{response:(u,data)=>new Response(JSON.stringify(u.pathname.endsWith('/context-layers')?Array.from({length:55},(_,id)=>({id,label:'Same name'})):data))}));
test('named boundary metadata and exact geometry survive queries, reports and bundles',async()=>fixture(async({regions,log,workspace})=>{
 await regions.refresh('eez');const display=await regions.retrieve({kind:'eez',id:'1'});assert.equal(display.canApply,true);assert.equal(display.source.version,'2026-10-01');assert.deepEqual(display.geometry,geometry);assert.equal(log.length,3);assert.equal(log.at(-1).search,'');
 const q=validate({source:'gfw-fishing',datasetVersion:'v5.0',start:'2024-01-01',end:'2024-01-03',grid:0.1,interval:'DAILY',grouping:'GEARTYPE',geometry:display.geometry,boundarySource:display.source});assert.equal(q.schemaVersion,5);assert.deepEqual(reportRequest(q).body.geojson,geometry);assert.equal(previewQuery(q).source,'gfw-fishing');
 const fixtureQuery=validate({...q,source:'synthetic-activity'}),a=makeArtifact(fixtureQuery,'fixture');verifyArtifact(a);assert.deepEqual(JSON.parse(a.files['boundary-source.json']),display.source);
 assert.throws(()=>validate({...q,geometry:{...geometry,coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}}),/changed/);assert.throws(()=>validate({...q,geometry:undefined}),/exact saved geometry/);
 const saved=await readFile(join(workspace,`region-${display.id}.json`),'utf8');assert.equal(saved.includes(token),false);regions.token=()=>'';regions.fetchImpl=()=>{throw Error('Offline must not fetch');};assert.equal((await regions.snapshot(display.id)).label,'Repeated name');assert.equal((await regions.catalogue('eez')).total,2);
}));
test('explicit simplification retains both original and selected responses',async()=>fixture(async({regions,log})=>{
 await regions.refresh('eez');const d=await regions.retrieve({kind:'eez',id:1,simplify:0.01});const saved=await regions.snapshot(d.id);assert.match(log.at(-1).search,/simplify=0.01/);assert.ok(saved.rawOriginal);assert.ok(saved.rawSelected);assert.notEqual(d.source.originalSha256,d.source.selectedSha256);assert.equal(d.source.simplify,0.01);
 await assert.rejects(regions.retrieve({kind:'eez',id:1,simplify:0.003}),/explicit simplification/);
},{response:(u,data)=>new Response(JSON.stringify(u.search?feature(1,{type:'Polygon',coordinates:[[[0,0],[1,0],[0,1],[0,0]]]}):data))}));
test('unsupported complex geometry is retained without substituting a box or applying it',async()=>{
 const ring=Array.from({length:250001},(_,i)=>[Math.cos(i/250001*Math.PI*2),Math.sin(i/250001*Math.PI*2)]);ring.push(ring[0]);
 await fixture(async({regions})=>{await regions.refresh('eez');const d=await regions.retrieve({kind:'eez',id:1});assert.equal(d.canApply,false);assert.equal(d.geometry,null);assert.match(d.reason,/250,000-vertex/);assert.equal(JSON.parse((await regions.snapshot(d.id)).rawOriginal).geometry.coordinates[0].length,250002);},{geometry:{type:'Polygon',coordinates:[ring]}});
});
test('backup import preserves identity and provenance and rejects corruption or conflicts',async()=>fixture(async({regions,jobs,workspace})=>{
 await regions.refresh('eez');const d=await regions.retrieve({kind:'eez',id:1}),snapshot=await regions.snapshot(d.id),bundle={snapshot,sha256:hash(snapshot)};
 const other=await mkdtemp(join(tmpdir(),'fishing-regions-import-'));const destination=new RegionStore(other,{atomic:async(name,data)=>{const {writeFile}=await import('node:fs/promises');await writeFile(join(other,name),JSON.stringify(data));}});
 try{assert.equal((await destination.importBackup(bundle)).source.geometrySha256,d.source.geometrySha256);assert.equal((await destination.importBackup(bundle)).id,d.id);const forged=structuredClone(bundle);forged.snapshot.label='changed';await assert.rejects(destination.importBackup(forged),/checksum/);forged.sha256=hash(forged.snapshot);await assert.rejects(destination.importBackup(forged),/metadata/);}finally{await rm(other,{recursive:true,force:true});}
}));
test('failed refresh retains cached data; wrong identity, version and credential echoes fail closed',async()=>fixture(async({regions})=>{
 await regions.refresh('eez');regions.fetchImpl=async()=>new Response('',{status:403});await assert.rejects(regions.refresh('eez'),/403/);assert.equal((await regions.catalogue('eez')).total,2);
 regions.fetchImpl=async()=>new Response(JSON.stringify(feature(99)));await assert.rejects(regions.retrieve({kind:'eez',id:1}),/identity/);
 regions.fetchImpl=async()=>new Response(JSON.stringify(feature(1)),{headers:{'x-datasets':'another-dataset'}});await assert.rejects(regions.retrieve({kind:'eez',id:1}),/dataset/);
 regions.fetchImpl=async()=>new Response(token);await assert.rejects(regions.retrieve({kind:'eez',id:1}),/credential/);assert.equal((await regions.list()).length,0);
}));
test('HTTP region retrieval, offline reopening and backup import share the local session boundary',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'region-http-'));let app;const log=[];
 try{app=await start({port:0,workspace,initialToken:token,fetchImpl:provider(log)});assert.equal((await fetch(app.origin+'/api/regions')).status,401);
  const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}}),headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
  const call=(path,body,method=body?'POST':'GET')=>fetch(app.origin+path,{method,headers,body:body?JSON.stringify(body):undefined});await call('/api/regions/catalogue/eez/refresh',{});const d=await(await call('/api/regions',{kind:'eez',id:'1'})).json();assert.equal(d.canApply,true);
  await call('/api/connection',undefined,'DELETE');const before=log.length;assert.equal((await(await call('/api/regions/'+d.id)).json()).id,d.id);const backup=await(await call('/api/regions/'+d.id+'/backup')).json();assert.equal((await call('/api/regions/import',backup)).status,201);assert.equal(log.length,before);assert.ok(!JSON.stringify(backup).includes(token));
 }finally{if(app)await app.close();await rm(workspace,{recursive:true,force:true});}
});
