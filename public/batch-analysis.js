import {SOURCES,measure,rowGroup,portDistanceSuffix} from '/shared/catalogue.mjs';
import {createBatchMap} from '/map.js';
const $=id=>document.getElementById(id);
const number=value=>value===null?'No returned values':value.toLocaleString(undefined,{maximumFractionDigits:3});
const cell=value=>{const td=document.createElement('td');td.textContent=value;return td;};
export function setupBatchAnalysis({api,onError,onDirty}){
 let batchId=null,result=null,map=null,serial=0,seriesPage=0,dirty=false,expectedSource=null;
 const options=()=>({start:$('batch-display-start').value,end:$('batch-display-end').value,group:$('batch-display-group').value});
 const signature=()=>JSON.stringify(options());
 function hideResults(){$('batch-analysis-data').hidden=true;for(const id of ['batch-analysis-figure','batch-analysis-report','batch-analysis-zip'])$(id).hidden=true;}
 function stale(){if(result&&signature()!==JSON.stringify({start:result.options.start,end:result.options.end,group:result.options.group})){$('batch-analysis-status').textContent='Display filters changed. Apply them to update the saved-data view.';dirty=true;hideResults();onDirty?.();}}
 $('batch-analysis-filter').addEventListener('input',stale);
 function series(){
  const entries=result.series.slice(seriesPage*31,(seriesPage+1)*31),max=Math.max(...result.series.map(b=>b.value??0),0);
  $('batch-analysis-series').replaceChildren(...entries.map(bin=>{
   const row=document.createElement('div');row.className='batch-series-row';const label=document.createElement('span');label.textContent=bin.date;
   const track=document.createElement('span');track.className='series-track';const bar=document.createElement('span');bar.style.width=`${max?(bin.value??0)/max*100:0}%`;track.append(bar);
   const value=document.createElement('span');value.textContent=bin.status==='not-retrieved'?'Not retrieved':bin.value===null?'No returned rows':number(bin.value);row.append(label,track,value);return row;
  }));
  $('batch-series-page').textContent=`Bins ${seriesPage*31+1}–${Math.min((seriesPage+1)*31,result.series.length)} of ${result.series.length} · ${result.units}`;
  $('batch-series-prev').disabled=seriesPage===0;$('batch-series-next').disabled=(seriesPage+1)*31>=result.series.length;
 }
 function render(){
  const r=result;$('batch-analysis-data').hidden=false;for(const id of ['batch-analysis-figure','batch-analysis-report','batch-analysis-zip'])$(id).hidden=false;$('batch-analysis-title').textContent=`Historical ${SOURCES[r.query.source].label.toLowerCase()}`;
  $('batch-analysis-status').textContent=`${r.complete?'All chunks retrieved':'PARTIAL BATCH'} · ${r.selectionComplete?'Selected window retrieved':'Selected window has missing chunks'} · ${r.query.datasetVersion} · ${r.query.grid}° / ${r.query.interval.toLowerCase()}${portDistanceSuffix(r.query)}`;
  $('batch-analysis-total').textContent=`${number(r.returnedTotal)} ${r.returnedTotal===null?'':r.units} in ${r.matchedRows.toLocaleString()} returned rows. ${r.selectionComplete?'This does not measure observation coverage.':'This is a partial returned-data total.'}`;
  $('batch-analysis-window').textContent=`Displayed: ${r.options.start} → ${r.options.end} (end exclusive), ${r.options.group||'all saved groups'}. Original batch: ${r.query.start} → ${r.query.end}.`;
  $('batch-analysis-missing').replaceChildren(...r.missingWindows.map(window=>{const li=document.createElement('li');li.textContent=`${window.start} → ${window.end}: ${window.status}`;return li;}));$('batch-missing-heading').hidden=!r.missingWindows.length;
  $('batch-group-options').replaceChildren(...r.groups.map(group=>{const option=document.createElement('option');option.value=group.name;return option;}));
  $('batch-group-hint').textContent=r.groupsTruncated?'Suggestions show the first 1,000 groups encountered in this time window. Enter any exact group value, or leave blank for all.':'Exact saved group label; leave blank for all. Suggestions use this display window.';
  $('batch-analysis-value').textContent=r.units;
  $('batch-analysis-rows').replaceChildren(...r.rows.map(row=>{
   const tr=document.createElement('tr'),link=document.createElement('a');link.href=`/api/artifacts/${row.jobId}/bundle`;link.textContent=`Chunk ${row.chunkIndex+1}`;const parent=cell('');parent.append(link);
   tr.append(cell(row.date),cell(row.lat.toFixed(4)),cell(row.lon.toFixed(4)),cell(rowGroup(row,r.query)),cell(number(measure(row))),parent);return tr;
  }));
  $('batch-row-page').textContent=r.matchedRows?`Rows ${r.options.offset+1}–${r.options.offset+r.rows.length} of ${r.matchedRows}`:'No returned rows for this selection.';
  $('batch-rows-prev').disabled=r.options.offset===0;$('batch-rows-next').disabled=r.nextOffset===null;
  $('batch-analysis-notes').replaceChildren(...r.notes.map(note=>{const li=document.createElement('li');li.textContent=note;return li;}));
  $('batch-analysis-provenance').textContent=JSON.stringify({batchId:r.batchId,batchFingerprint:r.batchFingerprint,importedArchive:r.importedArchive,continuedFrom:r.continuedFrom,query:r.query,display:r.options,complete:r.complete,selectionComplete:r.selectionComplete,parents:r.parents,missingWindows:r.missingWindows},null,2);
  $('batch-analysis-zip').textContent=r.complete?'Export complete batch ZIP':'Export saved chunks · PARTIAL ZIP';$('batch-analysis-zip').href=`/api/batches/${r.batchId}/export${r.complete?'':'?partial=true'}`;
  const exportParams=new URLSearchParams({start:r.options.start,end:r.options.end,group:r.options.group,fingerprint:r.batchFingerprint,...(!r.complete?{partial:'true'}:{})});for(const [suffix,label] of [['figure','SVG figure'],['report','HTML summary']]){const link=$('batch-analysis-'+suffix);link.href=`/api/batches/${r.batchId}/${suffix}?${exportParams}`;link.textContent=`Save ${r.complete?'batch':'PARTIAL batch'} ${label}`;}
  series();map ||= createBatchMap({onViewChange:onDirty});map.show(r);
 }
 async function load(offset=0,initial=false,initialOptions={}){
  const epoch=++serial,id=batchId,sent=initial?initialOptions:options(),key=signature();dirty=true;onDirty?.();$('batch-analysis-status').textContent='Verifying saved chunks and calculating the display…';hideResults();
  try{
   const data=await api(`/api/batches/${id}/analysis?${new URLSearchParams({...sent,offset,...(expectedSource?{sourceSha256:expectedSource}:{})})}`);if(epoch!==serial||id!==batchId)return;
   if(key!==signature()){$('batch-analysis-status').textContent='Filters changed during analysis. Apply the current filters.';return;}
   result=data;seriesPage=0;
   for(const edge of ['start','end']){const field=$(`batch-display-${edge}`);field.value=data.options[edge];field.min=data.query.start;field.max=data.query.end;}
   $('batch-display-group').value=data.options.group;dirty=false;render();onDirty?.();return true;
  }catch(error){if(epoch===serial){$('batch-analysis-status').textContent=error.message;onError(error.message);}}
 }
 $('batch-analysis-filter').addEventListener('submit',event=>{event.preventDefault();load();});
 $('batch-rows-prev').addEventListener('click',()=>load(Math.max(0,result.options.offset-50)));$('batch-rows-next').addEventListener('click',()=>{if(result.nextOffset!==null)load(result.nextOffset);});
 $('batch-series-prev').addEventListener('click',()=>{seriesPage--;series();});$('batch-series-next').addEventListener('click',()=>{seriesPage++;series();});
 return {
  presentation(){return {batchId,batchView:batchId?{schemaVersion:1,options:options(),batchFingerprint:result?.batchFingerprint||null,viewport:map?.viewport()||null,draftPending:dirty||!result}:null};},
  close(){serial++;batchId=null;result=null;dirty=false;expectedSource=null;$('batch-analysis').hidden=true;},
  observe(batches){if(result&&batches.find(b=>b.id===batchId)?.analysisFingerprint!==result.batchFingerprint){$('batch-analysis-status').textContent='Batch changed since this view was calculated. Pause any running retrieval, then apply the filters again.';dirty=true;hideResults();onDirty?.();}},
  async open(id,initialOptions={},viewport=null,sourceSha256=null){batchId=id;expectedSource=sourceSha256;result=null;$('batch-analysis').hidden=false;$('artifact').hidden=true;const loaded=await load(0,true,initialOptions);if(!loaded||!result||dirty||batchId!==id)return false;if(viewport)map.restoreViewport(viewport);$('batch-analysis').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});return true;}
 };
}
