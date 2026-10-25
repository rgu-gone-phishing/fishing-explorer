import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './domain.mjs';
import {normalizeGeometry} from '../shared/geometry.mjs';
import {REGIONS,SIMPLIFICATIONS,regionIdentity,boundarySource} from '../shared/regions.mjs';
const BASE='https://gateway.api.globalfishingwatch.org/v3/datasets/';
export function parseCatalogue(data){
 if(!Array.isArray(data)||data.length>100000)throw Error('Unsupported region catalogue response.');
 const ids=new Set();return data.map(row=>{
  if(!row||typeof row.label!=='string'||!row.label.trim()||row.label.length>1000||!['string','number'].includes(typeof row.id)||!/^[A-Za-z0-9_-]{1,80}$/.test(String(row.id)))throw Error('Invalid region catalogue entry.');
  const id=String(row.id);if(ids.has(id))throw Error('Region catalogue repeated an identifier.');ids.add(id);
  return {...row,id};
 });
}
function feature(raw,id){let data;try{data=JSON.parse(raw);}catch{throw Error('Invalid region feature JSON.');}
 if(data.type!=='Feature'||String(data.id)!==id||!data.geometry)throw Error('Region feature identity/geometry does not match the request.');return data;
}
export function verifyRegionSnapshot(snapshot){
 if(!snapshot||snapshot.schemaVersion!==1||!/^[a-f0-9-]{36}$/.test(snapshot.id||''))throw Error('Invalid region snapshot schema.');
 const identity=regionIdentity(snapshot.kind,snapshot.regionId);
 if(!SIMPLIFICATIONS.includes(snapshot.simplify)||snapshot.metadata?.id!==identity.dataset||typeof snapshot.label!=='string'||!snapshot.label.trim()||snapshot.label.length>1000||!Number.isFinite(Date.parse(snapshot.retrievedAt))||snapshot.entry?.label!==snapshot.label||String(snapshot.entry?.id)!==snapshot.regionId)throw Error('Invalid region snapshot metadata.');
 for(const raw of [snapshot.rawOriginal,snapshot.rawSelected??snapshot.rawOriginal,snapshot.rawMetadata])if(typeof raw!=='string'||Buffer.byteLength(raw)>16*1024*1024)throw Error('Region snapshot source exceeds the supported size.');
 if(hash(JSON.parse(snapshot.rawMetadata))!==hash(snapshot.metadata)||(!snapshot.simplify&&snapshot.rawSelected!==null))throw Error('Region snapshot source metadata does not match.');
 const original=feature(snapshot.rawOriginal,identity.id),selected=feature(snapshot.rawSelected??snapshot.rawOriginal,identity.id);
 if(original.properties?.version&&selected.properties?.version&&original.properties.version!==selected.properties.version)throw Error('Boundary source version changed during simplification. Retrieve a fresh snapshot.');
 return snapshot;
}
export function regionPresentation(snapshot){
 const original=feature(snapshot.rawOriginal,snapshot.regionId),selected=feature(snapshot.rawSelected??snapshot.rawOriginal,snapshot.regionId);let geometry=null,reason=null;
 try{geometry=normalizeGeometry(selected);}catch(error){reason=error.message;}
 const source=geometry?boundarySource({type:'gfw-region',kind:snapshot.kind,id:snapshot.regionId,dataset:REGIONS[snapshot.kind].dataset,label:snapshot.label,version:typeof original.properties?.version==='string'?original.properties.version:null,retrievedAt:snapshot.retrievedAt,simplify:snapshot.simplify,geometrySha256:hash(geometry),originalSha256:hash(snapshot.rawOriginal),selectedSha256:hash(snapshot.rawSelected??snapshot.rawOriginal)}):null;
 return {id:snapshot.id,kind:snapshot.kind,regionId:snapshot.regionId,label:snapshot.label,dataset:REGIONS[snapshot.kind].dataset,retrievedAt:snapshot.retrievedAt,simplify:snapshot.simplify,geometry,source,canApply:!!geometry,reason,properties:original.properties||{},metadata:snapshot.metadata,
  notes:['Boundary snapshot describes the provider response at retrieval time, not historical boundary validity.','Dataset identifiers do not establish a frozen boundary version. Missing version evidence remains unknown.','Joint claims and overlapping regimes retain provider names and all supplied sovereignty fields.','Provider-specific use conditions apply; API access does not grant redistribution rights.',snapshot.simplify?'Experimental provider simplification changes the analysis geometry. Parameter units and tolerance semantics are unverified. Original and returned simplified responses are retained in the local backup.':'No simplification was requested. The returned geometry is used as supplied after validation.']};
}
export class RegionStore{
 constructor(workspace,jobs,{fetchImpl=fetch,token=()=>''}={}){this.workspace=workspace;this.jobs=jobs;this.fetchImpl=fetchImpl;this.token=token;this.busy=false;this.importing=new Set();}
 async request(path,token,limit=16*1024*1024){
  const response=await this.fetchImpl(BASE+path,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`GFW region request returned HTTP ${response.status}. No saved boundary was replaced.`);
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('Region response exceeds the client size limit.');chunks.push(Buffer.from(chunk));}
  const raw=Buffer.concat(chunks).toString('utf8');if(raw.includes(token))throw Error('Unexpected credential material in region response.');
  const dataset=path.split('/')[0],reported=response.headers.get('x-datasets');if(reported&&reported!==dataset)throw Error('Region dataset response does not match the request.');
  return {raw,reported};
 }
 async exclusive(fn){if(this.busy)throw Error('Another region retrieval is running. Wait for it to finish.');const token=this.token();if(!token)throw Error('Connect your personal GFW token to retrieve region data.');this.busy=true;try{return await fn(token);}finally{this.busy=false;}}
 async read(name){const record=JSON.parse(await readFile(join(this.workspace,name),'utf8'));if(record.sha256!==hash(record.data))throw Error('Saved region integrity check failed.');return record.data;}
 async write(name,data){await this.jobs.atomic(name,{data,sha256:hash(data)});}
 async refresh(kind){regionIdentity(kind,'catalogue');return this.exclusive(async token=>{
  const dataset=REGIONS[kind].dataset,metadata=await this.request(dataset,token,2*1024*1024),list=await this.request(dataset+'/context-layers',token,8*1024*1024);
  const meta=JSON.parse(metadata.raw);if(meta.id!==dataset)throw Error('Region metadata identity mismatch.');parseCatalogue(JSON.parse(list.raw));
  const data={kind,dataset,retrievedAt:new Date().toISOString(),metadata:meta,rawMetadata:metadata.raw,raw:list.raw,reported:list.reported};await this.write(`region-catalogue-${kind}.json`,data);return {kind,retrievedAt:data.retrievedAt};
 });}
 async catalogue(kind,{search='',offset=0}={}){
  regionIdentity(kind,'catalogue');if(typeof search!=='string'||search.length>200||!Number.isInteger(Number(offset))||Number(offset)<0)throw Error('Invalid region search.');
  let saved;try{saved=await this.read(`region-catalogue-${kind}.json`);}catch(error){if(error.code==='ENOENT')return {kind,loaded:false,entries:[],total:0};throw error;}
  const all=parseCatalogue(JSON.parse(saved.raw)),needle=search.trim().toLocaleLowerCase();
  const entries=all.filter(row=>[row.label,row.id,row.iso3,row.isoSov1,row.isoSov2,row.isoSov3,row.territory1].some(value=>String(value??'').toLocaleLowerCase().includes(needle)));const start=Number(offset);
  return {kind,loaded:true,retrievedAt:saved.retrievedAt,dataset:saved.dataset,total:entries.length,catalogueCount:all.length,offset:start,nextOffset:start+50<entries.length?start+50:null,entries:entries.slice(start,start+50)};
 }
 async retrieve({kind,id,simplify=0}){
  const identity=regionIdentity(kind,id);if(!SIMPLIFICATIONS.includes(simplify))throw Error('Choose a supported explicit simplification setting.');
  const catalogue=await this.read(`region-catalogue-${kind}.json`),entry=parseCatalogue(JSON.parse(catalogue.raw)).find(row=>row.id===identity.id);if(!entry)throw Error('Region identifier is not in the saved catalogue. Refresh the list first.');
  return this.exclusive(async token=>{
   const path=identity.dataset+'/context-layers/'+encodeURIComponent(identity.id),original=await this.request(path,token);feature(original.raw,identity.id);
   const selected=simplify?await this.request(path+'?simplify='+simplify,token):original;feature(selected.raw,identity.id);
   const data={schemaVersion:1,id:randomUUID(),kind,regionId:identity.id,label:entry.label,entry,metadata:catalogue.metadata,rawMetadata:catalogue.rawMetadata,catalogueRetrievedAt:catalogue.retrievedAt,retrievedAt:new Date().toISOString(),simplify,rawOriginal:original.raw,rawSelected:simplify?selected.raw:null,reported:original.reported};
   const display=regionPresentation(verifyRegionSnapshot(data));await this.write(`region-${data.id}.json`,data);return display;
  });
 }
 async snapshot(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid region snapshot identifier.');const data=verifyRegionSnapshot(await this.read(`region-${id}.json`));if(data.id!==id)throw Error('Region snapshot identity mismatch.');return data;}
 async importBackup(bundle){
  if(bundle?.sha256!==hash(bundle?.snapshot))throw Error('Region backup checksum mismatch.');const data=verifyRegionSnapshot(bundle.snapshot);
  if(this.importing.has(data.id))throw Error('This region backup is already being imported.');this.importing.add(data.id);
  try{
   try{const existing=await this.snapshot(data.id);if(hash(existing)!==bundle.sha256)throw Error('A different region snapshot already uses this identifier.');return regionPresentation(existing);}catch(error){if(error.code!=='ENOENT')throw error;}
   await this.write(`region-${data.id}.json`,data);return regionPresentation(data);
  }finally{this.importing.delete(data.id);}
 }
 async list(){const snapshots=[];for(const name of await readdir(this.workspace))if(/^region-[a-f0-9-]{36}\.json$/.test(name)){try{const data=await this.read(name);snapshots.push({id:data.id,kind:data.kind,label:data.label,regionId:data.regionId,simplify:data.simplify,retrievedAt:data.retrievedAt});}catch{this.jobs.diagnostics.push({file:name,error:'Region snapshot failed integrity validation.'});}}return snapshots.sort((a,b)=>b.retrievedAt.localeCompare(a.retrievedAt));}
}
