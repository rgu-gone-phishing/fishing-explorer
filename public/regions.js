const $=id=>document.getElementById(id);
export function setupRegions({api,onError,apply}){
 let page=null,current=null,listSerial=0,detailSerial=0;
 const kind=()=>$('region-kind').value;
 async function history(){const rows=await api('/api/regions'),selected=$('region-snapshot').value;$('region-snapshot').replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='Choose a saved boundary';$('region-snapshot').append(blank);for(const row of rows){const option=document.createElement('option');option.value=row.id;option.textContent=`${row.label} · ${row.kind}/${row.regionId} · ${row.simplify?'simplified '+row.simplify+' (provider parameter)':'original'} · ${row.retrievedAt.slice(0,16)}`;$('region-snapshot').append(option);}$('region-snapshot').value=selected;}
 async function search(offset=0){const epoch=++listSerial,requested=kind();$('region-choice').replaceChildren();$('region-fetch').disabled=true;try{
  const result=await api(`/api/regions/catalogue/${requested}?${new URLSearchParams({search:$('region-search').value,offset})}`);if(epoch!==listSerial||requested!==kind())return;page=result;
  $('region-catalogue-status').textContent=result.loaded?`${result.total.toLocaleString()} matches of ${result.catalogueCount.toLocaleString()} entries · list retrieved ${result.retrievedAt}. Search uses the saved list.`:'No saved catalogue. Load it from GFW using your connected personal token.';
  for(const row of result.entries){const option=document.createElement('option');option.value=row.id;const sovereignty=[row.isoSov1,row.isoSov2,row.isoSov3].filter(Boolean);option.textContent=`${row.label} · ID ${row.id}${sovereignty.length?' · '+sovereignty.join(' / '):''}`;$('region-choice').append(option);}
  $('region-fetch').disabled=!result.entries.length;$('region-prev').disabled=!result.loaded||!result.offset;$('region-next').disabled=result.nextOffset===null||!result.loaded;
  $('region-page').textContent=result.entries.length?`Entries ${result.offset+1}–${result.offset+result.entries.length} of ${result.total}`:'No matching entries.';
 }catch(error){onError(error.message);$('region-catalogue-status').textContent=error.message;}}
 function show(record){
  current=record;$('region-detail').hidden=false;$('region-detail-name').textContent=record.label;
  $('region-detail-status').textContent=`${record.dataset} / ${record.regionId} · retrieved ${record.retrievedAt} · ${record.simplify?'explicit '+record.simplify+' provider parameter (units unverified)':'no simplification requested'}. ${record.canApply?'Boundary is compatible with the current area validator.':'Cannot use this boundary: '+record.reason}`;
  $('region-use').disabled=!record.canApply;$('region-backup').href=`/api/regions/${record.id}/backup`;
  $('region-detail-notes').replaceChildren(...record.notes.map(note=>{const li=document.createElement('li');li.textContent=note;return li;}));
  $('region-properties').textContent=JSON.stringify({source:record.source,metadata:record.metadata,properties:record.properties},null,2);$('region-snapshot').value=record.id;
 }
 $('region-search-form').addEventListener('submit',event=>{event.preventDefault();search();});$('region-kind').addEventListener('change',()=>search());
 $('region-prev').addEventListener('click',()=>search(Math.max(0,(page?.offset||0)-50)));$('region-next').addEventListener('click',()=>{if(page?.nextOffset!==null)search(page.nextOffset);});
 $('region-refresh').addEventListener('click',async()=>{const target=kind(),button=$('region-refresh');button.disabled=true;try{await api(`/api/regions/catalogue/${target}/refresh`,{method:'POST'});await search();}catch(error){onError(error.message);$('region-catalogue-status').textContent=error.message+' Previously saved lists remain available.';}finally{button.disabled=false;}});
 $('region-fetch').addEventListener('click',async()=>{const epoch=++detailSerial,button=$('region-fetch');button.disabled=true;try{
  $('region-detail-status').textContent='Retrieving boundary snapshot…';const record=await api('/api/regions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:kind(),id:$('region-choice').value,simplify:Number($('region-simplify').value)})});
  await history();if(epoch===detailSerial)show(record);
 }catch(error){onError(error.message);}finally{button.disabled=!$('region-choice').options.length;}});
 $('region-open').addEventListener('click',async()=>{const epoch=++detailSerial;try{if(!$('region-snapshot').value)throw Error('Choose a saved boundary snapshot.');const record=await api(`/api/regions/${$('region-snapshot').value}`);if(epoch===detailSerial)show(record);}catch(error){onError(error.message);}});
 $('region-use').addEventListener('click',()=>{if(current?.canApply)apply(current);});
 $('region-import').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>48*1024*1024)throw Error('Boundary backup exceeds 48 MiB.');const record=await api('/api/regions/import',{method:'POST',headers:{'Content-Type':'application/json'},body:await file.text()});await history();show(record);}catch(error){onError(error.message);}finally{event.target.value='';}});
 history().then(()=>search()).catch(error=>onError(error.message));
}
