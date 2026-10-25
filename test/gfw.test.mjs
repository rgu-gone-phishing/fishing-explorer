import test from 'node:test';
import assert from 'node:assert/strict';
import {validate,verifyArtifact} from '../server/domain.mjs';
import {reportRequest,parseReport,fetchReport} from '../server/gfw.mjs';
const query=validate({source:'gfw-fishing',datasetVersion:'v5.0',start:'2024-01-01',end:'2024-02-01',grid:0.1,interval:'DAILY',grouping:'GEARTYPE',flags:['ESP'],gears:['trawlers'],bounds:[-2,49,-1,50]});
const dataset='public-global-fishing-effort:v5.0';
const row={date:'2024-01-01',lat:49,lon:-2,geartype:'trawlers',hours:2.5};
const raw=JSON.stringify({entries:[{[dataset]:[row]}]});
test('request is pinned, geometry explicit, filters typed and no credential persisted',()=>{
 const request=reportRequest(query);const url=new URL(request.url);
 assert.equal(url.searchParams.get('datasets[0]'),dataset);
 assert.equal(url.searchParams.get('filters[0]'),"flag in ('ESP') AND geartype in ('trawlers')");
 assert.equal(request.body.geojson.coordinates[0].length,5);
 assert.throws(()=>validate({...query,gears:["trawlers') OR 1=1"]}));
 assert.throws(()=>validate({...query,datasetVersion:'latest'}));
});
test('keyed, flat and null reports; version mismatches and malformed values fail',()=>{
 assert.equal(parseReport(raw,query,dataset).rows[0].hours,2.5);
 assert.equal(parseReport(JSON.stringify({entries:[row]}),query,null).responseVersion,null);
 assert.equal(parseReport(JSON.stringify({entries:[{[dataset]:null}]}),query,null).rows.length,0);
 assert.throws(()=>parseReport(raw,query,'public-global-fishing-effort:v4.0'));
 assert.throws(()=>parseReport('<html>blocked</html>',query,null));
 assert.throws(()=>parseReport(JSON.stringify({entries:[{...row,hours:null}]}),query,null));
});
test('successful transfer archives raw bytes, independent metadata and normalized values',async()=>{
 const token='private-test-token-not-to-archive';
 const artifact=await fetchReport(query,'test',token,{fetchImpl:async(url,options)=>{
  assert.equal(options.headers.Authorization,`Bearer ${token}`);
  assert.equal(options.redirect,'error');
  return new Response(raw,{headers:{'x-datasets':dataset}});
 }});
 assert.ok(Number.isFinite(Date.parse(artifact.manifest.provenance.receivedAt)));
 assert.equal(artifact.files['upstream-response.json'],raw);
 assert.equal(artifact.manifest.responseVersion,dataset);
 assert.equal(JSON.stringify(artifact).includes(token),false);
 verifyArtifact(artifact);
});
test('no retries or false completions on auth, quota, server and transfer failures',async()=>{
 for(const [status,state] of [[401,'needs-authentication'],[403,'failed'],[429,'rate-limited'],[524,'recovery-needed']]){
 let calls=0;
 await assert.rejects(fetchReport(query,'test','token',{fetchImpl:async()=>{calls++;return new Response('',{status});}}),e=>e.state===state);
 assert.equal(calls,1);
 }
 await assert.rejects(fetchReport(query,'test','token',{fetchImpl:async()=>{throw Error('network');}}),e=>e.state==='recovery-needed');
 await assert.rejects(fetchReport(query,'test',''),e=>e.state==='needs-authentication');
});
test('responses outside requested time or area cannot become completed chunks',()=>{
 for(const change of [{date:'2023-12-31'},{date:'2024-02-01'},{date:'not-a-date'},{lat:-30},{lon:80}])assert.throws(()=>parseReport(JSON.stringify({entries:[{...row,...change}]}),query,null));
 const monthly={...query,start:'2024-01-15',end:'2024-02-10',interval:'MONTHLY'};
 assert.equal(parseReport(JSON.stringify({entries:[{...row,date:'2024-01'},{...row,date:'2024-02'}]}),monthly,null).rows.length,2);
 assert.throws(()=>parseReport(JSON.stringify({entries:[{...row,date:'2024-03'}]}),monthly,null));
});
