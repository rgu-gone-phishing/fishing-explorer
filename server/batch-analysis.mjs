import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {hash,verifyArtifact,geometry,reportRowBin} from './domain.mjs';
import {metricField,rowGroup,SOURCES} from '../shared/catalogue.mjs';
import {batchFingerprint} from './batch-record.mjs';

const isoDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const nextMonth=date=>{const d=new Date(date);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString().slice(0,10);};
const add=(a,b)=>{const value=a+b;if(!Number.isFinite(value))throw Error('Numeric total exceeds the supported range.');return value;};
// Portable study views store scientific scope, not pagination or a local batch ID.
export function batchViewShape(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['start','end','group'].includes(k))||!isoDate(input.start)||!isoDate(input.end)||input.start>=input.end||typeof input.group!=='string'||input.group.length>300||/[\u0000-\u001f]/.test(input.group))throw Error('Invalid saved batch display scope.');
 return {start:input.start,end:input.end,group:input.group};
}
export function analysisOptions(query,input={}){
 const start=input.start||query.start,end=input.end||query.end,group=input.group??'',offset=input.offset===undefined?0:Number(input.offset);
 if(!isoDate(start)||!isoDate(end)||start<query.start||end>query.end||start>=end)throw Error('Display dates must be a nonempty window inside the saved batch.');
 if(query.interval==='MONTHLY'&&((start!==query.start&&!start.endsWith('-01'))||(end!==query.end&&!end.endsWith('-01'))))throw Error('Monthly display windows must follow saved bin boundaries. Use month starts or the original batch endpoints.');
 if(typeof group!=='string'||group.length>300||/[\u0000-\u001f]/.test(group))throw Error('Invalid display group.');
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid row offset.');
 return {start,end,group,offset,limit:50};
}

