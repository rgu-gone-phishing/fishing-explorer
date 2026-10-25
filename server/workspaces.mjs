import {portDistanceSuffix} from '../shared/catalogue.mjs';
import {analysisOptions,batchViewShape} from './batch-analysis.mjs';
import {batchFingerprint} from './batch-record.mjs';
import {savedViewOptions,savedViewShape} from '../shared/saved-analysis.mjs';
import {searchLabel} from '../shared/vessel-search.mjs';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validate,hash} from './domain.mjs';
import {normalizeReference,csvReference} from '../shared/reference-layers.mjs';
import {infrastructureDisplay} from '../shared/infrastructure.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const types={'bulk-infrastructure':'bulk-infrastructure','vessel-set':'vessel-set',artifact:'artifact',comparison:'comparison',lookup:'explore',batch:'batch',layer:'layer',infrastructure:'infrastructure'};
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Error('Missing or oversized text field.');return value.trim();};
const date=value=>{if(!value)return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Error('Use valid ISO dates for layer validity.');return value;};
function viewViewport(value){if(!value)return null;if(!Array.isArray(value.center)||value.center.length!==2||value.center.some(n=>typeof n!=='number'||!Number.isFinite(n))||Math.abs(value.center[0])>85||Math.abs(value.center[1])>180||!Number.isFinite(value.zoom)||value.zoom<1||value.zoom>14)throw Error('Invalid saved viewport.');return {center:[...value.center],zoom:value.zoom};}
export class WorkspaceStore{
 constructor(workspace,jobs,explorer,batches){this.workspace=workspace;this.jobs=jobs;this.explorer=explorer;this.batches=batches;this.locks=new Set();}
 async read(prefix,id){if(!uuid.test(id))throw Error('Invalid resource ID.');const record=JSON.parse(await readFile(join(this.workspace,`${prefix}-${id}.json`),'utf8'));if(record.sha256!==hash(record.data))throw Error('Workspace resource integrity check failed.');return record.data;}
 async write(prefix,data){await this.jobs.atomic(`${prefix}-${data.id}.json`,{data,sha256:hash(data)});}
 async all(prefix,project=value=>value){const result=[];for(const file of await readdir(this.workspace))if(file.startsWith(prefix+'-')&&file.endsWith('.json')){const id=file.slice(prefix.length+1,-5);if(!uuid.test(id))continue;try{result.push(project(await this.read(prefix,id)));}catch{this.jobs.diagnostics.push({file,error:'Workspace resource failed integrity validation.'});}}return result;}
 async layers(){return this.all('layer',l=>({id:l.id,metadata:l.metadata,createdAt:l.createdAt,features:l.geojson.features.length,sha256:hash(l)}));}
 async importLayer(input,{restore}={}){
  if(!input||!['geojson','csv'].includes(input.format)||typeof input.content!=='string'||Buffer.byteLength(input.content)>5*1024*1024)throw Error('Import a GeoJSON or CSV file up to 5 MiB.');
  const m=input.metadata||{};const metadata={title:text(m.title,120,true),provider:text(m.provider||'User supplied',200),citation:text(m.citation,1000,true),license:text(m.license||'Not specified',2000),redistribution:m.redistribution||'unknown',sector:m.sector||'reference',status:m.status||'unspecified',validFrom:date(m.validFrom),validTo:date(m.validTo),crs:'EPSG:4326',permissionEvidence:'User supplied; not independently verified'};
  if(!['unknown','permitted','restricted'].includes(metadata.redistribution)||!['reference','oil-gas','mining','environment'].includes(metadata.sector)||!['unspecified','proposed','reported-active','historical'].includes(metadata.status))throw Error('Unsupported reference-layer metadata value.');
  if(metadata.validFrom&&metadata.validTo&&metadata.validTo<metadata.validFrom)throw Error('Validity end precedes start.');
  const geojson=input.format==='geojson'?normalizeReference(JSON.parse(input.content.replace(/^\uFEFF/,''))):csvReference(input.content,input.columns||{});
  if(Buffer.byteLength(JSON.stringify(geojson))>10*1024*1024)throw Error('Normalized layer exceeds the 10 MiB display limit.');
  const layer={schemaVersion:1,type:'reference-layer',id:restore?.id||randomUUID(),createdAt:restore?.createdAt||new Date().toISOString(),metadata,original:{name:text(input.name||'reference',200),format:input.format,columns:input.format==='csv'?{longitudeColumn:input.columns.longitudeColumn,latitudeColumn:input.columns.latitudeColumn}:null,content:input.content,sha256:hash(input.content)},geojson,transformation:input.format==='csv'?'Explicit coordinate-column mapping to WGS84 points; original bytes retained.':'Geometry validated without simplification; original file retained.'};
  const key=`layer:${layer.id}`;if(this.locks.has(key))throw Error('This reference layer is already being imported.');this.locks.add(key);
  try{
    if(restore){if(!uuid.test(layer.id)||!Number.isFinite(Date.parse(layer.createdAt))||hash(layer)!==hash(restore))throw Error('Reference backup does not match its validated original data and metadata.');try{const existing=await this.read('layer',layer.id);if(hash(existing)!==hash(layer))throw Error('Reference ID already exists with different contents.');return existing;}catch(error){if(error.code!=='ENOENT')throw error;}}
    await this.write('layer',layer);return layer;
  }finally{this.locks.delete(key);}
 }
 async importLayerBackup(bundle){if(!bundle?.layer||bundle.sha256!==hash(bundle.layer)||bundle.layer.type!=='reference-layer'||bundle.layer.schemaVersion!==1)throw Error('Invalid reference-layer backup or checksum.');const l=bundle.layer;if(l.original.sha256!==hash(l.original.content))throw Error('Original reference file checksum failed.');return this.importLayer({format:l.original.format,name:l.original.name,content:l.original.content,columns:l.original.columns,metadata:l.metadata},{restore:l});}
 async resource(kind,id){
  if(!Object.hasOwn(types,kind)||!uuid.test(id))throw Error('Invalid reference.');
  if(kind==='vessel-set')return this.vesselSets.revision(id);
  if(kind==='layer')return this.read('layer',id);
  if(kind==='artifact')return this.jobs.artifact(id);
  if(kind==='lookup'){const s=await this.explorer.get(id);if(!s.complete)throw Error('Attach completed lookups only.');return s;}
  if(kind==='bulk-infrastructure'){const s=await this.bulkInfrastructure.get(id);if(s.status!=='complete')throw Error('Attach bulk records after all source files are saved.');for(const [kind,file] of Object.entries(s.files))await this.bulkInfrastructure.verifyFile(id,kind,file);return s;}
  if(kind==='infrastructure'){const s=await this.infrastructure.get(id);if(s.tiles.some(t=>t.status!=='saved'))throw Error('Attach infrastructure after all planned tiles are retrieved.');return s;}
  if(kind==='batch')return this.batches.resource(id);
  const r=JSON.parse(await readFile(join(this.workspace,`comparison-${id}.json`),'utf8'));if(r.sha256!==hash(r.report))throw Error('Comparison integrity check failed.');return r.report;
 }
 async library(){
  const items=this.jobs.list().filter(j=>j.status==='complete').map(j=>({kind:'artifact',id:j.id,label:`${j.query.source} · ${j.query.start} → ${j.query.end}${portDistanceSuffix(j.query)}`}));
  items.push(...this.explorer.list().filter(s=>s.complete).map(s=>({kind:'lookup',id:s.id,label:`${s.query.kind} · ${s.query.kind==='search'?searchLabel(s.query).slice(0,180):['area-events','event-stats'].includes(s.query.kind)?`${s.query.eventType} · ${s.query.start} → ${s.query.end}`:s.query.vesselId}`})));
  items.push(...this.batches.list().filter(b=>!this.batches.running.has(b.id)&&b.parts.some(p=>p.status==='complete')).map(b=>({kind:'batch',id:b.id,label:`Historical batch · ${b.parts.every(p=>p.status==='complete')?'complete':'PARTIAL · '+b.parts.filter(p=>p.status==='complete').length+'/'+b.parts.length+' chunks'} · ${b.query.start} → ${b.query.end}${portDistanceSuffix(b.query)}`})));
  if(this.bulkInfrastructure)items.push(...this.bulkInfrastructure.list().filter(s=>s.status==='complete').map(s=>({kind:'bulk-infrastructure',id:s.id,label:`Bulk infrastructure · ${s.rows} source records · ${s.createdAt.slice(0,10)}`})));
  if(this.infrastructure)items.push(...this.infrastructure.list().filter(s=>s.status==='complete').map(s=>({kind:'infrastructure',id:s.id,label:`Infrastructure · ${s.query.start} → ${s.query.end}`})));
  for(const file of await readdir(this.workspace))if(/^comparison-[a-f0-9-]{36}\.json$/.test(file)){const id=file.slice(11,-5);try{const r=await this.resource('comparison',id);items.push({kind:'comparison',id,label:`Comparison · ${r.parents[0].query.start} vs ${r.parents[1].query.start}`});}catch{}}
  if(this.vesselSets)for(const set of await this.vesselSets.list())for(const r of set.revisions)items.push({kind:'vessel-set',id:r.id,label:`${r.title} · ${r.members} identities · ${r.createdAt.slice(0,16)} · ${r.id.slice(0,8)}`});
  return items;
 }
 async studies(){return this.all('study',s=>({id:s.id,createdAt:s.createdAt,revisions:s.revisions.map(r=>({id:r.id,title:r.title,createdAt:r.createdAt,queryHash:r.queryHash}))}));}
 async saveStudy(input,{imported=false}={}){
  const id=input.id||randomUUID();if(!uuid.test(id))throw Error('Invalid study ID.');if(this.locks.has(id))throw Error('This study is already being saved.');this.locks.add(id);
  try{
   const old=input.id?await this.read('study',id):{schemaVersion:1,id,createdAt:new Date().toISOString(),revisions:[]};
   if(input.id&&input.baseRevisionId!==old.revisions.at(-1)?.id)throw Error('Study changed since opening. Reopen it before saving a new revision.');
   if(old.revisions.length>=500)throw Error('Study reached 500 revisions. Export its plan and create a new study.');
   const query=validate(input.query,{maxDays:20*366});const queryHash=hash(query);const references=[];let activeArtifact=null,activeArtifactHash=null,activeBatch=null,activeBatchHash=null;
   if(!Array.isArray(input.references)||input.references.length>100)throw Error('Choose up to 100 study references.');
   for(const ref of input.references){
    if(!ref||!Object.hasOwn(types,ref.kind)||!uuid.test(ref.id))throw Error('Invalid study reference.');
    if(references.some(r=>r.kind===ref.kind&&r.id===ref.id))continue;
    let checksum,originId=ref.originId||ref.id;
    try{const resource=await this.resource(ref.kind,ref.id);checksum=hash(resource);if(ref.kind==='artifact'&&ref.id===input.presentation?.artifactId){activeArtifact=resource;activeArtifactHash=checksum;}if(ref.kind==='batch'&&ref.id===input.presentation?.batchId){activeBatch=resource;activeBatchHash=checksum;}originId=resource.manifest?.id||resource.id||originId;}catch(error){if(!imported)throw error;}
    if(imported){if(!/^[a-f0-9]{64}$/.test(ref.sha256))throw Error('Imported reference needs a checksum.');checksum=ref.sha256;originId=ref.originId||ref.id;}
    references.push({kind:ref.kind,id:ref.id,label:text(ref.label||ref.kind,200),sha256:checksum,originId:text(originId,120)});
   }
   if(references.filter(r=>r.kind==='layer').length>10)throw Error('A study supports up to ten displayed reference layers.');
   const view=input.presentation||{},viewport=view.viewport;let savedViewport=null;
   if(viewport){if(!Array.isArray(viewport.center)||viewport.center.length!==2||viewport.center.some(n=>typeof n!=='number'||!Number.isFinite(n))||Math.abs(viewport.center[0])>85||Math.abs(viewport.center[1])>180||!Number.isFinite(viewport.zoom)||viewport.zoom<1||viewport.zoom>14)throw Error('Invalid saved viewport.');savedViewport={center:[...viewport.center],zoom:viewport.zoom};}
   const allowedId=(kind,value)=>references.some(r=>r.kind===kind&&r.id===value)?value:null;
   const batching={enabled:view.batching?.enabled===true,chunkMonths:view.batching?.chunkMonths??1};if(!Number.isInteger(batching.chunkMonths)||batching.chunkMonths<1||batching.chunkMonths>12)throw Error('Invalid saved batch settings.');
   const presentation={viewport:savedViewport,batching,activeView:['extract','downloads','compare','vessels','infrastructure','catalogue'].includes(view.activeView)?view.activeView:'extract',artifactId:allowedId('artifact',view.artifactId),batchId:allowedId('batch',view.batchId),comparisonId:allowedId('comparison',view.comparisonId),lookupId:allowedId('lookup',view.lookupId),layerIds:references.filter(r=>r.kind==='layer').map(r=>r.id)};
   if(view.artifactView&&(presentation.artifactId||view.activeView==='downloads')){
    const v=view.artifactView;if(v.schemaVersion!==1||!v.options||typeof v.options!=='object'||Array.isArray(v.options)||Object.keys(v).some(k=>!['schemaVersion','options','sourceSha256','draftPending','viewport'].includes(k)))throw Error('Unsupported saved extract view.');
    if(v.draftPending)throw Error('Apply or reset saved-data filters before saving the study.');
    if(!presentation.artifactId&&view.activeView==='downloads')throw Error('Link the selected extract under saved results to save its display view.');
    if(presentation.artifactId){const ref=references.find(r=>r.kind==='artifact'&&r.id===presentation.artifactId);if(imported&&v.sourceSha256!==ref.sha256)throw Error('Saved view does not match its source reference.');const options=activeArtifact&&activeArtifactHash===ref.sha256?savedViewOptions(activeArtifact.query,activeArtifact.rows,v.options).options:savedViewShape(v.options);presentation.artifactView={schemaVersion:1,sourceSha256:ref.sha256,options,...(v.viewport?{viewport:viewViewport(v.viewport)}:{})};}
   }
   if(presentation.artifactId&&presentation.batchId)throw Error('Choose one active saved result view, either an extract or a historical batch.');
   if(view.batchView&&(presentation.batchId||view.activeView==='downloads')){
    const v=view.batchView;if(v.schemaVersion!==1||Object.keys(v).some(k=>!['schemaVersion','options','sourceSha256','draftPending','viewport','batchFingerprint'].includes(k)))throw Error('Unsupported saved batch view.');
    if(v.draftPending)throw Error('Apply the current batch filters and wait for analysis before saving the study.');
    if(!presentation.batchId)throw Error('Link the selected batch under saved results to save its display view.');
    const ref=references.find(r=>r.kind==='batch'&&r.id===presentation.batchId),options=batchViewShape(v.options);
    if(imported&&v.sourceSha256!==ref.sha256)throw Error('Saved batch view does not match its source reference.');
    if(!imported&&(!/^[a-f0-9]{64}$/.test(v.batchFingerprint||'')||this.batches.running.has(presentation.batchId)||batchFingerprint(this.batches.get(presentation.batchId))!==v.batchFingerprint))throw Error('Batch changed since this view was analyzed. Reopen and apply the saved-data view before saving.');
    if(activeBatch&&activeBatchHash===ref.sha256)analysisOptions(activeBatch.query||activeBatch.manifest.query,options);
    presentation.batchView={schemaVersion:1,sourceSha256:ref.sha256,options,...(v.viewport?{viewport:viewViewport(v.viewport)}:{})};
   }
   presentation.vesselSetId=allowedId('vessel-set',view.vesselSetId);
   presentation.infrastructureId=allowedId('infrastructure',view.infrastructureId);presentation.infrastructureOptions=view.infrastructureOptions?infrastructureDisplay({start:'2017-01-01',end:'9999-12-31'},view.infrastructureOptions):null;presentation.infrastructureOverlay=view.infrastructureOverlay===true;
   const previous=old.revisions.at(-1);const revision={id:randomUUID(),createdAt:new Date().toISOString(),title:text(input.title,120,true),notes:text(input.notes||'',10000),query,queryHash,queryRevisionId:previous?.queryHash===queryHash?previous.queryRevisionId:randomUUID(),references,presentation,...(imported?{importedFrom:input.importedFrom}: {})};
   const study={...old,revisions:[...old.revisions,revision]};await this.write('study',study);await this.remember(id,revision.id);return {studyId:id,latestRevisionId:revision.id,revision,availability:await this.availability(revision)};
  }finally{this.locks.delete(id);}
 }
 async availability(revision){return Promise.all(revision.references.map(async ref=>{
  let status='missing';try{const actual=hash(await this.resource(ref.kind,ref.id));if(actual===ref.sha256)return {...ref,status:'available',resolvedId:ref.id};status='changed';}catch{}
  if(ref.kind==='artifact')for(const candidate of this.jobs.jobs.filter(j=>j.status==='complete'&&(j.importedFrom===ref.originId||j.id===ref.originId))){try{if(hash(await this.resource('artifact',candidate.id))===ref.sha256)return {...ref,status:'available',resolvedId:candidate.id};}catch{}}
  if(ref.kind==='lookup')for(const candidate of this.explorer.list().filter(s=>s.complete&&(s.originalId===ref.originId||s.id===ref.originId))){try{if(hash(await this.resource('lookup',candidate.id))===ref.sha256)return {...ref,status:'available',resolvedId:candidate.id};}catch{}}
  if(ref.kind==='batch')for(const candidate of this.batches.batches.filter(b=>b.id===ref.originId||b.importedArchive?.sourceId===ref.originId)){try{if(hash(await this.resource('batch',candidate.id))===ref.sha256)return {...ref,status:'available',resolvedId:candidate.id};}catch{}}
  return {...ref,status};
 }));}
 async openStudy(id,revisionId){const s=await this.read('study',id);const revision=revisionId?s.revisions.find(r=>r.id===revisionId):s.revisions.at(-1);if(!revision)throw Error('Study revision not found.');return {studyId:id,latestRevisionId:s.revisions.at(-1).id,revision,availability:await this.availability(revision)};}
 async remember(studyId,revisionId){try{await this.jobs.atomic('workspace-state.json',{studyId,revisionId});}catch{this.jobs.diagnostics.push({file:'workspace-state.json',error:'Study saved/opened, but the startup pointer could not be updated.'});}}
 async lastStudy(){try{const state=JSON.parse(await readFile(join(this.workspace,'workspace-state.json'),'utf8'));return await this.openStudy(state.studyId,state.revisionId);}catch(error){if(error.code!=='ENOENT')this.jobs.diagnostics.push({file:'workspace-state.json',error:'Last study could not be restored; choose a study manually.'});return null;}}
 async exportStudy(id,revisionId){const opened=await this.openStudy(id,revisionId);const plan={schemaVersion:1,type:'fishing-explorer-study-plan',studyId:id,revision:opened.revision,includesData:false,note:'Query, view and reference checksums only. Transfer permitted data/reference backups separately. No credentials are included.'};return {plan,sha256:hash(plan)};}
 async importStudy(bundle){if(bundle?.sha256!==hash(bundle?.plan)||bundle?.plan?.type!=='fishing-explorer-study-plan'||bundle.plan.schemaVersion!==1)throw Error('Invalid study plan or checksum.');const r=bundle.plan.revision;if(hash(validate(r.query,{maxDays:20*366}))!==r.queryHash)throw Error('Study query requires an explicit schema migration.');return this.saveStudy({...r,id:undefined,baseRevisionId:undefined,importedFrom:{studyId:bundle.plan.studyId,revisionId:r.id}},{imported:true});}
}
