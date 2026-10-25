import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {normalizeGeometry,boundsOf,containsPoint} from '../shared/geometry.mjs';
import {BatchStore,planBatch} from '../server/batches.mjs';
import {compactBatch,expandBatch} from '../server/batch-record.mjs';
import {JobStore} from '../server/jobs.mjs';
import {hash} from '../server/domain.mjs';
import {start} from '../server/index.mjs';
const circle=(count,radius=1,x=0,y=0)=>{const ring=Array.from({length:count},(_,i)=>[x+radius*Math.cos(i/count*Math.PI*2),y+radius*Math.sin(i/count*Math.PI*2)]);ring.push([...ring[0]]);return ring;};
const rectangle=(x,y,size)=>[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
const base={source:'synthetic-activity',start:'2020-01-01',end:'2021-01-01',grid:0.01,interval:'DAILY',geometry:{type:'Polygon',coordinates:[circle(4000)]}};
test('detailed boundaries preserve every coordinate, holes and independent caller copies',()=>{
 const ring=circle(40000,10),holes=Array.from({length:40},(_,i)=>rectangle(-4+i%8,-3+Math.floor(i/8),0.25));const original={type:'Polygon',coordinates:[ring,...holes]},before=JSON.stringify(original);
 const result=normalizeGeometry(original);assert.equal(JSON.stringify(result),before);assert.deepEqual(boundsOf(result),[-10,-10,10,10]);assert.equal(containsPoint([-3.9,-2.9],result),false);assert.equal(containsPoint([0,8],result),true);
 result.coordinates[0][0][0]=99;assert.equal(JSON.stringify(normalizeGeometry(original)),before);
 const changed=structuredClone(original);changed.coordinates[0][1]=changed.coordinates[0][0];assert.throws(()=>normalizeGeometry(changed),/repeated/);
});
test('robust predicates preserve close parallel edges and reject exact crossings/adjacent overlaps',()=>{
 const thin={type:'Polygon',coordinates:[[[0,0],[0.000001,0],[0.000001,0.000000001],[0,0.000000001],[0,0]]]};assert.deepEqual(normalizeGeometry(thin),thin);assert.equal(containsPoint([0.0000005,0.0000000005],thin),true);
 assert.throws(()=>normalizeGeometry({type:'Polygon',coordinates:[[[0,0],[4,0],[2,0],[4,4],[0,4],[0,0]]]}),/overlapping adjacent/);
 const crossed=circle(1000);[crossed[10],crossed[700]]=[crossed[700],crossed[10]];assert.throws(()=>normalizeGeometry({type:'Polygon',coordinates:[crossed]}),/intersecting/);
 assert.throws(()=>normalizeGeometry({...thin,crs:{type:'name',properties:{name:'EPSG:3857'}}}),/CRS/);
});
test('many disjoint polygon parts pass while containment and holes still reject invalid topology',()=>{
 const coordinates=Array.from({length:100},(_,i)=>[rectangle(-20+i%10*2,-20+Math.floor(i/10)*2,1)]);assert.deepEqual(normalizeGeometry({type:'MultiPolygon',coordinates}),{type:'MultiPolygon',coordinates});
 assert.throws(()=>normalizeGeometry({type:'MultiPolygon',coordinates:[[rectangle(0,0,10)],[rectangle(2,2,1)]]}),/overlap/);
 assert.throws(()=>normalizeGeometry({type:'Polygon',coordinates:[rectangle(0,0,10),rectangle(1,1,5),rectangle(2,2,1)]}),/Holes/);
 const island={type:'MultiPolygon',coordinates:[[rectangle(0,0,10),rectangle(1,1,8)],[rectangle(3,3,1)]]};assert.deepEqual(normalizeGeometry(island),island);
});
test('indexed intersection validation agrees with a quadratic integer-coordinate oracle',()=>{
 let seed=631;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed;};
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const on=(p,a,b)=>cross(a,b,p)===0&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
 const intersect=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(c,a,b)||on(d,a,b)||on(a,c,d)||on(b,c,d);
 for(let trial=0;trial<80;trial++){
  const ring=Array.from({length:12},()=>[random()%100,random()%80]);ring.push([...ring[0]]);let invalid=false;
  for(let i=0;i<12;i++){const a=ring[i],b=ring[i+1],c=ring[(i+2)%12];if(a[0]===b[0]&&a[1]===b[1]||on(a,b,c)||on(c,a,b))invalid=true;for(let j=i+2;j<12;j++)if(!(i===0&&j===11)&&intersect(a,b,ring[j],ring[j+1]))invalid=true;}
  let accepted=true;try{normalizeGeometry({type:'Polygon',coordinates:[ring]});}catch{accepted=false;}assert.equal(accepted,!invalid,`oracle trial ${trial}`);
 }
});
test('batch storage keeps one geometry, reopens legacy and compact plans, and preserves logical identity',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'large-batch-'));const jobs=new JobStore(workspace);await jobs.load();const store=new BatchStore(workspace,jobs);await store.load();
 try{
  const batch=await store.create({...base,end:'2030-01-01'});assert.equal(batch.parts.length,120);assert.equal(batch.parts[0].query.geometry,batch.query.geometry);assert.equal(batch.parts.at(-1).query.geometry,batch.query.geometry);
  const bytes=await readFile(join(workspace,`batch-${batch.id}.json`)),disk=JSON.parse(bytes);assert.equal(disk.storageSchemaVersion,2);assert.ok(disk.parts.every(p=>!Object.hasOwn(p,'query')));assert.ok(bytes.length<JSON.stringify(batch.query).length*6+200000);
  assert.equal(hash(expandBatch(compactBatch(batch))),hash(batch));const restarted=new BatchStore(workspace,jobs);await restarted.load();assert.equal(hash(restarted.get(batch.id)),hash(batch));
  const legacy=await store.create({...base,end:'2020-03-01'});await writeFile(join(workspace,`batch-${legacy.id}.json`),JSON.stringify(legacy));const migrated=new BatchStore(workspace,jobs);await migrated.load();assert.equal(hash(migrated.get(legacy.id)),hash(legacy));
  const forged=compactBatch(legacy);forged.parts[0].end='2020-01-15';await writeFile(join(workspace,`batch-${legacy.id}.json`),JSON.stringify(forged));const bad=new BatchStore(workspace,jobs);await bad.load();assert.throws(()=>bad.get(legacy.id));
 }finally{await store.close();await jobs.close();await rm(workspace,{recursive:true,force:true});}
});
test('local HTTP accepts detailed geometry and serves its offline predicate dependency',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'large-geometry-http-'));let app;
 try{
  app=await start({workspace,port:0});const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}}),headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
  const response=await fetch(app.origin+'/api/batches/preview',{method:'POST',headers,body:JSON.stringify({query:base})});assert.equal(response.status,200);const plan=await response.json();assert.equal(plan.parts.length,12);assert.equal(plan.query.geometry.coordinates[0].length,4001);
  const dependency=await fetch(app.origin+'/shared/vendor/robust-predicates/orient2d.js');assert.equal(dependency.status,200);assert.match(await dependency.text(),/export function orient2d/);
 }finally{if(app)await app.close();await rm(workspace,{recursive:true,force:true});}
});
