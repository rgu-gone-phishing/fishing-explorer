import {parseCSV} from '/shared/reference-layers.mjs';
const $=id=>document.getElementById(id);
const label=(tag,value,parent)=>{const e=document.createElement(tag);e.textContent=value;parent.append(e);return e;};
export function setupWorkspaces({api,capture,restore,setLayers,showLayer,onError}){
 let studies=[],layers=[],library=[],opened=null,selectedLayers=new Set(),references=new Map(),fileData=null,savedSignature=null,restoring=false,layerGeneration=0,operationBusy=false;
 const setBusy=value=>{operationBusy=value;for(const id of ['open-study','new-study','import-study'])$(id).disabled=value;$('study-form').querySelector('button').disabled=value;};
 const refKey=r=>`${r.kind}:${r.id}`;
 const signature=()=>JSON.stringify({workspace:capture(),layers:[...selectedLayers].sort(),references:[...references.keys()].sort(),title:$('study-form').elements.title.value,notes:$('study-form').elements.notes.value});
 async function selectedLayerData(ids=[...selectedLayers]){return Promise.all(ids.map(id=>api(`/api/layers/${id}?display=true`)));}
 async function syncLayers(){if(selectedLayers.size>10)throw Error('Select at most ten reference layers for display.');const generation=++layerGeneration;const data=await selectedLayerData();if(generation!==layerGeneration)return;setLayers(data);markDirty();}
 function markDirty(){if(restoring)return;$('study-current').textContent=opened?`Study revision ${opened.revision.id.slice(0,8)} · ${savedSignature===signature()?'workspace saved':'unsaved workspace changes'}`:'New study · save to retain the current query and view';}
 function revisions(){const s=studies.find(s=>s.id===$('study-picker').value);$('study-revision').replaceChildren();for(const r of (s?.revisions||[]).slice().reverse())label('option',`${r.title} · ${r.createdAt.slice(0,16)} · ${r.id.slice(0,8)}`,$('study-revision')).value=r.id;}
 function renderStudies(){const current=$('study-picker').value,currentRevision=$('study-revision').value;$('study-picker').replaceChildren();label('option','Choose a study',$('study-picker')).value='';for(const s of studies){const r=s.revisions.at(-1);label('option',`${r.title} · ${s.revisions.length} revision(s)`,$('study-picker')).value=s.id;}$('study-picker').value=current;revisions();if([...$('study-revision').options].some(o=>o.value===currentRevision))$('study-revision').value=currentRevision;}
 function renderReferences(){
  const state=capture().presentation;const activeIds=new Set([state.artifactId,state.batchId,state.comparisonId,state.lookupId,state.infrastructureId,state.vesselSetId].filter(Boolean));
  if(!opened)for(const ref of library)if(activeIds.has(ref.id))references.set(refKey(ref),ref);
  $('study-references').replaceChildren();for(const ref of library){const row=document.createElement('label');row.className='reference-choice';const check=document.createElement('input');check.type='checkbox';check.checked=references.has(refKey(ref));check.addEventListener('change',()=>{if(check.checked)references.set(refKey(ref),ref);else references.delete(refKey(ref));markDirty();});row.append(check,document.createTextNode(`${ref.kind}: ${ref.label}`));$('study-references').append(row);}
  if(!library.length)label('p','No saved data results yet. You can still save the query and view.',$('study-references'));
 }
 function renderLayers(){
  $('reference-layer-list').replaceChildren();for(const layer of layers){
   const article=document.createElement('article');const row=document.createElement('label');row.className='reference-choice';const check=document.createElement('input');check.type='checkbox';check.checked=selectedLayers.has(layer.id);
   check.addEventListener('change',async()=>{if(check.checked&&selectedLayers.size>=10){check.checked=false;return onError('Select at most ten reference layers.');}if(check.checked)selectedLayers.add(layer.id);else selectedLayers.delete(layer.id);try{await syncLayers();}catch(e){onError(e.message);}});
   row.append(check,document.createTextNode(layer.metadata.title));article.append(row);
   label('p',`${layer.features} features · ${layer.metadata.sector} · ${layer.metadata.status} · validity ${layer.metadata.validFrom||'unknown'} → ${layer.metadata.validTo||'unknown'}`,article);
   label('p',`Source: ${layer.metadata.provider} · ${layer.metadata.citation}`,article).className='hint';label('p',`Use basis: ${layer.metadata.license} · Redistribution: ${layer.metadata.redistribution} (user supplied)`,article).className='hint';
   const actions=document.createElement('div');actions.className='map-toolbar';const zoom=label('button','Show on map',actions);zoom.type='button';zoom.addEventListener('click',async()=>{try{if(!selectedLayers.has(layer.id)){if(selectedLayers.size>=10)throw Error('Select at most ten layers.');selectedLayers.add(layer.id);}await syncLayers();renderLayers();showLayer(await api(`/api/layers/${layer.id}?display=true`));}catch(e){onError(e.message);}});
   const backup=label('a','Download local backup',actions);backup.href=`/api/layers/${layer.id}/backup`;article.append(actions);$('reference-layer-list').append(article);
  }
  if(!layers.length)label('p','No reference layers imported. Files remain local when you add them.',$('reference-layer-list'));
 }
 async function refresh(){[studies,layers,library]=await Promise.all([api('/api/studies'),api('/api/layers'),api('/api/library')]);renderStudies();renderLayers();renderReferences();}
 async function applyOpened(value){
  opened=value;restoring=true;$('study-picker').value=value.studyId;revisions();$('study-revision').value=value.revision.id;
  try{
   $('study-form').elements.title.value=value.revision.title;$('study-form').elements.notes.value=value.revision.notes;
   references=new Map(value.availability.filter(r=>r.kind!=='layer'&&r.status==='available').map(r=>{const ref={...r,id:r.resolvedId};return [refKey(ref),ref];}));
   selectedLayers=new Set(value.availability.filter(r=>r.kind==='layer'&&r.status==='available').map(r=>r.resolvedId));await syncLayers();await restore(value);
   savedSignature=signature();$('study-status').textContent=value.availability.some(r=>r.status!=='available')?'Some references are missing or changed. They were not silently substituted.':'Study restored with verified references.';
   $('export-study').hidden=false;$('export-study').href=`/api/studies/${value.studyId}/export?revision=${value.revision.id}`;
  }finally{restoring=false;markDirty();}
 }
 $('study-form').addEventListener('input',markDirty);
 $('study-picker').addEventListener('change',revisions);
 $('open-study').addEventListener('click',async()=>{if(operationBusy)return;setBusy(true);try{if(!$('study-picker').value)throw Error('Choose a study.');await applyOpened(await api(`/api/studies/${$('study-picker').value}?revision=${$('study-revision').value}`));}catch(e){onError(e.message);}finally{setBusy(false);}});
 $('new-study').addEventListener('click',()=>{if(operationBusy)return;opened=null;savedSignature=null;const title=$('study-form').elements.title;if(title.value)title.value=(title.value+' (copy)').slice(0,120);$('export-study').hidden=true;renderReferences();markDirty();$('study-status').textContent='Current query and selected layers can be saved as a new study.';});
 $('study-form').addEventListener('submit',async event=>{
  event.preventDefault();if(operationBusy)return;setBusy(true);const submittedSignature=signature();
  try{
   const state=capture(),f=new FormData(event.target),refs=[...references.values()].map(({kind,id,label})=>({kind,id,label}));for(const id of selectedLayers){const layer=layers.find(l=>l.id===id);refs.push({kind:'layer',id,label:layer?.metadata.title||'Reference layer'});}
   const result=await api('/api/studies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...state,id:opened?.studyId,baseRevisionId:opened?.latestRevisionId,title:f.get('title'),notes:f.get('notes'),references:refs})});
   opened=result;savedSignature=submittedSignature;await refresh();$('study-picker').value=result.studyId;revisions();$('export-study').hidden=false;$('export-study').href=`/api/studies/${result.studyId}/export?revision=${result.revision.id}`;$('study-status').textContent='New revision saved locally. Existing revisions and data are unchanged.';markDirty();
  }catch(e){onError(e.message);}finally{setBusy(false);}
 });
 $('import-study').addEventListener('change',async event=>{if(operationBusy)return;setBusy(true);try{const file=event.target.files[0];if(!file)return;if(file.size>16*1024*1024)throw Error('Study plan exceeds 16 MiB.');const value=await api('/api/studies/import',{method:'POST',headers:{'Content-Type':'application/json'},body:await file.text()});await refresh();await applyOpened(value);}catch(e){onError(e.message);}finally{event.target.value='';setBusy(false);}});
 $('layer-file').addEventListener('change',async event=>{
  fileData=null;try{const file=event.target.files[0];if(!file)return;if(file.size>5*1024*1024)throw Error('Reference input exceeds 5 MiB.');const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer()),format=file.name.toLowerCase().endsWith('.csv')?'csv':'geojson';fileData={name:file.name,format,content};$('csv-mapping').hidden=format!=='csv';if(!$('layer-form').elements.title.value)$('layer-form').elements.title.value=file.name;
   if(format==='csv'){const {headers}=parseCSV(content);for(const [id,pattern] of [['csv-longitude',/^(lon|longitude)$/i],['csv-latitude',/^(lat|latitude)$/i]]){const select=$(id);select.replaceChildren();label('option','Choose column',select).value='';for(const h of headers)label('option',h,select).value=h;select.value=headers.find(h=>pattern.test(h))||'';}}
   $('layer-status').textContent='File read locally. Review its coordinate mapping and provenance before importing.';
  }catch(e){fileData=null;$('layer-status').textContent=e.message;onError(e.message);}
 });
 $('layer-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
  try{if(!fileData)throw Error('Choose a valid reference file.');const f=new FormData(event.target),metadata=Object.fromEntries(['title','provider','citation','license','redistribution','sector','status','validFrom','validTo'].map(k=>[k,f.get(k)]));const layer=await api('/api/layers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fileData,metadata,columns:{longitudeColumn:$('csv-longitude').value,latitudeColumn:$('csv-latitude').value}})});await refresh();if(selectedLayers.size<10)selectedLayers.add(layer.id);await syncLayers();renderLayers();$('layer-status').textContent=`Imported ${layer.geojson.features.length} reference features locally. No file was sent to GFW.`;
  }catch(e){onError(e.message);}finally{button.disabled=false;}
 });
 $('import-layer-backup').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>32*1024*1024)throw Error('Reference backup exceeds 32 MiB.');await api('/api/layers/import-backup',{method:'POST',headers:{'Content-Type':'application/json'},body:await file.text()});await refresh();$('layer-status').textContent='Reference backup restored with its original identifier and checksums.';}catch(e){onError(e.message);}finally{event.target.value='';}});
 return {refresh,markDirty,async restoreLast(){const last=await api('/api/studies/last');if(last){await refresh();await applyOpened(last);}}};
}
