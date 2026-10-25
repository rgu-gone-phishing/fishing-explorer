import {randomUUID} from 'node:crypto';
import {validate,hash,SOURCES} from './domain.mjs';
import {reportRequest} from './gfw.mjs';
const BASE='https://gateway.api.globalfishingwatch.org/v3';
export function previewQuery(input,{interval='DAY'}={}){
 const q=validate({...input,bounds:[-180,-85,180,85],geometry:undefined,boundarySource:undefined,grid:0.1,grouping:SOURCES[input?.source]?.groupings[0],interval:'DAILY'},{maxDays:20*366});if(q.source==='synthetic-activity')throw Error('Choose a GFW source for a live preview. Synthetic data stays offline.');
 if(!['HOUR','DAY','MONTH','YEAR'].includes(interval))throw Error('Choose a supported preview time interval.');
 const days=(Date.parse(q.end)-Date.parse(q.start))/86400000;
 if(interval==='HOUR'&&days>20)throw Error('Hourly previews are limited to 20 days. Shorten the dates or explicitly choose a coarser preview interval.');
 if(interval==='DAY'&&days>365)throw Error('Daily previews are limited to 365 days. Choose monthly/yearly preview intervals for longer periods.');
 // Keep preview semantics independent of extraction grid, grouping and geometry.
 return {source:q.source,datasetVersion:q.datasetVersion,start:q.start,end:q.end,flags:q.flags,gears:q.gears,...(q.vesselTypes?{vesselTypes:q.vesselTypes}:{}),...(q.matched?{matched:q.matched}:{}),...(q.distanceFromPortKm!==undefined?{distanceFromPortKm:q.distanceFromPortKm}:{}),interval};
}
export function previewParameters(query){
 const params=new URLSearchParams({'datasets[0]':`${SOURCES[query.source].dataset}:${query.datasetVersion}`,'date-range':`${query.start},${query.end}`,interval:query.interval});
 const report=new URL(reportRequest({...query,grid:0.1,grouping:'NONE',bounds:[-1,-1,1,1]}).url);const filters=report.searchParams.get('filters[0]');if(filters)params.set('filters[0]',filters);
 return params;
}
async function bounded(response,limit){const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('Preview response exceeds the client size limit.');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
const versionCheck=(response,query)=>{const actual=response.headers.get('x-datasets');if(actual&&actual!==`${SOURCES[query.source].dataset}:${query.datasetVersion}`)throw Error('Preview response version differs from the requested dataset.');return actual;};
export async function generatePreviewStyle(query,token,{fetchImpl=fetch,signal}={}){
 if(!token)throw Error('Connect your personal GFW token before starting a live preview.');
 const params=previewParameters(query);params.set('color','#b24d16');
 const response=await fetchImpl(`${BASE}/4wings/generate-png?${params}`,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:signal||AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`GFW preview style returned HTTP ${response.status}. Check access, quota and supported dates/intervals.`);
 const responseVersion=versionCheck(response,query);const raw=(await bounded(response,2*1024*1024)).toString('utf8');if(raw.includes(token))throw Error('Unexpected credential material in style response.');
 let data;try{data=JSON.parse(raw);}catch{throw Error('Invalid preview style response.');}
 let url;try{url=new URL(data.url);}catch{throw Error('Preview style URL is missing or invalid.');}
 const path=decodeURIComponent(url.pathname);
 // The provider may advertise another tile authority. Never follow it: extract only
 // style data and construct every network destination from the fixed HTTPS BASE.
 if(path!=='/v3/4wings/tile/heatmap/{z}/{x}/{y}'||url.username||url.password)throw Error('Unsupported preview style URL shape.');
 if(url.searchParams.get('datasets[0]')!==params.get('datasets[0]'))throw Error('Preview style dataset does not match the request.');
 const style=url.searchParams.get('style');if(!style||style.length>100000||!/^[a-zA-Z0-9+/_=-]+$/.test(style))throw Error('Unsupported preview style identifier.');
 const thresholds={};for(let z=0;z<=12;z++){const steps=data.colorRamp?.stepsByZoom?.[z];if(Array.isArray(steps))thresholds[z]=[...new Set(steps.map(s=>s.value).filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))].sort((a,b)=>a-b);}
 return {style,thresholds,responseVersion,raw};
}
export function tileRequest(query,style,z,x,y){
 if(![z,x,y].every(Number.isInteger)||z<0||z>12||x<0||y<0||x>=2**z||y>=2**z)throw Error('Invalid preview tile coordinates.');
 const params=previewParameters(query);params.set('style',style);params.set('format','PNG');params.set('temporal-aggregation','true');
 return `${BASE}/4wings/tile/heatmap/${z}/${x}/${y}?${params}`;
}
export function pngDimensions(bytes){
 if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw Error('Provider did not return a valid PNG tile header.');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>2048||height>2048)throw Error('Unsupported PNG tile dimensions.');return {width,height};
}
export class PreviewStore{
 constructor({fetchImpl=fetch,context=()=>({token:'',revision:0}),maxBytes=64*1024*1024,now=()=>Date.now()}={}){this.fetchImpl=fetchImpl;this.context=context;this.maxBytes=maxBytes;this.now=now;this.sessions=new Map();this.styles=new Map();this.styleControllers=new Set();this.generation=0;this.cache=new Map();this.pending=new Map();this.bytes=0;this.active=0;this.waiters=[];}
 async slot(fn){if(this.active>=4)await new Promise(resolve=>this.waiters.push(resolve));else this.active++;try{return await fn();}finally{if(this.waiters.length)this.waiters.shift()();else this.active--;}}
 get(id){const s=this.sessions.get(id),c=this.context();if(!s||s.closed||s.owner!==c.revision||!c.token||this.now()-s.createdAt>30*60000)throw Error('Preview session expired or credentials changed. Start a new preview.');return s;}
 async create(input,options){
 const query=previewQuery(input,options),context=this.context();if(!context.token)throw Error('Connect your personal GFW token first.');
 const key=hash(query),generation=this.generation,cached=this.styles.get(key);let result;
 if(cached&&cached.owner===context.revision&&this.now()-cached.time<30*60000)result=cached.result;
 else{
  const preparing=new AbortController();this.styleControllers.add(preparing);
  try{result=await this.slot(async()=>{if(this.context().revision!==context.revision||generation!==this.generation)throw Error('Preview preparation cancelled.');return generatePreviewStyle(query,context.token,{fetchImpl:this.fetchImpl,signal:AbortSignal.any([preparing.signal,AbortSignal.timeout(30000)])});});}
  finally{this.styleControllers.delete(preparing);}
  if(this.context().revision!==context.revision||generation!==this.generation)throw Error('Preview preparation cancelled.');
  this.styles.set(key,{owner:context.revision,time:this.now(),result});while(this.styles.size>5)this.styles.delete(this.styles.keys().next().value);
 }
 if(this.context().revision!==context.revision||generation!==this.generation)throw Error('Credentials or preview state changed while preparing. Start again.');
 const controller=new AbortController();const s={id:randomUUID(),key,query,owner:context.revision,createdAt:this.now(),...result,controller,errors:0,tilesFetched:0};this.sessions.set(s.id,s);
 while(this.sessions.size>5)this.close(this.sessions.keys().next().value);
 return this.public(s);
 }
 public(s){return {id:s.id,query:s.query,createdAt:new Date(s.createdAt).toISOString(),responseVersion:s.responseVersion,thresholds:s.thresholds,units:SOURCES[s.query.source].metric,errors:s.errors,tilesFetched:s.tilesFetched,lastError:s.lastError,tileTemplate:`/api/previews/${s.id}/tiles/{z}/{x}/{y}`,notes:[...(s.query.distanceFromPortKm!==undefined?[`Provider minimum distance from ports/anchorages: ${s.query.distanceFromPortKm} km. This is a source filter, not local clipping or confidence.`]:[]),'Display tiles are not clipped to the analysis polygon.','Spatial detail is zoom-dependent, not the saved report grid or positional accuracy.','Adaptive provider scales are not directly comparable across independent previews.','PNG images are not quantitative extracts; use saved reports for numerical analysis.','Preview time bins may aggregate boundary periods; use reports to confirm exact date bounds.']};}
 async tile(id,z,x,y){
 const s=this.get(id);tileRequest(s.query,s.style,z,x,y);const key=`${id}:${z}:${x}:${y}`,cached=this.cache.get(key);
 if(cached&&this.now()-cached.time<60000){this.cache.delete(key);this.cache.set(key,cached);return cached.bytes;}
 if(cached){this.bytes-=cached.bytes.length;this.cache.delete(key);}
 if(this.pending.has(key))return this.pending.get(key);
 const work=this.slot(async()=>{
  this.get(id);const c=this.context();let response;
  try{response=await this.fetchImpl(tileRequest(s.query,s.style,z,x,y),{redirect:'error',headers:{Authorization:`Bearer ${c.token}`,Accept:'image/png'},signal:AbortSignal.any([s.controller.signal,AbortSignal.timeout(30000)])});if(!response.ok)throw Error(`GFW tile returned HTTP ${response.status}. Missing tiles are unavailable, not zero activity.`);versionCheck(response,s.query);const bytes=await bounded(response,2*1024*1024);pngDimensions(bytes);this.get(id);
   this.cache.set(key,{bytes,time:this.now()});this.bytes+=bytes.length;s.tilesFetched++;
   while(this.bytes>this.maxBytes&&this.cache.size){const oldest=this.cache.keys().next().value;this.bytes-=this.cache.get(oldest).bytes.length;this.cache.delete(oldest);}return bytes;
  }catch(error){s.errors++;s.lastError=String(error.message).replaceAll(c.token,'[redacted]').slice(0,400);throw error;}
 });this.pending.set(key,work);try{return await work;}finally{this.pending.delete(key);}
 }
 close(id){const s=this.sessions.get(id);if(s){s.closed=true;s.controller.abort();this.sessions.delete(id);}for(const [key,c] of this.cache)if(key.startsWith(id+':')){this.bytes-=c.bytes.length;this.cache.delete(key);}}
 closeAll(){this.generation++;for(const controller of this.styleControllers)controller.abort();this.styles.clear();for(const id of this.sessions.keys())this.close(id);}
}
