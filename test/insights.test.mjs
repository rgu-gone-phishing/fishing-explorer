import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {explorerQuery,explorerRequest,fetchExplorerPage,parseExplorerPayload,ExplorerStore,verifyExplorerSnapshot} from '../server/explorer.mjs';
import {DEFAULT_INSIGHTS,summarizeInsights} from '../shared/insights.mjs';
import {JobStore} from '../server/jobs.mjs';
import {hash} from '../server/domain.mjs';
const vesselId='synthetic-insight-identity';
const input={kind:'insights',version:'v5.0',vesselId,start:'2022-01-01',end:'2023-01-01',includes:DEFAULT_INSIGHTS};
const query=explorerQuery(input);
const response=()=>({period:{startDate:query.start,endDate:query.end},coverage:{blocks:'100',blocksWithPositions:'90',percentage:90},gap:{datasets:['public-global-gaps-events:v4.0'],periodSelectedCounters:{events:0,eventsGapOff:0},aisOff:[]},apparentFishing:{datasets:['public-global-fishing-events:v5.0'],periodSelectedCounters:{events:5,eventsInRFMOWithoutKnownAuthorization:1,eventsInNoTakeMPAs:0},eventsInRfmoWithoutKnownAuthorization:['fishing-event-123'],eventsInNoTakeMpas:[]},vesselIdentity:{datasets:['public-global-vessel-identity:v5.0'],iuuVesselList:{totalTimesListed:2,totalTimesListedInThePeriod:0,valuesInThePeriod:[]}}});
const detailQuery=explorerQuery({kind:'event-detail',version:'v5.0',vesselId,eventType:'fishing',eventId:'fishing-event-123'});
const event=()=>({id:detailQuery.eventId,type:'fishing',vessel:{id:vesselId},start:'2021-12-31T00:00:00Z',end:'2022-01-02T00:00:00Z',position:{lat:45,lon:2}});
async function workspace(fn,fetchImpl){const dir=await mkdtemp(join(tmpdir(),'insights-')),jobs=new JobStore(dir);await jobs.load();const store=new ExplorerStore(dir,jobs,{fetchImpl,token:()=> 'private-test-token'});await store.load();try{await fn(store,dir,jobs);}finally{await jobs.close();await rm(dir,{recursive:true,force:true});}}
test('insight requests pin identity, selected categories, UTC dates and fixed POST destination',async()=>{
 const canonical=explorerQuery({...input,includes:['GAP','COVERAGE','GAP']});assert.deepEqual(canonical.includes,['COVERAGE','GAP']);assert.equal(canonical.endSemantics,'provider-defined');
 for(const bad of [{includes:[]},{includes:['unknown']},{includes:['toString']},{start:'2016-12-31'},{start:'2022-02-30'},{end:'2022-01-01'},{end:'2999-01-01'},{version:'latest'}])assert.throws(()=>explorerQuery({...input,...bad}));
 const request=explorerRequest(query);assert.equal(request.url,'https://gateway.api.globalfishingwatch.org/v3/insights/vessels');assert.equal(request.method,'POST');assert.deepEqual(request.body,{vessels:[{datasetId:'public-global-vessel-identity:v5.0',vesselId}],startDate:'2022-01-01T00:00:00.000Z',endDate:'2023-01-01T00:00:00.000Z',includes:query.includes});
 const page=await fetchExplorerPage(query,null,'private-test-token',{fetchImpl:async(url,options)=>{assert.equal(url,request.url);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers['Content-Type'],'application/json');assert.deepEqual(JSON.parse(options.body),request.body);return new Response(JSON.stringify(response()),{status:201});}});assert.equal(page.next,null);assert.equal(page.total,null);assert.equal(page.responseVersion,null);
});
test('missing, NA, unsupported and explicit zero values remain distinct without a local score',()=>{
 const data=response();data.coverage={percentage:'NA',blocks:0,blocksWithPositions:0};delete data.apparentFishing;data.gap.periodSelectedCounters.eventsGapOff=null;
 const sections=summarizeInsights(data,query).sections;assert.equal(sections[0].metrics[0].value,null);assert.equal(sections[0].metrics[1].value,0);assert.equal(sections[0].status,'incomplete-fields');assert.equal(sections[1].status,'not-returned');assert.equal(sections[2].metrics[0].value,0);assert.equal(sections[2].metrics[1].value,null);assert.equal(sections[3].metrics[0].value,0);assert.equal(sections[3].metrics[1].value,2);
 for(const percentage of [-1,101,true,' ',Infinity])assert.equal(summarizeInsights({...response(),coverage:{percentage}},query).sections[0].metrics[0].value,null);
 for(const count of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'NaN',true])assert.equal(summarizeInsights({...response(),coverage:{blocks:count}},query).sections[0].metrics[1].value,null);
 assert.equal(summarizeInsights({...response(),coverage:[]},query).sections[0].status,'unsupported');assert.equal(summarizeInsights({...response(),coverage:{}},query).sections[0].status,'incomplete-fields');
 const mismatch=summarizeInsights({...response(),coverage:{blocks:10,blocksWithPositions:12,percentage:90}},query).sections[0];assert.equal(mismatch.metrics[2].value,12);assert.equal(mismatch.warnings.length,1);
});
test('reported source versions, gap spelling, event IDs and source intervals survive independently',()=>{
 const data=response();data.gaps=data.gap;delete data.gap;data.vesselIdentity.flagsChanges={totalTimesListed:4,totalTimesListedInThePeriod:1,valuesInThePeriod:[{from:'2021-01-01',to:'2022-06-01',value:'ARG',reference:'source'}]};data.vesselIdentity.mouList={tokyo:{totalTimesListed:3,totalTimesListedInThePeriod:0,valuesInThePeriod:[]},paris:{totalTimesListed:1,totalTimesListedInThePeriod:1,valuesInThePeriod:[]}};
 const full=explorerQuery({...input,includes:[...DEFAULT_INSIGHTS,'VESSEL-IDENTITY-FLAG-CHANGES','VESSEL-IDENTITY-MOU-LIST']});const sections=summarizeInsights(data,full).sections;
 assert.deepEqual(sections.find(s=>s.type==='GAP').datasets,['public-global-gaps-events:v4.0']);assert.equal(sections.find(s=>s.type==='FISHING').references[0].id,'fishing-event-123');assert.equal(sections.find(s=>s.type.includes('FLAG-CHANGES')).history[0].record.from,'2021-01-01');assert.equal(sections.find(s=>s.type.includes('MOU-LIST')).metrics.length,4);
 const parsed=parseExplorerPayload(JSON.stringify(data),query,'public-global-gaps-events:v4.0');assert.equal(parsed.responseVersion,'public-global-gaps-events:v4.0');assert.deepEqual(parsed.entries[0],data);
});
test('wrong periods and vessel identities are rejected; unmatched identity evidence is unavailable',()=>{
 for(const data of [{},{period:{startDate:'2021-01-01'}},{period:{endDate:'invalid'}},{coverage:{vesselId:'different-vessel'}},{period:{},vesselId:'different-vessel'}])assert.throws(()=>parseExplorerPayload(JSON.stringify(data),query));
 const missing={...response(),vesselIdsWithoutIdentity:[vesselId]};assert.ok(summarizeInsights(missing,query).sections.every(s=>s.status==='identity-unmatched'&&s.metrics.length===0));assert.ok(summarizeInsights({coverage:null},query).warnings.length);
});
test('access denials do not retry or drop selected categories and credential echoes are rejected',async()=>{
 let calls=0;await workspace(async store=>{const s=await store.create({...input,includes:['VESSEL-IDENTITY-MOU-LIST']});assert.equal(calls,1);assert.equal(s.complete,false);assert.equal(s.pages.length,0);assert.match(s.error,/access denied/);assert.ok(!JSON.stringify(s).includes('private-test-token'));verifyExplorerSnapshot(s);},async()=>{calls++;return new Response(JSON.stringify({messages:[{title:'Forbidden',detail:'private-test-token: MOU denied'}]}),{status:403});});
 for(const [data,headers] of [[{...response(),echo:'private-test-token'},{}],[response(),{'x-datasets':'private-test-token'}]])await assert.rejects(fetchExplorerPage(query,null,'private-test-token',{fetchImpl:async()=>new Response(JSON.stringify(data),{headers})}),/credential/);
});
test('event detail uses a fixed version and validates the event, type and vessel without clipping dates',async()=>{
 const req=explorerRequest(detailQuery),url=new URL(req.url);assert.equal(url.pathname,'/v3/events/fishing-event-123');assert.equal(url.searchParams.get('dataset'),'public-global-fishing-events:v5.0');
 const page=await fetchExplorerPage(detailQuery,null,'private-test-token',{fetchImpl:async()=>new Response(JSON.stringify(event()),{headers:{'x-datasets':req.dataset}})});assert.equal(page.entries[0].start,'2021-12-31T00:00:00Z');assert.equal(page.next,null);
 for(const edit of [{id:'different-event'},{type:'gap'},{vessel:{id:'another-vessel'}},{start:null}])assert.throws(()=>parseExplorerPayload(JSON.stringify({...event(),...edit}),detailQuery));
 assert.throws(()=>parseExplorerPayload(JSON.stringify(event()),detailQuery,'public-global-fishing-events:v4.0'),/version/);
 for(const bad of [{eventId:'../secret'},{eventType:'toString'}])assert.throws(()=>explorerQuery({...detailQuery,...bad}));
});
test('insights and event details export, import and reopen offline with request and response integrity',async()=>{
 for(const [q,data] of [[query,response()],[detailQuery,event()]])await workspace(async source=>{
  const saved=await source.create(q);assert.equal(saved.complete,true);verifyExplorerSnapshot(saved);
  await workspace(async(store,dir,jobs)=>{let calls=0;store.fetchImpl=async()=>{calls++;throw Error('offline');};store.token=()=>'';const bundle={snapshot:saved,sha256:hash(saved)},imported=await store.importBackup(bundle);assert.equal(imported.localImport,true);assert.equal(hash(await store.get(imported.id)),bundle.sha256);const restored=new ExplorerStore(dir,jobs);await restored.load();assert.equal((await restored.get(imported.id)).entries.length,1);assert.equal(calls,0);
   const changed=structuredClone(saved);if(q.kind==='insights')changed.pages[0].request.body.includes=['GAP'];else changed.pages[0].request.url+='&dataset=other';await assert.rejects(store.importBackup({snapshot:changed,sha256:hash(changed)}),/query, cursor or checksum/);
  });
 },async()=>new Response(JSON.stringify(data)));
});
