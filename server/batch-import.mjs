import {batchHandoffDocumentation,BATCH_DOCUMENTATION_FILES,DOCUMENTATION_VERSION} from './handoff-docs.mjs';
import {mkdir,mkdtemp,writeFile,rename,rm,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {ZipReader,MAX_ARCHIVE_BYTES} from './zip-reader.mjs';
import {ARCHIVE_FOLDER,archiveDirectory,archiveId} from './archive-paths.mjs';
import {planBatch,validateSavedPlan} from './batches.mjs';
import {compactBatch,expandBatch} from './batch-record.mjs';
import {verifyArtifact,hash} from './domain.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const utf8=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sourcePart=p=>({index:p.index,start:p.start,end:p.end,status:p.status,jobId:p.jobId,originalJobId:p.originalJobId,rows:p.rows,bytes:p.bytes,sha256:p.sha256,csvSha256:p.csvSha256,csvBytes:p.csvBytes,responseVersion:p.responseVersion,attempts:p.attempts});
export function validateBatchManifest(manifest){
 if(!manifest||![1,2,3].includes(manifest.schemaVersion)||manifest.type!=='historical-batch'||!archiveId(manifest.id)||typeof manifest.complete!=='boolean'||!timestamp(manifest.createdAt)||!timestamp(manifest.exportedAt)||!Array.isArray(manifest.parts)||!manifest.parts.length||manifest.parts.length>240||!Array.isArray(manifest.notes)||manifest.notes.length>100||manifest.notes.some(n=>typeof n!=='string'||n.length>10000))throw Error('Invalid historical batch manifest.');
 const matches=plan=>plan.parts.length===manifest.parts.length&&plan.parts.every((p,i)=>p.start===manifest.parts[i].start&&p.end===manifest.parts[i].end&&manifest.parts[i].index===i);
 let plan;if(manifest.chunkMonths!==undefined)plan=planBatch(manifest.query,{chunkMonths:manifest.chunkMonths});else for(let months=1;months<=12;months++){try{const candidate=planBatch(manifest.query,{chunkMonths:months});if(matches(candidate)){plan=candidate;break;}}catch{}}
 if(!plan||!matches(plan)||plan.queryHash!==manifest.queryHash||hash(manifest.query)!==plan.queryHash)throw Error('Batch partition or query does not match its manifest.');
 for(const p of manifest.parts){if(typeof p.status!=='string'||!/^[a-z-]{1,40}$/.test(p.status)||p.jobId!==undefined&&p.jobId!==null&&!archiveId(p.jobId)||p.originalJobId!==undefined&&!archiveId(p.originalJobId)||p.attempts!==undefined&&(!Array.isArray(p.attempts)||p.attempts.some(id=>!archiveId(id))))throw Error('Invalid source chunk state.');if(p.status==='complete'&&(!archiveId(p.jobId)||!Number.isSafeInteger(p.rows)||p.rows<0||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>128*1024*1024||!sha(p.sha256)))throw Error('Completed chunk lacks valid identity, size or checksum.');}
 const completed=manifest.parts.filter(p=>p.status==='complete'),missing=manifest.parts.filter(p=>p.status!=='complete').map(p=>({start:p.start,end:p.end}));if(!completed.length||manifest.complete!==(completed.length===manifest.parts.length)||hash(missing)!==hash(manifest.missingWindows))throw Error('Batch completeness or missing windows are inconsistent.');
 if(manifest.schemaVersion>=2){if(!manifest.sourceBatch||manifest.chunkMonths===undefined)throw Error('Version 2/3 archive requires its original batch record.');const original=expandBatch(manifest.sourceBatch);validateSavedPlan(original);if(original.id!==manifest.id||original.queryHash!==manifest.queryHash||original.chunkMonths!==plan.chunkMonths||hash(original.parts.map(sourcePart))!==hash(manifest.parts.map(sourcePart)))throw Error('Original batch record and archive manifest disagree.');}
 if(manifest.schemaVersion===3){const doc=manifest.documentation;if(!doc||doc.version!==DOCUMENTATION_VERSION||!doc.files||typeof doc.files!=='object'||Array.isArray(doc.files)||Object.keys(doc.files).length!==BATCH_DOCUMENTATION_FILES.length||BATCH_DOCUMENTATION_FILES.some(name=>!doc.files[name]||!Number.isSafeInteger(doc.files[name].bytes)||doc.files[name].bytes<1||!sha(doc.files[name].sha256)))throw Error('Unsupported or incomplete historical handoff documentation.');}
 return {plan,completed,contentHash:hash({...manifest,exportedAt:undefined}),inferredChunkMonths:manifest.chunkMonths===undefined};
}
export class BatchImporter{
 constructor(workspace,batches,jobs){this.workspace=workspace;this.batches=batches;this.jobs=jobs;this.busy=false;}
 async receive(readable,{signal}={}){
  if(this.busy)throw Error('Another batch ZIP import is active. Wait for it to finish.');this.busy=true;let stage,reader,committed=false;
  try{
   const root=join(this.workspace,ARCHIVE_FOLDER);await mkdir(root,{recursive:true,mode:0o700});stage=await mkdtemp(join(root,'.stage-'));const upload=join(stage,'upload.zip'),zipHash=createHash('sha256');let size=0;
   const limit=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>MAX_ARCHIVE_BYTES)return callback(Error('Batch ZIP exceeds 2 GiB plus 128 MiB of archive metadata.'));zipHash.update(chunk);callback(null,chunk);}});
   await pipeline(readable,limit,createWriteStream(upload,{flags:'wx',mode:0o600}),{signal});reader=await ZipReader.open(upload);
   const zipSha256=zipHash.digest('hex'),manifestRaw=utf8(await reader.entry('manifest.json',128*1024*1024)),readmeRaw=utf8(await reader.entry('README.txt',1024*1024)),manifest=JSON.parse(manifestRaw),validated=validateBatchManifest(manifest);
   const expected=new Set(['manifest.json','README.txt',...(manifest.schemaVersion===3?BATCH_DOCUMENTATION_FILES:[]),...validated.completed.flatMap(p=>{const n=String(p.index+1).padStart(4,'0');return [`chunks/${n}.bundle.json`,`data/${n}.csv`];})]);if(reader.entries.size!==expected.size||[...reader.entries.keys()].some(name=>!expected.has(name)))throw Error('ZIP contents do not match completed chunks in the manifest.');
   if(manifest.schemaVersion===3)for(const [name,content] of Object.entries(batchHandoffDocumentation(manifest))){const expected=manifest.documentation.files[name],bytes=await reader.entry(name,['query.json','boundary.geojson'].includes(name)?17*1024*1024:1024*1024);if(expected.bytes!==bytes.length||expected.sha256!==digest(bytes)||!bytes.equals(Buffer.from(content)))throw Error(`Historical handoff document differs from its manifest or supported transformation: ${name}`);}
   const id=randomUUID(),createdAt=new Date().toISOString(),newJobs=[],parts=validated.plan.parts.map(p=>({...p,status:'unavailable',sourceStatus:manifest.parts[p.index].status,sourceJobId:manifest.parts[p.index].jobId||null}));
   for(const source of validated.completed){
    signal?.throwIfAborted();const n=String(source.index+1).padStart(4,'0'),bytes=await reader.entry(`chunks/${n}.bundle.json`,128*1024*1024);if(bytes.length!==source.bytes||digest(bytes)!==source.sha256)throw Error(`Chunk ${source.index+1} does not match its manifest checksum.`);
    const artifact=verifyArtifact(JSON.parse(utf8(bytes))),part=parts[source.index];if(!timestamp(artifact.manifest.createdAt)||artifact.manifest.id!==(source.originalJobId||source.jobId)||artifact.manifest.queryHash!==hash(part.query)||artifact.rows.length!==source.rows||source.responseVersion!==undefined&&source.responseVersion!==artifact.manifest.responseVersion)throw Error('A chunk belongs to a different identity, query or source version.');
    const csv=await reader.entry(`data/${n}.csv`,128*1024*1024),csvHash=digest(csv);if(csvHash!==artifact.manifest.files['data.csv'].sha256||csv.length!==artifact.manifest.files['data.csv'].bytes||!csv.equals(Buffer.from(artifact.files['data.csv']))||source.csvSha256!==undefined&&source.csvSha256!==csvHash||source.csvBytes!==undefined&&source.csvBytes!==csv.length)throw Error(`CSV for chunk ${source.index+1} differs from its original bundle.`);
    const token=this.jobs.token();if(token&&(bytes.includes(Buffer.from(token))||manifestRaw.includes(token)))throw Error('Configured credential material was found in the archive.');
    const jobId=randomUUID(),job={id:jobId,batchId:id,archiveDirectory:id,queryWindow:{start:part.start,end:part.end},status:'complete',createdAt:artifact.manifest.createdAt,rows:artifact.rows.length,importedFrom:artifact.manifest.id};
    await writeFile(join(stage,`artifact-${jobId}.json`),bytes,{flag:'wx',mode:0o600});await writeFile(join(stage,`job-${jobId}.json`),JSON.stringify(job),{flag:'wx',mode:0o600});newJobs.push({...job,query:part.query});
    Object.assign(part,{status:'complete',jobId,originalJobId:artifact.manifest.id,sha256:source.sha256,bytes:bytes.length,csvSha256:csvHash,csvBytes:csv.length,rows:artifact.rows.length,responseVersion:artifact.manifest.responseVersion,savedAt:createdAt});
   }
   for(const candidate of this.batches.batches.filter(b=>b.importedArchive?.contentHash===validated.contentHash&&b.importedArchive.zipSha256===zipSha256)){try{await this.batches.sourceArchive(candidate);await this.batches.originalZip(candidate);await this.batches.verifyChunks(candidate);return {batch:this.batches.view(candidate),reused:true,verifiedUploadSha256:zipSha256};}catch{}}
   const source={manifestRaw,readmeRaw},sourceSha256=hash(source),batch={...validated.plan,id,createdAt,status:manifest.complete?'complete':'paused',notes:manifest.notes,parts,archiveDirectory:id,importedArchive:{sourceId:manifest.id,contentHash:validated.contentHash,sourceSha256,zipSha256,zipBytes:size,importedAt:createdAt,inferredChunkMonths:validated.inferredChunkMonths}};
   await writeFile(join(stage,'source.json'),JSON.stringify({source,sha256:sourceSha256}),{flag:'wx',mode:0o600});await writeFile(join(stage,'batch.json'),JSON.stringify(compactBatch(batch)),{flag:'wx',mode:0o600});
   await reader.close();reader=null;await rename(upload,join(stage,'source.zip'));signal?.throwIfAborted();const destination=archiveDirectory(this.workspace,id);try{await stat(destination);throw Error('Unexpected local archive identity collision.');}catch(error){if(error.code!=='ENOENT')throw error;}
   // A directory rename is the single visibility point. Incomplete staging folders
   // are ignored on startup; no pre-existing job, artifact or batch is overwritten.
   await rename(stage,destination);committed=true;this.jobs.jobs.push(...newJobs);this.batches.batches.push(batch);return {batch:this.batches.view(batch),reused:false};
  }finally{try{if(reader)await reader.close();}finally{try{if(stage&&!committed)await rm(stage,{recursive:true,force:true});}catch{this.jobs.diagnostics.push({file:stage,error:'An uncommitted import staging folder could not be removed. It is not visible as saved data.'});}finally{this.busy=false;}}}
 }
}
