import {setupSavedReuse} from '/saved-reuse.js';
import {setupExtractAnalysis} from '/extract-analysis.js';
import {setupBulkInfrastructure} from '/bulk-infrastructure.js';
import {setupHealth} from '/health.js';
import {setupVmsCatalogue} from '/vms.js';
import {setupInfrastructure} from '/infrastructure.js';
import {setupRegions} from '/regions.js';
import {setupPreview} from '/preview.js';
import {setupBatchAnalysis} from '/batch-analysis.js';
import {setupWorkspaces} from '/workspaces.js';
import {setupExplorer} from '/explorer.js';
import {setupBatches} from '/batches.js';
import {SOURCES,GROUP_LABELS,measure,rowGroup,portDistanceSuffix} from '/shared/catalogue.mjs';
import {setupComparisons} from '/comparison.js';
import {createAreaEditor,setReferenceLayers} from '/map.js';
import {normalizeGeometry,boundsOf} from '/shared/geometry.mjs';
const $=id=>document.getElementById(id);
let reuseController=null;let healthController=null;let infrastructureController=null;let namedBoundary=null;let customGeometry=null;let areaEditor=null;let extractAnalysis=null;let artifactOpenSerial=0;let comparisons=null;let batchController=null;let vesselExplorer=null;let workspaceController=null;let workspaceView='extract';let selectedArtifactId=null;let previewController=null;
const form=$('query');let active=false;
const status=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
async function api(path,options={}){const response=await fetch(path,options);const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;}
function view(name){if(name!=='downloads'){artifactOpenSerial++;if(selectedArtifactId)$('artifact').hidden=false;}if(name==='catalogue')healthController?.activate().catch(e=>status(e.message,true));if(name==='infrastructure')requestAnimationFrame(()=>infrastructureController?.activate());if(name!=='studies')workspaceView=name;else workspaceController?.refresh().catch(e=>status(e.message,true));$('mode').textContent=name==='studies'?'STUDY WORKSPACE · Local queries, evidence and reference layers.':name==='vessels'?'VESSEL EVIDENCE · Identity and inferred events are distinct.':name==='compare'?'COMPARISON · Original sources and versions remain separate.':name==='infrastructure'?'INFRASTRUCTURE · GFW filtered model context.':name==='catalogue'?'DATA & METHODS · Check each product’s source and access conditions.':name==='downloads'?'SAVED EXTRACTS · Source and version are recorded for each result.':query().source!=='synthetic-activity'?`GFW SOURCE · ${SOURCES[query().source].label}`:'SYNTHETIC SOURCE · No observations or API requests.';for(const id of ['extract','downloads','compare','vessels','infrastructure','studies','catalogue'])$(id).hidden=id!==name;for(const b of document.querySelectorAll('nav button')){if(b.dataset.view===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}}
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>view(b.dataset.view));
function query(){const f=new FormData(form);return{source:f.get('source'),start:f.get('start'),end:f.get('end'),grid:Number(f.get('grid')),interval:f.get('interval'),...(customGeometry?{geometry:customGeometry}:{}),...(namedBoundary?{boundarySource:namedBoundary}:{}),bounds:['west','south','east','north'].map(n=>Number(f.get(n))),datasetVersion:f.get('datasetVersion'),grouping:f.get('grouping'),flags:String(f.get('flags')||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean),gears:String(f.get('gears')||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),vesselTypes:String(f.get('vesselTypes')||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),matched:f.get('matched')||'any',...(f.get('source')==='gfw-fishing'&&f.get('distanceFromPortKm')!==''?{distanceFromPortKm:Number(f.get('distanceFromPortKm'))}:{})};}
function configureSource(){
 const source=form.elements.source.value,meta=SOURCES[source],select=form.elements.grouping,previous=select.value;
 select.replaceChildren(...meta.groupings.map(value=>{const option=document.createElement('option');option.value=value;option.textContent=GROUP_LABELS[value];return option;}));
 if(meta.groupings.includes(previous))select.value=previous;
 const presence=source==='gfw-presence',sar=source==='gfw-sar';
 $('port-distance-filter').hidden=source!=='gfw-fishing';form.elements.distanceFromPortKm.disabled=source!=='gfw-fishing';
 $('gear-filter').hidden=presence;form.elements.gears.disabled=presence;
 $('presence-filter').hidden=!presence;form.elements.vesselTypes.disabled=!presence;
 $('sar-filter').hidden=!sar;form.elements.matched.disabled=!sar;
 form.elements.start.min=meta.start;
 $('filter-hint').textContent=presence?'Filter by vessel type; group results by flag or vessel ID. Vessel-type grouping is not supported by the tested endpoint.':sar?'AIS association is a matching result, not a confidence score. Flag/gear filters can exclude detections without an associated identity.':'Comma-separated exact source values. Empty means all. Specific gear filters may exclude generic FISHING classifications.';
}
function summary(){
 batchController?.invalidate();previewController?.invalidate();
 const q=query(),meta=SOURCES[q.source],live=q.source!=='synthetic-activity';
 $('preview-controls').hidden=!live;$('live-settings').hidden=!live;$('synthetic-preview').hidden=live;$('live-review').hidden=!live;
 $('review-mode').textContent=live?'GFW REPORT':'SYNTHETIC';
 $('mode').textContent=live?`GFW SOURCE · ${meta.label} · ${meta.metric}`:'SYNTHETIC SOURCE · No observations or API requests.';
 $('source-hint').textContent=meta.description+(live?` Documented coverage starts ${meta.start}; actual availability varies.`:'');
 const dl=document.createElement('dl');
 const filters=[q.flags.length?`Flags: ${q.flags.join(', ')}`:'',q.gears.length?`Gear: ${q.gears.join(', ')}`:'',q.vesselTypes.length?`Vessel types: ${q.vesselTypes.join(', ')}`:'',q.matched!=='any'?`AIS matched: ${q.matched}`:'',q.source==='gfw-fishing'?`Port/anchorage distance: ${q.distanceFromPortKm===undefined?'not requested (provider default unrecorded)':'≥ '+q.distanceFromPortKm+' km'}`:''].filter(Boolean).join('; ')||'All available';
 for(const [label,value] of [['Source',`${meta.label} · ${live?q.datasetVersion:'fixture-v1'}`],['Measure',meta.metric],['Period (UTC)',`${q.start} → ${q.end}`],['End date','Exclusive'],['Saved grid',`${q.grid}°`],['Saved time bins',q.interval.toLowerCase()],['Group',GROUP_LABELS[q.grouping]],['Filters',filters],['Output',$('batch-mode').checked?'Documented ZIP: CSV + chunk bundles':'Documented ZIP + original JSON bundle']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;dl.append(dt,dd);}
 $('active-boundary-source').textContent=namedBoundary?`Analysis boundary: ${namedBoundary.label} · ${namedBoundary.dataset} / ${namedBoundary.id} · source version ${namedBoundary.version||'not supplied'} · ${namedBoundary.simplify?'provider simplify parameter '+namedBoundary.simplify+' (units unverified)':'no simplification requested'}. Snapshot ${namedBoundary.retrievedAt}.`:'';
 $('summary').replaceChildren(dl);reuseController?.invalidate();workspaceController?.markDirty();$('geometry-label').textContent=customGeometry?`${customGeometry.type} · ${namedBoundary?'named boundary snapshot':'exact imported/drawn coordinates retained'}`:'Rectangle';
 if(areaEditor){const [w,s,e,n]=q.bounds;if(q.bounds.every(Number.isFinite)&&e>w&&n>s)areaEditor.setGeometry(customGeometry||{type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]});}
}
form.elements.source.addEventListener('change',()=>{configureSource();summary();});configureSource();
form.addEventListener('input',event=>{if(['west','south','east','north'].includes(event.target.name)){customGeometry=null;namedBoundary=null;}summary();});summary();
let rasterReviewRevision=0;
function reportLinks(){rasterReviewRevision++;$('raster-download').hidden=true;const applied=extractAnalysis?.current();$('raster-review').disabled=!applied||applied.rows===0;$('raster-summary').replaceChildren();$('raster-warning').textContent='';$('raster-status').textContent=applied?(applied.rows?'Review the applied saved-data selection before downloading.':'No returned coordinates in this selection; a raster cannot be created.'):'Apply saved-data filters before reviewing a GIS export.';for(const id of ['extract-figure','extract-report','extract-selection'])$(id).hidden=!applied||!selectedArtifactId;if(!selectedArtifactId||!applied)return;const params=new URLSearchParams(applied.options);$('extract-figure').href=`/api/artifacts/${selectedArtifactId}/figure?${params}`;$('extract-report').href=`/api/artifacts/${selectedArtifactId}/report?${params}`;$('extract-selection').href=`/api/artifacts/${selectedArtifactId}/selection?${params}`;}
$('raster-review').addEventListener('click',async()=>{const id=selectedArtifactId,revision=++rasterReviewRevision;const applied=extractAnalysis?.current();if(!id||!applied)return;const params=new URLSearchParams(applied.options);$('raster-review').disabled=true;$('raster-download').hidden=true;$('raster-status').textContent='Checking saved values, grid alignment and raster extent locally…';try{const result=await api(`/api/artifacts/${id}/raster-preview?${params}`);if(id!==selectedArtifactId||revision!==rasterReviewRevision)return;const m=result.metadata,dl=$('raster-summary');dl.replaceChildren();for(const [name,value] of [['Source',`${SOURCES[m.source].label} · ${m.requestedVersion}`],['Selection',`${m.selection.start||m.requestedPeriod.start} → ${m.selection.end||m.requestedPeriod.end} (exclusive) · ${m.selection.time||'all labels'} / ${m.selection.group||'all groups'}`],['Measure',`${m.total.toLocaleString(undefined,{maximumSignificantDigits:9})} ${m.units}`],['Grid',`${m.gridDegrees}° · ${m.width} columns × ${m.height} rows`],['CRS / orientation','EPSG:4326 · north-up · cell centres'],['Extent west, south, east, north',m.extent.map(v=>Number(v.toFixed(8))).join(', ')],['Returned / missing pixels',`${m.populatedPixels.toLocaleString()} populated / ${m.missingPixels.toLocaleString()} nodata`],['Encoding','One Float64 band; NaN nodata'],['Coordinate rounding',`${m.coordinateAlignment.maximumAdjustmentDegrees.toExponential(2)}° maximum adjustment`]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;dl.append(dt,dd);}$('raster-warning').textContent=(m.synthetic?'SYNTHETIC DEMONSTRATION — not observations. ':'')+(m.recovered?'RECOVERY: query ownership was accepted by user review. ':'')+m.coverage+' '+m.boundary;params.set('expected',result.id);$('raster-download').href=`/api/artifacts/${id}/raster?${params}`;$('raster-download').hidden=false;$('raster-status').textContent='Ready. Export uses this reviewed selection without an upstream request.';}catch(e){if(id===selectedArtifactId&&revision===rasterReviewRevision)$('raster-status').textContent=e.message;}finally{if(id===selectedArtifactId&&revision===rasterReviewRevision)$('raster-review').disabled=false;}});

async function openArtifact(id,options={},viewport=null){const serial=++artifactOpenSerial;batchAnalysis.close();$('artifact').hidden=true;let a;try{a=await api(`/api/artifacts/${id}`);}catch(e){if(serial!==artifactOpenSerial)return false;$('artifact').hidden=!selectedArtifactId;throw e;}if(serial!==artifactOpenSerial)return false;selectedArtifactId=id;$('artifact').hidden=false;$('measure-heading').textContent=a.manifest.units;$('mode').textContent=`SAVED DATA · ${SOURCES[a.manifest.source]?.label||a.manifest.source} · ${a.manifest.datasetVersion} · ${a.manifest.units}`;$('extract-source-caveats').textContent=a.files['caveats.txt'];$('artifact-meta').textContent=`${SOURCES[a.manifest.source]?.label||a.manifest.source} · requested ${a.manifest.datasetVersion} · reported ${a.query.source==='synthetic-activity'?'not applicable':a.manifest.responseVersion||'not supplied'}${a.query.source==='gfw-fishing'?' · minimum port distance: '+(a.query.distanceFromPortKm===undefined?'not requested / provider default unrecorded':a.query.distanceFromPortKm+' km'):''} · ${a.manifest.rows} rows · ${a.query.grid}° · ${a.query.interval} · ${a.query.start} to ${a.query.end} (exclusive)${a.manifest.provenance.request?.recovery?' · RECOVERED: ownership confirmed by user, not provider':''}`;const identity=document.createElement('span');identity.textContent=` · local ${id.slice(0,8)} · source ${a.manifest.id} · payload received ${a.manifest.provenance?.receivedAt||'not separately recorded'}`;$('artifact-meta').append(identity);$('artifact-boundary-source').textContent=a.query.boundarySource?`Analysis boundary: ${a.query.boundarySource.label} · ${a.query.boundarySource.dataset} / ${a.query.boundarySource.id} · source version ${a.query.boundarySource.version||'not supplied'} · retrieved ${a.query.boundarySource.retrievedAt}. ${a.query.boundarySource.simplify?'Experimental provider simplify parameter '+a.query.boundarySource.simplify+'; units unverified.':'No simplification requested.'}`:'';$('bundle').href=`/api/artifacts/${id}/bundle`;$('extract-package').href=`/api/artifacts/${id}/package`;$('handoff-details').open=false;$('raster-details').open=false;for(const name of ['handoff-summary','handoff-dictionary','handoff-conditions','handoff-status'])$(name).textContent='';$('review-handoff').disabled=false;$('manifest').textContent=JSON.stringify(a.manifest,null,2);extractAnalysis.open(a,options,viewport);return Boolean(extractAnalysis.current());}
let jobsRenderSignature=null,refreshingJobs=null,reviewedRecovery=null,requestedJobFocus=null;const watchStates=new Map();
async function refresh(force=false){if(refreshingJobs){if(!force)return refreshingJobs;while(refreshingJobs)await refreshingJobs;}const work=refreshJobs();refreshingJobs=work;try{return await work;}finally{if(refreshingJobs===work)refreshingJobs=null;}}
async function refreshJobs(){
 const jobs=await api('/api/jobs?summary=true');$('count').textContent=jobs.length;
 active=jobs.some(j=>['queued','running','checking-recovery'].includes(j.status)||['watching','checking','stopping'].includes(j.recoveryWatch?.status));
 const signature=JSON.stringify(jobs);if(signature!==jobsRenderSignature){jobsRenderSignature=signature;const focused=document.activeElement,fallback=focused===document.body||focused===document.documentElement?requestedJobFocus:null,focusJob=focused?.closest?.('[data-job-id]')?.dataset.jobId||fallback?.id,focusAction=focused?.dataset?.jobAction||fallback?.action;
 for(const job of jobs){const prior=watchStates.get(job.id),watch=job.recoveryWatch;if(watch&&prior?.id===watch.id&&prior.status!=='stopped'&&watch.status==='stopped')status(`Automatic recovery checks stopped: ${watch.reason.replaceAll('-',' ')}. The original job remains unresolved until reviewed.`);if(watch)watchStates.set(job.id,{id:watch.id,status:watch.status});}
 $('jobs').replaceChildren();
 if(!jobs.length){const a=document.createElement('article');a.textContent='No saved extracts yet. Build an extract to begin.';$('jobs').append(a);}
 for(const job of jobs){
  const a=document.createElement('article');a.className='job';a.dataset.jobId=job.id;a.tabIndex=-1;
  const d=document.createElement('div'),title=document.createElement('strong'),p=document.createElement('p');
  title.textContent=`${job.batchId?'Batch chunk · ':''}${job.query.start} → ${job.query.end} · ${SOURCES[job.query.source]?.label||job.query.source}`;
  a.setAttribute('aria-label',title.textContent);p.textContent=`${job.query.grid}° / ${job.query.interval.toLowerCase()} · ${job.status}${portDistanceSuffix(job.query)}${job.rows!==undefined?` · ${job.rows} rows`:''}`;d.append(title,p);const identity=document.createElement('p');identity.className='hint';identity.textContent=`Local record ${job.id.slice(0,8)} · ${job.createdAt||'creation time not recorded'}${job.importedFrom?' · imported source '+job.importedFrom:''}`;d.append(identity);
  if(job.error){const e=document.createElement('p');e.textContent=job.error;d.append(e);}
  if(job.recovery){const e=document.createElement('p');e.className='hint';e.textContent=`Recovery: ${job.recovery.state} · checked ${job.recovery.checkedAt}${job.recovery.summary?` · ${job.recovery.summary.rows} candidate rows`:''}`;d.append(e);}
  if(job.retryAfter?.notBefore){const wait=document.createElement('p');wait.className='hint';wait.textContent=`Provider retry wait: until ${job.retryAfter.notBefore}. New attempts remain manual.`;d.append(wait);}
  const watching=['watching','checking','stopping'].includes(job.recoveryWatch?.status);if(job.recoveryWatch){const w=job.recoveryWatch,e=document.createElement('p');e.className='hint';e.textContent=`Automatic checks: ${w.status} · ${w.checks}/${w.maxChecks} checks${w.nextCheckAt?' · next '+w.nextCheckAt:''}${w.reason?' · '+w.reason.replaceAll('-',' '):''}. Only the existing last report is checked; it is never resubmitted or accepted automatically.`;d.append(e);}
  a.append(d);const actions=document.createElement('div');actions.className='job-actions';
  const button=(label,handler)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.jobAction=label;b.addEventListener('click',async()=>{const request={id:job.id,action:label};if(document.activeElement===b)requestedJobFocus=request;b.disabled=true;try{await handler();}catch(e){status(e.message,true);}finally{b.disabled=false;if(requestedJobFocus===request)requestedJobFocus=null;if(document.activeElement===document.body&&b.isConnected)b.focus({preventScroll:true});}});actions.append(b);};
  const act=async(action,body={})=>{await api(`/api/jobs/${job.id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const rows=await refresh(true),current=rows.find(j=>j.id===job.id);if(action==='accept-recovery'){reviewedRecovery=null;$('recovery-review').hidden=true;await openArtifact(job.id);status('Reviewed result saved. Its manifest records your manual association.');}else if(action==='watch-recovery')status(current?.recoveryWatch?.status==='stopped'?`Automatic checks stopped: ${current.recoveryWatch.reason.replaceAll('-',' ')}.`:'Automatic recovery checks started. The existing report is checked without submitting it again.');else if(action==='stop-recovery-watch')status('Automatic checks stopped locally. The remote report was not cancelled.');else if(action==='recover'&&current?.recovery)status(current.recovery.message);else if(action==='release')status('Unresolved job closed locally. No data was marked complete.');};
  if(job.status==='complete')button('Inspect extract →',()=>openArtifact(job.id));
  if(['failed','needs-authentication','rate-limited','incomplete','paused','cancelled','abandoned'].includes(job.status))button('Run a new attempt',()=>act('retry'));
  if(job.status==='queued')button('Pause queued job',()=>act('pause'));
  if(['running','queued','paused'].includes(job.status))button(job.status==='running'?'Stop waiting locally':'Cancel queued job',()=>act('cancel'));
  if(watching)button('Stop automatic checks',()=>act('stop-recovery-watch'));
  if(job.status==='recovery-needed'&&!watching){
   button('Check GFW last report',()=>act('recover'));
   if(job.recovery?.state!=='candidate')button('Check automatically · up to 15 min',()=>act('watch-recovery'));
   if(job.recovery?.state==='candidate'){
    button('Review possible result',async()=>{const candidate=await api(`/api/jobs/${job.id}/candidate`);reviewedRecovery={id:job.id,hash:candidate.candidateHash};$('recovery-review').hidden=false;renderRecovery(candidate);$('recovery-review').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});$('recovery-review').focus({preventScroll:true});});
    button('Accept reviewed result',async()=>{if(reviewedRecovery?.id!==job.id)throw Error('Open and review this candidate before accepting it.');if(window.confirm('Only accept after verifying that this is your report: area, dates, version, grain, grouping and filters. GFW does not prove ownership; another session may have produced this result. The manifest will record your manual association. Have you verified this candidate?'))await act('accept-recovery',{confirmOwnership:true,candidateHash:reviewedRecovery.hash});});
   }
   button('Close unresolved job',async()=>{if(window.confirm('Review other GFW sessions first. This closes only the local job; remote processing may still be active. No data is marked complete. A later attempt can duplicate prior work. Close this local job?'))await act('release',{confirmRemoteReview:true});});
  }
  a.append(actions);$('jobs').append(a);
 }
 if(focusJob){const article=[...$('jobs').children].find(a=>a.dataset.jobId===focusJob);const target=article&&[...article.querySelectorAll('button')].find(b=>b.dataset.jobAction===focusAction);(target||article)?.focus({preventScroll:true});}
 }
 comparisons?.setJobs(jobs);active=(await batchController?.refresh())||active;return jobs;
}
function clearActiveData(){artifactOpenSerial++;selectedArtifactId=null;extractAnalysis.clear();batchAnalysis.close();$('artifact').hidden=true;}
async function retrieveFresh(reviewedQuery){
 if($('batch-mode').checked){await batchController.runReviewed();clearActiveData();view('downloads');await refresh(true);status('Historical batch started. Completed chunks are saved independently.');return;}
 const job=await api('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reviewedQuery)});clearActiveData();status(job.query.source==='synthetic-activity'?'Synthetic extract queued. No upstream API was called.':'GFW report submitted. Keep this server running until it completes.');view('downloads');const saved=await refresh(true);if(saved.find(j=>j.id===job.id)?.status==='complete')await openArtifact(job.id);
}
form.addEventListener('submit',async event=>{event.preventDefault();$('run').disabled=true;try{await reuseController.reviewBeforeRun();}catch(e){status(e.message,true);}finally{if($('batch-mode').checked)batchController.invalidate();else $('run').disabled=false;}});

async function init(){try{const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);if(token)await api('/api/session',{method:'POST',headers:{'X-Bootstrap':token}});await refresh(true);await connectionStatus();await vesselExplorer.refreshHistory();await infrastructureController.refreshHistory();await vmsCatalogue.refresh();status('Local workspace connected. Saved data stays on this machine.');}catch(e){status(e.message,true);$('run').disabled=true;}}
healthController=setupHealth({api,onError:message=>status(message,true)});
const vmsCatalogue=setupVmsCatalogue({api,onError:message=>status(message,true)});
infrastructureController=setupInfrastructure({api,getQuery:query,onError:message=>status(message,true)});
vesselExplorer=setupExplorer({api,getQuery:query,openBuilder:()=>view('extract'),onError:message=>status(message,true)});
extractAnalysis=setupExtractAnalysis({onApplied:()=>{reportLinks();status('Saved-data selection applied locally. No new upstream request.');},onStale:reportLinks,onError:message=>status(message,true),onDirty:()=>workspaceController?.markDirty()});
const batchAnalysis=setupBatchAnalysis({api,onDirty:()=>workspaceController?.markDirty(),onError:message=>status(message,true)});
batchController=setupBatches({api,getQuery:query,onError:message=>status(message,true),openArtifact,openBatch:id=>{artifactOpenSerial++;selectedArtifactId=null;extractAnalysis.clear();return batchAnalysis.open(id);},onImported:async()=>{await refresh(true);status('Historical archive verified locally. Choose Analyze to inspect the complete or partial batch.');},onRefresh:batches=>batchAnalysis.observe(batches),onPlanChange:()=>reuseController?.refreshActions(),onActivity:value=>{active ||= value;}});
reuseController=setupSavedReuse({api,getQuery:query,onError:message=>status(message,true),canFetch:()=>!$('batch-mode').checked||batchController.isReviewed(),freshLabel:()=>$('batch-mode').checked?'Start reviewed batch':query().source==='synthetic-activity'?'Generate a new synthetic extract':'Retrieve a fresh API result',onFresh:retrieveFresh,onUse:async chosen=>{view('downloads');let opened;if(chosen.kind==='artifact')opened=await openArtifact(chosen.id,chosen.options);else{clearActiveData();opened=await batchAnalysis.open(chosen.id,chosen.options);}if(opened)status('Verified saved data opened locally. No new extraction was submitted. The builder draft remains unchanged.');return opened;}});
comparisons=setupComparisons({api,onError:message=>status(message,true)});
document.querySelector('main').inert=true;
await init();setInterval(()=>{if(active)refresh().catch(e=>{active=false;status(e.message,true);});},2000);

async function connectionStatus(){const c=await api('/api/connection');$('connection-status').textContent=c.connected?'Token configured in memory; authorization is checked on retrieval.':'No API token configured.';}
$('connection').addEventListener('submit',async event=>{event.preventDefault();const field=event.target.elements.token;try{const token=field.value.trim();field.value='';previewController?.stop();await api('/api/connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});await connectionStatus();status('Personal token configured for this local session.');}catch(e){status(e.message,true);}});
$('disconnect').addEventListener('click',async()=>{try{previewController?.stop();await api('/api/connection',{method:'DELETE'});await connectionStatus();status('Token cleared from server memory. An already-submitted request may still finish.');}catch(e){status(e.message,true);}});
let extractImportController=null;
$('stop-extract-import').addEventListener('click',()=>extractImportController?.abort());
$('import-bundle').addEventListener('change',async event=>{
 const input=event.target;try{const file=input.files[0];if(!file)return;const zipped=/\.zip$/i.test(file.name)||file.type==='application/zip',limit=(zipped?256:40)*1024*1024;if(file.size>limit)throw Error(`Extract exceeds the ${zipped?'256 MiB ZIP':'40 MiB JSON'} import limit.`);
 input.disabled=true;$('stop-extract-import').disabled=false;extractImportController=new AbortController();$('extract-import-status').textContent='Uploading to this local server and checking files…';
 const job=await api(zipped?'/api/import-extract-package':'/api/import',{method:'POST',headers:{'Content-Type':zipped?'application/zip':'application/json'},body:file,signal:extractImportController.signal});
 await refresh(true);await openArtifact(job.id);$('extract-import-status').textContent=zipped?'Extract imported locally. Source files and supported package documentation verified.':'JSON bundle imported locally. File checksums and query schema verified.';
 }catch(e){$('extract-import-status').textContent=e.name==='AbortError'?'Import stopped. If validation had already finished, check the saved list before importing again.':e.message;status(e.message,true);}finally{input.value='';input.disabled=false;extractImportController=null;$('stop-extract-import').disabled=true;}
});
$('review-handoff').addEventListener('click',async()=>{const id=selectedArtifactId;if(!id)return;$('review-handoff').disabled=true;try{const docs=await api(`/api/artifacts/${id}/documentation`);if(selectedArtifactId!==id)return;$('handoff-summary').textContent=docs['query-summary.txt'];$('handoff-dictionary').textContent=docs['data-dictionary.json'];$('handoff-conditions').textContent=docs['source-citation.txt']+'\n'+docs['use-conditions.txt'];$('handoff-status').textContent='Documentation generated locally from this saved extract. No upstream request.';}catch(e){if(selectedArtifactId===id){$('handoff-status').textContent=e.message;$('review-handoff').disabled=false;}}});

function applyArea(geometry,bounds,source=null){
 namedBoundary=source;customGeometry=geometry;const b=bounds||boundsOf(geometry);
 for(const [i,name] of ['west','south','east','north'].entries())form.elements[name].value=b[i];
 summary();
}
areaEditor=createAreaEditor({onChange:applyArea,onError:message=>status(message,true),onViewChange:()=>workspaceController?.markDirty()});
previewController=setupPreview({api,getQuery:query,editor:areaEditor,onError:message=>status(message,true)});
setupRegions({api,onError:message=>status(message,true),apply:record=>{applyArea(record.geometry,null,record.source);areaEditor.fit();status('Named boundary applied locally. No report has been requested.');}});
summary();areaEditor.fit();
$('fit-area').addEventListener('click',()=>areaEditor.fit());
$('import-area').addEventListener('change',async event=>{
 try{const file=event.target.files[0];if(!file)return;if(file.size>16*1024*1024)throw Error('Boundary file exceeds 16 MiB.');
 applyArea(normalizeGeometry(JSON.parse(await file.text())));areaEditor.fit();status('Boundary loaded into draft query; nothing sent to GFW.');
 }catch(e){status(e.message,true);}finally{event.target.value='';}
});

function renderRecovery(candidate){
 const q=candidate.requestedQuery;const dl=document.createElement('dl');
 const fields=[['Requested source',SOURCES[q.source]?.label||q.source],['Requested version',q.datasetVersion],['Reported version',candidate.reportedVersion||'Not supplied'],['Requested dates (UTC)',`${q.start} → ${q.end} (exclusive)`],['Returned dates',`${candidate.summary.firstDate||'No rows'} → ${candidate.summary.lastDate||'No rows'}`],['Requested detail',`${q.grid}° · ${q.interval} · ${q.grouping}`],['Requested area',`${q.geometry?.type||'Rectangle'} · bounds ${q.bounds.join(', ')}; not verified by provider`],['Requested filters',`Flags: ${q.flags.join(', ')||'all'}; gear: ${q.gears.join(', ')||'all'}; vessel types: ${(q.vesselTypes||[]).join(', ')||'all'}; matched: ${q.matched||'any'}; minimum port distance: ${q.distanceFromPortKm===undefined?'not requested / unrecorded default':q.distanceFromPortKm+' km'}`],['Candidate rows',candidate.summary.rows],['Filters and ownership','Not established by provider metadata']];
 for(const [name,value] of fields){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;dl.append(dt,dd);}
 $('recovery-summary').replaceChildren(dl);$('recovery-value-heading').textContent=candidate.summary.units;$('recovery-content').textContent=JSON.stringify(candidate,null,2);
 $('recovery-rows').replaceChildren(...candidate.sampleRows.map(row=>{const tr=document.createElement('tr');for(const v of [row.date,row.lat,row.lon,rowGroup(row,q),measure(row).toLocaleString(undefined,{maximumFractionDigits:3})]){const td=document.createElement('td');td.textContent=v;tr.append(td);}return tr;}));
}

function captureWorkspace(){return {query:query(),presentation:{viewport:areaEditor.viewport(),batching:{enabled:$('batch-mode').checked,chunkMonths:Number($('batch-months').value)},activeView:workspaceView,artifactId:selectedArtifactId,artifactView:extractAnalysis?.presentation()||null,...batchAnalysis.presentation(),comparisonId:comparisons.currentId(),lookupId:vesselExplorer.currentId(),vesselSetId:vesselExplorer.currentSetId(),...infrastructureController.presentation()}};}
async function restoreWorkspace(opened){
 const {revision,availability}=opened,q=revision.query;previewController?.stop();batchController.resetReview();batchAnalysis.close();infrastructureController.clear();
 $('batch-mode').checked=revision.presentation.batching?.enabled===true;$('batch-controls').hidden=!$('batch-mode').checked;$('batch-months').value=revision.presentation.batching?.chunkMonths||1;
 form.elements.source.value=q.source;configureSource();
 for(const name of ['start','end','grid','interval','datasetVersion','grouping'])if(form.elements[name]&&q[name]!==undefined&&!(name==='datasetVersion'&&q.source==='synthetic-activity'))form.elements[name].value=q[name];
 for(const name of ['flags','gears','vesselTypes'])form.elements[name].value=(q[name]||[]).join(', ');form.elements.matched.value=q.matched||'any';form.elements.distanceFromPortKm.value=q.distanceFromPortKm??'';
 namedBoundary=q.boundarySource||null;customGeometry=q.geometry||null;for(const [i,name] of ['west','south','east','north'].entries())form.elements[name].value=q.bounds[i];
 summary();areaEditor.restoreViewport(revision.presentation.viewport);artifactOpenSerial++;selectedArtifactId=null;extractAnalysis.clear();$('artifact').hidden=true;
 const resolved=(kind,id)=>availability.find(r=>r.kind===kind&&r.id===id&&r.status==='available')?.resolvedId;
 const p=revision.presentation;
 if(resolved('vessel-set',p.vesselSetId))await vesselExplorer.openSetRevision(resolved('vessel-set',p.vesselSetId));else vesselExplorer.clearSet();
 if(resolved('infrastructure',p.infrastructureId))await infrastructureController.openSaved(resolved('infrastructure',p.infrastructureId),p.infrastructureOptions||{},p.infrastructureOverlay);
 if(p.activeView==='downloads'&&resolved('artifact',p.artifactId)){view('downloads');await openArtifact(resolved('artifact',p.artifactId),p.artifactView?.options||{},p.artifactView?.viewport);}
 else if(p.activeView==='downloads'&&resolved('batch',p.batchId)){view('downloads');if(!await batchAnalysis.open(resolved('batch',p.batchId),p.batchView?.options||{},p.batchView?.viewport,availability.find(r=>r.kind==='batch'&&r.id===p.batchId)?.sha256))throw Error('Study plan opened, but its historical view could not be restored. Review the batch analysis message.');} else if(p.activeView==='infrastructure'&&resolved('infrastructure',p.infrastructureId))view('infrastructure');
 else if(p.activeView==='compare'&&resolved('comparison',p.comparisonId)){view('compare');await comparisons.openSaved(resolved('comparison',p.comparisonId));}
 else if(p.activeView==='vessels'&&resolved('lookup',p.lookupId)){view('vessels');await vesselExplorer.openSaved(resolved('lookup',p.lookupId));}
 else if(p.activeView==='vessels'&&resolved('vessel-set',p.vesselSetId))view('vessels');
 else view(p.activeView==='catalogue'?'catalogue':'extract');
 status(`Opened study “${revision.title}”. No new upstream request was submitted.${availability.some(r=>r.status!=='available')?' Some references are missing or changed; the study plan retains their checksums.':''}`);
}
workspaceController=setupWorkspaces({api,capture:captureWorkspace,restore:restoreWorkspace,setLayers:setReferenceLayers,showLayer:layer=>{view('extract');areaEditor.fitReference(layer.geojson);},onError:message=>status(message,true)});

if(!$('studies').hidden)workspaceController.refresh().catch(e=>status(e.message,true));

try{await workspaceController.restoreLast();}catch(e){status(e.message,true);}finally{document.querySelector('main').inert=false;}

setupBulkInfrastructure({api,getQuery:query,onError:message=>status(message,true)});
