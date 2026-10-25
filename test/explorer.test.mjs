import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExplorerStore,explorerQuery,explorerRequest,fetchExplorerPage} from '../server/explorer.mjs';
import {JobStore} from '../server/jobs.mjs';
import {hash} from '../server/domain.mjs';
import {vesselLabel,identities,confidenceLabel,eventPosition} from '../shared/explorer.mjs';
import {start} from '../server/index.mjs';
const vesselId='9b3e9019d-d67f-005a-9593-b66b997559e5';
const vessel={selfReportedInfo:[{id:vesselId,shipname:'Example vessel',ssvid:'123456789',flag:'ESP'}],registryInfo:[{id:'registry-record',shipname:'Registry name',sourceCode:'REG'}]};
const search={kind:'search',version:'v5.0',term:'Example'};
const events={kind:'events',version:'v5.0',vesselId,eventType:'port_visits',start:'2022-01-01',end:'2023-01-01',confidence:'all'};
const event=id=>({id,type:'port_visit',start:'2021-12-20T00:00:00Z',end:'2022-01-03T00:00:00Z',position:{lat:40,lon:-5},port_visit:{confidence:'4'}});
async function fixture(fn,fetchImpl){const dir=await mkdtemp(join(tmpdir(),'fishing-explorer-lookup-'));const jobs=new JobStore(dir);await jobs.load();const explorer=new ExplorerStore(dir,jobs,{fetchImpl,token:()=> 'test-personal-token'});await explorer.load();try{await fn(explorer,dir,jobs);}finally{await jobs.close();await rm(dir,{recursive:true,force:true});}}
test('typed queries reject invalid paths, versions, dates and inappropriate confidence filters',()=>{
 for(const q of [{...search,term:'xx'},{...search,version:'latest'},{...events,vesselId:'../secret'},{...events,start:'2022-02-30'},{...events,eventType:'gaps',confidence:'4'}])assert.throws(()=>explorerQuery(q));
 const url=new URL(explorerRequest(explorerQuery(events)).url);assert.equal(url.pathname,'/v3/events');assert.equal(url.searchParams.get('time-filter-mode'),'OVERLAP');assert.equal(url.searchParams.has('timeFilterMode'),false);
});
test('identity evidence stays separate and registry record IDs never become AIS IDs',()=>{
 assert.equal(identities(vessel).length,2);assert.deepEqual(vesselLabel(vessel).ids,[vesselId]);assert.equal(vesselLabel(vessel).name,'Example vessel');
 assert.match(confidenceLabel(event('a')),/^4 · High/);assert.equal(confidenceLabel({...event('a'),type:'fishing'}),'Not supplied / not applicable');
 assert.deepEqual(eventPosition(event('a')),[40,-5]);assert.equal(eventPosition({position:{lat:true,lon:4}}),null);assert.equal(eventPosition({position:{lat:' ',lon:4}}),null);assert.equal(eventPosition({position:{lat:125,lon:12}}),null);
});
test('search cursors append pages and retain original responses without credentials',async()=>{
 const requests=[];await fixture(async store=>{
  const first=await store.create(search);assert.equal(first.complete,false);assert.equal(first.entries.length,1);
  const second=await store.next(first.id);assert.equal(second.complete,true);assert.equal(second.entries.length,2);assert.equal(second.pages.length,2);
  assert.equal(new URL(requests[1]).searchParams.get('since'),'cursor-next');assert.equal(JSON.stringify(second).includes('test-personal-token'),false);assert.equal(store.list()[0].loaded,2);assert.equal(store.list()[0].pages,undefined);
 },async url=>{requests.push(url);return new Response(JSON.stringify(requests.length===1?{entries:[vessel],total:2,since:'cursor-next'}:{entries:[{selfReportedInfo:[{id:'another-id',shipname:'Second'}]}],total:2,since:null}));});
});
test('event offsets preserve overlapping events, deduplicate IDs and label incomplete totals',async()=>{
 let calls=0;await fixture(async store=>{
  const first=await store.create(events);assert.equal(first.complete,false);assert.equal(first.entries[0].start,'2021-12-20T00:00:00Z');
  const next=await store.next(first.id);assert.equal(next.entries.length,2);assert.equal(next.duplicatesRemoved,1);assert.equal(next.complete,false);assert.match(next.error,/reported total/);
 },async()=>new Response(JSON.stringify(++calls===1?{entries:[event('a')],total:3,nextOffset:1}:{entries:[event('a'),event('b')],total:3,nextOffset:null})));});
test('repeated pages/cursors and network failures retain partial results',async()=>{
 let calls=0;await fixture(async store=>{
  const first=await store.create(search);const second=await store.next(first.id);assert.equal(second.complete,false);assert.equal(second.entries.length,1);assert.match(second.error,/repeated/);
  const third=await store.next(first.id);assert.equal(third.entries.length,1);assert.equal(third.complete,false);assert.match(third.error,/could not complete/);
 },async()=>{calls++;if(calls===3)throw Error('offline');return new Response(JSON.stringify({entries:[vessel],total:3,since:'cursor-next'}));});
});
test('saved lookups reopen offline and reject corrupted snapshots',async()=>fixture(async(store,dir,jobs)=>{
 const s=await store.create(search);const restored=new ExplorerStore(dir,jobs);await restored.load();assert.equal((await restored.get(s.id)).entries.length,1);
 const path=join(dir,`explore-${s.id}.json`);const data=JSON.parse(await readFile(path,'utf8'));data.snapshot.entries=[];await writeFile(path,JSON.stringify(data));await assert.rejects(restored.get(s.id),/integrity/);
},async()=>new Response(JSON.stringify({entries:[vessel],total:1}))));
test('provider version mismatches and credential echoes are not saved as data',async()=>{
 await assert.rejects(fetchExplorerPage(explorerQuery(search),null,'token',{fetchImpl:async()=>new Response(JSON.stringify({entries:[vessel]}),{headers:{'x-datasets':'public-global-vessel-identity:v4.0'}})}),/version/);
 await assert.rejects(fetchExplorerPage(explorerQuery(search),null,'private-token',{fetchImpl:async()=>new Response(JSON.stringify({entries:[vessel],echo:'private-token'}))}),/credential/);
});
test('HTTP lookup, offline history and hashed export share the local session boundary',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fishing-explorer-http-'));let app;
 try{
  app=await start({port:0,workspace:dir,fetchImpl:async()=>new Response(JSON.stringify({entries:[vessel],total:1}),{headers:{'x-datasets':'public-global-vessel-identity:v5.0'}})});
  assert.equal((await fetch(app.origin+'/api/explorer')).status,401);
  const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}});const headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
  await fetch(app.origin+'/api/connection',{method:'POST',headers,body:JSON.stringify({token:'test-personal-token-for-http'})});
  const s=await(await fetch(app.origin+'/api/explorer',{method:'POST',headers,body:JSON.stringify(search)})).json();assert.equal(s.complete,true);
  const exported=await(await fetch(app.origin+`/api/explorer/${s.id}/download`,{headers})).json();assert.equal(exported.sha256,hash(exported.snapshot));assert.equal(exported.snapshot.entries.length,1);
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});
