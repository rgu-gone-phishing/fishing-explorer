import {describeEventFilters} from '/shared/area-events.mjs';
import {setupEventStats} from '/event-stats.js';
import {setupAreaEvents} from '/area-events.js';
import {setupVesselSearch,renderSearchEvidence} from '/vessel-search.js';
import {searchLabel} from '/shared/vessel-search.mjs';
import {setupVesselSets} from '/vessel-sets.js';
import {setupInsights} from '/insights.js';
import {EVENT_TYPES,identities,vesselLabel,list,eventPosition,confidenceLabel} from '/shared/explorer.mjs';
import {createEventMap} from '/map.js';
const $=id=>document.getElementById(id);
const text=(tag,value,parent)=>{const e=document.createElement(tag);e.textContent=value??'Not supplied';parent.append(e);return e;};
const format=value=>value===null||value===undefined||value===''?'Not supplied':typeof value==='object'?JSON.stringify(value):String(value);
export function setupExplorer({api,onError,getQuery,openBuilder}){
 let active,searchSnapshot,detailSnapshot,areaSnapshot,selected,tablePage=0,generation=0,stop=false,eventMap,fetching=false;
 async function refreshHistory(){
  const items=await api('/api/explorer');const select=$('explorer-history'),chosen=select.value;select.replaceChildren();text('option','Choose a saved lookup',select).value='';
  for(const s of items){const label=s.query.kind==='search'?searchLabel(s.query).slice(0,180):s.query.kind==='event-stats'?`Statistics: ${EVENT_TYPES[s.query.eventType].label} · ${s.query.start} → ${s.query.end} · ${s.query.timeseriesInterval}`:s.query.kind==='area-events'?`Area ${EVENT_TYPES[s.query.eventType].label}: ${s.query.start} → ${s.query.end}`:s.query.kind==='events'?`${EVENT_TYPES[s.query.eventType].label}: ${s.query.start} → ${s.query.end}`:s.query.kind==='insights'?`Insights: ${s.query.vesselId} · ${s.query.start} → ${s.query.end}`:s.query.kind==='event-detail'?`Event: ${s.query.eventId}`:`Identity: ${s.query.vesselId}`;text('option',`${s.imported?'Imported · ':''}${label} · ${s.loaded} ${s.query.kind==='event-stats'?'response(s)':'records'} · ${s.complete?'complete':'partial'} · ${(s.updatedAt||s.createdAt).slice(0,16)} · ${s.id.slice(0,8)}`,select).value=s.id;}
  select.value=chosen;
 }
 async function create(query){const serial=++generation;stop=true;fetching=true;try{const s=await api('/api/explorer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(query)});if(serial===generation){show(s);await refreshHistory();if(serial===generation)$('explorer-history').value=s.id;}}catch(e){if(serial===generation)onError(e.message);}finally{if(serial===generation){fetching=false;pageButtons();}}}
 function selectIdentity(id,version){selected={id,version};insights.select();$('event-query-panel').hidden=false;$('selected-vessel-id').textContent=`GFW AIS identity ${id} · ${version}. This is not an immutable physical-vessel identifier.`;create({kind:'detail',vesselId:id,version});}
 function renderMatches(){
  $('vessel-results').replaceChildren();for(const vessel of active.entries.slice(tablePage*20,(tablePage+1)*20)){
   const label=vesselLabel(vessel),article=document.createElement('article');text('h3',label.name,article);text('p',`Flag ${label.flag} · MMSI ${label.mmsi} · IMO ${label.imo}`,article);
   if(label.ids.length){const field=document.createElement('label');field.textContent='Historical AIS identity';const select=document.createElement('select');
    for(const id of label.ids){const r=list(vessel.selfReportedInfo).find(r=>r.id===id)||{};text('option',`${id} · ${String(r.transmissionDateFrom||'?').slice(0,10)} → ${String(r.transmissionDateTo||'?').slice(0,10)}`,select).value=id;}
    field.append(select);article.append(field);const button=text('button','Inspect selected identity →',article);button.type='button';button.addEventListener('click',()=>selectIdentity(select.value,active.query.version));const add=text('button','Add selected identity to set draft',article);add.type='button';add.addEventListener('click',()=>vesselSets.addFromLookup(active.id,select.value));
   }else text('p','No AIS identity ID supplied. Registry-only evidence is retained in the export; no event identity is inferred.',article);
   renderSearchEvidence(vessel,article,active.query.includes||[]);$('vessel-results').append(article);
  }
 }
 function renderDetail(s){
  $('set-add-current').disabled=!s.entries.length;selected={id:s.query.vesselId,version:s.query.version};$('event-query-panel').hidden=false;$('selected-vessel-id').textContent=`Requested AIS identity ${selected.id} · ${selected.version}; inspect the returned identity evidence before interpreting activity.`;
  $('identity-history').replaceChildren();$('classification-history').replaceChildren();$('vessel-raw').textContent='';$('vessel-detail-caption').textContent=`Requested identity ${s.query.vesselId} · ${s.query.version}`;
  $('identity-extra-evidence').replaceChildren();detailSnapshot=s;const vessel=s.entries[0];if(!vessel){$('vessel-title').textContent='No identity record returned';return;}
  const label=vesselLabel(vessel);$('vessel-title').textContent=label.name;$('vessel-detail-caption').textContent=`Requested identity ${s.query.vesselId} · ${s.query.version}. Historical names, flags and identifiers below retain their source context.`;
  $('identity-history').replaceChildren();for(const r of identities(vessel)){
   const tr=document.createElement('tr');for(const value of [r.recordSource,r.shipname||r.nShipname,`${r.ssvid||'—'} / ${r.imo||'—'}`,r.flag,`${r.transmissionDateFrom||r.dateFrom||'?'} → ${r.transmissionDateTo||r.dateTo||'?'}`,format(r.sourceCode||r.source)])text('td',value,tr);$('identity-history').append(tr);
  }
  $('classification-history').replaceChildren();const fields={geartypes:'Gear class',shiptypes:'Vessel type',inferredVesselClassAgNnet:'Inferred vessel class',registryVesselClass:'Registry class',prodGeartypeSource:'Production class source',onFishingListSr:'Fishing-list evidence',atomicClassSc:'Fine-class prediction (provider field)'};
  let count=0;for(const info of list(vessel.combinedSourcesInfo))for(const [field,label] of Object.entries(fields))for(const item of list(info[field])){count++;const tr=document.createElement('tr');for(const v of [label,format(item.value??item.name??item),format(item.source),`${item.yearFrom??'?'} → ${item.yearTo??'?'}`])text('td',v,tr);$('classification-history').append(tr);}
  if(!count){const tr=document.createElement('tr');const td=text('td','No recognized classification fields in this client. Inspect the original record for other provider evidence.',tr);td.colSpan=4;$('classification-history').append(tr);}
  renderSearchEvidence(vessel,$('identity-extra-evidence'));$('vessel-raw').textContent=JSON.stringify(vessel,null,2);selected={id:s.query.vesselId,version:s.query.version};$('event-query-panel').hidden=false;$('selected-vessel-id').textContent=`GFW AIS identity ${selected.id} · ${selected.version}. Check the identity’s observed period above before choosing event dates.`;
 }
 function inspectEvent(event){$('event-inspector').hidden=false;const start=Date.parse(event.start),end=typeof event.end==='string'?Date.parse(event.end):NaN;const elapsed=Number.isFinite(end)&&end>=start?`${((end-start)/3600000).toLocaleString(undefined,{maximumFractionDigits:2})} hours elapsed (whole event, not fishing hours)`:'End/duration not supplied';$('event-inspector-summary').textContent=`${event.type} · ${event.start} → ${event.end||'open / unknown'} · ${elapsed} · ${confidenceLabel(event)}`;$('event-record').textContent=JSON.stringify(event,null,2);}
 function renderEvents(){
  $('event-rows').replaceChildren();for(const event of active.entries.slice(tablePage*20,(tablePage+1)*20)){const tr=document.createElement('tr');for(const value of [event.start,event.end||'Open / unknown',event.type,confidenceLabel(event),`${event.vessel?.name||'Not supplied'} · ${event.vessel?.id||'No AIS ID'} · ${event.vessel?.flag||'Flag not supplied'}`])text('td',value,tr);const td=document.createElement('td');const button=text('button','Inspect record',td);button.type='button';button.addEventListener('click',()=>inspectEvent(event));if(typeof event.vessel?.id==='string'&&/^[a-zA-Z0-9-]{6,100}$/.test(event.vessel.id)){const identity=text('button','Retrieve identity',td);identity.type='button';identity.addEventListener('click',()=>selectIdentity(event.vessel.id,active.query.version));}tr.append(td);$('event-rows').append(tr);}
 }
 function table(){if(!active)return;const pages=Math.max(1,Math.ceil(active.entries.length/20));tablePage=Math.min(Math.max(0,tablePage),pages-1);$('lookup-table-label').textContent=`Page ${tablePage+1} of ${pages} · ${active.entries.length} loaded records`;$('lookup-previous-table').disabled=tablePage===0;$('lookup-next-table').disabled=tablePage===pages-1;if(active.query.kind==='search')renderMatches();if(['events','event-detail','area-events'].includes(active.query.kind))renderEvents();}
 function show(s){
  if(active?.id!==s.id)tablePage=0;active=s;$('explorer-history').value=s.id;$('lookup-status-panel').hidden=false;$('lookup-provenance').hidden=false;$('event-inspector').hidden=true;
  $('lookup-status').textContent=s.query.kind==='event-stats'?`${s.complete?'Statistics response archived':'Statistics request incomplete'} · ${s.query.includes.length} sections requested${s.error?' · '+s.error:''}`:s.query.kind==='insights'?`${s.complete?'Insights response archived':'Insight request incomplete'} · ${s.query.includes.length} categories requested${s.error?' · '+s.error:''}`:`${s.query.kind==='search'?`${s.query.mode==='advanced'?'Advanced search':searchLabel(s.query)} · ${s.query.version} · `:''}${s.entries.length} records loaded${s.total!==null?` / ${s.total} reported`:''} · ${s.complete?'all reported pages loaded':'PARTIAL'} · ${s.pages.length} pages retained${s.error?` · ${s.error}`:''}${s.duplicatesRemoved?` · ${s.duplicatesRemoved} duplicate records removed`:''}`;
  $('lookup-caveat').textContent=[s.caveats,...(s.warnings||[])].join(' ');$('lookup-download').href=`/api/explorer/${s.id}/download`;$('lookup-download').textContent=s.query.kind==='event-stats'?(s.complete?'Export statistics snapshot':'Export incomplete statistics snapshot'):s.complete?'Export complete lookup':'Export PARTIAL lookup';
  $('lookup-import-status').textContent=s.localImport?`Imported archive · source ID ${s.originalId||s.id}. Original pages and checksum preserved; no upstream request was made. This archive is immutable.${s.originalId&&s.originalId!==s.id?' A differing local archive already used that source ID, so this version has its own local ID.':''}`:s.continuedFrom?`Continuation copied from ${s.continuedFrom.id}; its original archive remains unchanged. New pages may reflect newer upstream data.`:'';
  if(!s.complete&&(s.pages.length>=100||s.pages.length>0&&s.nextCursor===null))$('lookup-import-status').textContent+=' No usable continuation remains under this client’s pagination limits; start a new or narrower lookup.';
  pageButtons();
  $('vessel-matches').hidden=s.query.kind!=='search';$('vessel-detail').hidden=s.query.kind!=='detail';$('event-results').hidden=!['events','event-detail','area-events'].includes(s.query.kind);$('insight-results').hidden=s.query.kind!=='insights';$('lookup-table-pages').hidden=['detail','insights','event-stats'].includes(s.query.kind);$('back-to-insights').hidden=s.query.kind!=='event-detail'||!insights.snapshot();
  if(s.query.kind!=='event-stats')eventStatistics.hide();
  if(s.query.kind==='event-stats'){selected=null;$('event-query-panel').hidden=true;areaEvents.show(s);eventStatistics.show(s);}
  if(s.query.kind!=='search')searchControl.hide();
  if(s.query.kind==='search'){searchControl.show(s);searchSnapshot=s;selected=null;$('event-query-panel').hidden=true;}
  if(s.query.kind==='detail')renderDetail(s);
  if(s.query.kind==='insights'){selected={id:s.query.vesselId,version:s.query.version};$('event-query-panel').hidden=true;insights.show(s);}
  $('back-to-area-events').hidden=!areaSnapshot||s.query.kind==='area-events';
  if(s.query.kind==='area-events'){areaSnapshot=s;selected=null;$('event-query-panel').hidden=true;areaEvents.show(s);}
  if(['events','event-detail','area-events'].includes(s.query.kind)){
   if(s.query.kind!=='area-events'){selected={id:s.query.vesselId,version:s.query.version};$('event-query-panel').hidden=false;$('selected-vessel-id').textContent=`GFW AIS identity ${selected.id} · ${selected.version}`;const f=$('event-query');if(s.query.kind==='events')for(const key of ['eventType','confidence','start','end'])f.elements[key].value=s.query[key];else f.elements.eventType.value=s.query.eventType;confidenceControl();}
   $('event-title').textContent=EVENT_TYPES[s.query.eventType].label;$('event-context').textContent=s.query.kind==='event-detail'?`Event ${s.query.eventId} · ${s.query.version} · whole source event, not clipped to an insight period`:s.query.kind==='area-events'?`Area event lookup · ${s.query.start} → ${s.query.end} UTC (${s.query.timeFilterMode||'OVERLAP'}) · ${s.query.version} · ${s.query.boundarySource?.label||s.query.geometry.type} · W/S/E/N ${s.query.bounds.join(', ')} · original event durations retained`:`${s.query.start} → ${s.query.end} UTC (${s.query.timeFilterMode||'OVERLAP'}) · ${s.query.version} · AIS ID ${s.query.vesselId} · ${s.complete?'Reported pagination complete':'Partial lookup'}`;
   $('event-filter-context').textContent=s.query.kind==='area-events'?describeEventFilters(s.query):'';eventMap ||= createEventMap(inspectEvent);eventMap.show(s.entries,eventPosition,s.query.kind==='area-events'?s.query.geometry:null);
  }
  insights.select();markEventDraft();table();$('lookup-manifest').textContent=JSON.stringify({localId:s.id,sourceId:s.originalId||s.id,query:s.query,createdAt:s.createdAt,updatedAt:s.updatedAt,complete:s.complete,loaded:s.entries.length,total:s.total,duplicatesRemoved:s.duplicatesRemoved,continuedFrom:s.continuedFrom,pages:s.pages.map(({raw,...p})=>p),attribution:s.attribution,license:s.license},null,2);
 }
 const eventStatistics=setupEventStats();
 const areaEvents=setupAreaEvents({getQuery,openBuilder,create,onError});
 $('back-to-area-events').addEventListener('click',()=>{generation++;stop=true;fetching=false;if(areaSnapshot)show(areaSnapshot);});
 const vesselSets=setupVesselSets({api,openLookup:async id=>{generation++;stop=true;fetching=false;show(await api(`/api/explorer/${id}`));},retrieveIdentity:selectIdentity,onError});
 $('set-add-current').addEventListener('click',()=>{if(active?.query.kind==='detail')vesselSets.addFromLookup(active.id,active.query.vesselId);});
 const insights=setupInsights({getSelected:()=>selected,create,onError});
 $('back-to-insights').addEventListener('click',()=>{generation++;stop=true;fetching=false;if(insights.snapshot())show(insights.snapshot());});
 const searchControl=setupVesselSearch({create,onError});
 $('back-to-search').addEventListener('click',()=>{generation++;stop=true;fetching=false;if(searchSnapshot)show(searchSnapshot);else onError('Reopen a saved search from the lookup list.');});
 function markEventDraft(){const f=$('event-query');$('event-stale').textContent=active?.query.kind==='events'&&['eventType','confidence','start','end'].some(key=>f.elements[key].value!==active.query[key])?'Event settings changed. Displayed results still belong to the saved query shown below; load event history to apply the new settings.':'';}
 $('event-query').addEventListener('input',markEventDraft);$('event-query').addEventListener('change',markEventDraft);
 function confidenceControl(){const f=$('event-query');f.elements.confidence.disabled=f.elements.eventType.value!=='port_visits';if(f.elements.confidence.disabled)f.elements.confidence.value='all';}
 $('event-query').elements.eventType.addEventListener('change',confidenceControl);
 $('event-query').addEventListener('submit',event=>{event.preventDefault();if(!selected)return onError('Select an AIS identity first.');const f=new FormData(event.target);create({kind:'events',vesselId:selected.id,version:selected.version,eventType:f.get('eventType'),confidence:f.get('confidence')||'all',start:f.get('start'),end:f.get('end')});});
 $('explorer-history').addEventListener('change',async event=>{if(!event.target.value)return;const serial=++generation;stop=true;fetching=true;try{const s=await api(`/api/explorer/${event.target.value}`);if(serial===generation)show(s);}catch(e){if(serial===generation)onError(e.message);}finally{if(serial===generation){fetching=false;pageButtons();}}});
 async function next(all=false){if(!active||active.complete)return;const id=active.id,serial=++generation;stop=false;fetching=true;$('lookup-stop').disabled=!all;$('lookup-next').disabled=true;$('lookup-all').disabled=true;
  try{for(let n=0;n<(all?100:1);n++){const s=await api(`/api/explorer/${id}/next`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(serial!==generation)break;show(s);if(s.complete||s.error||stop)break;}$('lookup-stop').disabled=true;await refreshHistory();}
  catch(e){onError(e.message);}finally{if(serial===generation&&active){fetching=false;pageButtons();$('lookup-stop').disabled=true;}}
 }
 $('lookup-next').addEventListener('click',()=>next());$('lookup-all').addEventListener('click',()=>next(true));$('lookup-stop').addEventListener('click',()=>{stop=true;});
 $('lookup-previous-table').addEventListener('click',()=>{tablePage--;table();});$('lookup-next-table').addEventListener('click',()=>{tablePage++;table();});
 function pageButtons(){const single=['detail','event-detail','insights','event-stats'].includes(active?.query.kind);$('lookup-all').hidden=single;$('lookup-stop').hidden=single;$('lookup-next').textContent=single?'Retry request':'Load next page / retry';const terminal=active?.pages.length>0&&active.nextCursor===null||active?.pages.length>=100;const disabled=fetching||!active||active.complete||active.localImport||terminal;$('lookup-next').disabled=disabled;$('lookup-all').disabled=disabled;$('import-lookup').disabled=fetching;$('lookup-download').hidden=fetching;$('lookup-copy').hidden=!active?.localImport||active.complete||terminal;$('lookup-copy').disabled=fetching;}
 $('import-lookup').addEventListener('change',async event=>{const serial=++generation;stop=true;fetching=true;pageButtons();try{const file=event.target.files[0];if(!file)return;if(file.size>128*1024*1024)throw Error('Lookup archive exceeds 128 MiB.');const snapshot=await api('/api/explorer/import',{method:'POST',headers:{'Content-Type':'application/json'},body:await file.text()});if(serial===generation){show(snapshot);await refreshHistory();$('explorer-history').value=snapshot.id;}}catch(error){if(serial===generation)onError(error.message);}finally{event.target.value='';if(serial===generation){fetching=false;pageButtons();}}});
 $('lookup-copy').addEventListener('click',async()=>{if(!active||fetching)return;const serial=++generation;fetching=true;stop=true;pageButtons();try{const child=await api(`/api/explorer/${active.id}/continue`,{method:'POST'});if(serial===generation){show(child);await refreshHistory();$('explorer-history').value=child.id;}}catch(error){onError(error.message);}finally{if(serial===generation){fetching=false;pageButtons();}}});
 return {refreshHistory,clearSet:vesselSets.clear,currentSetId:vesselSets.currentId,openSetRevision:vesselSets.openRevision,currentId:()=>active?.id||null,openSaved:async id=>{generation++;stop=true;fetching=false;show(await api(`/api/explorer/${id}`));}};
}
