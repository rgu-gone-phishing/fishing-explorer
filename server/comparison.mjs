import {geometry,hash,verifyArtifact} from './domain.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const days=q=>(Date.parse(q.end)-Date.parse(q.start))/86400000;
import {measure,rowGroup as groupName} from '../shared/catalogue.mjs';
function sumBy(rows,key,divisor){const map=new Map();for(const row of rows)map.set(key(row),(map.get(key(row))||0)+measure(row));if([...map.values()].some(value=>!Number.isFinite(value)))throw Error('Aggregated values exceed the supported numeric range.');return new Map([...map].map(([key,value])=>[key,value/divisor]));}
function difference(a,b,allowed){return allowed&&a!==null&&b!==null?b-a:null;}
export function compareArtifacts(left,right,{normalization='total',leftId=left.manifest.id,rightId=right.manifest.id}={}){
 verifyArtifact(left);verifyArtifact(right);
 if(!['total','per-day'].includes(normalization))throw Error('Choose total or per-day normalization.');
 const a=left.query,b=right.query;
 const checks=[
  ['Source',a.source,b.source],['Dataset/model version',a.datasetVersion,b.datasetVersion],['Units',left.manifest.units,right.manifest.units],
  ['Spatial grid',a.grid,b.grid],['Time bin',a.interval,b.interval],['Grouping',a.grouping,b.grouping],
  ['Flag filters',a.flags||[],b.flags||[]],['Gear filters',a.gears||[],b.gears||[]],['Vessel-type filters',a.vesselTypes||[],b.vesselTypes||[]],['AIS matching filter',a.matched||'any',b.matched||'any'],['Boundary geometry',geometry(a),geometry(b)],
 ].map(([label,left,right])=>({label,left,right,match:same(left,right)}));
 if(a.source!=='synthetic-activity'||b.source!=='synthetic-activity')checks.push({label:'Provider-reported dataset',left:left.manifest.responseVersion||'Not supplied',right:right.manifest.responseVersion||'Not supplied',match:Boolean(left.manifest.responseVersion&&right.manifest.responseVersion&&left.manifest.responseVersion===right.manifest.responseVersion),unknown:!left.manifest.responseVersion||!right.manifest.responseVersion});
 if(a.distanceFromPortKm!==undefined||b.distanceFromPortKm!==undefined)checks.push({label:'Minimum port distance (km)',left:a.distanceFromPortKm??'Not requested / unrecorded provider default',right:b.distanceFromPortKm??'Not requested / unrecorded provider default',match:a.distanceFromPortKm===b.distanceFromPortKm});
 const durationMatch=days(a)===days(b);
 checks.push({label:'Duration (calendar days)',left:days(a),right:days(b),match:durationMatch||normalization==='per-day',normalized:!durationMatch&&normalization==='per-day'});
 const canComputeDifference=checks.every(c=>c.match);
 const warnings=['Values describe returned data, not all maritime activity or complete observation coverage. Missing groups/cells are not filled with zeros. Comparisons are descriptive, not causal.','Totals sum all returned rows. Group/cell differences are computed only where both sides returned a value.'];
 if(a.datasetVersion!==b.datasetVersion)warnings.push('Different dataset/model versions: treat this as a methods comparison, not a real-world trend.');
 if(a.source!==b.source)warnings.push('Different sources remain separate; their values are not added together.');
 if(!durationMatch)warnings.push(normalization==='per-day'?'Each result is divided by its requested calendar-day duration, not reception or observation days.':'Unequal duration: select per-day normalization to compare rates, or use matched periods.');
 if(left.manifest.provenance.request?.recovery||right.manifest.provenance.request?.recovery)warnings.push('At least one parent has user-confirmed recovery association rather than provider-verified query ownership.');
 if(a.source!=='synthetic-activity'&&(!left.manifest.responseVersion||!right.manifest.responseVersion))warnings.push('At least one parent has no provider-reported version. Requested versions alone do not prove the response version.');
 if(a.start===b.start&&a.end===b.end)warnings.push('Both results cover the same dates; this compares snapshots rather than periods.');
 const da=normalization==='per-day'?days(a):1,db=normalization==='per-day'?days(b):1;
 const totalA=left.rows.length?left.rows.reduce((sum,r)=>sum+measure(r),0)/da:null;
 const totalB=right.rows.length?right.rows.reduce((sum,r)=>sum+measure(r),0)/db:null;
 if([totalA,totalB].some(value=>value!==null&&!Number.isFinite(value)))throw Error('Aggregated values exceed the supported numeric range.');
 const delta=difference(totalA,totalB,canComputeDifference);
 const groupsA=sumBy(left.rows,r=>groupName(r,a),da),groupsB=sumBy(right.rows,r=>groupName(r,b),db);
 const groups=[...new Set([...groupsA.keys(),...groupsB.keys()])].sort().map(group=>{
  const left=groupsA.get(group)??null,right=groupsB.get(group)??null;
  return {group,left,right,delta:difference(left,right,canComputeDifference)};
 });
 const cellKey=r=>`${r.lon},${r.lat}`;
 const cellsA=sumBy(left.rows,cellKey,da),cellsB=sumBy(right.rows,cellKey,db);
 const cells=[...new Set([...cellsA.keys(),...cellsB.keys()])].map(key=>{
  const [lon,lat]=key.split(',').map(Number);const left=cellsA.get(key)??null,right=cellsB.get(key)??null;
  return {lat,lon,left,right,delta:difference(left,right,canComputeDifference)};
 });
 const series=artifact=>[...sumBy(artifact.rows,r=>r.date,1)].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>{
  let duration=1;
  if(normalization==='per-day'){
   if(artifact.query.interval==='ENTIRE')duration=days(artifact.query);
   else if(artifact.query.interval==='MONTHLY'){
    const match=date.match(/^(\d{4})-(\d{2})(?:$|-)/);
    if(!match)duration=0;
    else {const start=Date.UTC(Number(match[1]),Number(match[2])-1,1),end=Date.UTC(Number(match[1]),Number(match[2]),1);duration=Math.max(0,Math.min(end,Date.parse(artifact.query.end))-Math.max(start,Date.parse(artifact.query.start)))/86400000;}
   }
  }
  return {date,value:duration>0?value/duration:null,calendarDays:duration};
 });
 const parent=(artifact,id)=>({localId:id,artifactId:artifact.manifest.id,query:artifact.query,manifestHash:hash(artifact.manifest),dataHash:artifact.manifest.files['data.json'].sha256,units:artifact.manifest.units,caveats:artifact.files['caveats.txt'],boundary:geometry(artifact.query)});
 return {schemaVersion:1,type:'descriptive-comparison',createdAt:new Date().toISOString(),transformation:'returned-measure-comparison-v3',normalization,
  parents:[parent(left,leftId),parent(right,rightId)],checks,canComputeDifference,warnings,
  summary:{left:totalA,right:totalB,delta,percentage:delta!==null&&totalA!==0?delta/totalA*100:null},
  units:[left.manifest.units,right.manifest.units].map(u=>normalization==='per-day'?`${u} / calendar day`:u),
  groups,cells,series:[series(left),series(right)]};
}
