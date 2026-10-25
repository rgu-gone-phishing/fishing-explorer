import {SOURCES,portDistanceSuffix} from '/shared/catalogue.mjs';
const $=id=>document.getElementById(id);
export function setupBatches({api,getQuery,onError,openArtifact,openBatch,onImported=()=>{},onActivity=()=>{},onRefresh=()=>{},onPlanChange=()=>{}}){
 let reviewed=null,savedId=null,lastListSignature=null;
 let importController=null;
 $('import-batch-zip').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;const controller=new AbortController();importController=controller;event.target.disabled=true;$('stop-batch-import').disabled=false;
  try{if(file.size>2*1024**3+128*1024**2)throw Error('Batch ZIP exceeds 2 GiB plus 128 MiB of archive metadata.');$('batch-import-status').textContent=`Uploading and verifying ${(file.size/1024**2).toFixed(1)} MiB locally. No GFW request is made.`;const result=await api('/api/batches/import-zip',{method:'POST',headers:{'Content-Type':'application/zip'},body:file,signal:controller.signal});importController=null;$('stop-batch-import').disabled=true;$('batch-import-status').textContent=`${result.reused?'Existing verified archive reused':'Batch archive imported'} · ${result.batch.parts.filter(p=>p.status==='complete').length}/${result.batch.parts.length} chunks saved · ${result.batch.status}. Source archives remain immutable.`;await onImported(result);}
  catch(error){$('batch-import-status').textContent=controller.signal.aborted?'Import stopped. If it completed just before cancellation, reimport safely to find the existing archive.':error.message;if(!controller.signal.aborted)onError(error.message);}
  finally{importController=null;event.target.disabled=false;event.target.value='';$('stop-batch-import').disabled=true;}
 });
 $('stop-batch-import').addEventListener('click',()=>importController?.abort());
 const input=()=>({query:getQuery(),options:{chunkMonths:Number($('batch-months').value)}});
 const fingerprint=()=>JSON.stringify(input());
 function invalidate(){
  if(reviewed&&reviewed.fingerprint!==fingerprint()){$('batch-plan-stale').textContent='Settings changed. Review the new partition plan before starting.';reviewed=null;savedId=null;}
  $('run').textContent=$('batch-mode').checked?'Find data for reviewed plan →':'Find saved or retrieve →';
  $('run').disabled=$('batch-mode').checked&&!reviewed;onPlanChange();
 }
 $('batch-mode').addEventListener('change',()=>{$('batch-controls').hidden=!$('batch-mode').checked;$('batch-plan').hidden=!$('batch-mode').checked||!reviewed;invalidate();});
 $('query').addEventListener('input',invalidate);$('query').addEventListener('change',invalidate);
 $('review-batch').addEventListener('click',async()=>{
  const button=$('review-batch');button.disabled=true;
  try{
   const request=input(),key=JSON.stringify(request);const plan=await api('/api/batches/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:key});
   if(key!==fingerprint())throw Error('Settings changed during review. Review the current query again.');
   reviewed={request,fingerprint:key};savedId=null;$('batch-plan').hidden=false;$('batch-plan-stale').textContent='';
   $('batch-plan-summary').textContent=`${plan.parts.length} sequential requests · ${SOURCES[plan.query.source].label} · ${plan.query.datasetVersion} · ${plan.query.start} → ${plan.query.end} · ${plan.query.grid}° / ${plan.query.interval}${portDistanceSuffix(plan.query)}. Size and duration are not yet calibrated.`;
   $('batch-plan-notes').replaceChildren(...plan.notes.map(note=>{const li=document.createElement('li');li.textContent=note;return li;}));
   $('batch-plan-parts').replaceChildren(...plan.parts.map(part=>{const tr=document.createElement('tr');for(const value of [part.index+1,part.start,part.end]){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;}));invalidate();
  }catch(error){onError(error.message);}finally{button.disabled=false;}
 });
 async function refresh(){
  const batches=await api('/api/batches'),signature=JSON.stringify(batches);if(signature===lastListSignature){onRefresh(batches);return batches.some(b=>['running','pausing'].includes(b.status));}lastListSignature=signature;$('batch-list').replaceChildren();
  if(batches.length){const title=document.createElement('h2');title.textContent='Historical batches';$('batch-list').append(title);}
  for(const batch of batches){
   const article=document.createElement('article');const title=document.createElement('h3');title.textContent=`${SOURCES[batch.query.source].label} · ${batch.query.start} → ${batch.query.end}`;article.append(title);
   const done=batch.parts.filter(p=>p.status==='complete').length;const summary=document.createElement('p');summary.textContent=`${done}/${batch.parts.length} chunks verified and saved · ${batch.status} · ${batch.query.datasetVersion} · ${batch.query.grid}° / ${batch.query.interval}${portDistanceSuffix(batch.query)}`;article.append(summary);
   if(batch.error){const p=document.createElement('p');p.textContent=batch.error;article.append(p);}
   if(batch.importedArchive){const p=document.createElement('p');p.textContent=`Imported, read-only archive ${batch.id.slice(0,8)} · source batch ${batch.importedArchive.sourceId}.${batch.importedArchive.inferredChunkMonths?' Older manifest: chunk size inferred from exact date windows.':''} ${done<batch.parts.length?'Missing chunks are unavailable; no upstream work was resumed.':'All source chunks were retained; no retrieval was performed.'}`;article.append(p);}
   if(batch.continuedFrom){const p=document.createElement('p');p.textContent=`Continuation of archive ${batch.continuedFrom.id}. Verified completed chunks are reused; the source archive is unchanged.`;article.append(p);}
   const actions=document.createElement('div');actions.className='job-actions';article.append(actions);
   const action=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',async()=>{b.disabled=true;try{await fn();await refresh();}catch(e){onError(e.message);}finally{b.disabled=false;}});actions.append(b);};
   const post=(kind,body={})=>api(`/api/batches/${batch.id}/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(['running','pausing'].includes(batch.status))action('Pause after current chunk',()=>post('pause'));
   else if(batch.importedArchive&&done<batch.parts.length)action('Copy remaining retrieval plan',()=>post('continue'));
   else if(batch.status!=='complete')action(done===batch.parts.length?'Finalize saved batch':done?'Resume remaining chunks':'Start saved plan',()=>{let confirmSourceReview=false;if(batch.continuedFrom?.requiresSourceReview&&!batch.continuedFrom.reviewedAt){confirmSourceReview=window.confirm('The imported source recorded attempted chunks whose data is missing. Check whether the original account/session still has an active or completed report before submitting duplicates. Have you reviewed that upstream activity?');if(!confirmSourceReview)return;}return post('start',{confirmSourceReview});});
   if(done&&!['running','pausing'].includes(batch.status)){
    action(done===batch.parts.length?'Analyze entire batch':'Analyze saved chunks · PARTIAL',()=>openBatch(batch.id));
    const link=document.createElement('a');link.className='button';link.textContent=done===batch.parts.length?'Export complete batch ZIP':'Export saved chunks · PARTIAL ZIP';link.href=`/api/batches/${batch.id}/export${done===batch.parts.length?'':'?partial=true'}`;actions.append(link);
   }
   const detail=document.createElement('details');const label=document.createElement('summary');label.textContent='Inspect chunk status and saved data';detail.append(label);
   const table=document.createElement('table');table.className='batch-parts';const head=document.createElement('thead'),headrow=document.createElement('tr');for(const text of ['Window UTC (end exclusive)','Status','Result']){const th=document.createElement('th');th.textContent=text;headrow.append(th);}head.append(headrow);table.append(head);const body=document.createElement('tbody');
   for(const part of batch.parts){const row=document.createElement('tr');const range=document.createElement('td');range.textContent=`${part.start} → ${part.end}`;const state=document.createElement('td');state.textContent=part.status;const result=document.createElement('td');
    if(part.status==='complete'){const button=document.createElement('button');button.type='button';button.textContent=`Inspect ${part.rows} rows`;button.addEventListener('click',()=>openArtifact(part.jobId).catch(e=>onError(e.message)));result.append(button);}else result.textContent=batch.importedArchive?`No saved chunk · source status ${part.sourceStatus}`:part.jobId?'See child job controls below':'Not submitted';
    row.append(range,state,result);body.append(row);
   }table.append(body);const wrap=document.createElement('div');wrap.className='table-wrap';wrap.append(table);detail.append(wrap);article.append(detail);
   const note=document.createElement('p');note.className='hint';note.textContent=batch.importedArchive?'Re-export preserves the original imported ZIP byte-for-byte. Older archives may not include a separate dictionary or query summary. Missing windows remain explicit.':'ZIP includes original CSV files and chunk bundles, the exact query and boundary, a field dictionary, readable query summary, citations and use conditions. Partial exports list missing windows explicitly; no complete total is implied.';article.append(note);$('batch-list').append(article);
  }
  onRefresh(batches);const active=batches.some(b=>['running','pausing'].includes(b.status));onActivity(active);return active;
 }
 return {refresh,invalidate,isReviewed:()=>Boolean(reviewed&&reviewed.fingerprint===fingerprint()),resetReview(){reviewed=null;savedId=null;$('batch-plan').hidden=true;invalidate();},async runReviewed(){
  if(!reviewed||reviewed.fingerprint!==fingerprint())throw Error('Review the current historical partition plan before starting.');
  if(!savedId){const batch=await api('/api/batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reviewed.request)});savedId=batch.id;}
  await api(`/api/batches/${savedId}/start`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});reviewed=null;savedId=null;invalidate();
 }};
}
