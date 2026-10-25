import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PbfWriter} from '../server/vendor/pbf/index.js';
import {InfrastructureStore,decodeInfrastructure,infrastructureView} from '../server/infrastructure.mjs';
import {infrastructureQuery,infrastructureTiles,INFRASTRUCTURE_DATASET} from '../shared/infrastructure.mjs';
import {compilePointFilter,containsPoint} from '../shared/geometry.mjs';
import {JobStore} from '../server/jobs.mjs';
import {hash} from '../server/domain.mjs';
import {start} from '../server/index.mjs';
const token='test-personal-token-infrastructure';
const query={start:'2024-01-01',end:'2025-01-01',bounds:[0,50,10,60]};
const metadata={id:INFRASTRUCTURE_DATASET,startDate:'2017-01-01T00:00:00Z',endDate:'2026-08-01T00:00:00Z',configuration:{contextLayerV1:{idProperty:'structure_id'}}};
const record=(id,extra={})=>({structure_id:id,lon:2.123456789,lat:54.123456789,label:'wind',label_confidence:'high',structure_start_date:String(Date.parse('2023-01-01')),structure_end_date:String(Date.parse('2026-01-01')),...extra});
function tile(rows){
 const pbf=new PbfWriter(),keys=[...new Set(rows.flatMap(r=>Object.keys(r)))],values=rows.flatMap(r=>Object.values(r));let valueIndex=0;
 pbf.writeMessage(3,(_,layer)=>{
  layer.writeStringField(1,'main');layer.writeVarintField(15,2);layer.writeVarintField(5,4096);
  for(const row of rows)layer.writeMessage(2,(_,feature)=>{feature.writePackedVarint(2,Object.keys(row).flatMap(k=>[keys.indexOf(k),valueIndex++]));feature.writeVarintField(3,1);feature.writePackedVarint(4,[9,2000,2000]);},null);
  for(const key of keys)layer.writeStringField(3,key);for(const value of values)layer.writeMessage(4,(_,v)=>{if(typeof value==='number')v.writeDoubleField(3,value);else v.writeStringField(1,value);},null);
 },null);return Buffer.from(pbf.finish());
}
const records=[record('one'),record('undated',{label:'unknown',label_confidence:'',structure_start_date:'',structure_end_date:''}),record('old',{structure_start_date:String(Date.parse('2018-01-01')),structure_end_date:String(Date.parse('2019-01-01'))}),record('outside',{lon:30})];
async function fixture(fn,override){const workspace=await mkdtemp(join(tmpdir(),'infrastructure-'));const jobs=new JobStore(workspace);await jobs.load();const requests=[];const fetchImpl=async(url,options)=>{requests.push(url);assert.equal(options.headers.Authorization,'Bearer '+token);assert.ok(url.startsWith('https://gateway.api.globalfishingwatch.org/v3/datasets/'+INFRASTRUCTURE_DATASET));if(override)return override(url,requests.length);return new Response(url.includes('/context-layers/')?tile(records):JSON.stringify(metadata),{headers:{'x-datasets':INFRASTRUCTURE_DATASET}});};const store=new InfrastructureStore(workspace,jobs,{fetchImpl,token:()=>token});await store.load();try{await fn({workspace,jobs,store,requests,fetchImpl});}finally{await jobs.close();await rm(workspace,{recursive:true,force:true});}}
const finish=async(store,id)=>{let view;for(let i=0;i<16;i++){view=await store.next(id);if(view.complete||view.error)break;}return view;};
test('tile plans remain bounded, preserve pinned product and reject invalid time/geometry',()=>{
 const q=infrastructureQuery(query);assert.equal(q.dataset,INFRASTRUCTURE_DATASET);assert.equal(infrastructureTiles(q).length,2);assert.ok(infrastructureTiles(infrastructureQuery({...query,bounds:[-179,-80,179,80]})).length<=16);
 assert.throws(()=>infrastructureQuery({...query,start:'2016-01-01'}));assert.throws(()=>infrastructureQuery({...query,bounds:[170,0,-170,20]}));
});
test('MVT decoding preserves full-precision source coordinates, date strings and evidence categories',()=>{
 const result=decodeInfrastructure(tile(records));assert.equal(result[0].lon,2.123456789);assert.equal(result[0].lat,54.123456789);assert.equal(result[0].confidence,'high');assert.equal(result[0].first,Date.parse('2023-01-01'));assert.equal(result[1].first,null);assert.equal(result[1].label,'unknown');assert.equal(result[1].confidence,'unavailable');
 assert.throws(()=>decodeInfrastructure(tile([record('bad',{lat:100})])),/coordinates/);assert.throws(()=>decodeInfrastructure(tile([record('bad',{structure_end_date:'1'})])),/reversed/);assert.throws(()=>decodeInfrastructure(Buffer.from('not a tile')));
});
test('indexed point selection matches polygon/hole membership including boundary points',()=>{
 const geometry={type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[4,2],[4,4],[2,4],[2,2]]]},predicate=compilePointFilter(geometry);
 for(let x=-1;x<=11;x+=0.5)for(let y=-1;y<=11;y+=0.5)assert.equal(predicate([x,y]),containsPoint([x,y],geometry));
});
test('snapshots deduplicate buffered tiles, preserve variants and filter date/label evidence locally',async()=>fixture(async({store,requests})=>{
 const created=await store.create(query);assert.equal(created.complete,false);const done=await finish(store,created.id);assert.equal(done.complete,true);assert.equal(done.total,2);assert.equal(done.distinctIds,2);assert.ok(done.duplicatesRemoved>0);assert.equal(done.undated,1);
 const snapshot=await store.get(created.id),before=requests.length;assert.equal(infrastructureView(snapshot,{confidence:'unavailable'}).total,1);assert.equal(infrastructureView(snapshot,{label:'wind',confidence:'high',includeUndated:false}).total,1);assert.equal(infrastructureView(snapshot,{start:'2018-01-01',end:'2020-01-01',includeUndated:false}).rows[0].id,'old');assert.equal(requests.length,before);
 const changed=structuredClone(snapshot),different=tile([record('one',{label_confidence:'medium'})]);changed.tiles[1].raw=different.toString('base64');changed.tiles[1].bytes=different.length;const {createHash}=await import('node:crypto');changed.tiles[1].sha256=createHash('sha256').update(different).digest('hex');const variants=infrastructureView(changed);assert.equal(variants.variantRecords,2);assert.equal(variants.distinctIds,2);assert.equal(variants.total,3);
}));
test('failed tiles stay partial, completed tiles survive restart and retry does not refetch them',async()=>{
 let fail=true;
 await fixture(async({store,workspace,jobs,requests,fetchImpl})=>{
  const created=await store.create(query);await store.next(created.id);const partial=await store.next(created.id);assert.equal(partial.complete,false);assert.match(partial.error,/429/);assert.equal(partial.tiles[0].status,'saved');
  const restarted=new InfrastructureStore(workspace,jobs,{fetchImpl,token:()=>token});await restarted.load();fail=false;const before=requests.length;const done=await restarted.next(created.id);assert.equal(done.complete,true);assert.equal(requests.length,before+1);
  restarted.token=()=>'';assert.equal(infrastructureView(await restarted.get(created.id)).total,2);
 },async(url,n)=>new Response(!url.includes('/context-layers/')?JSON.stringify(metadata):n===3&&fail?'':tile(records),{status:n===3&&fail?429:200,headers:{'x-datasets':INFRASTRUCTURE_DATASET}}));
});
test('backup integrity, version evidence and explicit completion are enforced',async()=>fixture(async({store})=>{
 const created=await store.create(query);await finish(store,created.id);const snapshot=await store.get(created.id),backup={snapshot,sha256:hash(snapshot)};assert.equal((await store.importBackup(backup)).complete,true);
 const bad=structuredClone(backup);bad.snapshot.tiles[0].raw='bad';bad.sha256=hash(bad.snapshot);await assert.rejects(store.importBackup(bad),/checksum|size/);
 const wrong=structuredClone(backup);wrong.snapshot.status='partial';wrong.sha256=hash(wrong.snapshot);await assert.rejects(store.importBackup(wrong),/completion/);
 store.fetchImpl=async()=>new Response(JSON.stringify({...metadata,id:'different'}));await assert.rejects(store.create(query),/metadata/);
}));
test('incomplete date evidence still respects any supplied first/last boundary',async()=>fixture(async({store})=>{
 const created=await store.create(query);const result=await finish(store,created.id);assert.equal(result.total,1);assert.equal(result.rows[0].id,'possible');assert.equal(result.undated,1);
},async url=>new Response(!url.includes('/context-layers/')?JSON.stringify(metadata):tile([
 record('future',{structure_start_date:String(Date.parse('2025-01-01')),structure_end_date:''}),
 record('past',{structure_start_date:'',structure_end_date:String(Date.parse('2023-12-31'))}),
 record('possible',{structure_start_date:String(Date.parse('2023-01-01')),structure_end_date:''}),
]))));
test('HTTP workflow remains offline after retrieval and studies retain infrastructure display settings',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'infrastructure-http-'));let app,calls=0;
 try{
  app=await start({port:0,workspace,initialToken:token,fetchImpl:async url=>{calls++;return new Response(url.includes('/context-layers/')?tile(Array.from({length:120},(_,i)=>record('export-'+i))):JSON.stringify(metadata));}});
  assert.equal((await fetch(app.origin+'/api/infrastructure')).status,401);const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}}),headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
  const call=(path,body,method=body?'POST':'GET')=>fetch(app.origin+path,{method,headers,body:body?JSON.stringify(body):undefined});assert.equal((await call('/api/infrastructure/preview',query)).status,200);assert.equal(calls,0);
  const snapshot=await(await call('/api/infrastructure',query)).json();await call(`/api/infrastructure/${snapshot.id}/next`,{});const done=await(await call(`/api/infrastructure/${snapshot.id}/next`,{})).json();assert.equal(done.complete,true);
  const study=await(await call('/api/studies',{title:'Infrastructure context',query:{source:'synthetic-activity',start:'2024-01-01',end:'2024-02-01',grid:0.1,interval:'DAILY',bounds:query.bounds},references:[{kind:'infrastructure',id:snapshot.id,label:'Context'}],presentation:{activeView:'infrastructure',infrastructureId:snapshot.id,infrastructureOptions:{start:'2024-01-01',end:'2025-01-01',label:'wind',confidence:'high',includeUndated:false},infrastructureOverlay:true}})).json();assert.equal(study.revision.presentation.infrastructureId,snapshot.id);assert.equal(study.availability[0].status,'available');
  await call('/api/connection',undefined,'DELETE');const before=calls;const viewed=await(await call(`/api/infrastructure/${snapshot.id}?label=wind&confidence=high&includeUndated=false`)).json();assert.equal(viewed.total,120);
  const csv=await(await call(`/api/infrastructure/${snapshot.id}/csv`)).text();assert.equal(csv.trim().split('\n').length,121);const geojson=await(await call(`/api/infrastructure/${snapshot.id}/geojson`)).json();assert.equal(geojson.features.length,120);assert.equal(geojson.metadata.complete,true);
  const backup=await(await call(`/api/infrastructure/${snapshot.id}/download`)).json();assert.ok(!JSON.stringify(backup).includes(token));assert.equal((await call('/api/infrastructure/import',backup)).status,201);assert.equal(calls,before);
 }finally{if(app)await app.close();await rm(workspace,{recursive:true,force:true});}
});
