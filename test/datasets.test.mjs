import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCES,measure,rowGroup,metricField} from '../shared/catalogue.mjs';
import {validate,archive,verifyArtifact} from '../server/domain.mjs';
import {parseReport,reportRequest} from '../server/gfw.mjs';
import {aggregateCells} from '../shared/geometry.mjs';
import {compareArtifacts} from '../server/comparison.mjs';
const base={datasetVersion:'v5.0',start:'2024-01-01',end:'2024-01-03',grid:0.1,interval:'DAILY',bounds:[-2,49,-1,50]};
const presence=validate({...base,source:'gfw-presence',grouping:'FLAG',vesselTypes:['cargo']});
const sar=validate({...base,source:'gfw-sar',grouping:'NONE',matched:'false'});
test('source-specific dates, grouping and filters are validated',()=>{
 assert.throws(()=>validate({...base,source:'gfw-presence',grouping:'GEARTYPE'}));
 assert.throws(()=>validate({...presence,gears:['trawlers']}));
 assert.throws(()=>validate({...sar,grouping:'FLAG'}));
 assert.throws(()=>validate({...sar,start:'2012-01-01',end:'2012-01-03'}));
 assert.throws(()=>validate({...sar,matched:"false' OR 1=1"}));
 assert.throws(()=>validate({...presence,vesselTypes:["cargo')"]}));
 assert.equal(presence.metric,'vessel presence hours');assert.equal(sar.metric,'SAR vessel detections');
});
test('presence requests vessel type as a filter, while SAR omits identity grouping',()=>{
 const p=new URL(reportRequest(presence).url);assert.equal(p.searchParams.get('group-by'),'FLAG');assert.match(p.searchParams.get('filters[0]'),/vessel_type in \('cargo'\)/);
 const s=new URL(reportRequest(sar).url);assert.equal(s.searchParams.has('group-by'),false);assert.equal(s.searchParams.get('filters[0]'),"matched='false'");
});
test('SAR counts remain detections through parsing, archival and mapping',()=>{
 const dataset='public-global-sar-presence:v5.0';
 const raw=JSON.stringify({entries:[{[dataset]:[{date:'2024-01-01',lat:49,lon:-2,detections:3}]}]});
 const parsed=parseReport(raw,sar,dataset);assert.equal(parsed.rows[0].detections,3);assert.equal(Object.hasOwn(parsed.rows[0],'hours'),false);assert.equal(measure(parsed.rows[0]),3);
 const a=archive(sar,'sar',parsed.rows,{raw,responseVersion:dataset});verifyArtifact(a);assert.match(a.files['data.csv'],/detections/);assert.ok(!a.files['data.csv'].split('\n')[0].includes('hours'));assert.match(a.files['caveats.txt'],/not fishing hours/);
 assert.deepEqual(aggregateCells([...parsed.rows,...parsed.rows],metricField(sar.source)),[{lat:49,lon:-2,detections:6}]);assert.equal(rowGroup(parsed.rows[0],sar),'All detections');
 for(const detections of [null,1.5,-1])assert.throws(()=>parseReport(JSON.stringify({entries:[{date:'2024-01-01',lat:49,lon:-2,detections}]}),sar,null));
 const wrong=structuredClone(a);wrong.rows[0].hours=3;assert.throws(()=>verifyArtifact(wrong));
});
test('presence identity groups and type metadata do not become fishing classifications',()=>{
 const dataset='public-global-presence:v5.0';const raw=JSON.stringify({entries:[{[dataset]:[{date:'2024-01-01',lat:49,lon:-2,hours:10,flag:'ESP',vessel_type:'cargo'}]}]});
 const parsed=parseReport(raw,presence,dataset);assert.equal(parsed.rows[0].vesselType,'cargo');assert.equal(parsed.rows[0].geartype,'');assert.equal(rowGroup(parsed.rows[0],presence),'ESP');
 const a=archive(presence,'presence',parsed.rows,{raw,responseVersion:dataset});verifyArtifact(a);assert.equal(a.manifest.units,'vessel presence hours');assert.match(a.manifest.provenance.processing,/presence/);
});
test('matching SAR comparisons use count units; cross-source and changed filters disable differences',()=>{
 const dataset='public-global-sar-presence:v5.0';const rows=[{date:'2024-01-01',lat:49,lon:-2,detections:3}];
 const a=archive(sar,'a',rows,{responseVersion:dataset}),b=archive(sar,'b',[{...rows[0],detections:5}],{responseVersion:dataset});
 const c=compareArtifacts(a,b);assert.equal(c.canComputeDifference,true);assert.equal(c.summary.delta,2);assert.equal(c.units[0],'SAR vessel detections');assert.equal(c.groups[0].group,'All detections');
 const filtered=archive(validate({...sar,matched:'true'}),'c',rows,{responseVersion:dataset});assert.equal(compareArtifacts(a,filtered).canComputeDifference,false);
 const p=archive(presence,'p',[{date:'2024-01-01',lat:49,lon:-2,hours:3,flag:'ESP'}],{responseVersion:'public-global-presence:v5.0'});
 const mixed=compareArtifacts(a,p);assert.equal(mixed.summary.delta,null);assert.notEqual(mixed.units[0],mixed.units[1]);
 const p2=archive(validate({...presence,vesselTypes:['carrier']}),'p2',p.rows,{responseVersion:p.manifest.responseVersion});assert.equal(compareArtifacts(p,p2).canComputeDifference,false);
});
