import {createComparisonMaps} from '/map.js';
const $=id=>document.getElementById(id);
import {SOURCES,portDistanceSuffix} from '/shared/catalogue.mjs';
const sourceName=id=>SOURCES[id]?.label||id;
const number=value=>value===null?'Unavailable':(Math.abs(value)<0.0005?0:value).toLocaleString(undefined,{maximumFractionDigits:3});
const addText=(tag,text,parent)=>{const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;};
export function setupComparisons({api,onError}){
 let jobsSignature=null;
 let maps,report,loadedHistory=false,groupPage=0,availableJobs=[];
 async function refreshHistory(){
  const items=await api('/api/comparisons');const select=$('comparison-history'),selected=select.value;
  select.replaceChildren();const blank=addText('option','Choose a saved comparison',select);blank.value='';
  for(const item of items){const option=addText('option',`${item.parents[0].query.start} vs ${item.parents[1].query.start} · ${item.normalization} · ${item.createdAt.slice(0,16)}`,select);option.value=item.id;}
  select.value=selected;
 }
 function renderGroups(){
  if(!report)return;const filter=$('comparison-group-search').value.toLowerCase();const groups=report.groups.filter(g=>g.group.toLowerCase().includes(filter));
  const pages=Math.max(1,Math.ceil(groups.length/50));groupPage=Math.min(Math.max(groupPage,0),pages-1);
  $('comparison-groups').replaceChildren();for(const row of groups.slice(groupPage*50,(groupPage+1)*50)){const tr=document.createElement('tr');for(const value of [row.group,number(row.left),number(row.right),number(row.delta)])addText('td',value,tr);$('comparison-groups').append(tr);}
  $('comparison-groups-note').textContent=`Page ${groupPage+1} of ${pages} · ${groups.length} matching groups. Missing values remain unavailable. Differences use comparison minus baseline.`;
  $('comparison-previous').disabled=groupPage===0;$('comparison-next').disabled=groupPage===pages-1;
 }
 function renderSeries(){
  const root=$('comparison-series');root.replaceChildren();const commonUnits=report.units[0]===report.units[1];
  const maxes=report.series.map(rows=>rows.reduce((max,r)=>Math.max(max,r.value??0),0));
  for(let index=0;index<2;index++){
   const panel=document.createElement('div');addText('h3',index?'Comparison':'Baseline',panel);addText('p',report.units[index],panel);
   const max=commonUnits?Math.max(...maxes):maxes[index];
   for(const row of report.series[index].slice(0,31)){
    const line=document.createElement('div');line.className='series-row';addText('span',row.date.slice(0,10),line);
    const track=document.createElement('div');track.className='series-track';const bar=document.createElement('span');bar.style.width=`${max?row.value/max*100:0}%`;track.append(bar);line.append(track);addText('span',number(row.value),line);panel.append(line);
   }
   addText('p',`${commonUnits?'Shared':'Independent'} scale. Showing ${Math.min(31,report.series[index].length)} of ${report.series[index].length} bins; all bins are included in the export.`,panel).className='hint';root.append(panel);
  }
 }
 function show(record){
  report=record.report;$('compare-left').value=report.parents[0].localId;$('compare-right').value=report.parents[1].localId;$('compare-normalization').value=report.normalization;selectionSummary();$('comparison-result').hidden=false;$('comparison-download').href=`/api/comparisons/${record.id}/download`;
  $('comparison-verdict').textContent=report.canComputeDifference?'Settings permit a descriptive difference in returned data. Coverage limitations still apply.':'Differences are disabled. Review the mismatched settings below; the source results remain separate.';
  $('comparison-warnings').replaceChildren();for(const warning of report.warnings)addText('li',warning,$('comparison-warnings'));
  $('comparison-settings').open=!report.canComputeDifference;$('comparison-settings-label').textContent=`Review settings · ${report.checks.filter(c=>c.match).length}/${report.checks.length} compatible`;
  $('comparison-checks').replaceChildren();
  const format=value=>Array.isArray(value)?(value.join(', ')||'All'):value&&typeof value==='object'?`${value.type}; exact coordinates retained in provenance`:String(value);
  for(const check of report.checks){const tr=document.createElement('tr');for(const v of [check.label,format(check.left),format(check.right),check.unknown?'Not verified':check.normalized?'Normalized per calendar day':check.match?'Matched':'Different'])addText('td',v,tr);$('comparison-checks').append(tr);}
  $('comparison-totals').replaceChildren();
  for(const [title,value,unit] of [['Baseline',report.summary.left,report.units[0]],['Comparison',report.summary.right,report.units[1]],['Difference',report.summary.delta,report.canComputeDifference?report.units[0]:'Disabled by compatibility checks']]){const panel=document.createElement('div');addText('h3',title,panel);addText('p',number(value),panel).className='comparison-value';addText('p',unit,panel);$('comparison-totals').append(panel);}
  addText('p',`Percentage change: ${report.summary.percentage===null?'undefined / unavailable':number(report.summary.percentage)+'%'}`,$('comparison-totals'));
  for(let index=0;index<2;index++){const q=report.parents[index].query;$(`compare-${index?'right':'left'}-label`).textContent=`${sourceName(q.source)} · ${q.datasetVersion} · ${q.start} → ${q.end} (exclusive) · ${report.units[index]}${portDistanceSuffix(q)}`;}
  maps ||= createComparisonMaps();maps.show(report);groupPage=0;$('comparison-group-search').value='';renderGroups();renderSeries();
  $('comparison-provenance').textContent=JSON.stringify({transformation:report.transformation,createdAt:report.createdAt,normalization:report.normalization,parents:report.parents},null,2);
 }
 $('compare-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
  try{const record=await api('/api/comparisons',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leftId:$('compare-left').value,rightId:$('compare-right').value,normalization:$('compare-normalization').value})});show(record);await refreshHistory();$('comparison-history').value=record.id;}
  catch(e){onError(e.message);}finally{button.disabled=false;}
 });
 $('comparison-history').addEventListener('change',async event=>{if(!event.target.value)return;try{show(await api(`/api/comparisons/${event.target.value}`));}catch(e){onError(e.message);}});
 $('comparison-group-search').addEventListener('input',()=>{groupPage=0;renderGroups();});
 $('comparison-previous').addEventListener('click',()=>{groupPage--;renderGroups();});$('comparison-next').addEventListener('click',()=>{groupPage++;renderGroups();});
 function selectionSummary(){
  for(const side of ['left','right']){const job=availableJobs.find(j=>j.id===$(`compare-${side}`).value);$(`compare-${side}-selection`).textContent=job?`${job.query.start} → ${job.query.end} · ${job.query.grid}° · ${job.query.interval} · ${job.query.datasetVersion}${portDistanceSuffix(job.query)}`:'';}
  $('comparison-stale').textContent=report&&(report.parents[0].localId!==$('compare-left').value||report.parents[1].localId!==$('compare-right').value||report.normalization!==$('compare-normalization').value)?'Settings changed. The displayed result belongs to the previous selection; run Compare to apply changes.':'';
 }
 for(const id of ['compare-left','compare-right','compare-normalization'])$(id).addEventListener('change',selectionSummary);
 return {currentId:()=>$('comparison-history').value||null,openSaved:async id=>show(await api(`/api/comparisons/${id}`)),setJobs(jobs){
  availableJobs=jobs;const signature=JSON.stringify(jobs.filter(j=>j.status==='complete'));if(signature===jobsSignature&&loadedHistory)return;jobsSignature=signature;
  for(const id of ['compare-left','compare-right']){const select=$(id),value=select.value;select.replaceChildren();const blank=addText('option','Choose a saved extract',select);blank.value='';for(const job of jobs.filter(j=>j.status==='complete')){const option=addText('option',`${sourceName(job.query.source)} · ${job.query.datasetVersion} · ${job.query.start} → ${job.query.end} · ${job.query.grid}°${portDistanceSuffix(job.query)} · ${job.id.slice(0,8)}`,select);option.value=job.id;}select.value=value;}
  selectionSummary();
  if(!loadedHistory){loadedHistory=true;refreshHistory().catch(e=>{loadedHistory=false;onError(e.message);});}
 }};
}
