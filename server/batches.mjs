import {batchHandoffDocumentation,DOCUMENTATION_VERSION} from './handoff-docs.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join} from 'node:path';
import {validate,hash,verifyArtifact} from './domain.mjs';
import {analyzeBatch} from './batch-analysis.mjs';
import {compactBatch,expandBatch,batchFingerprint} from './batch-record.mjs';
import {archiveDirectory,archiveDirectories,archiveId} from './archive-paths.mjs';
export function planBatch(input,{chunkMonths=1}={}){
 if(!Number.isInteger(chunkMonths)||chunkMonths<1||chunkMonths>12)throw Error('Choose 1–12 calendar months per chunk.');
 const query=validate(input,{maxDays:20*366});
 if(!['DAILY','MONTHLY'].includes(query.interval))throw Error('Historical batches currently require daily or monthly bins. Whole-period output needs a single report.');
 if(query.source==='synthetic-activity'&&chunkMonths!==1)throw Error('Synthetic batches use one calendar month per chunk.');
 const parts=[];let start=query.start;
 while(start<query.end){
  const d=new Date(start);const next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+chunkMonths,1)).toISOString().slice(0,10);
  const end=next<query.end?next:query.end;
  // Geometry/source/filter validation applies to the common query. Calendar
  // partitioning changes only dates, and every chunk must meet the report limit.
  if((Date.parse(end)-Date.parse(start))/86400000>(query.source==='synthetic-activity'?31:366))throw Error('Chunk exceeds the individual report date limit.');
  parts.push({index:parts.length,start,end,query:{...query,start,end},status:'pending',attempts:[]});start=end;
  if(parts.length>240)throw Error('This client supports at most 240 chunks per plan.');
 }
 return {schemaVersion:1,query,queryHash:hash(query),chunkMonths,parts,estimatedRequests:parts.length,estimatedBytes:null,
  notes:['UTC half-open windows; internal seams align to calendar months.','Preview does not submit requests. Each chunk will use the saved version, geometry and filters.','Size and duration are not calibrated. Each provider response is limited to 32 MiB; completed chunks are retained separately.']};
}
async function checksum(path){const digest=createHash('sha256');for await(const data of createReadStream(path))digest.update(data);return digest.digest('hex');}
export function validateSavedPlan(batch){
 const plan=planBatch(batch.query,{chunkMonths:batch.chunkMonths});
 const sameQuery=part=>part.query&&Object.keys(part.query).length===Object.keys(batch.query).length&&Object.keys(batch.query).every(key=>key==='start'?part.query.start===part.start:key==='end'?part.query.end===part.end:part.query[key]===batch.query[key]||hash(part.query[key])===hash(batch.query[key]));
 if(plan.queryHash!==batch.queryHash||hash(batch.query)!==plan.queryHash||!Array.isArray(batch.parts)||batch.parts.length!==plan.parts.length||batch.parts.some((part,i)=>part.index!==i||part.start!==plan.parts[i].start||part.end!==plan.parts[i].end||!sameQuery(part)))throw Error('Invalid saved batch partition.');
}
export class BatchStore{
 constructor(workspace,jobs){this.workspace=workspace;this.jobs=jobs;this.batches=[];this.running=new Map();this.closing=false;}
 async persist(batch){await this.jobs.atomic(`batch-${batch.id}.json`,compactBatch(batch));}
 async load(){const files=(await readdir(this.workspace)).filter(file=>/^batch-[a-f0-9-]{36}\.json$/.test(file)).map(file=>({file,path:join(this.workspace,file)}));for(const id of await archiveDirectories(this.workspace))files.push({file:`batch-${id}.json`,path:join(archiveDirectory(this.workspace,id),'batch.json'),archive:id});for(const {file,path,archive} of files){
  try{const b=expandBatch(JSON.parse(await readFile(path,'utf8')));validateSavedPlan(b);
   if(file!==`batch-${b.id}.json`)throw Error('Invalid plan identity');
   if(archive&&(b.archiveDirectory!==archive||!b.importedArchive))throw Error('Invalid archive association');
   if(['running','pausing'].includes(b.status)){b.status='paused';b.error='Application restarted. Completed chunks remain saved; resume explicitly after reviewing any unresolved child job.';await this.persist(b);}this.batches.push(b);
  }catch{this.jobs.diagnostics.push({file,error:'Batch plan could not be validated. It was not resumed.'});}
 }}
 view(b){return {...b,status:b.status==='complete'&&this.running.has(b.id)?'running':b.status,analysisFingerprint:batchFingerprint(b),parts:b.parts.map(({query,...part})=>part)};}
 list(){return this.batches.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(b=>this.view(b));}
 get(id){const batch=this.batches.find(b=>b.id===id);if(!batch)throw Error('Batch not found.');return batch;}
 async create(input,options){const plan=planBatch(input,options);const b={...plan,id:randomUUID(),createdAt:new Date().toISOString(),status:'planned'};await this.persist(b);this.batches.push(b);return b;}
 start(id,{confirmSourceReview=false}={}){
  const b=this.get(id);if(this.closing)throw Error('Server is shutting down.');
  if(b.importedArchive)throw Error('Imported batches are immutable. Copy the remaining plan before retrieving more data.');
  if(b.continuedFrom?.requiresSourceReview&&!b.continuedFrom.reviewedAt){if(confirmSourceReview!==true)throw Error('The source archive contains attempted missing chunks. Review upstream activity before starting another request.');b.continuedFrom.reviewedAt=new Date().toISOString();}
  if(this.running.has(id))throw Error('Batch already running.');
  if(this.running.size)throw Error('Another historical batch is active. Pause it before starting this one.');
  if(b.query.source!=='synthetic-activity'&&!this.jobs.token())throw Error('Connect your personal token before starting the batch.');
  if(b.status==='complete')throw Error('This batch is already complete.');
  b.status='running';delete b.error;
  const work=this.run(b).catch(error=>{b.status='paused';b.error='Batch state could not be persisted.';this.jobs.diagnostics.push({file:`batch-${id}.json`,error:error.message});}).finally(()=>this.running.delete(id));this.running.set(id,work);return b;
 }
 async run(b){
  try{
   await this.persist(b);
   for(const part of b.parts){
    if(this.closing||b.status!=='running')break;
    if(part.status==='complete'){if(!part.jobId||await checksum(this.jobs.artifactPath(part.jobId))!==part.sha256)throw Error('A saved chunk failed integrity verification; it will not be fetched again automatically.');continue;}
    let job=part.jobId?this.jobs.jobs.find(j=>j.id===part.jobId):null;
    if(!job&&part.jobId&&this.jobs.diagnostics.some(d=>d.file===`job-${part.jobId}.json`))throw Error('A reserved child job is unreadable. Resolve its diagnostic before retrying.');
    if(job&&['recovery-needed','checking-recovery','running','queued'].includes(job.status))throw Error('A child report is active or unresolved. Review its job controls before resuming the batch.');
    if(job?.status!=='complete'){
     if(job){part.attempts.push(job.id);part.jobId=null;}
     part.jobId ||= randomUUID();part.status='submitting';await this.persist(b);
     // Persist association before submission, so a crash cannot orphan remote work.
     job=await this.jobs.submit(part.query,{id:part.jobId,batchId:b.id});await this.jobs.queue;
     if(job.status!=='complete'){part.status=job.status;throw Error(`Chunk ${part.index+1} stopped: ${job.error||job.status}`);}
    }
    const artifact=await this.jobs.artifact(job.id);
    if(artifact.manifest.queryHash!==hash(part.query))throw Error('Child artifact does not match the planned query.');
    const path=this.jobs.artifactPath(job.id);
    part.status='complete';part.csvSha256=artifact.manifest.files['data.csv'].sha256;part.csvBytes=artifact.manifest.files['data.csv'].bytes;part.rows=artifact.rows.length;part.responseVersion=artifact.manifest.responseVersion;part.bytes=(await stat(path)).size;part.sha256=await checksum(path);part.savedAt=new Date().toISOString();await this.persist(b);
   }
   if(b.parts.every(p=>p.status==='complete')){b.status='complete';b.completedAt=new Date().toISOString();}
   else if(b.status==='pausing'||this.closing)b.status='paused';
  }catch(error){b.status='paused';b.error=error.message;}
  finally{await this.persist(b);}
 }
 async pause(id){const b=this.get(id);if(b.importedArchive)throw Error('Imported batches are immutable.');if(b.status==='running')b.status='pausing';else if(b.status!=='complete')b.status='paused';await this.persist(b);return b;}
 async verifyChunks(batch){for(const part of batch.parts.filter(p=>p.status==='complete')){const path=this.jobs.artifactPath(part.jobId),info=await stat(path);if(info.size!==part.bytes||await checksum(path)!==part.sha256)throw Error(`Saved chunk ${part.index+1} failed integrity verification.`);}}
 async sourceArchive(batch){if(!batch.importedArchive||!archiveId(batch.archiveDirectory))throw Error('Imported archive source is unavailable.');const wrapper=JSON.parse(await readFile(join(archiveDirectory(this.workspace,batch.archiveDirectory),'source.json'),'utf8'));if(wrapper.sha256!==hash(wrapper.source)||wrapper.sha256!==batch.importedArchive.sourceSha256)throw Error('Imported batch source manifest failed integrity verification.');return wrapper.source;}
 async originalZip(batch){const path=join(archiveDirectory(this.workspace,batch.archiveDirectory),'source.zip'),info=await stat(path);if(info.size!==batch.importedArchive.zipBytes||await checksum(path)!==batch.importedArchive.zipSha256)throw Error('Original imported ZIP failed integrity verification.');return {path,size:info.size,sha256:batch.importedArchive.zipSha256};}
 async resource(id){
  if(this.running.has(id))throw Error('Pause the batch and wait for its current chunk before linking it to a study.');
  const b=structuredClone(this.get(id)),fingerprint=batchFingerprint(b);validateSavedPlan(b);
  if(!b.parts.some(p=>p.status==='complete'))throw Error('Save at least one completed chunk before linking this batch.');
  await this.verifyChunks(b);let resource=b;
  if(b.importedArchive){const source=await this.sourceArchive(b),manifest=JSON.parse(source.manifestRaw);if(manifest.sourceBatch){resource=expandBatch(manifest.sourceBatch);validateSavedPlan(resource);}else resource={type:'legacy-batch-archive',id:manifest.id,manifest};}
  if(this.running.has(id)||batchFingerprint(this.get(id))!==fingerprint)throw Error('Batch changed while verifying its study reference. Reopen the saved batch.');
  return resource;
 }
 async copyRemaining(id){
  const parent=this.get(id);if(!parent.importedArchive||parent.parts.every(p=>p.status==='complete'))throw Error('Choose an imported partial batch with missing windows.');await this.verifyChunks(parent);const source=JSON.parse((await this.sourceArchive(parent)).manifestRaw),plan=planBatch(parent.query,{chunkMonths:parent.chunkMonths});
  const attempts=source.parts.filter(p=>p.status!=='complete'&&p.jobId).map(p=>({index:p.index,start:p.start,end:p.end,jobId:p.jobId,status:p.status}));
  const child={...plan,id:randomUUID(),createdAt:new Date().toISOString(),status:'planned',parts:plan.parts.map((p,i)=>parent.parts[i].status==='complete'?{...parent.parts[i],query:p.query}:p),continuedFrom:{id:parent.importedArchive.sourceId,localId:parent.id,archiveHash:parent.importedArchive.contentHash,createdAt:new Date().toISOString(),requiresSourceReview:attempts.length>0&&parent.query.source!=='synthetic-activity',sourceAttempts:attempts}};
  await this.persist(child);this.batches.push(child);return child;
 }
 async analyze(id,options,{includeReportData=false,signal}={}){
  if(this.analysisActive)throw Error('Another saved batch analysis is running. Try again when it finishes.');
  if(this.running.has(id))throw Error('Pause the batch and wait for its current chunk before analyzing.');
  const snapshot=structuredClone(this.get(id)),fingerprint=batchFingerprint(snapshot);
  validateSavedPlan(snapshot);
  this.analysisActive=true;
  try{
   if(options?.sourceSha256!==undefined){if(!/^[a-f0-9]{64}$/.test(options.sourceSha256)||hash(await this.resource(id))!==options.sourceSha256)throw Error('The batch no longer matches the saved study source. Open it from the library to inspect the changed data.');}
   const result=await analyzeBatch(snapshot,this.workspace,options,{includeReportData,signal,artifactPath:id=>this.jobs.artifactPath(id)});
   if(this.running.has(id)||batchFingerprint(this.get(id))!==fingerprint)throw Error('Batch changed during analysis. Open the saved batch again.');
   return result;
  }finally{this.analysisActive=false;}
 }
 async exportEntries(id,{allowPartial=false}={}){
  const b=this.get(id);if(this.running.has(id))throw Error('Pause the batch and wait for its current chunk before exporting.');
  const completed=b.parts.filter(p=>p.status==='complete');const complete=completed.length===b.parts.length;
  if(!complete&&!allowPartial)throw Error('This batch is incomplete. Choose the explicitly partial export.');
  if(!completed.length)throw Error('No completed chunks are available to export.');
  if(b.importedArchive)return {complete,originalArchive:await this.originalZip(b)};
  let bytes=0;const entries=[];
  for(const part of completed){
   const path=this.jobs.artifactPath(part.jobId);const file=await stat(path);
   if(file.size!==part.bytes||await checksum(path)!==part.sha256)throw Error(`Chunk ${part.index+1} failed its saved-file integrity check.`);
   bytes+=file.size+(part.csvBytes??file.size);entries.push({name:`chunks/${String(part.index+1).padStart(4,'0')}.bundle.json`,path,size:file.size,sha256:part.sha256});
   entries.push({name:`data/${String(part.index+1).padStart(4,'0')}.csv`,size:part.csvBytes,sha256:part.csvSha256,open:async function*(){const artifact=verifyArtifact(JSON.parse(await readFile(path,'utf8')));yield Buffer.from(artifact.files['data.csv']);}});
  }
  if(bytes>2*1024*1024*1024)throw Error('Archive exceeds the current 2 GiB ZIP export limit. Export chunk bundles individually.');
  const manifest={schemaVersion:3,type:'historical-batch',id:b.id,complete,query:b.query,queryHash:b.queryHash,createdAt:b.createdAt,exportedAt:new Date().toISOString(),chunkMonths:b.chunkMonths,sourceBatch:compactBatch(b),parts:b.parts.map(p=>({index:p.index,start:p.start,end:p.end,status:p.status,jobId:p.jobId,originalJobId:p.originalJobId,rows:p.rows,bytes:p.bytes,sha256:p.sha256,csvSha256:p.csvSha256,csvBytes:p.csvBytes,responseVersion:p.responseVersion,attempts:p.attempts})),missingWindows:b.parts.filter(p=>p.status!=='complete').map(p=>({start:p.start,end:p.end})),notes:[...b.notes,'Each bundle retains raw response, query, caveats and hashes. This archive is not a globally synchronized upstream snapshot.','Do not sum per-cell distinct vessel counts. Missing or unreturned data does not imply zero activity.']};
  const docs=batchHandoffDocumentation(manifest);manifest.documentation={version:DOCUMENTATION_VERSION,files:Object.fromEntries(Object.entries(docs).map(([name,content])=>[name,{bytes:Buffer.byteLength(content),sha256:hash(content)}]))};
  return {complete,entries:[{name:'manifest.json',data:Buffer.from(JSON.stringify(manifest,null,2))},{name:'README.txt',data:Buffer.from('Fishing Explorer historical archive\nStart with query-summary.txt, data-dictionary.json, source-citation.txt and use-conditions.txt. query.json and boundary.geojson retain the exact selection. See manifest.json for complete/partial status, missing windows, source, units and checksums. data/ contains original CSV derivatives; check each chunk manifest for its CSV transform. Import identifiers as text. chunks/ contains original research bundles, including upstream responses and product caveats. Keep all files together.\nPowered by Global Fishing Watch for GFW data: https://globalfishingwatch.org\nAPI data use conditions: https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits\nSynthetic fixtures are not observations and must not be used for research.\n')},...Object.entries(docs).map(([name,content])=>({name,data:Buffer.from(content)})),...entries]};
 }
 async close(){this.closing=true;for(const b of this.batches)if(b.status==='running')b.status='pausing';await Promise.all([...this.running.values()]);}
}
