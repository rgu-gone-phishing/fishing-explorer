import {eventStatsQuery,eventStatsBody,validateStatsResponse,EVENT_STATS_CAVEAT} from '../shared/event-stats.mjs';
import {areaEventQuery,areaEventBody,AREA_EVENT_CAVEAT} from '../shared/area-events.mjs';
import {searchFilters,searchIncludes,advancedWhere,SEARCH_CAVEAT} from '../shared/vessel-search.mjs';
import {INSIGHT_TYPES,INSIGHT_CAVEAT,validateInsightResponse} from '../shared/insights.mjs';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {EVENT_TYPES,list} from '../shared/explorer.mjs';
import {hash} from './domain.mjs';
const BASE='https://gateway.api.globalfishingwatch.org/v3';
const idPattern=/^[a-zA-Z0-9-]{6,100}$/;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function explorerQuery(input){
 if(!input||!['search','detail','events','insights','event-detail','area-events','event-stats'].includes(input.kind))throw Error('Unsupported vessel exploration operation.');
 if(!['v4.0','v5.0'].includes(input.version))throw Error('Choose a pinned dataset version.');
 if(input.kind==='search'){
  if(input.mode==='advanced'){if(Object.keys(input).some(k=>!['kind','mode','version','filters','includes','limit'].includes(k))||input.limit!==undefined&&input.limit!==30)throw Error('Unsupported advanced search option or page size.');return {kind:'search',mode:'advanced',version:input.version,filters:searchFilters(input.filters),includes:searchIncludes(input.includes),limit:30};}
  if(input.mode!==undefined&&input.mode!=='basic'||input.filters&&Object.keys(input.filters).length)throw Error('Choose basic or advanced search explicitly.');
  if(typeof input.term!=='string'||input.term.trim().length<3||input.term.length>100||/[\x00-\x1f]/.test(input.term))throw Error('Search needs 3–100 printable characters.');
  return {kind:'search',version:input.version,term:input.term.trim(),limit:30};
 }
 if(['area-events','event-stats'].includes(input.kind)){const q=input.kind==='event-stats'?eventStatsQuery(input):areaEventQuery(input);if(q.boundarySource&&q.boundarySource.geometrySha256!==hash(q.geometry))throw Error('Named-boundary geometry changed.');return q;}
 if(typeof input.vesselId!=='string'||!idPattern.test(input.vesselId))throw Error('Choose a valid GFW vessel ID.');
 if(input.kind==='detail')return {kind:'detail',version:input.version,vesselId:input.vesselId};
 if(input.kind==='insights'){
  if(!validDate(input.start)||!validDate(input.end)||input.start<'2017-01-01'||input.end<=input.start||Date.parse(input.end)>Date.now())throw Error('Choose insight dates from 2017 to today.');
  if(!Array.isArray(input.includes)||!input.includes.length||input.includes.length>6||input.includes.some(type=>!Object.hasOwn(INSIGHT_TYPES,type)))throw Error('Select supported insight categories.');
  return {kind:'insights',version:input.version,vesselId:input.vesselId,start:input.start,end:input.end,includes:[...new Set(input.includes)].sort(),endSemantics:'provider-defined'};
 }
 if(input.kind==='event-detail'){if(!Object.hasOwn(EVENT_TYPES,input.eventType)||typeof input.eventId!=='string'||!/^[a-zA-Z0-9-]{6,128}$/.test(input.eventId))throw Error('Choose a supported event reference.');return {kind:'event-detail',version:input.version,vesselId:input.vesselId,eventType:input.eventType,eventId:input.eventId};}
 if(!Object.hasOwn(EVENT_TYPES,input.eventType))throw Error('Choose a supported event type.');
 if(!validDate(input.start)||!validDate(input.end)||input.start<'2012-01-01'||input.end<=input.start||Date.parse(input.end)>Date.now())throw Error('Use valid UTC dates from 2012 through today, with an exclusive end.');
 const confidence=input.confidence||'all';if(!['all','2','3','4'].includes(confidence)||input.eventType!=='port_visits'&&confidence!=='all')throw Error('Confidence filters apply only to port visits.');
 return {kind:'events',version:input.version,vesselId:input.vesselId,eventType:input.eventType,start:input.start,end:input.end,confidence,limit:50,timeFilterMode:'OVERLAP'};
}
export function explorerRequest(query,cursor=null){
 const dataset=['events','event-detail','area-events','event-stats'].includes(query.kind)?`${EVENT_TYPES[query.eventType].dataset}:${query.version}`:`public-global-vessel-identity:${query.version}`;
 if(query.kind==='event-stats')return {url:BASE+'/events/stats',dataset,method:'POST',body:eventStatsBody(query)};
 if(query.kind==='area-events')return {url:BASE+`/events?offset=${cursor??0}&limit=${query.limit}`,dataset,method:'POST',body:areaEventBody(query)};
 if(query.kind==='insights')return {url:BASE+'/insights/vessels',dataset,method:'POST',body:{vessels:[{datasetId:dataset,vesselId:query.vesselId}],startDate:query.start+'T00:00:00.000Z',endDate:query.end+'T00:00:00.000Z',includes:query.includes}};
 const params=new URLSearchParams();let path;
 if(query.kind==='search'){path='/vessels/search';params.set('datasets[0]',dataset);if(query.mode==='advanced'){params.set('where',advancedWhere(query.filters));query.includes.forEach((value,index)=>params.set(`includes[${index}]`,value));}else params.set('query',query.term);params.set('limit',query.limit);if(cursor!==null)params.set('since',cursor);}
 else if(query.kind==='event-detail'){path=`/events/${encodeURIComponent(query.eventId)}`;params.set('dataset',dataset);}
 else if(query.kind==='detail'){path=`/vessels/${encodeURIComponent(query.vesselId)}`;params.set('dataset',dataset);params.set('registries-info-data','ALL');}
 else{path='/events';params.set('datasets[0]',dataset);params.set('vessels[0]',query.vesselId);params.set('start-date',query.start);params.set('end-date',query.end);params.set('time-filter-mode','OVERLAP');params.set('offset',cursor??0);params.set('limit',query.limit);if(query.confidence!=='all')params.set('confidences[0]',query.confidence);}
 return {url:`${BASE}${path}?${params}`,dataset};
}
export function archivedExplorerRequest(query,cursor=null){const request=explorerRequest(query,cursor);if(!['area-events','event-stats'].includes(query.kind))return request;const {geometry,...bodyWithoutGeometry}=request.body;return {url:request.url,dataset:request.dataset,method:request.method,bodyWithoutGeometry,bodySha256:hash(request.body),geometryReference:'query.geometry',geometrySha256:hash(geometry)};}
export async function fetchExplorerPage(query,cursor,token,{fetchImpl=fetch}={}){
 if(!token)throw Error('Connect your personal GFW token in Data & methods.');
 const request=explorerRequest(query,cursor);let response;
 try{response=await fetchImpl(request.url,{method:request.method||'GET',...(request.body?{body:JSON.stringify(request.body)}:{}),headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(request.body?{'Content-Type':'application/json'}:{})},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('GFW lookup could not complete. Retained pages are unchanged; retry this page explicitly.');}
 if(response.status===422||response.status===403){let detail='Invalid parameters.';try{const data=await response.json();detail=(data.messages||[]).map(m=>`${m.title||''}: ${m.detail||''}`).join('; ').replaceAll(token,'[redacted]').slice(0,700);}catch{}throw Error(`GFW ${response.status===403?'access denied':'parameter validation'}: ${detail}`);}
 if(!response.ok)throw Error(`GFW lookup returned HTTP ${response.status}. ${response.status===401?'Reconnect your token.':response.status===403?'Check account permissions or network policy.':response.status===429?'Wait for quota/rate availability before retrying.':'Review the query or try again later.'}`);
 const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>8*1024*1024)throw Error('This lookup page exceeds the 8 MiB client limit. Narrow the query.');chunks.push(Buffer.from(chunk));}
 const raw=Buffer.concat(chunks).toString('utf8'),headerVersion=response.headers.get('x-datasets')||null;if(raw.includes(token)||headerVersion?.includes(token))throw Error('Unexpected credential material in provider response; nothing was saved.');
 if(headerVersion&&headerVersion.length>4096)throw Error('Unsupported dataset-version header.');const parsed=parseExplorerPayload(raw,query,headerVersion,cursor);return {request,raw,...parsed,retrievedAt:new Date().toISOString()};
}
function validateAreaEcho(data,query,request,cursor){
  if(query.kind==='area-events'&&data.offset!==undefined&&data.offset!==(cursor??0))throw Error('Area-event response offset differs from the requested page.');
  const meta=data.metadata;if(meta?.timeFilterMode!==undefined&&meta.timeFilterMode!==query.timeFilterMode)throw Error('Area response time-matching mode differs from the query.');if(meta?.datasets&&(!Array.isArray(meta.datasets)||meta.datasets.length!==1||meta.datasets[0]!==request.dataset))throw Error('Area-event response dataset differs from the query.');
  if(meta?.dateRange)for(const [key,wanted] of [['from',query.start],['to',query.end]])if(meta.dateRange[key]!==undefined&&meta.dateRange[key]!==wanted)throw Error('Area-event response dates differ from the query.');
  for(const [reported,requested] of [['flags','flags'],['vesselTypes','vesselTypes'],['portVisitConfidences','confidences']])if(meta?.[reported]!==undefined&&(!Array.isArray(meta[reported])||hash([...meta[reported]].sort())!==hash(query[requested])))throw Error('Area-event response filters differ from the query.');
  const g=meta?.geometry;if(g!==undefined&&g!==null){const parts=shape=>shape?.type==='Polygon'?[shape.coordinates]:shape?.type==='MultiPolygon'?shape.coordinates:null;const echoed=g.type==='FeatureCollection'&&Array.isArray(g.features)&&g.features.every(f=>f?.type==='Feature'&&parts(f.geometry))?g.features.flatMap(f=>parts(f.geometry)):g.type==='Feature'?parts(g.geometry):parts(g);if(!echoed||hash(echoed)!==hash(parts(query.geometry)))throw Error('Provider echoed a different boundary; no coordinate substitution was accepted.');}
}
export function parseExplorerPayload(raw,query,version=null,cursor=null){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>8*1024*1024)throw Error('Invalid or oversized lookup page.');const request=explorerRequest(query);
 let data;try{data=JSON.parse(raw);}catch{throw Error('Unexpected lookup response format.');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Unexpected lookup response schema.');
 if(query.kind!=='insights'&&version&&version!==request.dataset)throw Error('Lookup response dataset/version differs from the request.');
 if(query.kind==='event-stats'){validateStatsResponse(data);validateAreaEcho(data,query,request,cursor);return {entries:[data],total:null,next:null,responseVersion:version};}
 if(query.kind==='insights'){validateInsightResponse(data,query);return {entries:[data],total:null,next:null,responseVersion:version};}
 const entries=['detail','event-detail'].includes(query.kind)?[data]:data.entries;
 if(!Array.isArray(entries)||entries.some(e=>!e||typeof e!=='object'||Array.isArray(e)))throw Error('Unexpected lookup record schema.');
 if(['events','event-detail','area-events'].includes(query.kind)&&entries.some(e=>typeof e.id!=='string'||!e.id||typeof e.start!=='string'||!Number.isFinite(Date.parse(e.start))))throw Error('An event is missing its identity or start time.');
 if(query.kind==='search'&&query.mode==='advanced'&&entries.some(e=>e.dataset!==undefined&&e.dataset!==request.dataset))throw Error('Search record dataset/version differs from the request.');
 if(['search','detail'].includes(query.kind)&&entries.some(e=>!e.selfReportedInfo&&!e.registryInfo))throw Error('Vessel response lacks identity records.');
 if(['search','detail'].includes(query.kind)&&entries.some(e=>[...list(e.selfReportedInfo),...list(e.registryInfo)].some(r=>!r||typeof r!=='object'||Array.isArray(r))))throw Error('Malformed vessel identity history.');
 if(query.kind==='event-detail'&&(data.id!==query.eventId||data.type!==({fishing:'fishing',encounters:'encounter',loitering:'loitering',port_visits:'port_visit',gaps:'gap'})[query.eventType]||data.vessel?.id&&data.vessel.id!==query.vesselId))throw Error('Event response does not match the requested event or vessel.');
 if(query.kind==='area-events'){validateAreaEcho(data,query,request,cursor);if(query.timeFilterMode==='START-DATE'&&entries.some(e=>Date.parse(e.start)<Date.parse(query.start)||Date.parse(e.start)>=Date.parse(query.end)))throw Error('An event start lies outside the requested start-date window.');}
 const total=Number.isInteger(data.total)&&data.total>=0?data.total:null;
 let next=null;
 if(query.kind==='search'&&typeof data.since==='string'&&data.since){if(data.since.length>4096)throw Error('Search cursor is too long.');next=data.since;}
 if(['events','area-events'].includes(query.kind)&&Number.isInteger(data.nextOffset)&&data.nextOffset>0&&(total===null||data.nextOffset<total))next=data.nextOffset;
 return {entries,total,next,responseVersion:version};
}
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));
export function verifyExplorerSnapshot(s){
 const fields=['schemaVersion','id','query','createdAt','status','complete','nextCursor','pages','entries','total','duplicatesRemoved','caveats','attribution','license','updatedAt','error','warnings','continuedFrom'];
 if(!s||s.schemaVersion!==1||!uuid(s.id)||Object.keys(s).some(k=>!fields.includes(k))||!timestamp(s.createdAt)||s.updatedAt!==undefined&&!timestamp(s.updatedAt)||!['partial','loading','complete'].includes(s.status)||typeof s.complete!=='boolean'||s.complete!==(s.status==='complete')||!Array.isArray(s.pages)||s.pages.length>100||!Array.isArray(s.entries))throw Error('Invalid lookup snapshot schema.');
 const query=explorerQuery(s.query);if(hash(query)!==hash(s.query))throw Error('Lookup query requires an explicit schema migration.');
 for(const field of ['caveats','attribution','license'])if(typeof s[field]!=='string'||s[field].length>10000)throw Error('Invalid lookup provenance.');
 if(s.error!==undefined&&(typeof s.error!=='string'||s.error.length>10000)||s.warnings!==undefined&&(!Array.isArray(s.warnings)||s.warnings.length>100||s.warnings.some(w=>typeof w!=='string'||w.length>10000)))throw Error('Invalid lookup diagnostics.');
 if(s.continuedFrom&&(!uuid(s.continuedFrom.id)||!/^[a-f0-9]{64}$/.test(s.continuedFrom.sha256)||!timestamp(s.continuedFrom.createdAt)))throw Error('Invalid lookup continuation provenance.');
 let cursor=null,total=null,duplicates=0,bytes=0;const entries=[],seen=new Set(),pageHashes=new Set(),cursors=new Set();
 for(const page of s.pages){
  if(!page||Object.keys(page).some(k=>!['cursor','request','raw','sha256','entriesHash','responseVersion','retrievedAt'].includes(k))||!Object.hasOwn(page,'responseVersion')||page.responseVersion!==null&&(typeof page.responseVersion!=='string'||!page.responseVersion||page.responseVersion.length>4096))throw Error('Invalid lookup page provenance.');
  if(cursor===null&&pageHashes.size)throw Error('Lookup contains pages after pagination ended.');
  if(page.cursor!==cursor||hash(page.request)!==hash(archivedExplorerRequest(query,cursor))||!timestamp(page.retrievedAt)||page.sha256!==hash(page.raw))throw Error('Lookup page query, cursor or checksum mismatch.');
  bytes+=Buffer.byteLength(page.raw);if(bytes>32*1024*1024)throw Error('Lookup exceeds the 32 MiB raw-page limit.');
  const parsed=parseExplorerPayload(page.raw,query,page.responseVersion,page.cursor),pageHash=hash(parsed.entries);
  if(page.entriesHash!==pageHash||parsed.entries.length&&pageHashes.has(pageHash))throw Error('Lookup page contents or pagination are inconsistent.');
  if(parsed.next!==null&&(parsed.next===cursor||cursors.has(parsed.next)||['events','area-events'].includes(query.kind)&&parsed.next<=Number(cursor??0)))throw Error('Lookup pagination does not advance.');
  pageHashes.add(pageHash);cursors.add(cursor);
  for(const entry of parsed.entries){const key=['events','area-events'].includes(query.kind)?entry.id:hash(entry);if(seen.has(key)){duplicates++;continue;}seen.add(key);entries.push(entry);}
  if(total===null)total=parsed.total;cursor=parsed.next;
 }
 if(hash(s.entries)!==hash(entries)||s.duplicatesRemoved!==duplicates||s.total!==total||s.nextCursor!==cursor)throw Error('Lookup rows or pagination summary disagree with the raw pages.');
 const canBeComplete=s.pages.length>0&&cursor===null&&(total===null||entries.length>=total);
 if(s.complete&&!canBeComplete)throw Error('Partial lookup cannot be declared complete.');
 if(['detail','event-detail','insights','event-stats'].includes(query.kind)&&s.pages.length>1)throw Error('Single-response lookup has more than one response.');return s;
}
export class ExplorerStore{
 constructor(workspace,jobs,{fetchImpl=fetch,token=()=>''}={}){this.workspace=workspace;this.jobs=jobs;this.fetchImpl=fetchImpl;this.token=token;this.records=[];this.locks=new Set();}
 summary(s,origin='retrieved',localId=s.id){return {id:localId,originalId:s.id,query:s.query,createdAt:s.createdAt,updatedAt:s.updatedAt,status:s.status,complete:s.complete,loaded:s.entries.length,total:s.total,error:s.error,imported:origin==='imported'};}
 async persist(snapshot,origin='retrieved',localId=snapshot.id){await this.jobs.atomic(`explore-${localId}.json`,{snapshot,sha256:hash(snapshot),origin,localId});const summary=this.summary(snapshot,origin,localId),index=this.records.findIndex(s=>s.id===localId);if(index>=0)this.records[index]=summary;else this.records.push(summary);}
 async load(){for(const file of await readdir(this.workspace))if(/^explore-[a-f0-9-]{36}\.json$/.test(file))try{
  const record=await this.read(file.slice(8,-5)),s=record.snapshot;if(s.status==='loading'){s.status='partial';s.error='Interrupted lookup. Loaded pages remain available; retry the next page explicitly.';await this.persist(s,record.origin,record.localId);}if(!this.records.some(r=>r.id===record.localId))this.records.push(this.summary(s,record.origin,record.localId));
 }catch{this.jobs.diagnostics.push({file,error:'Vessel/event snapshot failed validation.'});}}
 list(){return this.records.slice().sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));}
 async read(id){if(!uuid(id))throw Error('Invalid lookup snapshot ID.');const record=JSON.parse(await readFile(join(this.workspace,`explore-${id}.json`),'utf8'));if(record.sha256!==hash(record.snapshot)||(record.localId||record.snapshot.id)!==id||record.origin!==undefined&&!['retrieved','imported'].includes(record.origin))throw Error('Lookup snapshot integrity check failed.');verifyExplorerSnapshot(record.snapshot);if(record.origin==='imported'&&record.snapshot.status==='loading')throw Error('Imported lookup cannot have an active retrieval.');return {...record,origin:record.origin||'retrieved',localId:record.localId||record.snapshot.id};}
 async get(id){return (await this.read(id)).snapshot;}
 async display(id){const record=await this.read(id);return {...record.snapshot,id:record.localId,originalId:record.snapshot.id,localImport:record.origin==='imported'};}
 async importBackup(bundle){
  if(bundle?.sha256!==hash(bundle?.snapshot))throw Error('Lookup backup checksum mismatch.');const s=verifyExplorerSnapshot(bundle.snapshot);if(s.status==='loading')throw Error('Wait for the source lookup to settle before importing its export.');if(this.token()&&JSON.stringify(s).includes(this.token()))throw Error('Unexpected configured credential material in lookup backup.');
  if(this.locks.has(s.id))throw Error('This lookup already has an operation in progress.');this.locks.add(s.id);
  try{for(const candidate of this.records.filter(r=>r.originalId===s.id||r.id===s.id)){try{const existing=await this.read(candidate.id);if(hash(existing.snapshot)===bundle.sha256)return this.display(candidate.id);}catch{}}let localId=s.id;try{await readFile(join(this.workspace,`explore-${localId}.json`));localId=randomUUID();}catch(error){if(error.code!=='ENOENT')throw error;}await this.persist(s,'imported',localId);return this.display(localId);}finally{this.locks.delete(s.id);}
 }
 async copyForContinuation(id){
  if(this.locks.has(id))throw Error('This lookup already has an operation in progress.');this.locks.add(id);
  try{const original=await this.get(id);if(original.complete||original.status==='loading'||original.pages.length>=100||original.pages.length&&original.nextCursor===null)throw Error('This snapshot has no pending pagination cursor. Start a new lookup instead.');
   const child={...structuredClone(original),id:randomUUID(),createdAt:new Date().toISOString(),status:'partial',continuedFrom:{id:original.id,sha256:hash(original),createdAt:new Date().toISOString()}};delete child.error;delete child.updatedAt;await this.persist(child);return child;
  }finally{this.locks.delete(id);}
 }
 async create(input){const query=explorerQuery(input);const s={schemaVersion:1,id:randomUUID(),query,createdAt:new Date().toISOString(),status:'partial',complete:false,nextCursor:null,pages:[],entries:[],total:null,duplicatesRemoved:0,caveats:query.kind==='event-stats'?EVENT_TYPES[query.eventType].caveat+' '+AREA_EVENT_CAVEAT+' '+EVENT_STATS_CAVEAT:query.kind==='area-events'?EVENT_TYPES[query.eventType].caveat+' '+AREA_EVENT_CAVEAT:query.kind==='search'&&query.mode==='advanced'?SEARCH_CAVEAT:query.kind==='insights'?INSIGHT_CAVEAT:['events','event-detail','area-events'].includes(query.kind)?EVENT_TYPES[query.eventType].caveat:'AIS self-reported identity, registry records and model-derived classifications are different evidence sources. Vessel identifiers can change over time.',attribution:'Powered by Global Fishing Watch: https://globalfishingwatch.org',license:'https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits'};await this.persist(s);return this.next(s.id);}
 async next(id){
  if(this.locks.has(id))throw Error('This lookup already has a page in flight.');this.locks.add(id);let s;try{s=await this.get(id);}catch(error){this.locks.delete(id);throw error;}if(s.complete){this.locks.delete(id);return s;}
  if(this.records.find(r=>r.id===id)?.imported){this.locks.delete(id);throw Error('Imported snapshots are immutable. Copy for continued retrieval first.');}
  if(s.pages.length&&s.nextCursor===null){this.locks.delete(id);throw Error('Provider pagination ended before this snapshot was complete. Start a new lookup rather than fetching the first page again.');}
  if(s.pages.length>=100){this.locks.delete(id);throw Error('Reached the 100-page client limit. Narrow the query; this snapshot remains partial.');}
  this.locks.add(id);
  try{
   s.status='loading';delete s.error;await this.persist(s);
   const cursor=s.nextCursor;const page=await fetchExplorerPage(s.query,cursor,this.token(),{fetchImpl:this.fetchImpl});
   const checksum=hash(page.entries);if(page.entries.length&&s.pages.some(p=>p.entriesHash===checksum))throw Error('Provider repeated a page. Pagination stopped; this snapshot remains partial.');
   if(page.next!==null&&(page.next===cursor||s.pages.some(p=>p.cursor===page.next)))throw Error('Provider repeated a cursor. Pagination stopped; this snapshot remains partial.');
   if(['events','area-events'].includes(s.query.kind)&&page.next!==null&&page.next<=Number(cursor??0))throw Error('Event pagination did not advance.');
   if(s.pages.reduce((sum,p)=>sum+Buffer.byteLength(p.raw),0)+Buffer.byteLength(page.raw)>32*1024*1024)throw Error('Snapshot reached the 32 MiB raw-data limit. Narrow the query; loaded pages remain partial.');
   const key=e=>['events','area-events'].includes(s.query.kind)?e.id:hash(e);const seen=new Set(s.entries.map(key));
   for(const entry of page.entries){const k=key(entry);if(seen.has(k)){s.duplicatesRemoved++;continue;}seen.add(k);s.entries.push(entry);}
   s.pages.push({cursor,request:archivedExplorerRequest(s.query,cursor),raw:page.raw,sha256:hash(page.raw),entriesHash:checksum,responseVersion:page.responseVersion,retrievedAt:page.retrievedAt});
   s.nextCursor=page.next;if(s.total===null)s.total=page.total;else if(page.total!==null&&page.total!==s.total){s.warnings||=[];const warning='Provider total changed during pagination; pages may reflect evolving upstream data.';if(!s.warnings.includes(warning))s.warnings.push(warning);}s.complete=page.next===null;s.status=s.complete?'complete':'partial';s.updatedAt=new Date().toISOString();
   if(s.complete&&s.total!==null&&s.entries.length<s.total){s.complete=false;s.status='partial';s.error='Pagination ended before the provider-reported total was loaded. This snapshot remains partial.';}
  }catch(error){s.status='partial';s.error=error.message;s.updatedAt=new Date().toISOString();}
  finally{try{await this.persist(s);}finally{this.locks.delete(id);}}
  return s;
 }
}
