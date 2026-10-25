import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {archive,validate,makeArtifact,hash} from '../server/domain.mjs';
import {extractReport,reportSvg,reportHtml} from '../server/reports.mjs';
import {start} from '../server/index.mjs';
const q=(extra={})=>validate({source:'synthetic-activity',start:'2024-01-01',end:'2024-01-04',grid:0.1,interval:'DAILY',bounds:[-2,49,-1,50],...extra});
const row=(date,hours,geartype='TRAWLERS',extra={})=>({date,lat:49.5,lon:-1.5,hours,geartype,...extra});
test('report totals, groups and canonical bins reconcile while missing and zero stay separate',()=>{
 const a=archive(q(),randomUUID(),[row('2024-01-01',2),row('2024-01-01',3,'FISHING'),row('2024-01-03',0)]),m=extractReport(a);assert.equal(m.total,5);assert.equal(m.rows,3);assert.equal(m.cells[0].value,5);assert.deepEqual(m.series.map(b=>b.value),[5,null,0]);assert.equal(m.groups.reduce((s,g)=>s+g.value,0),m.total);assert.equal(m.metadata.dataHash,hash(a.files['data.json']));assert.equal(m.metadata.boundaryHash,hash(a.files['boundary.geojson']));
 const selected=extractReport(a,{group:'TRAWLERS',time:'2024-01-01'});assert.equal(selected.total,2);assert.equal(selected.rows,1);assert.equal(selected.series.length,1);assert.equal(a.rows.length,3);assert.notEqual(selected.id,m.id);assert.equal(extractReport(a).id,m.id);
});
test('monthly labels aggregate to canonical months and keep partial calendar windows',()=>{
 const query=q({start:'2024-01-15',end:'2024-02-10',interval:'MONTHLY'}),a=archive(query,randomUUID(),[row('2024-01',2),row('2024-01-20',3),row('2024-02',4)]),m=extractReport(a);assert.deepEqual(m.series,[{key:'2024-01',start:'2024-01-15',end:'2024-02-01',value:5},{key:'2024-02',start:'2024-02-01',end:'2024-02-10',value:4}]);const selected=extractReport(a,{time:'2024-01-20'});assert.equal(selected.total,3);assert.equal(selected.metadata.options.time,'2024-01-20');
});
test('empty, all-zero and filtered-empty extracts are not assigned invented observations',async()=>{
 const empty=extractReport(archive(q(),randomUUID(),[]));assert.equal(empty.total,null);assert.ok(empty.series.every(b=>b.value===null));assert.equal(empty.cellCount,0);const svg=await reportSvg(empty);assert.match(svg,/No coordinate values returned/);assert.match(svg,/hatching is not zero/);assert.ok(!svg.includes('Coordinate-symbol scale: 0–0'));
 const a=archive(q(),randomUUID(),[row('2024-01-01',0),row('2024-01-03',2,'FISHING')]);assert.equal(extractReport(a,{time:'2024-01-01'}).total,0);assert.equal(extractReport(a,{time:'2024-01-01',group:'FISHING'}).total,null);for(const options of [{time:'2030-01-01'},{group:'unknown'},{palette:'different'}])assert.throws(()=>extractReport(a,options));
});
test('SAR reports preserve detection units and recovered association caveats',async()=>{
 const query=validate({source:'gfw-sar',datasetVersion:'v5.0',start:'2024-01-01',end:'2024-01-03',grid:0.1,interval:'DAILY',bounds:[-2,49,-1,50],grouping:'NONE',matched:'any'}),a=archive(query,randomUUID(),[{date:'2024-01-01',lat:49.5,lon:-1.5,detections:4}],{request:{recovery:{accepted:true}},responseVersion:'public-global-sar-presence:v5.0'}),m=extractReport(a),svg=await reportSvg(m),html=await reportHtml(m);assert.equal(m.units,'SAR vessel detections');assert.equal(m.total,4);assert.match(svg,/RECOVERY:/);assert.match(html,/RECOVERY ASSOCIATION/);assert.match(svg,/not fishing hours or unique vessels/);assert.ok(!svg.includes('apparent fishing hours'));
});
test('oversized maps omit all symbols instead of sampling, while retaining every selected value',async()=>{
 const query=q({bounds:[0,0,100,80]}),data=Array.from({length:20001},(_,i)=>row('2024-01-01',1,'FISHING',{lon:(i%200)*0.1,lat:Math.floor(i/200)*0.1})),m=extractReport(archive(query,randomUUID(),data));assert.equal(m.mapOmitted,true);assert.equal(m.cells.length,0);assert.equal(m.cellCount,20001);assert.equal(m.total,20001);assert.equal(m.series[0].value,20001);assert.match(await reportSvg(m),/Map omitted: over 20,000/);
});
test('standalone SVG and HTML are deterministic, escaped, source-linked and free of active content',async()=>{
 const hostile='</text><script>alert(1)</script><img src="https://invalid.example">',a=archive(q(),randomUUID(),[row('2024-01-01',1,hostile)]),m=extractReport(a),svg=await reportSvg(m),html=await reportHtml(m);assert.equal(svg,await reportSvg(m));assert.equal(html,await reportHtml(m));for(const output of [svg,html]){assert.ok(!output.includes('<script'));assert.ok(!output.includes('<img'));assert.match(output,/&lt;script&gt;/);assert.ok(output.includes(m.metadata.queryHash));assert.ok(output.includes(m.metadata.dataHash));assert.ok(output.includes('SYNTHETIC'));}assert.match(html,/default-src 'none'/);assert.match(html,/@media print/);assert.match(svg,/Natural Earth/);assert.match(html,/original research bundle is required/);assert.match(svg,/no returned rows, not zero/);
});
test('damaged artifacts and numeric overflow cannot produce trusted reports',()=>{
 const a=makeArtifact(q(),randomUUID());a.rows[0].hours++;assert.throws(()=>extractReport(a),/disagree/);const overflow=archive(q(),randomUUID(),[row('2024-01-01',Number.MAX_VALUE),row('2024-01-01',Number.MAX_VALUE)]);assert.throws(()=>extractReport(overflow),/numeric range/);
});
test('figure and report download routes require a local session and honor exact display filters',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'extract-report-http-'));let app;try{app=await start({workspace:dir,port:0});const a=makeArtifact(q(),randomUUID());assert.equal((await fetch(app.origin+`/api/artifacts/${a.manifest.id}/figure`)).status,401);const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{'X-Bootstrap':app.launchUrl.split('#')[1]}}),headers={Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};const imported=await(await fetch(app.origin+'/api/import',{method:'POST',headers,body:JSON.stringify(a)})).json();assert.ok(imported.id);const base=app.origin+`/api/artifacts/${imported.id}`;const figure=await fetch(base+'/figure?group=TRAWLERS&time=2024-01-01',{headers});assert.equal(figure.status,200);assert.equal(figure.headers.get('content-type'),'image/svg+xml');assert.match(figure.headers.get('content-disposition'),/\.svg/);assert.match(await figure.text(),/6 synthetic apparent fishing hours/);const report=await fetch(base+'/report',{headers});assert.equal(report.status,200);assert.match(report.headers.get('content-disposition'),/\.html/);assert.match(await report.text(),/Selected time-bin totals/);assert.equal((await fetch(base+'/report?group=unknown',{headers})).status,400);
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});
