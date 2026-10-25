import {SOURCES} from '/shared/catalogue.mjs';
const $=id=>document.getElementById(id);
export function setupPreview({api,getQuery,editor,onError}){
 let record=null,epoch=0,signature=null,expiryTimer=null,lastState=null,errorCheck=false;
 const currentSignature=()=>{const q=getQuery();return JSON.stringify({source:q.source,datasetVersion:q.datasetVersion,start:q.start,end:q.end,flags:[...new Set(q.flags)].sort(),gears:[...new Set(q.gears)].sort(),vesselTypes:[...new Set(q.vesselTypes)].sort(),matched:q.matched,distanceFromPortKm:q.distanceFromPortKm,interval:$('preview-interval').value});};
 function legend(state){
  if(!record)return;lastState=state;const q=getQuery(),thresholds=record.thresholds[state.tileZoom]||[];
  $('preview-legend').textContent=`Preview: ${record.query.interval.toLowerCase()} frames, requested range ${record.query.start} → ${record.query.end}; GFW tile zoom ${state.tileZoom} (map zoom ${state.mapZoom}). ${record.query.source==='gfw-fishing'?'Port/anchorage minimum: '+(record.query.distanceFromPortKm===undefined?'not requested / provider default unrecorded':record.query.distanceFromPortKm+' km')+'. ':''}Saved output: ${q.grid}° / ${q.interval.toLowerCase()}. Adaptive scale thresholds: ${thresholds.some(v=>v>0)?thresholds.map(v=>v.toLocaleString(undefined,{maximumFractionDigits:2})).join(', '):'no usable nonzero thresholds supplied; do not infer zero activity'} ${record.units}.`;
  $('preview-status').textContent=state.loading?'Loading preview tiles…':state.errors?`Preview partly loaded: ${state.errors} visible tiles have no returned image or are unavailable. This does not establish zero activity.`:`Preview displayed · ${SOURCES[record.query.source].label} · ${record.query.datasetVersion}. Images are for exploration, not numerical extraction.`;
  if(!state.errors)$('preview-diagnostic').textContent='';
  if(state.errors&&!errorCheck){errorCheck=true;const id=record.id;api(`/api/previews/${id}`).then(s=>{if(record?.id===id&&lastState?.errors&&s.lastError){$('preview-diagnostic').textContent=s.lastError;if(/HTTP (401|403|429)/.test(s.lastError))$('preview-status').textContent=/401/.test(s.lastError)?'GFW authorization failed. Reconnect your personal token.':/403/.test(s.lastError)?'GFW denied preview access. Check account or network permissions.':'GFW rate/concurrency limit reached. Stop the preview and try later.';}}).catch(e=>{if(record?.id===id)stop(e.message);}).finally(()=>{errorCheck=false;});}
 }
 function attach(){if(record)editor.setPreview(record,{detail:$('preview-detail').value,opacity:Number($('preview-opacity').value)},legend);}
 function stop(message='Live preview is off. Saved extracts remain available offline.'){
  epoch++;clearTimeout(expiryTimer);const previous=record;record=null;signature=null;lastState=null;editor.setPreview(null);$('stop-preview').disabled=true;$('start-preview').disabled=false;$('preview-status').textContent=message;$('preview-legend').textContent='';$('preview-diagnostic').textContent='';
  if(previous)api(`/api/previews/${previous.id}`,{method:'DELETE'}).catch(()=>{});
 }
 function invalidate(){if(record&&signature!==currentSignature())stop('Source, dates or filters changed. Refresh the preview to apply them.');else if(record&&lastState)legend(lastState);}
 $('start-preview').addEventListener('click',async()=>{
  stop('Preparing live preview…');const serial=epoch;$('start-preview').disabled=true;$('stop-preview').disabled=false;const sentSignature=currentSignature();
  try{
   const result=await api('/api/previews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:getQuery(),options:{interval:$('preview-interval').value}})});
   if(serial!==epoch||sentSignature!==currentSignature()){api(`/api/previews/${result.id}`,{method:'DELETE'}).catch(()=>{});if(serial===epoch)stop('Query changed while preparing the preview. Refresh again.');return;}
   record=result;signature=sentSignature;$('preview-notes').replaceChildren(...result.notes.map(note=>{const li=document.createElement('li');li.textContent=note;return li;}));attach();expiryTimer=setTimeout(()=>stop('This client preview session expired after 30 minutes. Refresh when ready.'),30*60000);
  }catch(e){if(serial===epoch){stop(e.message);onError(e.message);}}finally{if(serial===epoch)$('start-preview').disabled=false;}
 });
 $('stop-preview').addEventListener('click',()=>stop());$('preview-detail').addEventListener('change',attach);$('preview-interval').addEventListener('change',invalidate);$('preview-opacity').addEventListener('input',()=>editor.previewOpacity(Number($('preview-opacity').value)));
 return {stop,invalidate};
}
