import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validate,makeArtifact,archive,hash} from '../server/domain.mjs';
import {compareArtifacts} from '../server/comparison.mjs';
import {start} from '../server/index.mjs';
const q=validate({source:'synthetic-activity',start:'2024-01-01',end:'2024-01-11',grid:0.1,interval:'DAILY',bounds:[-2,49,-1,50]});
const left=makeArtifact(q,'left');
const right=makeArtifact(validate({...q,start:'2024-02-01',end:'2024-02-11'}),'right');
test('compatible extracts compare additive totals and retain parent provenance',()=>{
 const copy=JSON.stringify([left,right]);const c=compareArtifacts(left,right);
 assert.equal(c.canComputeDifference,true);assert.deepEqual(c.summary,{left:100,right:100,delta:0,percentage:0});
 assert.equal(c.parents[0].dataHash,left.manifest.files['data.json'].sha256);assert.equal(c.parents[0].manifestHash,hash(left.manifest));
 assert.equal(c.series[0][0].date,'2024-01-01');assert.equal(c.series[1][0].date,'2024-02-01');assert.equal(JSON.stringify([left,right]),copy);
});
test('unequal durations require explicit calendar-day normalization',()=>{
 const longer=makeArtifact(validate({...q,end:'2024-01-21'}),'longer');
 const total=compareArtifacts(left,longer);assert.equal(total.canComputeDifference,false);assert.equal(total.summary.delta,null);
 const rate=compareArtifacts(left,longer,{normalization:'per-day'});assert.equal(rate.canComputeDifference,true);assert.deepEqual(rate.summary,{left:10,right:10,delta:0,percentage:0});assert.match(rate.units[0],/calendar day/);
});
test('different geometry, grid, grouping, filters and models prevent numeric differences',()=>{
 const live=validate({...q,source:'gfw-fishing',datasetVersion:'v5.0',grouping:'GEARTYPE'});
 const a=archive(live,'a',[{date:'2024-01-01',lat:49,lon:-2,hours:3,geartype:'trawlers'}]);
 for(const change of [{datasetVersion:'v4.0'},{grid:0.01},{grouping:'FLAG'},{flags:['ESP']},{bounds:[0,49,1,50]}]){
  const changedQuery=validate({...live,...change});const rows=a.rows.map(row=>({...row,lon:changedQuery.bounds[0]}));
  const b=archive(changedQuery,'b',rows);const c=compareArtifacts(a,b);assert.equal(c.canComputeDifference,false);assert.equal(c.summary.delta,null);assert.ok(c.checks.some(check=>!check.match));
 }
});
test('no rows is unknown; zero baseline has no percentage; absent groups/cells stay null',()=>{
 const zero=archive(q,'zero',[{date:'2024-01-01',lat:49,lon:-2,geartype:'A',hours:0}]);
 const positive=archive(q,'positive',[{date:'2024-01-01',lat:49,lon:-2,geartype:'A',hours:5},{date:'2024-01-01',lat:49.1,lon:-2,geartype:'B',hours:7}]);
 const c=compareArtifacts(zero,positive);assert.equal(c.summary.delta,12);assert.equal(c.summary.percentage,null);
 assert.equal(c.groups.find(g=>g.group==='B').left,null);assert.equal(c.groups.find(g=>g.group==='B').delta,null);assert.equal(c.cells.find(g=>g.lat===49.1).delta,null);
 const empty=compareArtifacts(archive(q,'empty',[]),positive);assert.equal(empty.summary.left,null);assert.equal(empty.summary.delta,null);
});
test('comparison rejects corrupted parents and bad normalization',()=>{
 const broken=structuredClone(left);broken.rows[0].hours=900;assert.throws(()=>compareArtifacts(broken,right));assert.throws(()=>compareArtifacts(left,right,{normalization:'automatic'}));
});
test('HTTP comparison save, reopen and export preserve results and detect corruption',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'fishing-comparison-'));let app;
 try{
  app=await start({port:0,workspace});const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}});
  const headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
  const call=(path,body,method='POST')=>fetch(app.origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const a=await(await call('/api/import',left)).json(),b=await(await call('/api/import',right)).json();
  assert.equal((await call('/api/comparisons',{leftId:a.id,rightId:a.id})).status,400);
  const response=await call('/api/comparisons',{leftId:a.id,rightId:b.id,normalization:'total'});assert.equal(response.status,201);const result=await response.json();
  const saved=await(await call(`/api/comparisons/${result.id}/download`,undefined,'GET')).json();assert.deepEqual(saved.report,result.report);assert.equal(saved.sha256,hash(saved.report));
  assert.equal((await(await call('/api/comparisons',undefined,'GET')).json()).length,1);
  const path=join(workspace,`comparison-${result.id}.json`);const tampered=JSON.parse(await readFile(path,'utf8'));tampered.report.summary.delta=999;await writeFile(path,JSON.stringify(tampered));
  assert.equal((await call(`/api/comparisons/${result.id}`,undefined,'GET')).status,400);
 }finally{if(app)await app.close();await rm(workspace,{recursive:true,force:true});}
});
test('missing provider version cannot be treated as a verified model match',()=>{
 const live=validate({...q,source:'gfw-fishing',datasetVersion:'v5.0',grouping:'GEARTYPE'});
 const a=archive(live,'a',left.rows),b=archive(validate({...live,start:right.query.start,end:right.query.end}),'b',right.rows);
 const c=compareArtifacts(a,b);assert.equal(c.canComputeDifference,false);assert.ok(c.checks.find(c=>c.label==='Provider-reported dataset').unknown);
});
test('time-series rates normalize by bin duration, not the whole study window',()=>{
 const longer=makeArtifact(validate({...q,end:'2024-01-21'}),'longer');const rate=compareArtifacts(left,longer,{normalization:'per-day'});
 assert.equal(rate.series[0][0].value,10);assert.equal(rate.series[1][0].value,10);
 const monthQuery=validate({...q,start:'2024-01-20',end:'2024-02-10',interval:'MONTHLY'});
 const monthly=makeArtifact(monthQuery,'monthly');const c=compareArtifacts(monthly,monthly,{normalization:'per-day'});
 assert.deepEqual(c.series[0].map(r=>r.calendarDays),[12,9]);assert.deepEqual(c.series[0].map(r=>r.value),[10,10]);
});
test('group normalization sums before dividing to avoid per-row rounding drift',()=>{
 const longer=makeArtifact(validate({...q,end:'2024-01-21'}),'longer');const c=compareArtifacts(left,longer,{normalization:'per-day'});
 assert.deepEqual(c.groups.map(g=>g.delta),[0,0]);assert.deepEqual(c.groups.map(g=>g.left),[4,6]);
});
