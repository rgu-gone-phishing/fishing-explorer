import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGeometry,boundsOf,containsPoint,aggregateCells} from '../shared/geometry.mjs';
import {validate,geometry,makeArtifact,verifyArtifact} from '../server/domain.mjs';
import {reportRequest} from '../server/gfw.mjs';
const outer=[[0,0],[5,0],[5,5],[0,5],[0,0]];
const hole=[[1,1],[2,1],[2,2],[1,2],[1,1]];
const area={type:'Polygon',coordinates:[outer,hole]};
test('polygon and hole geometry is preserved through query, report and archive',()=>{
 const normalized=normalizeGeometry({type:'Feature',properties:{name:'Area'},geometry:area});
 assert.deepEqual(normalized,area);assert.deepEqual(boundsOf(normalized),[0,0,5,5]);
 assert.equal(containsPoint([0.5,0.5],area),true);assert.equal(containsPoint([1.5,1.5],area),false);
 const q=validate({source:'gfw-fishing',datasetVersion:'v5.0',start:'2024-01-01',end:'2024-02-01',grid:0.1,interval:'DAILY',grouping:'GEARTYPE',geometry:area,bounds:[-2,49,-1,50]});
 assert.deepEqual(q.bounds,[0,0,5,5]);assert.deepEqual(reportRequest(q).body.geojson,area);assert.deepEqual(geometry(q),area);
 const fixture=validate({...q,source:'synthetic-activity'});const a=makeArtifact(fixture,'polygon');verifyArtifact(a);assert.deepEqual(JSON.parse(a.files['boundary.geojson']),area);
});
test('invalid geometry fails before an upstream call',()=>{
 const invalid=[
  {type:'Point',coordinates:[1,1]},
  {type:'Polygon',coordinates:[[[0,0],[2,2],[0,2],[2,0],[0,0]]]},
  {type:'Polygon',coordinates:[[[0,0],[1,0],[2,0],[0,0]]]},
  {type:'Polygon',coordinates:[outer,[[6,6],[7,6],[7,7],[6,7],[6,6]]]},
  {type:'Polygon',coordinates:[outer,[[0,1],[2,1],[2,2],[0,2],[0,1]]]},
  {type:'Polygon',coordinates:[outer,hole,hole]},
  {type:'Polygon',coordinates:[[[179,0],[-179,0],[-179,1],[179,1],[179,0]]]},
  {type:'Polygon',coordinates:[[[0,86],[2,86],[2,87],[0,86]]]},
  {type:'MultiPolygon',coordinates:[[outer],[outer]]},
  {type:'FeatureCollection',features:[]},
 ];
 for(const g of invalid)assert.throws(()=>normalizeGeometry(g),JSON.stringify(g));
});
test('disjoint multipolygons and geometry in holes are supported',()=>{
 const island=[[1.2,1.2],[1.8,1.2],[1.8,1.8],[1.2,1.8],[1.2,1.2]];
 const multi={type:'MultiPolygon',coordinates:[area.coordinates,[island]]};
 assert.deepEqual(normalizeGeometry(multi),multi);
 assert.equal(containsPoint([1.5,1.5],multi),true);
});
test('map aggregation preserves additive hours across dates and groups without changing input',()=>{
 const rows=[{lat:1,lon:2,hours:2,date:'2024-01-01'},{lat:1,lon:2,hours:3,date:'2024-01-02'},{lat:2,lon:2,hours:4,date:'2024-01-02'}];
 const saved=JSON.stringify(rows);assert.deepEqual(aggregateCells(rows),[{lat:1,lon:2,hours:5},{lat:2,lon:2,hours:4}]);assert.equal(JSON.stringify(rows),saved);
});
