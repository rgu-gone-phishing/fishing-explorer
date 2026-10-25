import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ExplorerStore,verifyExplorerSnapshot} from '../server/explorer.mjs';
import {JobStore} from '../server/jobs.mjs';
import {WorkspaceStore} from '../server/workspaces.mjs';
import {hash} from '../server/domain.mjs';
import {start} from '../server/index.mjs';
const vesselId='sample-vessel-123';
const vessel=id=>({selfReportedInfo:[{id,shipname:'Synthetic fixture',ssvid:'123456789'}]});
const search={kind:'search',version:'v5.0',term:'Synthetic fixture'};
const event={id:'event-one',type:'port_visit',start:'2024-01-01T00:00:00Z',end:'2024-01-02T00:00:00Z',position:{lat:50,lon:1},port_visit:{confidence:'4'}};
async function workspace(fn,fetchImpl){const dir=await mkdtemp(join(tmpdir(),'lookup-import-')),jobs=new JobStore(dir);await jobs.load();const explorer=new ExplorerStore(dir,jobs,{fetchImpl,token:()=> 'test-personal-token'});await explorer.load();try{await fn({dir,jobs,explorer});}finally{await jobs.close();await rm(dir,{recursive:true,force:true});}}
async function samples(fn){let calls=0;await workspace(async source=>{const partial=structuredClone(await source.explorer.create(search));const complete=await source.explorer.next(partial.id);await fn({source,partial,complete,backup:s=>({snapshot:s,sha256:hash(s)})});},async()=>new Response(JSON.stringify(++calls===1?{entries:[vessel(vesselId)],total:2,since:'opaque-next'}:{entries:[vessel('second-vessel')],total:2,since:null})));
}
test('complete search, identity and event archives round-trip offline with original hashes',async()=>{
 for(const query of [search,{kind:'detail',version:'v5.0',vesselId},{kind:'events',version:'v5.0',vesselId,eventType:'port_visits',start:'2024-01-01',end:'2024-02-01',confidence:'all'}])await workspace(async source=>{
  const snapshot=await source.explorer.create(query);await workspace(async destination=>{let calls=0;destination.explorer.fetchImpl=async()=>{calls++;throw Error('No network for import');};destination.explorer.token=()=>'';const imported=await destination.explorer.importBackup({snapshot,sha256:hash(snapshot)});assert.equal(imported.localImport,true);assert.equal(imported.id,snapshot.id);assert.equal(hash(await destination.explorer.get(imported.id)),hash(snapshot));
   assert.equal((await destination.explorer.importBackup({snapshot,sha256:hash(snapshot)})).id,imported.id);const reopened=new ExplorerStore(destination.dir,destination.jobs);await reopened.load();assert.equal(reopened.list()[0].imported,true);assert.equal((await reopened.display(imported.id)).complete,true);assert.equal(calls,0);
  });
 },async()=>new Response(JSON.stringify(query.kind==='detail'?vessel(vesselId):{entries:[query.kind==='events'?event:vessel(vesselId)],total:1})));
});
test('partial imports are immutable and continuation creates a separate non-fetching copy',async()=>samples(async({partial,backup})=>workspace(async({explorer})=>{
 let calls=0;explorer.fetchImpl=async url=>{calls++;assert.equal(new URL(url).searchParams.get('since'),'opaque-next');return new Response(JSON.stringify({entries:[vessel('second-vessel')],total:2}));};
 const imported=await explorer.importBackup(backup(partial));assert.equal(imported.complete,false);await assert.rejects(explorer.next(imported.id),/immutable/);assert.equal(calls,0);
 const child=await explorer.copyForContinuation(imported.id);assert.notEqual(child.id,partial.id);assert.equal(child.continuedFrom.sha256,hash(partial));assert.equal(calls,0);const continued=await explorer.next(child.id);assert.equal(continued.complete,true);assert.equal(continued.entries.length,2);assert.equal(hash(await explorer.get(imported.id)),hash(partial));assert.equal(calls,1);
})));
test('differing archives with one original ID coexist and exact reimports reuse the matching local copy',async()=>samples(async({partial,complete,backup})=>workspace(async({explorer,dir,jobs})=>{
 const first=await explorer.importBackup(backup(partial)),second=await explorer.importBackup(backup(complete));assert.notEqual(first.id,second.id);assert.equal(second.originalId,complete.id);assert.equal(hash(await explorer.get(first.id)),hash(partial));assert.equal(hash(await explorer.get(second.id)),hash(complete));assert.equal((await explorer.importBackup(backup(complete))).id,second.id);assert.equal(explorer.list().length,2);
 const reopened=new ExplorerStore(dir,jobs);await reopened.load();assert.equal(hash(await reopened.get(second.id)),hash(complete));assert.equal((await reopened.display(second.id)).originalId,complete.id);
})));
test('recomputed outer checksums cannot conceal changed raw pages, rows, queries or pagination',async()=>samples(async({partial,complete,backup})=>workspace(async({explorer})=>{
 const alterations=[s=>{s.entries[0].selfReportedInfo[0].shipname='Changed only normalized record';},s=>{s.pages[0].raw+=' ';},s=>{s.pages[0].request.url='https://example.org/steal';},s=>{s.pages[0].cursor='wrong';},s=>{s.query.term='Different query';},s=>{s.nextCursor='invented';},s=>{s.total=999;}];
 for(const alter of alterations){const changed=structuredClone(complete);alter(changed);await assert.rejects(explorer.importBackup(backup(changed)));}
 const falselyComplete=structuredClone(partial);falselyComplete.complete=true;falselyComplete.status='complete';await assert.rejects(explorer.importBackup(backup(falselyComplete)),/Partial/);
 const loading=structuredClone(partial);loading.status='loading';await assert.rejects(explorer.importBackup(backup(loading)),/settle/);assert.equal(explorer.list().length,0);
})));
test('pagination ending below the reported total remains partial and never restarts at page one',async()=>workspace(async({explorer})=>{
 const snapshot=await explorer.create(search);verifyExplorerSnapshot(snapshot);assert.equal(snapshot.complete,false);assert.equal(snapshot.nextCursor,null);await assert.rejects(explorer.next(snapshot.id),/pagination ended/);await assert.rejects(explorer.copyForContinuation(snapshot.id),/no pending/);
},async()=>new Response(JSON.stringify({entries:[vessel(vesselId)],total:3}))));
test('an empty page with a progressing cursor is partial and retains its continuation',async()=>{
 let calls=0;await workspace(async({explorer})=>{const first=await explorer.create(search);assert.equal(first.entries.length,0);assert.equal(first.complete,false);assert.equal(first.nextCursor,'after-empty');verifyExplorerSnapshot(first);const last=await explorer.next(first.id);assert.equal(last.complete,true);assert.equal(last.pages.length,2);assert.equal(last.entries.length,1);},async()=>new Response(JSON.stringify(++calls===1?{entries:[],total:1,since:'after-empty'}:{entries:[vessel(vesselId)],total:1})));
});
test('portable studies rebind only the exact matching lookup content when local IDs conflict',async()=>samples(async({source,partial,complete,backup})=>{
 const sourceStudies=new WorkspaceStore(source.dir,source.jobs,source.explorer,{}),saved=await sourceStudies.saveStudy({title:'Portable lookup',query:{source:'synthetic-activity',start:'2024-01-01',end:'2024-02-01',grid:0.1,interval:'DAILY',bounds:[0,49,2,51]},references:[{kind:'lookup',id:complete.id,label:'Complete search'}],presentation:{activeView:'vessels',lookupId:complete.id}}),plan=await sourceStudies.exportStudy(saved.studyId);
 await workspace(async destination=>{await destination.explorer.importBackup(backup(partial));const full=await destination.explorer.importBackup(backup(complete)),studies=new WorkspaceStore(destination.dir,destination.jobs,destination.explorer,{}),imported=await studies.importStudy(plan);assert.equal(imported.availability[0].status,'available');assert.equal(imported.availability[0].resolvedId,full.id);assert.equal(imported.revision.references[0].sha256,hash(complete));});
}));
test('HTTP import/export preserves archive identity and continuation does not make an upstream request',async()=>samples(async({partial,backup})=>{
 const dir=await mkdtemp(join(tmpdir(),'lookup-import-http-'));let app,calls=0;
 try{app=await start({port:0,workspace:dir,fetchImpl:async()=>{calls++;throw Error('No request expected');}});assert.equal((await fetch(app.origin+'/api/explorer/import',{method:'POST',body:JSON.stringify(backup(partial))})).status,401);
  const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}}),headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};const call=(path,body,method=body?'POST':'GET')=>fetch(app.origin+path,{method,headers,body:body?JSON.stringify(body):undefined});
  const imported=await(await call('/api/explorer/import',backup(partial))).json();assert.equal(imported.localImport,true);assert.equal((await call(`/api/explorer/${imported.id}/next`,{})).status,400);
  const child=await(await call(`/api/explorer/${imported.id}/continue`,{})).json();assert.notEqual(child.id,imported.id);const exported=await(await call(`/api/explorer/${imported.id}/download`)).json();assert.equal(exported.sha256,hash(partial));assert.deepEqual(exported.snapshot,partial);assert.equal(calls,0);
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
}));