// Read one integrity-checked chunk at a time. Never concatenate complete artifacts
// or infer a zero for an unreturned coordinate, time bin or unfinished window.
export async function analyzeBatch(batch,workspace,input={}, {maxCells=20000,maxGroups=1000,includeReportData=false,signal,artifactPath=id=>join(workspace,`artifact-${id}.json`)}={}){
 const options=analysisOptions(batch.query,input),field=metricField(batch.query.source),query=batch.query;
 const missingWindows=batch.parts.filter(p=>p.status!=='complete').map(p=>({start:p.start,end:p.end,status:p.status}));
 const relevantMissing=missingWindows.filter(p=>p.start<options.end&&p.end>options.start);
 const bins=new Map();let date=options.start;
 while(date<options.end){
  const next=query.interval==='MONTHLY'?nextMonth(date):new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
  const end=next<options.end?next:options.end,key=query.interval==='MONTHLY'?date.slice(0,7):date;
  bins.set(key,{date:key,start:date,end,value:null,rows:0,status:relevantMissing.some(p=>p.start<end&&p.end>date)?'not-retrieved':'no-returned-rows'});date=end;
 }
 const cells=new Map(),groups=new Map(),groupTotals=new Map(),rows=[],parents=[],envelope=[...query.bounds];let matchedRows=0,returnedTotal=null,mapOmitted=false,groupsTruncated=false,groupTotalsOmitted=false,caveatBytes=0;
 for(const part of batch.parts){
  signal?.throwIfAborted();
  if(part.status!=='complete'||part.start>=options.end||part.end<=options.start)continue;
  if(!/^[a-f0-9-]{36}$/.test(part.jobId||''))throw Error('Invalid saved chunk identity.');
  const path=artifactPath(part.jobId),info=await stat(path);
  if(info.size!==part.bytes||info.size>128*1024*1024)throw Error(`Chunk ${part.index+1} has changed or exceeds the analysis size limit.`);
  const bytes=await readFile(path);
  if(createHash('sha256').update(bytes).digest('hex')!==part.sha256)throw Error(`Chunk ${part.index+1} failed its saved-file integrity check.`);
  const artifact=verifyArtifact(JSON.parse(bytes.toString('utf8')));
  if(artifact.manifest.id!==(part.originalJobId||part.jobId)||artifact.manifest.queryHash!==hash(part.query)||artifact.rows.length!==part.rows)throw Error('Saved chunk does not match the batch partition.');
  if(includeReportData){caveatBytes+=Buffer.byteLength(artifact.files['caveats.txt']);if(caveatBytes>4*1024*1024)throw Error('Batch report source caveats exceed the 4 MiB limit. Narrow the report period.');}
  parents.push({...(includeReportData?{artifactId:artifact.manifest.id,queryHash:artifact.manifest.queryHash,dataHash:artifact.manifest.files['data.json'].sha256,manifestHash:hash(artifact.manifest),caveats:artifact.files['caveats.txt']}:{}),index:part.index,jobId:part.jobId,start:part.start,end:part.end,sha256:part.sha256,rows:part.rows,createdAt:artifact.manifest.createdAt,responseVersion:artifact.manifest.responseVersion,recovery:artifact.manifest.provenance.request?.recovery||null});
  for(const row of artifact.rows){
   const group=rowGroup(row,query),key=reportRowBin(row,part.query);
   if(!bins.has(key))continue;
   if(!groups.has(group)&&groups.size<maxGroups)groups.set(group,0);else if(!groups.has(group))groupsTruncated=true;
   if(groups.has(group))groups.set(group,groups.get(group)+1);
   if(options.group&&group!==options.group)continue;
   if(!groupTotalsOmitted){if(!groupTotals.has(group)&&groupTotals.size>=maxGroups){groupTotalsOmitted=true;groupTotals.clear();}else groupTotals.set(group,add(groupTotals.get(group)??0,row[field]));}
   envelope[0]=Math.min(envelope[0],row.lon);envelope[1]=Math.min(envelope[1],row.lat);envelope[2]=Math.max(envelope[2],row.lon);envelope[3]=Math.max(envelope[3],row.lat);
   const bin=bins.get(key);bin.value=add(bin.value??0,row[field]);bin.rows++;bin.status='returned';
   returnedTotal=add(returnedTotal??0,row[field]);
   if(matchedRows>=options.offset&&rows.length<options.limit)rows.push({...row,chunkIndex:part.index,jobId:part.jobId});matchedRows++;
   if(!mapOmitted){
    const cellKey=JSON.stringify([row.lat,row.lon]);let cell=cells.get(cellKey);
    if(!cell){if(cells.size>=maxCells){mapOmitted=true;cells.clear();continue;}cell={lat:row.lat,lon:row.lon,value:0,rows:0};cells.set(cellKey,cell);}
    cell.value=add(cell.value,row[field]);cell.rows++;
   }
  }
 }
 return {schemaVersion:1,type:'batch-analysis',batchId:batch.id,batchFingerprint:batchFingerprint(batch),importedArchive:batch.importedArchive||null,continuedFrom:batch.continuedFrom||null,query,geometry:geometry(query),options,units:SOURCES[query.source].metric,
  complete:missingWindows.length===0,selectionComplete:relevantMissing.length===0,missingWindows,relevantMissing,parents,matchedRows,returnedTotal,rows,
  nextOffset:options.offset+rows.length<matchedRows?options.offset+rows.length:null,
  groupTotals:[...groupTotals].map(([group,value])=>({group,value})).sort((a,b)=>b.value-a.value||a.group.localeCompare(b.group)),groupTotalsOmitted,maxGroups,envelope,
  series:[...bins.values()],cells:[...cells.values()],mapOmitted,maxCells,groups:[...groups].map(([name,rows])=>({name,rows})).sort((a,b)=>a.name.localeCompare(b.name)),groupsTruncated,
  notes:[...(batch.notes||[]),SOURCES[query.source].description,'Totals sum returned additive values only; complete retrieval does not establish complete observation coverage.','Missing windows and unreturned bins remain distinct from a returned zero. Group filters affect display only.','Rows retain original chunk order; map symbols represent returned coordinates, not verified cell footprints.','Each chunk was retrieved independently; this is not a synchronized upstream snapshot.','No regridding, interpolation, deduplication across sources, or confidence weighting is applied.']};
}
