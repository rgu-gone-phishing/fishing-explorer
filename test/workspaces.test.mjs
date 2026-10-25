import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCSV,csvReference,normalizeReference} from '../shared/reference-layers.mjs';
import {JobStore} from '../server/jobs.mjs';
import {BatchStore} from '../server/batches.mjs';
import {ExplorerStore} from '../server/explorer.mjs';
import {WorkspaceStore} from '../server/workspaces.mjs';
import {validate,makeArtifact,hash} from '../server/domain.mjs';
import {start} from '../server/index.mjs';
const query=validate({source:'synthetic-activity',start:'2024-01-01',end:'2024-02-01',grid:0.1,interval:'DAILY',bounds:[-2,49,-1,50]});
const csv='name,longitude,latitude,description\r\n"Test, point",-1.5,49.5,"two\nlines"\r\nSecond,-1.7,49.7,"a ""quote"""\r\n';
const layerInput={format:'csv',name:'fixture.csv',content:csv,columns:{longitudeColumn:'longitude',latitudeColumn:'latitude'},metadata:{title:'Synthetic reference points',provider:'Test fixture',citation:'Generated for automated tests',license:'Original test data',redistribution:'unknown',sector:'reference',status:'unspecified'}};
const studyInput={title:'Example study',notes:'Research notes',query,references:[],presentation:{viewport:{center:[49.5,-1.5],zoom:6},activeView:'extract'}};
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'fishing-workspaces-'));const jobs=new JobStore(dir);await jobs.load();const explorer=new ExplorerStore(dir,jobs);await explorer.load();const batches=new BatchStore(dir,jobs);await batches.load();const workspaces=new WorkspaceStore(dir,jobs,explorer,batches);try{await fn({dir,jobs,explorer,batches,workspaces});}finally{await batches.close();await jobs.close();await rm(dir,{recursive:true,force:true});}}
test('CSV parser preserves quoted fields, newlines and original coordinate mapping',()=>{
 const result=parseCSV(csv);assert.equal(result.rows.length,2);assert.equal(result.rows[0][0],'Test, point');assert.equal(result.rows[0][3],'two\nlines');assert.equal(result.rows[1][3],'a "quote"');
 const geo=csvReference(csv,layerInput.columns);assert.deepEqual(geo.features[0].geometry.coordinates,[-1.5,49.5]);assert.equal(geo.features[0].properties.description,'two\nlines');
 for(const input of ['a,a\n1,2','a,b\n1','a,b\n"bad,2','a,b\n"bad"oops,2'])assert.throws(()=>parseCSV(input));
 assert.throws(()=>csvReference('lon,lat\n=1+2,49',{longitudeColumn:'lon',latitudeColumn:'lat'}));
});
test('reference geometries reject unsupported CRS, positions, shapes and complexity',()=>{
 assert.throws(()=>normalizeReference({type:'Point',coordinates:[181,0]}));
 assert.throws(()=>normalizeReference({type:'Point',coordinates:[1,2],crs:{name:'EPSG:3857'}}));
 assert.throws(()=>normalizeReference({type:'Polygon',coordinates:[[[0,0],[2,2],[0,2],[2,0],[0,0]]]}));
 const line=normalizeReference({type:'LineString',coordinates:[[0,0],[1,1]]});assert.equal(line.features.length,1);
});
test('layer import retains original bytes and metadata; backup restores identity without overwriting',async()=>fixture(async({workspaces})=>{
 const layer=await workspaces.importLayer(layerInput);assert.equal(layer.original.content,csv);assert.equal(layer.original.sha256,hash(csv));assert.equal(layer.metadata.redistribution,'unknown');assert.equal(layer.geojson.features.length,2);
 const restored=await workspaces.importLayerBackup({layer,sha256:hash(layer)});assert.equal(restored.id,layer.id);
 const changed=structuredClone(layer);changed.metadata.title='Changed';await assert.rejects(workspaces.importLayerBackup({layer:changed,sha256:hash(changed)}),/different contents/);
 const corrupt=structuredClone(layer);corrupt.original.content+='bad';await assert.rejects(workspaces.importLayerBackup({layer:corrupt,sha256:hash(corrupt)}),/checksum/);
}));
test('study revisions preserve history and separate presentation from semantic query identity',async()=>fixture(async({workspaces})=>{
 const one=await workspaces.saveStudy({...studyInput,token:'must-not-persist'});
 const two=await workspaces.saveStudy({...studyInput,id:one.studyId,baseRevisionId:one.revision.id,presentation:{viewport:{center:[40,0],zoom:3},activeView:'extract',token:'must-not-persist'}});
 assert.equal(one.revision.queryHash,two.revision.queryHash);assert.equal(one.revision.queryRevisionId,two.revision.queryRevisionId);
 const three=await workspaces.saveStudy({...studyInput,id:one.studyId,baseRevisionId:two.revision.id,query:{...query,grid:0.01}});assert.notEqual(three.revision.queryHash,two.revision.queryHash);assert.notEqual(three.revision.queryRevisionId,two.revision.queryRevisionId);
 const old=await workspaces.openStudy(one.studyId,one.revision.id);assert.deepEqual(old.revision.presentation.viewport,studyInput.presentation.viewport);assert.equal(old.latestRevisionId,three.revision.id);
 assert.equal(JSON.stringify(await workspaces.exportStudy(one.studyId)).includes('must-not-persist'),false);
 await assert.rejects(workspaces.saveStudy({...studyInput,id:one.studyId,baseRevisionId:one.revision.id}),/changed since/);
}));
test('portable plans report missing resources and resolve imported data by exact content',async()=>fixture(async({workspaces,jobs})=>{
 const artifact=makeArtifact(query,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');const job=await jobs.import(artifact);
 const saved=await workspaces.saveStudy({...studyInput,references:[{kind:'artifact',id:job.id,label:'January extract'}],presentation:{activeView:'downloads',artifactId:job.id}});const bundle=await workspaces.exportStudy(saved.studyId);
 await fixture(async other=>{
  const imported=await other.workspaces.importStudy(bundle);assert.equal(imported.availability[0].status,'missing');
  const newJob=await other.jobs.import(artifact);const opened=await other.workspaces.openStudy(imported.studyId);assert.equal(opened.availability[0].status,'available');assert.equal(opened.availability[0].resolvedId,newJob.id);
 });
}));
test('reference layers travel separately and restore exact study associations',async()=>fixture(async({workspaces})=>{
 const layer=await workspaces.importLayer(layerInput);const saved=await workspaces.saveStudy({...studyInput,references:[{kind:'layer',id:layer.id,label:layer.metadata.title}]});const plan=await workspaces.exportStudy(saved.studyId);
 assert.equal(JSON.stringify(plan).includes(csv),false);assert.equal(plan.plan.includesData,false);
 await fixture(async other=>{const imported=await other.workspaces.importStudy(plan);assert.equal(imported.availability[0].status,'missing');await other.workspaces.importLayerBackup({layer,sha256:hash(layer)});assert.equal((await other.workspaces.openStudy(imported.studyId)).availability[0].status,'available');});
}));
test('concurrent study updates cannot overwrite revisions and corruption fails closed',async()=>fixture(async({workspaces,dir})=>{
 const saved=await workspaces.saveStudy(studyInput);const change={...studyInput,id:saved.studyId,baseRevisionId:saved.revision.id};const attempts=await Promise.allSettled([workspaces.saveStudy(change),workspaces.saveStudy(change)]);assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
 const path=join(dir,`study-${saved.studyId}.json`),record=JSON.parse(await readFile(path,'utf8'));record.data.revisions[0].title='Tampered';await writeFile(path,JSON.stringify(record));await assert.rejects(workspaces.openStudy(saved.studyId),/integrity/);
}));
test('HTTP study and layer workflows remain local and require the session',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fishing-study-http-'));let app;
 try{app=await start({port:0,workspace:dir});assert.equal((await fetch(app.origin+'/api/studies')).status,401);const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}});const headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 const layer=await(await fetch(app.origin+'/api/layers',{method:'POST',headers,body:JSON.stringify(layerInput)})).json();assert.equal(layer.geojson.features.length,2);
 const display=await(await fetch(app.origin+`/api/layers/${layer.id}?display=true`,{headers})).json();assert.equal(display.original,undefined);
 const saved=await(await fetch(app.origin+'/api/studies',{method:'POST',headers,body:JSON.stringify({...studyInput,references:[{kind:'layer',id:layer.id,label:'Reference'}]})})).json();assert.equal(saved.availability[0].status,'available');
 const exported=await(await fetch(app.origin+`/api/studies/${saved.studyId}/export`,{headers})).json();assert.equal(exported.sha256,hash(exported.plan));
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});
test('UTF-8 BOM and source text survive GeoJSON import and backup verification',async()=>fixture(async({workspaces})=>{
 const content='\uFEFF'+JSON.stringify({type:'Point',coordinates:[-1.6,49.5]});const layer=await workspaces.importLayer({...layerInput,format:'geojson',content,name:'bom.geojson'});
 assert.equal(layer.original.content,content);assert.equal(layer.original.sha256,hash(content));assert.deepEqual(layer.geojson.features[0].geometry.coordinates,[-1.6,49.5]);await workspaces.importLayerBackup({layer,sha256:hash(layer)});
}));
test('last-study restoration is local and exporting an old revision does not change it',async()=>fixture(async({workspaces})=>{
 assert.equal(await workspaces.lastStudy(),null);const a=await workspaces.saveStudy(studyInput);const b=await workspaces.saveStudy({...studyInput,id:a.studyId,baseRevisionId:a.revision.id,notes:'New revision'});
 assert.equal((await workspaces.lastStudy()).revision.id,b.revision.id);await workspaces.exportStudy(a.studyId,a.revision.id);assert.equal((await workspaces.lastStudy()).revision.id,b.revision.id);
 await workspaces.remember(a.studyId,a.revision.id);assert.equal((await workspaces.lastStudy()).revision.id,a.revision.id);
}));
